/* mooboard.co/start + a new board's first steps as swipe cards + ?m= names the model and ?u= the board's code as the
   sticker link hands them on + ?frame= its frame as the buttons tour takes it + a swipe or the dots or back and next
   or the arrow keys move between the cards + js/mount.mjs and three.js load only when the mounting card is reached */
(function () {
  'use strict';
  var MODELS = ['MB1W', 'MB1D', 'MB1P'];
  var ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // the label's + no 0 or O + no 1 I or L
  var SITE_FRAMES = { midnight: 'black', moonlight: 'white', sunset: 'orange', mint: 'teal', red: 'red' };

  function param(search, name) {
    var m = new RegExp('(?:^\\?|&)' + name + '=([^&#]*)').exec(search || '');
    return m ? m[1] : null;
  }
  // the model + exactly MB1W MB1D or MB1P in any case + anything else or nothing is the wall board
  function modelOf(search) {
    var v = (param(search, 'm') || '').toUpperCase();
    return MODELS.indexOf(v) >= 0 ? v : 'MB1W';
  }
  // the board's code + four of the label's letters in any case + else none
  function codeOf(search) {
    var v = (param(search, 'u') || '').toUpperCase();
    if (v.length !== 4) return null;
    for (var i = 0; i < 4; i++) if (ALPHABET.indexOf(v.charAt(i)) < 0) return null;
    return v;
  }
  // the frame as boards name it + none when it is not one of theirs
  function frameOf(search) {
    var v = param(search, 'frame');
    return v !== null && Object.prototype.hasOwnProperty.call(SITE_FRAMES, v) ? v : null;
  }
  // mooboard.co/hi for this board + its own link opens it once it is on the same wi-fi + else the boards near you
  function hiOf(code) {
    return code ? '/hi/' + code : '/hi/';
  }
  // mooboard.co/portal for this board once it is set up + its own link opens it + else the boards near you
  function portalOf(code) {
    return code ? '/portal/' + code : '/portal/';
  }
  // the rail and hooks as the buyer picked them + black unless the link says white
  function railOf(search) {
    return param(search, 'rail') === 'white' ? 'white' : 'black';
  }
  // the ways to put it up a model has + the desk stand only for the desk board
  function waysOf(model) {
    return model === 'MB1D' ? ['strips', 'screws', 'stand'] : ['strips', 'screws'];
  }
  var api = window.mooStart = { modelOf: modelOf, codeOf: codeOf, frameOf: frameOf, railOf: railOf, hiOf: hiOf, portalOf: portalOf, waysOf: waysOf };

  var root = document.documentElement;
  var track = document.getElementById('track');
  if (!track || !root.classList.contains('js')) return;
  var $ = function (id) { return document.getElementById(id); };
  var all = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };
  var REDUCED = false;
  try { REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* no media queries + motion stays on */ }
  var search = location.search;
  var model = modelOf(search), code = codeOf(search), frame = frameOf(search);
  var finish = frame ? SITE_FRAMES[frame] : 'black';
  var hi = hiOf(code);

  // ---- what the link says about the board ----
  all('[data-hi]').forEach(function (a) { a.setAttribute('href', hi); });
  all('[data-portal]').forEach(function (a) { a.setAttribute('href', portalOf(code)); });
  all('.bezel').forEach(function (b) { b.setAttribute('data-frame', finish); });
  root.setAttribute('data-frame', finish);
  if (frame) $('watch').setAttribute('href', '/hi/buttons/?frame=' + frame);
  var ways = waysOf(model);
  all('.chip').forEach(function (c) { c.hidden = ways.indexOf(c.getAttribute('data-way')) < 0; });

  // ---- the hello + the hero's board says hello in its own font + each letter hops on and a shine runs across ----
  function helloScene(MB) {
    var W = 128, H = 32, HOP = 3, TEAL = [119, 237, 215], WHITE = [255, 255, 255], LOOP = 6.5;
    var mix = function (a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; };
    // the biggest hello that fits by its ink with a dark led at every edge and room above it to hop
    function layout() {
      for (var cap = 24; cap >= 8; cap -= 0.25) {
        var L = MB.text.line('label', cap, 'hello');
        if (!L.empty && L.inkW <= W - 8 && L.inkH <= H - 2 - HOP) return L;
      }
      return null;
    }
    return function () {
      return {
        label: 'Hello', dur: LOOP,
        draw: function (f, t, st) {
          f.fill([0, 0, 0]);
          var L = layout();
          if (!L) return;
          var pen = Math.floor(63.5 - (L.l + L.r) / 2);
          var top = 1 + HOP + Math.floor((H - 2 - HOP - L.inkH) / 2);
          var base = top - L.t;
          var k = st % LOOP, fade = k > 5.9 ? 1 - (k - 5.9) / 0.6 : 1;
          var shine = (k - 2.6) / 1.3 * 190 - 32;
          L.spans.forEach(function (s, i) {
            var g = s.g;
            if (!g.w) return;
            var p = Math.min(1, (k - 0.3 - i * 0.14) / 0.45);
            if (p <= 0) return;
            var dy = Math.round(-Math.sin(p * Math.PI) * HOP), x0 = pen + s.x + g.x, y0 = base + g.y + dy;
            for (var yy = 0; yy < g.h; yy++) for (var xx = 0; xx < g.w; xx++) {
              var a = g.a[yy * g.w + xx];
              if (!a) continue;
              var X = x0 + xx, Y = y0 + yy;
              if (X < 1 || Y < 1 || X > W - 2 || Y > H - 2) continue;
              f.blend(X, Y, mix(TEAL, WHITE, Math.max(0, 1 - Math.abs(X - shine) / 9)), a / 255 * fade * Math.min(1, p * 2));
            }
          });
        }
      };
    };
  }
  // ---- the join card as the board shows it while it waits for a phone + a code to scan on the left with its light
  // border + Scan to set up in teal + its wi-fi name + PW in dim with its digits as dots here + the code is drawn to look
  // like the board's and holds nothing a phone could join ----
  function codeModules(n) {
    var m = [], seed = 20261008;
    var rnd = function () { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    var finder = function (x, y) {
      for (var j = -1; j <= 7; j++) for (var i = -1; i <= 7; i++) {
        var X = x + i, Y = y + j;
        if (X < 0 || Y < 0 || X >= n || Y >= n) continue;
        var ring = Math.max(Math.abs(i - 3), Math.abs(j - 3));
        m[Y * n + X] = i >= 0 && j >= 0 && i <= 6 && j <= 6 && ring !== 2 ? 1 : 2;
      }
    };
    finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
    for (var k = 8; k < n - 8; k++) { m[6 * n + k] = m[6 * n + k] || (k % 2 ? 2 : 1); m[k * n + 6] = m[k * n + 6] || (k % 2 ? 2 : 1); }
    for (var j = -2; j <= 2; j++) for (var i = -2; i <= 2; i++) {
      var ring = Math.max(Math.abs(i), Math.abs(j));
      m[(n - 7 + j) * n + (n - 7 + i)] = ring === 1 ? 2 : 1;
    }
    for (var q = 0; q < n * n; q++) if (!m[q]) m[q] = rnd() < 0.5 ? 1 : 2;
    return m;   // 1 dark + 2 light
  }
  function drawLine(f, L, pen, base, color, alpha) {
    L.spans.forEach(function (s) {
      var g = s.g;
      if (!g.w) return;
      for (var yy = 0; yy < g.h; yy++) for (var xx = 0; xx < g.w; xx++) {
        var a = g.a[yy * g.w + xx], X = pen + s.x + g.x + xx, Y = base + g.y + yy;
        if (a && X >= 1 && Y >= 1 && X <= 126 && Y <= 30) f.blend(X, Y, color, a / 255 * (alpha == null ? 1 : alpha));
      }
    });
  }
  function joinScene(MB) {
    var N = 25, Q = codeModules(N), LIGHT = [205, 210, 212], TEAL = [119, 237, 215], WHITE = [255, 255, 255];
    var LEFT = 32, WIDE = 92;
    var fit = function (caps, str) { for (var i = 0; i < caps.length; i++) { var L = MB.text.line('label', caps[i], str); if (!L.empty && L.inkW <= WIDE) return L; } return MB.text.line('label', caps[caps.length - 1], str); };
    return function () {
      return {
        label: 'Join', dur: 12,
        draw: function (f) {
          f.fill([0, 0, 0]);
          for (var y = -1; y <= N; y++) for (var x = -1; x <= N; x++) {
            var lit = x < 0 || y < 0 || x >= N || y >= N || Q[y * N + x] === 2;
            if (lit) f.set(3 + x, 4 + y, LIGHT);
          }
          var a = fit([7, 6.5, 6], 'Scan to set up'), b = fit([7, 6.5, 6], 'mooboard-XXXX'), c = fit([6, 5.5, 5], 'PW ••••••••');
          var gap = 3, h = a.inkH + b.inkH + c.inkH + 2 * gap, top = Math.floor((32 - h) / 2);
          drawLine(f, a, LEFT - a.l, top - a.t, TEAL);
          drawLine(f, b, LEFT - b.l, top + a.inkH + gap - b.t, WHITE);
          drawLine(f, c, LEFT - c.l, top + a.inkH + b.inkH + 2 * gap - c.t, WHITE, 0.7);
        }
      };
    };
  }
  (function boards() {
    var MB = window.MooBoard;
    if (!MB || !MB.Board || !MB.text || !MB.scenes) return;
    MB.scenes.hello = helloScene(MB);
    MB.scenes.join = joinScene(MB);
    MB.scenes.off = function () { return { label: 'Off', dur: 10, draw: function (f) { f.fill([0, 0, 0]); } }; };
    [['hello-board', 'hello', 30], ['join-board', 'join', 4]].forEach(function (b) {
      var el = $(b[0]);
      if (!el) return;
      try { new MB.Board(el, { scenes: [b[1]], auto: false, fps: b[2] }); } catch (e) { /* the bezel keeps its dark panel */ }
    });
  })();

  // ---- the cards ----
  var cards = all('.card', track);
  var names = cards.map(function (c) { return c.querySelector('h1, h2').textContent; });
  var index = -1, shown = -1, settleTimer = null;
  var back = $('back'), next = $('next'), said = $('said');
  var dots = cards.map(function (c, i) {
    var li = document.createElement('li'), b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', (i + 1) + ' of ' + cards.length + ': ' + names[i]);
    b.addEventListener('click', function () { go(i); });
    li.appendChild(b);
    $('dots').appendChild(li);
    return b;
  });
  // where the track scrolls to so a card sits in the middle
  function leftOf(i) {
    var c = cards[i];
    return c.offsetLeft - (track.clientWidth - c.offsetWidth) / 2;
  }
  function nearest() {
    var mid = track.scrollLeft + track.clientWidth / 2, best = 0, bd = Infinity;
    cards.forEach(function (c, i) {
      var d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }
  // the dots and the buttons follow a swipe as it goes
  function mark(i) {
    if (i === index) return;
    index = i;
    dots.forEach(function (d, k) { if (k === i) d.setAttribute('aria-current', 'step'); else d.removeAttribute('aria-current'); });
    back.hidden = i === 0;
    next.textContent = i === cards.length - 1 ? 'Finish' : 'Next';
  }
  // a card is reached once the track stands still on it
  function arrive(speak) {
    clearTimeout(settleTimer);
    var i = nearest();
    mark(i);
    if (i === shown) return;
    shown = i;
    cards.forEach(function (c, k) { c.inert = k !== i; });
    try { history.replaceState(null, '', location.pathname + location.search + (i ? '#' + cards[i].id : '')); } catch (e) { /* the address keeps its card */ }
    if (speak) said.textContent = (i + 1) + ' of ' + cards.length + ': ' + names[i];
    reached(cards[i]);
  }
  function go(i, instant) {
    i = Math.max(0, Math.min(cards.length - 1, i));
    mark(i);
    var to = leftOf(i);
    if (Math.abs(track.scrollLeft - to) < 2) return arrive(true);
    try { track.scrollTo({ left: to, behavior: instant || REDUCED ? 'auto' : 'smooth' }); } catch (e) { track.scrollLeft = to; }
    if (instant) arrive(false);
  }
  track.addEventListener('scroll', function () {
    mark(nearest());
    clearTimeout(settleTimer);
    settleTimer = setTimeout(function () { arrive(true); }, 160);
  }, { passive: true });
  if ('onscrollend' in window) track.addEventListener('scrollend', function () { arrive(true); });
  back.addEventListener('click', function () { go(index - 1); });
  next.addEventListener('click', function () {
    if (index === cards.length - 1) location.href = hi;
    else go(index + 1);
  });
  document.addEventListener('keydown', function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return;
    var t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
  });
  // a resize keeps the card that shows in the middle
  window.addEventListener('resize', function () { if (index >= 0) track.scrollLeft = leftOf(index); });
  window.addEventListener('hashchange', function () {
    var k = cards.map(function (c) { return c.id; }).indexOf(location.hash.slice(1));
    if (k >= 0) go(k);
  });

  // ---- 4 mounting + the chips pick a way + its steps play in 3d with a caption each + replay ----
  var M = { card: $('mounting'), way: 'strips', api: null, state: 'idle', step: 0 };
  var segs = $('segs'), cap = $('cap'), player = $('player'), chips = $('chips'), busy = $('busy'), soon = $('soon');
  var CAPS = {};
  all('#seqs > div').forEach(function (d) { CAPS[d.getAttribute('data-way')] = all('li', d).map(function (li) { return li.textContent; }); });
  chips.hidden = false;
  all('.chip', chips).forEach(function (c) { c.addEventListener('click', function () { pick(c.getAttribute('data-way')); }); });
  $('replay').addEventListener('click', function () { begin(M.way, 0); });

  function buildSegs(way) {
    segs.textContent = '';
    (CAPS[way] || []).forEach(function (text, i) {
      var li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', 'Step ' + (i + 1) + ': ' + text);
      b.addEventListener('click', function () { begin(M.way, i); });
      li.appendChild(b);
      segs.appendChild(li);
    });
  }
  function onStep(way, step) {
    if (way !== M.way) return;
    M.step = step;
    cap.textContent = CAPS[way][step];
    all('button', segs).forEach(function (b, i) {
      b.style.setProperty('--k', i < step ? 1 : 0);
      if (i === step) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
  }
  function onTime(way, step, k) {
    var b = all('button', segs)[step];
    if (b && way === M.way) b.style.setProperty('--k', Math.min(1, k).toFixed(3));
  }
  function begin(way, step) {
    if (!M.api) return onStep(way, step);   // the words go on while the 3d is on its way
    if (REDUCED) {
      M.api.show(way, step);
      onStep(way, step);
      onTime(way, step, 1);
    } else M.api.play(way, step);
  }
  function pick(way) {
    M.way = way;
    all('.chip', chips).forEach(function (c) { c.setAttribute('aria-pressed', c.getAttribute('data-way') === way ? 'true' : 'false'); });
    all('#seqs > div').forEach(function (d) { d.hidden = d.getAttribute('data-way') !== way; });
    var stand = way === 'stand';
    M.card.classList.toggle('stand', stand);
    soon.hidden = !stand;
    $('mount-canvas').style.visibility = stand ? 'hidden' : '';
    busy.style.visibility = stand ? 'hidden' : '';
    player.hidden = stand || M.state === 'flat';
    if (M.api) M.api.live(!stand && cards[shown] === M.card);
    if (stand) return;
    buildSegs(way);
    onStep(way, 0);
    begin(way, 0);
  }
  function webgl() {
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) {
      return false;
    }
  }
  // the import map that names three.js + a browser without one could not load it at all
  function importMaps() {
    try {
      return !!(window.HTMLScriptElement && HTMLScriptElement.supports && HTMLScriptElement.supports('importmap'));
    } catch (e) {
      return false;
    }
  }
  // without webgl or the models the steps stand as a plain list under the chips
  function flat() {
    if (M.state === 'flat') return;
    M.state = 'flat';
    busy.hidden = true;
    M.card.classList.remove('live');
    M.card.classList.add('flat');
    player.hidden = true;
  }
  var dotsTimer = null;
  function running(on) {
    busy.hidden = !on;
    clearInterval(dotsTimer);
    var dots = busy.querySelector('.dots-run'), n = REDUCED ? 3 : 0;
    dots.setAttribute('data-n', String(n));
    if (on && !REDUCED) dotsTimer = setInterval(function () { n = (n + 1) % 4; dots.setAttribute('data-n', String(n)); }, 400);
  }
  function startMount() {
    if (M.state !== 'idle') return;
    if (!webgl() || !importMaps()) return flat();
    M.state = 'loading';
    running(true);
    var wall = getComputedStyle(root).getPropertyValue('--wall').trim() || '#ECEAE5';
    window.mooMount = function (create) {
      create({ canvas: $('mount-canvas'), clock: $('clock'), frame: finish, rail: railOf(search), wall: wall, onStep: onStep, onTime: onTime })
        .then(function (a) {
          if (M.state !== 'loading') return;
          M.api = a;
          M.state = 'ready';
          running(false);
          pick(M.way);
        }, function () { running(false); flat(); });
    };
    // a module of its own so this page needs no import syntax + the import map gives it three.js
    var s = document.createElement('script');
    s.type = 'module';
    s.textContent = "import { create } from '/js/mount.mjs'; window.mooMount(create);";
    s.addEventListener('error', function () { running(false); flat(); });
    document.head.appendChild(s);
    setTimeout(function () { if (M.state === 'loading') { running(false); flat(); } }, 30000);
  }
  function reached(card) {
    if (card === M.card) startMount();
    if (M.api) M.api.live(card === M.card && M.way !== 'stand');
  }
  M.card.classList.add('live');
  player.hidden = false;
  buildSegs('strips');
  onStep('strips', 0);
  all('#seqs > div').forEach(function (d) { d.hidden = d.getAttribute('data-way') !== M.way; });

  // ---- the first card + the address's #card + else the hello + quietly ----
  var first = Math.max(0, cards.map(function (c) { return c.id; }).indexOf(location.hash.slice(1)));
  mark(first);
  track.scrollLeft = leftOf(first);
  arrive(false);

  // renders for the owner + ?shots holds the page at a card and the steps at a moment
  if (/[?&]shots\b/.test(search)) {
    api.go = function (i) { go(i, true); };
    api.pick = pick;
    api.ready = function () {
      return new Promise(function (res) {
        (function wait() { if (M.state === 'ready' || M.state === 'flat') res(M.state); else setTimeout(wait, 100); })();
      });
    };
    api.show = function (step, t, look) { M.api.show(M.way, step, t, look); onStep(M.way, step); onTime(M.way, step, t == null ? 1 : 0.5); };
  }
})();
