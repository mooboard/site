/* MooBoard live LED board.
   Every scene draws into a 128 x 32 canvas. Text is drawn into a scratch canvas and
   thresholded to hard pixels, like a real panel. The frame is then shown two ways:
   as round LEDs (big canvas, dot mask) and as a blurred copy for the glow. */
(function () {
  'use strict';

  var W = 128, H = 32, N = W * H;
  var REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var PIX = '8px Silkscreen';
  var DEV = '"Noto Sans Devanagari", "Kohinoor Devanagari", sans-serif';

  var C = {
    marigold: [255, 184, 28], pink: [255, 46, 136], cream: [245, 233, 214],
    sky: [119, 237, 215], warm: [255, 238, 214], white: [255, 255, 255]
  };

  /* ---------- helpers ---------- */
  function mk(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function mix(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
  function mul(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function rgb(a, al) { return 'rgba(' + (a[0] | 0) + ',' + (a[1] | 0) + ',' + (a[2] | 0) + ',' + (al == null ? 1 : al) + ')'; }
  function hexc(h) { h = h.replace('#', ''); return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)]; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(t) { t = clamp(t, 0, 1); return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function hsl(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    function f(n) { var k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); }
    return [f(0), f(8), f(4)];
  }
  function rnd(seed) { return function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
  var sweep = function (x, x0, x1) { return mix(C.marigold, C.pink, clamp((x - x0) / Math.max(1, x1 - x0), 0, 1)); };

  /* ---------- thresholded text ---------- */
  var sc = mk(W, H), sx = sc.getContext('2d', { willReadFrequently: true });

  function measure(str, font) {
    sx.font = font;
    var m = sx.measureText(str);
    return { l: m.actualBoundingBoxLeft, r: m.actualBoundingBoxRight, a: m.actualBoundingBoxAscent, d: m.actualBoundingBoxDescent, w: m.width };
  }
  // x position that centers the ink of str on cx (left aligned drawing)
  function cx(str, font, c) { var m = measure(str, font); return Math.round(c - (m.r - m.l) / 2); }

  // draw str with its baseline at y. color: [r,g,b] or fn(x,y) -> [r,g,b,alpha?]
  // thresholded glyph masks are cached per string, font and position, so a line that stays put costs no raster work
  var glyphMaskCache = new Map(), glyphImg = sx.createImageData(W, H);
  function text(ctx, str, x, y, color, font, thr) {
    font = font || PIX; thr = thr == null ? 0.5 : thr;
    var key = str + '|' + font + '|' + Math.round(x) + '|' + Math.round(y) + '|' + thr, lit = glyphMaskCache.get(key);
    if (!lit) {
      sx.clearRect(0, 0, W, H);
      sx.font = font; sx.textBaseline = 'alphabetic'; sx.textAlign = 'left';
      sx.fillStyle = '#fff'; sx.fillText(str, Math.round(x), Math.round(y));
      var src = sx.getImageData(0, 0, W, H).data, lim = thr * 255, list = [];
      for (var q = 0; q < N; q++) if (src[q * 4 + 3] > lim) list.push(q);
      lit = new Uint16Array(list);
      if (glyphMaskCache.size > 400) glyphMaskCache.delete(glyphMaskCache.keys().next().value);
      glyphMaskCache.set(key, lit);
    }
    var img = glyphImg, d = img.data, fn = typeof color === 'function' ? color : null;
    d.fill(0);
    var c = fn ? null : (color || C.white), x0 = W, x1 = -1;
    for (var j = 0; j < lit.length; j++) {
      var p = lit[j], i = p * 4, px = p % W, py = (p / W) | 0, k = fn ? fn(px, py) : c;
      d[i] = k[0]; d[i + 1] = k[1]; d[i + 2] = k[2]; d[i + 3] = 255 * (k[3] == null ? 1 : k[3]);
      if (px < x0) x0 = px; if (px > x1) x1 = px;
    }
    sx.putImageData(img, 0, 0);
    ctx.drawImage(sc, 0, 0);
    return { x0: x0, x1: x1 };
  }

  function ctext(ctx, str, c, y, color, font, thr) { return text(ctx, str, cx(str, font || PIX, c), y, color, font, thr); }

  function px(ctx, x, y, c, a) { ctx.fillStyle = rgb(c, a); ctx.fillRect(x | 0, y | 0, 1, 1); }
  function rect(ctx, x, y, w, h, c, a) { ctx.fillStyle = rgb(c, a); ctx.fillRect(x | 0, y | 0, w | 0, h | 0); }
  function disc(ctx, x, y, r, c, a) { ctx.fillStyle = rgb(c, a); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }

  function use12h() {
    try { return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12 !== false; } catch (e) { return true; }
  }
  var H12 = use12h();
  var DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  var MONS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  function clockParts(d) {
    var h = d.getHours(), m = d.getMinutes();
    var hh = H12 ? ((h + 11) % 12 + 1) : h;
    return { h: H12 ? String(hh) : (hh < 10 ? '0' : '') + hh, m: (m < 10 ? '0' : '') + m, ap: h < 12 ? 'AM' : 'PM' };
  }

  /* ---------- sky ---------- */
  var SKY = [
    [0, '#03050f', '#0b1233'], [5, '#0b1233', '#3a2750'], [6.5, '#2b4a8f', '#ff8a5c'], [8, '#3b8fd2', '#a4dcf2'],
    [12, '#2a80d8', '#92d2f6'], [16.5, '#3a7cc4', '#f2b574'], [18.8, '#3a2b6c', '#ff6a4a'], [20.2, '#0d1539', '#2b1f4c'], [24, '#03050f', '#0b1233']
  ];
  function skyAt(h) {
    for (var i = 0; i < SKY.length - 1; i++) {
      var a = SKY[i], b = SKY[i + 1];
      if (h >= a[0] && h <= b[0]) {
        var t = (h - a[0]) / (b[0] - a[0]);
        return [mix(hexc(a[1]), hexc(b[1]), t), mix(hexc(a[2]), hexc(b[2]), t)];
      }
    }
    return [hexc('#03050f'), hexc('#0b1233')];
  }
  // approximate sunrise and sunset (local hours) from the time zone's offset and today's date; 6:30 / 18:30 if unknown
  var SUN = (function () {
    try {
      var d = new Date(), doy = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
      var tzH = -d.getTimezoneOffset() / 60, dst = Math.max(new Date(d.getFullYear(), 0, 1).getTimezoneOffset(), new Date(d.getFullYear(), 6, 1).getTimezoneOffset()) !== d.getTimezoneOffset() ? 1 : 0;
      var lat = 40 * (/^(Australia|Pacific\/Auckland|America\/(Sao_Paulo|Argentina|Santiago)|Africa\/Johannesburg)/.test(Intl.DateTimeFormat().resolvedOptions().timeZone || '') ? -1 : 1);
      var decl = 23.44 * Math.sin((2 * Math.PI / 365) * (doy - 81)) * Math.PI / 180, la = lat * Math.PI / 180;
      var ha = Math.acos(Math.max(-1, Math.min(1, -Math.tan(la) * Math.tan(decl)))) * 12 / Math.PI;
      var noon = 12 + dst; // the zone's center longitude puts solar noon near 12:00 standard time
      return [noon - ha, noon + ha];
    } catch (e) { return [6.5, 18.5]; }
  })();
  // the sky palette was drawn for a 6:30 sunrise and 18:45 sunset; stretch real time onto it
  function skyHour(h) {
    var r = SUN[0], st = SUN[1];
    if (h >= r && h <= st) return 6.5 + (h - r) / (st - r) * 12.25;
    var night = 24 - (st - r), k = ((h - st + 24) % 24) / night;
    return (18.75 + k * (24 - 12.25)) % 24;
  }
  function drawSky(ctx, t, h, dim, region, arcW) {
    var hs = h; h = skyHour(h);
    var s = skyAt(h), rw = region || W;
    for (var y = 0; y < H; y++) rect(ctx, 0, y, rw, 1, mul(mix(s[0], s[1], y / (H - 1)), dim));
    var night = h < 5.6 || h > 19.8 ? 1 : h < 6.6 ? (6.6 - h) : h > 18.8 ? (h - 18.8) : 0;
    night = clamp(night, 0, 1);
    if (night > 0) {
      var r = rnd(7);
      for (var i = 0; i < 46; i++) {
        var sx0 = r() * rw, sy0 = r() * 22, ph = r() * 6.28, sp = .6 + r() * 2;
        var tw = .35 + .65 * Math.abs(Math.sin(t * sp + ph));
        px(ctx, sx0, sy0, C.warm, night * tw * (r() > .8 ? 1 : .55));
      }
    }
    // sun by day, moon by night, on one arc: rising at the left edge, highest midway, setting at the right edge
    h = hs; var rise = SUN[0], set = SUN[1], up = h >= rise && h < set;
    var p = up ? (h - rise) / (set - rise) : ((h - set + 24) % 24) / (24 - (set - rise));
    var aw = arcW || rw, bx = 2 + p * (aw - 4), by = 27 - Math.sin(p * Math.PI) * 21;
    // the path itself: a faint dotted arc, one dim LED every 3 columns (the moon's is dimmer)
    askWeather();
    for (var ax = 2; ax <= aw - 2; ax += 3) {
      var ap = (ax - 2) / (aw - 4), ay = Math.round(27 - Math.sin(ap * Math.PI) * 21);
      if (Math.abs(ax - bx) > 5) px(ctx, ax, ay, up ? [255, 214, 120] : [170, 190, 255], up ? .45 : .25);
    }
    if (up) {
      disc(ctx, bx, by, 6.5, [255, 170, 40], .22);
      disc(ctx, bx, by, 4.2, [255, 205, 70]);
      disc(ctx, bx - 1, by - 1, 2, [255, 245, 200]);
    } else {
      disc(ctx, bx, by, 5.5, [180, 200, 255], .12);
      disc(ctx, bx, by, 3.6, [236, 232, 214]);
      disc(ctx, bx + 1.8, by - 1.2, 3.1, mul(mix(s[0], s[1], by / H), dim));
    }
    // drifting clouds by day
    if (skyHour(h) > 7 && skyHour(h) < 18.5) {
      for (var k = 0; k < 3; k++) {
        var cxp = ((t * (2 + k) + k * 53) % (rw + 30)) - 15, cy = 5 + k * 5;
        ctx.fillStyle = rgb([235, 240, 248], .32 * dim + .06);
        ctx.beginPath(); ctx.ellipse(cxp, cy, 7, 2.2, 0, 0, 6.3); ctx.ellipse(cxp + 4, cy - 1.4, 4, 2, 0, 0, 6.3); ctx.fill();
      }
    }
    // hills
    for (var x = 0; x < rw; x++) {
      var hy = 28 + Math.round(Math.sin(x * .09 + 1) * 1.6 + Math.sin(x * .23) * .8);
      rect(ctx, x, hy, 1, H - hy, mul([22, 70, 60], .5 + .5 * (1 - night)));
    }
  }

  /* ---------- scenes ---------- */
  var S = {};

  S.time = function () {
    return {
      label: 'Time', dur: 7,
      draw: function (ctx, t) {
        var d = new Date(), h = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
        drawSky(ctx, t, h, .78, 42);
        rect(ctx, 42, 0, W - 42, H, [0, 0, 0]);
        var c = clockParts(d), font = '800 27px Nunito';
        var str = c.h + ':' + c.m, x = cx(str, font, 85);
        var hw = measure(c.h, font).w, cw = measure(':', font).w, blink = d.getMilliseconds() < 500 || REDUCED;
        text(ctx, str, x, 22, function (X) { return X >= x + hw && X < x + hw + cw && !blink ? [0, 0, 0, 0] : C.warm; }, font);
        var date = DAYS[d.getDay()] + ' ' + MONS[d.getMonth()] + ' ' + d.getDate();
        ctext(ctx, date, 85, 31, mul(C.cream, .55));
        if (H12) text(ctx, c.ap, 126 - measure(c.ap, PIX).w, 8, mul(C.sky, .9));
      }
    };
  };

  var STANZAS = [
    ['we danced in', 'the kitchen light'],
    ['and the radio', 'sang all night']
  ];
  // the demo lyrics (tiles and story): the same board layout, timed at a steady pace
  var DEMO = (function () {
    var lines = [], t = 1.2;
    STANZAS.forEach(function (st) { st.forEach(function (txt) {
      var ws = txt.split(' '), l = { words: [], t0: t };
      ws.forEach(function (w) { l.words.push({ text: w, t0: t, t1: t + .42 }); t += .42; });
      l.text = txt; lines.push(l); t += .5;
    }); });
    lines.forEach(function (l, i) { l.t1 = lines[i + 1] ? lines[i + 1].t0 : t; });
    return { lines: lines, length: t + 1 };
  })();
  S.lyrics = function () {
    return {
      label: 'Lyrics', dur: DEMO.length,
      draw: function (ctx, t, st) { drawLyrics(ctx, DEMO, st % DEMO.length, null, FULL, FULL_FAINT); }
    };
  };


  // the playlist (js/music.js): the current line lights word by word in the track's color
  function bright(c) { var m = Math.max(c[0], c[1], c[2], 1); return mul(c, 255 / m); }
  // Lyric layout, like the real board: no glyph is ever clipped.
  // 1) the line fits by ink at 13 px, 2) or at 11 px, 3) or it wraps at a word into both rows,
  // 4) or the row scrolls smoothly so the word being sung stays in view; words not fully on the board are not drawn.
  // An area is where the lyrics may go: { l, r, sizes }. The full board uses 13 then 11 px.
  var FULL = { l: 0, r: W, sizes: [15, 13], key: 'full', big: 18 };
  // lyrics are set in the MooBoard rounded face, Fredoka SemiBold, like the board
  function lf(px2) { return '600 ' + px2 + 'px Fredoka'; }
  function join(ws) { return ws.map(function (w) { return w.text; }).join(' '); }
  function inkW(str, font) { var m = measure(str, font); return m.l + m.r; }
  function rowsFor(line, A) {
    var ws = line.words, av = A.r - A.l - 4, sz = A.sizes, i, f;
    for (i = 0; i < sz.length; i++) { f = lf(sz[i]); if (inkW(join(ws), f) <= av) return [{ words: ws, font: f }]; }
    f = lf(sz[sz.length - 1]);
    if (ws.length < 2) return [{ words: ws, font: f, scroll: true }];
    for (i = 0; i < sz.length; i++) {
      var fi = lf(sz[i]), best = null;
      for (var k = 1; k < ws.length; k++) {
        var m = Math.max(inkW(join(ws.slice(0, k)), fi), inkW(join(ws.slice(k)), fi));
        if (!best || m < best[1]) best = [k, m];
      }
      if (best[1] <= av || i === sz.length - 1) {
        var P = ws.slice(0, best[0]), Q = ws.slice(best[0]);
        return [{ words: P, font: fi, scroll: inkW(join(P), fi) > av }, { words: Q, font: fi, scroll: inkW(join(Q), fi) > av }];
      }
    }
  }
  // pages: two one-row lines share the area (top sweeps, then bottom); a line that needs both rows gets it to itself
  function pagesFor(tm, A) {
    A = A || FULL; tm._pages = tm._pages || {};
    if (tm._pages[A.key]) return tm._pages[A.key];
    var L = tm.lines, rows = L.map(function (l) { return rowsFor(l, A); }), pages = [], i = 0;
    while (i < L.length) {
      if (rows[i].length === 1 && !rows[i][0].scroll && L[i + 1] && rows[i + 1].length === 1 && !rows[i + 1][0].scroll) { pages.push({ from: i, to: i + 1, rows: [rows[i][0], rows[i + 1][0]] }); i += 2; }
      else {
        // a line alone that fits one row gets the big size (cap height about 13 LEDs) when it can
        var one = rows[i];
        if (one.length === 1 && !one[0].scroll && A.big) { var bf = lf(A.big); if (inkW(join(one[0].words), bf) <= A.r - A.l - 4) one = [{ words: one[0].words, font: bf, big: true }]; }
        pages.push({ from: i, to: i, rows: one }); i += 1;
      }
    }
    return (tm._pages[A.key] = pages);
  }
  function pageAt(tm, A, p) {
    var L = tm.lines, li = 0, pages = pagesFor(tm, A);
    while (li < L.length - 1 && p >= L[li].t1) li++;
    for (var i = 0; i < pages.length; i++) if (li >= pages[i].from && li <= pages[i].to) return pages[i];
    return pages[0];
  }
  // instrumental gaps (before the first line, or 3 s or more between lines): Apple Music style dots that fill across the gap
  function gapAt(tm, p) {
    var L = tm.lines, GAP = 3;
    if (!L.length) return null;
    if (p < L[0].t0 && L[0].t0 >= GAP) return { k: clamp(p / L[0].t0, 0, 1) };
    for (var i = 0; i < L.length - 1; i++) {
      var ws = L[i].words, end = ws && ws.length ? ws[ws.length - 1].t1 : L[i].t1, nx = L[i + 1].t0;
      if (end == null || isNaN(end)) end = L[i].t1;
      if (p >= end && p < nx && nx - end >= GAP) return { k: clamp((p - end) / (nx - end), 0, 1) };
    }
    return null;
  }
  function gapDots(ctx, A, y, k, t, tint) {
    var cxm = (A.l + A.r) / 2, hi = bright(tint || C.marigold), dim = mul(C.cream, .18);
    for (var i = 0; i < 3; i++) {
      var f = clamp(k * 3 - i, 0, 1), breathe = REDUCED ? 1 : .82 + .18 * Math.sin(t * 4 + i * 1.3);
      var x = cxm + (i - 1) * 9, r = 2.2 + (REDUCED ? 0 : f * .5 * breathe);
      disc(ctx, x, y, r, f > 0 ? mix(dim, mul(hi, breathe), f) : dim);
    }
  }
  // syllables for the bounce: vowel groups, consonants split V-CV / VC-CV, common digraphs kept, a silent final e,
  // and "-ing" / "-le" endings. One-syllable words stay whole. Returns the pieces (their letters join back to the word).
  var DIG = /^(ch|sh|th|ph|wh|ck|ng|qu|gh)$/;
  function syllables(word) {
    var w = word.toLowerCase(), n = w.length, isV = [], i;
    if (n <= 3 || !/[a-z]/.test(w)) return [word];
    for (i = 0; i < n; i++) isV[i] = /[aeiou]/.test(w[i]) || (w[i] === 'y' && i > 0 && !/[aeiou]/.test(w[i - 1]));
    if (w[n - 1] === 'e' && !isV[n - 2] && !(w[n - 2] === 'l' && n > 3 && !isV[n - 3])) isV[n - 1] = false;   // silent e (but keep "-le")
    var groups = [];
    for (i = 0; i < n; i++) if (isV[i] && !isV[i - 1]) groups.push(i);
    if (groups.length < 2) return [word];
    var cuts = [];
    for (var g = 1; g < groups.length; g++) {
      var end = groups[g - 1]; while (end < n && isV[end]) end++;
      var cl = groups[g] - end, cut;
      if (cl <= 1) cut = end;                                                       // V-CV
      else if (cl === 2 && DIG.test(w.substr(end, 2))) cut = end;                    // keep "ch", "th" together
      else if (cl >= 3 && DIG.test(w.substr(end + 1, 2))) cut = end + 1;              // "kit-chen"
      else cut = end + 1;                                                             // VC-CV
      cuts.push(cut);
    }
    if (/ing$/.test(w) && n > 4) { cuts = cuts.filter(function (c) { return c < n - 3; }); cuts.push(n - 3); }      // sing-ing
    if (/[^aeiou]le$/.test(w) && n > 4) { cuts = cuts.filter(function (c) { return c < n - 3; }); cuts.push(n - 3); } // lit-tle
    cuts = cuts.filter(function (c, k) { return c > 0 && c < n && cuts.indexOf(c) === k; }).sort(function (x, y) { return x - y; });
    var out = [], last = 0;
    cuts.forEach(function (c) { if (c > last) { out.push(word.slice(last, c)); last = c; } });
    out.push(word.slice(last));
    // a piece with no vowel joins the one before it ("sing-ing", not "si-ng-ing")
    var fin = [];
    out.forEach(function (pc) { if (fin.length && !/[aeiouy]/i.test(pc)) fin[fin.length - 1] += pc; else fin.push(pc); });
    if (fin.length > 1 && !/[aeiouy]/i.test(fin[0])) fin.splice(0, 2, fin[0] + fin[1]);
    return fin;
  }
  // a quick spring: up in ~80 ms, settles in ~200 ms with a small overshoot
  function lift(dt, amp) {
    if (dt < 0 || dt > .3) return 0;
    if (dt < .08) return amp * dt / .08;
    var v = (dt - .08) / .2;
    return amp * (1 - v) - amp * .35 * Math.sin(v * Math.PI);
  }
  function lyricRow(ctx, row, y, p, tint, A) {
    A = A || FULL;
    var font = row.font, line = join(row.words), m = measure(line, font), iw = m.l + m.r, av = A.r - A.l - 4;
    var hi = bright(tint || C.marigold), lo = mix(hi, C.white, .55), dim = mul(C.cream, .22);
    // syllable spans relative to the ink start: [x0, x1, t0, t1]; each word's sweep time is shared by letter count
    var spans = [], acc = '';
    row.words.forEach(function (w, k) {
      var pre = acc + (k ? ' ' : ''), parts = syllables(w.text), t0 = w.t0, t1 = Math.min(w.t1, w.t0 + .7), dur = t1 - t0, done = 0;
      parts.forEach(function (pt) {
        var s0 = measure(pre + w.text.slice(0, done), font).w, s1 = measure(pre + w.text.slice(0, done + pt.length), font).w;
        var a0 = t0 + dur * done / w.text.length, a1 = t0 + dur * (done + pt.length) / w.text.length;
        spans.push([k || done ? s0 : 0, s1, a0, a1, done === 0, done + pt.length === w.text.length]);
        done += pt.length;
      });
      acc = pre + w.text;
    });
    var inkX = row.scroll ? A.l + 2 : Math.round((A.l + A.r) / 2 - iw / 2);
    if (row.scroll) {
      // follow the sweep point continuously (no state, so every board scrolls alike), keeping a small margin
      var sx = 0;
      for (var q = 0; q < spans.length; q++) {
        var f = clamp((p - spans[q][2]) / Math.max(.03, spans[q][3] - spans[q][2]), 0, 1);
        if (p >= spans[q][2]) sx = spans[q][0] + (spans[q][1] - spans[q][0]) * f;
      }
      inkX = A.l + 2 - clamp(sx - av * .62, 0, iw - av);
    }
    var x0 = inkX + m.l, cut = new Uint8Array(W), gx;
    for (gx = 0; gx < W; gx++) if (gx <= A.l || gx >= A.r - 1) cut[gx] = 1;
    if (row.scroll) {
      // a glyph that is not wholly inside the area is not drawn at all
      for (var c = 0; c < line.length; c++) {
        var a = x0 + measure(line.slice(0, c), font).w, b = x0 + measure(line.slice(0, c + 1), font).w;
        if (a < A.l + 1) for (gx = 0; gx < Math.min(W, Math.floor(b)); gx++) cut[gx] = 1;
        if (b > A.r - 1) for (gx = Math.max(0, Math.ceil(a)); gx < W; gx++) cut[gx] = 1;
      }
    }
    // the syllable being sung bounces (one at a time), as far as the headroom allows
    var bq = -1, up = 0;
    if (!REDUCED) for (var j = spans.length - 1; j >= 0; j--) if (p >= spans[j][2]) { up = Math.round(Math.min(A.lift || 2, y - m.a - 1) > 0 ? lift(p - spans[j][2], Math.min(A.lift || 2, y - m.a - 1)) : 0); if (up) bq = j; break; }
    var colorAt = function (X, only) {
      if (cut[X]) return [0, 0, 0, 0];
      for (var q = 0; q < spans.length; q++) {
        var sp = spans[q], a0 = x0 + sp[0], a1 = x0 + sp[1];
        if (X >= (sp[4] ? a0 - 1 : Math.round(a0)) && X <= (sp[5] ? a1 + 1 : Math.round(a1) - 1)) {
          if (only != null && q !== only) return [0, 0, 0, 0];
          if (only == null && q === bq) return [0, 0, 0, 0];
          var f = (p - sp[2]) / Math.max(.03, sp[3] - sp[2]);
          if (f >= 1 || (f > 0 && X <= a0 + (a1 - a0) * f)) return mix(lo, hi, clamp((X - inkX) / Math.max(1, iw), 0, 1));
          return dim;
        }
      }
      return only != null ? [0, 0, 0, 0] : dim;
    };
    text(ctx, line, x0, y, function (X) { return colorAt(X, null); }, font);
    if (bq >= 0) text(ctx, line, x0, y - up, function (X) { return colorAt(X, bq); }, font);
  }

  S.song = function () {
    return {
      label: 'Lyrics', dur: 12,
      draw: function (ctx) {
        var M = window.MooMusic, tm = M && M.timing(), tr = M && M.track();
        if (!tm || !tm.lines || !tm.lines.length) { ctext(ctx, 'MOO', 64, 20, mul(C.cream, .3)); return; }
        var p = M.pos(), L = tm.lines, li = 0;
        while (li < L.length - 1 && p >= L[li].t1) li++;
        var tint = tr && tr.tint ? hexc(tr.tint) : null;
        drawLyrics(ctx, tm, p, tint, FULL, FULL_FAINT);
      }
    };
  };

  // Cover + lyrics with a small clock, like the firmware layout: art square left, lyrics right, time in the corner
  // All in One, like the board's "Cover + time" layout: art square top left, the local time under it in warm peach,
  // lyrics on the right: the current line bright and sweeping, the previous and next lines faint above and below
  var COMBO = { l: 30, r: W, sizes: [13, 11], key: 'combo', lift: 1 };
  var FAINT = { l: 30, r: W, sizes: [9], key: 'faint' };
  var artImgs = {};
  function artFor(tr) {
    var M = window.MooMusic, src = tr && M && M.cover ? M.cover(tr) : null;
    if (!src) return null;
    var im = artImgs[src];
    if (!im) { im = artImgs[src] = new Image(); im.crossOrigin = 'anonymous'; im.onerror = function () { im.bad = true; }; im.src = src; }
    return im.complete && im.naturalWidth && !im.bad ? im : null;
  }
  // board-style lyrics in an area: current line big and bright (wraps to two rows if it must), previous and next faint
  function drawLyrics(ctx, tm, p, tint, A, F) {
    var L = tm.lines, gp = gapAt(tm, p), mid = (A.l + A.r) / 2;
    if (gp) { gapDots(ctx, A, 16, gp.k, p, tint); return; }
    var li = 0;
    while (li < L.length - 1 && p >= L[li + 1].t0) li++;
    var cur = rowsFor(L[li], A);
    if (cur.length === 2) { lyricRow(ctx, cur[0], 14, p, tint, A); lyricRow(ctx, cur[1], 28, p, tint, A); return; }
    var e = REDUCED ? 1 : clamp((p - L[li].t0) / .25, 0, 1), sh = Math.round((1 - e) * 10);
    var prev = li > 0 ? rowsFor(L[li - 1], F) : null, next = L[li + 1] ? rowsFor(L[li + 1], F) : null;
    if (prev && prev.length === 1 && !prev[0].scroll && sh < 7) lyricRow(ctx, prev[0], 7 + sh, -1, tint, F);
    lyricRow(ctx, cur[0], 21 + sh, p, tint, A);
    if (next && next.length === 1 && !next[0].scroll && e >= 1) lyricRow(ctx, next[0], 30, -1, tint, F);
    void mid;
  }
  var FULL_FAINT = { l: 0, r: W, sizes: [9], key: 'fullfaint' };

  S.combo = function () {
    return {
      label: 'All in One', dur: 12,
      draw: function (ctx, t) {
        var M = window.MooMusic, tm = M && M.timing(), tr = M && M.track(), tint = tr && tr.tint ? hexc(tr.tint) : C.marigold;
        var AX = 5, AY = 1, AS = 20, im = artFor(tr);
        if (im) { try { ctx.imageSmoothingEnabled = true; ctx.drawImage(im, AX, AY, AS, AS); } catch (e) { im = null; } }
        if (!im) {
          for (var y = 0; y < AS; y++) rect(ctx, AX, AY + y, AS, 1, mix(mul(tint, .35), mix(tint, C.white, .35), y / (AS - 1)));
          disc(ctx, AX + AS / 2, AY + 9, 5, mix(tint, C.white, .7));
        }
        // the visitor's local time, h:mm, centred under the art
        var d = new Date(), c = clockParts(d), clk = c.h + ':' + c.m;
        ctext(ctx, clk, AX + AS / 2, 30, [255, 206, 170]);
        if (!tm || !tm.lines || !tm.lines.length) return;
        var p = M.pos();
        drawLyrics(ctx, tm, p, tint, COMBO, FAINT);
      }
    };
  };


  S.art = function () {
    return {
      label: 'Album art', dur: 7,
      draw: function (ctx, t, st) {
        // procedural cover: sunset over water
        for (var y = 0; y < 32; y++) {
          var k = y / 31, c = y < 19 ? mix([255, 94, 120], [255, 176, 60], k * 1.6) : mix([40, 60, 140], [20, 30, 80], (y - 19) / 12);
          rect(ctx, 0, y, 32, 1, c);
        }
        disc(ctx, 16, 17, 7, [255, 236, 170]);
        rect(ctx, 0, 19, 32, 13, [30, 44, 110]);
        for (var r = 0; r < 6; r++) {
          var ww = 10 - r * 1.3, off = Math.sin(t * 2 + r) * 1.5;
          rect(ctx, 16 - ww / 2 + off, 20 + r * 2, ww, 1, [255, 214, 140], .8 - r * .1);
        }
        var p = (st / 7 * 0.25 + .32);
        text(ctx, 'SUNDAY LIGHT', 38, 10, C.cream);
        text(ctx, 'THE MEADOWS', 38, 19, mul(C.cream, .45));
        rect(ctx, 38, 25, 86, 1, [60, 50, 60]);
        rect(ctx, 38, 25, 86 * p, 1, [255, 150, 90]);
        disc(ctx, 38 + 86 * p, 25.5, 1.5, [255, 214, 170]);
        // tiny equaliser
        for (var b = 0; b < 5; b++) {
          var hb = 2 + Math.abs(Math.sin(t * (3 + b) + b)) * 4;
          rect(ctx, 106 + b * 4, 19 - hb, 2, hb, mix([255, 184, 28], [255, 46, 136], b / 4));
        }
      }
    };
  };

  S.calendar = function () {
    return {
      label: 'Calendar', dur: 7,
      draw: function (ctx, t, st) {
        // calendar icon
        rect(ctx, 5, 8, 19, 18, [236, 232, 224]);
        rect(ctx, 5, 8, 19, 5, [235, 64, 64]);
        rect(ctx, 9, 6, 2, 4, [180, 180, 180]); rect(ctx, 18, 6, 2, 4, [180, 180, 180]);
        ctext(ctx, String(new Date().getDate()), 14.5, 24, [30, 30, 40]);
        text(ctx, 'LEAVE IN', 31, 10, mul(C.cream, .6));
        var n = st < 3.6 ? 12 : 11, roll = st >= 3.6 && st < 3.9 ? (st - 3.6) / .3 : 1;
        var pulse = .75 + .25 * Math.sin(t * 5);
        var font = '900 19px Nunito', yo = Math.round((1 - ease(roll)) * -10);
        var b = text(ctx, String(n), 31, 29 + yo, function (X) { return mul(sweep(X, 31, 60), pulse); }, font);
        text(ctx, 'MIN', b.x1 + 4, 29, C.warm, '900 13px Nunito');
        text(ctx, '3:30', 126 - measure('3:30', PIX).w, 10, mul(C.sky, .9));
        text(ctx, 'YOGA', 126 - measure('YOGA', PIX).w, 19, mul(C.cream, .5));
        // car on the road
        rect(ctx, 94, 27, 31, 1, [70, 70, 80]);
        var carx = 94 + ((st * 5) % 26);
        rect(ctx, carx, 24, 5, 2, C.sky); rect(ctx, carx + 1, 23, 3, 1, C.sky);
      }
    };
  };

  /* ---------- scores: invented teams only, original pixel logos ---------- */
  var TEAMS = {
    MOO: { name: 'MOOSES', c: [18, 140, 110], c2: [245, 233, 214] },   // Moo City Mooses: a cow head
    PUM: { name: 'PUMAS', c: [96, 52, 160], c2: [255, 150, 60] }        // Pasture Pumas: a paw
  };
  function logo(ctx, id, x, y, r) {
    var T = TEAMS[id];
    disc(ctx, x, y, r, T.c2); disc(ctx, x, y, r - Math.max(1, r * .16), T.c);
    var k = r / 10;
    if (id === 'MOO') {
      ctx.fillStyle = rgb(T.c2);
      ctx.fillRect(x - 6 * k, y - 7 * k, 2 * k, 4 * k); ctx.fillRect(x + 4 * k, y - 7 * k, 2 * k, 4 * k);   // horns
      disc(ctx, x, y + k, 5 * k, T.c2);                                                                  // face
      disc(ctx, x - 2 * k, y, 1.1 * k, [0, 0, 0]); disc(ctx, x + 2 * k, y, 1.1 * k, [0, 0, 0]);            // eyes
      disc(ctx, x, y + 4 * k, 2.6 * k, [255, 150, 185]);                                                 // muzzle
    } else {
      disc(ctx, x, y + 2.4 * k, 3.6 * k, T.c2);
      [[-4.2, -2], [-1.5, -4.6], [1.5, -4.6], [4.2, -2]].forEach(function (q) { disc(ctx, x + q[0] * k, y + q[1] * k, 1.6 * k, T.c2); });
    }
  }
  var SMALL = '8px Silkscreen', BIG = '800 22px Nunito';
  S.score = function () {
    var conf = [];
    return {
      label: 'Scores', dur: 16,
      draw: function (ctx, t, st, dt) {
        var A = TEAMS.MOO, B = TEAMS.PUM, ph = st % 16;
        var mooScore = ph >= 11.2 ? 23 : 17, blink = Math.floor(t * 2) % 2;
        if (ph < 4) {
          // face-off: team panels with logos, big scores, status row
          rect(ctx, 0, 0, 26, H, mul(A.c, .8)); rect(ctx, 102, 0, 26, H, mul(B.c, .8));
          logo(ctx, 'MOO', 13, 12, 9); logo(ctx, 'PUM', 115, 12, 9);
          ctext(ctx, '17', 47, 21, C.white, BIG); rect(ctx, 62, 12, 4, 2, mul(C.white, .6)); ctext(ctx, '14', 81, 21, C.white, BIG);
          ctext(ctx, 'Q3 4:12', 64, 31, mul(C.cream, .7), SMALL);
          disc(ctx, 13, 27, 1.5, [200, 110, 50]); px(ctx, 13, 27, C.white);
          for (var i = 0; i < 3; i++) rect(ctx, 5 + i * 6, 30, 4, 1, C.white); for (i = 0; i < 2; i++) rect(ctx, 108 + i * 6, 30, 4, 1, C.white);
        } else if (ph < 7.5) {
          // scorebug: logo and name chips, scores, three-line status
          logo(ctx, 'MOO', 7, 8, 6); logo(ctx, 'PUM', 7, 24, 6);
          text(ctx, 'MOO', 16, 12, C.white, SMALL); text(ctx, 'PUM', 16, 28, C.white, SMALL);
          text(ctx, '17', 44, 14, C.white, '800 15px Nunito'); text(ctx, '14', 44, 30, C.white, '800 15px Nunito');
          [[64, 1], [64, 4], [64, 7]].forEach(function (q, i) { px(ctx, q[0], q[1] + 3, blink ? C.marigold : C.white); });
          text(ctx, 'Q3 4:12', 80, 10, C.white, SMALL); text(ctx, '3RD+7', 80, 20, mul(C.cream, .75), SMALL); text(ctx, 'PUM 35', 80, 30, mul(C.cream, .6), SMALL);
        } else if (ph < 10.5) {
          // the field: chips, scores, status, the gridiron with the ball
          logo(ctx, 'MOO', 8, 6, 5); logo(ctx, 'PUM', 120, 6, 5);
          text(ctx, '17', 14, 22, C.white, '800 15px Nunito'); text(ctx, '14', 96, 22, C.white, '800 15px Nunito');
          ctext(ctx, 'Q3 4:12', 64, 9, C.white, SMALL); ctext(ctx, '3RD+7', 64, 19, mul(C.cream, .75), SMALL);
          rect(ctx, 4, 26, 120, 5, [24, 90, 40]); rect(ctx, 4, 26, 8, 5, mul(A.c, .9)); rect(ctx, 116, 26, 8, 5, mul(B.c, .9));
          for (var yd = 1; yd < 10; yd++) rect(ctx, 12 + yd * 10.4, 26, 1, 5, [60, 140, 70]);
          var bx = 70 + Math.sin(t * 2) * 1.5; rect(ctx, bx, 28, 2, 1, [200, 110, 50]); rect(ctx, 80, 26, 1, 5, [255, 220, 60]);
        } else {
          // celebration: cut to team color, gold flashes, logo punch, TOUCHDOWN letter by letter, confetti, score ticks up
          var k = ph - 10.5;
          rect(ctx, 0, 0, W, H, mul(A.c, .75));
          if (!REDUCED && k < 1.2 && Math.floor(k * 5) % 2 === 0) rect(ctx, 0, 0, W, H, [255, 200, 60], .55);
          var sz = [6, 8, 10, 13, 12][Math.min(4, Math.floor(k * 6))];
          logo(ctx, 'MOO', 15, 16, sz);
          var word = 'TOUCHDOWN', n = Math.min(word.length, Math.floor((k - .5) * 9));
          if (n > 0) text(ctx, word.slice(0, n), 32, 17, [255, 200, 60], '900 13px Nunito');
          if (k > 1.6) text(ctx, A.name + ' ' + mooScore, 32, 29, C.white, SMALL);
          if (!REDUCED && Math.random() < .6) conf.push([30 + Math.random() * 98, -1, .6 + Math.random(), [[255, 200, 60], [255, 255, 255], A.c2, [255, 150, 185]][Math.floor(Math.random() * 4)]]);
          var stp = Math.min(dt || .016, .05);
          conf = conf.filter(function (q) { q[1] += q[2] * stp * 18; px(ctx, q[0], q[1], q[3]); return q[1] < H; });
        }
      }
    };
  };


  function diya(ctx, x, t, seed) {
    var f = .6 + .4 * Math.sin(t * 13 + seed) * Math.sin(t * 7.3 + seed * 2) + Math.random() * .15;
    var fh = 5 + f * 3, sway = Math.sin(t * 5 + seed) * .7;
    disc(ctx, x, 21 - fh / 2, 6 + f * 1.5, [255, 140, 30], .13);
    ctx.fillStyle = rgb([255, 120, 20]);
    ctx.beginPath(); ctx.moveTo(x - 2.4, 22); ctx.quadraticCurveTo(x + sway, 22 - fh * 1.6, x + 2.4, 22); ctx.fill();
    ctx.fillStyle = rgb([255, 214, 90]);
    ctx.beginPath(); ctx.moveTo(x - 1.3, 22); ctx.quadraticCurveTo(x + sway * .7, 22 - fh * 1.05, x + 1.3, 22); ctx.fill();
    px(ctx, x, 21, [255, 250, 220]);
    ctx.fillStyle = rgb([200, 90, 40]);
    ctx.beginPath(); ctx.moveTo(x - 7, 23); ctx.quadraticCurveTo(x, 31, x + 7, 23); ctx.closePath(); ctx.fill();
    rect(ctx, x - 7, 23, 14, 1, [240, 150, 60]);
  }
  S.prayer = function () {
    var sparks = [];
    return {
      label: 'Prayer', dur: 8,
      draw: function (ctx, t, st) {
        rect(ctx, 0, 0, W, H, [40, 10, 4]);
        diya(ctx, 15, t, 1); diya(ctx, 113, t, 4);
        if (Math.random() < .25) sparks.push([Math.random() < .5 ? 15 : 113, 14, Math.random() - .5, 0]);
        sparks = sparks.filter(function (s) { s[1] -= .35; s[0] += s[2] * .3; s[3] += .03; px(ctx, s[0], s[1], [255, 190, 80], 1 - s[3]); return s[3] < 1; });
        var pulse = .82 + .18 * Math.sin(t * 2.2);
        if (st < 4) {
          var fo = DEV.replace(/^/, '600 30px ');
          var r = ctext(ctx, 'ॐ', 64, 27, function (X, Y) { return mul(mix(C.marigold, C.pink, clamp((Y - 4) / 24, 0, 1)), pulse); }, fo, .45);
          void r;
        } else {
          var line = 'जय जगदीश हरे', font = '600 15px ' + DEV, x0 = cx(line, font, 64), xe = x0 + measure(line, font).w;
          var prog = (st - 4) / 2.6;
          text(ctx, line, x0, 22, function (X) { return X < x0 + (xe - x0) * prog ? sweep(X, x0, xe) : mul(C.cream, .25); }, font, .42);
        }
      }
    };
  };

  S.weather = function (board) {
    var n = 0, drops = [], flakes = [], r = rnd(11);
    for (var i = 0; i < 44; i++) drops.push([r() * W, r() * H, 18 + r() * 12]);
    for (i = 0; i < 60; i++) flakes.push([r() * W, r() * H, 3 + r() * 4, r() * 6]);
    var sc = {
      label: 'Weather', dur: 7, variant: board && board.opts.weather,
      enter: function () { n++; },
      draw: function (ctx, t, st, dt) {
        var kind = sc.variant || (n % 2 === 0 ? 'snow' : 'rain'), snow = kind === 'snow';
        if (kind === 'clear') {
          var d = new Date(); drawSky(ctx, t, d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600, .8, W, 74);
          rect(ctx, 76, 9, 52, 23, [0, 0, 0], .6);
          ctext(ctx, sc.temp || '72°', 101, 25, C.warm, '900 19px Nunito');
          ctext(ctx, sc.city || 'CLEAR', 101, 31, mul(C.sky, 1));
          return;
        }
        for (var y = 0; y < H; y++) rect(ctx, 0, y, W, 1, snow ? mix([30, 40, 62], [14, 18, 30], y / H) : mix([22, 32, 48], [8, 12, 22], y / H));
        var bolt = (kind === 'storm' || (kind === 'rain' && !sc.city)) && (st % 4.3) > 3.9 && (st % 4.3) < 4.02;
        if (bolt) rect(ctx, 0, 0, W, H, [200, 210, 255], .5);
        // clouds
        for (var k = 0; k < 4; k++) {
          var x = ((t * (1.6 + k * .5) + k * 40) % 150) - 20, yy = 4 + (k % 2) * 3;
          ctx.fillStyle = rgb(snow ? [190, 200, 215] : [130, 140, 158], .75);
          ctx.beginPath(); ctx.ellipse(x, yy, 12, 3.4, 0, 0, 6.3); ctx.ellipse(x + 6, yy - 2, 6, 3.2, 0, 0, 6.3); ctx.ellipse(x - 6, yy - 1, 5, 2.6, 0, 0, 6.3); ctx.fill();
        }
        var step = Math.min(dt, .05);
        if (snow) {
          flakes.forEach(function (f) {
            f[1] += f[2] * step; f[0] += Math.sin(t * 1.5 + f[3]) * .12;
            if (f[1] > H) { f[1] = 4; f[0] = Math.random() * W; }
            px(ctx, f[0], f[1], [240, 246, 255], .9);
          });
        } else if (kind !== 'cloud') {
          drops.forEach(function (d) {
            d[1] += d[2] * step * 2; d[0] -= d[2] * step * .6;
            if (d[1] > H) { d[1] = 5; d[0] = Math.random() * (W + 20); }
            px(ctx, d[0], d[1], [120, 190, 255]); px(ctx, d[0] + 1, d[1] - 1, [120, 190, 255], .55); px(ctx, d[0] + 2, d[1] - 2, [120, 190, 255], .25);
          });
        }
        rect(ctx, 76, 9, 52, 23, [0, 0, 0], .72);
        ctext(ctx, sc.temp || (snow ? '28°' : '54°'), 101, 25, C.warm, '900 19px Nunito');
        ctext(ctx, sc.city || (snow ? 'SNOW' : 'RAIN'), 101, 32 - 1, snow ? mul(C.sky, 1) : [120, 190, 255]);
      }
    };
    return sc;
  };

  /* ---------- live weather: Open-Meteo, no key, location guessed from the time zone (no prompt) ---------- */
  var TZ_CITY = {
    'America/New_York': [40.71, -74.01, 'NYC'], 'America/Detroit': [42.33, -83.05, 'DETROIT'], 'America/Toronto': [43.65, -79.38, 'TORONTO'],
    'America/Chicago': [41.88, -87.63, 'CHICAGO'], 'America/Denver': [39.74, -104.99, 'DENVER'], 'America/Phoenix': [33.45, -112.07, 'PHOENIX'],
    'America/Los_Angeles': [34.05, -118.24, 'L.A.'], 'America/Vancouver': [49.28, -123.12, 'VANCOUVR'], 'America/Anchorage': [61.22, -149.9, 'ANCHORGE'],
    'Pacific/Honolulu': [21.31, -157.86, 'HONOLULU'], 'America/Mexico_City': [19.43, -99.13, 'MEXICO'], 'America/Sao_Paulo': [-23.55, -46.63, 'SAO PAULO'],
    'America/Bogota': [4.71, -74.07, 'BOGOTA'], 'America/Argentina/Buenos_Aires': [-34.6, -58.38, 'B. AIRES'], 'Europe/London': [51.51, -0.13, 'LONDON'],
    'Europe/Dublin': [53.35, -6.26, 'DUBLIN'], 'Europe/Paris': [48.86, 2.35, 'PARIS'], 'Europe/Berlin': [52.52, 13.4, 'BERLIN'], 'Europe/Madrid': [40.42, -3.7, 'MADRID'],
    'Europe/Rome': [41.9, 12.5, 'ROME'], 'Europe/Amsterdam': [52.37, 4.9, 'AMSTRDAM'], 'Europe/Stockholm': [59.33, 18.07, 'STOCKHLM'], 'Europe/Zurich': [47.38, 8.54, 'ZURICH'],
    'Europe/Istanbul': [41.01, 28.98, 'ISTANBUL'], 'Europe/Moscow': [55.76, 37.62, 'MOSCOW'], 'Africa/Cairo': [30.04, 31.24, 'CAIRO'], 'Africa/Lagos': [6.52, 3.38, 'LAGOS'],
    'Africa/Nairobi': [-1.29, 36.82, 'NAIROBI'], 'Africa/Johannesburg': [-26.2, 28.05, 'JOBURG'], 'Asia/Dubai': [25.2, 55.27, 'DUBAI'],
    'Asia/Kolkata': [28.61, 77.21, 'DELHI'], 'Asia/Calcutta': [28.61, 77.21, 'DELHI'], 'Asia/Karachi': [24.86, 67.0, 'KARACHI'], 'Asia/Dhaka': [23.81, 90.41, 'DHAKA'],
    'Asia/Bangkok': [13.76, 100.5, 'BANGKOK'], 'Asia/Jakarta': [-6.2, 106.85, 'JAKARTA'], 'Asia/Singapore': [1.35, 103.82, 'SINGAPRE'], 'Asia/Manila': [14.6, 120.98, 'MANILA'],
    'Asia/Hong_Kong': [22.32, 114.17, 'HONGKONG'], 'Asia/Shanghai': [31.23, 121.47, 'SHANGHAI'], 'Asia/Seoul': [37.57, 126.98, 'SEOUL'], 'Asia/Tokyo': [35.68, 139.69, 'TOKYO'],
    'Australia/Sydney': [-33.87, 151.21, 'SYDNEY'], 'Australia/Melbourne': [-37.81, 144.96, 'MELBRNE'], 'Australia/Perth': [-31.95, 115.86, 'PERTH'],
    'Pacific/Auckland': [-36.85, 174.76, 'AUCKLAND'], 'America/Indianapolis': [39.77, -86.16, 'INDY'], 'America/Indiana/Indianapolis': [39.77, -86.16, 'INDY'],
    'America/Kentucky/Louisville': [38.25, -85.76, 'LOUISVLE'], 'America/Halifax': [44.65, -63.58, 'HALIFAX'], 'America/Edmonton': [53.55, -113.49, 'EDMONTON'],
    'America/Winnipeg': [49.9, -97.14, 'WINNIPEG'], 'America/Boise': [43.62, -116.2, 'BOISE'], 'America/Santiago': [-33.45, -70.67, 'SANTIAGO'],
    'America/Lima': [-12.05, -77.04, 'LIMA'], 'Europe/Lisbon': [38.72, -9.14, 'LISBON'], 'Europe/Warsaw': [52.23, 21.01, 'WARSAW'], 'Europe/Athens': [37.98, 23.73, 'ATHENS'],
    'Europe/Helsinki': [60.17, 24.94, 'HELSINKI'], 'Europe/Oslo': [59.91, 10.75, 'OSLO'], 'Europe/Copenhagen': [55.68, 12.57, 'CPH'], 'Europe/Brussels': [50.85, 4.35, 'BRUSSELS'],
    'Europe/Vienna': [48.21, 16.37, 'VIENNA'], 'Europe/Prague': [50.08, 14.44, 'PRAGUE'], 'Asia/Taipei': [25.03, 121.57, 'TAIPEI'], 'Asia/Kathmandu': [27.72, 85.32, 'KATHMNDU'],
    'Asia/Riyadh': [24.71, 46.68, 'RIYADH'], 'Asia/Tehran': [35.69, 51.39, 'TEHRAN'], 'Australia/Brisbane': [-27.47, 153.03, 'BRISBANE']
  };
  var TZ = ''; try { TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* none */ }
  var SOUTH = /^(Australia|Pacific\/Auckland|America\/(Sao_Paulo|Argentina|Santiago)|Africa\/Johannesburg)/.test(TZ);
  var FAHR = /^(en-US|en-LR|my)/.test(navigator.language || '') || /^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit)|^Pacific\/Honolulu/.test(TZ);
  var WX = null, wxAsked = false;
  function wxKind(code) {
    if (code >= 95) return 'storm'; if (code >= 71 && code <= 77 || code === 85 || code === 86) return 'snow';
    if (code >= 51) return 'rain'; if (code >= 2) return 'cloud'; return 'clear';
  }
  function askWeather() {
    if (wxAsked) return; wxAsked = true;
    var c = TZ_CITY[TZ]; if (!c || !window.fetch) return;
    fetch('https://api.open-meteo.com/v1/forecast?latitude=' + c[0] + '&longitude=' + c[1] + '&current=temperature_2m,weather_code,is_day&daily=sunrise,sunset&timezone=auto&forecast_days=1' + (FAHR ? '&temperature_unit=fahrenheit' : ''))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && j.current) WX = { temp: Math.round(j.current.temperature_2m), kind: wxKind(j.current.weather_code), city: c[2] };
        // today's real sunrise and sunset (local clock times) drive the arc and the sky colors
        var d = j && j.daily, hr = function (iso) { var m = /T(\d+):(\d+)/.exec(iso || ''); return m ? +m[1] + +m[2] / 60 : null; };
        var r = d && hr(d.sunrise && d.sunrise[0]), st = d && hr(d.sunset && d.sunset[0]);
        if (r != null && st != null && st > r) { SUN[0] = r; SUN[1] = st; }
      })
      .catch(function () { /* stand-in sky stays */ });
  }
  S.wx = function (board) {
    var inner = S.weather(board);
    return {
      label: 'Weather', dur: 8,
      draw: function (ctx, t, st, dt) {
        askWeather();
        if (!WX) { inner.variant = 'rain'; inner.city = null; return inner.draw(ctx, t, st, dt); }
        inner.variant = WX.kind; inner.city = WX.city; inner.temp = WX.temp + '°';
        inner.draw(ctx, t, st, dt);
      }
    };
  };

  /* ---------- seasons: today's date picks the art ---------- */
  function seasonNow(d) {
    var m = d.getMonth(), day = d.getDate(), md = m * 100 + day;
    if (m === 9 && day >= 24) return 'halloween';
    if ((m === 11 && day >= 18) || (m === 0 && day <= 1)) return 'holiday';
    if (m === 1 && day >= 12 && day <= 14) return 'hearts';
    var s = md >= 220 && md < 521 ? 'spring' : md >= 521 && md < 822 ? 'summer' : md >= 822 && md < 1121 ? 'autumn' : 'winter';
    if (SOUTH) s = { spring: 'autumn', summer: 'winter', autumn: 'spring', winter: 'summer' }[s];
    return s;
  }
  S.seasons = function () {
    var parts = [], r = rnd(21);
    return {
      label: 'Seasons', dur: 8,
      draw: function (ctx, t, st, dt) {
        var d = new Date(), k = seasonNow(d), step = Math.min(dt || .016, .05), i;
        var P = {
          spring: { sky: [[40, 90, 150], [120, 190, 230]], ground: [60, 150, 70], cols: [[255, 170, 200], [255, 255, 255], [255, 210, 90]], fall: .25, word: 'SPRING' },
          summer: { sky: [[30, 110, 210], [140, 210, 250]], ground: [230, 200, 120], cols: [[255, 255, 255]], fall: 0, word: 'SUMMER' },
          autumn: { sky: [[60, 40, 70], [240, 150, 90]], ground: [110, 60, 30], cols: [[255, 120, 30], [230, 60, 40], [255, 190, 60]], fall: .5, word: 'AUTUMN' },
          winter: { sky: [[14, 24, 60], [60, 90, 150]], ground: [230, 240, 255], cols: [[255, 255, 255]], fall: .6, word: 'WINTER' },
          halloween: { sky: [[20, 10, 40], [70, 30, 80]], ground: [40, 30, 50], cols: [[255, 140, 0]], fall: 0, word: 'BOO' },
          holiday: { sky: [[10, 20, 50], [40, 60, 110]], ground: [235, 245, 255], cols: [[255, 255, 255]], fall: .6, word: 'HOLIDAYS' },
          hearts: { sky: [[80, 10, 40], [200, 60, 110]], ground: [120, 20, 60], cols: [[255, 90, 140], [255, 180, 200]], fall: .4, word: 'LOVE' }
        }[k];
        for (var y = 0; y < H; y++) rect(ctx, 0, y, W, 1, mul(mix(P.sky[0], P.sky[1], y / H), .75));
        if (k === 'summer') { disc(ctx, 20, 10, 7, [255, 200, 60], .25); disc(ctx, 20, 10, 4.5, [255, 220, 90]); for (i = 0; i < 128; i++) rect(ctx, i, 27 + Math.round(Math.sin(i * .25 + t * 3)), 1, 6, [40, 140, 210]); }
        else if (k === 'halloween') { disc(ctx, 22, 20, 7, [255, 130, 0]); rect(ctx, 21, 11, 2, 3, [60, 140, 40]); px(ctx, 19, 18, [0, 0, 0]); px(ctx, 25, 18, [0, 0, 0]); rect(ctx, 19, 22, 7, 1, [0, 0, 0]); disc(ctx, 108, 8, 4, [240, 240, 220]); }
        else if (k === 'holiday') { for (i = 0; i < 9; i++) rect(ctx, 20 - i, 6 + i * 2, 1 + i * 2, 2, [40, 150, 70]); rect(ctx, 19, 24, 3, 4, [120, 70, 30]); px(ctx, 20, 5, [255, 220, 60]); for (i = 0; i < 6; i++) px(ctx, 14 + (i * 7) % 13, 10 + i * 2, [[255, 60, 60], [255, 220, 60], [80, 180, 255]][i % 3], .6 + .4 * Math.sin(t * 5 + i)); }
        else { var tr = k === 'autumn' ? [230, 110, 30] : k === 'spring' ? [255, 170, 210] : k === 'winter' ? [220, 235, 255] : [255, 90, 140]; rect(ctx, 19, 16, 3, 12, [90, 55, 30]); disc(ctx, 20, 12, 8, tr, .9); disc(ctx, 15, 15, 5, tr, .9); disc(ctx, 25, 15, 5, tr, .9); }
        rect(ctx, 0, 28, W, 4, P.ground);
        if (P.fall && Math.random() < P.fall) parts.push([r() * W, -1, .5 + r(), r() * 6, P.cols[Math.floor(r() * P.cols.length)]]);
        parts = parts.filter(function (q) { q[1] += q[2] * step * 12; q[0] += Math.sin(t * 2 + q[3]) * .15; px(ctx, q[0], q[1], q[4]); return q[1] < 28; });
        rect(ctx, 44, 5, 80, 20, [0, 0, 0], .55);
        ctext(ctx, P.word, 84, 15, C.warm, '900 13px Nunito');
        ctext(ctx, MONS[d.getMonth()] + ' ' + d.getDate(), 84, 23, mul(C.cream, .6));
      }
    };
  };

  S.soon = function () {
    return {
      label: 'More', dur: 8,
      draw: function (ctx, t) {
        for (var i = 0; i < 3; i++) { var on = Math.floor(t * 3) % 3 === i; disc(ctx, 52 + i * 12, 12, 3, on ? C.sky : mul(C.sky, .25)); }
        ctext(ctx, 'MORE SOON', 64, 28, C.warm);
      }
    };
  };

  S.tv = function () {
    return {
      label: 'TV', dur: 7,
      draw: function (ctx, t, st) {
        rect(ctx, 3, 7, 26, 17, [90, 90, 100]);
        for (var y = 0; y < 13; y++) for (var x = 0; x < 22; x++) {
          var v = .5 + .5 * Math.sin(x * .4 + t * 3) * Math.cos(y * .5 - t * 2);
          px(ctx, 5 + x, 9 + y, mix([20, 60, 140], [255, 120, 60], v), .9);
        }
        rect(ctx, 12, 25, 8, 1, [90, 90, 100]); rect(ctx, 9, 26, 14, 1, [90, 90, 100]);
        text(ctx, 'NOW WATCHING', 34, 8, mul(C.sky, .85));
        text(ctx, 'Night Train', 34, 20, C.cream, '900 13px Nunito');
        text(ctx, 'S2 E5', 34, 30, mul(C.cream, .45));
        var p = .41 + st / 7 * .05;
        rect(ctx, 64, 27, 60, 1, [60, 56, 66]); rect(ctx, 64, 27, 60 * p, 1, [255, 120, 60]);
      }
    };
  };

  var lightsImg = null, fallY = new Float32Array(H);
  for (var fy = 0; fy < H; fy++) fallY[fy] = .45 + .55 * Math.sin((fy / H) * Math.PI);
  S.lights = function () {
    return {
      label: 'Lights', dur: 7,
      draw: function (ctx, t) {
        // the whole rainbow field as one ImageData (4096 fillRect calls a frame before)
        var img = lightsImg || (lightsImg = ctx.createImageData(W, H)), d = img.data;
        for (var x = 0; x < W; x++) {
          var c = hsl(x * 2.2 - t * 70, .95, .55);
          var v = .55 + .45 * Math.sin(x * .12 - t * 3);
          for (var y = 0; y < H; y++) { var k = v * fallY[y], i = (y * W + x) * 4; d[i] = (c[0] * k) | 0; d[i + 1] = (c[1] * k) | 0; d[i + 2] = (c[2] * k) | 0; d[i + 3] = 255; }
        }
        ctx.putImageData(img, 0, 0);
        rect(ctx, 34, 9, 60, 15, [0, 0, 0], .88);
        ctext(ctx, 'IN SYNC', 64, 20, C.white);
      }
    };
  };

  S.faces = function () {
    return {
      label: 'Clock faces', dur: 9,
      draw: function (ctx, t, st) {
        var d = new Date(), c = clockParts(d), f = Math.floor(st / 3) % 3, str = c.h + ':' + c.m;
        if (f === 0) {
          ctext(ctx, str, 64, 27, function (X, Y) { return mix(C.sky, [210, 255, 244], Y / 32); }, '600 30px Fredoka');
        } else if (f === 1) {
          ctext(ctx, str, 64, 25, [255, 30, 20, .7], '800 26px Nunito');
        } else {
          var ox = 20, oy = 16;
          for (var a = 0; a < 12; a++) { var an = a / 12 * 6.283; px(ctx, ox + Math.sin(an) * 13, oy - Math.cos(an) * 13, a % 3 ? mul(C.cream, .5) : C.marigold); }
          var hr = (d.getHours() % 12 + d.getMinutes() / 60) / 12 * 6.283, mn = (d.getMinutes() + d.getSeconds() / 60) / 60 * 6.283, sc2 = (d.getSeconds() + d.getMilliseconds() / 1000) / 60 * 6.283;
          ctx.lineWidth = 1.4; ctx.lineCap = 'round';
          ctx.strokeStyle = rgb(C.warm); ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + Math.sin(hr) * 7, oy - Math.cos(hr) * 7); ctx.stroke();
          ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + Math.sin(mn) * 11, oy - Math.cos(mn) * 11); ctx.stroke();
          ctx.strokeStyle = rgb(C.pink); ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + Math.sin(sc2) * 11, oy - Math.cos(sc2) * 11); ctx.stroke();
          text(ctx, str, 44, 20, C.warm, '800 18px Nunito');
          text(ctx, DAYS[d.getDay()], 46, 30, mul(C.sky, .9));
        }
      }
    };
  };

  // the MooBoard mark is itself a 20 x 16 grid of LED dots, so it maps straight onto the panel
  var MARK = [
    '..........ccc........ccc..........',
    '..........ccc........ccc..........',
    '..........ccc........ccc..........',
    '..........ccsssssssssscc..........',
    '........ssssssssssssssssss........',
    '.......ssssssssssssssssssss.......',
    '......ssssssssssssssssssssss......',
    '...sssssss..............sssssss...',
    '.ssssssss................ssssssss.',
    'sspppsss...www......www...ssspppss',
    '.sspssss..wwwww....wwwww..sssspss.',
    '..ssssss..wwoww....wwoww..ssssss..',
    '....ssss..wwwww....wwwww..ssss....',
    '....ssss...www......www...ssss....',
    '....ssss..................ssss....',
    '....ssss..................ssss....',
    '....ssss.....pppppppp.....ssss....',
    '.....sss....pp.pppp.pp....sss.....',
    '.....sss.....pppppppp.....sss.....',
    '.....ssss....pppppppp....ssss.....',
    '.....sssss..............sssss.....',
    '......ssssssssssssssssssssss......',
    '.......ssssssssssssssssssss.......',
    '........ssssssssssssssssss........',
    '............ssssssssss............'
  ];
  var MARKC = { c: C.cream, p: [255, 170, 195], w: C.white };
  // the brand cow on the LED grid, taken from the firmware startup card: 34 x 25 LEDs.
  // pupil: optional color for the two pupil LEDs (celebrations flash them; the whites stay white)
  function drawMark(ctx, x0, y0, k, t, frame, pupil) {
    var blink = (t % 3.7) < .14;
    for (var r = 0; r < MARK.length; r++) for (var c = 0; c < MARK[r].length; c++) {
      var ch = MARK[r][c];
      if (ch === '.') continue;
      if (blink && (ch === 'w' || ch === 'o') && r !== 11) continue;
      var col = ch === 's' ? frame : ch === 'o' ? (blink ? C.white : pupil || [0, 0, 0]) : MARKC[ch];
      if (ch === 'o' && !pupil && !blink) continue; // a black pupil is just an unlit LED
      rect(ctx, x0 + c * k, y0 + r * k, k, k, col);
    }
  }

  S.moo = function () {
    return {
      label: 'Moo', dur: 4.5,
      draw: function (ctx, t, st) {
        // the cow and MOO as one centered group, 2 LEDs clear of every edge
        var font = '700 24px Fredoka', gap = 5, cw = MARK[0].length, word = 'MOO';
        var ww = measure(word, font), inkW = Math.ceil(ww.r - ww.l) + 4, x0 = Math.round((W - (cw + gap + inkW)) / 2);
        var pupil = st < 2.6 && !REDUCED ? hsl(Math.floor(t * 10) * 47, 1, .55) : null;
        drawMark(ctx, x0, 3, 1, t, C.sky, pupil);
        var x = x0 + cw + gap;
        word.split('').forEach(function (L, i) {
          var tt = clamp((st - .15 - i * .22) / .35, 0, 1), jump = REDUCED ? 0 : Math.round(Math.sin(tt * Math.PI) * -4);
          if (tt > 0) {
            var bb = text(ctx, L, x, 25 + jump, function (X, Y) { return mix([255, 255, 255], C.sky, Y / 30); }, font);
            x = bb.x1 + 3;
          } else x += Math.round(measure(L, font).w);
        });
      }
    };
  };


  /* ---------- the board ---------- */
  var boards = [], maskCache = {};

  function masks(s) {
    if (maskCache[s]) return maskCache[s];
    var bw = W * s, bh = H * s, m = mk(bw, bh), u = mk(bw, bh), cell = mk(s, s), cc = cell.getContext('2d');
    var r = s * .46, g = cc.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, r);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.62, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    cc.fillStyle = g; cc.fillRect(0, 0, s, s);
    var mx = m.getContext('2d'); mx.fillStyle = mx.createPattern(cell, 'repeat'); mx.fillRect(0, 0, bw, bh);
    var cu = mk(s, s), cux = cu.getContext('2d');
    cux.fillStyle = '#1B1920'; cux.beginPath(); cux.arc(s / 2, s / 2, s * .36, 0, 6.3); cux.fill();
    var ux = u.getContext('2d'); ux.fillStyle = ux.createPattern(cu, 'repeat'); ux.fillRect(0, 0, bw, bh);
    return (maskCache[s] = { m: m, u: u });
  }

  var noise = new Float32Array(N);
  (function () { var r = rnd(3); for (var i = 0; i < N; i++) noise[i] = r() * .75 + ((i % W) / W) * .25; })();

  function Board(el, opts) {
    this.el = el; this.opts = opts = opts || {};
    el.classList.add('led');
    this.glowCv = mk(W, H); this.glowCv.className = 'led-glow';
    this.dots = mk(W * 4, H * 4); this.dots.className = 'led-dots';
    this.fx = this.glowCv.getContext('2d', { willReadFrequently: true });
    this.bx = this.dots.getContext('2d');
    this.A = mk(W, H); this.B = mk(W, H);
    this.ax = this.A.getContext('2d', { willReadFrequently: true }); this.bbx = this.B.getContext('2d', { willReadFrequently: true });
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
    var s = clamp(Math.max(Math.round(w * dpr / W), this.opts.minScale || 0), 3, 14);
    this.el.style.setProperty('--cell', (w / W).toFixed(2) + 'px');
    if (s === this.s) return;
    this.s = s; this.dots.width = W * s; this.dots.height = H * s; this.mk = masks(s);
  };
  Board.prototype.go = function (name, now) {
    if (!this.scenes[name] || name === this.cur || this.next) return;
    this.next = name; this.tStart = now == null ? (performance.now() - t0) / 1000 : now;
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
  Board.prototype.step = function () {
    var i = this.names.indexOf(this.cur);
    this.go(this.names[(i + 1) % this.names.length]);
  };
  Board.prototype.moo = function () {
    if (this.cur === 'moo' && !this.next) { this.start = (performance.now() - t0) / 1000; return; }
    if (this.next === 'moo') return;
    this.back = this.next || this.cur;
    if (this.next) { this.cur = this.next; this.start = this.tStart; this.next = null; }
    this.go('moo');
  };
  Board.prototype.render = function (t, dt) {
    var sc = this.scenes[this.cur], st = this.opts.at != null ? this.opts.at : Math.max(0, t - this.start);
    this.last = t;
    if (!this.start) { this.start = t; st = 0; }
    var TR = REDUCED ? 0.01 : 0.7;
    var mooBack = this.cur === 'moo' && this.back;
    if (!this.next && ((this.auto && !this.held && this.names.length > 1) || mooBack) && st > sc.dur * (REDUCED ? 1.6 : 1)) {
      var nm = mooBack ? this.back : this.names[(this.names.indexOf(this.cur) + 1) % this.names.length];
      this.back = null;
      if (nm !== this.cur) this.go(nm, t);
    }
    var a = this.ax;
    a.globalAlpha = 1; a.fillStyle = '#000'; a.fillRect(0, 0, W, H);
    sc.draw(a, t, st, dt);
    var out;
    if (this.next) {
      var p = Math.max(0, (t - this.tStart) / TR), b = this.bbx;
      b.fillStyle = '#000'; b.fillRect(0, 0, W, H);
      this.scenes[this.next].draw(b, t, Math.max(0, t - this.tStart), dt);
      if (p >= 1) {
        this.cur = this.next; this.next = null; this.start = this.tStart;
        this.fx.drawImage(this.B, 0, 0);
      } else {
        var da = a.getImageData(0, 0, W, H), db = b.getImageData(0, 0, W, H), d = da.data, e = db.data;
        for (var q = 0, i = 0; q < N; q++, i += 4) {
          var n = noise[q];
          if (n < p - .08) { d[i] = e[i]; d[i + 1] = e[i + 1]; d[i + 2] = e[i + 2]; }
          else if (n < p) { d[i] = 255; d[i + 1] = 240; d[i + 2] = 220; }
        }
        this.fx.putImageData(da, 0, 0);
      }
    } else this.fx.drawImage(this.A, 0, 0);
    out = this.bx;
    var bw = this.dots.width, bh = this.dots.height;
    out.globalCompositeOperation = 'copy'; out.imageSmoothingEnabled = false;
    out.drawImage(this.glowCv, 0, 0, bw, bh);
    out.globalCompositeOperation = 'destination-in'; out.drawImage(this.mk.m, 0, 0);
    out.globalCompositeOperation = 'destination-over'; out.drawImage(this.mk.u, 0, 0);
    out.globalCompositeOperation = 'source-over';
    if (this.opts.onGlow && (this.frame++ % 10 === 0)) {
      var g = this.fx.getImageData(0, 0, W, H).data, r = 0, gg = 0, bl = 0, c = 0;
      for (var j = 0; j < g.length; j += 16) { var s2 = g[j] + g[j + 1] + g[j + 2]; if (s2 > 60) { r += g[j]; gg += g[j + 1]; bl += g[j + 2]; c++; } }
      if (c) { var target = [r / c, gg / c, bl / c]; this.glow = mix(this.glow, target, .35); this.opts.onGlow(this.glow); }
    }
  };

  var t0 = performance.now(), lastT = 0, acc = 0;
  function loop(now) {
    var t = (now - t0) / 1000, dt = t - lastT; lastT = t;
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

  window.MooBoard = {
    Board: Board, scenes: S, boards: boards, syllables: function (w) { return syllables(w); },
    now: function () { return (performance.now() - t0) / 1000; },
    labels: function (names) { return names.map(function (n) { return S[n] ? S[n]().label : n; }); }
  };
})();
