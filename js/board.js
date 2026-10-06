/* MooBoard live LED board: the faces the real board shows, drawn the way its firmware draws them.
   Every scene paints a 128 x 32 frame of floats (the firmware's Canvas). Text is set glyph by glyph at whole-pixel
   pens with the font's own advances and kerning and drawn with its coverage, so each layout is fitted by its ink, the
   pixels it really lights. The board's rule holds everywhere: no glyph is ever clipped or ellipsized; text wraps
   smaller or pages instead. The outermost ring of LEDs is always dark (the owner's edge rule, 2026-10-05), and a glyph
   that would reach it is left out whole and counted in MooBoard.inkFaults, so a test catches any layout that needs
   it. The frame is then shown two ways: as round LEDs (big canvas, dot mask) and as a blurred copy for the glow. */
(function () {
  'use strict';

  var W = 128, H = 32, N = W * H;
  var REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var BLACK = [0, 0, 0], WHITE = [255, 255, 255];

  /* ---------- helpers ---------- */
  function mk(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function hexc(h) { h = h.replace('#', ''); return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)]; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function mul(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function c01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function smooth(a, b, v) { var t = c01((v - a) / (b - a)); return t * t * (3 - 2 * t); }
  function p2in(t) { t = c01(t); return t * t; }
  function p2out(t) { t = c01(t); return 1 - (1 - t) * (1 - t); }
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
    dev: { css: '"Noto Sans Devanagari", "Kohinoor Devanagari", sans-serif', whole: true }
  };
  var ROLES = {
    label: { fam: 'fredoka', w: 600, smallDigits: true },  // LABEL, TEMP, TITLE, ROW (SfSemibold)
    clock: { fam: 'fredoka', w: 600 },                     // SfSemiboldClock
    medium: { fam: 'fredoka', w: 500 },                    // SfMedium (Minimal, Nixie)
    bold: { fam: 'fredoka', w: 700 },                      // SfrBold: Now Watching's title, the celebration's word
    lyric: { fam: 'sys', w: 700 },                         // the line being sung, cap 10 and up
    lyricSm: { fam: 'sys', w: 600 },                       // lyric rows under cap 10: open counters
    dev: { fam: 'dev', w: 600 }                            // Devanagari, shaped whole by the browser
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
  var metricCache = {}, glyphCache = new Map(), kernCache = new Map(), lineCache = new Map(), textGen = 0;
  function clearText() { metricCache = {}; glyphCache.clear(); kernCache.clear(); lineCache.clear(); textGen++; }
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', clearText);
  function q4(cap) { return Math.round(cap * 4) / 4; }
  function fontOf(role, size) { var R = ROLES[role]; return R.w + ' ' + size.toFixed(3) + 'px ' + FAMS[R.fam].css; }
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
    gx.font = fontOf(role, size); gx.textBaseline = 'alphabetic'; gx.textAlign = 'left';
    var adv = gx.measureText(ch).width;
    gx.clearRect(0, 0, G.width, G.height); gx.fillStyle = '#fff';
    gx.fillText(ch, ox, oy - lift);
    var d = gx.getImageData(0, 0, G.width, G.height).data, x0 = G.width, y0 = G.height, x1 = -1, y1 = -1, x, y;
    for (y = 0; y < G.height; y++) for (x = 0; x < G.width; x++) if (d[(y * G.width + x) * 4 + 3] > 6) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) g = { w: 0, h: 0, x: 0, y: 0, a: null, adv: Math.round(adv) };
    else {
      var w = x1 - x0 + 1, h = y1 - y0 + 1, a = new Uint8Array(w * h);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var v = d[((y0 + y) * G.width + x0 + x) * 4 + 3]; a[y * w + x] = v > 6 ? v : 0; }
      g = { w: w, h: h, x: x0 - ox, y: y0 - oy, a: a, adv: Math.round(adv) };
    }
    glyphCache.set(key, g);
    return g;
  }
  function kernOf(role, capq, a, b) {
    var key = role + '|' + capq + '|' + a + b, k = kernCache.get(key);
    if (k != null) return k;
    gx.font = fontOf(role, sizeFor(role, capq));
    k = Math.round(gx.measureText(a + b).width - gx.measureText(a).width - gx.measureText(b).width);
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

  /* ---------- live weather: Open-Meteo, no key, location guessed from the time zone (no prompt) ---------- */
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
  var SOUTH = /^(Australia|Pacific\/Auckland|America\/(Sao_Paulo|Argentina|Santiago)|Africa\/Johannesburg)/.test(TZ);
  var FAHR = /^(en-US|en-LR|my)/.test(navigator.language || '') || /^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit|Indiana|Kentucky|Boise)|^Pacific\/Honolulu/.test(TZ);
  // approximate sunrise and sunset (local minutes) from the time zone's offset and today's date until the real ones
  // arrive; 06:30 and 18:30 when unknown
  var SUN = (function () {
    try {
      var d = new Date(), doy = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
      var dst = Math.max(new Date(d.getFullYear(), 0, 1).getTimezoneOffset(), new Date(d.getFullYear(), 6, 1).getTimezoneOffset()) !== d.getTimezoneOffset() ? 1 : 0;
      var lat = 40 * (SOUTH ? -1 : 1), decl = 23.44 * Math.sin((2 * Math.PI / 365) * (doy - 81)) * Math.PI / 180, la = lat * Math.PI / 180;
      var ha = Math.acos(clamp(-Math.tan(la) * Math.tan(decl), -1, 1)) * 12 / Math.PI, noon = 12 + dst;
      return [Math.round((noon - ha) * 60), Math.round((noon + ha) * 60)];
    } catch (e) { return [390, 1110]; }
  })();
  // One small request for the visitor's area (their time zone's city, else Indianapolis), after the page has loaded
  // and gone idle, never blocking; kept for 30 minutes in this browser. A failed fetch leaves the fixed sample.
  var WX = null, wxAsked = false, WX_KEY = 'moo-wx', WX_TTL = 30 * 60 * 1000;
  function takeWeather(j) {
    if (j && j.current) WX = { temp: Math.round(j.current.temperature_2m), code: j.current.weather_code, wind: j.current.wind_speed_10m };
    // today's real sunrise and sunset (local clock times) drive the phase, the sky's colours and the arc
    var d = j && j.daily, mins = function (iso) { var m = /T(\d+):(\d+)/.exec(iso || ''); return m ? +m[1] * 60 + +m[2] : null; };
    var r = d && mins(d.sunrise && d.sunrise[0]), s = d && mins(d.sunset && d.sunset[0]);
    if (r != null && s != null && s > r) { SUN[0] = r; SUN[1] = s; }
  }
  function askWeather() {
    if (wxAsked) return; wxAsked = true;
    var c = TZ_CITY[TZ] || TZ_CITY['America/Indiana/Indianapolis'], key = c.join(',') + (FAHR ? 'F' : 'C');
    try { var kept = JSON.parse(localStorage.getItem(WX_KEY) || 'null'); if (kept && kept.key === key && Date.now() - kept.at < WX_TTL) { takeWeather(kept.j); return; } } catch (e) { /* no storage */ }
    if (!window.fetch) return;
    var go = function () {
      fetch('https://api.open-meteo.com/v1/forecast?latitude=' + c[0] + '&longitude=' + c[1] + '&current=temperature_2m,weather_code,wind_speed_10m&daily=sunrise,sunset&timezone=auto&forecast_days=1' + (FAHR ? '&temperature_unit=fahrenheit' : ''))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j || !j.current) return;
          takeWeather(j);
          try { localStorage.setItem(WX_KEY, JSON.stringify({ key: key, at: Date.now(), j: { current: j.current, daily: j.daily } })); } catch (e) { /* no storage */ }
        })
        .catch(function () { /* the fixed sample stays */ });
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
  // the moon's phase, 0 new .. .5 full (pw::moonPhase): a mean synodic month from a real new moon
  function moonPhase(ms) { var p = ((ms - 947182440000) / 864e5) / 29.530588853; return p - Math.floor(p); }
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
    var ready = M.ready && M.ready();
    return { tr: tr, tm: M.timing(), pos: ready ? M.pos() : 0, playing: !!(ready && M.playing()), accent: tr.tint ? hexc(tr.tint) : [119, 237, 215] };
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
    var M = window.MooMusic, src = tr && M && M.cover ? M.cover(tr) : null;
    if (!src) return null;
    var a = ARTS[src];
    if (!a) {
      a = ARTS[src] = { ok: false };
      var im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async';
      im.onload = function () { try { a.tex = sampleArt(im, 28); a.t30 = sampleArt(im, 30); a.t20 = sampleArt(im, 20); a.ok = true; } catch (e) { a.bad = true; } };
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

  /* ---------- lyrics, on the board's wheel ---------- */
  // pw::LyricsLayout: a one-row line on cap rows 10..20, a wrapped pair on 6..13 and 16..23; the ladder 11 > 10 > 9 > 8
  // on one row, then wrapped rows at cap 8; a word wider than the box drops the line to 7 (and here, past the board,
  // further, where the board would scroll it). Rows that still do not fit two to a page are paged, whole.
  var LY = { box: [2, 124], top: 10, wrap: [6, 16], caps: [11, 10, 9, 8], wrapCap: 8, minCaps: [7, 6, 5], dim: .4 };
  function lyricRole(cap) { return cap >= 10 ? 'lyric' : 'lyricSm'; }
  function joinWords(ws, a, b) { var s = ''; for (var i = a; i < b; i++) s += (i > a ? ' ' : '') + ws[i].text; return s; }
  // the fewest rows over boxW, then the smallest widest row (pw::balancedWrap)
  function wrapRows(ws, cap, boxW) {
    var role = lyricRole(cap), n = ws.length, i, j;
    var wd = function (a, b) { return widthOf(line(role, cap, joinWords(ws, a, b))); };
    var rows = 0; for (i = 0; i < n;) { var e = i + 1; while (e < n && wd(i, e + 1) <= boxW) e++; rows++; i = e; }
    var best = [], INF = 1e9;
    for (var r = 0; r <= rows; r++) { best.push([]); for (i = 0; i <= n; i++) best[r].push(r === 0 && i === 0 ? [0, -1] : [INF, -1]); }
    for (r = 1; r <= rows; r++) for (i = r; i <= n; i++) for (j = r - 1; j < i; j++) {
      if (best[r - 1][j][0] >= INF) continue;
      var m = Math.max(best[r - 1][j][0], wd(j, i));
      if (m < best[r][i][0]) best[r][i] = [m, j];
    }
    var cuts = [], at = n;
    for (r = rows; r >= 1; r--) { var from = best[r][at][1]; cuts.unshift([from, at]); at = from; }
    return cuts.map(function (c) { return { a: c[0], b: c[1], L: line(role, cap, joinWords(ws, c[0], c[1])) }; });
  }
  function fitLyric(ln, boxW) {
    var key = 'fit' + boxW + '|' + textGen;
    if (ln[key]) return ln[key];
    var ws = ln.words && ln.words.length ? ln.words : [{ text: ln.text, t0: ln.t0, t1: ln.t1 }], text = joinWords(ws, 0, ws.length), i;
    for (i = 0; i < LY.caps.length; i++) {
      var L = line(lyricRole(LY.caps[i]), LY.caps[i], text);
      if (widthOf(L) <= boxW) return (ln[key] = { cap: LY.caps[i], ws: ws, rows: [{ a: 0, b: ws.length, L: L }] });
    }
    var cap = LY.wrapCap, caps = [cap].concat(LY.minCaps);
    for (i = 0; i < caps.length; i++) { cap = caps[i]; if (ws.every(function (w) { return widthOf(line(lyricRole(cap), cap, w.text)) <= boxW; })) break; }
    return (ln[key] = { cap: cap, ws: ws, rows: wrapRows(ws, cap, boxW) });
  }
  // the board's sweep (pw::sweepAlpha): sung 1, ahead .4, the active word lit up to a soft edge 20% of it wide
  function liftAmount(ms, dur) {
    var up = cubicOut((ms - 80) / 140), down = 1 - c01((ms - (dur - 140)) / 140);
    return up * down;
  }
  function lineIndexAt(tm, p) { var L = tm.lines, i = -1; while (i + 1 < L.length && p >= L[i + 1].t0) i++; return i; }
  function lastWordEnd(ln) { var ws = ln.words; return ws && ws.length ? ws[ws.length - 1].t1 : ln.t1; }
  // the intro or an instrumental break of 4 s or more: three dots that fill across it (pw: LYRIC_INTRO_MIN_MS)
  function gapAt(tm, p) {
    var L = tm.lines, i = lineIndexAt(tm, p);
    if (!L.length) return null;
    if (i < 0) return L[0].t0 >= 4 ? { k: c01(p / L[0].t0) } : null;
    var end = lastWordEnd(L[i]), nx = L[i + 1];
    if (nx && nx.t0 - end >= 4 && p >= end + .6) return { k: c01((p - end) / (nx.t0 - end)) };
    return null;
  }
  function gapDots(f, cx, cy, k, t) {
    var br = REDUCED ? 1 : 1 + .12 * Math.sin(2.2 * t);
    for (var d = 0; d < 3; d++) {
      var a = c01((.3 + .7 * c01(3 * k - d)) * br), x = Math.round(cx + (d - 1) * 6);
      f.blend(x, cy, WHITE, a); f.blend(x - 1, cy, WHITE, a * .8); f.blend(x + 1, cy, WHITE, a * .8); f.blend(x, cy - 1, WHITE, a * .8); f.blend(x, cy + 1, WHITE, a * .8);
    }
  }
  // the time beside the cover: LABEL cap 6, the widest of the day's times sets the column (pw::LyricDecor)
  var widestTime = { gen: -1, w: 0 };
  function widestTimeInk() {
    if (widestTime.gen === textGen) return widestTime.w;
    // a 0 is as wide as any digit but a 1, so each hour's :00 is its widest minute
    var w = 0;
    for (var h = 0; h < 24; h++) w = Math.max(w, line('label', 6, (H12 ? String((h + 11) % 12 + 1) : two(h)) + ':00').inkW);
    widestTime = { gen: textGen, w: w };
    return w;
  }
  function LyricView(style) { this.style = style; this.warp = new Warp(); this.shown = -2; this.leaving = -2; this.changeAt = -9; this.page = 0; }
  LyricView.prototype.geom = function () {
    if (this.style !== 'cover') return { x: LY.box[0], w: LY.box[1] };
    var w = Math.max(20, widestTimeInk()), cx = LY.box[0] + Math.floor(w / 2), x = LY.box[0] + w + 3;
    return { x: x, w: LY.box[0] + LY.box[1] - x, col: cx };
  };
  // one row of a fitted line, swept: pen x, baseline, the song position, the alpha the whole row is drawn at
  LyricView.prototype.row = function (f, fitd, row, pen, base, p, alpha) {
    var ws = fitd.ws, L = row.L, starts = [], ch = 0, i;
    for (i = row.a; i < row.b; i++) { starts.push(ch); ch += ws[i].text.length + 1; }
    var wordOf = function (ci) { var k = 0; while (k + 1 < starts.length && ci >= starts[k + 1]) k++; return row.a + k; };
    var act = -1;
    for (i = 0; i < ws.length; i++) if (p >= ws[i].t0) act = i;
    var lit = function (wi) { return wi < act || (wi === act && p >= ws[wi].t1) ? 1 : wi > act ? LY.dim : null; };
    // the active word's span in panel columns, from its glyphs' pens
    var aw = null;
    if (act >= row.a && act < row.b) {
      var c0 = starts[act - row.a], c1 = c0 + ws[act].text.length, s0 = L.spans[c0], s1 = L.spans[c1 - 1];
      var left = pen + s0.x, width = s1.x + s1.g.adv - s0.x, prog = c01((p - ws[act].t0) / Math.max(.03, ws[act].t1 - ws[act].t0));
      aw = { xs: left + width * (-.2 + 1.2 * prog), soft: .2 * width + 1 };
    }
    var up = 0;
    if (aw && !REDUCED) up = liftAmount((p - ws[act].t0) * 1000, (ws[act].t1 - ws[act].t0) * 1000) >= .5 ? 1 : 0;
    var shade = function (lift) {
      return function (X, Y, ci) {
        var wi = wordOf(ci);
        if ((wi === act) !== lift) return null;
        var a = lit(wi);
        if (a == null) { var cx = X + .5; a = cx < aw.xs ? 1 : cx >= aw.xs + aw.soft ? LY.dim : 1 - (1 - LY.dim) * (cx - aw.xs) / aw.soft; }
        return a * alpha;
      };
    };
    drawText(f, L, pen, base, WHITE, 1, shade(false));
    drawText(f, L, pen, base - up, WHITE, 1, shade(true));
  };
  // the line on its slots: one row centred in the box, or a page of two rows
  LyricView.prototype.line = function (f, ln, p, g, alpha, dy) {
    var fitd = fitLyric(ln, g.w), rows = fitd.rows, cx = g.x + (g.w - 1) / 2;
    if (rows.length === 1) { var L = rows[0].L; this.row(f, fitd, rows[0], penCentre(L, cx), capBase(LY.top, fitd.cap) + dy, p, alpha); return; }
    // a page of two rows: the page holding the word being sung
    var act = -1;
    for (var i = 0; i < fitd.ws.length; i++) if (p >= fitd.ws[i].t0) act = i;
    var pageRow = 0;
    for (i = 0; i < rows.length; i++) if (act >= rows[i].a) pageRow = i;
    var first = Math.min(rows.length - 1, Math.floor(pageRow / 2) * 2);
    for (var r = 0; r < 2 && first + r < rows.length; r++) {
      var R = rows[first + r];
      this.row(f, fitd, R, penCentre(R.L, cx), capBase(LY.wrap[r], fitd.cap) + dy, p, alpha);
    }
  };
  // a frame: the warp, the cover and time (Cover style), then the line being sung (or the dots in a break)
  LyricView.prototype.draw = function (f, s, t, dt) {
    var tm = s && s.tm, p = s ? s.pos : 0, art = s ? artOf(s.tr) : null, accent = s ? s.accent : [119, 237, 215], g = this.geom();
    this.warp.setTexture(art ? art.tex : null);
    this.warp.update(dt || 0);
    this.warp.render(f, .45);
    if (this.style === 'cover') {
      var cx0 = g.col - 10;
      if (art) blitArt(f, art.t20, 20, cx0, 1, .8); else washArt(f, accent, cx0, 1, 20);
      var T = line('label', 6, clockText(now()));
      drawText(f, T, penCentre(T, g.col), capBase(24, 6), mix(accent, WHITE, .62), .85);
    }
    if (!tm || !tm.lines || !tm.lines.length) return;
    // resting (paused, or not started): the first line, unsung
    if (s.rest) { this.line(f, tm.lines[0], -1, g, 1, 0); return; }
    var gap = gapAt(tm, p), cx = g.x + (g.w - 1) / 2;
    var i = Math.max(0, lineIndexAt(tm, p));
    if (i !== this.shown) { this.leaving = this.shown; this.changeAt = this.shown === -2 ? -9 : t; this.shown = i; this.warp.pulse = 1; }
    if (gap) { gapDots(f, cx, capBase(LY.top, 11) - 6, gap.k, t); return; }
    // the change of line rides the wheel: the line that was sung rises out and dims as the next rises in, inside the
    // panel's rows (here they never cross the edge: no glyph is ever half on the panel)
    var e = REDUCED ? 1 : smooth(0, 1, (t - this.changeAt) / .32);
    if (e < 1 && this.leaving >= 0 && tm.lines[this.leaving]) this.line(f, tm.lines[this.leaving], 1e9, g, (1 - e) * .9, -Math.round(e * 3));
    this.line(f, tm.lines[i], p, g, e, Math.round((1 - e) * 3));
  };

  /* ---------- scenes ---------- */
  var S = {};

  // Classic, the owner's clock face: the sky tile, the clock in cells, the temperature, the date and the sky's word
  // (WeatherScene::renderClassic and WeatherLayout.h). The tile runs x 0..47, the clock from x 50 at cap 13.
  function classic(f, st, d, w, dt, fresh, lineCol) {
    st.sky.setTarget(w.look, w.phase, w.opts, fresh);
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
    st.sky.setTarget(w.look, w.phase, w.opts, fresh);
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

  // the lyrics: the words alone (the board's "Lyrics" style), sung as the radio plays
  S.song = function () {
    var v = new LyricView('lyrics');
    return { label: 'Lyrics', dur: 12, draw: function (f, t, s, dt) { v.draw(f, playingSong(), t, dt); } };
  };
  // the board's default lyric style, Cover: the cover with the time under it, the lyrics beside. Resting (paused, or a
  // song whose words have not loaded yet): the queued song's cover and its first line, unsung.
  S.combo = function () {
    var v = new LyricView('cover');
    return {
      label: 'All in One', dur: 12,
      draw: function (f, t, s, dt) {
        var sg = playingSong();
        if (sg && !sg.playing) sg.rest = true;
        v.draw(f, sg, t, dt);
      }
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
    var v = new LyricView('lyrics');
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
    var notes = 0;
    return {
      label: 'Album art', dur: 7,
      draw: function (f, t, s, dt) {
        var sg = playingSong(), tr = sg ? sg.tr : { title: 'Night Harbour', artist: 'MooBoard' }, accent = sg ? sg.accent : [255, 154, 60];
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
          notes++;
        }
        var tp = pages('label', [9, 8, 7], tr.title, 126 - 36 + 1), ap = pages('label', [6, 5], tr.artist, 126 - 36 + 1);
        tp.forEach(function (L, k) { var a = pageAlpha(tp.length, t, k); if (a > 0) drawText(f, L, penLeft(L, 36), capBase(5, L.cap), WHITE, a); });
        ap.forEach(function (L, k) { var a = pageAlpha(ap.length, t, k); if (a > 0) drawText(f, L, penLeft(L, 36), capBase(18, L.cap), WHITE, .7 * a); });
        // the progress bar on the song's own timeline: the preview starts `at` seconds into the song
        var total = sg && sg.tr.dur ? sg.tr.dur : 210, at = sg ? (sg.tr.at || 0) + sg.pos : 84 + (t % 30);
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
        var Ti = fit('label', [9, 8], 'Yoga class', 126 - X + 1) || line('label', 8, 'Yoga class');
        var De = line('label', 6, when + ' · Studio B');
        // the title on cap top 11; where its tails would reach the details' row, it rises a row (a blank row between)
        var tTop = 11, tb = capBase(tTop, Ti.cap);
        while (tb + Ti.b + 2 > 24 && tTop > 10) { tTop--; tb = capBase(tTop, Ti.cap); }
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

  // Prayer (PrayerScene.cpp): before the singing, the om breathing over the aarti's name between two diyas; then the
  // Hindi line swept syllable by syllable in marigold to rani pink over its English letters in cream
  var MARIGOLD = hexc('#FFB81C'), RANI = hexc('#FF2E88'), CREAM = hexc('#FFF1DC');
  function hindiCol(x) { return mix(MARIGOLD, RANI, c01(x / 127)); }
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
    var fl = [{ h: 6, s: 0, l: 1 }, { h: 6, s: 0, l: 1 }];
    return {
      label: 'Prayer', dur: 9,
      draw: function (f, t, st) {
        f.fill(BLACK);
        fl.forEach(function (d, i) { d.h = 5 + Math.round(1.5 + 1.5 * Math.sin(t * 6.3 + i * 2) * Math.sin(t * 3.1 + i)); d.s = Math.sin(t * 4 + i * 3) > .55 ? 1 : Math.sin(t * 4 + i * 3) < -.55 ? -1 : 0; d.l = .85 + .15 * Math.sin(t * 9 + i); });
        if (st < 4.2) {
          var breath = .65 + .35 * (.5 + .5 * Math.sin(t / 4 * 2 * Math.PI)), Om = line('dev', 13, 'ॐ');
          drawText(f, Om, penCentre(Om, 63.5), 1 - Om.t, null, breath, function (X) { return hindiCol(X); });
          diya(f, 1, 26, fl[0].h, fl[0].s, fl[0].l); diya(f, 128 - 1 - 11, 26, fl[1].h, fl[1].s, fl[1].l);
          var nm = fit('label', [7, 6.5, 6, 5.5, 5], 'Om Jai Jagdish Hare', 114 - 14);
          if (nm) drawText(f, nm, 14 + Math.floor((100 - nm.inkW) / 2) - nm.l, 30 - nm.b, CREAM, .85);
          return;
        }
        // both views: the Hindi line on top, swept; the English letters under it, lit as they are sung
        var p = (st - 4.2) / 3.6, Hi = line('dev', 11, 'जय जगदीश हरे'), En = fit('label', [7, 6.5, 6], 'Jai Jagdish Hare', 124);
        var hp = penCentre(Hi, 63.5), hb = 1 - Hi.t, x0 = hp + Hi.l, ww = Hi.inkW, xs = x0 + ww * (-.2 + 1.2 * c01(p)), soft = .2 * ww + 1;
        var sweep = function (X) { var c = X + .5; return c < xs ? 1 : c >= xs + soft ? .4 : 1 - .6 * (c - xs) / soft; };
        drawText(f, Hi, hp, hb, null, 1, function (X) { var a = sweep(X); return [hindiCol(X)[0], hindiCol(X)[1], hindiCol(X)[2], a]; });
        // the English letters under it, a blank row clear of its lowest mark, on the lowest row the ring leaves
        if (En && 30 - En.inkH >= hb + Hi.b + 2) { var ep = penCentre(En, 63.5), ex0 = ep + En.l, exs = ex0 + En.inkW * (-.2 + 1.2 * c01(p)), esoft = .2 * En.inkW + 1; drawText(f, En, ep, 30 - En.b, CREAM, 1, function (X) { var c = X + .5; return c < exs ? 1 : c >= exs + esoft ? .4 : 1 - .6 * (c - exs) / esoft; }); }
      }
    };
  };

  // Now Watching without a picture (NowWatchingScene.cpp): a TV set on the accent's wash at the left, the title in the
  // 66-px column from x 61 at cap 10 down to 7 on one or two rows, the season and episode at cap 6 in the accent
  S.tv = function () {
    var accent = hexc('#FF9A5C');
    return {
      label: 'TV', dur: 7,
      draw: function (f, t) {
        f.fill(BLACK);
        for (var y = 0; y < 32; y++) for (var x = 0; x < 57; x++) f.set(x, y, mul(accent, .12 + .26 * (x + y) / (56 + 31)));
        var tv = mix(accent, WHITE, .55), bx = 15, by = 8;
        seg(f, 28, 8, 21, 1.5, .5, tv, .95); seg(f, 29, 8, 36, 1.5, .5, tv, .95);
        for (var i = 0; i < 27; i++) { f.blend(bx + i, by, tv, .95); f.blend(bx + i, by + 18, tv, .95); }
        for (i = 0; i < 19; i++) { f.blend(bx, by + i, tv, .95); f.blend(bx + 26, by + i, tv, .95); }
        f.rect(bx + 3, by + 3, 21, 13, tv, .22);
        for (i = 0; i < 5; i++) f.rect(bx + 11 + i, by + 5 + i, 1, 9 - 2 * i, tv, .95);
        f.rect(18, 27, 3, 1, tv, .95); f.rect(36, 27, 3, 1, tv, .95);
        var title = 'Night Train', one = fit('bold', [10, 9, 8, 7], title, 66), rows = one ? [one] : null;
        if (!rows) { var parts = title.split(' '); rows = [line('bold', 7, parts[0]), line('bold', 7, parts.slice(1).join(' '))]; }
        if (rows.length === 1) drawText(f, rows[0], penLeft(rows[0], 61), capBase(6, rows[0].cap), WHITE);
        else rows.forEach(function (L, k) { drawText(f, L, penLeft(L, 61), capBase(3 + k * 9, 7), WHITE); });
        var se = line('label', 6, 'S2 E5');
        drawText(f, se, penLeft(se, 61), capBase(24, 6), accent);
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
      draw: function (f, t) {
        var sg = playingSong(), want = sg ? sg.accent : [119, 237, 215];
        if (!cur) cur = want;
        if (want.join() !== cur.join()) { from = mix(from || cur, cur, 1); cur = want; at = t; }
        var k = from ? smooth(0, 1, (t - at) / .2) : 1, col = from ? mix(from, cur, k) : cur, bri = .8;
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
  function bigTime(f, d, t) {
    // Big time: the clock at cap 28, the colon's two dots breathing
    var ct = clockText(d), c = cellsFor('clock', 28), w = tabWidth(c.d, c.c, ct), x = Math.floor((128 - w) / 2), base = capBase(2, 28);
    var colon = .55 + .45 * (.5 + .5 * Math.cos(2 * Math.PI * ((d.getMilliseconds() + d.getSeconds() * 1000) % 2000) / 2000));
    drawTab(f, 'clock', 28, c.d, c.c, x, base, ct, WHITE, 1, function (i) { return ct[i] === ':' ? function () { return REDUCED ? 1 : colon; } : null; });
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
  S.faces = function () {
    var sky = { sky: new Sky(128, 64, 9, 13) }, fresh = true;
    return {
      label: 'Clock faces', dur: 12, enter: function () { fresh = true; },
      draw: function (f, t, st, dt) {
        var d = now(), k = Math.floor(st / 3) % 4;
        f.fill(BLACK);
        if (k === 0) bigTime(f, d, t);
        else if (k === 1) analogFace(f, d, weatherNow(d));
        else if (k === 2) sevenSegment(f, d);
        else {
          // Sky: the panel as the sky of the hour, the sun or the moon on its arc, the time low on a halo
          var w = weatherNow(d);
          var ct = clockText(d), c = cellsFor('clock', 16), tw = tabWidth(c.d, c.c, ct), x = Math.floor((128 - tw) / 2), ink = tabInk('clock', 16, c.d, c.c, ct);
          sky.sky.setTarget(w.look, w.phase, w.opts, fresh); fresh = false;
          sky.sky.setSkyTime(w.sky); sky.sky.setArc(w.arc, { x: x + ink.l - 1, y: 11, w: ink.r - ink.l + 3, h: 18 });
          sky.sky.update(dt); sky.sky.render(f, 0);
          var c2 = clockColorAt(w.sky);
          drawTab(f, 'clock', 16, c.d, c.c, x, capBase(12, 16), ct, c2);
        }
      }
    };
  };

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
        var d = now(), k = seasonNow(d), step = Math.min(dt || .016, .05), i;
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
        if (P.fall && Math.random() < P.fall) parts.push([r() * W, -1, .5 + r(), r() * 6, P.cols[Math.floor(r() * P.cols.length)]]);
        parts = parts.filter(function (q) { q[1] += q[2] * step * 12; q[0] += Math.sin(t * 2 + q[3]) * .15; f.blend(q[0], q[1], q[4], 1); return q[1] < 28; });
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

  // the MooBoard mark is itself a grid of LED dots, so it maps straight onto the panel (the startup card's cow)
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

  /* ---------- the board ---------- */
  var boards = [], maskCache = {};
  function masks(s, look) {
    var key = s + (look ? '|' + look.dot : '');
    if (maskCache[key]) return maskCache[key];
    var bw = W * s, bh = H * s, m = mk(bw, bh), u = mk(bw, bh), cell = mk(s, s), cc = cell.getContext('2d');
    var r = s * .46, g = cc.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, r);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.62, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    cc.fillStyle = g; cc.fillRect(0, 0, s, s);
    var mx = m.getContext('2d'); mx.fillStyle = mx.createPattern(cell, 'repeat'); mx.fillRect(0, 0, bw, bh);
    var cu = mk(s, s), cux = cu.getContext('2d');
    cux.fillStyle = look ? look.dot : '#1B1920'; cux.beginPath(); cux.arc(s / 2, s / 2, s * .36, 0, 6.3); cux.fill();
    var ux = u.getContext('2d'); ux.fillStyle = ux.createPattern(cu, 'repeat'); ux.fillRect(0, 0, bw, bh);
    return (maskCache[key] = { m: m, u: u });
  }
  var noise = new Float32Array(N);
  (function () { var r = rng(3); for (var i = 0; i < N; i++) noise[i] = r() * .75 + ((i % W) / W) * .25; })();

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
    if (window.ResizeObserver) new ResizeObserver(function () { self.resize(); }).observe(el);
    if (window.IntersectionObserver) new IntersectionObserver(function (e) { self.visible = e[0].isIntersecting; }, { rootMargin: '100px' }).observe(el);
    if (this.scenes[this.cur].enter) this.scenes[this.cur].enter();
    boards.push(this);
  }
  Board.prototype.resize = function () {
    var w = this.el.clientWidth || 512, dpr = Math.min(window.devicePixelRatio || 1, 2);
    var s = clamp(Math.max(Math.round(w * dpr / W), this.opts.minScale || 0), 3, this.opts.maxScale || 14);
    this.el.style.setProperty('--cell', (w / W).toFixed(2) + 'px');
    if (s === this.s) return;
    this.s = s; this.dots.width = W * s; this.dots.height = H * s; this.mk = masks(s, this.opts.look);
  };
  Board.prototype.go = function (name, now2) {
    if (!this.scenes[name]) this.scenes[name] = S[name](this);
    if (name === this.cur || this.next) return;
    this.next = name; this.tStart = now2 == null ? (performance.now() - t0) / 1000 : now2;
    if (this.scenes[name].enter) this.scenes[name].enter();
    this.el.dispatchEvent(new CustomEvent('scene', { detail: name }));
  };
  // keep one scene on the board (the song) until released
  Board.prototype.hold = function (name) {
    if (!this.scenes[name]) this.scenes[name] = S[name](this);
    this.held = name;
    if (this.next) { this.cur = this.next; this.start = this.tStart; this.next = null; }
    this.go(name);
  };
  Board.prototype.release = function () {
    var h = this.held; this.held = null;
    if (h && (this.cur === h || this.next === h)) this.go(this.names[0]);
  };
  Board.prototype.step = function () { var i = this.names.indexOf(this.cur); this.go(this.names[(i + 1) % this.names.length]); };
  Board.prototype.moo = function () {
    if (this.cur === 'moo' && !this.next) { this.start = (performance.now() - t0) / 1000; return; }
    if (this.next === 'moo') return;
    this.back = this.next || this.cur;
    if (this.next) { this.cur = this.next; this.start = this.tStart; this.next = null; }
    this.go('moo');
  };
  // paints the current frame into this.fo (the sparkle transition between scenes included) and darkens the edge ring
  Board.prototype.paint = function (t, dt) {
    var sc = this.scenes[this.cur], st = this.opts.at != null ? this.opts.at : Math.max(0, t - this.start);
    if (!this.start) { this.start = t; st = 0; }
    var TR = REDUCED ? .01 : .7, mooBack = this.cur === 'moo' && this.back;
    if (!this.next && ((this.auto && !this.held && this.names.length > 1) || mooBack) && st > sc.dur * (REDUCED ? 1.6 : 1)) {
      var nm = mooBack ? this.back : this.names[(this.names.indexOf(this.cur) + 1) % this.names.length];
      this.back = null;
      if (nm !== this.cur) this.go(nm, t);
    }
    var a = this.fa, o = this.fo;
    a.noclip(); sc.draw(a, t, st, dt); a.noclip();
    if (this.next) {
      var p = Math.max(0, (t - this.tStart) / TR), b = this.fb;
      b.noclip(); this.scenes[this.next].draw(b, t, Math.max(0, t - this.tStart), dt); b.noclip();
      if (p >= 1) { this.cur = this.next; this.next = null; this.start = this.tStart; o.copy(b); }
      else {
        var A = a.p, B = b.p, O = o.p;
        for (var q = 0, i = 0; q < N; q++, i += 3) {
          var n = noise[q];
          if (n < p - .08) { O[i] = B[i]; O[i + 1] = B[i + 1]; O[i + 2] = B[i + 2]; }
          else if (n < p) { O[i] = 255; O[i + 1] = 240; O[i + 2] = 220; }
          else { O[i] = A[i]; O[i + 1] = A[i + 1]; O[i + 2] = A[i + 2]; }
        }
      }
    } else o.copy(a);
    // the owner's edge rule: the outermost ring of LEDs stays dark on every face
    var P = o.p, x, y;
    for (x = 0; x < W; x++) { P[x * 3] = P[x * 3 + 1] = P[x * 3 + 2] = 0; var j = ((H - 1) * W + x) * 3; P[j] = P[j + 1] = P[j + 2] = 0; }
    for (y = 0; y < H; y++) { var l = y * W * 3, r = (y * W + W - 1) * 3; P[l] = P[l + 1] = P[l + 2] = 0; P[r] = P[r + 1] = P[r + 2] = 0; }
    return o;
  };
  Board.prototype.render = function (t, dt) {
    this.last = t;
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
    var named = this.scenes[this.next || this.cur].glow;
    if (this.opts.onGlow && named && (this.frame++ % 4 === 0)) { this.glow = named.slice(); this.opts.onGlow(this.glow); }
    else if (this.opts.onGlow && !named && (this.frame++ % 10 === 0)) {
      var r = 0, g = 0, bl = 0, c = 0;
      for (var j = 0; j < N * 3; j += 12) { var s2 = P[j] + P[j + 1] + P[j + 2]; if (s2 > 60) { r += P[j]; g += P[j + 1]; bl += P[j + 2]; c++; } }
      if (c) { this.glow = mix(this.glow, [r / c, g / c, bl / c], .35); this.opts.onGlow(this.glow); }
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
        if (!b.visible || (b.opts.when && !b.opts.when())) continue;
        // opts.fps caps a board (the tiles run at 30); a capped board gets the time since its own last frame
        if (b.opts.fps && t - b.last < 1 / b.opts.fps - .003) continue;
        try { b.render(t, b.opts.fps ? Math.min(t - b.last, .1) : acc); } catch (e) { if (!b.failed) { b.failed = 1; setTimeout(function () { throw e; }); } }
      }
      acc = 0;
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

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
    logText: function (on) { var l = textLog; textLog = on ? [] : null; return l; }
  };
})();
