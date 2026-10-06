/* mooboard live LED board: the faces the real board shows, drawn the way its firmware draws them.
   Every scene paints a 128 x 32 frame of floats (the firmware's Canvas). Text is set glyph by glyph at whole-pixel
   pens with the font's own advances and kerning and drawn with its coverage, so each layout is fitted by its ink, the
   pixels it really lights. The board's rule holds everywhere: no glyph is ever clipped or ellipsized; text wraps
   smaller or pages instead. The outermost ring of LEDs is always dark (the owner's edge rule, 2026-10-05), and a glyph
   that would reach it is left out whole and counted in MooBoard.inkFaults, so a test catches any layout that needs
   it. The frame is then shown two ways: as round LEDs (big canvas, dot mask) and as a blurred copy for the glow. */
(function () {
  'use strict';

  var W = 128, H = 32, N = W * H;
  // reduced motion, or motion paused on the page (MooBoard.setPaused): either way the boards hold still frames
  var PREFERS_REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches, REDUCED = PREFERS_REDUCED, paused = false;
  var BLACK = [0, 0, 0], WHITE = [255, 255, 255];

  /* ---------- helpers ---------- */
  function mk(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function hexc(h) { h = h.replace('#', ''); return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)]; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function mul(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function c01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function smooth(a, b, v) { var t = c01((v - a) / (b - a)); return t * t * (3 - 2 * t); }
  function p2in(t) { t = c01(t); return t * t * t; }
  function p2out(t) { t = c01(t); return 1 - Math.pow(1 - t, 3); }
  function cubicOut(t) { t = c01(t); return 1 - Math.pow(1 - t, 3); }
  function approach(cur, to, dt, tau) { return to + (cur - to) * Math.exp(-dt / Math.max(1e-4, tau)); }
  function cyc(t, period, off) { var u = t / period + (off || 0); return u - Math.floor(u); }
  // a repeatable fraction in [0, 1) for (a, b): where each cloud, star and streak sits
  function hashf(a, b) {
    var h = (Math.imul(a, 0x9E3779B1) ^ Math.imul(b + 0x7F4A7C15, 0x85EBCA77)) >>> 0;
    h = (h ^ (h >>> 15)) >>> 0; h = Math.imul(h, 0x2C1B3C6D) >>> 0; h = (h ^ (h >>> 12)) >>> 0;
    return (h & 0xFFFFFF) / 16777216;
  }
  function rng(seed) {
    var s = (seed % 2147483646) + 1;
    var f = function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    f.range = function (a, b) { return a + (b - a) * f(); };
    return f;
  }

  /* ---------- the frame: 128 x 32 RGB floats, with a clip box ---------- */
  function FB() { this.p = new Float32Array(N * 3); this.noclip(); }
  FB.prototype.noclip = function () { this.x0 = 0; this.y0 = 0; this.x1 = W; this.y1 = H; };
  FB.prototype.clip = function (x, y, w, h) { this.x0 = Math.max(0, x); this.y0 = Math.max(0, y); this.x1 = Math.min(W, x + w); this.y1 = Math.min(H, y + h); };
  FB.prototype.fill = function (c) { var p = this.p; for (var i = 0; i < N * 3; i += 3) { p[i] = c[0]; p[i + 1] = c[1]; p[i + 2] = c[2]; } };
  FB.prototype.set = function (x, y, c) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < this.x0 || y < this.y0 || x >= this.x1 || y >= this.y1) return;
    var i = (y * W + x) * 3, p = this.p; p[i] = c[0]; p[i + 1] = c[1]; p[i + 2] = c[2];
  };
  FB.prototype.blend = function (x, y, c, a) {
    if (!(a > 0)) return;
    x = Math.floor(x); y = Math.floor(y);
    if (x < this.x0 || y < this.y0 || x >= this.x1 || y >= this.y1) return;
    if (a > 1) a = 1;
    var i = (y * W + x) * 3, p = this.p;
    p[i] += (c[0] - p[i]) * a; p[i + 1] += (c[1] - p[i + 1]) * a; p[i + 2] += (c[2] - p[i + 2]) * a;
  };
  FB.prototype.rect = function (x, y, w, h, c, a) {
    a = a == null ? 1 : a;
    for (var yy = y; yy < y + h; yy++) for (var xx = x; xx < x + w; xx++) this.blend(xx, yy, c, a);
  };
  FB.prototype.copy = function (o) { this.p.set(o.p); };

  /* ---------- drawing kit (the firmware's clock::Kit) ---------- */
  function disc(f, cx, cy, r, c, a) {
    a = a == null ? 1 : a;
    for (var y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) for (var x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      var dx = x + .5 - cx, dy = y + .5 - cy, cov = r + .5 - Math.sqrt(dx * dx + dy * dy);
      if (cov > 0) f.blend(x, y, c, a * Math.min(cov, 1));
    }
  }
  function ring(f, cx, cy, r, w, c, a) {
    var o = r + w;
    for (var y = Math.floor(cy - o - 1); y <= Math.ceil(cy + o + 1); y++) for (var x = Math.floor(cx - o - 1); x <= Math.ceil(cx + o + 1); x++) {
      var dx = x + .5 - cx, dy = y + .5 - cy, cov = Math.min(1, w / 2 + .5 - Math.abs(Math.sqrt(dx * dx + dy * dy) - r));
      if (cov > 0) f.blend(x, y, c, a * cov);
    }
  }
  function seg(f, x0, y0, x1, y1, hw, c, a) {
    var vx = x1 - x0, vy = y1 - y0, vv = vx * vx + vy * vy;
    for (var y = Math.floor(Math.min(y0, y1) - hw - 1); y <= Math.ceil(Math.max(y0, y1) + hw + 1); y++) for (var x = Math.floor(Math.min(x0, x1) - hw - 1); x <= Math.ceil(Math.max(x0, x1) + hw + 1); x++) {
      var px = x + .5 - x0, py = y + .5 - y0, t = vv > 0 ? c01((px * vx + py * vy) / vv) : 0;
      var dx = px - t * vx, dy = py - t * vy, cov = Math.min(1, hw + .5 - Math.sqrt(dx * dx + dy * dy));
      if (cov > 0) f.blend(x, y, c, a * cov);
    }
  }
  function roundRect(f, x, y, w, h, r, c, a) {
    a = a == null ? 1 : a;
    var ix0 = x + r, ix1 = x + w - r, iy0 = y + r, iy1 = y + h - r;
    for (var yy = y; yy < y + h; yy++) for (var xx = x; xx < x + w; xx++) {
      var px = xx + .5, py = yy + .5, dx = Math.max(ix0 - px, 0, px - ix1), dy = Math.max(iy0 - py, 0, py - iy1);
      var cov = c01(.5 - (Math.sqrt(dx * dx + dy * dy) - r));
      if (cov > 0) f.blend(xx, yy, c, a * cov);
    }
  }
  // blacks out a box's corners outside quarter circles of radius r, anti-aliased (Big weather's window)
  function cornerMask(f, x, y, w, h, r) {
    var n = Math.ceil(r);
    for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) {
      var dx = r - (i + .5), dy = r - (j + .5), o = c01(Math.sqrt(dx * dx + dy * dy) - r + .5);
      if (o <= 0) continue;
      f.blend(x + i, y + j, BLACK, o); f.blend(x + w - 1 - i, y + j, BLACK, o);
      f.blend(x + i, y + h - 1 - j, BLACK, o); f.blend(x + w - 1 - i, y + h - 1 - j, BLACK, o);
    }
  }
  function moonDisc(f, cx, cy, r, phase, lit, dark, darkA, a) {
    if (darkA > 0) disc(f, cx, cy, r, dark, darkA * a);
    var cosT = Math.cos(2 * Math.PI * phase), waxing = phase < .5 ? 1 : -1;
    for (var y = Math.floor(cy - r) - 1; y <= Math.ceil(cy + r) + 1; y++) for (var x = Math.floor(cx - r) - 1; x <= Math.ceil(cx + r) + 1; x++) {
      var px = x + .5 - cx, py = y + .5 - cy, cover = c01(r + .5 - Math.sqrt(px * px + py * py));
      if (cover <= 0) continue;
      var ny = py / r, half = Math.sqrt(Math.max(0, 1 - ny * ny)), edge = c01(px * waxing - cosT * half * r + .5);
      if (edge > 0) f.blend(x, y, lit, cover * edge * a);
    }
  }

  /* ---------- text, set like the board's typesetter ---------- */
  // The roles are the firmware's (pw::text::FaceId) in its default family, Fredoka. The lyric roles are SF Pro here
  // (the owner, 2026-10-05: "we can use SF Pro for now"), from the visitor's system: it is never bundled.
  var SYS = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif';
  var FAMS = {
    fredoka: { css: 'Fredoka', tracked: true, seated: true },
    sys: { css: SYS },
    // SF Pro Rounded where the browser can reach it (Safari's ui-rounded, or an installed copy), else SF Pro
    round: { css: 'ui-rounded, "SF Pro Rounded", ' + SYS }
  };
  var ROLES = {
    label: { fam: 'fredoka', w: 600, smallDigits: true },  // LABEL, TEMP, TITLE, ROW (SfSemibold)
    clock: { fam: 'fredoka', w: 600 },                     // SfSemiboldClock
    medium: { fam: 'fredoka', w: 500 },                    // SfMedium (Minimal, Nixie)
    bold: { fam: 'fredoka', w: 700 },                      // sfr bold for the celebration word
    lyric: { fam: 'round', w: 700 },                       // SfrBold: the line being sung
    lyricSide: { fam: 'round', w: 590 },                   // SfrSemibold: the side lines
    sfSemi: { fam: 'sys', w: 590 }                         // SfSemibold in the SF Pro family (the lyric decor's time)
  };
  // Digits at cap 6 are drawn from this set rather than the font: at that size Fredoka's 5 closes into a 6 (the board
  // shows 11:52 as "11:62"). Rounded like Fredoka, 2-px strokes, open where a 5, 3 or 9 must stay open.
  var SMALL_DIGITS = {
    '0': ['+###+', '##.##', '##.##', '##.##', '##.##', '+###+'],
    '1': ['+##', '###', '.##', '.##', '.##', '.##'],
    '2': ['+###+', '##.##', '..+##', '.+#+.', '+#+..', '#####'],
    '3': ['####+', '...##', '.###+', '...##', '...##', '####+'],
    '4': ['##.##', '##.##', '##.##', '#####', '...##', '...##'],
    '5': ['#####', '##...', '####+', '...##', '...##', '####+'],
    '6': ['+###+', '##...', '####+', '##.##', '##.##', '+###+'],
    '7': ['#####', '...##', '..+#+', '.+#+.', '.##..', '.##..'],
    '8': ['+###+', '##.##', '+###+', '##.##', '##.##', '+###+'],
    '9': ['+###+', '##.##', '##.##', '+####', '...##', '+###+'],
    ':': ['.', '#', '.', '.', '#', '.']
  };
  var G = mk(320, 112), gx = G.getContext('2d', { willReadFrequently: true });
  var metricCache = {}, glyphCache = new Map(), kernCache = new Map(), hiKern = new Map(), lineCache = new Map(), textGen = 0;
  function clearText() { metricCache = {}; glyphCache.clear(); kernCache.clear(); hiKern.clear(); lineCache.clear(); if (typeof hiCache !== 'undefined') hiCache.clear(); textGen++; }
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', clearText);
  function q4(cap) { return Math.round(cap * 4) / 4; }
  // SF Pro Rounded is the board's lyric face. Safari reaches it as ui-rounded; Chrome cannot reach it at all, so there the
  // lyric roles draw SF Pro at its Display optical size (opsz 28), whose advances are Rounded Bold's to the unit: the
  // glyphs are rasterised at 28 px and box-filtered down, and the board's fits, breaks and centring come out the same.
  var roundOk = null;
  function roundedHere() {
    if (roundOk != null) return roundOk;
    gx.font = '700 100px ui-rounded, "SF Pro Rounded", monospace'; var a = gx.measureText('we left the city').width;
    gx.font = '700 100px monospace'; var b = gx.measureText('we left the city').width;
    return (roundOk = Math.abs(a - b) > .5);
  }
  var HI_PX = 28;
  function hiRes(role) { return ROLES[role].fam === 'round' && !roundedHere(); }
  function fontOf(role, size) { var R = ROLES[role]; return R.w + ' ' + size.toFixed(3) + 'px ' + (hiRes(role) ? SYS : FAMS[R.fam].css); }
  // a role's 'H' in units of the font size; a seated face's glyphs are lifted by the H's dip (the firmware's seat)
  function metrics(role) {
    var m = metricCache[role];
    if (m) return m;
    var F = FAMS[ROLES[role].fam];
    gx.font = fontOf(role, 200);
    var t = gx.measureText(F.whole ? 'क' : 'H'), asc = t.actualBoundingBoxAscent / 200, dip = F.seated ? Math.max(0, t.actualBoundingBoxDescent / 200) : 0;
    return (metricCache[role] = { cap: asc + dip, dip: dip });
  }
  function sizeFor(role, capq) { return capq / metrics(role).cap; }
  function bitmapGlyph(ch) {
    var rows = SMALL_DIGITS[ch], w = rows[0].length, a = new Uint8Array(w * 6);
    for (var y = 0; y < 6; y++) for (var x = 0; x < w; x++) { var c = rows[y][x]; a[y * w + x] = c === '#' ? 255 : c === '+' ? 115 : 0; }
    return { w: w, h: 6, x: 0, y: -6, a: a, adv: w, bitmap: true };
  }
  function glyphOf(role, capq, ch) {
    var key = role + '|' + capq + '|' + ch, g = glyphCache.get(key);
    if (g) return g;
    var R = ROLES[role], F = FAMS[R.fam];
    if (R.smallDigits && capq <= 6.5 && capq >= 5.5 && SMALL_DIGITS[ch]) { g = bitmapGlyph(ch); glyphCache.set(key, g); return g; }
    var size = sizeFor(role, capq), lift = metrics(role).dip * size, ox = F.whole ? 8 : 40, oy = 80;
    if (hiRes(role)) return (glyphCache.set(key, g = hiGlyph(role, size, ch)), g);
    gx.font = fontOf(role, size); gx.textBaseline = 'alphabetic'; gx.textAlign = 'left';
    var adv = gx.measureText(ch).width;
    // only the box this glyph can reach is cleared and read back (a full read of the scratch canvas per glyph was
    // most of the cost of a new line on a slow phone)
    var bx = glyphBox(ox, oy, size), BW = bx[2], BH = bx[3];
    gx.clearRect(bx[0], bx[1], BW, BH); gx.fillStyle = '#fff';
    gx.fillText(ch, ox, oy - lift);
    var d = gx.getImageData(bx[0], bx[1], BW, BH).data, x0 = BW, y0 = BH, x1 = -1, y1 = -1, x, y;
    for (y = 0; y < BH; y++) for (x = 0; x < BW; x++) if (d[(y * BW + x) * 4 + 3] > 6) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) g = { w: 0, h: 0, x: 0, y: 0, a: null, adv: Math.round(adv) };
    else {
      var w = x1 - x0 + 1, h = y1 - y0 + 1, a = new Uint8Array(w * h);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var v = d[((y0 + y) * BW + x0 + x) * 4 + 3]; a[y * w + x] = v > 6 ? v : 0; }
      g = { w: w, h: h, x: x0 + bx[0] - ox, y: y0 + bx[1] - oy, a: a, adv: Math.round(adv) };
    }
    glyphCache.set(key, g);
    return g;
  }
  // the part of the scratch canvas a glyph of this font size drawn at (ox, oy) can reach, with room to spare
  function glyphBox(ox, oy, size) {
    var x0 = Math.max(0, Math.floor(ox - size * .6) - 2), y0 = Math.max(0, Math.floor(oy - size * 1.5) - 2);
    var x1 = Math.min(G.width, Math.ceil(ox + size * 1.8) + 2), y1 = Math.min(G.height, Math.ceil(oy + size * .8) + 2);
    return [x0, y0, x1 - x0, y1 - y0];
  }
  // a glyph drawn at 28 px (SF Pro's Display cut) and box-filtered to `size`, its pen and baseline on whole pixels
  var hiCache = new Map();
  function hiRaster(role, ch) {
    var key = role + '|' + ch, r = hiCache.get(key);
    if (r) return r;
    var ox = 40, oy = 80, bx = glyphBox(ox, oy, HI_PX), BW = bx[2], BH = bx[3];
    gx.font = fontOf(role, HI_PX); gx.textBaseline = 'alphabetic'; gx.textAlign = 'left';
    var adv = gx.measureText(ch).width;
    gx.clearRect(bx[0], bx[1], BW, BH); gx.fillStyle = '#fff'; gx.fillText(ch, ox, oy);
    var d = gx.getImageData(bx[0], bx[1], BW, BH).data, al = new Uint8Array(G.width * G.height), x0 = G.width, y0 = G.height, x1 = -1, y1 = -1;
    for (var y = 0; y < BH; y++) for (var x = 0; x < BW; x++) {
      var v = d[(y * BW + x) * 4 + 3];
      if (!v) continue;
      var X = x + bx[0], Y = y + bx[1];
      al[Y * G.width + X] = v;
      if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
    }
    r = { al: al, x0: x0, y0: y0, x1: x1, y1: y1, adv: adv };
    hiCache.set(key, r);
    return r;
  }
  function hiGlyph(role, size, ch) {
    var S = HI_PX / size, ox = 40, oy = 80, R = hiRaster(role, ch), al = R.al, adv = R.adv / S;
    var x0 = R.x0, y0 = R.y0, x1 = R.x1, y1 = R.y1, GW = G.width;
    if (x1 < 0) return { w: 0, h: 0, x: 0, y: 0, a: null, adv: Math.round(adv) };
    var tx0 = Math.floor((x0 - ox) / S), tx1 = Math.floor((x1 - ox) / S), ty0 = Math.floor((y0 - oy) / S), ty1 = Math.floor((y1 - oy) / S);
    var w = tx1 - tx0 + 1, h = ty1 - ty0 + 1, a = new Uint8Array(w * h), any = false;
    for (var ty = 0; ty < h; ty++) for (var tx = 0; tx < w; tx++) {
      var sx0 = ox + (tx0 + tx) * S, sx1 = sx0 + S, sy0 = oy + (ty0 + ty) * S, sy1 = sy0 + S, sum = 0;
      for (var yy = Math.floor(sy0); yy < Math.ceil(sy1); yy++) {
        var wy = Math.min(sy1, yy + 1) - Math.max(sy0, yy);
        if (wy <= 0 || yy < 0 || yy >= G.height) continue;
        for (var xx = Math.floor(sx0); xx < Math.ceil(sx1); xx++) {
          var wx = Math.min(sx1, xx + 1) - Math.max(sx0, xx);
          if (wx <= 0 || xx < 0 || xx >= GW) continue;
          sum += wx * wy * al[yy * GW + xx];
        }
      }
      var v = Math.round(sum / (S * S));
      a[ty * w + tx] = v > 6 ? v : 0; if (v > 6) any = true;
    }
    if (!any) return { w: 0, h: 0, x: 0, y: 0, a: null, adv: Math.round(adv) };
    return { w: w, h: h, x: tx0, y: ty0, a: a, adv: Math.round(adv) };
  }
  function kernOf(role, capq, a, b) {
    var key = role + '|' + capq + '|' + a + b, k = kernCache.get(key);
    if (k != null) return k;
    var hr = hiRes(role), sz = sizeFor(role, capq), raw = hr ? hiKern.get(role + '|' + a + b) : null;
    // a role drawn from 28 px is measured there once for all its sizes (a lyric line passes a dozen on the wheel)
    if (raw == null) {
      gx.font = fontOf(role, hr ? HI_PX : sz);
      raw = gx.measureText(a + b).width - gx.measureText(a).width - gx.measureText(b).width;
      if (hr) hiKern.set(role + '|' + a + b, raw);
    }
    k = Math.round(raw * (hr ? sz / HI_PX : 1));
    kernCache.set(key, k);
    return k;
  }
  // a laid-out line: glyph spans at whole-pixel pens and the ink box (pen-relative x, baseline-relative y)
  function line(role, cap, str) {
    var capq = q4(cap), key = role + '|' + capq + '|' + str, L = lineCache.get(key);
    if (L) return L;
    var R = ROLES[role], F = FAMS[R.fam], spans = [], pen = 0, prev = null, track = F.tracked && capq <= 6 ? 1 : 0, g;
    if (F.whole) { g = glyphOf(role, capq, str); spans.push({ x: 0, g: g, i: 0 }); pen = g.adv; }
    else for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      g = glyphOf(role, capq, ch);
      if (prev) pen += (g.bitmap || prev.bitmap ? 0 : kernOf(role, capq, str[i - 1], ch)) + track;
      spans.push({ x: pen, g: g, i: i });
      pen += g.adv; prev = g;
    }
    var l = 1e9, r = -1e9, t = 1e9, b = -1e9;
    spans.forEach(function (s) { if (!s.g.w) return; l = Math.min(l, s.x + s.g.x); r = Math.max(r, s.x + s.g.x + s.g.w - 1); t = Math.min(t, s.g.y); b = Math.max(b, s.g.y + s.g.h - 1); });
    var empty = r < l;
    L = { role: role, cap: capq, str: str, spans: spans, adv: pen, empty: empty, l: empty ? 0 : l, r: empty ? -1 : r, t: empty ? 0 : t, b: empty ? -1 : b };
    L.inkW = L.r - L.l + 1; L.inkH = L.b - L.t + 1;
    if (lineCache.size > 1500) lineCache.delete(lineCache.keys().next().value);
    lineCache.set(key, L);
    return L;
  }
  // the room a line takes: its ink, or its advance where that is wider (the firmware's measure)
  function widthOf(L) { return Math.max(L.inkW, L.adv); }
  function capBase(capTop, cap) { return Math.round(capTop) + Math.ceil(q4(cap)); }
  function penLeft(L, x) { return x - L.l; }
  function penRight(L, x) { return x - L.r; }
  function penCentre(L, cx) { return Math.floor(cx - (L.l + L.r) / 2); }
  // the largest of `caps` at which str fits maxW (by ink and advance); null when none does
  function fit(role, caps, str, maxW) {
    for (var i = 0; i < caps.length; i++) { var L = line(role, caps[i], str); if (widthOf(L) <= maxW) return L; }
    return null;
  }
  var inkFaults = [];
  function fault(L, s, x, y) { if (inkFaults.length < 500) inkFaults.push({ str: L.str, ch: L.str[s.i], cap: L.cap, x: x, y: y, w: s.g.w, h: s.g.h }); }
  // Draws a line: pen and baseline in panel pixels. `shade(x, y, i)` may return an alpha (a number), a colour
  // [r, g, b, a?] or null (skip) for each pixel, i being the glyph's index in the string. A glyph that would reach the
  // dark ring is left out whole (and counted): never half a glyph.
  var textLog = null;   // tests: every line drawn this frame, with its ink box in panel pixels
  function drawText(f, L, pen, base, col, alpha, shade) {
    alpha = alpha == null ? 1 : alpha;
    if (textLog && !L.empty) textLog.push({ str: L.str, x0: pen + L.l, x1: pen + L.r, y0: base + L.t, y1: base + L.b });
    for (var k = 0; k < L.spans.length; k++) {
      var s = L.spans[k], g = s.g;
      if (!g.w) continue;
      var gx0 = pen + s.x + g.x, gy0 = base + g.y;
      if (gx0 < 1 || gy0 < 1 || gx0 + g.w > W - 1 || gy0 + g.h > H - 1) { fault(L, s, gx0, gy0); continue; }
      for (var yy = 0; yy < g.h; yy++) for (var xx = 0; xx < g.w; xx++) {
        var av = g.a[yy * g.w + xx];
        if (!av) continue;
        var X = gx0 + xx, Y = gy0 + yy, a = alpha * av / 255, c = col;
        if (shade) {
          var sh = shade(X, Y, s.i);
          if (sh == null) continue;
          if (typeof sh === 'number') a *= sh; else { c = sh; if (sh[3] != null) a *= sh[3]; }
        }
        f.blend(X, Y, c, a);
      }
    }
  }
  // a dark ring under a line's glyphs: light text that reads over any sky (Big weather's temperature)
  function haloText(f, L, pen, base, a) {
    for (var k = 0; k < L.spans.length; k++) {
      var s = L.spans[k], g = s.g;
      if (!g.w) continue;
      for (var yy = 0; yy < g.h; yy++) for (var xx = 0; xx < g.w; xx++) {
        var cov = g.a[yy * g.w + xx] / 255;
        if (!cov) continue;
        var X = pen + s.x + g.x + xx, Y = base + g.y + yy;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) if (dx || dy) f.blend(X + dx, Y + dy, BLACK, a * cov * (dx && dy ? .5 : 1));
      }
    }
  }
  // a clock in cells: each glyph's ink centred in its cell, so the digits never shuffle as the minutes change
  function drawTab(f, role, cap, cellD, cellC, x, base, str, col, alpha, shade) {
    var cx = x;
    for (var i = 0; i < str.length; i++) {
      var ch = str[i], cw = ch === ':' ? cellC : cellD, L = line(role, cap, ch);
      if (!L.empty) drawText(f, L, cx + Math.floor((cw - L.inkW) / 2) - L.l, base, col, alpha, shade ? shade(i) : null);
      cx += cw;
    }
    return cx - x;
  }
  function tabWidth(cellD, cellC, str) { var w = 0; for (var i = 0; i < str.length; i++) w += str[i] === ':' ? cellC : cellD; return w; }
  // cells for a clock in a role and cap: the widest digit's ink and a column, the colon's ink and a column each side
  function cellsFor(role, cap) {
    var d = 0;
    for (var i = 0; i < 10; i++) d = Math.max(d, line(role, cap, String(i)).inkW);
    var gap = Math.max(1, Math.round(cap / 10));
    return { d: d + gap, c: line(role, cap, ':').inkW + 2 * gap };
  }
  // the ink box a tabular string takes, relative to its first cell's left edge
  function tabInk(role, cap, cellD, cellC, str) {
    var cx = 0, l = 1e9, r = -1e9;
    for (var i = 0; i < str.length; i++) {
      var cw = str[i] === ':' ? cellC : cellD, L = line(role, cap, str[i]);
      if (!L.empty) { var x0 = cx + Math.floor((cw - L.inkW) / 2); l = Math.min(l, x0); r = Math.max(r, x0 + L.inkW - 1); }
      cx += cw;
    }
    return { l: l, r: r };
  }

  /* ---------- the time ---------- */
  var nowFn = function () { return new Date(); };
  function now() { return nowFn(); }
  function use12h() { try { return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12 !== false; } catch (e) { return true; } }
  var H12 = use12h();
  var DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  var MONS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  function two(n) { return (n < 10 ? '0' : '') + n; }
  function clockText(d) { var h = d.getHours(); return (H12 ? String((h + 11) % 12 + 1) : two(h)) + ':' + two(d.getMinutes()); }
  function dayMinOf(d) { return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; }

  /* ---------- live weather: MET Norway (CC BY 4.0, credited on the page), no key, location guessed from the time zone (no prompt) ---------- */
  var TZ_CITY = {
    'America/New_York': [40.71, -74.01], 'America/Detroit': [42.33, -83.05], 'America/Toronto': [43.65, -79.38],
    'America/Chicago': [41.88, -87.63], 'America/Denver': [39.74, -104.99], 'America/Phoenix': [33.45, -112.07],
    'America/Los_Angeles': [34.05, -118.24], 'America/Vancouver': [49.28, -123.12], 'America/Anchorage': [61.22, -149.9],
    'Pacific/Honolulu': [21.31, -157.86], 'America/Mexico_City': [19.43, -99.13], 'America/Sao_Paulo': [-23.55, -46.63],
    'America/Bogota': [4.71, -74.07], 'America/Argentina/Buenos_Aires': [-34.6, -58.38], 'Europe/London': [51.51, -0.13],
    'Europe/Dublin': [53.35, -6.26], 'Europe/Paris': [48.86, 2.35], 'Europe/Berlin': [52.52, 13.4], 'Europe/Madrid': [40.42, -3.7],
    'Europe/Rome': [41.9, 12.5], 'Europe/Amsterdam': [52.37, 4.9], 'Europe/Stockholm': [59.33, 18.07], 'Europe/Zurich': [47.38, 8.54],
    'Europe/Istanbul': [41.01, 28.98], 'Europe/Moscow': [55.76, 37.62], 'Africa/Cairo': [30.04, 31.24], 'Africa/Lagos': [6.52, 3.38],
    'Africa/Nairobi': [-1.29, 36.82], 'Africa/Johannesburg': [-26.2, 28.05], 'Asia/Dubai': [25.2, 55.27],
    'Asia/Kolkata': [28.61, 77.21], 'Asia/Calcutta': [28.61, 77.21], 'Asia/Karachi': [24.86, 67.0], 'Asia/Dhaka': [23.81, 90.41],
    'Asia/Bangkok': [13.76, 100.5], 'Asia/Jakarta': [-6.2, 106.85], 'Asia/Singapore': [1.35, 103.82], 'Asia/Manila': [14.6, 120.98],
    'Asia/Hong_Kong': [22.32, 114.17], 'Asia/Shanghai': [31.23, 121.47], 'Asia/Seoul': [37.57, 126.98], 'Asia/Tokyo': [35.68, 139.69],
    'Australia/Sydney': [-33.87, 151.21], 'Australia/Melbourne': [-37.81, 144.96], 'Australia/Perth': [-31.95, 115.86],
    'Pacific/Auckland': [-36.85, 174.76], 'America/Indianapolis': [39.77, -86.16], 'America/Indiana/Indianapolis': [39.77, -86.16],
    'America/Kentucky/Louisville': [38.25, -85.76], 'America/Halifax': [44.65, -63.58], 'America/Edmonton': [53.55, -113.49],
    'America/Winnipeg': [49.9, -97.14], 'America/Boise': [43.62, -116.2], 'America/Santiago': [-33.45, -70.67],
    'America/Lima': [-12.05, -77.04], 'Europe/Lisbon': [38.72, -9.14], 'Europe/Warsaw': [52.23, 21.01], 'Europe/Athens': [37.98, 23.73],
    'Europe/Helsinki': [60.17, 24.94], 'Europe/Oslo': [59.91, 10.75], 'Europe/Copenhagen': [55.68, 12.57], 'Europe/Brussels': [50.85, 4.35],
    'Europe/Vienna': [48.21, 16.37], 'Europe/Prague': [50.08, 14.44], 'Asia/Taipei': [25.03, 121.57], 'Asia/Kathmandu': [27.72, 85.32],
    'Asia/Riyadh': [24.71, 46.68], 'Asia/Tehran': [35.69, 51.39], 'Australia/Brisbane': [-27.47, 153.03]
  };
  var TZ = ''; try { TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* none */ }
  // the southern hemisphere: the city's latitude, else the zones south of the equator
  var HOME = TZ_CITY[TZ], SOUTH = HOME ? HOME[0] < 0 : new RegExp('^(Australia|Antarctica|NZ|Brazil|Chile' +
    '|Pacific/(Auckland|Chatham|Fiji|Tongatapu|Apia|Samoa|Pago_Pago|Efate|Noumea|Port_Moresby|Bougainville|Guadalcanal|Norfolk|Rarotonga|Tahiti|Marquesas|Gambier|Pitcairn|Easter|Galapagos|Wallis|Fakaofo|Funafuti|Niue|Nauru|Kanton|Enderbury)' +
    '|America/(Sao_Paulo|Argentina|Buenos_Aires|Cordoba|Mendoza|Catamarca|Jujuy|Rosario|Santiago|Punta_Arenas|Montevideo|Asuncion|La_Paz|Lima|Guayaquil|Bahia|Belem|Fortaleza|Recife|Maceio|Araguaina|Cuiaba|Campo_Grande|Porto_Velho|Porto_Acre|Rio_Branco|Eirunepe|Manaus|Noronha|Santarem)' +
    '|Africa/(Johannesburg|Maputo|Harare|Lusaka|Lubumbashi|Windhoek|Gaborone|Maseru|Mbabane|Blantyre|Luanda|Kinshasa|Brazzaville|Dar_es_Salaam|Nairobi|Kigali|Bujumbura)' +
    '|Indian/(Antananarivo|Mauritius|Reunion|Mayotte|Comoro|Mahe|Chagos|Kerguelen|Cocos|Christmas)|Asia/(Jakarta|Makassar|Ujung_Pandang|Jayapura|Dili)' +
    '|Atlantic/(St_Helena|South_Georgia|Stanley))\\b').test(TZ);
  var FAHR = /^(en-US|en-LR|my)/.test(navigator.language || '') || /^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit|Indiana|Kentucky|Boise)|^Pacific\/Honolulu/.test(TZ);
  // approximate sunrise and sunset (local minutes) from the time zone's offset, its city's latitude (else 40 degrees)
  // and today's date until the real ones arrive; 06:30 and 18:30 when unknown
  var SUN = (function () {
    try {
      var d = new Date(), doy = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
      var dst = Math.max(new Date(d.getFullYear(), 0, 1).getTimezoneOffset(), new Date(d.getFullYear(), 6, 1).getTimezoneOffset()) !== d.getTimezoneOffset() ? 1 : 0;
      var lat = HOME ? HOME[0] : 40 * (SOUTH ? -1 : 1), decl = 23.44 * Math.sin((2 * Math.PI / 365) * (doy - 81)) * Math.PI / 180, la = lat * Math.PI / 180;
      var ha = Math.acos(clamp(-Math.tan(la) * Math.tan(decl), -1, 1)) * 12 / Math.PI, noon = 12 + dst;
      return [Math.round((noon - ha) * 60), Math.round((noon + ha) * 60)];
    } catch (e) { return [390, 1110]; }
  })();
  // One small request for the visitor's area (their time zone's city, else Indianapolis), after the page has loaded
  // and gone idle, never blocking, and one for that city's sunrise and sunset; kept in this browser until MET's
  // forecast expires (30 minutes at least) and the sun's for the day. A failed fetch leaves the fixed sample.
  var WX = null, wxAsked = false, WX_KEY = 'moo-met', WX_TTL = 30 * 60 * 1000;
  // MET's symbol (its _day, _night or _polartwilight cut off) as the WMO code the faces are drawn for
  function wmoOf(sym) {
    var s = String(sym || '').replace(/_(day|night|polartwilight)$/, ''), heavy = /^heavy/.test(s), light = /^light/.test(s), showers = /showers/.test(s);
    if (/thunder/.test(s)) return 95;
    if (/snow/.test(s)) return showers ? (heavy ? 86 : 85) : heavy ? 75 : light ? 71 : 73;
    if (/sleet/.test(s)) return heavy ? 67 : light ? 56 : 57;
    if (/rain/.test(s)) return showers ? (heavy ? 82 : light ? 80 : 81) : heavy ? 65 : light ? 61 : 63;
    var c = { clearsky: 0, fair: 1, partlycloudy: 2, cloudy: 3, fog: 45 }[s];
    return c == null ? 3 : c;
  }
  function dayKey(d) { return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()); }
  function offsetOf(d) { var o = -d.getTimezoneOffset(), a = Math.abs(o); return (o < 0 ? '-' : '+') + two(Math.floor(a / 60)) + ':' + two(a % 60); }
  function minsOf(iso) { var m = /T(\d+):(\d+)/.exec(iso || ''); return m ? +m[1] * 60 + +m[2] : null; }
  function takeWeather(kept) {
    if (kept.now) WX = kept.now;
    // today's real sunrise and sunset (local clock times) drive the phase, the sky's colours and the arc
    if (kept.sun && kept.sun.set > kept.sun.rise) { SUN[0] = kept.sun.rise; SUN[1] = kept.sun.set; }
  }
  function askWeather() {
    if (wxAsked) return; wxAsked = true;
    var c = HOME || TZ_CITY['America/Indiana/Indianapolis'], key = c.join(',') + (FAHR ? 'F' : 'C'), today = dayKey(new Date()), kept = null;
    try { kept = JSON.parse(localStorage.getItem(WX_KEY) || 'null'); } catch (e) { /* no storage */ }
    if (!kept || kept.key !== key) kept = { key: key };
    // only what is still good goes on the board: an old forecast or another day's sun is dropped
    if (!(Date.now() < kept.until)) delete kept.now;
    // the sun only for the visitor's own city: the sample city's times would be wrong on their clock
    if (!HOME || !kept.sun || kept.sun.day !== today) delete kept.sun;
    takeWeather(kept);
    var wxFresh = !!kept.now, sunFresh = !HOME || !!kept.sun;
    if ((wxFresh && sunFresh) || !window.fetch) return;
    var api = 'https://api.met.no/weatherapi/', at = '?lat=' + c[0] + '&lon=' + c[1];
    var keep = function () { takeWeather(kept); restill(); try { localStorage.setItem(WX_KEY, JSON.stringify(kept)); } catch (e) { /* no storage */ } };
    var go = function () {
      if (!wxFresh) fetch(api + 'locationforecast/2.0/compact' + at)
        .then(function (r) { return r.ok ? r.json().then(function (j) { return { j: j, until: Date.parse(r.headers.get('Expires') || '') }; }) : null; })
        .then(function (res) {
          var ts = res && res.j && res.j.properties && res.j.properties.timeseries, d = ts && ts[0] && ts[0].data;
          var inst = d && d.instant && d.instant.details, next = d && (d.next_1_hours || d.next_6_hours);
          if (!inst || typeof inst.air_temperature !== 'number' || !next || !next.summary) return;
          // MET gives degrees Celsius and meters a second, the faces want the visitor's degrees and km/h
          kept.now = { temp: Math.round(FAHR ? inst.air_temperature * 9 / 5 + 32 : inst.air_temperature), code: wmoOf(next.summary.symbol_code), wind: (inst.wind_speed || 0) * 3.6 };
          kept.until = Math.max(Date.now() + WX_TTL, res.until || 0);
          keep();
        })
        .catch(function () { /* the fixed sample stays */ });
      if (!sunFresh) fetch(api + 'sunrise/3.0/sun' + at + '&date=' + today + '&offset=' + encodeURIComponent(offsetOf(new Date())))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var p = j && j.properties, rise = minsOf(p && p.sunrise && p.sunrise.time), set = minsOf(p && p.sunset && p.sunset.time);
          if (rise == null || set == null) return;
          kept.sun = { day: today, rise: rise, set: set };
          keep();
        })
        .catch(function () { /* the estimate stays */ });
    };
    var idle = function () { if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 2000 }); else setTimeout(go, 200); };
    if (document.readyState === 'complete') idle(); else addEventListener('load', idle);
  }
  // pw::weather: a WMO code's look in still air, and with wind
  function calmLook(code) {
    switch (code) {
      case 0: return 'clear'; case 1: return 'mainly'; case 2: return 'partly'; case 3: return 'overcast';
      case 45: case 48: return 'fog';
      case 51: case 53: case 55: return 'drizzle';
      case 56: case 57: return 'fdrizzle';
      case 61: case 63: case 80: case 81: return 'rain';
      case 65: case 82: return 'hrain';
      case 66: case 67: return 'frain';
      case 71: case 73: case 85: return 'snow';
      case 75: case 86: return 'hsnow';
      case 77: return 'grains';
      case 95: return 'thunder';
      case 96: case 99: return 'hail';
    }
    return 'overcast';
  }
  function lookFor(code, wind) {
    var l = calmLook(code);
    if (!(wind >= 30)) return l;
    return l === 'clear' || l === 'mainly' || l === 'partly' ? 'windy' : l === 'overcast' ? 'wcloudy' : l;
  }
  var WORDS = { 0: 'CLEAR', 1: 'CLEAR', 2: 'PT CLOUDY', 3: 'OVERCAST', 45: 'FOG', 48: 'FOG', 51: 'DRIZZLE', 53: 'DRIZZLE', 55: 'DRIZZLE',
    56: 'FRZ DRZL', 57: 'FRZ DRZL', 61: 'RAIN', 63: 'RAIN', 65: 'HVY RAIN', 66: 'FRZ RAIN', 67: 'FRZ RAIN', 71: 'SNOW', 73: 'SNOW', 77: 'SNOW',
    75: 'HVY SNOW', 80: 'SHOWERS', 81: 'SHOWERS', 82: 'DOWNPOUR', 85: 'FLURRIES', 86: 'HVY SNOW', 95: 'STORMS', 96: 'HAIL', 99: 'HAIL' };
  var COMPACT = { 2: 'PARTLY', 3: 'CLOUDY', 56: 'SLEET', 57: 'SLEET', 66: 'ICY RAIN', 67: 'ICY RAIN', 65: 'POURING', 82: 'POURING',
    75: 'HEAVY', 86: 'HEAVY', 80: 'SHOWER', 81: 'SHOWER', 85: 'FLURRY' };
  function shortWord(code, look) { return look === 'windy' || look === 'wcloudy' ? 'WINDY' : WORDS[code] || 'CLOUDY'; }
  function compactWord(code, look) { return look === 'windy' || look === 'wcloudy' ? 'WINDY' : COMPACT[code] || WORDS[code] || 'CLOUDY'; }
  // the phase: dusk within 30 minutes of sunrise or sunset (pw::weather::phaseAt)
  function phaseAt(dm) {
    if (Math.abs(dm - SUN[0]) <= 30 || Math.abs(dm - SUN[1]) <= 30) return 'dusk';
    return dm > SUN[0] + 30 && dm < SUN[1] - 30 ? 'day' : 'night';
  }
  // how much of the day's, dusk's and night's colours the sky wears (pw::skyTimeAt)
  function skyTimeAt(dm) {
    var rise = SUN[0], set = SUN[1], E = 30, D = 1440;
    var from = function (e) { var d = (dm - e) % D; if (d > D / 2) d -= D; if (d < -D / 2) d += D; return d; };
    var r = from(rise), s = from(set), u;
    if (Math.abs(r) <= E) { u = smooth(0, 1, Math.abs(r) / E); return { dusk: 1 - u, day: r > 0 ? u : 0, night: r > 0 ? 0 : u }; }
    if (Math.abs(s) <= E) { u = smooth(0, 1, Math.abs(s) / E); return { dusk: 1 - u, day: s < 0 ? u : 0, night: s < 0 ? 0 : u }; }
    var up = dm > rise && dm < set;
    return { day: up ? 1 : 0, dusk: 0, night: up ? 0 : 1 };
  }
  // where the sun or the moon is on its arc (pw::orbArcAt)
  function orbArcAt(dm) {
    var rise = SUN[0], set = SUN[1];
    if (dm >= rise && dm < set) return { sun: true, f: c01((dm - rise) / (set - rise)) };
    var since = dm >= set ? dm - set : dm + 1440 - set;
    return { sun: false, f: c01(since / (1440 - set + rise)) };
  }
  // the moon's phase as the firmware works it everywhere (clock/Astro.cpp, Meeus: fcMoonPhase with the faces below)
  function moonPhase(ms) { return fcMoonPhase(ms); }
  var CLOCK_COL = { day: hexc('#F2F4FA'), dusk: hexc('#FFE8D2'), night: hexc('#A8B4CC') };
  function clockColorAt(t) { return t.night > 0 ? mix(CLOCK_COL.night, CLOCK_COL.dusk, t.dusk) : mix(CLOCK_COL.day, CLOCK_COL.dusk, t.dusk); }
  function conditionAccent(look, phase) {
    switch (look) {
      case 'clear': case 'mainly': return phase === 'night' ? [255, 255, 255] : [255, 199, 0];
      case 'drizzle': case 'rain': case 'hrain': return [60, 130, 220];
      case 'fdrizzle': case 'frain': return [120, 212, 240];
      case 'snow': case 'hsnow': case 'grains': return [170, 205, 235];
      case 'thunder': case 'hail': return [118, 110, 190];
      case 'windy': case 'wcloudy': return [120, 200, 160];
    }
    return [150, 158, 170];
  }
  // what the weather faces show now: live data, else a mild clear sample
  function weatherNow(d, forced) {
    askWeather();
    var dm = dayMinOf(d), code = forced ? forced.code : WX ? WX.code : 0, wind = forced ? 0 : WX ? WX.wind : 0;
    var temp = forced ? forced.temp : WX ? WX.temp : (FAHR ? 72 : 22), look = lookFor(code, wind);
    return { look: look, code: code, phase: phaseAt(dm), sky: skyTimeAt(dm), arc: orbArcAt(dm), temp: temp + '°',
      opts: { moonPhase: moonPhase(d.getTime()), southern: SOUTH, moonAtNight: true, lightning: !REDUCED } };
  }

  /* ---------- sky palettes (pw::skyPalette, the weather redesign of 2026-09-29) ---------- */
  function palBase() {
    var h = hexc, d = {
      zenith: h('2270C4'), horizon: h('5476D4'), cloudHi: h('F4F6FA'), cloudLo: h('C2CAD6'), rim: h('FFFFFF'), star: h('FFFFFF'),
      orbGlow: h('FFE9A8'), mist: h('F4F9FF'), leafA: h('F0A83C'), leafB: h('E6CE4E'), deckHi: h('7C8898'), deckLo: h('6C788A'),
      precip: h('A9D2FF'), precip2: h('D6EAFF'), ground: h('E9EEF6'), flashDeck: h('C4C8EE'), bolt: h('FFF6D8')
    }, n = {
      zenith: h('060C36'), horizon: h('101A4A'), cloudHi: h('4E5A74'), cloudLo: h('404C66'), rim: h('96A4C4'), star: h('DDE6FF'),
      orbGlow: h('9FB6E8'), mist: h('8EA6CF'), leafA: h('E09A3C'), leafB: h('D8C050'), deckHi: h('3A4658'), deckLo: h('343C50'),
      precip: h('86B8F4'), precip2: h('B4D2F8'), ground: h('7F8BA4'), flashDeck: h('7E88BC'), bolt: h('FFF3C8')
    };
    [d, n].forEach(function (p) { p.layerHi = [p.cloudHi, p.cloudHi, p.cloudHi]; p.layerLo = [p.cloudLo, p.cloudLo, p.cloudLo]; });
    return [d, n];
  }
  function palForLook(look, d, n) {
    var h = hexc;
    switch (look) {
      case 'overcast': case 'wcloudy':
        d.zenith = h('505868'); d.horizon = h('585C70');
        d.layerHi = [h('7A889A'), h('9EAABA'), h('CAD2DE')]; d.layerLo = [h('6C7890'), h('8E9AAC'), h('BAC2D0')]; d.rim = h('F0F3F8'); d.mist = h('EEF2F8');
        n.zenith = h('080C18'); n.horizon = h('0E1420');
        n.layerHi = [h('2C3248'), h('40485C'), h('5A6880')]; n.layerLo = [h('262C40'), h('383E52'), h('505E76')]; n.rim = h('7E8BAA');
        break;
      case 'fog':
        d.zenith = h('606C78'); d.horizon = h('6A7682'); d.mist = h('E8ECF0'); d.orbGlow = h('FFF6DC');
        n.zenith = h('283440'); n.horizon = h('2E3A46'); n.mist = h('9CA8C0');
        break;
      case 'drizzle':
        d.zenith = h('4C5668'); d.horizon = h('545C70'); d.deckHi = h('A2AAB8'); d.deckLo = h('929AAA'); d.precip = h('BCD9F8');
        n.zenith = h('080C18'); n.horizon = h('0E1624'); n.precip = h('93B6E4');
        break;
      case 'fdrizzle': case 'frain':
        d.zenith = h('3A4A5A'); d.horizon = h('465664'); d.deckHi = h('7E8C9E'); d.deckLo = h('6E7C8E'); d.precip = h('C8F4FF'); d.precip2 = h('FFFFFF'); d.ground = h('BDEBFF');
        n.zenith = h('080E1A'); n.horizon = h('0E1826'); n.deckHi = h('3A4658'); n.deckLo = h('343C50'); n.precip = h('A8E8FF'); n.precip2 = h('E8FAFF'); n.ground = h('6FA0B8');
        break;
      case 'rain':
        d.zenith = h('3E4A5A'); d.horizon = h('4A5664'); n.zenith = h('080C18'); n.horizon = h('0E1624');
        break;
      case 'hrain':
        d.zenith = h('343A4A'); d.horizon = h('3A4252'); d.deckHi = h('606A7A'); d.deckLo = h('545E6E'); d.precip = h('B4D8FF'); d.mist = h('B4C4D8');
        n.zenith = h('060A14'); n.horizon = h('0C1220'); n.deckHi = h('363E52'); n.deckLo = h('33384A'); n.precip = h('90C0FA'); n.mist = h('4A5A78');
        break;
      case 'snow': case 'hsnow': case 'grains':
        d.zenith = h('5C6E84'); d.horizon = h('667690'); d.deckHi = h('C4CEDA'); d.deckLo = h('B6C2D0'); d.precip = look === 'grains' ? h('E4ECF8') : h('FFFFFF'); d.ground = h('E9EEF6');
        n.zenith = h('0A1020'); n.horizon = h('12182E'); n.deckHi = h('485468'); n.deckLo = h('3A4458'); n.precip = h('F0F4FF'); n.ground = h('7F8BA4');
        break;
      case 'thunder': case 'hail':
        var hail = look === 'hail';
        d.zenith = h('1E222E'); d.horizon = h('262A2E'); d.deckHi = h('545C6E'); d.deckLo = h('485060'); d.precip = hail ? h('F4F8FF') : h('A0C4F0'); d.precip2 = hail ? h('B8C6D8') : h('C8DCF4');
        n.zenith = h('04060C'); n.horizon = h('0A0E18'); n.deckHi = h('383E50'); n.deckLo = h('34384A'); n.precip = hail ? h('E6EEFF') : h('7FA8DC'); n.precip2 = hail ? h('8A98B4') : h('A4C0E4');
        break;
    }
  }
  function hasOrb(look) { return look === 'clear' || look === 'mainly' || look === 'partly' || look === 'windy' || look === 'fog'; }
  function skyPalette(look, phase) {
    var b = palBase(), d = b[0], n = b[1];
    palForLook(look, d, n);
    if (phase === 'day') return d;
    if (phase === 'night') return n;
    var k = n; k.orbGlow = hexc('FF9A50'); k.rim = hexc('FFC8A0');
    if (hasOrb(look) && look !== 'fog') { k.zenith = hexc('3C3868'); k.horizon = hexc('C25A40'); k.cloudHi = hexc('D89A8C'); k.cloudLo = hexc('6A506C'); k.mist = hexc('FFE2C8'); }
    else k.horizon = mix(k.horizon, hexc('683A40'), .37);
    return k;
  }
  function lerpPal(a, b, t) {
    var o = {};
    for (var key in a) {
      if (key === 'layerHi' || key === 'layerLo') o[key] = [mix(a[key][0], b[key][0], t), mix(a[key][1], b[key][1], t), mix(a[key][2], b[key][2], t)];
      else o[key] = mix(a[key], b[key], t);
    }
    return o;
  }

  /* ---------- the sky (a port of pw::SoftSky): gradient, stars, sun or moon, clouds, deck, rain or snow ---------- */
  var GLIDE = .9, PHASE_SEC = 2.4, ORB_R = 4.6;
  function Sky(w, orbX, orbY, seed) {
    this.w = w; this.orbX = orbX; this.orbY = orbY; this.r = rng(seed || 7); this.t = 0; this.built = false;
    this.cur = { cover: 0, deck: 0, precip: 0, fog: 0, wind: 0, orb: 0, night: 0 }; this.target = this.cur;
    this.palT = 1; this.timeSet = false; this.time = { day: 1, dusk: 0, night: 0 }; this.phase = 'day'; this.prevPhase = 'day';
    this.fall = 'none'; this.stormy = false; this.flashAt = -100; this.nextFlash = 0; this.boltX = [];
    this.arcSet = false; this.arcSun = true; this.arcF = .5; this.arcSnap = true; this.keep = null;
    this.opts = { moonPhase: .5, southern: false, moonAtNight: true, lightning: true };
    this.drops = [];
    for (var i = 0; i < 72; i++) this.drops.push({ live: false, x: 0, y: 0, vx: 0, vy: 0, sway: 0, swayPhase: 0, size: 1, alpha: 1, splashT: 9, splashX: 0, bounced: false });
  }
  Sky.prototype.targetFor = function (look, phase) {
    var p = { cover: 0, deck: 0, precip: 0, fog: 0, wind: 0, orb: 0, night: phase === 'night' ? 1 : phase === 'dusk' ? .35 : 0 };
    switch (look) {
      case 'clear': p.orb = 1; break;
      case 'mainly': p.orb = 1; p.cover = .3; break;
      case 'partly': p.orb = 1; p.cover = .65; break;
      case 'overcast': p.cover = 1; p.deck = .75; break;
      case 'fog': p.orb = .55; p.cover = .2; p.fog = 1; break;
      case 'drizzle': case 'fdrizzle': p.cover = .5; p.deck = .8; p.precip = .45; break;
      case 'rain': case 'frain': p.cover = .6; p.deck = 1; p.precip = .65; break;
      case 'hrain': p.cover = .8; p.deck = 1; p.precip = 1; break;
      case 'snow': p.cover = .5; p.deck = .7; p.precip = .6; break;
      case 'hsnow': p.cover = .7; p.deck = .9; p.precip = 1; p.wind = .3; break;
      case 'grains': p.cover = .5; p.deck = .7; p.precip = .55; break;
      case 'thunder': p.cover = .9; p.deck = 1; p.precip = .7; break;
      case 'hail': p.cover = .9; p.deck = 1; p.precip = .6; break;
      case 'windy': p.orb = 1; p.cover = .35; p.wind = 1; break;
      case 'wcloudy': p.cover = 1; p.deck = .6; p.wind = 1; break;
    }
    return p;
  };
  Sky.prototype.setTarget = function (look, phase, opts, immediate) {
    this.opts = opts || this.opts;
    var first = !this.built;
    if (!first && look === this.look && phase === this.phase && !immediate) return;
    var wasStormy = !first && (this.look === 'thunder' || this.look === 'hail');
    this.fall = { drizzle: 'drizzle', fdrizzle: 'drizzle', rain: 'rain', frain: 'rain', thunder: 'rain', hrain: 'heavy', snow: 'snow', hsnow: 'hsnow', grains: 'grains', hail: 'hail' }[look] || 'none';
    this.icy = look === 'fdrizzle' || look === 'frain';
    this.snowGround = look === 'snow' || look === 'hsnow' || look === 'grains';
    this.stormy = look === 'thunder' || look === 'hail';
    if (this.stormy && (!wasStormy || immediate)) this.nextFlash = this.t + 1.5;
    var lookChanged = first || look !== this.look;
    if (lookChanged) { this.palDay = skyPalette(look, 'day'); this.palDusk = skyPalette(look, 'dusk'); this.palNight = skyPalette(look, 'night'); }
    var to = skyPalette(look, phase);
    if (this.timeSet && !(first || immediate)) { if (lookChanged) { this.palFrom = this.pal; this.palT = 0; } }
    else if (first || immediate) { this.pal = this.palFrom = this.palTo = to; this.palT = 1; }
    else { this.palFrom = this.pal; this.palTo = to; this.palT = 0; }
    this.prevPhase = first || immediate ? phase : this.phase;
    this.look = look; this.phase = phase;
    this.target = this.targetFor(look, phase);
    if (first || immediate) {
      this.arcSnap = true;
      this.cur = Object.assign({}, this.target);
      this.drops.forEach(function (d) { d.live = false; });
      for (var i = 0, n = this.active(); i < n; i++) this.spawn(this.drops[i], true);
    }
    this.built = true;
  };
  Sky.prototype.timePalette = function () { var t = this.time; return t.night > 0 ? lerpPal(this.palNight, this.palDusk, t.dusk) : lerpPal(this.palDay, this.palDusk, t.dusk); };
  Sky.prototype.setSkyTime = function (t) {
    this.timeSet = true; this.time = t;
    this.target.night = t.night + .35 * t.dusk;
    if (this.arcSnap) this.cur.night = this.target.night;
    if (this.palT >= 1) this.pal = this.timePalette();
  };
  Sky.prototype.active = function () {
    var most = { none: 0, drizzle: 20, rain: 30, heavy: 48, snow: 26, hsnow: 44, grains: 28, hail: 16 }[this.fall];
    return Math.min(72, Math.round(most * this.w / 48 * c01(this.cur.precip)));
  };
  Sky.prototype.deckUnder = function (x) {
    if (this.cur.deck <= .01) return 0;
    var t = this.t % (2000 * Math.PI), base = 2.5 + 4 * this.cur.deck;
    return base + 1.1 * Math.sin(.31 * x + .45 * t) + .8 * Math.sin(.13 * x - .21 * t + 1.7);
  };
  Sky.prototype.spawn = function (d, initial) {
    var r = this.r, wind = -8 * this.cur.wind;
    d.live = true; d.bounced = false; d.splashT = 9; d.x = r.range(-2, this.w + 2);
    switch (this.fall) {
      case 'drizzle': d.vy = r.range(17, 23); d.vx = -2 + wind; d.size = 1.3; d.alpha = r.range(.4, .6); break;
      case 'rain': d.vy = r.range(32, 42); d.vx = -4 + wind; d.size = 2.6; d.alpha = r.range(.5, .8); break;
      case 'heavy': d.vy = r.range(46, 58); d.vx = -9 + wind; d.size = 3.8; d.alpha = r.range(.55, .85); break;
      case 'snow': d.vy = r.range(4.5, 7.5); d.vx = wind; d.size = r.range(.9, 1.4); d.alpha = r.range(.7, 1); break;
      case 'hsnow': d.vy = r.range(8, 12); d.vx = -5 + wind; d.size = r.range(.9, 1.5); d.alpha = r.range(.7, 1); break;
      case 'grains': d.vy = r.range(11, 15); d.vx = wind * .5; d.size = .8; d.alpha = r.range(.55, .85); break;
      case 'hail': d.vy = r.range(30, 36); d.vx = -2 + wind; d.size = 1; d.alpha = 1; break;
      default: d.live = false; return;
    }
    d.sway = this.fall === 'snow' || this.fall === 'hsnow' ? r.range(.6, 1.4) : 0;
    d.swayPhase = r();
    var under = this.deckUnder(d.x);
    d.y = initial ? r.range(under, 31) : under - r.range(.5, 6);
  };
  Sky.prototype.startFlash = function () {
    var r = this.r;
    this.flashAt = this.t; this.flashDouble = r() < .5; this.flashBolt = r() < .75;
    var x = r.range(this.w * .2, this.w * .8);
    this.boltX = [];
    for (var i = 0; i < 6; i++) { this.boltX.push(clamp(x, 2, this.w - 3)); x += r.range(-2.2, 2.2); }
    this.boltBottom = r.range(22, 30);
  };
  Sky.prototype.update = function (dt) {
    if (!(dt > 0) || !this.built) return;
    dt = Math.min(dt, .25); this.t += dt;
    var c = this.cur, g = this.target;
    if (this.arcSet) { this.orbCx = approach(this.orbCx, this.orbTx, dt, .35); this.orbCy = approach(this.orbCy, this.orbTy, dt, .35); }
    ['cover', 'deck', 'precip', 'fog', 'wind', 'orb', 'night'].forEach(function (k) { c[k] = approach(c[k], g[k], dt, GLIDE); });
    if (this.timeSet) {
      if (this.palT < 1) this.palT = Math.min(1, this.palT + dt / PHASE_SEC);
      this.pal = this.palT < 1 ? lerpPal(this.palFrom, this.timePalette(), smooth(0, 1, this.palT)) : this.timePalette();
    } else if (this.palT < 1) {
      this.palT = Math.min(1, this.palT + dt / PHASE_SEC);
      this.pal = lerpPal(this.palFrom, this.palTo, smooth(0, 1, this.palT));
    }
    var active = this.active(), ground = this.snowGround ? 30 : 31;
    for (var i = 0; i < 72; i++) {
      var d = this.drops[i];
      if (d.splashT < 1) d.splashT += dt;
      if (!d.live) { if (i < active) this.spawn(d, false); continue; }
      if (this.fall === 'hail' && d.bounced) d.vy += 160 * dt;
      d.y += d.vy * dt; d.x += d.vx * dt;
      if (d.sway > 0) d.swayPhase = cyc(d.swayPhase + dt / 3.2, 1);
      if (d.x < -4) d.x += this.w + 8;
      if (d.x > this.w + 4) d.x -= this.w + 8;
      if (this.fall === 'hail' && !d.bounced && d.y >= 29.5) { d.y = 29.5; d.vy = -this.r.range(18, 24); d.bounced = true; continue; }
      if (d.y >= ground + (this.fall === 'hail' ? .5 : 0)) {
        if (this.fall === 'rain' || this.fall === 'heavy' || this.fall === 'drizzle') { d.splashT = 0; d.splashX = d.x; }
        d.live = false;
        if (i < active) this.spawn(d, false);
      }
    }
    if (this.stormy && this.t >= this.nextFlash) { this.startFlash(); this.nextFlash = this.t + this.r.range(7, 14); }
  };
  Sky.prototype.flashLevel = function () {
    if (!this.stormy || !this.opts.lightning) return 0;
    var pulse = function (x) { return x < 0 ? 0 : x < .06 ? cubicOut(x / .06) : Math.exp(-(x - .06) / .3); };
    var since = this.t - this.flashAt;
    if (since > 5) return 0;
    var e = pulse(since);
    if (this.flashDouble) e = Math.max(e, .55 * pulse(since - .28));
    return c01(e);
  };
  Sky.prototype.orbPhase = function () { return this.palT < .5 ? this.prevPhase : this.phase; };
  Sky.prototype.orbIsSun = function () { return this.arcSet ? this.arcSun : this.orbPhase() !== 'night'; };
  Sky.prototype.orbAlpha = function () {
    var a = this.cur.orb * (1 - .8 * this.cur.deck);
    if (this.arcSet) {
      if (!this.arcSun && !this.opts.moonAtNight) return 0;
      return a * smooth(0, .04, this.arcF) * (1 - smooth(.96, 1, this.arcF));
    }
    if (this.orbPhase() === 'night' && !this.opts.moonAtNight) return 0;
    var fade = this.palT < 1 ? Math.abs(2 * smooth(0, 1, this.palT) - 1) : 1;
    return a * fade;
  };
  // the arc (C242): x = f (w - 1), y = 29 - 22 sin(pi f)^0.75, held above `keep` (the text over the sky)
  Sky.prototype.arcPoint = function (f) {
    f = c01(f);
    var x = f * (this.w - 1), y = 29 - 22 * Math.pow(Math.max(0, Math.sin(Math.PI * f)), .75), k = this.keep;
    if (k && k.w > 0) {
      var r = ORB_R + 1, left = k.x - r, right = k.x + k.w + r, over = 1;
      if (x <= left) over = 1 - c01((left - x) / 4);
      if (x >= right) over = 1 - c01((x - right) / 4);
      var cap = k.y - r;
      if (y > cap) y += (cap - y) * smooth(0, 1, over);
    }
    return [x, y];
  };
  Sky.prototype.setArc = function (arc, keep) {
    var handover = !this.arcSet || arc.sun !== this.arcSun;
    this.arcSet = true; this.arcSun = arc.sun; this.arcF = arc.f; this.keep = keep;
    var p = this.arcPoint(this.arcF); this.orbTx = p[0]; this.orbTy = p[1];
    if (handover || this.arcSnap) { this.orbCx = this.orbTx; this.orbCy = this.orbTy; this.arcSnap = false; }
  };
  Sky.prototype.render = function (f, ox) {
    var self = this, pal = this.pal, c = this.cur, w = this.w, flash = this.flashLevel(), x, y, i;
    // the gradient
    for (y = 0; y < 32; y++) {
      var row = mix(pal.zenith, pal.horizon, y / 31);
      if (flash > 0) row = mix(row, pal.flashDeck, .45 * flash);
      for (x = 0; x < w; x++) f.set(ox + x, y, row);
    }
    // the stars
    var vis = c.night * (1 - .85 * c.deck) * (1 - .6 * c.fog);
    if (vis > .01) for (i = 0; i < 5 + Math.floor(w / 6); i++) {
      var sx = Math.floor(hashf(11, i) * w), sy = 1 + Math.floor(hashf(13, i) * 19);
      var s = .5 + .5 * Math.sin(2 * Math.PI * cyc(this.t, 2.5 + 2.5 * hashf(17, i), hashf(19, i))), a = vis * (.25 + .75 * s * s);
      f.blend(ox + sx, sy, pal.star, a);
      if (i % 5 === 0) { var arm = .3 * a * s; f.blend(ox + sx - 1, sy, pal.star, arm); f.blend(ox + sx + 1, sy, pal.star, arm); f.blend(ox + sx, sy - 1, pal.star, arm); f.blend(ox + sx, sy + 1, pal.star, arm); }
    }
    // the arc's faint dots
    if (this.arcSet && (this.arcSun || this.opts.moonAtNight)) {
      var clear = (1 - smooth(.1, .5, c.deck)) * (1 - .6 * c.cover) * (1 - .6 * c.precip) * (1 - .6 * c.fog), da = (this.arcSun ? .22 : .12) * c01(clear), k = this.keep;
      if (da > .005) for (x = 1; x < w - 1; x += 3) {
        var pt = this.arcPoint(x / (w - 1)), dx = Math.round(pt[0]), dy = Math.round(pt[1]);
        if (dy < 0 || dy >= 32) continue;
        if (k && k.w > 0 && dx >= k.x - 1 && dx <= k.x + k.w && dy >= k.y - 1 && dy <= k.y + k.h) continue;
        f.blend(ox + dx, dy, this.arcSun ? hexc('FFD86A') : hexc('C8D4F0'), da);
      }
    }
    // the sun or the moon
    var oa = this.orbAlpha();
    if (oa > .01) {
      if (this.orbIsSun()) {
        var low = this.arcSet ? 1 - smooth(.2, .55, Math.sin(Math.PI * this.arcF)) : (this.orbPhase() === 'dusk' ? 1 : 0);
        var cx = ox + (this.arcSet ? this.orbCx : this.orbX), cy = this.arcSet ? this.orbCy : this.orbY + 5 * low;
        var core = mix(hexc('FFD23A'), hexc('FF9A3C'), low), hi = mix(hexc('FFF4B8'), hexc('FFD08A'), low), rays = mix(hexc('FFD84A'), hexc('FFB060'), low);
        for (y = Math.max(0, Math.floor(cy - 11)); y <= Math.min(31, Math.floor(cy + 11)); y++) for (x = Math.floor(cx - 11); x <= Math.floor(cx + 11); x++) {
          var gdx = x + .5 - cx, gdy = y + .5 - cy, gf = c01(1 - (Math.sqrt(gdx * gdx + gdy * gdy) - 4) / 7);
          if (gf > 0) f.blend(x, y, pal.orbGlow, .28 * gf * gf * oa);
        }
        var rot = 2 * Math.PI * cyc(this.t, 90);
        for (i = 0; i < 8; i++) {
          var ang = rot + i * Math.PI / 4, swell = .5 + .5 * Math.sin(2 * Math.PI * cyc(this.t, 4, i * .125)), r0 = 6.6, r1 = 8.2 + 1.6 * swell;
          seg(f, cx + r0 * Math.cos(ang), cy + r0 * Math.sin(ang), cx + r1 * Math.cos(ang), cy + r1 * Math.sin(ang), .5, rays, (.55 + .35 * swell) * oa);
        }
        disc(f, cx, cy, ORB_R, core, oa);
        disc(f, cx - 1.1, cy - 1.1, 2.4, hi, .45 * oa);
      } else {
        var mx = ox + (this.arcSet ? this.orbCx : this.orbX), my = this.arcSet ? this.orbCy : this.orbY + 1;
        for (y = Math.max(0, Math.floor(my - 10)); y <= Math.min(31, Math.floor(my + 10)); y++) for (x = Math.floor(mx - 10); x <= Math.floor(mx + 10); x++) {
          var mdx = x + .5 - mx, mdy = y + .5 - my, mf = c01(1 - (Math.sqrt(mdx * mdx + mdy * mdy) - 4.5) / 5.5);
          if (mf > 0) f.blend(x, y, pal.orbGlow, .22 * mf * mf * oa);
        }
        moonDisc(f, mx, my, ORB_R, this.opts.southern ? 1 - this.opts.moonPhase : this.opts.moonPhase, hexc('EEF0F6'), hexc('2A3448'), .55, oa);
      }
    }
    // three layers of puffy clouds, far and slow to near and quicker
    if (c.cover > .01) {
      var span = w + 40, per = 2 + Math.floor(w / 30);
      for (var layer = 0; layer < 3; layer++) {
        var scale = .62 + .19 * layer, speed = (.45 + .55 * layer) * (1 + 7 * c.wind), haze = .45 - .2 * layer;
        var chi = mix(mix(pal.cloudHi, pal.deckHi, c.deck), pal.zenith, haze), clo = mix(mix(pal.cloudLo, pal.deckLo, c.deck), pal.zenith, haze);
        if (flash > 0) { chi = mix(chi, pal.flashDeck, .7 * flash); clo = mix(clo, pal.flashDeck, .5 * flash); }
        for (var j = 0; j < per; j++) {
          var id = layer * 16 + j, th = .08 + .85 * hashf(23, id), ca = smooth(th - .18, th, c.cover);
          if (ca <= .01) continue;
          var u = (hashf(29, id) * span + this.t * speed) % span, cxp = ox + u - 20, cyp = 3 + 3.2 * layer + 3 * hashf(31, id), sc = scale * (.85 + .3 * hashf(37, id));
          disc(f, cxp - 5.5 * sc, cyp + 2.4 * sc, 3.4 * sc, clo, ca); disc(f, cxp, cyp + 1.6 * sc, 4.6 * sc, clo, ca); disc(f, cxp + 5.5 * sc, cyp + 2.4 * sc, 3.4 * sc, clo, ca);
          disc(f, cxp - 5.5 * sc, cyp + 1.6 * sc, 3 * sc, chi, ca); disc(f, cxp - .6 * sc, cyp + .4 * sc, 4.2 * sc, chi, ca); disc(f, cxp + 5 * sc, cyp + 1.4 * sc, 2.9 * sc, chi, ca);
        }
      }
    }
    // fog
    if (c.fog > .01) {
      var ft = this.t % (4000 * Math.PI);
      for (y = 6; y < 32; y++) { var rise = smooth(6, 16, y); for (x = 0; x < w; x++) { var b1 = .55 + .45 * Math.sin(.09 * x + .35 * y + .21 * ft), b2 = .55 + .45 * Math.sin(.05 * x - .13 * ft + .6 * y); f.blend(ox + x, y, pal.mist, c.fog * .34 * rise * b1 * b2); } }
    }
    // gusts
    if (c.wind > .01) for (i = 0; i < 2 + Math.floor(w / 32); i++) {
      var wu = cyc(this.t, 2.4 + 1.6 * hashf(41, i), hashf(43, i)), wx = w + 12 - wu * (w + 28), wy = 8 + 18 * hashf(47, i) + 1.2 * Math.sin(2 * Math.PI * wu), ws = Math.sin(Math.PI * wu);
      seg(f, ox + wx, wy, ox + wx + 8, wy - .6, .35, pal.mist, .55 * c.wind * ws * ws);
    }
    // the precipitation, under the deck it falls from
    this.drops.forEach(function (d) {
      if (d.splashT < .25) { var sa = .5 * (1 - d.splashT / .25), spx = Math.floor(d.splashX), spy = self.snowGround ? 29 : 30; f.blend(ox + spx - 1, spy, pal.precip2, sa); f.blend(ox + spx + 1, spy, pal.precip2, sa); }
      if (!d.live) return;
      var under = self.deckUnder(d.x);
      if (d.y < under + .5) return;
      if (self.fall === 'drizzle' || self.fall === 'rain' || self.fall === 'heavy') {
        var len = d.size, kk = len / Math.max(1, d.vy), ty = Math.max(under, d.y - len), tx = d.x - d.vx * kk * (d.y - ty) / len;
        seg(f, ox + tx, ty, ox + d.x, d.y, .32, pal.precip, d.alpha);
      } else if (self.fall === 'hail') { disc(f, ox + d.x, d.y, .8, pal.precip2, d.alpha); disc(f, ox + d.x - .25, d.y - .25, .45, pal.precip, .8); }
      else disc(f, ox + d.x + d.sway * Math.sin(2 * Math.PI * d.swayPhase), d.y, .15 + .55 * d.size, pal.precip, d.alpha);
    });
    // the bolt
    if (this.flashBolt && this.t - this.flashAt <= .5 && flash > .05 && this.boltX.length) {
      var ba = c01(flash * 1.4), top = this.deckUnder(this.boltX[0]), step = (this.boltBottom - top) / 5;
      for (var pass = 0; pass < 2; pass++) for (i = 0; i < 5; i++) seg(f, ox + this.boltX[i], top + step * i, ox + this.boltX[i + 1], top + step * (i + 1), pass ? .45 : 1.3, pal.bolt, pass ? ba : .22 * ba);
    }
    // the deck
    if (c.deck > .01) {
      var dka = c01(c.deck * 1.4), dhi = pal.deckHi, dlo = pal.deckLo;
      if (flash > 0) { dhi = mix(dhi, pal.flashDeck, .75 * flash); dlo = mix(dlo, pal.flashDeck, .6 * flash); }
      for (x = 0; x < w; x++) { var bb = this.deckUnder(x + .5); for (y = 0; y < 32; y++) { var cov = c01(bb - y); if (cov <= 0) break; f.blend(ox + x, y, mix(dhi, dlo, (y + .5) / bb), cov * dka); } }
    }
    // the ground: snow cover, or an ice glaze with a glint sliding along it
    if (this.snowGround) {
      var ga = c01(c.precip * 1.6);
      for (x = 0; x < w; x++) { var gtop = 29.8 - .6 * Math.sin(.37 * x + 1) - .4 * Math.sin(.11 * x); for (y = Math.floor(gtop); y < 32; y++) f.blend(ox + x, y, pal.ground, c01(y + 1 - gtop) * ga); }
    } else if (this.icy) {
      var ia = c01(c.precip * 1.4), gx2 = cyc(this.t, 3) * (w + 10) - 5;
      for (x = 0; x < w; x++) f.blend(ox + x, 31, pal.ground, .65 * ia);
      for (x = Math.floor(gx2) - 2; x <= Math.floor(gx2) + 2; x++) f.blend(ox + x, 31, pal.precip2, ia * (1 - Math.abs(x - gx2) / 3));
    }
  };

  /* ---------- the lyric background: a port of the board's warp (CarLyrics' shader) over the cover ---------- */
  var GROUND = [0x0C, 0x0B, 0x1A];
  function Warp() {
    this.from = null; this.to = null; this.fade = 1; this.time = 6; this.pulse = 0;
    var sw = 32, sh = 8, aspect = sw / sh, inv = 1 / Math.max(1, aspect / .46);
    this.pc = [];
    for (var y = 0; y < sh; y++) for (var x = 0; x < sw; x++) {
      var px = ((x + .5) / sw - .5) * aspect, py = (y + .5) / sh - .5, dist = Math.sqrt(px * px + py * py), tk = 0;
      if (dist < .95) { var ratio = (.95 - dist) / .95; tk = ratio * ratio * 2; }
      this.pc.push([px * inv, py * inv, tk, ((hashf(x, y) - .5) * .008 * 255)]);
    }
    this.sh = new Float32Array(sw * sh * 3);
  }
  Warp.prototype.setTexture = function (tex) {
    if (tex === this.to) return;
    var shown = smooth(0, 1, this.fade);
    if (shown >= 1) this.from = this.to;
    else if (shown > 0 && (this.from || this.to)) {
      var a = this.from, b = this.to, m = new Uint8Array(28 * 28 * 3);
      for (var i = 0; i < m.length; i++) m[i] = Math.round((a ? a[i] : GROUND[i % 3]) + ((b ? b[i] : GROUND[i % 3]) - (a ? a[i] : GROUND[i % 3])) * shown);
      this.from = m;
    }
    this.to = tex; this.fade = 0;
  };
  Warp.prototype.update = function (dt) {
    this.pulse *= Math.exp(-2.2 * dt);
    this.time += dt * (1 + .5 * this.pulse);
    this.fade = c01(this.fade + dt / .65);
    if (this.fade >= 1) this.from = this.to;
  };
  function texAt(tex, u, v, out) {
    var px = u * 28 - .5, py = v * 28 - .5, x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    var xa = clamp(x0, 0, 27), xb = clamp(x0 + 1, 0, 27), ya = clamp(y0, 0, 27), yb = clamp(y0 + 1, 0, 27);
    for (var c = 0; c < 3; c++) {
      var a = tex[(ya * 28 + xa) * 3 + c], b = tex[(ya * 28 + xb) * 3 + c], d = tex[(yb * 28 + xa) * 3 + c], e = tex[(yb * 28 + xb) * 3 + c];
      out[c] = (a + (b - a) * fx) + ((d + (e - d) * fx) - (a + (b - a) * fx)) * fy;
    }
  }
  function edgeW(v) { var t = c01(v / .22); return t * t * (3 - 2 * t); }
  Warp.prototype.pass = function (tex, pc, k, out) {
    var px = pc[0], py = pc[1];
    if (pc[2] > 0) { var a = pc[2] * k.twist, s = Math.sin(a), c = Math.cos(a), nx = px * c - py * s; py = px * s + py * c; px = nx; }
    var col = [0, 0, 0], tmp = [0, 0, 0];
    for (var n = 0; n < 3; n++) {
      var sp = k.s[n], dx = px - sp[0], dy = py - sp[1], lx = (sp[3] * dx + sp[4] * dy) * sp[2], ly = (-sp[4] * dx + sp[3] * dy) * sp[2], ux = lx + .5, uy = ly + .5;
      var al = edgeW(ux) * edgeW(1 - ux) * edgeW(uy) * edgeW(1 - uy);
      texAt(tex, c01(ux), c01(uy), tmp);
      if (n === 0) { col[0] = tmp[0]; col[1] = tmp[1]; col[2] = tmp[2]; }
      else { var wgt = al * (n === 1 ? .85 : .75); col[0] += (tmp[0] - col[0]) * wgt; col[1] += (tmp[1] - col[1]) * wgt; col[2] += (tmp[2] - col[2]) * wgt; }
    }
    var lum = .2126 * col[0] + .7152 * col[1] + .0722 * col[2];
    out[0] = lum + (col[0] - lum) * 1.3; out[1] = lum + (col[1] - lum) * 1.3; out[2] = lum + (col[2] - lum) * 1.3;
  };
  Warp.prototype.render = function (f, dim) {
    if (!this.from && !this.to) { f.fill(GROUND); return; }
    var t = this.time, sp = function (cx, cy, side, ang) { return [cx, cy, 1 / side, Math.cos(ang), Math.sin(ang)]; }, T = 2 * Math.PI;
    var k = { twist: .8 + .2 * Math.sin((t * .09) % T), s: [
      sp(.1 * Math.sin((t * .05) % T), .08 * Math.cos((t * .041) % T), 1.9, (t * .07) % T),
      sp(-.25 + .12 * Math.cos((t * .037) % T), .18 * Math.sin((t * .045) % T), 1.5, (t * -.095 + 2.1) % T),
      sp(.28 + .1 * Math.sin((t * .043) % T), -.15 + .1 * Math.cos((t * .031) % T), 1.3, (t * .12 + 4) % T)] };
    var mixT = smooth(0, 1, this.fade), a = [0, 0, 0], b = [0, 0, 0], sh = this.sh;
    for (var i = 0; i < this.pc.length; i++) {
      var pc = this.pc[i];
      if (this.to) this.pass(this.to, pc, k, b); else { b[0] = GROUND[0]; b[1] = GROUND[1]; b[2] = GROUND[2]; }
      if (mixT < 1) {
        if (this.from) this.pass(this.from, pc, k, a); else { a[0] = GROUND[0]; a[1] = GROUND[1]; a[2] = GROUND[2]; }
        b[0] = a[0] + (b[0] - a[0]) * mixT; b[1] = a[1] + (b[1] - a[1]) * mixT; b[2] = a[2] + (b[2] - a[2]) * mixT;
      }
      for (var c = 0; c < 3; c++) { var v = b[c] + (GROUND[c] - b[c]) * .42 + pc[3]; v = v + (GROUND[c] - v) * .42; sh[i * 3 + c] = clamp(v, 0, 255) * dim; }
    }
    // bilinear up to the panel
    var p = f.p;
    for (var y = 0; y < H; y++) {
      var fy = clamp((y + .5) / 4 - .5, 0, 7), y0 = Math.floor(fy), y1 = Math.min(7, y0 + 1), wy = fy - y0;
      for (var x = 0; x < W; x++) {
        var fx = clamp((x + .5) / 4 - .5, 0, 31), x0 = Math.floor(fx), x1 = Math.min(31, x0 + 1), wx = fx - x0, o = (y * W + x) * 3;
        for (var cc = 0; cc < 3; cc++) {
          var top = sh[(y0 * 32 + x0) * 3 + cc] + (sh[(y0 * 32 + x1) * 3 + cc] - sh[(y0 * 32 + x0) * 3 + cc]) * wx;
          var bot = sh[(y1 * 32 + x0) * 3 + cc] + (sh[(y1 * 32 + x1) * 3 + cc] - sh[(y1 * 32 + x0) * 3 + cc]) * wx;
          p[o + cc] = top + (bot - top) * wy;
        }
      }
    }
  };

  /* ---------- the song the site is playing (js/music.js) and its cover ---------- */
  // the song the radio is on: playing (muted or not), or queued before it starts
  function playingSong() {
    var M = window.MooMusic, tr = M && M.track && M.track();
    if (!tr) return null;
    var ready = M.ready && M.ready(), playing = !!(ready && M.playing());
    // the lyrics run on the radio's lyric clock (the media clock, a lead, the output's latency); bars on the media clock
    return { tr: tr, tm: M.timing(), pos: ready ? (M.lyricPos || M.pos)() : 0, media: ready ? M.pos() : 0, playing: playing,
      audible: playing && !(M.muted && M.muted()), accent: tr.tint ? hexc(tr.tint) : [119, 237, 215] };
  }
  var ARTS = {};
  function sampleArt(im, n) {
    var c = mk(n, n), x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(im, 0, 0, n, n);
    var d = x.getImageData(0, 0, n, n).data, o = new Uint8Array(n * n * 3);
    for (var i = 0; i < n * n; i++) { o[i * 3] = d[i * 4]; o[i * 3 + 1] = d[i * 4 + 1]; o[i * 3 + 2] = d[i * 4 + 2]; }
    return o;
  }
  // the cover at the sizes the board uses: the warp's 28 x 28 texture, the card's 30 x 30, the lyric thumb's 20 x 20
  function artOf(tr) {
    if (tr && tr.testArt) return tr.testArt;   // tests: a cover already sampled
    var M = window.MooMusic, src = tr && M && M.cover ? M.cover(tr) : null;
    if (!src) return null;
    var a = ARTS[src];
    if (!a) {
      a = ARTS[src] = { ok: false };
      var im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async';
      im.onload = function () { try { a.tex = sampleArt(im, 28); a.t30 = sampleArt(im, 30); a.t20 = sampleArt(im, 20); a.ok = true; restill(); } catch (e) { a.bad = true; } };
      im.onerror = function () { a.bad = true; };
      im.src = src;
    }
    return a.ok ? a : null;
  }
  function blitArt(f, px, n, x0, y0, level) {
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) { var i = (y * n + x) * 3; f.set(x0 + x, y0 + y, [px[i] * level, px[i + 1] * level, px[i + 2] * level]); }
  }
  // no cover (yet): the accent's dim diagonal wash (C65)
  function washArt(f, accent, x0, y0, n) {
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) f.set(x0 + x, y0 + y, mul(accent, .12 + .26 * (x + y) / (2 * (n - 1))));
  }

  // the time beside the cover: the column is the widest of the day's times in the board's small face, SF Pro SemiBold
  // at cap 6 (pw::LyricDecor::widestTimeInk); the site draws the digits themselves from its small set
  var widestTime = { gen: -1, w: 0 };
  function widestTimeInk() {
    if (widestTime.gen === textGen) return widestTime.w;
    var w = 0;
    for (var h = 0; h < 24; h++) w = Math.max(w, line('sfSemi', 6, (H12 ? String((h + 11) % 12 + 1) : two(h)) + ':00').inkW, line('sfSemi', 6, (H12 ? String((h + 11) % 12 + 1) : two(h)) + ':48').inkW);
    widestTime = { gen: textGen, w: w };
    return w;
  }

  /* ---------- lyrics: a port of the board's lyric wheel (LyricsScene, LyricsLayout.h, LyricFit, LyricStyle) ---------- */
  // The board's numbers (release-2, section N): a one-row centre line on cap top 10, a wrapped pair from 6 with at
  // least 10 rows between them, the previous line's last row on cap top -4 and the next line's first on 28, both at
  // cap 8 and 40%; the ladder 11, 10, 9, 8 on one row, then rows at cap 8, a word wider than the box dropping the
  // line to 7. One difference, the owner's edge rule: the board lets the side lines show half across the panel's
  // edge; here a row is drawn only while its ink is whole inside the dark ring, fading as it nears it, so at rest the
  // side slots (off the edge) are empty and a line change still rides the wheel up through the panel.
  var LYR = {
    CUR_TOP: 10, WRAP1: 6, WRAP2: 16, PREV_TOP: -4, NEXT_TOP: 28, BOX_X: 2, BOX_W: 124, FIT: [11, 10, 9, 8], WRAP_CAP: 8, MIN_CAP: 7,
    SIDE_CAP: 8, SIDE_ALPHA: .4, SCROLL_TAU: .16, NEXT_FADE: .12, SHOW_FADE: .3, FADE_ROWS: 5, IN_ROWS: 2.5, INK_GAP: 1, LIFT: 1, HALO: 1,
    GROW_REST: .95, GROW_FOCUS: 1.06, DIM: .4, LIFT_TH: .5, GLOW_MIN_MS: 1000, GLOW_MAX_CHARS: 7, GLOW_RAMP: 500, GLOW_A: .2,
    DOT_SP: 6, DOT_MIN: .3, DOT_RANGE: .7, BREATH: .12, BREATH_RATE: 2.2, INTRO_MIN_MS: 4000, BG_DIM: .45,
    COVER_PX: 20, COVER_Y: 1, COVER_LEVEL: .8, COVER_TIME_TOP: 24, SIDE_BOX_GAP: 3, TIME_CAP: 6, TIME_ALPHA: .85, TIME_TINT: .62, TIME_FADE: .4
  };
  var NOTHING = -1e9;
  function rowOf(y) { return Math.round(y); }
  function capRowsOf(cap) { return Math.ceil(q4(cap)); }
  function lerpF(a, b, t) { return a + (b - a) * t; }
  // a critically damped glide (its speed in sp[k]) that settles as soon as the board's SCROLL_TAU
  function glide(cur, to, dt, sp, k) {
    var w = 1.6 / LYR.SCROLL_TAU, y = cur - to, e = Math.exp(-w * dt), c = (sp[k] + w * y) * dt;
    sp[k] = (sp[k] - w * c) * e;
    return to + (y + c) * e;
  }
  // pw::lyrics: the active line, the active word, what has been sung
  function firstSung(sh) { for (var i = 0; i < sh.lines.length; i++) if (!sh.lines[i].interlude) return i; return 0; }
  function activeLineIndex(sh, pos) { var r = -1; for (var i = 0; i < sh.lines.length; i++) { if (sh.lines[i].startMs <= pos) r = i; else break; } return r; }
  function wordState(ln, pos) {
    var st = { activeWord: -1, msIntoWord: 0, wordDurMs: 0, progress: 0, sungTo: 0 };
    ln.words.forEach(function (w, i) {
      if (pos >= w.startMs && pos < w.endMs) { st.activeWord = i; st.msIntoWord = pos - w.startMs; st.wordDurMs = w.endMs - w.startMs; st.progress = st.wordDurMs > 0 ? st.msIntoWord / st.wordDurMs : 0; }
      if (w.endMs <= pos) st.sungTo = w.end;
    });
    return st;
  }
  function gapRemainingMs(sh, pos, dur) {
    var idx = activeLineIndex(sh, pos), i;
    var toEnd = function () { return dur > pos ? dur - pos : 0; };
    if (idx < 0) { for (i = 0; i < sh.lines.length; i++) if (!sh.lines[i].interlude) return sh.lines[i].startMs - pos; return toEnd(); }
    var ln = sh.lines[idx];
    if (ln.interlude) { for (i = idx + 1; i < sh.lines.length; i++) if (!sh.lines[i].interlude) return sh.lines[i].startMs - pos; return toEnd(); }
    var silence = ln.words.length ? ln.words[ln.words.length - 1].endMs : ln.endMs;
    if (pos < silence) return 0;
    return idx + 1 < sh.lines.length ? sh.lines[idx + 1].startMs - pos : toEnd();
  }
  function liftAmt(ms, dur) { return cubicOut((ms - 80) / 140) * (1 - c01((ms - (dur - 140)) / 140)); }
  function sweepAlpha(col, b, sungTo, left, width, aS, aE, prog) {
    if (b < sungTo) return 1;
    if (aE <= aS || b < aS || b >= aE) return LYR.DIM;
    var xs = left + width * (-.2 + 1.2 * c01(prog)), soft = .2 * width + 1, c = col + .5;
    if (c < xs) return 1;
    if (c >= xs + soft) return LYR.DIM;
    return 1 - (1 - LYR.DIM) * (c - xs) / soft;
  }
  // the site's timing (js/music.js: lines of words with t0/t1 in seconds) as the board's sheet (ms, word offsets)
  function sheetOf(tm) {
    if (!tm || !tm.lines) return null;
    if (tm.__sheet) return tm.__sheet;
    var lines = tm.lines.map(function (l) {
      var ws = (l.words || []).filter(function (w) { return w.text; }), text = '', words = [];
      ws.forEach(function (w, i) { var start = text.length + (i ? 1 : 0); text += (i ? ' ' : '') + w.text; words.push({ startMs: w.t0 * 1000, endMs: w.t1 * 1000, start: start, end: start + w.text.length }); });
      if (!ws.length) text = String(l.text || '').trim().replace(/\s+/g, ' ');
      return { startMs: l.t0 * 1000, endMs: (l.t1 != null ? l.t1 : l.t0 + 4) * 1000, text: text, words: words, interlude: !text || /^[♪♫]$/.test(text) };
    });
    return (tm.__sheet = { lines: lines, durMs: (tm.length || 30) * 1000 });
  }
  // the lyric faces in this family: the centre line SF Pro Rounded Bold, the side lines SemiBold, the small time
  // SF Pro SemiBold (the firmware's SfrBold, SfrSemibold and SfSemibold, wght 700 and 590)
  var CENTRE = 'lyric', SIDE = 'lyricSide';
  function measure(role, cap, str) { return line(role, cap, str).adv; }
  // pw::fitLyricLine: the ladder's caps on one row by the layout's width, else rows at the wrap cap (the min cap where
  // a word alone is wider than the box), the fewest rows, then the smallest widest row, then the widest narrowest.
  // Past the board: a word still wider than the box at the min cap steps down by half caps to 5, where the board
  // would scroll the row and clip it at the box.
  function lyricFit(text, boxW, ladder) {
    ladder = ladder || {};
    var caps = ladder.caps || LYR.FIT, words = String(text).split(/\s+/).filter(Boolean), norm = words.join(' '), fitd = { cap: caps[0], rows: [], rowStart: [] }, i;
    if (!words.length) return fitd;
    for (i = 0; i < caps.length; i++) if (measure(CENTRE, caps[i], norm) <= boxW) { fitd.cap = caps[i]; fitd.rows = [norm]; fitd.rowStart = [0]; return fitd; }
    var cap = ladder.wrapCap || LYR.WRAP_CAP;
    if (words.some(function (w) { return measure(CENTRE, cap, w) > boxW; })) cap = ladder.minCap || LYR.MIN_CAP;
    while (cap > 5 && words.some(function (w) { return measure(CENTRE, cap, w) > boxW; })) cap -= .5;
    fitd.cap = cap;
    // each word's pen span in one layout of the whole line: a row of words [a, b) is end[b-1] - start[a] wide
    var L = line(CENTRE, cap, norm), start = [], end = [], wi = 0, at = 0;
    words.forEach(function (w, k) { start[k] = null; end[k] = 0; });
    L.spans.forEach(function (s) {
      while (wi < words.length && s.i >= at + words[wi].length) { at += words[wi].length + 1; wi++; }
      if (wi >= words.length || s.i < at) return;
      if (start[wi] == null) start[wi] = s.x;
      end[wi] = s.x + s.g.adv;
    });
    var pen = 0;
    for (i = 0; i < words.length; i++) { if (start[i] == null) { start[i] = pen; end[i] = pen; } pen = end[i]; }
    var width = function (a, b) { return b <= a ? 0 : end[b - 1] - start[a]; }, n = words.length;
    var greedy = [];
    for (i = 0; i < n;) { greedy.push(i); var e = i + 1; while (e < n && width(i, e + 1) <= boxW) e++; i = e; }
    var breaks = greedy;
    if (greedy.length > 1) {
      var rows = greedy.length, INF = 1e9, stride = n + 1, r, j, wa = [], na = [], par = [];
      for (i = 0; i < stride * (rows + 1); i++) { wa.push(null); na.push(null); par.push(0); }
      var better = function (a, b, key, less) { if (!b) return !!a; if (!a) return false; if (a.o !== b.o) return a.o < b.o; return less ? a[key] < b[key] : a[key] > b[key]; };
      wa[0] = { o: 0, w: 0 };
      for (r = 1; r <= rows; r++) for (i = r; i <= n; i++) { var best = null; for (j = r - 1; j < i; j++) { var fr = wa[(r - 1) * stride + j]; if (!fr) continue; var wd = width(j, i), c = { o: fr.o + (wd > boxW ? 1 : 0), w: Math.max(fr.w, wd) }; if (better(c, best, 'w', true)) best = c; } wa[r * stride + i] = best; }
      var goal = wa[rows * stride + n];
      if (goal) {
        var allowed = goal.w;
        na[0] = { o: 0, nw: INF };
        for (r = 1; r <= rows; r++) for (i = r; i <= n; i++) { var bb = null, bf = r - 1; for (j = r - 1; j < i; j++) { var f2 = na[(r - 1) * stride + j]; if (!f2) continue; var w2 = width(j, i); if (w2 > allowed) continue; var c2 = { o: f2.o + (w2 > boxW ? 1 : 0), nw: Math.min(f2.nw, w2) }; if (better(c2, bb, 'nw', false)) { bb = c2; bf = j; } } na[r * stride + i] = bb; par[r * stride + i] = bf; }
        if (na[rows * stride + n]) { breaks = []; var pos = n; for (r = rows; r >= 1; r--) { var from = par[r * stride + pos]; breaks.unshift(from); pos = from; } }
      }
    }
    for (i = 0; i < breaks.length; i++) {
      var to = i + 1 < breaks.length ? breaks[i + 1] : n;
      fitd.rows.push(words.slice(breaks[i], to).join(' '));
    }
    var acc = 0;
    fitd.rows.forEach(function (row, k) { fitd.rowStart.push(acc); acc += row.length + 1; });
    return fitd;
  }
  // a row's ink, column by column (every pixel with any coverage), relative to its pen and baseline
  function rowInkOf(L) {
    if (L.colInk) return L.colInk;
    var top = {}, bot = {}, minT = 1e9, maxB = -1e9;
    L.spans.forEach(function (s) {
      var g = s.g; if (!g.w) return;
      for (var c = 0; c < g.w; c++) for (var r = 0; r < g.h; r++) { if (!g.a[r * g.w + c]) continue; var x = s.x + g.x + c, y = g.y + r; top[x] = Math.min(top[x] == null ? 1e9 : top[x], y); bot[x] = Math.max(bot[x] == null ? -1e9 : bot[x], y); minT = Math.min(minT, y); maxB = Math.max(maxB, y); }
    });
    var cols = [];
    for (var k in top) cols.push([+k, top[k], bot[k]]);
    return (L.colInk = { top: top, bot: bot, cols: cols, minTop: minT, maxBottom: maxB });
  }
  function RowInk() { this.clear(0, 0); }
  RowInk.prototype.clear = function (capTop, base) {
    if (!this.top) { this.top = new Int16Array(W); this.bot = new Int16Array(W); }
    this.top.fill(32767); this.bot.fill(-32768); this.capTop = capTop; this.base = base; this.minTop = 1e9; this.maxBottom = -1e9;
  };
  RowInk.prototype.add = function (c, t, b) { if (c < 0 || c >= W) return; this.top[c] = Math.min(this.top[c], t); this.bot[c] = Math.max(this.bot[c], b); this.minTop = Math.min(this.minTop, t); this.maxBottom = Math.max(this.maxBottom, b); };
  RowInk.prototype.any = function () { return this.minTop <= this.maxBottom; };
  function clearance(up, lo) {
    if (!up.any() || !lo.any()) return NOTHING;
    var need = NOTHING;
    for (var c = 0; c < W; c++) {
      if (up.top[c] > up.bot[c]) continue;
      for (var d = -1; d <= 1; d++) { var c2 = c + d; if (c2 < 0 || c2 >= W || lo.top[c2] > lo.bot[c2]) continue; need = Math.max(need, up.bot[c] + 1 + LYR.INK_GAP - lo.top[c2]); }
    }
    need = Math.max(need, up.maxBottom + 1 - lo.capTop);
    need = Math.max(need, up.base + 1 - lo.minTop);
    return need;
  }
  function Spring() { this.value = 1; this.velocity = 0; this.target = 1; }
  Spring.prototype.step = function (dt) {
    if (dt <= 0) return;
    var n = clamp(Math.ceil(dt / .016), 1, 8), sub = dt / n;
    for (var i = 0; i < n; i++) { var acc2 = (-100 * (this.value - this.target) - 25 * this.velocity) / 2; this.velocity += acc2 * sub; this.value += this.velocity * sub; }
  };

  function Wheel(style) {
    this.style = style; this.warp = new Warp(); this.grow = new Spring();
    this.started = false; this.active = -1; this.cur = this.emptyFit(); this.prevF = this.emptyFit(); this.nextF = this.emptyFit();
    this.wheelT = 1; this.nextFade = 1; this.rowScroll = 0; this.scrollFrom = this.scrollTo = 0; this.speed = { wheel: 0, scroll: 0 }; this.show = 1;
    this.inkA = new RowInk(); this.inkB = new RowInk();
    this.timeNow = null; this.timeBefore = null; this.timeFade = 1; this.warm = [];
  }
  Wheel.prototype.emptyFit = function () { return { cap: LYR.FIT[0], rows: [], rowStart: [] }; };
  // the geometry: the words alone across the panel, or (Cover) a box beside the cover and its time
  Wheel.prototype.geom = function () {
    var g = { boxX: LYR.BOX_X, boxW: LYR.BOX_W, curCapTop: LYR.CUR_TOP, wrapCapTop1: LYR.WRAP1, rowStep: LYR.WRAP2 - LYR.WRAP1, prevCapTop: LYR.PREV_TOP, nextCapTop: LYR.NEXT_TOP };
    if (this.style === 'cover') {
      var w = Math.max(LYR.COVER_PX, widestTimeInk());
      g.colCx = LYR.BOX_X + Math.floor(w / 2);
      g.boxX = LYR.BOX_X + w + LYR.SIDE_BOX_GAP;
      g.boxW = LYR.BOX_X + LYR.BOX_W - g.boxX;
    }
    return g;
  };
  // a line's fit, kept by its text and box
  var fitCache = new Map();
  Wheel.prototype.fitLine = function (sh, i) {
    if (i < 0 || i >= sh.lines.length || sh.lines[i].interlude) return this.emptyFit();
    var key = textGen + '|' + this.g.boxW + '|' + sh.lines[i].text, fitd = fitCache.get(key);
    if (!fitd) { if (fitCache.size > 200) fitCache.delete(fitCache.keys().next().value); fitCache.set(key, fitd = lyricFit(sh.lines[i].text, this.g.boxW)); }
    return fitd;
  };
  // the next line change's layouts, a piece a frame while the wheel rests (all at once they cost a slow phone a frame)
  Wheel.prototype.queueWarm = function (sh) {
    var self = this, q = this.warm = [], i = this.active + 2, ln = sh.lines[i];
    if (ln && !ln.interlude) {
      var norm = ln.text.split(/\s+/).filter(Boolean).join(' ');
      LYR.FIT.concat(LYR.WRAP_CAP).forEach(function (c) { q.push(function () { line(CENTRE, c, norm); }); });
      q.push(function () { var fd = self.fitLine(sh, i); if (fd.rows.length) rowInkOf(line(SIDE, self.sideCapFor(fd), fd.rows[0])); });
    }
    [[this.nextF, CENTRE, this.nextF.cap], [this.cur, SIDE, this.sideCapFor(this.cur)]].forEach(function (w) {
      w[0].rows.forEach(function (row) { q.push(function () { rowInkOf(line(w[1], w[2], row)); }); });
    });
  };
  Wheel.prototype.sideCapFor = function (fitd) { return fitd.rows.length ? Math.min(LYR.SIDE_CAP, fitd.cap) : LYR.SIDE_CAP; };
  Wheel.prototype.rowX = function (L) { return this.g.boxX + Math.trunc((this.g.boxW - L.adv) / 2); };
  Wheel.prototype.layoutInk = function (ink, L, x, capTop, base, lift, ln, rowStart) {
    ink.clear(capTop, base);
    var ci = rowInkOf(L);
    if (ci.minTop > ci.maxBottom) return;
    for (var k = 0; k < ci.cols.length; k++) { var cl = ci.cols[k]; ink.add(x + cl[0], base + cl[1] - lift, base + cl[2]); }
    if (!ln || !ln.words.length) return;
    // a word held long enough to glow wears the halo a pixel round it
    var reach = 2 + LYR.HALO, wi = 0;
    L.spans.forEach(function (s) {
      var b = rowStart + s.i;
      while (wi < ln.words.length && ln.words[wi].end <= b) wi++;
      if (wi >= ln.words.length) return;
      var wd = ln.words[wi];
      if (b < wd.start || wd.endMs - wd.startMs < LYR.GLOW_MIN_MS || wd.end - wd.start > LYR.GLOW_MAX_CHARS) return;
      for (var c = s.x - reach; c < s.x + s.g.adv + reach; c++) {
        var t2 = 1e9, b2 = -1e9;
        for (var d = -LYR.HALO; d <= LYR.HALO; d++) { var cc = c + d; if (ci.top[cc] == null) continue; t2 = Math.min(t2, ci.top[cc]); b2 = Math.max(b2, ci.bot[cc]); }
        if (t2 > b2) continue;
        ink.add(x + c, base + t2 - LYR.HALO - lift, base + b2 + LYR.HALO);
      }
    });
  };
  Wheel.prototype.sideInk = function (ink, text, cap, capTop) {
    var L = line(SIDE, cap, text);
    this.layoutInk(ink, L, this.rowX(L), capTop, capTop + capRowsOf(cap), 0, null, 0);
  };
  Wheel.prototype.centreInk = function (ink, ln, r, cap, capTop) {
    var L = line(CENTRE, cap, this.cur.rows[r]), timed = ln.words.length > 0;
    this.layoutInk(ink, L, this.rowX(L), capTop, capTop + capRowsOf(cap), timed ? LYR.LIFT : 0, timed ? ln : null, this.cur.rowStart[r]);
  };
  Wheel.prototype.dotsInk = function (ink, cy0) {
    var cx = this.g.boxX + Math.floor(this.g.boxW / 2), cy = rowOf(cy0);
    ink.clear(cy - 1, cy + 2);
    for (var k = 0; k < 3; k++) { var x = cx + (k - 1) * LYR.DOT_SP; ink.add(x, cy - 1, cy + 1); ink.add(x - 1, cy, cy); ink.add(x + 1, cy, cy); }
  };
  Wheel.prototype.windowInk = function (ink, top, bottom) { ink.clear(top, bottom); for (var c = this.g.boxX; c < this.g.boxX + this.g.boxW; c++) ink.add(c, top, bottom - 1); };
  Wheel.prototype.centreText = function (sh) {
    if (this.active < 0 || this.active >= sh.lines.length) return null;
    var ln = sh.lines[this.active];
    return ln.interlude || !this.cur.rows.length ? null : ln;
  };
  Wheel.prototype.centreDots = function (sh) {
    if (!sh.lines.length) return false;
    if (this.active < 0) return sh.lines[0].startMs > LYR.INTRO_MIN_MS;
    return this.active < sh.lines.length && sh.lines[this.active].interlude;
  };
  Wheel.prototype.centreDotsY = function (t) { return lerpF(this.fromInTop + (LYR.SIDE_CAP - 1) * .5, this.g.curCapTop + (LYR.FIT[0] - 1) * .5, t); };
  Wheel.prototype.edgeInk = function (ink, sh, f, t, scroll, bottom) {
    var ln = this.centreText(sh);
    if (ln) {
      if (f.windowed) this.windowInk(ink, f.windowTop, f.windowBottom);
      else { var r = bottom ? f.lastRow : f.firstRow; this.centreInk(ink, ln, r, f.centreCap, rowOf(f.rowTop(r, scroll))); }
      return true;
    }
    if (this.centreDots(sh)) { this.dotsInk(ink, this.centreDotsY(t)); return true; }
    return false;
  };
  Wheel.prototype.placeWheel = function (sh, t, scale, settle) {
    var rest = this.rest, cur = this.cur, rows = cur.rows.length, ln = this.centreText(sh), scroll = settle ? 0 : this.rowScroll, count = sh.lines.length;
    var f = { firstRow: 0, lastRow: 0, windowed: false, rowTop: function (r, s) { return this.anchor + (r - s) * this.pitch; } };
    var capNow = lerpF(this.sideCapFor(cur), cur.cap, t);
    f.centreCap = capNow * scale;
    var blockTop = lerpF(this.fromInTop, rest.centreTop, t), blockH = rest.centrePitch * (rows >= 2 ? 1 : 0) + capNow, blockCentre = blockTop + blockH * .5;
    f.anchor = blockCentre + (blockTop - blockCentre) * scale;
    f.pitch = Math.max(1, Math.round(rest.centrePitch * scale));
    if (rows > 0) { f.lastRow = rows - 1; if (rows > 2) { f.firstRow = Math.min(rows - 1, Math.max(0, Math.floor(scroll))); f.lastRow = Math.min(rows - 1, f.firstRow + 2); } }
    if (ln && !settle) for (var r = f.firstRow; r < f.lastRow; r++) { this.centreInk(this.inkA, ln, r, f.centreCap, 0); this.centreInk(this.inkB, ln, r + 1, f.centreCap, 0); f.pitch = Math.max(f.pitch, clearance(this.inkA, this.inkB)); }
    f.windowed = !!ln && rows > 2;
    if (f.windowed) { var topSlot = rowOf(f.anchor); f.windowTop = topSlot + rest.windowAbove; f.windowBottom = topSlot + f.pitch + capRowsOf(f.centreCap) + rest.windowBelow + 1; }
    var prev = this.active - 1, prevRows = this.prevF.rows.length, prevDots = prev >= 0 && prev < count && sh.lines[prev].interlude;
    // the next line: on its slot, or as far below the centre block as their ink needs; on a line change it rides up
    // from a whole centre travel below
    f.nextTop = settle ? this.g.nextCapTop : lerpF(rest.nextTop + (this.fromInTop - rest.centreTop), rest.nextTop, t);
    var next = this.active + 1;
    if (next >= 0 && next < count && this.edgeInk(this.inkA, sh, f, t, scroll, true)) {
      var drawn = true;
      if (sh.lines[next].interlude) this.dotsInk(this.inkB, f.nextTop + (LYR.SIDE_CAP - 1) * .5);
      else if (this.nextF.rows.length) this.sideInk(this.inkB, this.nextF.rows[0], this.sideCapFor(this.nextF), rowOf(f.nextTop));
      else drawn = false;
      var need = drawn ? clearance(this.inkA, this.inkB) : NOTHING;
      if (need > 0) f.nextTop += need;
    }
    // the previous line: on its slot, or as far above the centre block as their ink needs; on a line change it rides
    // up whole from where it sat as the centre block, shrinking to its side cap and dimming
    // an interlude's dots too (an empty fit carries the centre's cap)
    var prevSide = this.sideCapFor(this.prevF);
    f.prevCap = lerpF(this.prevF.cap, prevRows === 0 ? LYR.SIDE_CAP : prevSide, t);
    f.prevAlpha = lerpF(1, LYR.SIDE_ALPHA, t);
    f.prevTop = settle ? this.g.prevCapTop : lerpF(this.fromOutTop, rest.prevTop, t);
    f.prevPitch = settle ? this.g.rowStep : Math.max(1, Math.round(lerpF(this.fromOutPitch, rest.prevPitch, t)));
    if (prev >= 0 && prev < count) {
      if (!prevDots && prevRows >= 2) { this.sideInk(this.inkA, this.prevF.rows[prevRows - 2], f.prevCap, 0); this.sideInk(this.inkB, this.prevF.rows[prevRows - 1], f.prevCap, 0); f.prevPitch = Math.max(f.prevPitch, clearance(this.inkA, this.inkB)); }
      var pd = true;
      if (prevDots) this.dotsInk(this.inkA, f.prevTop + (f.prevCap - 1) * .5);
      else if (prevRows > 0) this.sideInk(this.inkA, this.prevF.rows[prevRows - 1], f.prevCap, rowOf(f.prevTop));
      else pd = false;
      if (pd && this.edgeInk(this.inkB, sh, f, t, scroll, false)) { var nd = clearance(this.inkA, this.inkB); if (nd > 0) f.prevTop -= nd; }
    }
    return f;
  };
  // the rest the wheel eases toward for the three lines just fitted
  Wheel.prototype.settleWheel = function (sh) {
    var rows = this.cur.rows.length, rest = this.rest;
    rest.centreTop = rows >= 2 ? this.g.wrapCapTop1 : this.g.curCapTop;
    rest.centrePitch = this.g.rowStep; rest.windowAbove = 0; rest.windowBelow = 0;
    var ln = this.centreText(sh);
    if (ln) for (var r = 0; r < rows; r++) {
      this.centreInk(this.inkB, ln, r, this.cur.cap, 0);
      rest.windowAbove = Math.min(rest.windowAbove, this.inkB.minTop - this.inkB.capTop);
      rest.windowBelow = Math.max(rest.windowBelow, this.inkB.maxBottom - this.inkB.base);
      if (r > 0) rest.centrePitch = Math.max(rest.centrePitch, clearance(this.inkA, this.inkB));
      var tmp = this.inkA; this.inkA = this.inkB; this.inkB = tmp;
    }
    var settled = this.placeWheel(sh, 1, 1, true);
    rest.prevTop = rowOf(settled.prevTop); rest.prevPitch = settled.prevPitch; rest.nextTop = rowOf(settled.nextTop);
  };
  Wheel.prototype.refit = function (sh, active) {
    this.active = active;
    this.cur = this.fitLine(sh, active); this.prevF = this.fitLine(sh, active - 1); this.nextF = this.fitLine(sh, active + 1);
    this.settleWheel(sh); this.queueWarm(sh);
    this.fromOutTop = this.rest.prevTop; this.fromOutPitch = this.rest.prevPitch; this.fromInTop = this.rest.centreTop;
  };
  Wheel.prototype.stepFits = function (sh, active) {
    var rest = this.rest, shownOut = Math.min(this.cur.rows.length, 2);
    this.fromOutTop = rest.centreTop + (shownOut >= 2 ? rest.centrePitch : 0);
    this.fromOutPitch = rest.centrePitch; this.fromInTop = rest.nextTop;
    this.active = active; this.prevF = this.cur; this.cur = this.nextF; this.nextF = this.fitLine(sh, active + 1);
    this.settleWheel(sh); this.queueWarm(sh);
  };
  Wheel.prototype.retriggerGrow = function () { this.grow.value = 0; this.grow.velocity = 0; this.grow.target = 1; };
  Wheel.prototype.growScale = function () { return (LYR.GROW_REST + (LYR.GROW_FOCUS - LYR.GROW_REST) * this.grow.value) / LYR.GROW_FOCUS; };
  // the scroll a long line's rows follow: the row with the word being sung (untimed, its share of the line) on top
  Wheel.prototype.scrollFor = function (ln, ws, pos) {
    var rows = this.cur.rows.length, rs = this.cur.rowStart, focus = 0, r;
    if (ln.words.length) { var fb = ws.activeWord >= 0 ? ln.words[ws.activeWord].start : ws.sungTo; for (r = 0; r < rows; r++) if (fb >= rs[r]) focus = r; }
    else if (rows > 1 && ln.endMs > ln.startMs) focus = Math.min(Math.max(Math.floor(c01((pos - ln.startMs) / (ln.endMs - ln.startMs)) * rows), 0), rows - 1);
    return Math.min(focus, rows >= 2 ? rows - 2 : 0);
  };
  Wheel.prototype.followRow = function (ln, ws, pos, dt) {
    var to = this.scrollFor(ln, ws, pos);
    if (to !== this.scrollTo) { this.scrollFrom = this.scrollTo; this.scrollTo = to; }
    this.rowScroll = REDUCED ? to : glide(this.rowScroll, to, dt, this.speed, 'scroll');
  };
  // how much of a moving row shows: it fades over the rows it had at rest as it nears the ring or leaves the clip,
  // and comes in through the bottom over IN_ROWS (a new line is lit as soon as on the board)
  function fadeZone(room) { return room > 0 ? clamp(room, .5, LYR.FADE_ROWS) : LYR.FADE_ROWS; }
  Wheel.prototype.fadeOf = function (top, bottom, zoneTop, zoneBottom, clipTop, clipBottom) {
    var out = Math.max(clipTop - top, bottom - clipBottom + 1);
    return Math.min(c01((top - .5) / zoneTop), c01((30.5 - bottom) / zoneBottom), 1 - c01(out / LYR.FADE_ROWS)) * this.show;
  };
  // a row is drawn only while its whole ink is inside the lit rows (1..30), at its fade
  Wheel.prototype.drawRow = function (f, role, cap, L, x, capTopY, alpha, shade, fade) {
    var base = capBase(capTopY, cap), top = base + L.t, bottom = base + L.b;
    if (L.empty || top < 1 || bottom > 30 || x + L.l < 1 || x + L.r > W - 2 || !(fade > 0)) return false;
    drawText(f, L, x, base, WHITE, alpha * fade, shade);
    return true;
  };
  Wheel.prototype.drawSideSlot = function (f, sh, index, fitd, previous, monoMs) {
    if (index < 0 || index >= sh.lines.length) return;
    var ln = sh.lines[index], fr = this.frame, capTop = previous ? fr.prevTop : fr.nextTop;
    var cap = previous ? fr.prevCap : (ln.interlude ? LYR.SIDE_CAP : this.sideCapFor(fitd));
    var alpha = previous ? fr.prevAlpha : LYR.SIDE_ALPHA * this.nextFade;
    if (alpha <= 0) return;
    // an interlude just past leaves with its dots full, as the centre showed them last
    if (ln.interlude) { this.drawDots(f, previous ? 1 : 0, monoMs, capTop + (cap - 1) * .5, alpha); return; }
    if (!fitd.rows.length) return;
    var self = this, rowsShown = previous ? Math.min(fitd.rows.length, 2) : 1;
    for (var k = 0; k < rowsShown; k++) {
      var r = previous ? fitd.rows.length - rowsShown + k : 0, y = previous ? capTop - (rowsShown - 1 - k) * fr.prevPitch : capTop, L = line(SIDE, cap, fitd.rows[r]);
      // the previous line fades over the room it had where it set off, the next line comes in like the centre
      var b = capBase(y, cap) + y - rowOf(y), b0 = capBase(this.fromOutTop - (rowsShown - 1 - k) * this.fromOutPitch, cap);
      var zt = previous ? fadeZone(b0 + L.t - .5) : LYR.FADE_ROWS, zb = previous ? fadeZone(30.5 - b0 - L.b) : LYR.IN_ROWS;
      self.drawRow(f, SIDE, cap, L, self.rowX(L), y, alpha, null, self.fadeOf(b + L.t, b + L.b, zt, zb, 0, 32));
    }
  };
  Wheel.prototype.drawDots = function (f, p, monoMs, cy0, alpha) {
    var breath = REDUCED ? 1 : 1 + LYR.BREATH * Math.sin(LYR.BREATH_RATE * ((monoMs % (6283.185307179586 / LYR.BREATH_RATE)) / 1000));
    var cx = this.g.boxX + Math.floor(this.g.boxW / 2), cy = rowOf(cy0);
    if (cy - 1 < 1 || cy + 1 > 30) return;
    alpha *= this.fadeOf(cy0 - 1, cy0 + 1, LYR.FADE_ROWS, LYR.IN_ROWS, 0, 32);
    for (var k = 0; k < 3; k++) {
      var a = Math.min(1, (LYR.DOT_MIN + LYR.DOT_RANGE * c01(3 * p - k)) * breath) * alpha, x = cx + (k - 1) * LYR.DOT_SP;
      f.blend(x, cy, WHITE, a); f.blend(x - 1, cy, WHITE, a); f.blend(x + 1, cy, WHITE, a); f.blend(x, cy - 1, WHITE, a); f.blend(x, cy + 1, WHITE, a);
    }
  };
  Wheel.prototype.drawCentre = function (f, sh, pos, monoMs, ws, accent) {
    var dotsY = this.centreDotsY(this.wheelT), self = this;
    if (this.active < 0) {
      var first = sh.lines[0].startMs;
      if (first <= LYR.INTRO_MIN_MS) return;
      this.drawDots(f, pos / first, monoMs, dotsY, 1);
      return;
    }
    var ln = sh.lines[this.active];
    if (ln.interlude) {
      var rs = this.active; while (rs > 0 && sh.lines[rs - 1].interlude) rs--;
      var from = sh.lines[rs].startMs, remaining = gapRemainingMs(sh, pos, sh.durMs), el = pos - from, total = el + remaining;
      this.drawDots(f, total > 0 ? el / total : 1, monoMs, dotsY, 1);
      return;
    }
    var rows = this.cur.rows.length, fr = this.frame, cap = fr.centreCap, timed = ln.words.length > 0, clipTop = 0, clipBottom = 32;
    if (fr.windowed) { clipTop = fr.windowTop; clipBottom = fr.windowBottom; }
    // reduced motion: the line being sung is lit whole, with no sweep, lift or glow
    var whole = REDUCED && pos >= 0, lift = !REDUCED && liftAmt(ws.msIntoWord, ws.wordDurMs) >= LYR.LIFT_TH ? LYR.LIFT : 0;
    var aw = timed && ws.activeWord >= 0 ? ln.words[ws.activeWord] : null;
    var held = !REDUCED && !!aw && ws.wordDurMs >= LYR.GLOW_MIN_MS && aw.end - aw.start <= LYR.GLOW_MAX_CHARS, glow = held ? Math.min(1, ws.msIntoWord / LYR.GLOW_RAMP) : 0;
    for (var r = fr.firstRow; r <= fr.lastRow && r < rows; r++) {
      var capTop = fr.rowTop(r, this.rowScroll), L = line(CENTRE, cap, this.cur.rows[r]), x = this.rowX(L), base0 = this.cur.rowStart[r];
      // one fade for the row and its lifted and haloed copies, by its ink here and at rest before and after a scroll
      this.centreInk(this.inkA, ln, r, cap, rowOf(capTop));
      var ink = this.inkA, off = capTop - ink.capTop, y0 = this.rest.centreTop - ink.capTop + (r - this.scrollFrom) * this.rest.centrePitch, y1 = y0 + (this.scrollFrom - this.scrollTo) * this.rest.centrePitch;
      var fade = this.fadeOf(ink.minTop + off, ink.maxBottom + off, Math.min(fadeZone(ink.minTop + y0 - .5), fadeZone(ink.minTop + y1 - .5)),
        Math.min(fadeZone(30.5 - ink.maxBottom - y0), fadeZone(30.5 - ink.maxBottom - y1), LYR.IN_ROWS), clipTop, clipBottom);
      if (!timed) { this.drawRow(f, CENTRE, cap, L, x, capTop, 1, null, fade); continue; }
      var aS = 0, aE = 0, wl = 0, ww = 0;
      if (aw && aw.start >= base0 && aw.start < base0 + this.cur.rows[r].length) {
        var lo = 1e9, hi = -1e9;
        L.spans.forEach(function (s) { var b = base0 + s.i; if (b < aw.start || b >= aw.end) return; lo = Math.min(lo, s.x); hi = Math.max(hi, s.x + s.g.adv); });
        if (lo <= hi) { aS = aw.start; aE = aw.end; wl = lo; ww = hi - lo; }
      }
      var wordLeft = x + wl, sung = ws.sungTo, prog = ws.progress;
      if (glow > 0 && aE > aS) {
        var ga = LYR.GLOW_A * glow;
        var halo = function (X, Y, i) { var b = base0 + i; return b >= aS && b < aE ? [accent[0], accent[1], accent[2], ga] : null; };
        [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(function (o) { self.drawRow(f, CENTRE, cap, L, x + o[0], capTop + o[1] - lift, 1, halo, fade); });
      }
      var sweep = function (inWord) {
        return function (X, Y, i) {
          var b = base0 + i, iw = b >= aS && b < aE;
          if (iw !== inWord) return null;
          return whole ? 1 : sweepAlpha(X, b, sung, wordLeft, ww, aS, aE, prog);
        };
      };
      this.drawRow(f, CENTRE, cap, L, x, capTop, 1, sweep(false), fade);
      if (aE > aS) this.drawRow(f, CENTRE, cap, L, x, capTop - lift, 1, sweep(true), fade);
    }
  };
  // the Cover style's column: the cover at 80% from row 1, the time under it in the accent lifted toward white,
  // crossfading as the minute turns (LyricDecor::drawOver)
  Wheel.prototype.drawDecor = function (f, art, accent, dt) {
    if (this.style !== 'cover') return;
    var g = this.g, x0 = g.colCx - Math.floor(LYR.COVER_PX / 2);
    if (art) blitArt(f, art.t20, LYR.COVER_PX, x0, LYR.COVER_Y, LYR.COVER_LEVEL);
    else for (var y = 0; y < LYR.COVER_PX; y++) for (var x = 0; x < LYR.COVER_PX; x++) f.set(x0 + x, LYR.COVER_Y + y, mul(accent, .12 + .26 * (x + y) / (2 * (LYR.COVER_PX - 1))));
    var txt = clockText(now()), col = mix(accent, WHITE, LYR.TIME_TINT);
    if (this.timeNow !== txt) { this.timeBefore = this.timeNow; this.timeNow = txt; this.timeFade = this.timeBefore ? 0 : 1; }
    this.timeFade = REDUCED ? 1 : Math.min(1, this.timeFade + (dt || 0) / LYR.TIME_FADE);
    var k = smooth(0, 1, this.timeFade), base = capBase(LYR.COVER_TIME_TOP, LYR.TIME_CAP);
    if (k < 1 && this.timeBefore) { var B = line('label', LYR.TIME_CAP, this.timeBefore); drawText(f, B, penCentre(B, g.colCx), base, col, LYR.TIME_ALPHA * (1 - k)); }
    var T = line('label', LYR.TIME_CAP, txt);
    drawText(f, T, penCentre(T, g.colCx), base, col, LYR.TIME_ALPHA * (k < 1 && this.timeBefore ? k : 1));
  };
  // a frame (LyricsScene::render): the warp, then the wheel, then the decorations
  Wheel.prototype.draw = function (f, s, t, dt) {
    this.g = this.geom();
    if (!this.rest) this.rest = { prevTop: this.g.prevCapTop, prevPitch: this.g.rowStep, centreTop: this.g.curCapTop, centrePitch: this.g.rowStep, nextTop: this.g.nextCapTop, windowAbove: 0, windowBelow: 0 };
    if (this.fromInTop == null) { this.fromOutTop = this.rest.prevTop; this.fromOutPitch = this.rest.prevPitch; this.fromInTop = this.rest.centreTop; }
    var art = s ? artOf(s.tr) : null, accent = s ? s.accent : [119, 237, 215], sh = s ? sheetOf(s.tm) : null;
    dt = Math.min(Math.max(dt || 0, 0), .25);
    this.warp.setTexture(art ? art.tex : null);
    if (REDUCED) this.warp.fade = 1;
    this.warp.update(dt);
    this.warp.render(f, LYR.BG_DIM);
    if (!sh || !sh.lines.length) { this.started = false; this.drawDecor(f, art, accent, dt); return; }
    // resting (paused, or nothing played yet): the song's first sung line, unsung (not an instrumental intro's dots)
    var pos = s.rest ? -1 : s.pos * 1000, monoMs = t * 1000, idx = s.rest ? firstSung(sh) : activeLineIndex(sh, pos);
    var newSource = !this.started || sh !== this.sheet || this.gen !== textGen || this.boxW !== this.g.boxW;
    if (newSource || idx !== this.active) {
      // a new song, or a jump in one, comes up from dark rather than all at once
      if (!this.started || sh !== this.sheet || (!newSource && idx !== this.active + 1)) this.show = 0;
      this.sheet = sh; this.gen = textGen; this.boxW = this.g.boxW; this.started = true;
      if (!newSource && idx === this.active + 1) { this.stepFits(sh, idx); this.wheelT = 0; this.nextFade = 0; this.rowScroll = 0; this.retriggerGrow(); }
      else { this.refit(sh, idx); this.wheelT = 1; this.nextFade = 1; this.rowScroll = 0; this.retriggerGrow(); }
      // a line change sets off at the board's own speed so the new line is in place on time, a long line's scroll from rest
      this.speed.wheel = this.wheelT < 1 ? 1 / LYR.SCROLL_TAU : 0; this.speed.scroll = 0; this.scrollFrom = this.scrollTo = 0;
      if (idx >= 0) this.warp.pulse = 1;
    }
    // reduced motion: the wheel stands at rest
    this.wheelT = REDUCED ? 1 : glide(this.wheelT, 1, dt, this.speed, 'wheel');
    this.nextFade = REDUCED ? 1 : Math.min(1, this.nextFade + dt / LYR.NEXT_FADE);
    this.show = REDUCED ? 1 : Math.min(1, this.show + dt / LYR.SHOW_FADE);
    this.grow.step(REDUCED ? 1 : dt);
    var ws = { activeWord: -1, msIntoWord: 0, wordDurMs: 0, progress: 0, sungTo: 0 }, centre = this.centreText(sh);
    if (centre) { if (centre.words.length) ws = wordState(centre, pos); this.followRow(centre, ws, pos, dt); }
    this.frame = this.placeWheel(sh, this.wheelT, this.growScale(), false);
    this.drawSideSlot(f, sh, this.active - 1, this.prevF, true, monoMs);
    this.drawSideSlot(f, sh, this.active + 1, this.nextF, false, monoMs);
    this.drawCentre(f, sh, pos, monoMs, ws, accent);
    this.drawDecor(f, art, accent, dt);
    if (this.warm.length && this.wheelT > .9) this.warm.shift()();
  };
  // reduced motion: what a still frame of the lyrics shows, the song at rest or the line and the rows being sung
  Wheel.prototype.still = function (s) {
    var sh = s ? sheetOf(s.tm) : null, id = s && s.tr ? s.tr.id : '';
    if (!sh || !sh.lines.length || s.rest) return id + (sh ? ' rest' : '');
    var pos = s.pos * 1000, idx = activeLineIndex(sh, pos), ln = idx === this.active ? this.centreText(sh) : null;
    return id + ' ' + idx + (ln ? ' ' + this.scrollFor(ln, ln.words.length ? wordState(ln, pos) : null, pos) : '');
  };

  /* ---------- scenes ---------- */
  var S = {};

  // Classic, the owner's clock face: the sky tile, the clock in cells, the temperature, the date and the sky's word
  // (WeatherScene::renderClassic and WeatherLayout.h). The tile runs x 0..47, the clock from x 50 at cap 13.
  function classic(f, st, d, w, dt, fresh, lineCol) {
    st.sky.setTarget(w.look, w.phase, w.opts, fresh || REDUCED);
    st.sky.update(dt);
    f.fill(BLACK);
    f.clip(0, 0, 48, 32); st.sky.render(f, 0); f.noclip();
    var cc = CLOCK_COL[w.phase], acc = conditionAccent(w.look, w.phase), ct = clockText(d);
    var adv = drawTab(f, 'clock', 13, 12, 4, 50, capBase(3, 13), ct, cc);
    // the temperature: right ink on column 126, its ink top on the clock's cap top; the overflow ladder
    var room = 126 - 50, T = line('label', 9, w.temp);
    if (adv + 5 + T.inkW > room && adv + 2 + T.inkW > room) {
      var inkEnd = 50 + tabInk('clock', 13, 12, 4, ct).r;
      for (var cap = 8; cap >= 6; cap--) { T = line('label', cap, w.temp); if (126 - T.inkW - inkEnd >= 2) break; }
    }
    drawText(f, T, penRight(T, 126), 3 - T.t, acc);
    // the bottom row: the date in the clock's colour at LABEL's 70%, the sky's word right-aligned in the accent
    var base = lineCol ? 28 : 29, D = line('label', 6, DAYS[d.getDay()] + ' ' + d.getDate());
    drawText(f, D, penLeft(D, 50), base, cc, .7);
    var rowRoom = room + 1 - D.inkW - 2, Wd = line('label', 6, shortWord(w.code, w.look));
    if (Wd.inkW > rowRoom) Wd = line('label', 6, compactWord(w.code, w.look));
    if (Wd.inkW > rowRoom) Wd = line('label', 5, compactWord(w.code, w.look));
    if (Wd.inkW <= rowRoom) drawText(f, Wd, penRight(Wd, 126), base, acc);
  }
  S.time = function () {
    var st = { sky: new Sky(48, 14, 10.5, 3) }, fresh = true;
    return {
      label: 'Time', dur: 7, enter: function () { fresh = true; },
      draw: function (f, t, s, dt) { var d = now(); classic(f, st, d, weatherNow(d), dt, fresh); fresh = false; }
    };
  };

  // Big weather (FacesWeather.cpp): the time as large as columns 1..80 allow, on black, in the colour of the sky's hour;
  // the soft sky in a 44-px window with rounded corners at the right, the temperature centred along its foot on a halo.
  var bigCap = { gen: -1 };
  function bigTimeCap() {
    if (bigCap.gen === textGen) return bigCap;
    for (var cap = 26; cap > 10; cap--) { var c = cellsFor('clock', cap); if (4 * c.d + c.c <= 80) break; }
    bigCap = { gen: textGen, cap: cap, cells: cellsFor('clock', cap) };
    return bigCap;
  }
  function bigWeather(f, st, d, w, dt, fresh) {
    var WX0 = 84, WW = 43;
    var T = fit('label', [10, 9, 8, 7], w.temp, WW - 8) || line('label', 7, w.temp);
    var tpen = penCentre(T, WX0 + Math.floor(WW / 2)), tbase = 28 - T.b;
    st.sky.setTarget(w.look, w.phase, w.opts, fresh || REDUCED);
    st.sky.setSkyTime(w.sky);
    st.sky.setArc(w.arc, { x: tpen + T.l - WX0 - 1, y: tbase + T.t - 1, w: T.inkW + 2, h: T.inkH + 2 });
    st.sky.update(dt);
    f.fill(BLACK);
    f.clip(WX0, 1, WW, 30); st.sky.render(f, WX0); f.noclip();
    cornerMask(f, WX0, 1, WW, 30, 3);
    var bc = bigTimeCap(), ct = clockText(d), tw = tabWidth(bc.cells.d, bc.cells.c, ct);
    drawTab(f, 'clock', bc.cap, bc.cells.d, bc.cells.c, 1 + Math.floor((80 - tw) / 2), capBase(Math.floor((32 - bc.cap) / 2), bc.cap), ct, clockColorAt(w.sky));
    haloText(f, T, tpen, tbase, .75);
    drawText(f, T, tpen, tbase, WHITE);
  }
  S.weather = function (board) {
    // every weather screen shows the visitor's real weather (the owner, 2026-10-05); a board's old sample setting
    // (the tile's snow, the Sunset frame's clear day) is no longer used
    var forced = null, st = { sky: new Sky(43, 21, 12, 11) }, fresh = true;
    return {
      label: 'Weather', dur: 7, enter: function () { fresh = true; },
      draw: function (f, t, s, dt) { var d = now(); bigWeather(f, st, d, weatherNow(d, forced), dt, fresh); fresh = false; }
    };
  };
  S.wx = S.weather;

  // reduced motion: the lyrics go on only while the visitor listens; muted, the song rests on its first line
  function heardSong() { var sg = playingSong(); if (REDUCED && sg && !sg.audible) sg.rest = true; return sg; }
  // the lyrics: the words alone (the board's "Lyrics" style), sung as the radio plays
  S.song = function () {
    var v = new Wheel('lyrics');
    return { label: 'Lyrics', dur: 12, still: function () { return v.still(heardSong()); }, draw: function (f, t, s, dt) { v.draw(f, heardSong(), t, dt); } };
  };
  // the board's default lyric style, Cover: the cover with the time under it, the lyrics beside. Resting (paused, or a
  // song whose words have not loaded yet): the queued song's cover and its first line, unsung.
  S.combo = function () {
    var v = new Wheel('cover'), song = function () { var sg = heardSong(); if (sg && !sg.playing) sg.rest = true; return sg; };
    return {
      label: 'All in One', dur: 12,
      still: function () { return v.still(song()); },
      draw: function (f, t, s, dt) { v.draw(f, song(), t, dt); }
    };
  };
  S.cover = function () { var sc = S.combo(); sc.label = 'Lyrics'; return sc; };
  // the tiles' demo: an original verse, timed at a steady pace, on the plain ground (no cover)
  var STANZAS = [['we danced in', 'the kitchen light'], ['and the radio', 'sang all night']];
  var DEMO = (function () {
    var lines = [], t = 1.2;
    STANZAS.forEach(function (st) { st.forEach(function (txt) {
      var l = { words: [], t0: t, text: txt };
      txt.split(' ').forEach(function (w) { l.words.push({ text: w, t0: t, t1: t + .42 }); t += .42; });
      lines.push(l); t += .5;
    }); });
    lines.forEach(function (l, i) { l.t1 = lines[i + 1] ? lines[i + 1].t0 : t; });
    return { lines: lines, length: t + 1 };
  })();
  S.lyrics = function () {
    var v = new Wheel('lyrics');
    return { label: 'Lyrics', dur: DEMO.length, draw: function (f, t, s, dt) { v.draw(f, { tm: DEMO, pos: s % DEMO.length, accent: [255, 184, 28] }, t, dt); } };
  };

  // Now Playing (NowPlayingScene.cpp, CardLayout.h): the cover at the left, the title at x 36 cap 9, the artist at cap 6
  // and 70%, the accent progress bar on rows 27..28. A title that does not fit steps down, then pages whole words every
  // 3 s: never the board's glide, which crosses the box's edge.
  function pages(role, caps, str, maxW) {
    var L = fit(role, caps, str, maxW);
    if (L) return [L];
    var cap = caps[caps.length - 1], words = str.split(' '), out = [], cur = '';
    words.forEach(function (w) {
      var c = cur ? cur + ' ' + w : w;
      if (!cur || widthOf(line(role, cap, c)) <= maxW) cur = c; else { out.push(line(role, cap, cur)); cur = w; }
    });
    if (cur) out.push(line(role, cap, cur));
    return out;
  }
  function pageAlpha(n, t, k) {
    if (n === 1) return k === 0 ? 1 : 0;
    var into = (t % (3 * n)), page = Math.floor(into / 3), inP = into % 3, fd = smooth(0, 1, (inP - 2.75) / .25);
    if (k === page) return 1 - fd;
    if (k === (page + 1) % n) return fd;
    return 0;
  }
  S.art = function () {
    return {
      label: 'Album art', dur: 7,
      still: function () { var sg = playingSong(); return sg ? sg.tr.id + (sg.playing ? '' : ' paused') : ''; },
      draw: function (f, t, s, dt) {
        var sg = playingSong(), tr = sg ? sg.tr : { title: 'Night Harbour', artist: 'mooboard' }, accent = sg ? sg.accent : [255, 154, 60];
        var art = sg ? artOf(sg.tr) : null;
        f.fill(BLACK);
        if (art) blitArt(f, art.t30, 30, 1, 1, 1);
        else {
          washArt(f, accent, 1, 1, 30);
          var nc = mix(accent, WHITE, .55);
          for (var n = 0; n < 3; n++) {
            var ph = cyc(t * 1000 + (2 - n) * 230, 1400), lift = ph < .35 ? 1 - p2out(ph / .35) : p2in((ph - .35) / .65), by = 18 - Math.round(lift * 6), nx = 6 + n * 10;
            f.rect(nx - 2, by - 1, 3, 2, nc, .95); f.rect(nx + 1, by - 7, 1, 7, nc, .95); f.blend(nx + 2, by - 6, nc, .95); f.blend(nx + 3, by - 5, nc, .95);
          }
        }
        var tp = pages('label', [9, 8, 7], tr.title, 126 - 36 + 1), ap = pages('label', [6, 5], tr.artist, 126 - 36 + 1);
        tp.forEach(function (L, k) { var a = pageAlpha(tp.length, t, k); if (a > 0) drawText(f, L, penLeft(L, 36), capBase(5, L.cap), WHITE, a); });
        ap.forEach(function (L, k) { var a = pageAlpha(ap.length, t, k); if (a > 0) drawText(f, L, penLeft(L, 36), capBase(18, L.cap), WHITE, .7 * a); });
        // the progress bar on the song's own timeline: the preview starts `at` seconds into the song
        var total = sg && sg.tr.dur ? sg.tr.dur : 210, at = sg ? (sg.tr.at || 0) + sg.media : 84 + (t % 30);
        var prog = c01(at / total), bw = 123 - 36 + 1, filled = Math.floor(bw * prog);
        f.rect(36, 27, bw, 2, WHITE, .2);
        if (filled > 0) f.rect(36, 27, filled, 2, accent, sg && !sg.playing ? .5 : 1);
        // the site's level bars at the right of the artist's row, where the artist leaves room: they move while the
        // song plays and rest low when it is paused
        var aw = ap.length === 1 ? ap[0].inkW : 999;
        if (36 + aw + 6 + 14 <= 126) for (var bi = 0; bi < 4; bi++) {
          var lv = sg && sg.playing && !REDUCED ? .35 + .65 * Math.abs(Math.sin(t * (3.1 + bi * .9) + bi * 1.7)) : .3, hgt = Math.max(1, Math.round(lv * 6));
          f.rect(112 + bi * 4, 24 - hgt, 2, hgt, mix(accent, WHITE, .2), .95);
        }
      }
    };
  };

  // The event card (EventCardScene.cpp, CardLayout.h): the countdown at cap 6 in the event's colour lifted halfway to
  // white, the title at cap 9, the time and the place at cap 6 and 70%; here an event on the visitor's own clock, the
  // next quarter hour at least 40 minutes away, with 25 minutes of travel. Where the board has its colour bar, the
  // site has the owner's desk-calendar page (the weekday in its red header, the date on the page) and a sun walking
  // slowly along its arc toward the time to leave: the site's own, not on the board yet.
  S.calendar = function () {
    var bar = hexc('#7986CB'), red = hexc('#E5484D'), page = hexc('#F2EFEA'), ink = hexc('#1E2330');
    return {
      label: 'Calendar', dur: 7,
      draw: function (f, t, st) {
        var d = now(), dm = d.getHours() * 60 + d.getMinutes(), start = Math.ceil((dm + 40) / 15) * 15, leave = start - 25 - dm;
        var sh = Math.floor(start / 60) % 24, sm = start % 60, when = H12 ? ((sh + 11) % 12 + 1) + ':' + two(sm) + (sh < 12 ? ' AM' : ' PM') : two(sh) + ':' + two(sm);
        f.fill(BLACK);
        // the page: 22 x 25 at x 2, a red header with the weekday, the date on the white
        roundRect(f, 2, 4, 22, 25, 2.5, page, 1);
        roundRect(f, 2, 4, 22, 9, 2.5, red, 1); f.rect(2, 9, 22, 4, red);
        f.rect(6, 3, 2, 3, [150, 150, 158]); f.rect(18, 3, 2, 3, [150, 150, 158]);
        var wd = fit('label', [6, 5], DAYS[d.getDay()], 18) || line('label', 5, DAYS[d.getDay()]);
        drawText(f, wd, penCentre(wd, 12.5), 12 - wd.b, WHITE);
        var dn = fit('label', [10, 9, 8], String(d.getDate()), 18) || line('label', 8, String(d.getDate()));
        drawText(f, dn, penCentre(dn, 12.5), 26 - dn.b, ink);
        // the card's words beside it
        var X = 29;
        var C = line('label', 6, 'LEAVE IN ' + leave + ' MIN');
        drawText(f, C, penLeft(C, X), capBase(2, 6), mix(bar, WHITE, .5));
        var De = line('label', 6, when + ' · Studio B');
        // the title at cap 9 on cap top 11 where its ink (tails and all) keeps a dark row from the countdown above and
        // the details below; else a row up or down, else a cap smaller
        var r0 = capBase(2, 6) + C.b + 2, r1 = capBase(24, 6) + De.t - 2, Ti = null, tb = 0;
        [9, 8, 7].some(function (cap) {
          var L = fit('label', [cap], 'Yoga class', 126 - X + 1);
          if (!L || L.b - L.t > r1 - r0) return false;
          Ti = L; tb = Math.max(r0 - L.t, Math.min(r1 - L.b, capBase(11, cap)));
          return true;
        });
        if (!Ti) { Ti = line('label', 7, 'Yoga class'); tb = r1 - Ti.b; }
        drawText(f, Ti, penLeft(Ti, X), tb, WHITE);
        drawText(f, De, penLeft(De, X), capBase(24, 6), WHITE, .7);
        // the sun's arc in the room right of the title: a faint dotted path, the sun crossing it every 16 s
        var ax0 = Math.max(X + Ti.inkW + 8, 100), ax1 = 124, ay0 = 20, ay1 = 10;
        if (ax1 - ax0 >= 14) {
          var arc = function (u) { return [ax0 + (ax1 - ax0) * u, ay0 - (ay0 - ay1) * Math.sin(Math.PI * u)]; };
          for (var k = 0; k <= 8; k++) { var p0 = arc(k / 8); f.blend(Math.round(p0[0]), Math.round(p0[1]), [255, 216, 106], .3); }
          var u = REDUCED ? .5 : cyc(t, 16), sp = arc(u), sa = smooth(0, .06, u) * (1 - smooth(.94, 1, u));
          disc(f, sp[0], sp[1], 2.6, [255, 170, 40], .25 * sa); disc(f, sp[0], sp[1], 1.6, [255, 210, 70], sa);
        }
        void st;
      }
    };
  };

  /* ---------- scores: invented teams, never a real team's mark ---------- */
  var TEAMS = {
    MOO: { abbr: 'MOO', name: 'MOOSES', fill: [18, 140, 110], alt: [255, 196, 64] },   // Moo City Mooses
    PUM: { abbr: 'PUM', name: 'PUMAS', fill: [96, 52, 160], alt: [255, 150, 60] }      // Pasture Pumas
  };
  function scoreDigits(f, str, cap, x, base, anchor, col, a) {
    var c = cellsFor('clock', cap), w = tabWidth(c.d, c.c, str), x0 = anchor > 0 ? x - w + 1 : x;
    drawTab(f, 'clock', cap, c.d, c.c, x0, base, str, col, a);
    var ink = tabInk('clock', cap, c.d, c.c, str);
    return { l: x0 + ink.l, r: x0 + ink.r };
  }
  function football(f, x, y) {
    var leather = hexc('#C8692E');
    for (var j = 0; j < 4; j++) for (var i = 0; i < 7; i++) { if ((j === 0 || j === 3) && (i === 0 || i === 6)) continue; f.set(x + i, y + j, i === 3 && (j === 1 || j === 2) ? WHITE : leather); }
  }
  // Face-off, the default layout (sports/Faceoff.cpp): a team panel each side, the scores big either side of a dash,
  // the status under them; the ball and the timeouts in the team with the ball's panel
  function faceoff(f, sc, tint, t) {
    var P = 24, cx = 64;
    f.fill(BLACK);
    [['MOO', 0], ['PUM', 1]].forEach(function (e) {
      var tm = TEAMS[e[0]], x0 = e[1] ? 128 - P : 0;
      for (var y = 0; y < 32; y++) f.rect(x0, y, P, 1, mul(tm.fill, .5 - .22 * y / 31));
      var A = fit('label', [9, 8, 7, 6, 5], tm.abbr, P - 2) || line('label', 5, tm.abbr), cap = A.cap;
      drawText(f, A, x0 + Math.floor((P - A.inkW) / 2) - A.l, 12 - Math.floor(cap / 2) + Math.ceil(cap), WHITE);
      if (!e[1]) {
        football(f, x0 + P / 2 - 3, 23);
        for (var i = 0; i < 3; i++) f.rect(x0 + P / 2 - 8 + i * 6, 28, 4, 2, WHITE, i < 2 ? .85 : .15);
      }
    });
    var dashW = 6, dashL = cx - dashW / 2, a = scoreDigits(f, String(sc[0]), 18, dashL - 3 - 1, 21, 1, mix(WHITE, TEAMS.MOO.fill.map(function (v) { return Math.min(255, v * 1.6); }), tint), 1);
    scoreDigits(f, String(sc[1]), 18, dashL + dashW + 3, 21, -1, WHITE, 1);
    var D = line('clock', 18, '0'), dashY = 21 + D.t + Math.floor(D.inkH / 2) - 1;
    f.rect(dashL, dashY, dashW, 2, WHITE, .55);
    var stat = fit('label', [6, 5], 'Q3 4:12 · 3rd & 7', 128 - 2 * P - 4) || line('label', 5, 'Q3 4:12');
    drawText(f, stat, penCentre(stat, cx), 29 - stat.b, WHITE, .9);
    void a; void t;
  }
  // the score celebration (sports/Takeover.cpp): the panel cut to the team's colour, three gold flashes (none with
  // reduced motion), the chip's punch, TOUCHDOWN letter by letter, confetti, the name and the score ticking up
  function celebrate(f, ms, from, to) {
    var tm = TEAMS.MOO, bg = mul(tm.fill, .4), flashA = mul(tm.fill, .62), flashB = mul(tm.alt, .62), i;
    if (!REDUCED && ms < 900) {
      var on = [60, 393, 726].some(function (s) { return ms >= s && ms < s + 150; });
      f.fill(on ? (Math.floor(ms / 330) % 2 ? flashB : flashA) : bg);
      return;
    }
    f.fill(bg);
    var tau = ms - 900, steps = [12, 16, 20, 24, 28, 26], s = REDUCED ? 24 : tau < 240 ? steps[clamp(Math.floor(tau / 40), 0, 5)] : 24;
    var k = !REDUCED && tau >= 240 && ms < 2700 ? .8 + .15 * (.5 + .5 * Math.cos(2 * Math.PI * (tau - 240) / 600)) : .9;
    var out = 1 - smooth(0, 1, (ms - 3550) / 450), h = Math.max(10, s - 4), bx = 16 - s / 2, by = 16 - Math.floor(h / 2);
    roundRect(f, bx, by, s, h, 3.5, mul(tm.alt, .75 * k), out);
    var A = fit('bold', [Math.min(12, h * .55), 11, 10, 9, 8, 7, 6, 5, 4], tm.abbr, s - 4) || line('bold', 4, tm.abbr);
    drawText(f, A, bx + Math.floor((s - A.inkW) / 2) - A.l, by + Math.floor((h - Math.ceil(A.cap)) / 2) + Math.ceil(A.cap), BLACK, out);
    if (ms < 2700) {
      var word = 'TOUCHDOWN', Wd = fit('bold', [13, 12, 11, 10, 9], word, 124 - 34) || line('bold', 9, word), shown = REDUCED ? word.length : clamp(Math.floor((ms - 1050) / 55) + 1, 0, word.length);
      var wpen = penCentre(Wd, 79), wbase = capBase(16 - Math.ceil(Wd.cap / 2), Wd.cap);
      drawText(f, Wd, wpen, wbase, mix(tm.alt, WHITE, .1), 1, function (X, Y, ci) { return ci < shown ? 1 : null; });
      if (!REDUCED) for (i = 0; i < 36; i++) {
        var age = ms - 1100 - (i % 6) * 120;
        if (age < 0 || age > 1200) continue;
        var ang = hashf(51, i) * Math.PI * 2, sp = 18 + 30 * hashf(53, i), px = 79 + Math.cos(ang) * sp * age / 1000, py = 16 + Math.sin(ang) * sp * age / 1000 + 35 * Math.pow(age / 1000, 2);
        if (px < 33 || px > 125 || py < 2 || py > 29) continue;
        f.blend(px, py, [[255, 214, 120], WHITE, tm.alt, [255, 150, 185]][i % 4], 1 - age / 1200);
      }
    } else {
      var nm = line('label', 9, tm.name), beat = c01((ms - 2700) / 500), score = String(Math.round(from + (to - from) * beat));
      drawText(f, nm, penCentre(nm, 79), capBase(3, 9), mix(tm.alt, WHITE, .1), out);
      scoreDigits(f, score, 14, 79 - 2 - 2, 29, 1, WHITE, out);
      var dash = 79, D = line('clock', 14, '0');
      f.rect(dash - 1, 29 + D.t + Math.floor(D.inkH / 2) - 1, 4, 2, WHITE, .55 * out);
      scoreDigits(f, '14', 14, dash + 5, 29, -1, WHITE, .6 * out);
    }
  }
  S.score = function () {
    return {
      label: 'Scores', dur: 14,
      draw: function (f, t, st) {
        var ph = st % 14;
        if (ph < 5.5) faceoff(f, [17, 14], 0, t);
        else if (ph < 9.5) celebrate(f, (ph - 5.5) * 1000, 17, 23);
        else faceoff(f, [23, 14], 1 - smooth(0, 1, (ph - 9.5) / .9), t);
      }
    };
  };

  /* prayer-data:begin (tools/make-prayer.py) */
  var PRAYER = {"font":"Mukta ExtraBold (SIL OFL 1.1), rendered by the firmware pack code","ppem":16.0,"cycle":13.94,"name":"Gayatri Mantra","lines":[{"hi":"ॐ भूर्भुवः स्वः","en":"Om Bhur Bhuvah Svah","syl":[[-18,-4],[-1,10],[10,16],[16,21],[21,36],[36,56]],"hiT":[[0,660],[760,820],[880,1500],[1620,1760],[1880,2180],[2180,2540]],"words":[[0,660,0,1,0,1],[760,1500,1,2,1,1],[1620,2180,3,2,2,2],[2180,2540,5,1,4,1]],"enT":[[0,660,2],[760,1500,4],[1620,1760,3],[1880,2180,3],[2180,2540,4]],"slot":{"w":14,"h":13,"top":3,"px":"AAAHAABnB1DhPsC/pABUH6gA4PE/oI+LC789uED/ggvQB31YLv3S/5AGlAEAAA==","glyph":"om"},"gap":4,"strip":{"w":56,"h":20,"top":1,"px":"AAAAAJAGAAAAAAAAAAAAAAAA9AsAAAAAAAAAAAAAAAC4AAAAAAAAAAAAAAAAAHgAAAAAAAAAAABQUBUVtFVVVQFUVVVVFf3iv7/8////B/3///9/35fb9/Ra1WcBVG9VvVbPh9vy4EHZQwAAHpB9BN6Hi/Pg0f/jAgAu/X8twJcL8OXx0tMBuG9ufS3w/wv8//HBAwD4/x98APCrC/z64eaTAfCRbn0Y0IcL+ODR/+MC0Af8fy4AgAsA4AHZkwCAH5B9GADACwDwAcADAAAfAHwAAPQvAPwHAAAAAAAAAAAAuL2AlAsAAAAAAAAAAAC48eGXCwAAAAAAAAAAAPTTQv8HAAAAAAAAAAAAQEEAVAAAAAAAAAAAAA=="}},{"hi":"तत्सवितुर्वरेण्यं","en":"Tat Savitur Varenyam","syl":[[0,9],[9,20],[20,25],[25,38],[38,47],[47,54],[54,55],[55,63],[63,81]],"hiT":[[3380,3400],[3480,3640],[3780,3800],[3900,4060],[4120,4280],[4340,4580],[4920,5000],[5160,5600],[5980,6260]],"words":[[3380,3640,0,2,0,1],[3780,4580,2,4,1,3],[4920,6260,6,3,4,3]],"enT":[[3380,3640,3],[3780,3920,2],[4040,4140,2],[4260,4580,3],[4920,5000,2],[5160,6000,3],[6040,6260,3]],"strip":{"w":81,"h":20,"top":1,"px":"AAAAAAAAAAAAAAAAAOAHAAAAAAAAAAAAAAAA6BoAAAAA8P8BAAAAkAAAAAAAAAD8/wYAAADQpg8AAADABwAAAAAAAPRAfgAAAEALtAAAAAAJVVVVVVVV5VbVW1VVVX3VV1VVVVX9/////////////////////////1tVn1WVX259VvlW5VeVa/Xm5pbbGwA8AAB8uPBA6gJAD2QugIuLCy0e5P+Av/DhwoP/C/k/+L8QLi4uvXjw68Pv65cLTx8u/fr05eJ+uLi+4NEDTw/8/y88PbS40NOCi7/Q8rXARws8PdBTufD05eJCT18ufAD/w68fPfDwAC7gwoP/Sws9+L/QB6AC+H/wwYML8IELD6QufPRA6gI+AAAA4IELDy1ACy48ALTg0gOAC7ABAACABwQAEAAAAAAAAADQLwAAAAAAAAAAAAAAAAAAAAAAABT1AQAAAAAAAAAAAAAAAAAAAAAA8NYHAAAAAAAAAAAAAAAAAAAAAAAA/gsAAAAAAAAAAAAAAAAAAAAAAABQBQAAAAAAAAAA"}},{"hi":"भर्गो देवस्य धीमहि","en":"Bhargo Devasya Dhimahi","syl":[[0,10],[10,28],[28,36],[36,45],[45,66],[66,80],[80,90],[90,103]],"hiT":[[6880,6960],[7000,7400],[7720,7860],[8140,8220],[8380,8680],[8800,8880],[8920,9280],[9340,9560]],"words":[[6880,7400,0,2,0,2],[7720,8680,2,3,2,3],[8800,9560,5,3,5,3]],"enT":[[6880,7160,4],[7300,7400,2],[7720,7860,2],[8140,8400,3],[8580,8680,2],[8800,8940,3],[9260,9360,2],[9460,9560,2]],"strip":{"w":103,"h":17,"top":1,"px":"AAAAAFSAAVQAAAAAAAAAAAAAQAAAAAAAAAAAAAAA//0B/wEAAAAAAAAAAAD9AgAAQK4BAAAAAED6F0D6AAAAAAAAAAAAwPsBAAD4/wIAAAAAAPQAALQAAAAAAAAAAAC08AAAAB/kA1BQVVVVeQFUfVVVVVVVVRUAFXy5VVXVV+VXv/j/////gP//////////C+Av//////////99uebXqxtQlZtVvtVbub0BfJ6rX259ula9PR4u8PHhAgDlAqkL4AIuHgCP59KDCw8upB+ehwt4fLgA8L/g/wK41IsHgFu49ODCg4v/B+Hmoh8fLgB+BX24uG++4AHAPy49uPng4gIA/r/8x4cLwAdFDy3+/wt4APiKS4//P7j0K8CvLr7w4QLw0deXCx/Zqx8ALvTS01sPLv0v0IcLAXy4APT64f9CH5D/B0D/v/SgwYOLCx8A4AIAHy4A+D+QuoAfAOABQKovPQDw4OLBAwC4AMCHCwBQHgAtwAcAeAAAgEsPADy4+EEAAAAAAAAAAEALAAAAAAAAAAAAAAAAAAD4CwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOQB"}},{"hi":"धियो यो नः प्रचोदयात्","en":"Dhiyo Yo Nah Prachodayat","syl":[[0,14],[14,32],[32,50],[50,65],[65,74],[74,89],[89,98],[98,112],[112,123]],"hiT":[[10340,10400],[10480,10720],[11160,11280],[11620,11840],[12040,12140],[12180,12400],[12440,12460],[12740,12980],[13040,13880]],"words":[[10340,10720,0,2,0,2],[11160,11280,2,1,2,1],[11620,11840,3,1,3,1],[12040,13880,4,5,4,4]],"enT":[[10340,10500,3],[10600,10720,2],[11160,11280,2],[11620,11840,3],[12040,12200,3],[12320,12460,3],[12740,12860,2],[12960,13880,3]],"strip":{"w":123,"h":19,"top":1,"px":"AAAAAABUAAAAQAUAAAAAAAAAAABQAQAAAAAAAAAAAORvAAAA/gEAAOAfAAAAAAAAAAAA+AcAAAAAAAAAAID//wEAQPoBAACkHwAAAAAAAAAAAOkDAAAAAAAAAADwAfgCAACwAAAAAAsAAAAAAAAAAADQAgAAAAAAAAAAfUDhVlVVeQFUVZUXQFVVBVBVVVVV5VVVVVVVVVVVxb/98v////9B////H/T//wv8/////////////////9Pb67nW26sfQL29+gFU9VoBfrlWVa+uVW7m55drVX7w8Xku4OLRAwAuHj0AAHgEQA8uVcWHC5QL8PTgAkALfLiFS3149ADUh0cPAFVeD9CDy//z4YL/Qj49uOD/Ah/44/ILHj0Av+DRA+D/1wL04JJvfLj0VfRHDy7+vsCHr7i4gEcPgAt49AD89QEA/L7QAx8uLhR80IOLCy3w4QIuvfrRA9CrHz0ALXgYAPkv9OaHi0sfvv7g8kELfPT/C/l/9ACQ/0cPAABeDwCuC/j/4dLbB/4/uLjQAh+k6gIAHj0AAODRAwCAhwH04gJQfLjQ/wFADy49tMAHALgAgEcPAAB49AAA4AEAKLgAAB8uQLUA0IMLHy0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA0AcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAC"}}],"om":{"w":22,"h":21,"top":1,"px":"AAAAGAAAAEDRUwAAALgtHwAAgB/4AEBa8P8HQP8v+BsA8P8LAAAAVf4BuQIA0B/4/wEA/dH/P0D5C7/0C/wv+AO+wP/rH+APVP//AP4AwP8H8AsA+AeAfxDAP7D/glv/Qv8L/f8L9BtA/i8AAAAAFQAAAAA="}};
  /* prayer-data:end */
  // Prayer (PrayerScene.cpp, the Both view in colours A): before the singing, ॐ breathing between two flickering diyas
  // over the prayer's name; then the Gayatri Mantra, the Hindi line on rows 0-20 lit syllable by syllable in marigold
  // to rani pink across the panel (a soft-edged sweep, a white-hot pop as each syllable starts, a glow round one held a
  // second or more), and its English letters in cream under it, lit with it. A new line rises from below on the wheel.
  // The Devanagari is the board's own: the pack's strips (tools/make-prayer.py). Under the edge rule the sung word does
  // not lift into row 0 and the English letters end on row 30, one row higher than the board's.
  var MARIGOLD = hexc('#FFB81C'), RANI = hexc('#FF2E88'), CREAM = hexc('#FFF1DC');
  var PR = { unsung: .4, sung: 1, next: .3, popMs: 260, popWhite: .65, glowRampMs: 500, glowAlpha: .2, heldMs: 1000,
    tauMs: 160, swapMs: 120, leadInMs: 1500, start: 3.2, enCaps: [7, 6.5, 6, 5.5, 5], enTop: 22, enBottom: 30,
    probe: 'Hbdfhkltgjpqy' };
  function hindiCol(x) { return mix(MARIGOLD, RANI, c01(Math.max(0, Math.min(127, x)) / 127)); }
  function stripPx(s) {
    if (!s.lv) {
      var b = atob(s.px), n = s.w * s.h, lv = new Uint8Array(n);
      for (var i = 0; i < n; i++) lv[i] = (b.charCodeAt(i >> 2) >> ((i & 3) * 2)) & 3;
      s.lv = lv;
    }
    return s.lv;
  }
  function lvl(s, c, y) { return c < 0 || y < 0 || c >= s.w || y >= s.h ? 0 : stripPx(s)[y * s.w + c]; }
  // The glyph slot that leads a line (ॐ for now): a strip of its own, so a Prayer glyph set can replace it.
  var GLYPH_SLOTS = {};
  function slotOf(line) { return line.slot ? (GLYPH_SLOTS[line.slot.glyph] || line.slot) : null; }
  // The share of rows [top, top+h) inside the dark ring: a line moving over the edge on the wheel fades by it.
  function prEdgeFade(top, h) { var v = Math.min(top + h, H - 1) - Math.max(top, 1); return h <= 0 || v <= 0 ? 0 : v / h; }
  function sweepColumn(c, x0, x1, p) {
    var w = Math.max(1, x1 - x0), xs = x0 + w * (-.2 + 1.2 * c01(p)), soft = .2 * w + 1, cx = c + .5;
    return cx < xs ? PR.sung : cx >= xs + soft ? PR.unsung : PR.sung - (PR.sung - PR.unsung) * (cx - xs) / soft;
  }
  function sylProgress(t0, t1, ms) { return t1 <= t0 ? (ms >= t0 ? 1 : 0) : ms <= t0 ? 0 : ms >= t1 ? 1 : (ms - t0) / (t1 - t0); }
  function lastStarted(list, ms) {
    var k = -1;
    for (var i = 0; i < list.length; i++) { if (list[i][0] > ms) break; k = i; }
    return k < 0 ? { k: -1, p: 0, into: 0, len: 0 } : { k: k, p: sylProgress(list[k][0], list[k][1], ms), into: Math.max(0, ms - list[k][0]), len: list[k][1] - list[k][0] };
  }
  // prayer::locate over the mantra sung again and again: the line (counted on from the first), its syllables' state
  function prLocate(ms) {
    var Ls = PRAYER.lines, cyc = PRAYER.cycle * 1000;
    if (ms < 0) return { line: -1 };
    var rep = Math.floor(ms / cyc), m = ms - rep * cyc, k = 0;
    for (var i = 0; i < Ls.length; i++) if (Ls[i].hiT[0][0] <= m) k = i;
    var l = Ls[k], hi = lastStarted(l.hiT, m), en = lastStarted(l.enT, m);
    return { line: rep * Ls.length + k, k: k, m: m, hiSyl: hi.k, hiP: hi.p, hiInto: hi.into, hiLen: hi.len, enSyl: en.k, enP: en.p, enInto: en.into };
  }
  // englishFor: the largest cap whose ink (every ascender and descender the letters use) fits rows enTop..enBottom
  // and the width; each letter's syllable, shared out among its word's syllables by their letter counts
  var enCache = {};
  function prEnglish(k) {
    if (enCache[k]) return enCache[k];
    var l = PRAYER.lines[k], caps = PR.enCaps, lay = null;
    for (var i = 0; i < caps.length; i++) {
      var P = line('lyric', caps[i], PR.probe), T = line('lyric', caps[i], l.en), base = PR.enBottom - P.b;
      if ((base + P.t >= PR.enTop && T.inkW <= W - 2) || i === caps.length - 1) {
        lay = { L: T, base: base, pt: P.t, pb: P.b, x: 1 + Math.max(0, Math.floor((W - 2 - T.inkW) / 2)) - T.l };
        break;
      }
    }
    var txt = l.en, sylOf = [], tokens = [], m, re = /\S+/g;
    while ((m = re.exec(txt))) tokens.push([m.index, m.index + m[0].length]);
    var first = [], base2 = 0;
    l.words.forEach(function (w, wi) { first[wi] = base2; base2 += w[5]; });
    tokens.forEach(function (tk, ti) {
      var wi = tokens.length === l.words.length ? ti : Math.floor(ti * l.words.length / tokens.length), w = l.words[wi], e0 = w[4], en = w[5];
      var letters = 0, chars = 0, b;
      for (b = tk[0]; b < tk[1]; b++) if (/[A-Za-z]/.test(txt[b])) letters++;
      for (var q = 0; q < en; q++) chars += l.enT[e0 + q][2];
      var seen = 0, kk = 0, cum = l.enT[e0][2];
      for (b = tk[0]; b < tk[1]; b++) {
        if (/[A-Za-z]/.test(txt[b])) {
          while (kk + 1 < en && seen * Math.max(chars, 1) >= cum * Math.max(letters, 1)) { kk++; cum += l.enT[e0 + kk][2]; }
          seen++;
        }
        sylOf[b] = first[wi] + kk;
      }
    });
    var x0 = [], x1 = [];
    lay.L.spans.forEach(function (s) { var kk = sylOf[s.i]; if (kk == null) return; x0[kk] = Math.min(x0[kk] == null ? 1e9 : x0[kk], s.x); x1[kk] = Math.max(x1[kk] == null ? -1 : x1[kk], s.x + s.g.adv); });
    lay.sylOf = sylOf; lay.x0 = x0; lay.x1 = x1;
    return (enCache[k] = lay);
  }
  // a line's pixels only where the ring leaves the panel lit (rows and columns 1..126), for a line on the move
  function drawTextClipped(f, L, pen, base, col, alpha, shade) {
    for (var k = 0; k < L.spans.length; k++) {
      var s = L.spans[k], g = s.g;
      if (!g.w) continue;
      for (var yy = 0; yy < g.h; yy++) for (var xx = 0; xx < g.w; xx++) {
        var av = g.a[yy * g.w + xx], X = pen + s.x + g.x + xx, Y = base + g.y + yy;
        if (!av || X < 1 || Y < 1 || X > W - 2 || Y > H - 2) continue;
        var a = alpha * av / 255, c = col, sh = shade ? shade(X, Y, s.i) : null;
        if (shade) { if (sh == null) continue; if (typeof sh === 'number') a *= sh; else { c = sh; if (sh[3] != null) a *= sh[3]; } }
        f.blend(X, Y, c, a);
      }
    }
  }
  // one line of the prayer at `dy` rows from its place: role 0 the line being sung, 2 one already sung
  function prLine(f, n, dy, role, alpha, pos, animated) {
    var k = ((n % PRAYER.lines.length) + PRAYER.lines.length) % PRAYER.lines.length, l = PRAYER.lines[k], s = l.strip, slot = slotOf(l);
    var slotW = slot ? slot.w + l.gap : 0, wAll = slotW + s.w, x = 1 + Math.max(0, Math.floor((W - 2 - wAll) / 2)) + slotW;
    var cur = role === 0 && pos.line === n, ms = pos.m;
    // ---- the Hindi: columns relative to the strip after the slot; syllable 0 of a slotted line is the slot
    var top = s.top + dy, fade = prEdgeFade(top, s.h) * alpha;
    var glow = 0, pop = 0, act = null;
    if (cur && animated && pos.hiSyl >= 0) {
      act = l.syl[pos.hiSyl];
      if (pos.hiSyl === 0 && slot) act = [-slotW, -l.gap];
      if (pos.hiP < 1) { glow = pos.hiLen >= PR.heldMs ? c01(pos.hiInto / PR.glowRampMs) : 0; pop = PR.popWhite * Math.max(0, 1 - pos.hiInto / PR.popMs); }
    }
    function colAlpha(c) {
      if (role === 2) return PR.sung;
      if (!cur) return pos.line > n ? PR.sung : PR.unsung;
      if (!animated) {
        for (var wi = 0; wi < l.words.length; wi++) {
          var w = l.words[wi], a0 = sylX(w[2])[0], a1 = sylX(w[2] + w[3] - 1)[1];
          if (c >= a0 && c < a1) return ms >= w[0] ? PR.sung : PR.unsung;
        }
        return PR.unsung;
      }
      for (var q = 0; q < l.syl.length; q++) {
        var r = sylX(q);
        if (c < r[0] || c >= r[1]) continue;
        return q < pos.hiSyl ? PR.sung : q === pos.hiSyl ? sweepColumn(c, r[0], r[1], pos.hiP) : PR.unsung;
      }
      return PR.unsung;
    }
    function sylX(q) { return q === 0 && slot ? [-slotW, -l.gap] : l.syl[q]; }
    var level = fade, ink = function (st, c, y) { return lvl(st, c, y); };
    if (level > 0) {
      // the held syllable's halo, under the glyphs: each blank pixel beside its ink once, at the strongest coverage
      if (glow > 0 && act && !(pos.hiSyl === 0 && slot)) {
        var halo = mix(hindiCol(x + (act[0] + act[1]) / 2), WHITE, .5);
        for (var yy = -1; yy <= s.h; yy++) for (var c = Math.floor(act[0]) - 1; c <= Math.ceil(act[1]); c++) {
          if (ink(s, c, yy)) continue;
          var best = 0;
          for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) { var nc = c + ox; if (nc >= act[0] && nc < act[1]) best = Math.max(best, ink(s, nc, yy + oy)); }
          var py = top + yy;
          if (best && py >= Math.max(1, dy) && py < Math.min(H - 1, dy + 21)) f.blend(x + c, py, halo, PR.glowAlpha * glow * best / 3 * fade);
        }
      }
      var drawStrip = function (st, sx, colOff) {
        for (var c = 0; c < st.w; c++) {
          var cc = c + colOff, px = sx + c, a = colAlpha(cc) * level, col = hindiCol(px), inAct = act && cc >= act[0] && cc < act[1];
          if (inAct && pop > 0 && a > PR.unsung * level + .01) col = mix(col, WHITE, pop);
          for (var y = 0; y < st.h; y++) {
            var v = ink(st, c, y), py = st.top + dy + y;
            if (!v || py < 1 || py > H - 2 || px < 1 || px > W - 2) continue;
            f.blend(px, py, col, a * v / 3);
          }
        }
      };
      if (slot) drawStrip(slot, x - slotW, -slotW);
      drawStrip(s, x, 0);
    }
    // ---- the English letters, lit with the singing
    var lay = prEnglish(k), efade = prEdgeFade(lay.base + dy + lay.pt, lay.pb - lay.pt + 1) * alpha;
    if (efade <= 0) return;
    var shade = function (X, Y, ci) {
      var kk = lay.sylOf[ci], a = PR.unsung, col = CREAM;
      if (role === 2 || (!cur && pos.line > n)) a = PR.sung;
      else if (cur && kk != null) {
        if (animated) {
          if (kk < pos.enSyl) a = PR.sung;
          else if (kk === pos.enSyl) {
            a = sweepColumn(X - lay.x, lay.x0[kk], lay.x1[kk], pos.enP);
            if (pos.enP < 1) col = mix(CREAM, WHITE, PR.popWhite * Math.max(0, 1 - pos.enInto / PR.popMs));
          }
        } else {
          var wi = 0; for (var q = 0; q < l.words.length; q++) if (kk >= l.words[q][4]) wi = q;
          a = ms >= l.words[wi][0] ? PR.sung : PR.unsung;
        }
      }
      return [col[0], col[1], col[2], a];
    };
    (dy ? drawTextClipped : drawText)(f, lay.L, lay.x, lay.base + dy, CREAM, efade, shade);
  }
  function diya(f, x, y, flame, sway, level) {
    [[0, 'E0892E'], [1, 'B8561B'], [2, '8E3A12'], [3, '6A2A0C']].forEach(function (b, r) { f.rect(x + b[0], y + r, 11 - 2 * b[0], 1, hexc(b[1])); });
    var cx = x + 5, core = mul(hexc('FFF3B0'), level), mid = mul(hexc('FFB81C'), level), outer = mul(hexc('FF6A00'), level);
    f.set(cx, y - 1, hexc('5A3A1A'));
    for (var i = 0; i < flame; i++) {
      var row = y - 2 - i, up = flame <= 1 ? 1 : i / (flame - 1), dx = up > .55 ? sway : 0;
      if (up < .7) { f.set(cx + dx - 1, row, outer); f.set(cx + dx + 1, row, outer); }
      f.set(cx + dx, row, up < .45 ? core : up < .85 ? mid : outer);
    }
  }
  S.prayer = function () {
    // the diyas' flames: a random walk each, stepped every 90 ms (hashed by step, so a still is the same every time)
    var fl = [{ h: 5, s: 0, l: 1 }, { h: 5, s: 0, l: 1 }], step = -1, shown = -2, prev = -1, wheel = 0, lastT = null, swapAt = -9, swapping = false;
    function flicker(t) {
      var n = Math.floor(t * 1000 / 90);
      if (n === step) return;
      if (step < 0 || n < step || n - step > 50) step = n - 1;
      for (; step < n; ) {
        step++;
        for (var i = 0; i < 2; i++) {
          var d = fl[i], r1 = hashf(step * 2 + i, 7), r2 = hashf(step * 2 + i, 11), r3 = hashf(step * 2 + i, 13), r4 = hashf(step * 2 + i, 17);
          d.h = Math.max(4, Math.min(6, d.h + Math.floor(r1 * 3) - 1));
          if (r2 < .35) d.s = Math.floor(r3 * 3) - 1;
          d.l = Math.max(.72, Math.min(1, d.l + (r4 * .24 - .12)));
        }
      }
    }
    return {
      label: 'Prayer', dur: 12,
      draw: function (f, t, st) {
        f.fill(BLACK);
        flicker(t);
        var dt = lastT == null ? 0 : Math.max(0, Math.min(.25, t - lastT));
        lastT = t;
        var animated = !REDUCED, ms = (st - PR.start) * 1000 - PR.leadInMs;
        if (st < PR.start) {
          // before the first line: ॐ breathes between 65% and full on a four-second breath, the diyas either side,
          // the prayer's name under ॐ between them
          shown = -2; prev = -1; wheel = 0;
          var om = PRAYER.om, breath = .65 + .35 * (.5 + .5 * Math.sin(((t * 1000) % 4000) / 4000 * 2 * Math.PI)), ox = Math.floor((W - om.w) / 2);
          for (var y = 0; y < om.h; y++) for (var c = 0; c < om.w; c++) { var v = lvl(om, c, y); if (v) f.blend(ox + c, om.top + y, hindiCol(ox + c), breath * v / 3); }
          diya(f, 1, 27, fl[0].h, fl[0].s, fl[0].l); diya(f, W - 1 - 11, 27, fl[1].h, fl[1].s, fl[1].l);
          var nameTop = om.top + om.h + 1, left = 1 + 13, room = W - 1 - 13 - left;
          for (var i = 0; i < PR.enCaps.length; i++) {
            var Nm = line('lyric', PR.enCaps[i], PRAYER.name), base = H - 2 - Nm.b;
            if (Nm.inkW > room || base + Nm.t < nameTop) continue;
            drawText(f, Nm, left + Math.floor((room - Nm.inkW) / 2) - Nm.l, base, CREAM, .85);
            break;
          }
          return;
        }
        var pos = prLocate(ms), n = pos.line < 0 ? 0 : pos.line;
        if (pos.line < 0) pos = { line: -1, m: ms };
        if (n !== shown) {
          var next = shown >= 0 && n === shown + 1;
          prev = shown >= 0 ? shown : -1;
          if (animated) { wheel = next || shown < 0 ? H : 0; if (!next && shown >= 0) prev = -1; }
          else { swapping = shown >= 0; swapAt = t; }
          shown = n;
        }
        if (animated) {
          wheel = wheel * Math.exp(-dt * 1000 / PR.tauMs);
          if (wheel < .05) wheel = 0;
          var off = Math.round(wheel);
          if (prev >= 0 && off > 0) prLine(f, prev, off - H, 2, 1, pos, animated);
          prLine(f, n, off, 0, 1, pos, animated);
        } else {
          var mm = swapping ? c01((t - swapAt) * 1000 / PR.swapMs) : 1;
          if (mm >= 1) swapping = false;
          if (mm < 1 && prev >= 0) prLine(f, prev, 0, 0, 1 - mm, pos, animated);
          prLine(f, n, 0, 0, mm, pos, animated);
        }
      }
    };
  };

  // now watching without a picture as NowWatchingScene.cpp and WatchFit.cpp draw it + the site shows six real titles in turn with no art
  var NW = { face: 'lyric', x: 61, right: 126, top: 2, rows: 29, box: 57, accent: [232, 116, 59], amber: hexc('#FFB347') };   // the title face is the lyric centre line as on the board
  var NW_HOLD = 1.6, NW_SPEED = 18, NW_EACH = 5;   // the marquee pace and holds + seconds a title that fits stays up
  var WATCHING = [
    { show: 'Bluey', se: 'S3 E12' },
    { show: 'Stranger Things', se: 'S4 E1' },
    { show: 'The Office', se: 'S4 E9' },
    { show: 'Dune: Part Two' },
    { show: 'Only Murders in the Building', se: 'S3 E8' },
    { show: 'Ted Lasso', se: 'S2 E8', paused: true }
  ];
  // whether a row fits the column from a pen at left + the pen moves right only for ink left of it
  function nwFits(L, left) { return L.empty || left - Math.min(0, L.l) + L.r <= NW.right; }
  function nwPen(L, left) { return left - Math.min(0, L.l); }
  function nwOver(L) { return L.empty ? 0 : Math.max(0, nwPen(L, NW.x) + L.r - NW.right); }
  // a row with px added after every glyph and its ink measured again
  function nwTrack(L, px) {
    var spans = L.spans.map(function (sp, i) { return { x: sp.x + i * px, g: sp.g, i: sp.i }; }), l = 1e9, r = -1e9;
    spans.forEach(function (sp) { if (sp.g.w) { l = Math.min(l, sp.x + sp.g.x); r = Math.max(r, sp.x + sp.g.x + sp.g.w - 1); } });
    return { role: L.role, cap: L.cap, str: L.str, spans: spans, adv: L.adv + (spans.length - 1) * px, empty: L.empty, l: l, r: r, t: L.t, b: L.b, inkW: r - l + 1, inkH: L.inkH };
  }
  // two rows split at a space + boxed prefers rows inside the column then the narrowest widest row then the least spread
  function nwSplit(words, cap, boxed) {
    var best = null;
    for (var k = 1; k < words.length; k++) {
      var rows = [line(NW.face, cap, words.slice(0, k).join(' ')), line(NW.face, cap, words.slice(k).join(' '))];
      var over = boxed ? rows.filter(function (L) { return nwOver(L) > 0; }).length : 0;
      var w = rows.map(function (L) { return nwPen(L, NW.x) + L.r - NW.x + 1; }), wide = Math.max(w[0], w[1]), spread = Math.abs(w[0] - w[1]);
      if (!best || over < best.over || (over === best.over && (wide < best.wide || (wide === best.wide && spread < best.spread)))) best = { rows: rows, over: over, wide: wide, spread: spread };
    }
    return best.rows;
  }
  // rows set cap plus 2 apart + further where their ink would touch
  function nwStack(rows, cap) {
    var base = [], y = 0;
    rows.forEach(function (L, i) { if (i) y += Math.max(Math.floor(cap) + 2, rows[i - 1].b - L.t + 2); base.push(y); });
    var top = base[0] + rows[0].t, bottom = base[base.length - 1] + rows[rows.length - 1].b;
    return { rows: rows, base: base, top: top, height: bottom - top + 1 };
  }
  // the small row + an episode shows its season and episode behind the pause sign while paused + a film shows now showing letter spaced where it fits
  function nwSmall(item) {
    var sm = { pause: false, col: NW.accent, left: NW.x, L: null };
    if (item.se) {
      sm.L = line('label', 6, item.se);
      sm.pause = !!item.paused && nwFits(sm.L, NW.x + 9);
      if (sm.pause) sm.left = NW.x + 9;
    } else {
      var plain = line('label', 6, item.paused ? 'INTERMISSION' : 'NOW SHOWING'), tries = [nwTrack(plain, 1), plain, nwTrack(plain, -1)];
      sm.L = tries.filter(function (L) { return nwFits(L, NW.x); })[0] || tries[2];
      sm.col = NW.amber;
    }
    sm.top = sm.pause ? Math.min(sm.L.t, -6) : sm.L.t;
    sm.height = (sm.pause ? Math.max(sm.L.b, -1) : sm.L.b) - sm.top + 1;
    return sm;
  }
  // the fit ladder + one still row at cap 11 to 9 + two still rows at cap 9 to 7 + else rows that glide + the block centred between the margins
  function nwLayout(item) {
    var words = item.show.split(/\s+/).filter(Boolean), text = words.join(' '), sm = nwSmall(item), title = null, rows, k, n, c;
    var room = function (st) { return st.height + 1 + sm.height <= NW.rows; };
    var still = [[1, 11], [1, 10], [1, 9], [2, 9], [2, 8], [2, 7]];
    for (k = 0; k < still.length && !title; k++) {
      if (still[k][0] === 2 && words.length < 2) continue;
      rows = still[k][0] === 1 ? [line(NW.face, still[k][1], text)] : nwSplit(words, still[k][1], true);
      if (rows.some(function (L) { return nwOver(L) > 0; })) continue;
      var st1 = nwStack(rows, still[k][1]);
      if (room(st1)) title = st1;
    }
    for (n = 2; n >= 1 && !title; n--) for (c = 9; c >= 7 && !title; c--) {
      if (n === 2 && words.length < 2) continue;
      var st2 = nwStack(n === 1 ? [line(NW.face, c, text)] : nwSplit(words, c, false), c);
      if (room(st2)) title = st2;
    }
    var height = title.height + 1 + sm.height, top = NW.top + Math.floor((NW.rows - height) / 2), travel = 0;
    var out = title.rows.map(function (L, i) { var tr = nwOver(L); travel = Math.max(travel, tr); return { L: L, pen: nwPen(L, NW.x), base: top - title.top + title.base[i], travel: tr }; });
    return { rows: out, small: sm, smallPen: nwPen(sm.L, sm.left), smallBase: top + title.height + 1 - sm.top, travel: travel, paused: !!item.paused, gen: textGen };
  }
  function nwRound(travel) { return travel > 0 ? 2 * NW_HOLD + 2 * Math.max(.001, travel / NW_SPEED) : 0; }
  // hold then glide eased then hold then glide back as the board bounces a row too wide for its column
  function nwProgress(travel, u) {
    var glide = Math.max(.001, travel / NW_SPEED);
    if (u < NW_HOLD) return 0;
    u -= NW_HOLD;
    if (u < glide) return smooth(0, 1, u / glide);
    u -= glide;
    if (u < NW_HOLD) return 1;
    u -= NW_HOLD;
    return u < glide ? 1 - smooth(0, 1, u / glide) : 0;
  }
  function nwLine(f, x0, y0, x1, y1, col, a) {
    var dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1, e = dx + dy;
    for (;;) {
      f.blend(x0, y0, col, a);
      if (x0 === x1 && y0 === y1) return;
      var e2 = 2 * e;
      if (e2 >= dy) { e += dy; x0 += sx; }
      if (e2 <= dx) { e += dx; y0 += sy; }
    }
  }
  // the tv set as the firmware draws it + a rounded body with a lit screen and a play sign + rabbit ears and two feet
  function nwTvSet(f, col) {
    var cx = 28, x0 = 15, y0 = 8, a = .95, i, k;
    for (i = 1; i < 26; i++) { f.blend(x0 + i, y0, col, a); f.blend(x0 + i, y0 + 18, col, a); }
    for (i = 1; i < 18; i++) { f.blend(x0, y0 + i, col, a); f.blend(x0 + 26, y0 + i, col, a); }
    f.rect(x0 + 3, y0 + 3, 21, 13, col, .22);
    for (i = 0; i < 5; i++) for (k = 0; k < 2 * (4 - i) + 1; k++) f.blend(cx - 2 + i, y0 + 9 - (4 - i) + k, col, a);
    nwLine(f, cx - 1, y0 - 1, cx - 6, y0 - 7, col, a);
    nwLine(f, cx + 1, y0 - 1, cx + 6, y0 - 7, col, a);
    for (i = 0; i < 3; i++) { f.blend(x0 + 3 + i, y0 + 19, col, a); f.blend(x0 + 21 + i, y0 + 19, col, a); }
  }
  // a gliding row clipped to the text column as the board clips it
  function nwClipped(f, L, pen, base, col) {
    for (var k = 0; k < L.spans.length; k++) {
      var sp = L.spans[k], g = sp.g;
      if (!g.w) continue;
      for (var yy = 0; yy < g.h; yy++) for (var xx = 0; xx < g.w; xx++) {
        var av = g.a[yy * g.w + xx], X = pen + sp.x + g.x + xx, Y = base + g.y + yy;
        if (av && X >= NW.x && X <= NW.right && Y > 0 && Y < H - 1) f.blend(X, Y, col, av / 255);
      }
    }
  }
  S.tv = function () {
    var lay = [];
    function layout(i) { if (!lay[i] || lay[i].gen !== textGen) lay[i] = nwLayout(WATCHING[i]); return lay[i]; }
    function stay(i) { var L = layout(i); return L.travel ? Math.max(NW_EACH, nwRound(L.travel) + .4) : NW_EACH; }
    return {
      label: 'TV', dur: 7,
      draw: function (f, t, st) {
        var total = 0, i, x, y;
        for (i = 0; i < WATCHING.length; i++) total += stay(i);
        var u = (st || 0) % total;
        for (i = 0; i < WATCHING.length - 1 && u >= stay(i); i++) u -= stay(i);
        var L = layout(i);
        f.fill(BLACK);
        for (y = 0; y < H; y++) for (x = 0; x < NW.box; x++) f.set(x, y, mul(NW.accent, .12 + .26 * (x + y) / (NW.box - 1 + H - 1)));
        f.clip(0, 0, NW.box, H);
        nwTvSet(f, mix(NW.accent, WHITE, .55));
        f.noclip();
        if (L.paused) {
          for (y = 0; y < H; y++) for (x = 0; x < NW.box; x++) {
            var q = (y * W + x) * 3, grey = Math.round(.2126 * f.p[q] + .7152 * f.p[q + 1] + .0722 * f.p[q + 2]) * .8;
            f.set(x, y, [grey, grey, grey]);
          }
        }
        var go = L.travel ? nwProgress(L.travel, u) : 0;
        L.rows.forEach(function (r) {
          if (r.travel) nwClipped(f, r.L, r.pen - Math.floor(go * r.travel + .5), r.base, WHITE);
          else drawText(f, r.L, r.pen, r.base, WHITE);
        });
        drawText(f, L.small.L, L.smallPen, L.smallBase, L.small.col);
        if (L.small.pause) { f.rect(NW.x, L.smallBase - 6, 2, 6, WHITE, 1); f.rect(NW.x + 4, L.smallBase - 6, 2, 6, WHITE, 1); }
        void t;
      }
    };
  };

  // Lights: a room's lights following the music (the board's art sync) and the board's colour line along the bottom
  // in the lights' colour (HueLine.h: two rows, the colour scaled by the brightness, floored at a quarter, a 200 ms
  // walk to a new colour). The light card with the room's name, brightness and colour is the site's own: the board
  // shows the line alone.
  function colourName(c) {
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
    if (d < .12) return mx > .8 ? 'WHITE' : 'SILVER';
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    return h < 15 || h >= 340 ? 'RED' : h < 40 ? 'ORANGE' : h < 65 ? 'YELLOW' : h < 150 ? 'GREEN' : h < 185 ? 'MINT' : h < 250 ? 'BLUE' : h < 290 ? 'VIOLET' : 'PINK';
  }
  S.lights = function () {
    var cur = null, from = null, at = -9, sc;
    return (sc = {
      label: 'Lights', dur: 7, glow: [119, 237, 215],
      still: function () { var sg = playingSong(); return sg ? sg.accent.join() : ''; },
      draw: function (f, t) {
        var sg = playingSong(), want = sg ? sg.accent : [119, 237, 215];
        if (!cur) cur = want;
        if (want.join() !== cur.join()) { from = mix(from || cur, cur, 1); cur = want; at = t; }
        var k = from && !REDUCED ? smooth(0, 1, (t - at) / .2) : 1, col = from ? mix(from, cur, k) : cur, bri = .8;
        if (k >= 1) from = null;
        sc.glow = col;
        f.fill(BLACK);
        // a bulb at the left in the lights' colour, a soft glow round it
        var lc = mix(col, WHITE, .25);
        for (var y = 1; y < 31; y++) for (var x = 1; x < 28; x++) { var dx = x + .5 - 13, dy = y + .5 - 12, g2 = c01(1 - Math.sqrt(dx * dx + dy * dy) / 13); if (g2 > 0) f.blend(x, y, col, .28 * g2 * g2 * bri); }
        disc(f, 13, 11, 6.2, lc, bri); f.rect(10, 17, 7, 2, lc, bri);
        f.rect(10, 20, 7, 1, [150, 150, 160]); f.rect(10, 22, 7, 1, [150, 150, 160]); f.rect(11, 24, 5, 1, [120, 120, 130]);
        // the room's name, its brightness and colour, straight on the panel
        var nm = fit('label', [9, 8, 7], "Cow's Bedroom", 126 - 33) || line('label', 7, "Cow's Bedroom");
        drawText(f, nm, penLeft(nm, 33), capBase(4, nm.cap), WHITE);
        var sub = line('label', 6, Math.round(bri * 100) + '% · ' + colourName(col));
        drawText(f, sub, penLeft(sub, 33), capBase(17, 6), mix(col, WHITE, .45));
        // the colour line, rows 29..30 here (the dark ring keeps row 31), the whole width inside the ring
        var line2 = mul(col, Math.max(.25, bri));
        f.rect(1, 29, 126, 2, line2);
      }
    });
  };

  /* ---------- the clock faces (clock/Faces*.cpp), for the tile that shows them ---------- */
  // Big time (BigTimeFace): SF Pro's clock face at cap 28 whatever the family (the owner, 2026-09-29: "Keep SF Pro for
  // big time"; from the visitor's own system here, never bundled), cap top row 2, centred in its cells ("12:58" is
  // 4 x 25 + 9 = 109 px), in the clock colour of the hour. The colon is raised to the digits' middle and blinks
  // softly: full for the first half of each second, 15% for the rest, 0.1 s fades (still under reduced motion).
  function bigTime(f, d) {
    var ct = clockText(d), cells = fcCellsAt('bigClock', 28), w = tabWidth(cells.d, cells.c, ct);
    fcTab(f, 'bigClock', 28, cells, Math.floor((128 - w) / 2), capBase(2, 28), ct, CLOCK_COL[weatherNow(d).phase], 1,
      REDUCED ? 1 : fcSoftBlink(d.getMilliseconds() / 1000));
  }
  // Seven-segment (SegmentFace): 16 x 28 digits of 4-px slanted segments with mitred ends, the unlit ones ghosted at
  // 7.5%, amber #FFA41C; AM and PM as words at the left of a 12 h clock, their ink 5 px clear of the first digit
  var SEG_MASK = [0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F], SEG_W = 20, SEG_H = 28, SLANT = .105, segMasks = null;
  function buildSegMasks() {
    var w = 12, h = 24, t = 2, gap = .9, l = t, r = t + w, top = t, mid = t + h / 2, bottom = t + h;
    var segs = [[l, top, r, top], [r, top, r, mid], [r, mid, r, bottom], [l, bottom, r, bottom], [l, mid, l, bottom], [l, top, l, mid], [l, mid, r, mid]];
    return segs.map(function (sg) {
      var ax = sg[0], ay = sg[1], bx = sg[2], by = sg[3], horiz = ay === by, mx = (ax + bx) / 2, my = (ay + by) / 2, half = (horiz ? bx - ax : by - ay) / 2 - gap, m = new Uint8Array(SEG_W * SEG_H);
      for (var y = 0; y < SEG_H; y++) for (var x = 0; x < SEG_W; x++) {
        var hits = 0;
        for (var sy = 0; sy < 4; sy++) for (var sx = 0; sx < 4; sx++) {
          var py = y + (sy + .5) / 4, px = x + (sx + .5) / 4 - SLANT * (SEG_H - py), along = horiz ? px - mx : py - my, perp = horiz ? py - my : px - mx;
          if (Math.abs(perp) <= t && Math.abs(along) + Math.abs(perp) <= half) hits++;
        }
        m[y * SEG_W + x] = Math.round(hits * 255 / 16);
      }
      return m;
    });
  }
  function sevenSegment(f, d) {
    segMasks = segMasks || buildSegMasks();
    var on = hexc('#FFA41C'), off = mul(on, .075), h = d.getHours(), hh = H12 ? (h + 11) % 12 + 1 : h, mm = d.getMinutes();
    var digits = [H12 && hh < 10 ? -1 : Math.floor(hh / 10), hh % 10, Math.floor(mm / 10), mm % 10], x0 = H12 ? 28 : 20, dx = [x0, x0 + 21, x0 + 47, x0 + 68];
    digits.forEach(function (dg, i) {
      var m = dg < 0 ? 0 : SEG_MASK[dg];
      for (var sg = 0; sg < 7; sg++) {
        var mk2 = segMasks[sg], col = (m >> sg) & 1 ? on : off;
        for (var y = 0; y < SEG_H; y++) for (var x = 0; x < SEG_W; x++) { var v = mk2[y * SEG_W + x]; if (v) f.blend(dx[i] + x, 2 + y, col, v / 255); }
      }
    });
    var blink = REDUCED || d.getMilliseconds() < 500 ? 1 : .25;
    for (var k = 0; k < 2; k++) {
      var cy = 2 + (k === 0 ? 9 : 18), cx = x0 + 41 + Math.round(SLANT * (SEG_H - (cy - 2)));
      f.rect(cx, cy, 3, 3, mix(off, on, blink));
    }
    if (H12) {
      var pm = h >= 12, A = line('label', 6, 'AM'), P = line('label', 6, 'PM');
      drawText(f, A, penRight(A, x0 - 5), capBase(3, 6), pm ? off : on);
      drawText(f, P, penRight(P, x0 - 5), capBase(12, 6), pm ? on : off);
    }
  }
  // Analog + digital (AnalogFace): the dial at the left (#0D1016, a #3A4252 rim, 12 ticks), the hands, the time at cap
  // 18 from x 38, the date at 70% and the temperature in the accent beside it. The dial is a pixel smaller here so its
  // rim keeps off the dark ring.
  function analogFace(f, d, w) {
    var C = 16, cc = CLOCK_COL[w.phase] || WHITE;
    disc(f, C, C, 14.5, hexc('#0D1016')); ring(f, C, C, 14, .9, hexc('#3A4252'), 1);
    for (var k = 0; k < 12; k++) {
      var a = k * Math.PI / 6, sx = Math.sin(a), cy = Math.cos(a);
      if (k % 3 === 0) seg(f, C + 10.4 * sx, C - 10.4 * cy, C + 12.5 * sx, C - 12.5 * cy, .75, hexc('#9AA3B5'), 1);
      else disc(f, C + 11.7 * sx, C - 11.7 * cy, .55, hexc('#6A7282'));
    }
    var s = d.getSeconds() + d.getMilliseconds() / 1000, m = d.getMinutes() + s / 60, h = d.getHours() % 12 + m / 60;
    var hand = function (turns, len, hw) { var an = turns * 2 * Math.PI; seg(f, C, C, C + len * Math.sin(an), C - len * Math.cos(an), hw, cc, 1); };
    hand(h / 12, 7, 1.25); hand(m / 60, 11.2, .85);
    disc(f, C, C, 1.5, cc); disc(f, C, C, .5, BLACK);
    var cells = cellsFor('clock', 18);
    drawTab(f, 'clock', 18, cells.d, cells.c, 38, capBase(3, 18), clockText(d), cc);
    var D = line('label', 6, DAYS[d.getDay()] + ' ' + MONS[d.getMonth()] + ' ' + d.getDate()), T = line('label', 6, w.temp);
    drawText(f, D, penLeft(D, 38), capBase(24, 6), cc, .7);
    if (38 + D.inkW + 4 + T.inkW <= 126) drawText(f, T, penRight(T, 126), capBase(24, 6), conditionAccent(w.look, w.phase));
  }
  // The board's day faces (clock/Faces*.cpp, FaceId order). Each draws itself as draw(f, d, t, st, dt, s): d the time
  // shown, t the board's clock, st the seconds since it came on, dt the frame's step, s its own state (kept between its
  // turns). FACE_PORTS (below) adds the rest, ported from the firmware.
  // Sky (SkyFace): the whole panel is the sky at this minute. Its colours follow the sun's real elevation where the
  // board is (here the visitor's time zone's city, the weather's own place), the sun and the moon ride one arc across
  // it (east at rise, overhead at noon, west at set; the moon lags the sun by its phase), stars come out after dusk,
  // clouds follow the condition and drift, rain and snow fall from under them, and low hills take the sun as it sets.
  // The time sits low in the middle at cap 16 on rows 13..28 over a dark halo; the arc stays above row 12 wherever it
  // crosses the time's columns, so the sun and the moon never touch it.
  function skyFace(f, d, t, st, dt, s) {
    var ms = fcMotionMs(d), w = weatherNow(d), x, y;
    fcSunNow(s, d.getTime());
    var e = s.elev, zh = fcSkyColours(e), zen = zh[0], hor = zh[1];
    for (y = 0; y < 32; y++) { var row = mix(zen, hor, Math.pow(y / 31, 1.4)); for (x = 0; x < 128; x++) f.set(x, y, row); }
    // stars after dusk
    var starA = c01((-e - .06) / .14);
    if (starA > 0) FC_STARS.forEach(function (sr, i) { f.blend(sr[0], sr[1], hexc('EAF0FF'), starA * (.55 + .45 * fcWave(ms, sr[2], f32(i * f32(.37)))) * .85); });
    var moonUp = false, mxy = null;
    if (s.arcKnown) {
      if (s.sunF > -.06 && s.sunF < 1.06) {
        var sp = fcArc(s.sunF), sun = mix(hexc('FF7A2E'), hexc('FFF1B8'), c01(e * 3));
        disc(f, sp[0], sp[1], 7, mix(sun, hexc('FFE9A8'), .5), .2);
        disc(f, sp[0], sp[1], 2.7, sun, 1);
      }
      // the moon rides the arc with the weather's moon on
      if (w.opts.moonAtNight && s.moonF > -.06 && s.moonF < 1.06) {
        mxy = fcArc(s.moonF);
        var night = c01(-e * 4 + .3);
        disc(f, mxy[0], mxy[1], 5.5, hexc('9FB6E8'), .1 * night);
        moonDisc(f, mxy[0], mxy[1], 3.2, s.moon, mix(hexc('C8D2E6'), hexc('EEF2FA'), night), hexc('1C2436'), .55 * night, 1);
        moonUp = true;
      }
    }
    fcSkyWeather(f, ms, w, zen, s, moonUp && w.phase === 'night', mxy && mxy[0], mxy && mxy[1]);
    // low hills: the sun sets into something
    var hill = mul(zen, .25);
    for (x = 0; x < 128; x++) {
      var gy = 29 + fcLround(1.1 * Math.sin(x / 8.5) + .8 * Math.sin(x / 19 + 2));
      for (y = clamp(gy, 28, 31); y < 32; y++) f.set(x, y, hill);
    }
    if (w.look === 'fog') fcFogBanks(f, ms, w.phase);
    // the time: cap 16, centred, cap rows 13..28, over a dark halo
    var ct = clockText(d), cells = fcCellsAt('clock', 16), tx = Math.floor((128 - tabWidth(cells.d, cells.c, ct)) / 2), tb = capBase(13, 16);
    fcTab(f, 'clock', 16, cells, tx, tb, ct, null, 1, null, .55);
    fcTab(f, 'clock', 16, cells, tx, tb, ct, CLOCK_COL[w.phase], 1);
  }
  var FACES = [
    { id: 'classic', name: 'Classic', draw: function (f, d, t, st, dt, s) { if (!s.st) s.st = { sky: new Sky(48, 14, 10.5, 3) }; classic(f, s.st, d, weatherNow(d), dt, st === 0); } },
    { id: 'sky', name: 'Sky', draw: skyFace },
    { id: 'bigTime', name: 'Big time', draw: function (f, d, t) { bigTime(f, d, t); } },
    { id: 'analog', name: 'Analog', draw: function (f, d) { analogFace(f, d, weatherNow(d)); } },
    { id: 'sevenSegment', name: 'Seven segment', draw: function (f, d) { sevenSegment(f, d); } },
    { id: 'bigWeather', name: 'Big weather', draw: function (f, d, t, st, dt, s) { if (!s.st) s.st = { sky: new Sky(43, 21, 12, 11) }; bigWeather(f, s.st, d, weatherNow(d), dt, st === 0); } }
  ];
  var FACE_SECONDS = 4, FACE_TR = .7;
  // The faces tile: every face for about 4 s, in a new shuffled order each pass (never the same face twice running),
  // the board's sparkle between them. opts.face holds one face (the tests).
  S.faces = function (b) {
    var only = b && b.opts && b.opts.face, states = {}, order = [], pos = -1, cur = null, prev = null, since = 0, fa = new FB(), fb = new FB(), t8 = null, r = rng(b && b.opts && b.opts.seed || (Math.random() * 1e9) | 0);
    function list() { var L = FACE_PORTS.concat ? FACES.concat(FACE_PORTS) : FACES; return only ? L.filter(function (x) { return x.id === only; }) : L; }
    function deal() {
      var L = list().slice();
      for (var i = L.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), tmp = L[i]; L[i] = L[j]; L[j] = tmp; }
      if (cur && L.length > 1 && L[0].id === cur.id) { var tmp2 = L[0]; L[0] = L[1]; L[1] = tmp2; }
      order = L; pos = 0;
    }
    function draw(face, f, d, t, st, dt) { var s = states[face.id] || (states[face.id] = {}); f.fill(BLACK); face.draw(f, d, t, st, dt, s); }
    return {
      label: 'Clock faces', dur: FACE_SECONDS * 4,
      enter: function () { cur = null; prev = null; },
      draw: function (f, t, st, dt) {
        var d = now();
        if (!cur || st < since || st - since >= FACE_SECONDS) {
          if (pos < 0 || pos + 1 >= order.length) deal(); else pos++;
          prev = cur; cur = order[pos]; since = st;
          if (prev && prev.id === cur.id) prev = null;   // one face pinned (opts.face): no sparkle into itself
        }
        var into = st - since, p = prev ? into / (REDUCED ? .01 : FACE_TR) : 1;
        if (p >= 1 || !prev) { prev = null; draw(cur, f, d, t, into, dt); return; }
        // the board's Sparkle (TRANS): the new face lands LED by LED in a noise order, a warm white spark at its front
        draw(prev, fa, d, t, FACE_SECONDS + into, dt); draw(cur, fb, d, t, into, dt);
        composeFB('sparkle', p, fa, fb, f, t8 || (t8 = bytes3()));
      }
    };
  };
  // the faces ported from the firmware below (Flip, Nixie, Weather forward, Words, Day bar, Moon, Agenda, Minimal,
  // Word grid, Binary, Matrix rain): each { id, name, draw }
  var FACE_PORTS = [];

  /* ---------- Flip, Nixie, Binary and Matrix rain (clock/FacesDial.cpp, FacesSky.cpp) ---------- */
  // The firmware's tabular clock (clock::Kit): each cell the widest digit's advance (the colon its own), the colon
  // raised by `lift` to the digits' middle, each glyph's bitmap centred in its cell. These four faces lay out by it.
  function gaCells(role, cap) {
    var co = line(role, cap, ':'), H = line(role, cap, 'H').spans[0].g, cg = co.spans[0].g, c = { d: 0, c: co.adv, lift: 0 };
    for (var i = 0; i < 10; i++) c.d = Math.max(c.d, line(role, cap, String(i)).adv);
    c.lift = Math.round((cg.y + cg.h / 2) - (H.y + H.h / 2));
    return c;
  }
  function gaTabWidth(cells, str) { var w = 0; for (var i = 0; i < str.length; i++) w += str[i] === ':' ? cells.c : cells.d; return w; }
  // fn(x, y, coverage, i) for every inked pixel of a tabular string drawn from x (clock::forTabPixels)
  function gaTabPixels(role, cap, cells, x, base, str, fn) {
    for (var i = 0, pen = 0; i < str.length; i++) {
      var ch = str[i], colon = ch === ':', cw = colon ? cells.c : cells.d, g = line(role, cap, ch).spans[0].g;
      if (g.w) {
        var left = x + pen + ((cw - g.w) / 2 | 0), top = base + g.y - (colon ? cells.lift : 0);
        for (var r = 0; r < g.h; r++) for (var k = 0; k < g.w; k++) { var a = g.a[r * g.w + k]; if (a) fn(left + k, top + r, a / 255, i); }
      }
      pen += cw;
    }
  }
  // the same on the panel, glyph by glyph through drawText (its whole-glyph guard and the test log)
  function gaTab(f, role, cap, cells, x, base, str, col, alpha) {
    for (var i = 0, pen = 0; i < str.length; i++) {
      var ch = str[i], colon = ch === ':', cw = colon ? cells.c : cells.d, L = line(role, cap, ch), g = L.spans[0].g;
      if (g.w) drawText(f, L, x + pen + ((cw - g.w) / 2 | 0) - g.x, base - (colon ? cells.lift : 0), col, alpha);
      pen += cw;
    }
  }
  // a face's state is fresh each time it comes on (the firmware's enter())
  function gaEntered(s, st) { var e = s.lastSt == null || st < s.lastSt; s.lastSt = st; return e; }
  function gaPx(img, x, y) { var i = (y * W + x) * 3, p = img.p; return [p[i], p[i + 1], p[i + 2]]; }

  // Flip clock (FlipFace): two split flaps, the hour and the minutes, 56 wide at x 6 and 66, cap-24 digits, the hinge a
  // black gap across them with axle notches at both edges, the lower half's digit at 88%. A change folds the old top
  // half down to the hinge (0.3 s, shading as it turns), then drops the new bottom half from it (0.3 s); the hour flap
  // starts 0.12 s after the minutes. The board's flaps stand on rows 0..30: here they start on row 1 for the dark ring,
  // so the top half is a row shorter; the digits (ink rows 3..27) and the hinge (row 15) keep their rows.
  var FLIP = { w: 56, y: 1, h: 30, hinge: 14, base: 26, cap: 24, halfMs: 300, hourDelayMs: 120, x: [6, 66] };
  function gaFlapPaint(img, digits, col) {
    var F = FLIP, w = F.w, h = F.h, hinge = F.hinge, r = h >= 24 ? 3 : 2, cells = gaCells('clock', F.cap);
    img.noclip(); img.fill(BLACK);
    // each half a rounded rectangle cut at the hinge, so only the flap's outer corners are round
    img.clip(0, 0, w, hinge); roundRect(img, 0, 0, w, hinge + 4, r, hexc('#26262B'));
    img.clip(0, hinge + 1, w, h - hinge - 1); roundRect(img, 0, hinge - 3, w, h - hinge + 3, r, hexc('#1E1E22'));
    img.noclip();
    var x = (w - gaTabWidth(cells, digits)) / 2 | 0, lower = mul(col, .88);
    gaTabPixels('clock', F.cap, cells, x, F.base, digits, function (px, py, a) { if (px >= 0 && px < w && py >= 0 && py < h) img.blend(px, py, py > hinge ? lower : col, a); });
    for (var xx = 0; xx < w; xx++) img.set(xx, hinge, BLACK);
    for (var yy = hinge - 1; yy <= hinge + 1; yy++) { img.set(0, yy, BLACK); img.set(w - 1, yy, BLACK); }
  }
  // a frame of the turn: behind, the new top half and the old bottom half; in front, the old top half folding down to
  // the hinge, then the new bottom half dropping from it
  function gaFlapCompose(f, X, nw, od, ageMs) {
    var F = FLIP, w = F.w, h = F.h, hinge = F.hinge, done = 2 * F.halfMs, x, y, k;
    function row(src, sy, dy, shade) { for (var xx = 0; xx < w; xx++) { var c = gaPx(src, xx, sy); f.set(X + xx, F.y + dy, shade == null ? c : mul(c, shade)); } }
    if (ageMs < 0 || ageMs >= done) { var whole = ageMs < 0 ? od : nw; for (y = 0; y < h; y++) row(whole, y, y); return; }
    for (y = 0; y < hinge; y++) row(nw, y, y);
    for (y = hinge; y < h; y++) row(od, y, y);
    if (ageMs < F.halfMs) {
      var u = p2in(ageMs / F.halfMs), hh = Math.round(hinge * Math.cos(u * Math.PI / 2)), shade = .55 + .45 * Math.cos(u * Math.PI / 2);
      for (k = 0; k < hh; k++) row(od, Math.floor(k * hinge / Math.max(hh, 1)), hinge - hh + k, shade);
      return;
    }
    var v = p2out((ageMs - F.halfMs) / F.halfMs), span = h - hinge - 1, h2 = Math.round(span * Math.sin(v * Math.PI / 2)), sh2 = .55 + .45 * Math.sin(v * Math.PI / 2);
    for (k = 0; k < h2; k++) row(nw, hinge + 1 + Math.floor(k * span / Math.max(h2, 1)), hinge + 1 + k, sh2);
    for (x = 0; x < w; x++) f.set(X + x, F.y + hinge, BLACK);
  }
  function faceFlip(f, d, t, st, dt, s) {
    var ms = t * 1000, ct = clockText(d), ci = ct.indexOf(':'), want = [ct.slice(0, ci), ct.slice(ci + 1)];
    var col = CLOCK_COL[weatherNow(d).phase] || WHITE, key = col.join() + '|' + textGen, i;
    if (!s.flaps) s.flaps = [{ nw: new FB(), od: new FB() }, { nw: new FB(), od: new FB() }];
    if (gaEntered(s, st)) {
      for (i = 0; i < 2; i++) { var o = s.flaps[i]; o.shown = want[i]; gaFlapPaint(o.nw, want[i], col); o.od.copy(o.nw); o.turning = false; }
      s.key = key;
    }
    for (i = 0; i < 2; i++) {
      var p = s.flaps[i];
      if (want[i] === p.shown && key === s.key) continue;
      p.od.copy(p.nw); p.shown = want[i]; gaFlapPaint(p.nw, want[i], col);
      p.turning = !REDUCED; p.at = ms;
    }
    s.key = key;
    for (i = 0; i < 2; i++) {
      var q = s.flaps[i], delay = i === 0 ? FLIP.hourDelayMs : 0, done = 2 * FLIP.halfMs, age = done;
      if (q.turning) {
        var since = ms - q.at;
        age = since >= done + delay ? done : since - delay;
        if (age >= done) q.turning = false;
      }
      gaFlapCompose(f, FLIP.x[i], q.nw, q.od, age);
    }
  }

  // Nixie tubes (NixieFace): four IN-12 tubes 25 wide at x 6, 33, 70 and 97, Medium cap-22 digits glowing warm (the
  // stroke orange, a blurred halo round it, a hot core where it is thickest), the anode mesh in front and every unlit
  // cathode faintly behind; neon colon dots between the pairs. A changed digit crossfades in 0.25 s; on the hour the
  // tubes run the anti-poisoning cycle, settling left to right. The board's glass fills rows 0..31: here it stands on
  // rows 1..30 for the dark ring, the digits (ink rows 4..27) and their glow on the board's rows.
  var NIX = { w: 25, h: 32, cap: 22, base: 27, r: 6, x: [6, 33, 70, 97], colonX: 63.5 }, nixBuilt = null;
  function nixSprites() {
    if (nixBuilt && nixBuilt.gen === textGen) return nixBuilt;
    var w = NIX.w, h = NIX.h, n = w * h, sprites = [], ghost = new Float32Array(n), cells = { d: w, c: 0, lift: 0 };
    function blur(src, r) {
      var dst = new Float32Array(n);
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var sum = 0, count = 0;
        for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
          var yy = y + dy, xx = x + dx; count++;
          if (yy >= 0 && yy < h && xx >= 0 && xx < w) sum += src[yy * w + xx];
        }
        dst[y * w + x] = sum / count;
      }
      return dst;
    }
    for (var dg = 0; dg < 10; dg++) {
      var m = new Float32Array(n);
      gaTabPixels('medium', NIX.cap, cells, 0, NIX.base, String(dg), function (x, y, a) { if (x >= 0 && x < w && y >= 0 && y < h) m[y * w + x] = a; });
      var b1 = blur(m, 1), b2 = blur(b1, 2), sp = new Float32Array(n * 3);
      for (var i = 0; i < n; i++) {
        var core = m[i], halo = b2[i], hot = c01((b1[i] - .62) / .3) * core;
        sp[i * 3] = Math.floor(Math.min(255, 255 * .62 * halo + 255 * core));
        sp[i * 3 + 1] = Math.floor(Math.min(255, 52 * .62 * halo + 92 * core + 58 * hot));
        sp[i * 3 + 2] = Math.floor(Math.min(255, 4 * core + 22 * hot));
        ghost[i] = Math.max(ghost[i], core);
      }
      sprites.push(sp);
    }
    return (nixBuilt = { gen: textGen, sprites: sprites, ghost: ghost });
  }
  function faceNixie(f, d, t, st, dt, s) {
    var ms = t * 1000, ct = clockText(d), N4 = ct.length === 4, k, i, x, y;
    var want = N4 ? [-1, +ct[0], +ct[2], +ct[3]] : [+ct[0], +ct[1], +ct[3], +ct[4]], spr = nixSprites(), w = NIX.w;
    var mark = d.getHours() * 60 + d.getMinutes();
    if (gaEntered(s, st)) { s.cur = want.slice(); s.prev = want.slice(); s.fading = [false, false, false, false]; s.since = [0, 0, 0, 0]; s.mark = mark; s.cycling = false; }
    for (i = 0; i < 4; i++) {
      if (want[i] === s.cur[i]) continue;
      s.prev[i] = s.cur[i]; s.cur[i] = want[i]; s.fading[i] = !REDUCED; s.since[i] = ms;
    }
    if (mark !== s.mark && d.getMinutes() === 0 && !REDUCED) { s.cycling = true; s.cycleMs = ms; }   // the hourly cathode cycle
    s.mark = mark;
    var cyc = s.cycling ? (ms - s.cycleMs) / 1000 : 1e9;
    function blit(x0, dg, kk) {
      if (kk <= 0) return;
      var sp = spr.sprites[dg];
      for (var yy = 1; yy < H - 1; yy++) for (var xx = 0; xx < w; xx++) {
        var j = (yy * w + xx) * 3, r = sp[j], g = sp[j + 1], b = sp[j + 2];
        if (!(r || g || b)) continue;
        var q = ((yy * W) + x0 + xx) * 3, P = f.p;
        P[q] = Math.min(255, P[q] + Math.floor(r * kk)); P[q + 1] = Math.min(255, P[q + 1] + Math.floor(g * kk)); P[q + 2] = Math.min(255, P[q + 2] + Math.floor(b * kk));
      }
    }
    for (i = 0; i < 4; i++) {
      var x0 = NIX.x[i];
      // the glass: a faint envelope, a highlight down its left side, the unlit cathodes behind
      roundRect(f, x0, 1, w, H - 2, NIX.r, hexc('#0B0908'), 1);
      for (y = 5; y < 27; y++) f.blend(x0 + 2, y, hexc('#1C1814'), .9);
      for (y = 1; y < H - 1; y++) for (x = 0; x < w; x++) { var gh = spr.ghost[y * w + x]; if (gh > .35) f.blend(x0 + x, y, hexc('#2A1A10'), .55 * gh); }
      var settle = .55 + .18 * i;
      if (s.cycling && cyc < settle && s.cur[i] >= 0) blit(x0, (s.cur[i] + 1 + Math.floor(cyc / .055)) % 10, 1);
      else {
        var u = 1;
        if (s.fading[i]) { u = c01((ms - s.since[i]) / 250); if (u >= 1) s.fading[i] = false; }
        if (u < 1 && s.prev[i] >= 0) blit(x0, s.prev[i], 1 - u);
        if (s.cur[i] >= 0) blit(x0, s.cur[i], u);
      }
      // the hexagonal anode mesh in front: a diamond lattice that darkens what is behind it
      for (y = 3; y < NIX.h - 3; y++) for (x = 2; x < w - 2; x++) {
        if ((x + 2 * y) % 5 !== 0 && (x - 2 * y + 100) % 5 !== 0) continue;
        var c = gaPx(f, x0 + x, y);
        f.set(x0 + x, y, c[0] || c[1] || c[2] ? mul(c, .72) : hexc('#120906'));
      }
    }
    if (s.cycling && cyc >= .55 + .18 * 4) s.cycling = false;
    [11.5, 20.5].forEach(function (cy) { disc(f, NIX.colonX, cy, 3.2, hexc('#FF5000'), .22); disc(f, NIX.colonX, cy, 1.3, hexc('#FF9A40'), 1); });
  }

  // Binary (BinaryFace, BCD): one column per digit of hh mm ss, bits 8-4-2-1 from the top, dots of radius 2.6; hours
  // coral, minutes yellow, seconds green, the unlit bits at 11%. The decimal time (cap 16) and an H M S key sit beside it
  // from x 62, the seconds at the right of the key. It always shows seconds.
  function faceBinary(f, d) {
    var hr = d.getHours(), hour = H12 ? (hr % 12 === 0 ? 12 : hr % 12) : hr, mi = d.getMinutes(), se = d.getSeconds();
    var vals = [hour / 10 | 0, hour % 10, mi / 10 | 0, mi % 10, se / 10 | 0, se % 10], bits = [2, 4, 3, 4, 3, 4];
    var cols = [hexc('#FF6B5E'), hexc('#FFD23F'), hexc('#4ADE80')], colX = [5.5, 13.5, 25.5, 33.5, 45.5, 53.5], rowY = [4.5, 12, 19.5, 27];
    for (var c = 0; c < 6; c++) {
      var col = cols[c / 2 | 0];
      for (var b = 0; b < bits[c]; b++) disc(f, colX[c], rowY[3 - b], 2.6, vals[c] & (1 << b) ? col : mul(col, .11));
    }
    gaTab(f, 'clock', 16, gaCells('clock', 16), 62, capBase(3, 16), clockText(d), CLOCK_COL[weatherNow(d).phase] || WHITE);
    for (var k = 0, xk = 62; k < 3; k++) { var K = line('label', 6, 'HMS'[k]); drawText(f, K, penLeft(K, xk), capBase(24, 6), cols[k]); xk += K.inkW + 4; }
    var Ss = line('label', 6, two(se));
    drawText(f, Ss, penRight(Ss, 126), capBase(24, 6), cols[2]);
  }

  // Matrix rain (MatrixRainFace): dim green glyph trails falling behind a crisp time. 21 columns of mirrored cap-5
  // glyphs, two drops a column at 1.5 to 4 cells a second, heads #B8FFC8 and trails #1ED760 at most 62%, the time cap 20
  // in #DFFFE6. A glyph is drawn whole or not at all: one within a pixel of the time's ink, or reaching the dark ring, is
  // skipped. The drops run on the wall clock, so every board (and this page) rains the same at the same moment; with
  // reduced motion they hold still through each minute.
  function gaHash3(a, b, c) {
    var h = (Math.imul(a >>> 0, 0x9E3779B1) ^ Math.imul((b + 0x7F4A7C15) >>> 0, 0x85EBCA77) ^ Math.imul((c + 0x165667B1) >>> 0, 0xC2B2AE3D)) >>> 0;
    h = (h ^ (h >>> 15)) >>> 0; h = Math.imul(h, 0x2C1B3C6D) >>> 0;
    return (h ^ (h >>> 12)) >>> 0;
  }
  // the board's loop() in its own float arithmetic: on an epoch in the trillions of ms a speed rounded differently
  // moves the phase by whole cycles, so the drops fall where the board's do only in float32 (Math.fround)
  var gaFr = Math.fround;
  function gaLoop(epochMs, speed, offset, span) {
    var cyc = epochMs / 1000 / (span / speed), ph = gaFr(cyc - Math.floor(cyc));
    if (ph >= 1) ph = 0;
    var at = gaFr(gaFr(ph * span) + offset);
    return gaFr(gaFr(at % span + span) % span);
  }
  var RAIN_SET = '0123456789ABCDEFHKMNRSTXZ';
  function faceMatrixRain(f, d, t, st, dt, s) {
    var cap = 20, ct = clockText(d), cells = gaCells('clock', cap), x = (128 - gaTabWidth(cells, ct)) / 2 | 0, base = capBase(6, cap);
    if (s.maskFor !== ct + '|' + textGen) {   // the keep-out mask: the time's ink grown by a pixel
      var mask = s.mask = new Uint8Array(N);
      gaTabPixels('clock', cap, cells, x, base, ct, function (px, py, a) {
        if (a < .08) return;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var xx = px + dx, yy = py + dy; if (xx >= 0 && xx < W && yy >= 0 && yy < H) mask[yy * W + xx] = 1; }
      });
      s.maskFor = ct + '|' + textGen;
    }
    var epochMs = REDUCED ? Math.floor(d.getTime() / 60000) * 60000 : d.getTime(), wall = epochMs / 1000, head = hexc('#B8FFC8'), trail = hexc('#1ED760');
    for (var col = 0; col < 21; col++) {
      var h = gaHash3(col, 1, 2), speed = gaFr(1.5 + gaFr(gaFr(h % 100) / 40)), len = 4 + ((h >>> 8) % 5), period = 5 + len + 2 + ((h >>> 12) % 5);
      var head0 = gaFr(gaLoop(epochMs, speed, (h >>> 16) % 97, period) - 1), tick = Math.floor(wall * (.8 + (h % 7) * .2)) >>> 0;
      for (var row = 0; row < 5; row++) {
        // two drops a column, half a period apart
        var dist = gaFr(head0 - row);
        if (dist < 0) dist = gaFr(dist + period);
        if (dist >= period / 2) dist = gaFr(dist - period / 2);
        if (dist < 0 || dist >= len) continue;
        var isHead = dist < 1, k = isHead ? 1 : Math.pow(1 - dist / len, 1.6), c = isHead ? head : trail, alpha = (isHead ? .62 : .55) * k;
        var g = line('label', 5, RAIN_SET[gaHash3(col, row, tick) % RAIN_SET.length]).spans[0].g;
        if (!g.w) continue;
        var left = 1 + col * 6 + ((5 - g.w) / 2 | 0), top = row * 6 + 6 + g.y, clear = true, r, cc;
        for (r = 0; r < g.h && clear; r++) for (cc = 0; cc < g.w && clear; cc++) {
          var gx0 = left + cc, gy0 = top + r;
          if (gx0 < 1 || gx0 > W - 2 || gy0 < 1 || gy0 > H - 2 || s.mask[gy0 * W + gx0]) clear = false;
        }
        if (!clear) continue;
        for (r = 0; r < g.h; r++) for (cc = 0; cc < g.w; cc++) {
          var a = g.a[r * g.w + (g.w - 1 - cc)];   // mirrored, as the film's katakana
          if (a) f.blend(left + cc, top + r, c, alpha * a / 255);
        }
      }
    }
    gaTab(f, 'clock', cap, cells, x, base, ct, hexc('#DFFFE6'), 1);
  }
  FACE_PORTS.push({ id: 'flip', name: 'Flip', draw: faceFlip });
  FACE_PORTS.push({ id: 'nixie', name: 'Nixie', draw: faceNixie });
  FACE_PORTS.push({ id: 'binary', name: 'Binary', draw: faceBinary });
  FACE_PORTS.push({ id: 'matrixRain', name: 'Matrix rain', draw: faceMatrixRain });

  // ---- the typographic faces (clock/FacesType.cpp) and Day bar (clock/FacesSky.cpp) ----
  // Each wears the board's clock colour of the phase (pw::clockColor). The board's Show seconds is not on the site.

  // These faces set their clocks in the firmware's own cells (fcCellsAt and fcTab, with Weather forward below: every
  // digit in a cell as wide as the widest digit's advance, the colon raised to the digits' middle as stb bounds it).
  function faceTabWidth(c, str) { var w = 0; for (var i = 0; i < str.length; i++) w += str[i] === ':' ? c.c : c.d; return w; }

  // Minimal: a small, dim time in the middle of a black panel, the medium face at cap 9 on cap-top row 11 (rows
  // 11..19), 42% of the clock colour.
  function faceMinimal(f, d) {
    var ct = clockText(d), c = fcCellsAt('medium', 9);
    fcTab(f, 'medium', 9, c, ~~((128 - faceTabWidth(c, ct)) / 2), capBase(11, 9), ct, mul(CLOCK_COL[weatherNow(d).phase], .42), 1, 1);
  }

  // Words: "nine / fifty-nine" in the bold face at cap 10, each line centred by its ink, the minutes at 72%: "o'clock",
  // "noon", "midnight", "oh five", and "hundred" on a 24 h clock. The board stands the lines on baselines 12 and 28.
  // Here the browser's Fredoka takes a row more below the baseline than the board's (a y's tail reaches baseline + 3),
  // so the minutes stand on 27 (rows 16..30, the dark ring keeps 31) and the hour keeps rows 1..14: an hour word with a
  // descender (eight, eighteen, the twenties) takes the largest cap whose ink stays in its rows. Row 15 is always dark.
  var WORD_ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  var WORD_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty'];
  function numberWords(v) { return v < 20 ? WORD_ONES[v] : v % 10 === 0 ? WORD_TENS[v / 10] : WORD_TENS[Math.floor(v / 10)] + '-' + WORD_ONES[v % 10]; }
  function wordsPhrase(d) {
    var h = d.getHours(), m = d.getMinutes();
    var minute = m === 0 ? (!H12 ? 'hundred' : h === 12 ? 'noon' : h === 0 ? 'midnight' : "o'clock") : m < 10 ? 'oh ' + WORD_ONES[m] : numberWords(m);
    return [numberWords(H12 ? (h % 12 === 0 ? 12 : h % 12) : h), minute];
  }
  var WORDS_CAPS = [10, 9.75, 9.5, 9.25, 9, 8.5, 8];
  // the largest cap at which a line's ink stays inside rows top..bottom on its baseline and inside the ring's columns
  function wordsLine(str, base, top, bottom) {
    for (var i = 0; i < WORDS_CAPS.length; i++) {
      var L = line('bold', WORDS_CAPS[i], str);
      if (base + L.t >= top && base + L.b <= bottom && L.inkW <= W - 2) return L;
    }
    return line('bold', WORDS_CAPS[WORDS_CAPS.length - 1], str);
  }
  function faceWords(f, d) {
    var col = CLOCK_COL[weatherNow(d).phase], p = wordsPhrase(d);
    var Hr = wordsLine(p[0], 12, 1, 14), Mn = wordsLine(p[1], 27, 16, 30);
    drawText(f, Hr, penCentre(Hr, 64), 12, col, 1);
    drawText(f, Mn, penCentre(Mn, 64), 27, col, .72);
  }

  // Word grid: every word of the phrase book in four rows, the ones that tell the time lit (the rest at 13%), in the
  // bold face at the largest of cap 5 (tracked, then not), 4.75, 4.5 and 4.25 at which every row fits with 2 px between
  // its words; rows justified edge to edge; the 1-4 minutes past the five-minute step as 2 x 2 dots in the corners,
  // clockwise from the top left. Word clocks are 12 h by nature. The board's grid spans x 3..124 on cap-top rows 2,
  // 10, 18 and 26 with its dots in the panel's very corners; under the edge rule the dots move in a pixel (x 1/125,
  // rows 1/29), the rows justify to x 4..123 and stand a row higher (1, 9, 17, 25), and the browser's Fredoka needs
  // the 4.75 untracked try (its rows run 2-3 px wider than the board's at cap 5).
  var GRID_WORDS = [['IT', 0], ['IS', 0], ['HALF', 0], ['TEN', 0], ['QUARTER', 0], ['TWENTY', 0],
    ['FIVE', 1], ['MINUTES', 1], ['TO', 1], ['PAST', 1], ['ONE', 1], ['TWO', 1],
    ['THREE', 2], ['FOUR', 2], ['FIVE', 2], ['SIX', 2], ['SEVEN', 2], ['EIGHT', 2],
    ['NINE', 3], ['TEN', 3], ['ELEVEN', 3], ['TWELVE', 3], ["O'CLOCK", 3]];
  var GRID_ID = { IT: 0, IS: 1, HALF: 2, TEN: 3, QUARTER: 4, TWENTY: 5, FIVE: 6, MINUTES: 7, TO: 8, PAST: 9, OCLOCK: 22 };
  var GRID_HOUR = [0, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];   // 1..12 -> word
  var GRID_TOPS = [1, 9, 17, 25], GRID_X0 = 4, GRID_W = 120;
  var gridLay = { gen: -1 };
  // a line set without the small-cap pixel Fredoka takes between glyphs at cap 6 and under (the board's tracked =
  // false): line()'s walk with the tracking left out
  function lineUntracked(role, cap, str) {
    var capq = q4(cap), spans = [], pen = 0, prev = null, g;
    for (var i = 0; i < str.length; i++) {
      g = glyphOf(role, capq, str[i]);
      if (prev) pen += g.bitmap || prev.bitmap ? 0 : kernOf(role, capq, str[i - 1], str[i]);
      spans.push({ x: pen, g: g, i: i });
      pen += g.adv; prev = g;
    }
    var l = 1e9, r = -1e9, t = 1e9, b = -1e9;
    spans.forEach(function (s) { if (!s.g.w) return; l = Math.min(l, s.x + s.g.x); r = Math.max(r, s.x + s.g.x + s.g.w - 1); t = Math.min(t, s.g.y); b = Math.max(b, s.g.y + s.g.h - 1); });
    var empty = r < l, L = { role: role, cap: capq, str: str, spans: spans, adv: pen, empty: empty, l: empty ? 0 : l, r: empty ? -1 : r, t: empty ? 0 : t, b: empty ? -1 : b };
    L.inkW = L.r - L.l + 1; L.inkH = L.b - L.t + 1;
    return L;
  }
  function gridLayout() {
    if (gridLay.gen === textGen) return gridLay;
    var tries = [[5, true], [5, false], [4.75, false], [4.5, false], [4.25, false]], lines, sums, counts, least, k;
    for (k = 0; k < tries.length; k++) {
      var cap = tries[k][0], tracked = tries[k][1];
      lines = GRID_WORDS.map(function (w) { return tracked ? line('bold', cap, w[0]) : lineUntracked('bold', cap, w[0]); });
      sums = [0, 0, 0, 0]; counts = [0, 0, 0, 0];
      lines.forEach(function (L, i) { sums[GRID_WORDS[i][1]] += L.inkW; counts[GRID_WORDS[i][1]]++; });
      least = sums.map(function (s, r) { return s + 2 * (counts[r] - 1); });
      // every row's ink from its cap-top row down to two rows above the next row's (a dark row between), the last
      // row's down to row 30
      var tall = lines.every(function (L, i) {
        var r = GRID_WORDS[i][1], base = capBase(GRID_TOPS[r], cap);
        return base + L.t >= GRID_TOPS[r] && base + L.b <= (r < 3 ? GRID_TOPS[r + 1] - 2 : H - 2);
      });
      if (tall && Math.max.apply(null, least) <= GRID_W) break;
    }
    if (k === tries.length) k = tries.length - 1;
    var width = Math.max(GRID_W, Math.max.apply(null, least)), x0 = Math.floor((128 - width) / 2), pens = [];
    for (var r = 0; r < 4; r++) {
      var gaps = counts[r] - 1, room = width - sums[r], x = x0, j = 0;
      for (var i = 0; i < GRID_WORDS.length; i++) {
        if (GRID_WORDS[i][1] !== r) continue;
        pens[i] = penLeft(lines[i], x);
        x += lines[i].inkW + (j < gaps ? Math.floor(room / gaps) + (j < room % gaps ? 1 : 0) : 0);
        j++;
      }
    }
    gridLay = { gen: textGen, cap: tries[k][0], lines: lines, pens: pens };
    return gridLay;
  }
  function faceWordGrid(f, d) {
    var g = gridLayout(), lit = [], m = d.getMinutes(), m5 = Math.floor(m / 5), h = d.getHours() % 12;
    if (m5 >= 7) h = (h + 1) % 12;
    lit[GRID_ID.IT] = lit[GRID_ID.IS] = true;
    lit[GRID_HOUR[h === 0 ? 12 : h]] = true;
    if (m5 === 0) lit[GRID_ID.OCLOCK] = true;
    else if (m5 === 1 || m5 === 11) lit[GRID_ID.FIVE] = lit[GRID_ID.MINUTES] = true;
    else if (m5 === 2 || m5 === 10) lit[GRID_ID.TEN] = lit[GRID_ID.MINUTES] = true;
    else if (m5 === 3 || m5 === 9) lit[GRID_ID.QUARTER] = true;
    else if (m5 === 4 || m5 === 8) lit[GRID_ID.TWENTY] = lit[GRID_ID.MINUTES] = true;
    else if (m5 === 5 || m5 === 7) lit[GRID_ID.TWENTY] = lit[GRID_ID.FIVE] = lit[GRID_ID.MINUTES] = true;
    else if (m5 === 6) lit[GRID_ID.HALF] = true;
    if (m5 >= 1 && m5 <= 6) lit[GRID_ID.PAST] = true;
    if (m5 >= 7) lit[GRID_ID.TO] = true;
    var on = CLOCK_COL[weatherNow(d).phase], ghost = mul(on, .13);
    for (var i = 0; i < GRID_WORDS.length; i++) drawText(f, g.lines[i], g.pens[i], capBase(GRID_TOPS[GRID_WORDS[i][1]], g.cap), lit[i] ? on : ghost, 1);
    var extra = m % 5, dx = [1, 125, 125, 1], dy = [1, 1, 29, 29];
    for (var k = 0; k < 4; k++) f.rect(dx[k], dy[k], 2, 2, k < extra ? on : ghost);
  }

  // Day bar: the time (the clock face at cap 18 on cap-top row 3) and under it the whole day as a 2-px bar on rows
  // 29..30, x 4..123 at 12 minutes a pixel, coloured by the sky of each hour (night indigo, violet twilight, the orange
  // of sunrise and sunset, day blue); the part still to come at 30%, amber ticks over sunrise and sunset, and a small
  // sun (or moon) at now.
  // The sun's height from today's sun times (Now.cpp sunCurveAt): +1 at the middle of the day, 0 at sunrise and
  // sunset, -1 in the middle of the night.
  function sunCurveAt(dm) {
    var rise = SUN[0], set = SUN[1];
    if (!(set > rise)) return phaseAt(dm) === 'night' ? -.6 : .6;
    if (dm >= rise && dm <= set) return Math.sin(Math.PI * (dm - rise) / (set - rise));
    var night = 1440 - (set - rise), since = dm > set ? dm - set : dm + 1440 - set;
    return -Math.sin(Math.PI * since / night);
  }
  var DAYBAR_STOPS = [[-1, hexc('1A2250')], [-.18, hexc('1E2A62')], [-.07, hexc('5A3A86')], [0, hexc('FF7A36')],
    [.10, hexc('F0A050')], [.22, hexc('5A9BE8')], [1, hexc('64A8F4')]];
  function dayBarColour(e) {
    for (var i = 0; i + 1 < DAYBAR_STOPS.length; i++) {
      var a = DAYBAR_STOPS[i], b = DAYBAR_STOPS[i + 1];
      if (e <= b[0]) return mix(a[1], b[1], (e - a[0]) / (b[0] - a[0]));
    }
    return DAYBAR_STOPS[DAYBAR_STOPS.length - 1][1];
  }
  var DAYBAR_TICK = hexc('#FFB347'), DAYBAR_SUN = hexc('#FFD54A'), DAYBAR_MOON = hexc('#DCE4F4');
  function faceDayBar(f, d) {
    var w = weatherNow(d), ct = clockText(d), c = fcCellsAt('clock', 18), dm = dayMinOf(d), per = 1440 / 120;
    fcTab(f, 'clock', 18, c, ~~((128 - faceTabWidth(c, ct)) / 2), capBase(3, 18), ct, CLOCK_COL[w.phase], 1, 1);
    for (var i = 0; i < 120; i++) {
      var m = (i + .5) * per, cc = dayBarColour(sunCurveAt(m));
      if (m > dm) cc = mul(cc, .3);
      f.set(4 + i, 29, cc); f.set(4 + i, 30, cc);
    }
    [SUN[0], SUN[1]].forEach(function (mark) { var x = 4 + Math.floor(mark / per); f.set(x, 27, DAYBAR_TICK); f.set(x, 28, DAYBAR_TICK); });
    disc(f, 4 + dm / per, 29 - 2.2, 2.1, w.phase !== 'night' ? DAYBAR_SUN : DAYBAR_MOON);
  }

  FACE_PORTS.push({ id: 'words', name: 'Words', draw: faceWords });
  FACE_PORTS.push({ id: 'dayBar', name: 'Day bar', draw: faceDayBar });
  FACE_PORTS.push({ id: 'minimal', name: 'Minimal', draw: faceMinimal });
  FACE_PORTS.push({ id: 'wordGrid', name: 'Word grid', draw: faceWordGrid });

  /* ---------- day faces from the firmware: Weather forward, Moon, Agenda (clock/FacesSky.cpp) ---------- */
  // The faces' own kit (clock/Kit.cpp): a clock set in cells as wide as the widest digit's advance, each glyph's ink
  // centred in its cell, the colon raised to the digits' middle (and drawn at its own alpha where it blinks)
  // The lift is worked from the glyphs' outlines, as the board's rasteriser bounds its bitmaps: a rendered box here
  // takes a faint antialiased row the board leaves dark, enough to move a colon a row. SF Pro's tracking (its trak table, which the browser applies at every size) comes off the cells too:
  // the board sets them from the bare advances.
  function fcCells(role, cap) {
    var size = sizeFor(role, q4(cap)), trk = fcSfTracking(role, size), d = 0;
    gx.font = fontOf(role, size);
    for (var i = 0; i < 10; i++) d = Math.max(d, Math.round(gx.measureText(String(i)).width - trk));
    // each glyph's rows as the board's rasteriser leaves them: its outline's extent rounded out to whole rows, less a
    // sliver row of under a twentieth of a pixel (a round dot just past the baseline lights nothing there)
    var dip = FAMS[ROLES[role].fam].seated ? metrics(role).dip * size : 0;
    var mid = function (m) { var t = Math.floor(-m.actualBoundingBoxAscent - dip + .05), b = Math.ceil(m.actualBoundingBoxDescent - dip - .05); return (t + b) / 2; };
    var C = gx.measureText(':');
    return { d: d, c: Math.round(C.width - trk), lift: Math.round(mid(C) - mid(gx.measureText('H'))) };
  }
  // the tracking the browser adds to SF Pro at this size: what its 'H' measures past its advance (1471 of 2048 units),
  // trusted only where the '9' agrees (1309 units), so another system font is left as it measures
  function fcSfTracking(role, size) {
    if (ROLES[role].fam !== 'sys') return 0;
    gx.font = fontOf(role, size);
    var trk = gx.measureText('H').width - 1471 / 2048 * size;
    return Math.abs(gx.measureText('9').width - trk - 1309 / 2048 * size) < .15 ? trk : 0;
  }
  // cells per role and cap, worked again when a font arrives
  var fcCellCache = {};
  function fcCellsAt(role, cap) {
    var k = role + '|' + cap, c = fcCellCache[k];
    if (!c || c.gen !== textGen) c = fcCellCache[k] = { gen: textGen, cells: fcCells(role, cap) };
    return c.cells;
  }
  function fcTab(f, role, cap, cells, x, base, str, col, alpha, colonAlpha, halo) {
    var pen = 0;
    for (var i = 0; i < str.length; i++) {
      var colon = str[i] === ':', cw = colon ? cells.c : cells.d, L = line(role, cap, str[i]);
      if (!L.empty) {
        var px = x + pen + ((cw - L.inkW) / 2 | 0) - L.l, by = base - (colon ? cells.lift : 0);
        if (halo) haloText(f, L, px, by, halo);
        else drawText(f, L, px, by, col, colon && colonAlpha != null ? colonAlpha : alpha);
      }
      pen += cw;
    }
    return pen;
  }
  // the ink box a tab takes drawn from x on `base`: {x, y, r, b}, inclusive
  function fcTabInk(role, cap, cells, x, base, str) {
    var pen = 0, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (var i = 0; i < str.length; i++) {
      var colon = str[i] === ':', cw = colon ? cells.c : cells.d, L = line(role, cap, str[i]);
      if (!L.empty) {
        var left = x + pen + ((cw - L.inkW) / 2 | 0), top = base + L.t - (colon ? cells.lift : 0);
        x0 = Math.min(x0, left); y0 = Math.min(y0, top); x1 = Math.max(x1, left + L.inkW - 1); y1 = Math.max(y1, top + L.inkH - 1);
      }
      pen += cw;
    }
    return { x: x0, y: y0, r: x1, b: y1 };
  }
  // A line set without the small-cap pixel (Kit's Line::set(..., tracked = false)): the narrowest a cap-6 line can be
  // set, which fitLine tries before stepping down a cap
  var fcNTCache = new Map();
  function fcLineNT(role, cap, str) {
    var key = role + '|' + q4(cap) + '|' + str, L = fcNTCache.get(key);
    if (L) return L;
    var T = line(role, cap, str), spans = [], pen = 0;
    for (var i = 0; i < T.spans.length; i++) {
      var s = T.spans[i];
      if (i) pen += s.g.bitmap || T.spans[i - 1].g.bitmap ? 0 : kernOf(role, q4(cap), str[s.i - 1], str[s.i]);
      spans.push({ x: pen, g: s.g, i: s.i });
      pen += s.g.adv;
    }
    var l = 1e9, r = -1e9, t = 1e9, b = -1e9;
    spans.forEach(function (s) { if (!s.g.w) return; l = Math.min(l, s.x + s.g.x); r = Math.max(r, s.x + s.g.x + s.g.w - 1); t = Math.min(t, s.g.y); b = Math.max(b, s.g.y + s.g.h - 1); });
    var empty = r < l;
    L = { role: role, cap: T.cap, str: str, spans: spans, adv: pen, empty: empty, l: empty ? 0 : l, r: empty ? -1 : r, t: empty ? 0 : t, b: empty ? -1 : b };
    L.inkW = L.r - L.l + 1; L.inkH = L.b - L.t + 1;
    fcNTCache.set(key, L);
    return L;
  }
  // fitLine: the largest cap whose ink fits, with the small-cap pixel first and then without it; the last try if none
  function fcFitLine(role, caps, str, maxW) {
    var L = null;
    for (var i = 0; i < caps.length; i++) {
      L = line(role, caps[i], str);
      if (L.inkW <= maxW) return L;
      if (q4(caps[i]) <= 6 && FAMS[ROLES[role].fam].tracked) { L = fcLineNT(role, caps[i], str); if (L.inkW <= maxW) return L; }
    }
    return L;
  }
  // std::lround: halves away from zero
  function fcLround(v) { return v < 0 ? -Math.round(-v) : Math.round(v); }
  // the faces' hash (FacesSky.cpp hash3), as an unsigned 32-bit integer
  function fcHash3(a, b, c) {
    var h = (Math.imul(a, 0x9E3779B1) ^ Math.imul((b + 0x7F4A7C15) | 0, 0x85EBCA77) ^ Math.imul((c + 0x165667B1) | 0, 0xC2B2AE3D)) >>> 0;
    h = (h ^ (h >>> 15)) >>> 0; h = Math.imul(h, 0x2C1B3C6D) >>> 0;
    return (h ^ (h >>> 12)) >>> 0;
  }
  // The wall clock's cycles (Now.cpp wallPhase): drift, twinkle and rain run on the epoch, so a face shows the board's
  // own sky at the same minute. A period of 0 or less stands still at its offset, as on the board. The board works its
  // speeds in 32-bit floats and its phases in doubles from them: the speeds are rounded the same way here (f32), since a
  // period a hair off is a cloud a screen away after the 1.8 billion seconds since 1970.
  var f32 = Math.fround;
  function fcWallPhase(ms, period) { if (!(period > 0)) return 0; var c = ms / 1000 / period, p = c - Math.floor(c); return p < 1 ? p : 0; }
  function fcWave(ms, period, off) { return Math.sin(2 * Math.PI * (fcWallPhase(ms, period) + (off || 0))); }
  function fcLoop(ms, speed, off, span) { var at = fcWallPhase(ms, f32(span) / f32(speed)) * span + off; return ((at % span) + span) % span; }
  // the clock the faces' motion runs on: the time itself, or under reduced motion the start of its minute, so drift,
  // twinkle, rain and the turning sun stand still (the board has no such setting; the site keeps the visitor's)
  function fcMotionMs(d) { var ms = d.getTime(); return REDUCED ? ms - ms % 60000 : ms; }
  // The moon's phase (clock/Astro.cpp): the elongation from Meeus' six largest terms, within an hour of the true new
  // and full moons; 0 new, .25 first quarter, .5 full, .75 last quarter. Worked out once a minute.
  var fcMoonCache = { min: -1, p: 0 };
  function fcMoonPhase(ms) {
    var minute = Math.floor(ms / 60000);
    if (minute === fcMoonCache.min) return fcMoonCache.p;
    var t = (ms / 1000 / 86400 + 2440587.5 - 2451545.0) / 36525, R = Math.PI / 180;
    var D = 297.8501921 + 445267.1114034 * t - .0018819 * t * t + t * t * t / 545868 - t * t * t * t / 113065000;
    var M = 357.5291092 + 35999.0502909 * t - .0001536 * t * t + t * t * t / 24490000;
    var Mp = 134.9633964 + 477198.8675055 * t + .0087414 * t * t + t * t * t / 69699 - t * t * t * t / 14712000;
    var e = D + 6.289 * Math.sin(Mp * R) - 2.1 * Math.sin(M * R) + 1.274 * Math.sin((2 * D - Mp) * R) + .658 * Math.sin(2 * D * R) +
      .214 * Math.sin(2 * Mp * R) + .11 * Math.sin(D * R);
    var p = (((e % 360) + 360) % 360) / 360;
    fcMoonCache = { min: minute, p: p < 1 ? p : 0 };
    return fcMoonCache.p;
  }
  function fcMoonLit(p) { return (1 - Math.cos(2 * Math.PI * p)) / 2; }
  // the look's weather, as the faces ask about it
  function fcWet(l) { return /^(drizzle|fdrizzle|rain|hrain|frain|snow|hsnow|grains|thunder|hail)$/.test(l); }
  function fcIcy(l) { return l === 'fdrizzle' || l === 'frain'; }
  function fcSnowy(l) { return l === 'snow' || l === 'hsnow' || l === 'grains'; }
  function fcStorm(l) { return l === 'thunder' || l === 'hail'; }
  // what falls, in the colour it falls in: rain and drizzle light blue, freezing rain ice-blue, snow and hail white
  function fcPrecipColour(l, phase) {
    var night = phase === 'night';
    if (fcIcy(l)) return hexc(night ? '8FD4EC' : 'BFEFFF');
    if (fcSnowy(l)) return hexc(night ? 'C8D2E6' : 'F4F8FF');
    if (l === 'hail') return hexc(night ? 'D0D8E8' : 'F0F4FF');
    return hexc(night ? '7FA8DC' : 'A4CCF4');
  }
  // A storm's flash on the faces, as calm as the sky tile's: one flash every 7-14 s (window k of 10.5 s flashes a
  // hashed 0-3.5 s into it), up over 0.12 s and down over 0.35 s; never with lightning off (reduced motion here)
  function fcFlash(ms, w) {
    if (!w.opts.lightning || !fcStorm(w.look)) return 0;
    var k = Math.floor(ms / 10500), level = 0;
    for (var j = k - 1; j <= k; j++) {
      var dt = (ms - (j * 10500 + fcHash3(j, 41, 43) % 3500)) / 1000;
      if (dt < 0) continue;
      level = Math.max(level, dt < .12 ? dt / .12 : Math.exp(-(dt - .12) / .35));
    }
    return level;
  }
  function fcCloud(f, cx, cy, s, col, a) {
    disc(f, cx - 6 * s, cy + 1.5 * s, 4.2 * s, col, a);
    disc(f, cx + .5 * s, cy - 1.5 * s, 5.8 * s, col, a);
    disc(f, cx + 6.5 * s, cy + 1.8 * s, 3.9 * s, col, a);
    roundRect(f, fcLround(cx - 9.5 * s), fcLround(cy + s), fcLround(19.5 * s), fcLround(4.8 * s), 2.3 * s, col, a);
  }
  function fcSun(f, cx, cy, r, rot, core, rays, rin, rout) {
    for (var i = 0; i < 8; i++) {
      var a = rot + i * Math.PI / 4;
      seg(f, cx + rin * Math.cos(a), cy + rin * Math.sin(a), cx + rout * Math.cos(a), cy + rout * Math.sin(a), .8, rays, 1);
    }
    disc(f, cx, cy, r, core, 1);
  }

  // Weather forward (WeatherForwardFace): the weather's glyph in the left 30 columns, the temperature as big as the
  // rows allow beside it in its own colour, the time small at the top right (cap 11) and along the bottom row the
  // condition word in its accent and the date at 70%.
  var FC_TEMP = [[10, '9CCBFF'], [32, 'BFE0FF'], [50, 'E6F2FF'], [62, 'FFF4E2'], [72, 'FFE2B0'], [82, 'FFB966'], [92, 'FF8A4A'], [104, 'FF5C3C']];
  function fcTempColour(temp) {
    var fh = FAHR ? temp : temp * 9 / 5 + 32;
    if (fh <= FC_TEMP[0][0]) return hexc(FC_TEMP[0][1]);
    for (var i = 0; i + 1 < FC_TEMP.length; i++) if (fh <= FC_TEMP[i + 1][0]) return mix(hexc(FC_TEMP[i][1]), hexc(FC_TEMP[i + 1][1]), (fh - FC_TEMP[i][0]) / (FC_TEMP[i + 1][0] - FC_TEMP[i][0]));
    return hexc('FF5C3C');
  }
  // the night sky's glyph: the moon in its real phase, or (moon off) a few stars
  function fcNightGlyph(f, ms, w, cx, cy, r, glow) {
    if (w.opts.moonAtNight) {
      if (glow) disc(f, cx, cy, r + 3, hexc('9FB6E8'), .08);
      moonDisc(f, cx, cy, r, fcMoonPhase(ms), hexc('E8EEF8'), hexc('2A3244'), .6, 1);
      return;
    }
    var sx = [-5, 4, -1, 5.5], sy = [-3, -5, 3.5, 2.5];
    for (var i = 0; i < 4; i++) f.blend((cx + sx[i] * r / 8) | 0, (cy + sy[i] * r / 8) | 0, hexc('EAF0FF'), .55 + .45 * fcWave(ms, 2 + i, .3 * i));
  }
  // wind's streaks: `count` gusts from row `top`, 7 rows apart
  function fcStreaks(f, ms, count, top) {
    for (var k = 0; k < count; k++) {
      var y = top + k * 7, off = fcLoop(ms, 6, k * 9, 30);
      for (var x = 2; x < 30; x++) { var a = c01(1 - Math.abs(x - off) / 12); if (a > .05) f.blend(x, (y + Math.sin(x / 4) * 1.5) | 0, hexc('78C8A0'), a); }
    }
  }
  // what falls from the glyph's cloud, whose underside is row 15: every tail starts on row 16 or below, down to 29
  function fcFallGlyph(f, ms, look, col) {
    var count = 4, speed = 12, len = 3, slant = .25;
    switch (look) {
      case 'drizzle': case 'fdrizzle': count = 5; speed = 6; len = 1; slant = .1; break;
      case 'hrain': count = 6; speed = 18; len = 4; slant = .35; break;
      case 'thunder': count = 4; speed = 14; break;
      case 'snow': count = 5; speed = 3; len = 0; break;
      case 'hsnow': count = 8; speed = 5; len = 0; break;
      case 'grains': count = 6; speed = 7; len = 0; break;
      case 'hail': count = 4; speed = 13; len = 0; break;
    }
    var top = 17 + len, span = 29 - top;
    for (var k = 0; k < count; k++) {
      var y = top + fcLoop(ms, speed, k * span * .618, span), x0 = 7 + k * (18 / (count - 1));
      if (look === 'hail') {   // a 2 x 2 stone
        var hx = fcLround(x0), hy = fcLround(y);
        f.blend(hx, hy, col, 1); f.blend(hx + 1, hy, col, .8); f.blend(hx, hy + 1, mul(col, .8), .9); f.blend(hx + 1, hy + 1, mul(col, .8), .65);
      } else if (len === 0) {   // a flake or a grain
        var fx = x0 + (look !== 'grains' ? fcWave(ms, 2 * f32(Math.PI), f32(k / f32(2 * f32(Math.PI)))) : 0);
        disc(f, fx, y, look === 'hsnow' && (k & 1) ? 1.1 : look === 'grains' ? .5 : .8, col, 1);
      } else {   // a streak, its tail up the slant
        var sx = x0 - (y - top) * slant;
        seg(f, sx, y, sx + slant * len, y - len, .5, col, 1);
      }
    }
  }
  function fcWeatherIcon(f, ms, w) {
    var rot = 2 * Math.PI * fcWallPhase(ms, 20), drift = fcWave(ms, 8), night = w.phase === 'night', look = w.look, x;
    var light = hexc(night ? '6E7890' : 'DDE3EC'), dark = hexc(night ? '404A60' : '8E97A6');
    switch (look) {
      case 'clear': case 'mainly':
        if (night) {
          fcNightGlyph(f, ms, w, 16, 15, 8, true);
          var sx = [4.5, 27.5, 26.5], sy = [5.5, 4.5, 27.5];
          for (var i = 0; i < 3; i++) f.blend(sx[i] | 0, sy[i] | 0, hexc('EAF0FF'), .55 + .45 * fcWave(ms, 2 + i, .3 * i));
        } else if (w.phase === 'dusk') {
          f.clip(0, 0, 32, 23);
          fcSun(f, 16, 22, 7, rot, hexc('FF8A3A'), hexc('FFB347'), 9.5, 12.5);
          f.noclip();
          for (x = 3; x < 30; x++) f.set(x, 23, hexc('6A4A3A'));
          for (x = 7; x < 26; x += 2) f.set(x, 26, hexc('4A3428'));
        } else fcSun(f, 16, 16, 6.5, rot, hexc('FFC400'), hexc('FFDE17'), 9, 12.5);
        if (look === 'mainly') fcCloud(f, 21 + drift, 24, .5, light, 1);
        break;
      case 'partly':
        if (night) fcNightGlyph(f, ms, w, 11, 11, 6, false);
        else fcSun(f, 11, 11, 5.5, rot, hexc('FFC400'), hexc('FFDE17'), 7.5, 10);
        fcCloud(f, 18.5 + drift, 19, .95, light, 1);
        break;
      case 'overcast':
        fcCloud(f, 12 - drift, 11, .8, dark, 1);
        fcCloud(f, 18 + drift, 19, .95, light, 1);
        break;
      case 'fog':   // four banks of mist, drifting both ways
        var mist = hexc(night ? '8894AC' : 'C8D0DC');
        for (var k = 0; k < 4; k++) {
          var y = 8 + 6 * k, off = fcLoop(ms, k % 2 === 0 ? 2 : -2, k * 7, 30);
          for (x = 3; x < 29; x++) { var a = c01(.55 + .45 * Math.sin(2 * Math.PI * (x - off) / 15)); f.blend(x, y, mist, a); f.blend(x, y + 1, mist, .45 * a); }
        }
        break;
      case 'windy':
        fcStreaks(f, ms, 3, 9);
        break;
      case 'wcloudy':
        fcCloud(f, 16 + drift, 10, .95, light, 1);
        fcStreaks(f, ms, 2, 20);
        break;
      default:   // it rains, snows or storms out of one cloud: what falls first, then the cloud over its tops
        var storm = fcStorm(look), flash = fcFlash(ms, w);
        fcFallGlyph(f, ms, look, fcPrecipColour(look, w.phase));
        if (fcIcy(look)) {   // an ice glaze with a glint sliding along it
          var ice = hexc(night ? '6FA0B8' : 'BDEBFF');
          for (x = 4; x < 28; x++) f.blend(x, 29, ice, .85);
          var gx = 4 + fcLoop(ms, 5, 0, 24);
          f.blend(gx | 0, 29, WHITE, .9); f.blend(gx | 0, 28, WHITE, .4);
        }
        var cloud = storm || look === 'hrain' ? dark : light;
        if (flash > 0) cloud = mix(cloud, hexc(night ? '7E88BC' : 'C4C8EE'), .6 * flash);
        fcCloud(f, 16 + drift, 10, .95, cloud, 1);
        if (storm) {   // the bolt, brightening with each flash
          var ba = .75 + .25 * flash, bottom = look === 'hail' ? 25 : 29, bolt = hexc('FFD23F');
          seg(f, 17, 16, 13, 23, .9, bolt, ba); seg(f, 13, 23, 18, 22, .9, bolt, ba); seg(f, 18, 22, 14, bottom, .9, bolt, ba);
        }
    }
  }
  function faceWeatherForward(f, d, t, st, dt, s) {
    var ms = fcMotionMs(d), w = weatherNow(d), col = CLOCK_COL[w.phase];
    fcWeatherIcon(f, ms, w);
    // the time at the top right, the clock face at cap 11, its last cell ending at the panel's edge
    var cells = fcCellsAt('clock', 11), ct = clockText(d), tx = 127 - tabWidth(cells.d, cells.c, ct), tb = capBase(3, 11);
    fcTab(f, 'clock', 11, cells, tx, tb, ct, col, 1);
    var tr = fcTabInk('clock', 11, cells, tx, tb, ct);
    // the bottom row (Classic's label row, one row lower): the date at the right, the condition word from x 36, its
    // compact form where the whole word would come within 4 px of the date
    var date = line('label', 6, DAYS[d.getDay()] + ' ' + d.getDate()), dateLeft = 126 - date.inkW + 1;
    drawText(f, date, penRight(date, 126), 30, col, .7);
    var word = line('label', 6, shortWord(w.code, w.look));
    if (36 + word.inkW > dateLeft - 4) word = line('label', 6, compactWord(w.code, w.look));
    drawText(f, word, penLeft(word, 36), 30, conditionAccent(w.look, w.phase), 1);
    // the temperature: the biggest cap whose ink clears the time by 4 px and the word row by 2, its ink top on row 1
    var wordTop = 30 + word.t, T = null;
    for (var i = 0, caps = [18, 16, 14, 12]; i < caps.length; i++) {
      T = line('bold', caps[i], w.temp);
      if (36 + T.inkW - 1 <= tr.x - 4 && T.inkH <= wordTop - 3) break;
    }
    drawText(f, T, penLeft(T, 36), 1 - T.t, fcTempColour(parseInt(w.temp, 10) || 0), 1);
  }
  FACE_PORTS.push({ id: 'weatherForward', name: 'Weather forward', draw: faceWeatherForward });

  // Moon (MoonFace): tonight's moon as big as the panel allows, a 29-px disc in its real phase with the maria shaded and
  // the dark side in earthshine; the time beside it from x 36 at the largest cap whose widest cells end a blank column
  // clear of the widest share lit ("100%"); the phase's name under it at 85% and the share lit at the right at 70%.
  var FC_MARIA = [[-.30, -.34, .30, .30], [.16, -.32, .18, .30], [.30, -.04, .22, .28], [.62, -.24, .12, .30], [.50, .22, .15, .25],
    [-.14, .36, .17, .22], [-.58, .02, .30, .26], [.30, .34, .09, .22], [-.02, .62, .07, -.18]];   // the last: Tycho, a bright crater
  function fcBigMoon(f, cx, cy, r, phase) {
    disc(f, cx, cy, r, hexc('141820'), 1);
    var cosT = Math.cos(2 * Math.PI * phase), waxing = phase < .5 ? 1 : -1, lit = hexc('D2D7E0');
    for (var y = (cy - r | 0) - 1; y <= (cy + r | 0) + 1; y++) for (var x = (cx - r | 0) - 1; x <= (cx + r | 0) + 1; x++) {
      var px = x + .5 - cx, py = y + .5 - cy, dd = Math.sqrt(px * px + py * py), cover = c01(r + .5 - dd);
      if (cover <= 0) continue;
      var halfW = Math.sqrt(Math.max(0, 1 - (py / r) * (py / r))), on = c01(px * waxing - cosT * halfW * r + .5);
      if (on <= 0) continue;
      var shade = 1;
      for (var i = 0; i < FC_MARIA.length; i++) {
        var m = FC_MARIA[i], mx = px / r - m[0], my = py / r - m[1], sm = c01(1 - Math.sqrt(mx * mx + my * my) / m[2]);
        shade -= 1.5 * m[3] * sm * sm * (3 - 2 * sm);
      }
      var limb = .82 + .18 * Math.sqrt(Math.max(0, 1 - (dd / r) * (dd / r)));
      f.blend(x, y, mul(lit, clamp(shade * limb, .3, 1)), cover * on);
    }
  }
  function fcMoonName(p) {
    return p < .0339 || p >= .9661 ? 'NEW MOON' : p < .2161 ? 'WAXING CRESCENT' : p < .2839 ? 'FIRST QUARTER' : p < .4661 ? 'WAXING GIBBOUS'
      : p < .5339 ? 'FULL MOON' : p < .7161 ? 'WANING GIBBOUS' : p < .7839 ? 'LAST QUARTER' : 'WANING CRESCENT';
  }
  function faceMoon(f, d, t, st, dt, s) {
    var w = weatherNow(d), col = CLOCK_COL[w.phase], p = fcMoonPhase(d.getTime()), X = 36;
    fcBigMoon(f, 16, 16, 14.6, p);
    if (s.gen !== textGen) {
      var litLeft = 126 - line('label', 6, '100%').inkW + 1, caps = [16, 15, 14, 13, 12];
      for (var i = 0; i < caps.length; i++) { s.cap = caps[i]; s.cells = fcCells('clock', s.cap); if (X + 4 * s.cells.d + s.cells.c - 1 <= litLeft - 2) break; }
      s.gen = textGen;
    }
    fcTab(f, 'clock', s.cap, s.cells, X, capBase(3, s.cap), clockText(d), col, 1);
    // the phase's name fits x 36..126 by its ink: cap 6, without the small-cap pixel if it needs the room, then cap 5
    var N = fcFitLine('label', [6, 5], fcMoonName(p), 126 - X + 1);
    drawText(f, N, penLeft(N, X), capBase(24, 6), mul(col, .85), 1);
    var L = line('label', 6, Math.round(100 * fcMoonLit(p)) + '%');
    drawText(f, L, penRight(L, 126), capBase(13, 6), col, .7);
  }
  FACE_PORTS.push({ id: 'moon', name: 'Moon', draw: faceMoon });

  // Agenda (AgendaFace): the time (cap 13) and the date at the left; beside a bar in the calendar's colour, when the
  // next event starts and its title, never cut: 1 row at cap 8, then 2 rows at 8, 7 or 6, then 3 rows at 5, then
  // whole-word pages of cap-6 rows every 3 s (TitleFit.cpp), fitted once per event. The event is the site's own (the
  // calendar scene's: the next quarter hour at least 40 minutes away). The title's band ends on row 30 here, a row
  // short of the board's, for the dark ring.
  function fcTitleFit(title, width, top, bottom, ladder, pageCap, role) {
    var rows = [];
    function wrap(cap, maxRows, split) {
      var out = [''], words = title.split(' ').filter(function (x) { return x; });
      for (var i = 0; i < words.length; i++) {
        var word = words[i], n = out.length - 1, trial = out[n] ? out[n] + ' ' + word : word;
        if (line(role, cap, trial).inkW <= width) { out[n] = trial; continue; }
        if (out[n]) { if (out.length >= maxRows) return null; out.push(''); n++; }
        if (line(role, cap, word).inkW <= width) { out[n] = word; continue; }
        if (!split) return null;
        var r = word;
        while (r) {   // a word wider than the column, broken at the last letter that fits
          var take = r.length;
          while (take > 1 && line(role, cap, r.slice(0, take)).inkW > width) take--;
          out[out.length - 1] = r.slice(0, take); r = r.slice(take);
          if (r) { if (out.length >= maxRows) return null; out.push(''); }
        }
      }
      return out[0] ? out : [];
    }
    // rows at the cap's pitch, the block's ink centred in the band; false where it leaves the band or (unless pushed
    // apart) one row's ink would touch the next's
    function place(texts, cap, pushApart) {
      var pitch = cap <= 5 ? 7 : cap <= 6 ? 9 : cap <= 7 ? 10 : cap <= 8 ? 11 : (cap | 0) + 3, off = [], ls = [], lo = 1e9, hi = -1e9;
      for (var i = 0; i < texts.length; i++) {
        var L = line(role, cap, texts[i]);
        ls.push(L);
        if (i > 0) {
          off[i] = off[i - 1] + pitch;
          var above = off[i - 1] + ls[i - 1].b;
          if (above >= off[i] + L.t - 1) { if (!pushApart) return null; off[i] = above - L.t + 2; }
        } else off[0] = 0;
        lo = Math.min(lo, off[i] + L.t); hi = Math.max(hi, off[i] + L.b);
      }
      var room = bottom - top + 1, h = hi - lo + 1;
      if (h > room) return null;
      var b0 = top + ((room - h) / 2 | 0) - lo;
      return ls.map(function (L, i) { return { L: L, base: b0 + off[i] }; });
    }
    for (var r = 0; r < ladder.length; r++) {
      var k = wrap(ladder[r][0], ladder[r][1], false), page = k && k.length >= 1 && k.length <= ladder[r][1] ? place(k, ladder[r][0], false) : null;
      if (page) return { cap: ladder[r][0], pages: [page] };
    }
    var all = wrap(pageCap, 16, true) || [], pages = [];
    for (var i = 0; i < all.length;) {
      var two = i + 1 < all.length ? place([all[i], all[i + 1]], pageCap, true) : null;
      pages.push(two || place([all[i]], pageCap, true) || []);
      i += two ? 2 : 1;
    }
    return { cap: pageCap, pages: pages.length ? pages : [[]] };
  }
  function fcSiteEvent(d) {
    var dm = d.getHours() * 60 + d.getMinutes(), start = Math.ceil((dm + 40) / 15) * 15, sh = Math.floor(start / 60) % 24, sm = start % 60;
    return { start: start, today: start < 1440, title: 'Yoga class', color: hexc('#7986CB'),
      hm: H12 ? ((sh + 11) % 12 + 1) + ':' + two(sm) + (sh < 12 ? ' AM' : ' PM') : two(sh) + ':' + two(sm),
      weekday: DAYS[(d.getDay() + (start < 1440 ? 0 : 1)) % 7] };
  }
  function faceAgenda(f, d, t, st, dt, s) {
    var w = weatherNow(d), col = CLOCK_COL[w.phase], X = 64, KW = 126 - X + 1;
    var cells = fcCellsAt('clock', 13);
    fcTab(f, 'clock', 13, cells, 2, capBase(3, 13), clockText(d), col, 1);
    var date = line('label', 6, DAYS[d.getDay()] + ' ' + d.getDate());
    drawText(f, date, penLeft(date, 2), capBase(23, 6), col, .7);
    var e = fcSiteEvent(d);
    f.rect(X - 5, 2, 2, 28, e.color);
    var key = e.start + '|' + H12 + '|' + e.title + '|' + textGen;
    if (s.key !== key) {   // the start ("2:00 PM" today, "TUE 9:30 AM" another day, "19:30" on a 24 h clock) and the title
      s.key = key;
      s.when = line('label', 6, (e.today ? '' : e.weekday + ' ') + e.hm);
      if (s.when.inkW > KW) s.when = line('label', 6, e.hm);
      s.title = fcTitleFit(e.title, KW, 12, 30, [[8, 1], [8, 2], [7, 2], [6, 2], [5, 3]], 6, 'label');
    }
    drawText(f, s.when, penLeft(s.when, X), capBase(3, 6), mix(e.color, WHITE, .5), 1);
    var pages = s.title.pages, pg = pages.length > 1 ? Math.floor(d.getTime() / 3000) % pages.length : 0;
    pages[pg].forEach(function (r) { drawText(f, r.L, penLeft(r.L, X), r.base, WHITE, 1); });
  }
  FACE_PORTS.push({ id: 'agenda', name: 'Agenda', draw: faceAgenda });

  /* ---------- the faces' shared pieces for Big time and Sky ---------- */
  // SF Pro's own clock face for Big time, whatever the family (BigClock: SF Pro SemiBold at its display size)
  ROLES.bigClock = { fam: 'sys', w: 590 };

  // Big time's colon (Now.cpp softBlink): full for the first half of each second, 15% for the rest, 0.1 s fades
  function fcSoftBlink(fr) { return fr < .45 ? 1 : fr < .55 ? 1 - .85 * (fr - .45) / .1 : fr < .9 ? .15 : .15 + .85 * (fr - .9) / .1; }
  // where the sun is (the NOAA solar calculator, clock/Astro.cpp): its declination, hour angle (0 at solar noon) and
  // elevation for an epoch second and a place (longitude east positive)
  function fcSunPosition(sec, lat, lon) {
    var R = Math.PI / 180, t = (sec / 86400 + 2440587.5 - 2451545.0) / 36525;
    var L0 = ((280.46646 + t * (36000.76983 + .0003032 * t)) % 360 + 360) % 360, M = 357.52911 + t * (35999.05029 - .0001537 * t);
    var ecc = .016708634 - t * (.000042037 + .0000001267 * t);
    var C = Math.sin(M * R) * (1.914602 - t * (.004817 + .000014 * t)) + Math.sin(2 * M * R) * (.019993 - .000101 * t) + Math.sin(3 * M * R) * .000289;
    var om = 125.04 - 1934.136 * t, app = L0 + C - .00569 - .00478 * Math.sin(om * R);
    var obl = 23 + (26 + (21.448 - t * (46.815 + t * (.00059 - t * .001813))) / 60) / 60 + .00256 * Math.cos(om * R);
    var decl = Math.asin(Math.sin(obl * R) * Math.sin(app * R)) / R, y = Math.pow(Math.tan(obl * R / 2), 2);
    var eq = 4 / R * (y * Math.sin(2 * L0 * R) - 2 * ecc * Math.sin(M * R) + 4 * ecc * y * Math.sin(M * R) * Math.cos(2 * L0 * R) -
      .5 * y * y * Math.sin(4 * L0 * R) - 1.25 * ecc * ecc * Math.sin(2 * M * R));
    var sod = ((sec % 86400) + 86400) % 86400, ha = (((sod / 60 + eq + 4 * lon) / 4) % 360 + 360) % 360 - 180;
    if (ha <= -180) ha += 360;
    var cz = Math.sin(lat * R) * Math.sin(decl * R) + Math.cos(lat * R) * Math.cos(decl * R) * Math.cos(ha * R);
    return { decl: decl, ha: ha, el: 90 - Math.acos(clamp(cz, -1, 1)) / R };
  }
  // the hour angle at which the sun's upper limb meets the horizon: 0 when it stays down all day, 180 when it never sets
  function fcSunsetHA(lat, decl) {
    var R = Math.PI / 180, den = Math.cos(lat * R) * Math.cos(decl * R);
    if (Math.abs(den) < 1e-9) return decl * lat > 0 ? 180 : 0;
    var c = (Math.sin(-.833 * R) - Math.sin(lat * R) * Math.sin(decl * R)) / den;
    return c >= 1 ? 0 : c <= -1 ? 180 : Math.acos(c) / R;
  }
  // time-of-day sky colours (Now.cpp skyColours) for a sun elevation in [-1, 1]: zenith and horizon, dimmed for LEDs
  var FC_SKY = [[-1, '020308', '04060C'], [-.30, '03050C', '080C1A'], [-.14, '080C22', '1C1838'], [-.05, '121A40', '552A48'],
    [0, '1A2852', 'B8542A'], [.07, '21407A', 'C88840'], [.20, '2A5CA8', '86B0D8'], [1, '2A6CC8', '9CC8EE']];
  function fcSkyColours(e) {
    e = clamp(e, -1, 1);
    var i = 0;
    while (i + 1 < FC_SKY.length - 1 && e > FC_SKY[i + 1][0]) i++;
    var a = FC_SKY[i], b = FC_SKY[i + 1], k = c01((e - a[0]) / (b[0] - a[0]));
    return [mul(mix(hexc(a[1]), hexc(b[1]), k), .72), mul(mix(hexc(a[2]), hexc(b[2]), k), .72)];
  }
  // east to west: high and flat over the time's columns (x 28..100 stays above row 8), steep at the sides
  function fcArc(fr) {
    return [64 - 60 * Math.cos(Math.PI * fr),
      29 - 25 * Math.sqrt(Math.sin(Math.PI * c01(fr))) + (fr < 0 ? -fr * 40 : 0) + (fr > 1 ? (fr - 1) * 40 : 0)];
  }
  var FC_STARS = (function () {
    var a = [];
    for (var i = 0; i < 24; i++) { var h = fcHash3(i, 7, 11); a.push([h % 128, (h >>> 8) % 22, f32(1.5 + f32(((h >>> 16) % 100) / 40))]); }
    return a;
  })();
  // where the sun is (once a second): its elevation as the palette reads it (+1 at today's noon, 0 on the horizon,
  // -1 at its lowest) and the sun's and moon's places on the arc (0 at sunrise, 1 at sunset)
  function fcSunNow(s, ms) {
    var sec = Math.floor(ms / 1000);
    if (s.sunSec === sec) return;
    s.sunSec = sec; s.moon = fcMoonPhase(ms); s.arcKnown = false;
    var c = TZ_CITY[TZ] || TZ_CITY['America/Indiana/Indianapolis'], p = fcSunPosition(sec, c[0], c[1]);
    var el = p.el + .833, high = 90 - Math.abs(c[0] - p.decl) + .833, low = -(Math.abs(c[0] + p.decl) - 90 + .833);
    s.elev = clamp(el >= 0 ? el / Math.max(high, .5) : el / Math.max(low, .5), -1, 1);
    var h0 = fcSunsetHA(c[0], p.decl);
    if (h0 > 0 && h0 < 180) {
      s.arcKnown = true;
      s.sunF = (p.ha + h0) / (2 * h0);
      var hm = p.ha - 360 * s.moon;
      hm = (hm + 540) % 360 - 180;
      s.moonF = (hm + h0) / (2 * h0);
    }
  }
  // Clouds by the look, drifting east to west, and what falls out of them: each column's drops start under the lowest
  // cloud over it, so none is ever seen above a cloud. At night the clouds are moonlit, and one crossing the moon lets it
  // glow through. A storm lights them from inside.
  function fcSkyWeather(f, ms, w, zen, s, nightMoon, mx, my) {
    var look = w.look, wet = fcWet(look), clouds = 6, speed = .25, night = w.phase === 'night';
    switch (look) {
      case 'clear': case 'fog': clouds = 0; break;
      case 'mainly': clouds = 1; break;
      case 'partly': clouds = 3; break;
      case 'windy': clouds = 3; speed = 1.2; break;
      case 'wcloudy': speed = 1.2; break;
    }
    if (!clouds) return;
    var cloud = mix(hexc('E6EAF0'), zen, .3);
    if (w.phase === 'dusk') cloud = hexc('7C5566');
    if (night) cloud = hexc('3E4A64');
    if (wet) cloud = night ? hexc('333C52') : mul(cloud, w.phase === 'dusk' ? .8 : .65);
    var flash = fcFlash(ms, w);
    if (flash > 0) cloud = mix(cloud, hexc(night ? '7E88BC' : 'C4C8EE'), .55 * flash);
    var cx = [], cy = [], cs = [], under = s.under || (s.under = new Int16Array(128)), i, x;
    under.fill(-1);
    for (i = 0; i < clouds; i++) {
      var h = fcHash3(i, 3, 5);
      cx[i] = fcLoop(ms, f32(f32(speed) * f32(1 + f32(f32(.15) * (i % 3)))), h % 150, 158) - 15;
      cy[i] = wet ? 4 + (h >>> 8) % 3 : 5 + (h >>> 8) % 7;   // wet clouds hang in one layer
      cs[i] = f32(f32(.55) + f32(f32(.1) * (i % 2)));
      var below = Math.ceil(cy[i] + 5.8 * cs[i] + .5);
      for (x = Math.max(0, Math.floor(cx[i] - 10.7 * cs[i])); x <= Math.min(127, Math.ceil(cx[i] + 10.9 * cs[i])); x++) under[x] = Math.max(under[x], below);
    }
    if (wet) fcSkyFall(f, ms, look, w.phase, clouds, cx, cy, cs, under);
    for (i = 0; i < clouds; i++) fcCloud(f, cx[i], cy[i], cs[i], cloud, night ? .85 : .92);
    if (nightMoon) moonDisc(f, mx, my, 3.2, s.moon, hexc('EEF2FA'), hexc('1C2436'), 0, .45);
  }
  // drops, flakes or stones from under each cloud down to the hills, moving with their cloud
  function fcSkyFall(f, ms, look, phase, clouds, cx, cy, cs, under) {
    var per = 4, len = 3, speed = 16;
    switch (look) {
      case 'drizzle': case 'fdrizzle': per = 4; speed = 7; len = 1; break;
      case 'hrain': per = 7; speed = 26; len = 4; break;
      case 'snow': per = 4; speed = 4; len = 0; break;
      case 'hsnow': per = 7; speed = 6; len = 0; break;
      case 'grains': per = 5; speed = 9; len = 0; break;
      case 'hail': per = 3; speed = 20; len = 0; break;
      case 'thunder': per = 5; speed = 20; len = 3; break;
    }
    var col = fcPrecipColour(look, phase);
    function put(x, y, a) { if (x < 0 || x > 127 || y < 0 || y > 31 || under[x] < 0 || y < under[x]) return; f.blend(x, y, col, a); }
    for (var i = 0; i < clouds; i++) {
      var bottom = f32(cy[i] + f32(f32(5.8) * cs[i])), fall = f32(29 - bottom);
      for (var j = 0; j < per; j++) {
        var h = fcHash3(i, j, 17), along = (j + .5) / per * 17 - 8.5 + (h % 100) / 100 - .5, x = cx[i] + along * cs[i];
        if (fcSnowy(look) && look !== 'grains') x += 1.2 * fcWave(ms, 3 + j % 3, (h % 7) / 7);
        var y = bottom + fcLoop(ms, speed, ((h >>> 8) % 1000) / 1000 * fall, fall), px = fcLround(x), py = fcLround(y);
        if (look === 'hail') { put(px, py, 1); put(px + 1, py, .8); put(px, py + 1, .9); put(px + 1, py + 1, .65); }
        else if (len === 0) {
          put(px, py, .95);
          if (look === 'hsnow' && (j & 1)) { put(px - 1, py, .4); put(px + 1, py, .4); put(px, py - 1, .4); put(px, py + 1, .4); }
        } else for (var k = 0; k < len; k++) put(px, py - k, k === 0 ? 1 : .55 / k);
      }
    }
  }
  // fog: three soft banks drifting both ways over the hills, under the time
  function fcFogBanks(f, ms, phase) {
    var Y = [9.5, 17, 24.5], V = [2, f32(-1.4), f32(1.1)], mist = hexc(phase === 'night' ? '6E7C98' : phase === 'dusk' ? 'B89AA4' : 'D6DCE4');
    for (var k = 0; k < 3; k++) {
      var dd = fcWallPhase(ms, 41 / Math.abs(V[k])) * (V[k] > 0 ? 1 : -1);
      for (var x = 0; x < 128; x++) {
        var u = x / 41 - dd, a = .55 * c01(.5 + .35 * Math.sin(2 * Math.PI * u + k) + .2 * Math.sin(2 * Math.PI * u * 2.3 + 2 * k));
        if (a <= .01) continue;
        for (var y = (Y[k] | 0) - 3; y <= (Y[k] | 0) + 3; y++) { var wy = 1 - Math.abs(y + .5 - Y[k]) / 3.2; if (wy > 0) f.blend(x, y, mist, a * wy); }
      }
    }
  }

  /* ---------- the site's own: seasons and more to come ---------- */
  function seasonNow(d) {
    var m = d.getMonth(), day = d.getDate(), md = m * 100 + day, SOUTHERN = SOUTH;
    if (m === 9 && day >= 24) return 'halloween';
    if ((m === 11 && day >= 18) || (m === 0 && day <= 1)) return 'holiday';
    if (m === 1 && day >= 12 && day <= 14) return 'hearts';
    var s = md >= 220 && md < 521 ? 'spring' : md >= 521 && md < 822 ? 'summer' : md >= 822 && md < 1121 ? 'autumn' : 'winter';
    if (SOUTHERN) s = { spring: 'autumn', summer: 'winter', autumn: 'spring', winter: 'summer' }[s];
    return s;
  }
  // Seasons (the site's own, not on the board yet): the season's scene across the panel, its name and today's date
  // straight on it, kept readable by a thin dark edge round the glyphs as the board does its weather digits (no box)
  S.seasons = function () {
    var parts = [], r = rng(21);
    return {
      label: 'Seasons', dur: 8,
      draw: function (f, t, st, dt) {
        var d = now(), k = seasonNow(d), step = Math.min(dt || 0, .05), i;
        var P = {
          spring: { sky: [[40, 90, 150], [120, 190, 230]], ground: [60, 150, 70], cols: [[255, 170, 200], [255, 255, 255], [255, 210, 90]], fall: .25, word: 'SPRING' },
          summer: { sky: [[30, 110, 210], [140, 210, 250]], ground: [230, 200, 120], cols: [[255, 255, 255]], fall: 0, word: 'SUMMER' },
          autumn: { sky: [[60, 40, 70], [240, 150, 90]], ground: [110, 60, 30], cols: [[255, 120, 30], [230, 60, 40], [255, 190, 60]], fall: .5, word: 'AUTUMN' },
          winter: { sky: [[14, 24, 60], [60, 90, 150]], ground: [230, 240, 255], cols: [[255, 255, 255]], fall: .6, word: 'WINTER' },
          halloween: { sky: [[20, 10, 40], [70, 30, 80]], ground: [40, 30, 50], cols: [[255, 140, 0]], fall: 0, word: 'HALLOWEEN' },
          holiday: { sky: [[10, 20, 50], [40, 60, 110]], ground: [235, 245, 255], cols: [[255, 255, 255]], fall: .6, word: 'HOLIDAYS' },
          hearts: { sky: [[80, 10, 40], [200, 60, 110]], ground: [120, 20, 60], cols: [[255, 90, 140], [255, 180, 200]], fall: .4, word: 'LOVE' }
        }[k];
        for (var y = 0; y < H; y++) f.rect(0, y, W, 1, mul(mix(P.sky[0], P.sky[1], y / (H - 1)), .75));
        if (k === 'summer') { disc(f, 20, 10, 7, [255, 200, 60], .25); disc(f, 20, 10, 4.5, [255, 220, 90]); for (i = 0; i < W; i++) f.rect(i, 27 + Math.round(Math.sin(i * .25 + t * 3)), 1, 6, [40, 140, 210]); }
        else if (k === 'halloween') { disc(f, 22, 20, 7, [255, 130, 0]); f.rect(21, 11, 2, 3, [60, 140, 40]); f.set(19, 18, BLACK); f.set(25, 18, BLACK); f.rect(19, 22, 7, 1, BLACK); disc(f, 108, 8, 4, [240, 240, 220]); }
        else if (k === 'holiday') { for (i = 0; i < 9; i++) f.rect(20 - i, 6 + i * 2, 1 + i * 2, 2, [40, 150, 70]); f.rect(19, 24, 3, 4, [120, 70, 30]); f.set(20, 5, [255, 220, 60]); }
        else { var tr = k === 'autumn' ? [230, 110, 30] : k === 'spring' ? [255, 170, 210] : k === 'winter' ? [220, 235, 255] : [255, 90, 140]; f.rect(19, 16, 3, 12, [90, 55, 30]); disc(f, 20, 12, 8, tr, .9); disc(f, 15, 15, 5, tr, .9); disc(f, 25, 15, 5, tr, .9); }
        f.rect(0, 28, W, 4, P.ground);
        // what falls comes and sways by the time a frame took (as at the tiles' 30 fps), the same on any screen
        if (P.fall && Math.random() < P.fall * step * 30) parts.push([r() * W, -1, .5 + r(), r() * 6, P.cols[Math.floor(r() * P.cols.length)]]);
        parts = parts.filter(function (q) { q[1] += q[2] * step * 12; q[0] += Math.sin(t * 2 + q[3]) * 4.5 * step; f.blend(q[0], q[1], q[4], 1); return q[1] < 28; });
        // the words: centred in the room right of the picture, fitted by ink, a dark edge under them
        var cx = 82, word = fit('label', [10, 9, 8, 7], P.word, 84) || line('label', 7, P.word), D = line('label', 6, MONS[d.getMonth()] + ' ' + d.getDate());
        var wb = capBase(5, word.cap), db = capBase(19, 6), wp = penCentre(word, cx), dp = penCentre(D, cx);
        haloText(f, word, wp, wb, .8); haloText(f, D, dp, db, .8);
        drawText(f, word, wp, wb, [255, 238, 214]); drawText(f, D, dp, db, [245, 233, 214], .85);
      }
    };
  };
  S.soon = function () {
    return {
      label: 'More', dur: 8,
      draw: function (f, t) {
        f.fill(BLACK);
        for (var i = 0; i < 3; i++) { var on = Math.floor(t * 3) % 3 === i; disc(f, 52 + i * 12, 11, 3, on ? [119, 237, 215] : [30, 60, 55]); }
        var L = line('label', 6, 'MORE SOON');
        drawText(f, L, penCentre(L, 63.5), capBase(21, 6), [255, 238, 214]);
      }
    };
  };

  // the mooboard mark is itself a grid of LED dots, so it maps straight onto the panel (the startup card's cow)
  var MARK = [
    '..........ccc........ccc..........', '..........ccc........ccc..........', '..........ccc........ccc..........',
    '..........ccsssssssssscc..........', '........ssssssssssssssssss........', '.......ssssssssssssssssssss.......',
    '......ssssssssssssssssssssss......', '...sssssss..............sssssss...', '.ssssssss................ssssssss.',
    'sspppsss...www......www...ssspppss', '.sspssss..wwwww....wwwww..sssspss.', '..ssssss..wwoww....wwoww..ssssss..',
    '....ssss..wwwww....wwwww..ssss....', '....ssss...www......www...ssss....', '....ssss..................ssss....',
    '....ssss..................ssss....', '....ssss.....pppppppp.....ssss....', '.....sss....pp.pppp.pp....sss.....',
    '.....sss.....pppppppp.....sss.....', '.....ssss....pppppppp....ssss.....', '.....sssss..............sssss.....',
    '......ssssssssssssssssssssss......', '.......ssssssssssssssssssss.......', '........ssssssssssssssssss........',
    '............ssssssssss............'
  ];
  var MARKC = { c: [245, 233, 214], p: [255, 170, 195], w: WHITE };
  function drawMark(f, x0, y0, t, frame, pupil) {
    var blink = (t % 3.7) < .14;
    for (var r = 0; r < MARK.length; r++) for (var c = 0; c < MARK[r].length; c++) {
      var ch = MARK[r][c];
      if (ch === '.') continue;
      if (blink && (ch === 'w' || ch === 'o') && r !== 11) continue;
      if (ch === 'o' && !pupil && !blink) continue;   // a black pupil is just an unlit LED
      f.set(x0 + c, y0 + r, ch === 's' ? frame : ch === 'o' ? (blink ? WHITE : pupil) : MARKC[ch]);
    }
  }
  function hsl(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    function g(n) { var k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); }
    return [g(0), g(8), g(4)];
  }
  S.moo = function () {
    return {
      label: 'Moo', dur: 4.5,
      draw: function (f, t, st) {
        // the cow and MOO as one centred group, clear of every edge
        f.fill(BLACK);
        var cw = MARK[0].length, word = 'MOO', Lw = line('bold', 17, word), x0 = Math.round((W - (cw + 5 + Lw.inkW)) / 2);
        drawMark(f, x0, 4, t, [119, 237, 215], st < 2.6 && !REDUCED ? hsl(Math.floor(t * 10) * 47, 1, .55) : null);
        var x = x0 + cw + 5;
        for (var i = 0; i < 3; i++) {
          var tt = c01((st - .15 - i * .22) / .35), jump = REDUCED ? 0 : Math.round(Math.sin(tt * Math.PI) * -3), L = line('bold', 17, word[i]);
          if (tt > 0) drawText(f, L, penLeft(L, x), 26 + jump, null, 1, function (X, Y) { return mix(WHITE, [119, 237, 215], (Y - 8) / 18); });
          x += L.inkW + 2;
        }
      }
    };
  };
  // the startup card cow on its own and centred as the hi page boards show it + it blinks as on the panel
  S.mark = function () {
    return {
      label: 'Logo', dur: 8,
      draw: function (f, t) {
        f.fill(BLACK);
        drawMark(f, Math.round((W - MARK[0].length) / 2), Math.round((H - MARK.length) / 2), t, [119, 237, 215], null);
      }
    };
  };

  /* ---------- the board ---------- */
  var boards = [], maskCache = {};
  // reduced motion: one still frame a scene, drawn again as its size, minute, fonts, cover, weather or still() change
  var STILL = 2.5, stillVer = 0;
  function restill() { stillVer++; }
  function masks(s, look) {
    var key = s + (look ? '|' + look.dot + '|' + !!look.crisp : '');
    if (maskCache[key]) return maskCache[key];
    var bw = W * s, bh = H * s, m = mk(bw, bh), u = mk(bw, bh), cell = mk(s, s), cc = cell.getContext('2d');
    // look.crisp: round dots with a short edge, for a face seen up close (the 3D viewer's texture)
    var crisp = look && look.crisp, r = s * (crisp ? .43 : .46), g = cc.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, r);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(crisp ? .8 : .62, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    cc.fillStyle = g; cc.fillRect(0, 0, s, s);
    var mx = m.getContext('2d'); mx.fillStyle = mx.createPattern(cell, 'repeat'); mx.fillRect(0, 0, bw, bh);
    var cu = mk(s, s), cux = cu.getContext('2d');
    cux.fillStyle = look && look.dot ? look.dot : '#1B1920'; cux.beginPath(); cux.arc(s / 2, s / 2, s * .36, 0, 6.3); cux.fill();
    var ux = u.getContext('2d'); ux.fillStyle = ux.createPattern(cu, 'repeat'); ux.fillRect(0, 0, bw, bh);
    return (maskCache[key] = { m: m, u: u });
  }

  /* ---------- transitions ----------
     The board's own, the same sums as the firmware's pw::composeTransition (lib/pw_scenes/src/pw_scenes/Transition.cpp):
     out = the frame p of the way (0..1) from a to b, each an RGBA array of 128 x 32. out must not be a or b. Nothing is
     kept between frames and what looks random is a fixed hash, so a moment drawn twice is the same frame. */
  var TRANS = (function () {
    var W = 128, H = 32, N = W * H, G = [255, 240, 220];
    var COW = [
      '          ccc        ccc          ', '          ccc        ccc          ', '          ccc        ccc          ',
      '          ccTTTTTTTTTTcc          ', '        TTTTTTTTTTTTTTTTTT        ', '       TTTTTTTTTTTTTTTTTTTT       ',
      '      TTTTTTTTTTTTTTTTTTTTTT      ', '   TTTTTTT..............TTTTTTT   ', ' TTTTTTTT................TTTTTTTT ',
      'TTpppTTT...WWW......WWW...TTTpppTT', ' TTpTTTT..WWWWW....WWWWW..TTTTpTT ', '  TTTTTT..WWoWW....WWoWW..TTTTTT  ',
      '    TTTT..WWWWW....WWWWW..TTTT    ', '    TTTT...WWW......WWW...TTTT    ', '    TTTT..................TTTT    ',
      '    TTTT..................TTTT    ', '    TTTT.....pppppppp.....TTTT    ', '     TTT....ppnppppnpp....TTT     ',
      '     TTT.....pppppppp.....TTT     ', '     TTTT....pppppppp....TTTT     ', '     TTTTT..............TTTTT     ',
      '      TTTTTTTTTTTTTTTTTTTTTT      ', '       TTTTTTTTTTTTTTTTTTTT       ', '        TTTTTTTTTTTTTTTTTT        ',
      '            TTTTTTTTTT            '
    ];
    var COWC = { T: [119, 237, 215], c: [245, 233, 214], p: [255, 183, 201], W: [255, 255, 255] };
    var noise = null;   // the site's sparkle field, made on first use
    var BLACK = [0, 0, 0], WHITE = [255, 255, 255];

    function ease(t) { return t <= 0 ? 0 : t >= 1 ? 1 : t < .5 ? 2 * t * t : 1 - (-2 * t + 2) * (-2 * t + 2) / 2; }
    function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
    function lround(v) { return v < 0 ? -Math.round(-v) : Math.round(v); }   // C's: halves away from zero
    function mix32(x) {
      x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16;
      return x >>> 0;
    }
    function unit(i, salt) { return (mix32((Math.imul(i, 0x9E3779B9) ^ salt) >>> 0) >>> 8) / 16777216; }
    function put(o, i, s, j) { o[i] = s[j]; o[i + 1] = s[j + 1]; o[i + 2] = s[j + 2]; o[i + 3] = 255; }
    function rgb(o, i, c) { o[i] = c[0]; o[i + 1] = c[1]; o[i + 2] = c[2]; o[i + 3] = 255; }
    function toward(o, i, s, j, c, k) {   // s taken k/256 of the way to c
      o[i] = s[j] + (((c[0] - s[j]) * k) >> 8); o[i + 1] = s[j + 1] + (((c[1] - s[j + 1]) * k) >> 8);
      o[i + 2] = s[j + 2] + (((c[2] - s[j + 2]) * k) >> 8); o[i + 3] = 255;
    }
    function run(o, x0, y0, s, sx, sy, w) { if (w > 0) o.set(s.subarray((sy * W + sx) * 4, (sy * W + sx + w) * 4), (y0 * W + x0) * 4); }

    function fade(p, a, b, o) {
      for (var i = 0; i < N * 4; i += 4) {
        for (var c = 0; c < 3; c++) o[i + c] = Math.floor(a[i + c] + (b[i + c] - a[i + c]) * p + .5);
        o[i + 3] = 255;
      }
    }
    function slide(p, a, b, o) {
      var off = lround(ease(p) * W);
      for (var y = 0; y < H; y++) { run(o, 0, y, a, off, y, W - off); run(o, W - off, y, b, 0, y, off); }
    }
    function rise(p, a, b, o) {
      var off = lround(ease(p) * H);
      for (var y = 0; y < H; y++) { if (y + off < H) run(o, 0, y, a, 0, y + off, W); else run(o, 0, y, b, 0, y + off - H, W); }
    }
    function wipe(p, a, b, o) {
      var edge = lround(ease(p) * W);
      for (var y = 0; y < H; y++) {
        run(o, 0, y, b, 0, y, edge); run(o, edge, y, a, edge, y, W - edge);
        if (edge > 0 && edge < W) {
          var i = (y * W + edge) * 4;
          for (var c = 0; c < 3; c++) o[i + c] = Math.floor(a[i + c] + (G[c] - a[i + c]) * .5 + .5);
        }
      }
    }
    // js/board.js's own: Park-Miller from seed 3 over the LEDs in order, leaning left to right; B once the front
    // has passed an LED by .08, the warm white inside that band. The front runs on to 1.08 so the last frame is B.
    function sparkle(p, a, b, o) {
      if (!noise) {
        noise = new Float32Array(N);
        for (var q = 0, seed = 3; q < N; q++) { seed = (seed * 16807) % 2147483647; noise[q] = ((seed - 1) / 2147483646) * .75 + ((q % W) / W) * .25; }
      }
      var front = p * 1.08;
      for (var k = 0, i = 0; k < N; k++, i += 4) {
        var n = noise[k];
        if (n < front - .08) put(o, i, b, i); else if (n < front) rgb(o, i, G); else put(o, i, a, i);
      }
    }
    // Pixel rain: B falls in by 2-LED columns over A, left to right with jitter, lands and hops once; heads glint.
    function rain(p, a, b, o) {
      for (var x0 = 0; x0 < W; x0 += 2) {
        var delay = .42 * (.45 * unit(x0, 0x5a17) + .55 * x0 / (W - 2)), tau = (p - delay) / .53;
        var lift = 0, falling = false, hopping = false, u;
        if (tau <= 0) lift = H;
        else if (tau < .74) { u = tau / .74; lift = lround(H * (1 - u * u)); falling = true; }
        else if (tau < 1) { u = (tau - .74) / (1 - .74); lift = lround(2 * 4 * u * (1 - u)); hopping = true; }
        for (var y = 0; y < H; y++) {
          for (var x = x0; x < x0 + 2; x++) {
            var i = (y * W + x) * 4;
            if (y + lift < H) {
              var j = ((y + lift) * W + x) * 4;
              if (falling && y + lift === H - 1) toward(o, i, b, j, G, 150); else put(o, i, b, j);
            } else if (hopping) rgb(o, i, BLACK);
            else put(o, i, a, i);
          }
        }
      }
    }
    // Ripple: a circle of B opens from the centre behind a bright ring, a faint ring trailing; squared half-LED units.
    function ripple(p, a, b, o) {
      var corner = .5 * Math.sqrt(W * W + H * H), t = clamp01(p / .92), r = (corner + 3 + 7 + 1) * Math.sin(t * 1.5707964);
      function sq(rad) { return rad <= 0 ? -1 : Math.floor(4 * rad * rad); }
      var ringOut = sq(r), ringIn = sq(r - 3), faintOut = sq(r - 3 - 7 + 1), faintIn = sq(r - 3 - 7);
      for (var y = 0, i = 0; y < H; y++) {
        var dy = 2 * y + 1 - H;
        for (var x = 0; x < W; x++, i += 4) {
          var dx = 2 * x + 1 - W, d = dx * dx + dy * dy;
          if (d >= ringOut) put(o, i, a, i);
          else if (d >= ringIn) toward(o, i, b, i, G, 170);
          else if (d >= faintIn && d < faintOut) toward(o, i, b, i, G, 64);
          else put(o, i, b, i);
        }
      }
    }
    // Mosaic: A coarsens through 2, 4 and 8-LED blocks, the 8s blend to B's, B sharpens; root mean square blocks.
    function isqrt8(n) {
      if (!n) return 0;
      var r = 0;
      for (var bit = 1 << 14; bit; bit >>= 2) { if (n >= r + bit) { n -= r + bit; r = (r >> 1) + bit; } else r >>= 1; }
      return r;
    }
    function rms(c, bx, by, s, out3) {
      var r = 0, g = 0, bl = 0;
      for (var y = by; y < by + s; y++) {
        for (var x = bx; x < bx + s; x++) { var i = (y * W + x) * 4; r += c[i] * c[i]; g += c[i + 1] * c[i + 1]; bl += c[i + 2] * c[i + 2]; }
      }
      var n = s * s;
      out3[0] = isqrt8(Math.floor(r / n)); out3[1] = isqrt8(Math.floor(g / n)); out3[2] = isqrt8(Math.floor(bl / n));
    }
    function mosaic(p, a, b, o) {
      var level = 1 - Math.abs(2 * p - 1), s = level >= .75 ? 8 : level >= .5 ? 4 : level >= .25 ? 2 : 1;
      var toB = clamp01((p - .42) / .16);
      if (s === 1) { o.set(toB >= 1 ? b : a); return; }
      var k = (toB * 256 + .5) | 0, lit = [0, 0, 0], lb = [0, 0, 0];
      for (var by = 0; by < H; by += s) {
        for (var bx = 0; bx < W; bx += s) {
          if (k >= 256) rms(b, bx, by, s, lit);
          else {
            rms(a, bx, by, s, lit);
            if (k > 0) { rms(b, bx, by, s, lb); for (var c = 0; c < 3; c++) lit[c] += ((lb[c] - lit[c]) * k) >> 8; }
          }
          for (var y = by; y < by + s; y++) for (var x = bx; x < bx + s; x++) rgb(o, (y * W + x) * 4, lit);
        }
      }
    }
    // Curtain: A parts down the middle, the halves drawn out to the sides, eased, B behind; the inner edges lit.
    function curtain(p, a, b, o) {
      var half = W / 2, off = lround(ease(p) * half);
      for (var y = 0; y < H; y++) {
        run(o, 0, y, a, off, y, half - off); run(o, half - off, y, b, half - off, y, 2 * off); run(o, half + off, y, a, half, y, half - off);
        if (off > 0 && off < half) {
          var l = (y * W + half - off - 1) * 4, rr = (y * W + half + off) * 4;
          toward(o, l, o, l, G, 90); toward(o, rr, o, rr, G, 90);
        }
      }
    }
    // Melt: A's 2-LED strips slide down off the panel, accelerating, each near its neighbour's moment; B behind.
    function melt(p, a, b, o) {
      var delay = .35 * .5 * unit(0, 0x3e17);
      for (var x0 = 0; x0 < W; x0 += 2) {
        delay += (unit(x0, 0x3e18) - .5) * .09;
        delay = delay < 0 ? 0 : delay > .35 ? .35 : delay;
        var tau = clamp01((p - delay) / .6), drop = lround(H * tau * tau);
        for (var y = 0; y < H; y++) {
          for (var x = x0; x < x0 + 2; x++) {
            var i = (y * W + x) * 4;
            if (y < drop) put(o, i, b, i); else put(o, i, a, ((y - drop) * W + x) * 4);
          }
        }
      }
    }
    // Glitch: slices jump sideways as red and blue split, rows turn over once while it is at its worst, it settles.
    function glitch(p, a, b, o) {
      var q = (p - .08) / .8;
      if (q <= 0) { o.set(a); return; }
      if (q >= 1) { o.set(b); return; }
      var sn = Math.sin(q * 3.1415927), tear = sn * sn, pattern = Math.floor(q * 12), split = lround(2 * tear), slice = 0;
      for (var y = 0; y < H;) {
        var id = (pattern * 64 + slice++) >>> 0, rows = 2 + Math.floor(unit(id, 0x61) * 5);
        var shift = unit(id, 0x64) < .35 ? lround((unit(id, 0x62) - .5) * 10 * tear) : 0;
        for (var yy = y; yy < y + rows && yy < H; yy++) {
          var src = .3 + .4 * unit(yy, 0x63) < q ? b : a, row = yy * W * 4;
          for (var x = 0; x < W; x++) {
            var i = row + x * 4, xs = x - shift, xr = xs - split, xb = xs + split;
            o[i] = xr >= 0 && xr < W ? src[row + xr * 4] : 0;
            o[i + 1] = xs >= 0 && xs < W ? src[row + xs * 4 + 1] : 0;
            o[i + 2] = xb >= 0 && xb < W ? src[row + xb * 4 + 2] : 0;
            o[i + 3] = 255;
          }
        }
        y += rows;
      }
    }
    // TV: A collapses to the middle, brightening, to a bright line that narrows and widens, and B opens out of it.
    function tv(p, a, b, o) {
      o.fill(0);
      for (var i = 3; i < N * 4; i += 4) o[i] = 255;
      if (p >= .42 && p < .54) {
        var u = (p - .42) / (.54 - .42), half = lround(W / 2 * (1 - 2.4 * u * (1 - u)));
        for (var y = H / 2 - 1; y <= H / 2; y++) for (var x = W / 2 - half; x < W / 2 + half; x++) rgb(o, (y * W + x) * 4, G);
        return;
      }
      var on = p >= .54, v = on ? (p - .54) / (1 - .54) : p / .42;
      var lit = on ? 1 - (1 - v) * (1 - v) * (1 - v) : 1 - v * v * v, src = on ? b : a;
      var rows = Math.max(2, lround(H * lit)), top = (H - rows) >> 1, glow = Math.floor(170 * (1 - lit));
      for (var k = 0; k < rows; k++) {
        var sy = Math.floor(k * H / rows);
        for (var xx = 0; xx < W; xx++) {
          var oi = ((top + k) * W + xx) * 4, si = (sy * W + xx) * 4;
          if (glow <= 0) put(o, oi, src, si); else toward(o, oi, src, si, G, glow);
        }
      }
    }
    // Cow wink: the startup card's cow rises in at the left, shuts its eyes, and runs off right with B behind it.
    function cowWink(p, a, b, o) {
      var cx = -4, cy = H - COW.length, edge = 0, u;
      if (p < .22) { u = p / .22; cy = H - lround(COW.length * (1 - (1 - u) * (1 - u))); }
      if (p >= .42) { u = clamp01((p - .42) / (.95 - .42)); cx = -4 + lround((W + 8) * u * u); edge = Math.min(W, cx + 4); }
      for (var y = 0; y < H; y++) { run(o, 0, y, b, 0, y, edge); run(o, edge, y, a, edge, y, W - edge); }
      var blink = p >= .26 && p < .4;
      for (var r = 0; r < COW.length; r++) {
        var yy = cy + r;
        if (yy < 0 || yy >= H) continue;
        for (var c = 0; c < COW[r].length; c++) {
          var x = cx + c, ch = COW[r][c];
          if (x < 0 || x >= W || ch === ' ') continue;
          var col = COWC[ch] || BLACK;
          if (blink && (ch === 'W' || ch === 'o')) col = r === 11 ? WHITE : BLACK;
          rgb(o, (yy * W + x) * 4, col);
        }
      }
    }

    var STYLES = { fade: fade, slide: slide, rise: rise, wipe: wipe, sparkle: sparkle, rain: rain, ripple: ripple,
      mosaic: mosaic, curtain: curtain, melt: melt, glitch: glitch, tv: tv, cowWink: cowWink };
    return {
      names: ['fade', 'slide', 'rise', 'wipe', 'sparkle', 'rain', 'ripple', 'mosaic', 'curtain', 'melt', 'glitch', 'tv', 'cowWink'],
      compose: function (name, p, a, b, o) {
        if (name === 'none' || p >= 1) { o.set(b); return; }
        if (p <= 0) { o.set(a); return; }
        (STYLES[name] || fade)(p, a, b, o);
      }
    };
  })();

  // What a board shuffles between unless it is told otherwise: the site's own sparkle and the eight newer ones.
  var SHUFFLE = ['sparkle', 'rain', 'ripple', 'mosaic', 'curtain', 'melt', 'glitch', 'tv', 'cowWink'];
  function pickTransition(board) {
    var name = board.opts.transition || 'shuffle';
    if (name !== 'shuffle') return name;
    var set = board.opts.shuffle || SHUFFLE, choices = set.length > 1 ? set.filter(function (n) { return n !== board.trLast; }) : set;
    return (board.trLast = choices[Math.floor(Math.random() * choices.length)]);
  }

  // A frame as the board holds it, 8-bit RGB (as the display path rounds it), for the transitions' integer sums, and
  // back: the composed frame goes on through the edge ring and the dots like any other
  function toBytes(P, o) { for (var q = 0, i = 0, k = 0; q < N; q++, i += 3, k += 4) { o[k] = P[i]; o[k + 1] = P[i + 1]; o[k + 2] = P[i + 2]; o[k + 3] = 255; } }
  function fromBytes(o, P) { for (var q = 0, i = 0, k = 0; q < N; q++, i += 3, k += 4) { P[i] = o[k]; P[i + 1] = o[k + 1]; P[i + 2] = o[k + 2]; } }
  function bytes3() { return [new Uint8ClampedArray(N * 4), new Uint8ClampedArray(N * 4), new Uint8ClampedArray(N * 4)]; }
  function composeFB(name, p, a, b, o, buf) { toBytes(a.p, buf[0]); toBytes(b.p, buf[1]); TRANS.compose(name, p, buf[0], buf[1], buf[2]); fromBytes(buf[2], o.p); }

  function Board(el, opts) {
    this.el = el; this.opts = opts = opts || {};
    el.classList.add('led');
    this.glowCv = mk(W, H); this.glowCv.className = 'led-glow';
    this.dots = mk(W * 4, H * 4); this.dots.className = 'led-dots';
    this.fx = this.glowCv.getContext('2d');
    this.bx = this.dots.getContext('2d');
    this.img = this.fx.createImageData(W, H);
    this.fa = new FB(); this.fb = new FB(); this.fo = new FB();
    el.appendChild(this.dots); el.appendChild(this.glowCv);
    var self = this;
    this.names = opts.scenes || ['time'];
    this.scenes = {};
    this.names.concat(['moo']).forEach(function (n) { self.scenes[n] = S[n](self); });
    this.idx = 0; this.cur = this.names[0]; this.start = 0; this.next = null; this.tStart = 0;
    this.auto = opts.auto !== false; this.visible = true; this.frame = 0; this.glow = [119, 237, 215];
    this.last = 0; this.s = 0;
    this.resize();
    // opts.external: a board drawn by its owner (the 3D viewer's LED face): no observers, no place in the page loop;
    // the owner calls tick() each frame and uses this.dots (W x H LEDs at opts.minScale px each) as its picture
    if (!opts.external) {
      if (window.ResizeObserver) new ResizeObserver(function () { self.resize(); }).observe(el);
      // the newest entry is the current one (one callback can bring a leave and an enter)
      if (window.IntersectionObserver) new IntersectionObserver(function (e) { self.visible = e[e.length - 1].isIntersecting; }, { rootMargin: '100px' }).observe(el);
    }
    if (this.scenes[this.cur].enter) this.scenes[this.cur].enter();
    boards.push(this);
  }
  Board.prototype.resize = function () {
    var w = this.el.clientWidth || 512, dpr = Math.min(window.devicePixelRatio || 1, 2);
    var s = clamp(Math.max(Math.round(w * dpr / W), this.opts.minScale || 0), 3, this.opts.maxScale || 14);
    this.el.style.setProperty('--cell', (w / W).toFixed(2) + 'px');
    if (s === this.s) return;
    this.s = s; this.dots.width = W * s; this.dots.height = H * s; this.mk = masks(s, this.opts.look);
    // only the masks a board still draws with are kept (a resize sweep would leave a pair at every scale)
    var used = boards.map(function (b) { return b.mk; }).concat(this.mk);
    for (var k in maskCache) if (used.indexOf(maskCache[k]) < 0) delete maskCache[k];
  };
  // the dots follow the screen's pixel density: a window moved to a screen with another one keeps its size, so no
  // resize says so
  (function watchDensity() {
    var mq = matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)');
    function moved() {
      if (mq.removeEventListener) mq.removeEventListener('change', moved); else mq.removeListener(moved);
      boards.forEach(function (b) { if (!b.opts.external) b.resize(); });
      watchDensity();
    }
    if (mq.addEventListener) mq.addEventListener('change', moved); else mq.addListener(moved);
  })();
  Board.prototype.go = function (name, now2) {
    if (!this.scenes[name]) this.scenes[name] = S[name](this);
    // mid-crossfade, the latest ask waits for it to end
    if (this.next) { this.pending = name === this.next ? null : name; return; }
    if (name === this.cur) return;
    this.next = name; this.tStart = now2 == null ? (performance.now() - t0) / 1000 : now2;
    this.trNow = pickTransition(this);
    if (this.scenes[name].enter) this.scenes[name].enter();
    this.el.dispatchEvent(new CustomEvent('scene', { detail: name }));
  };
  // keep one scene on the board (the song) until released
  Board.prototype.hold = function (name) {
    if (!this.scenes[name]) this.scenes[name] = S[name](this);
    this.held = name; this.pending = null;
    if (this.next) { this.cur = this.next; this.start = this.tStart; this.next = null; }
    this.go(name);
  };
  Board.prototype.release = function () {
    var h = this.held; this.held = null;
    if (!h) return;
    // the held scene goes wherever it is: on, coming on, asked for next or waiting behind a moo
    if (this.back === h) this.back = this.names[0];
    if ((this.pending || this.next || this.cur) === h) this.go(this.names[0]);
  };
  Board.prototype.tick = function (nowMs) {
    var t = ((nowMs == null ? performance.now() : nowMs) - t0) / 1000;
    this.render(t, this.last ? Math.min(Math.max(0, t - this.last), .1) : 0);
    return this.dots;
  };
  Board.prototype.step = function () { var i = this.names.indexOf(this.pending || this.next || this.cur); this.go(this.names[(i + 1) % this.names.length]); };
  Board.prototype.moo = function () {
    if (this.cur === 'moo' && !this.next) { this.start = (performance.now() - t0) / 1000; return; }
    if (this.next === 'moo') { this.pending = null; return; }
    this.back = this.pending || this.next || this.cur; this.pending = null;
    if (this.next) { this.cur = this.next; this.start = this.tStart; this.next = null; }
    this.go('moo');
  };
  // paints the current frame into this.fo (the sparkle transition between scenes included) and darkens the edge ring
  Board.prototype.paint = function (t, dt) {
    var sc = this.scenes[this.cur], st = this.opts.at != null ? this.opts.at : Math.max(0, t - this.start);
    if (!this.start) { this.start = t; st = 0; }
    var TR = REDUCED ? .01 : .7, mooBack = this.cur === 'moo' && this.back;
    // reduced motion: no scene moves on by itself (a moo still goes back to the scene it interrupted)
    if (!this.next && ((this.auto && !this.held && this.names.length > 1 && !REDUCED) || mooBack) && st > sc.dur * (REDUCED ? 1.6 : 1)) {
      var nm = mooBack ? this.back : this.names[(this.names.indexOf(this.cur) + 1) % this.names.length];
      this.back = null;
      if (nm !== this.cur) this.go(nm, t);
    }
    var ts = t, ns = Math.max(0, t - this.tStart);
    if (REDUCED) { ts = ns = STILL; dt = 0; if (this.opts.at == null) st = STILL; }
    var a = this.fa, o = this.fo;
    a.noclip(); sc.draw(a, ts, st, dt); a.noclip();
    if (this.next) {
      var p = Math.max(0, (t - this.tStart) / TR), b = this.fb;
      b.noclip(); this.scenes[this.next].draw(b, ts, ns, dt); b.noclip();
      if (p >= 1) {
        this.cur = this.next; this.next = null; this.start = this.tStart; o.copy(b);
        // what was asked for during the crossfade goes on now
        var pn = this.pending; this.pending = null;
        if (pn) this.go(pn, t);
      }
      else composeFB(this.trNow || 'sparkle', p, a, b, o, this.t8 || (this.t8 = bytes3()));
    } else o.copy(a);
    // the owner's edge rule: the outermost ring of LEDs stays dark on every face
    var P = o.p, x, y;
    for (x = 0; x < W; x++) { P[x * 3] = P[x * 3 + 1] = P[x * 3 + 2] = 0; var j = ((H - 1) * W + x) * 3; P[j] = P[j + 1] = P[j + 2] = 0; }
    for (y = 0; y < H; y++) { var l = y * W * 3, r = (y * W + W - 1) * 3; P[l] = P[l + 1] = P[l + 2] = 0; P[r] = P[r + 1] = P[r + 2] = 0; }
    return o;
  };
  Board.prototype.render = function (t, dt) {
    this.last = t;
    if (REDUCED) {
      var sc = this.scenes[this.cur], key = [this.cur, this.s, Math.floor(now().getTime() / 6e4), textGen, stillVer, sc.still ? sc.still() : ''].join('|');
      if (!this.next && key === this.key && !(this.cur === 'moo' && this.back && t - this.start > sc.dur * 1.6)) return;
      this.key = key;
    }
    var o = this.paint(t, dt), P = o.p, d = this.img.data;
    for (var q = 0, i = 0, k = 0; q < N; q++, i += 3, k += 4) {
      d[k] = P[i]; d[k + 1] = P[i + 1]; d[k + 2] = P[i + 2]; d[k + 3] = 255;
    }
    this.fx.putImageData(this.img, 0, 0);
    var out = this.bx, bw = this.dots.width, bh = this.dots.height;
    out.globalCompositeOperation = 'copy'; out.imageSmoothingEnabled = false;
    out.drawImage(this.glowCv, 0, 0, bw, bh);
    out.globalCompositeOperation = 'destination-in'; out.drawImage(this.mk.m, 0, 0);
    out.globalCompositeOperation = 'destination-over'; out.drawImage(this.mk.u, 0, 0);
    out.globalCompositeOperation = 'source-over';
    // a still frame sets the glow straight away
    var named = this.scenes[this.next || this.cur].glow;
    if (this.opts.onGlow && named && (REDUCED || this.frame++ % 4 === 0)) { this.glow = named.slice(); this.opts.onGlow(this.glow); }
    else if (this.opts.onGlow && !named && (REDUCED || this.frame++ % 10 === 0)) {
      var r = 0, g = 0, bl = 0, c = 0;
      for (var j = 0; j < N * 3; j += 12) { var s2 = P[j] + P[j + 1] + P[j + 2]; if (s2 > 60) { r += P[j]; g += P[j + 1]; bl += P[j + 2]; c++; } }
      if (c) { this.glow = mix(this.glow, [r / c, g / c, bl / c], REDUCED ? 1 : .35); this.opts.onGlow(this.glow); }
    }
  };

  var t0 = performance.now(), lastT = 0, acc = 0;
  function loop(nowMs) {
    var t = (nowMs - t0) / 1000, dt = t - lastT; lastT = t;
    acc += dt;
    var minStep = REDUCED ? .5 : 0;
    if (acc >= minStep && !document.hidden) {
      for (var i = 0; i < boards.length; i++) {
        var b = boards[i];
        if (!b.visible || b.opts.external || (b.opts.when && !b.opts.when())) continue;
        // opts.fps caps a board (the tiles run at 30); a capped board gets the time since its own last frame
        if (b.opts.fps && t - b.last < 1 / b.opts.fps - .003) continue;
        try { b.render(t, b.opts.fps ? Math.min(t - b.last, .1) : acc); } catch (e) { if (!b.failed) { b.failed = 1; setTimeout(function () { throw e; }); } }
      }
      acc = 0;
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  // the page's pause (main.js): every board holds a still frame as under reduced motion, and on play each scene goes
  // on from where it stood, its time on the board kept
  function setPaused(on) {
    on = !!on;
    if (on === paused) return;
    paused = on; REDUCED = PREFERS_REDUCED || on; acc = 0;
    var t = (performance.now() - t0) / 1000;
    boards.forEach(function (b) {
      b.key = null;
      if (on) { b.pausedIn = b.cur; b.pausedSt = b.start ? t - b.start : 0; }
      else if (b.start) b.start = t - (b.cur === b.pausedIn ? b.pausedSt : 0);
    });
  }

  // the old lyric bounce split words into syllables; kept for the checks (tools/perf.py) and anything that asks
  var DIG = /^(ch|sh|th|ph|wh|ck|ng|qu|gh)$/;
  function syllables(word) {
    var w = word.toLowerCase(), n = w.length, isV = [], i;
    if (n <= 3 || !/[a-z]/.test(w)) return [word];
    for (i = 0; i < n; i++) isV[i] = /[aeiou]/.test(w[i]) || (w[i] === 'y' && i > 0 && !/[aeiou]/.test(w[i - 1]));
    if (w[n - 1] === 'e' && !isV[n - 2] && !(w[n - 2] === 'l' && n > 3 && !isV[n - 3])) isV[n - 1] = false;
    var groups = [];
    for (i = 0; i < n; i++) if (isV[i] && !isV[i - 1]) groups.push(i);
    if (groups.length < 2) return [word];
    var cuts = [];
    for (var gi = 1; gi < groups.length; gi++) {
      var end = groups[gi - 1]; while (end < n && isV[end]) end++;
      var cl = groups[gi] - end, cut;
      if (cl <= 1) cut = end; else if (cl === 2 && DIG.test(w.substr(end, 2))) cut = end; else if (cl >= 3 && DIG.test(w.substr(end + 1, 2))) cut = end + 1; else cut = end + 1;
      cuts.push(cut);
    }
    if (/ing$/.test(w) && n > 4) { cuts = cuts.filter(function (c) { return c < n - 3; }); cuts.push(n - 3); }
    if (/[^aeiou]le$/.test(w) && n > 4) { cuts = cuts.filter(function (c) { return c < n - 3; }); cuts.push(n - 3); }
    cuts = cuts.filter(function (c, k) { return c > 0 && c < n && cuts.indexOf(c) === k; }).sort(function (x2, y2) { return x2 - y2; });
    var out = [], last = 0;
    cuts.forEach(function (c) { if (c > last) { out.push(word.slice(last, c)); last = c; } });
    out.push(word.slice(last));
    var fin = [];
    out.forEach(function (pc) { if (fin.length && !/[aeiouy]/i.test(pc)) fin[fin.length - 1] += pc; else fin.push(pc); });
    if (fin.length > 1 && !/[aeiouy]/i.test(fin[0])) fin.splice(0, 2, fin[0] + fin[1]);
    return fin;
  }

  window.MooBoard = {
    Board: Board, scenes: S, boards: boards, inkFaults: inkFaults,
    syllables: function (w) { return syllables(w); },
    now: function () { return (performance.now() - t0) / 1000; },
    labels: function (names) { return names.map(function (n) { return S[n] ? S[n]().label : n; }); },
    // for tests and stills: a fake clock, and a scene painted once into a fresh frame (no board needed)
    setNow: function (fn) { nowFn = fn || function () { return new Date(); }; },
    setH12: function (v) { H12 = v == null ? use12h() : !!v; widestTime.gen = -1; },
    // the page's motion control: setPaused(true) holds every board still until setPaused(false)
    setPaused: setPaused, paused: function () { return paused; },
    transitions: TRANS.names.slice(), shuffle: SHUFFLE.slice(),
    // tests: one transition frame p of the way from scene a to scene b (each drawn at st), as RGB bytes
    paintTransition: function (name, p, sa, sb, st) {
      var A = new FB(), B = new FB(), O = new FB(), ba = { opts: {} };
      A.noclip(); S[sa](ba).draw(A, 1, st || 0, 1 / 30); B.noclip(); S[sb](ba).draw(B, 1, st || 0, 1 / 30);
      composeFB(name, p, A, B, O, bytes3());
      return Array.prototype.slice.call(O.p);
    },
    paintScene: function (name, opts, steps) {
      var b = { opts: opts || {} }, sc = S[name](b), f = new FB(), t = 0;
      if (sc.enter) sc.enter();
      (steps || [[0, 0]]).forEach(function (s) { t = s[0]; f.noclip(); sc.draw(f, 1 + t, s[1], 1 / 30); });
      var P = f.p;
      for (var x = 0; x < W; x++) { P[x * 3] = P[x * 3 + 1] = P[x * 3 + 2] = 0; var j = ((H - 1) * W + x) * 3; P[j] = P[j + 1] = P[j + 2] = 0; }
      for (var y = 0; y < H; y++) { var l = y * W * 3, r = (y * W + W - 1) * 3; P[l] = P[l + 1] = P[l + 2] = 0; P[r] = P[r + 1] = P[r + 2] = 0; }
      return P;
    },
    text: { line: line, fit: fit },
    logText: function (on) { var l = textLog; textLog = on ? [] : null; return l; },
    // tests: the lyric wheel driven frame by frame over a given song (song.pos is set for each time), as RGB bytes
    paintWheel: function (style, song, times, fps) {
      var w = new Wheel(style), f = new FB(), out = [];
      times.forEach(function (tt, k) {
        song.pos = tt; f.noclip(); w.draw(f, song, 1 + tt, k ? 1 / fps : 0);
        var P = f.p, b = new Array(N * 3);
        for (var i = 0; i < N * 3; i++) { var x = (i / 3 | 0) % W, y = (i / 3 / W) | 0; b[i] = x === 0 || y === 0 || x === W - 1 || y === H - 1 ? 0 : Math.max(0, Math.min(255, Math.round(P[i]))); }
        out.push(b);
      });
      return out;
    }
  };
})();
