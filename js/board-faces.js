/* mooboard clock faces (clock/Faces*.cpp): Big time, Sky, Flip, Nixie, Binary, Matrix rain, Weather forward, Moon,
   Agenda and the rest. Not a script of its own: js/board.js reads this file into its scope the first time a board
   shows the faces, so everything here uses board.js's drawing kit, text and sky directly, and it sets FACES_SCENE. */
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
  FACES_SCENE = function (b) {
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

