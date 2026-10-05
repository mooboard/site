/* MooBoard site */
var FORMSPREE_ID = "xjyklakl"; // set to the Formspree form id to open the waitlist

(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function setRadioTabStop(selector, selected) {
    $$(selector).forEach(function (item) {
      item.tabIndex = item.dataset.frame === selected ? 0 : -1;
    });
  }
  function bindRadioKeys(selector) {
    var items = $$(selector);
    items.forEach(function (item, index) {
      item.tabIndex = item.getAttribute('aria-checked') === 'true' ? 0 : -1;
      item.addEventListener('keydown', function (event) {
        var next;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % items.length;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + items.length - 1) % items.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = items.length - 1;
        else return;
        event.preventDefault();
        items[next].focus();
        items[next].click();
      });
    });
  }
  var REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var params = new URLSearchParams(location.search);
  var gsap = window.gsap, ST = window.ScrollTrigger;
  var ANIM = !!(gsap && ST) && !params.has('static') && !REDUCED;
  // touch-only devices scroll natively under Lenis anyway (it smooths the wheel, not touch), so there it is only overhead
  var TOUCH = matchMedia('(hover: none) and (pointer: coarse)').matches;
  if (!ANIM) document.documentElement.classList.add('no-anim');
  var root = document.documentElement;
  var MB = window.MooBoard;

  // ask the browser for the board fonts so the canvas can use them
  if (document.fonts && document.fonts.load) {
    ['8px Silkscreen', '800 27px Nunito', '900 13px Nunito', '600 30px Fredoka', '700 28px Fredoka', '600 30px "Noto Sans Devanagari"']
      .forEach(function (f) { document.fonts.load(f, f.indexOf('Devanagari') > -1 ? 'ॐ' : 'A1').catch(function () {}); });
  }

  /* ---------- boards ---------- */
  var HERO_SCENES = ['time', 'song', 'art', 'calendar', 'score', 'prayer', 'weather'];
  var first = HERO_SCENES.indexOf(params.get('scene'));
  if (first > 0) HERO_SCENES = HERO_SCENES.slice(first).concat(HERO_SCENES.slice(0, first));
  var heroEl = $('#hero-board');
  var hero = new MB.Board(heroEl, {
    scenes: HERO_SCENES,
    onGlow: function (c) { root.style.setProperty('--glow', (c[0] | 0) + ', ' + (c[1] | 0) + ', ' + (c[2] | 0)); }
  });

  var chips = $('#chips');
  MB.labels(HERO_SCENES).forEach(function (label, i) {
    var b = document.createElement('button');
    b.className = 'chip' + (i ? '' : ' on'); b.textContent = label; b.setAttribute('aria-pressed', i ? 'false' : 'true');
    b.dataset.scene = HERO_SCENES[i];
    b.addEventListener('click', function () { hero.go(HERO_SCENES[i]); });
    chips.appendChild(b);
  });
  heroEl.addEventListener('scene', function (e) {
    $$('.chip', chips).forEach(function (c) { var on = c.dataset.scene === e.detail; c.classList.toggle('on', on); c.setAttribute('aria-pressed', on); });
  });
  $('#hero-tilt').addEventListener('click', function () { hero.step(); });

  function tileGlow(el) { return function (c) { el.style.setProperty('--glow', (c[0] | 0) + ', ' + (c[1] | 0) + ', ' + (c[2] | 0)); }; }
  var boards = { hero: hero };
  var story = new MB.Board($('#story-board'), { scenes: ['time', 'lyrics', 'weather'], auto: false, minScale: 10, onGlow: tileGlow($('#story')) });
  boards.story = story;
  boards.color = new MB.Board($('#color-board'), { scenes: ['time', 'lyrics', 'art'], onGlow: tileGlow($('#colors')), when: function () { return !$('#colors').classList.contains('has-stills'); } });
  boards.room = new MB.Board($('#room-board'), { scenes: ['time', 'art', 'weather'], when: function () { return !$('#room').classList.contains('has-stills'); } });
  boards.roomLive = new MB.Board($('#room-live'), { scenes: ['song', 'time', 'weather'], onGlow: tileGlow($('#room')) });
  boards.wl = new MB.Board($('#wl-board'), { scenes: ['moo', 'time', 'calendar'], onGlow: tileGlow($('#waitlist')) });

  $$('.tile').forEach(function (t) {
    var bz = document.createElement('div'); bz.className = 'bezel'; bz.dataset.frame = t.dataset.frame;
    var led = document.createElement('div'); led.className = 'led'; bz.appendChild(led);
    t.insertBefore(bz, t.firstChild);
    var b = new MB.Board(led, { scenes: [t.dataset.scene], auto: false, weather: 'snow', onGlow: tileGlow(t) });
    t.addEventListener('click', function () { b.moo(); });
  });

  /* ---------- apps strip: rounded icons with an LED dot screen, like the cow ---------- */
  var APP_ART = {
    clock:    ['..####..', '.#....#.', '#..#...#', '#..#...#', '#..###.#', '#......#', '.#....#.', '..####..'],
    weather:  ['........', '..###...', '.#####..', '########', '########', '.#.#.#..', '#.#.#...', '........'],
    music:    ['....##..', '....###.', '....#.##', '....#...', '....#...', '.####...', '#####...', '.###....'],
    calendar: ['.#....#.', '########', '########', '#......#', '#.#.#.##', '#......#', '#.#.#..#', '########'],
    lights:   ['..####..', '.######.', '########', '########', '.######.', '..####..', '..#..#..', '..####..'],
    prayer:   ['...#....', '...##...', '..###...', '..####..', '...##...', '#......#', '.######.', '..####..'],
    sports:   ['..####..', '.#.##.#.', '#..##..#', '########', '########', '#..##..#', '.#.##.#.', '..####..'],
    tv:       ['.#....#.', '..#..#..', '########', '#......#', '#......#', '#......#', '########', '.##..##.'],
    seasons:  ['......##', '....####', '..######', '.######.', '.#####..', '.####...', '.#......', '#.......'],
    more:     ['........', '........', '........', '##.##.##', '##.##.##', '........', '........', '........']
  };
  var APP_BG = { orange: ['#FF7A21', '#ff9f5c'], white: ['#F5F3EF', '#ffffff'], black: ['#17191C', '#33373d'], teal: ['#77EDD7', '#b9fae9'], ghost: ['rgba(255,255,255,.06)', 'rgba(255,255,255,.12)'] };
  function appIcon(li, n) {
    var art = APP_ART[li.dataset.app] || APP_ART.more, bg = APP_BG[li.dataset.bg], c = li.dataset.c, id = 'ag' + n, dots = '';
    art.forEach(function (row, y) {
      for (var x = 0; x < 8; x++) {
        var on = row[x] === '#';
        dots += '<circle cx="' + (30 + x * 9.4) + '" cy="' + (30 + y * 9.4) + '" r="' + (on ? 3.6 : 2.4) + '" fill="' + (on ? c : '#1F2E38') + '"/>';
      }
    });
    var ghost = li.dataset.bg === 'ghost';
    return '<svg viewBox="0 0 126 126" aria-hidden="true"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + bg[1] + '"/><stop offset=".5" stop-color="' + bg[0] + '"/></linearGradient></defs>' +
      '<rect width="126" height="126" rx="30" fill="url(#' + id + ')"' + (ghost ? ' stroke="rgba(255,255,255,.3)" stroke-dasharray="8 7" stroke-width="3"' : '') + '/>' +
      (ghost ? '' : '<rect x="16" y="16" width="94" height="94" rx="20" fill="#0E1A22"/>') + dots + '</svg>';
  }
  var FRAME_OF = { orange: 'orange', white: 'white', black: 'black', teal: 'teal', ghost: 'black' };
  $$('#app-row li').forEach(function (li, n) {
    var name = li.textContent.trim(); li.textContent = '';
    var bz = document.createElement('div'); bz.className = 'bezel'; bz.dataset.frame = FRAME_OF[li.dataset.bg];
    var led = document.createElement('div'); led.className = 'led'; led.setAttribute('role', 'img'); led.setAttribute('aria-label', name + ' on MooBoard');
    bz.appendChild(led); li.appendChild(bz);
    li.insertAdjacentHTML('beforeend', '<div class="app-name">' + appIcon(li, n) + '<span>' + name + '</span></div>');
    var b = new MB.Board(led, { scenes: [li.dataset.scene], auto: false });
    bz.addEventListener('click', function () { b.moo(); });
  });
  $$('.an').forEach(function (btn) {
    btn.addEventListener('click', function () { var r = $('#app-row'); r.scrollBy({ left: +btn.dataset.dir * r.clientWidth * .8, behavior: REDUCED ? 'auto' : 'smooth' }); });
  });

  /* ---------- frame colors ---------- */
  var FRAMES = ['black', 'white', 'orange', 'teal'];
  var CBG = { black: '#E9FBF7', white: '#E3F2EE', orange: '#FFE7D6', teal: '#D5F8EF' };
  var MARK_FRAME = { black: '#17191C', white: '#FFFFFF', orange: '#FF7A21', teal: '#77EDD7' };
  function setHeroFrame(f) {
    $('#hero-bezel').dataset.frame = f;
    $('.hero .controls').dataset.frame = f;
    $$('.mark').forEach(function (m) { m.style.setProperty('--mark-frame', MARK_FRAME[f]); m.dataset.frame = f; });
    $$('.swatches .sw').forEach(function (s) { s.classList.toggle('on', s.dataset.frame === f); s.setAttribute('aria-checked', s.dataset.frame === f); });
    setRadioTabStop('.swatches .sw', f);
  }
  $$('.swatches .sw').forEach(function (s) {
    s.addEventListener('click', function (e) { e.stopPropagation(); setHeroFrame(s.dataset.frame); pulse($('#hero-bezel')); });
  });
  bindRadioKeys('.swatches .sw');
  var colorIdx = -1;
  function setColor(i, fromUser) {
    if (i === colorIdx) return; colorIdx = i;
    var f = FRAMES[i];
    $('#color-bezel').dataset.frame = f;
    $('#colors').style.setProperty('--cbg', CBG[f]);
    $('#colors').dataset.frame = f;
    $$('.cp').forEach(function (c) { c.classList.toggle('on', c.dataset.frame === f); c.setAttribute('aria-checked', c.dataset.frame === f); });
    setRadioTabStop('.color-pick .cp', f);
    $$('.color-stills img').forEach(function (c) { c.classList.toggle('on', c.dataset.frame === f); });
    if (fromUser) setHeroFrame(f);
    pulse($('#color-bezel'));
  }
  bindRadioKeys('.color-pick .cp');
  function pulse(el) {
    if (!ANIM || REDUCED) return;
    gsap.fromTo(el, { scale: .97 }, { scale: 1, duration: .6, ease: 'elastic.out(1, .5)' });
  }

  /* ---------- moo ---------- */
  function moo(from) {
    MB.boards.forEach(function (b) { if (b.visible) b.moo(); });
    $$('.mark').forEach(function (m) { m.classList.remove('wiggle'); void m.getBoundingClientRect(); m.classList.add('wiggle'); });
    setTimeout(function () { $$('.mark').forEach(function (m) { m.classList.remove('wiggle'); }); }, 1000);
    var pop = $('#moo-pop'), r = (from || $('#logo')).getBoundingClientRect();
    pop.style.left = Math.min(innerWidth - 90, r.right - 6) + 'px';
    pop.style.top = Math.max(8, r.top - 30) + 'px';
    pop.classList.remove('show'); void pop.offsetWidth; pop.classList.add('show');
  }
  $('#logo').addEventListener('click', function () { moo($('#logo')); });
  $('#foot-mark').addEventListener('click', function () { moo($('#foot-mark')); });
  var typed = '';
  addEventListener('keydown', function (e) {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    typed = (typed + (e.key || '')).slice(-3).toLowerCase();
    if (typed === 'moo') moo();
  });

  /* ---------- the cow's eyes ---------- */
  var marks = $$('.mark'), loads = 0;
  // pupils cycle the brand colors while something loads
  // loading: the pupils blink random rainbow hues every ~100 ms while the mark jitters (CSS), then settle.
  // the white eye dots always stay white
  var rainbowT = 0;
  function eyeDots() { return $$('.mark .pupil'); }
  function rainbow(on) {
    clearTimeout(rainbowT);
    if (!on || REDUCED) { eyeDots().forEach(function (c) { c.style.fill = ''; }); return; }
    (function hop() {
      eyeDots().forEach(function (c) {
        c.style.fill = 'hsl(' + Math.floor(Math.random() * 360) + ', 95%, 55%)';
      });
      rainbowT = setTimeout(hop, 80 + Math.random() * 40);
    })();
  }
  function busy(p) {
    if (++loads === 1) { marks.forEach(function (m) { m.classList.add('loading'); }); rainbow(true); }
    var done = function () { if (--loads <= 0) { loads = 0; marks.forEach(function (m) { m.classList.remove('loading'); }); rainbow(false); } };
    Promise.resolve(p).then(done, done);
    return p;
  }
  // happy eyes: pupils flash and glow, ears wiggle, confetti in the brand colors
  var happyT = 0;
  function happy(from) {
    marks.forEach(function (m) { m.classList.remove('happy'); void m.getBoundingClientRect(); m.classList.add('happy'); });
    clearTimeout(happyT); happyT = setTimeout(function () { marks.forEach(function (m) { m.classList.remove('happy'); }); }, 2800);
    if (!REDUCED) confetti(from);
  }
  function confetti(from) {
    var cv = document.createElement('canvas'), dpr = Math.min(devicePixelRatio || 1, 2);
    cv.className = 'confetti'; cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; document.body.appendChild(cv);
    var x = cv.getContext('2d'), r = from ? from.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
    var ox = (r.left + r.width / 2) * dpr, oy = (r.top + r.height / 2) * dpr;
    var cols = ['#77EDD7', '#FFB81C', '#FF2E88', '#FF7A21', '#FFB7C9', '#77EDD7', '#F5E9D6', '#FFFFFF'], ps = [];
    for (var i = 0; i < 160; i++) {
      var a = -Math.PI / 2 + (Math.random() - .5) * 2.4, v = (6 + Math.random() * 12) * dpr;
      ps.push({ x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, c: cols[i % cols.length], s: (4 + Math.random() * 7) * dpr, dot: Math.random() < .55, rot: Math.random() * 6, vr: (Math.random() - .5) * .4 });
    }
    var t0 = performance.now();
    (function frame(now) {
      var t = (now - t0) / 1000;
      x.clearRect(0, 0, cv.width, cv.height);
      x.globalAlpha = Math.max(0, Math.min(1, 3 - t));
      ps.forEach(function (p) {
        p.vy += .38 * dpr; p.vx *= .985; p.vy *= .985; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        x.fillStyle = p.c;
        if (p.dot) { x.shadowColor = p.c; x.shadowBlur = 8 * dpr; x.beginPath(); x.arc(p.x, p.y, p.s / 2, 0, 6.3); x.fill(); x.shadowBlur = 0; }
        else { x.save(); x.translate(p.x, p.y); x.rotate(p.rot); x.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); x.restore(); }
      });
      if (t < 3) requestAnimationFrame(frame); else cv.remove();
    })(t0);
  }
  // pupils look toward the pointer, one dot at a time
  if (matchMedia('(pointer: fine)').matches && !REDUCED) {
    var raf = 0, px = 0, py = 0;
    addEventListener('pointermove', function (e) {
      px = e.clientX; py = e.clientY;
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        $$('.mark .pupils').forEach(function (p) {
          var r = p.ownerSVGElement.getBoundingClientRect();
          if (r.bottom < 0 || r.top > innerHeight) return;
          var dx = px - (r.left + r.width / 2), dy = py - (r.top + r.height * .45), d = Math.hypot(dx, dy) || 1;
          var sx = d < 30 ? 0 : Math.round(dx / d * 1.3), sy = d < 30 ? 0 : Math.round(dy / d * 1.3);
          p.style.transform = 'translate(' + 4 * Math.max(-1, Math.min(1, sx)) + 'px,' + 4 * Math.max(-1, Math.min(1, sy)) + 'px)';
        });
      });
    });
  }

  /* ---------- music: playlist player, tint, now playing ---------- */
  var MINT = '#77EDD7', INK = '#0E1A22';
  function rgbOf(h) { h = h.replace('#', ''); return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)]; }
  function hexOf(c) { return '#' + c.map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }).join(''); }
  function mixHex(a, b, t) { var x = rgbOf(a), y = rgbOf(b); return hexOf([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]); }
  function lum(h) { return rgbOf(h).map(function (v) { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }).reduce(function (s, v, i) { return s + v * [.2126, .7152, .0722][i]; }, 0); }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
  // the page accent follows the track color; every text on it keeps AA contrast
  function setAccent(hex) {
    var solid = hex, k = 0, text = contrast(hex, INK) >= contrast(hex, '#FFFFFF') ? INK : '#FFFFFF';
    while (contrast(solid, text) < 4.5 && k++ < 20) solid = mixHex(solid, text === INK ? '#FFFFFF' : '#000000', .06);
    var lite = hex; k = 0;
    while (contrast(lite, INK) < 4.5 && k++ < 20) lite = mixHex(lite, '#FFFFFF', .08);
    root.style.setProperty('--accent', hex);
    root.style.setProperty('--accent-solid', solid);
    root.style.setProperty('--accent-ink', text);
    root.style.setProperty('--accent-lite', lite);
    root.style.setProperty('--accent-rgb', rgbOf(hex).join(', '));
    var tc = document.querySelector('meta[name="theme-color"]'); if (tc) tc.content = mixHex(hex, INK, .8);
  }

  var player = $('#player'), plPlay = $('#pl-play'), plMute = $('#pl-mute'), np = $('#np');
  var heldByMusic = false, lastTrack = null;
  function fmt(t) { t = Math.max(0, Math.floor(t)); return Math.floor(t / 60) + ':' + (t % 60 < 10 ? '0' : '') + (t % 60); }
  function musicUI(type) {
    var M = window.MooMusic; if (!M || !M.ready()) return;
    var tr = M.track(), playing = M.playing(), muted = M.muted(), audible = playing && !muted;
    player.classList.toggle('paused', !playing);
    plPlay.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    plMute.classList.toggle('on', !muted); plMute.setAttribute('aria-pressed', !muted); plMute.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    $$('.mark').forEach(function (m) { m.classList.toggle('music', audible); });
    setAccent(playing && tr ? tr.tint : MINT);
    np.classList.toggle('muted', !audible);
    if (tr && tr !== lastTrack) {
      lastTrack = tr;
      var cov = M.cover(tr);
      var fill = function () {
        $('.np-cover', np).src = cov; $('.np-t', np).textContent = tr.title; $('.np-a', np).textContent = tr.artist;
        // radio songs are Apple Music previews: the card links to the song there
        np.classList.toggle('linked', !!tr.link);
        if (tr.link) { np.setAttribute('role', 'link'); np.tabIndex = 0; np.title = tr.title + ' on Apple Music'; }
        else { np.removeAttribute('role'); np.removeAttribute('tabindex'); np.removeAttribute('title'); }
      };
      if (np.classList.contains('show') && !REDUCED) { np.classList.remove('show'); setTimeout(function () { fill(); np.classList.add('show'); }, 380); }
      else { fill(); if (playing) np.classList.add('show'); }
    }
    np.classList.toggle('show', playing && !!tr);
    if (audible && !heldByMusic) { heldByMusic = true; hero.hold('song'); $$('.chip', chips).forEach(function (c) { var on = c.dataset.scene === 'song'; c.classList.toggle('on', on); c.setAttribute('aria-pressed', on); }); }
    else if (!audible && heldByMusic) { heldByMusic = false; hero.release(); }
  }
  addEventListener('moomusic', function (e) { musicUI(e.detail.type); });
  function openSong(e) {
    var M = window.MooMusic, tr = M && M.track();
    if (!tr || !tr.link || (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault(); window.open(tr.link, '_blank', 'noopener');
  }
  np.addEventListener('click', openSong); np.addEventListener('keydown', openSong);
  if (window.MooMusic && window.MooMusic.loaded) busy(window.MooMusic.loaded);
  plPlay.addEventListener('click', function () { var M = window.MooMusic; if (!M) return; if (M.playing()) M.pause(); else M.play(); });
  $('#pl-next').addEventListener('click', function () { if (window.MooMusic) window.MooMusic.next(); });
  plMute.addEventListener('click', function () { var M = window.MooMusic; if (!M) return; if (M.muted()) { M.unmute(); if (!M.playing()) M.play(); } else M.mute(); });

  /* ---------- waitlist ---------- */
  var form = $('#wl-form'), msg = $('#wl-msg');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = $('#wl-email').value.trim(), btn = $('button', form);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = 'That email looks off.'; $('#wl-email').focus(); return; }
    btn.disabled = true; msg.textContent = '';
    var send = FORMSPREE_ID
      ? fetch('https://formspree.io/f/' + encodeURIComponent(FORMSPREE_ID), { method: 'POST', headers: { Accept: 'application/json' }, body: new FormData(form) })
          .then(function (r) { if (!r.ok) throw new Error('bad'); return 'sent'; })
      : new Promise(function (res) { setTimeout(function () { res('soon'); }, 700); });
    busy(send).then(function (how) {
      if (how === 'sent') { form.classList.add('done'); form.reset(); msg.textContent = "You're on the list. moo."; }
      else { form.classList.add('soon'); msg.textContent = 'Coming soon. The list opens any day now.'; }
      boards.wl.moo(); happy(btn);
    }, function () { msg.textContent = 'Could not send. Try again in a moment.'; })
      .then(function () { btn.disabled = false; });
  });

  /* ---------- render stills (used until the scroll sequences exist) ---------- */
  $$('.stills').forEach(function (st) {
    var sec = st.closest('section'), first = $('img', st);
    if (!first) return;
    function ok() { sec.classList.add('has-stills'); if (ST) ST.refresh(); }
    if (first.complete && first.naturalWidth) ok(); else first.addEventListener('load', ok);
  });

  /* ---------- scroll-scrubbed render sequences: js/seq.js ---------- */
  var seqs = {};
  addEventListener('resize', function () { Object.keys(seqs).forEach(function (k) { seqs[k].redraw(); }); });

  /* ---------- static fallbacks (no GSAP) ---------- */
  function wireStatic() {
    $$('.cp').forEach(function (c, i) { c.addEventListener('click', function () { setColor(i, true); }); });
    setColor(3);
  }
  // room: loads zoomed out (the whole room); the toggle zooms into the wall board and back out
  var roomZoomed = false, roomTween = null, roomState = { p: 0 };
  function roomZoom(on) {
    roomZoomed = on;
    var btn = $('#room-zoom'), sec = $('#room');
    btn.setAttribute('aria-pressed', on); sec.classList.toggle('zoomed', on);
    var sq = seqs.room;
    if (!sq) return;
    if (roomTween) roomTween.kill();
    if (gsap && !REDUCED) roomTween = gsap.to(roomState, { p: on ? 1 : 0, duration: 1.8, ease: 'power2.inOut', onUpdate: function () { sq.set(roomState.p); } });
    else { roomState.p = on ? 1 : 0; sq.set(roomState.p); }
  }
  $('#room-zoom').addEventListener('click', function (e) { e.stopPropagation(); roomZoom(!roomZoomed); });
  $('#room .pin').addEventListener('click', function () { roomZoom(!roomZoomed); });

  /* ---------- motion ---------- */
  function initMotion() {
    gsap.registerPlugin(ST);
    var lenis = null;
    if (window.Lenis && !REDUCED && !TOUCH) {
      lenis = new window.Lenis({ lerp: .1, smoothWheel: true });
      lenis.on('scroll', ST.update);
      gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
      gsap.ticker.lagSmoothing(0);
    }
    function scrollTo(y) { if (lenis) lenis.scrollTo(y, { duration: 1.2 }); else window.scrollTo({ top: y, behavior: REDUCED ? 'auto' : 'smooth' }); }
    $$('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var t = $(a.getAttribute('href')); if (!t) return;
        e.preventDefault(); scrollTo(t.getBoundingClientRect().top + scrollY);
      });
    });

    // nav
    var lastY = 0, nav = $('#nav');
    ST.create({ start: 0, end: 'max', onUpdate: function (self) {
      var y = self.scroll();
      nav.classList.toggle('solid', y > 40);
      nav.classList.toggle('hide', y > 400 && y > lastY + 2);
      if (y < lastY - 2) nav.classList.remove('hide');
      lastY = y;
    } });

    // hero intro: "mood board" drops its d and becomes mooboard
    var d = $('.pun .d'), gap = $('.pun .gap');
    gsap.set([d, gap], { width: function (i, el) { return el.getBoundingClientRect().width; } });
    if (REDUCED) gsap.set([d, gap], { width: 0, opacity: 0 });
    else {
      var intro = gsap.timeline({ delay: .15 });
      intro.from('.pun .w, .pun .d', { yPercent: 60, opacity: 0, duration: .9, stagger: .08, ease: 'back.out(1.8)' })
        .from('[data-hero]', { y: 40, opacity: 0, duration: 1, stagger: .1, ease: 'power3.out', clearProps: 'transform' }, '-=.5')
        .to(d, { rotation: 38, duration: .35, ease: 'power1.inOut' }, 1.5)
        .to(d, { rotation: 8, duration: .25, ease: 'power1.inOut' })
        .to(d, { y: '120%', rotation: 70, opacity: 0, duration: .6, ease: 'power2.in' })
        .to([d, gap], { width: 0, duration: .55, ease: 'power3.inOut' }, '-=.35')
        .fromTo('.pun', { scale: 1 }, { scale: 1.04, duration: .18, yoyo: true, repeat: 1, ease: 'power1.inOut' }, '-=.1');
    }

    // hero parallax + tilt
    gsap.to('.dotfield', { yPercent: 18, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
    // parallax lives on wrappers so it never fights the intro tweens on the same elements (that caused the board to jump)
    gsap.fromTo('.stage-par', { y: 0, scale: 1 }, { y: 60, scale: .95, ease: 'none', immediateRender: false, scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
    gsap.fromTo('.pun-par', { y: 0, opacity: 1 }, { y: -60, opacity: .2, ease: 'none', immediateRender: false, scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
    if (matchMedia('(pointer: fine)').matches && !REDUCED) {
      var tilt = $('#hero-tilt');
      $('.hero').addEventListener('pointermove', function (e) {
        var x = e.clientX / innerWidth - .5, y = e.clientY / innerHeight - .5;
        tilt.style.transform = 'rotateY(' + (x * 10).toFixed(2) + 'deg) rotateX(' + (-y * 8).toFixed(2) + 'deg)';
      });
      $('.hero').addEventListener('pointerleave', function () { tilt.style.transform = ''; });
    }

    // story
    var storySeq = seqs.hero, caps = $$('#story .cap'), bar = $('#story .progress i'), lastScene = 'time';
    var scr = storySeq && storySeq.spec.screen;
    if (scr) {
      // the live board takes over the rendered LED face once the camera settles
      var live = $('#story .seq-live');
      live.appendChild($('#story-board'));
      storySeq.onDraw = function (j) {
        var r = storySeq.rect, q = scr.rect;
        live.style.left = (r.x + q[0] * r.w) + 'px'; live.style.top = (r.y + q[1] * r.h) + 'px';
        live.style.width = ((q[2] - q[0]) * r.w) + 'px'; live.style.height = ((q[3] - q[1]) * r.h) + 'px';
        live.style.opacity = Math.max(0, Math.min(1, (j - scr.from + 4) / 8));
      };
      storySeq.redraw();
    }
    if (!storySeq) gsap.set('#story .spin', { rotateX: 58, rotateZ: -10, scale: .8, y: 40 });
    var storyTl = gsap.timeline({
      scrollTrigger: {
        trigger: '#story', start: 'top top', end: '+=260%', pin: '#story .pin', scrub: .6,
        onUpdate: function (self) {
          var p = self.progress;
          if (storySeq) storySeq.set(p);
          bar.style.transform = 'scaleX(' + p.toFixed(3) + ')';
          var sc = scr ? 'time' : p < .36 ? 'time' : p < .7 ? 'lyrics' : 'weather';
          if (sc !== lastScene) { lastScene = sc; story.go(sc); }
        }
      }
    });
    if (!storySeq) {
      gsap.set('#story .spin', { transformOrigin: '64% 50%' });
      storyTl.to('#story .spin', { rotateX: 0, rotateZ: 0, scale: 1, y: 0, duration: .34, ease: 'power2.out' }, 0)
        .to('#story .spin', { scale: 2.3, duration: .2, ease: 'power2.inOut' }, .38)
        .to('#story .spin', { scale: 1, rotateY: -12, duration: .18, ease: 'power2.inOut' }, .6)
        .to('#story .spin', { rotateY: 10, rotateX: 6, scale: .94, duration: .22, ease: 'sine.inOut' }, .78);
    }
    storyTl.to(caps[0], { opacity: 0, y: -30, duration: .08 }, .3)
      .fromTo(caps[1], { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: .08 }, .38)
      .to(caps[1], { opacity: 0, y: -30, duration: .08 }, .64)
      .fromTo(caps[2], { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: .08 }, .72)
      .to({}, { duration: .2 }, .8);

    // which color (or place) a scroll position shows. A sequence can say which frames show what:
    // "colors": { "black": [1, 30], ... } or "places": { "wall": [1, 60], "desk": [61, 120] } (1-based frames)
    function rangeIndex(sq, key, names, p) {
      var r = sq && sq.spec[key];
      if (r) {
        var f = Math.round(p * (sq.n - 1)) + 1;
        for (var i = 0; i < names.length; i++) { var a = r[names[i]]; if (a && f >= a[0] && f <= a[1]) return i; }
      }
      return Math.min(names.length - 1, Math.floor(p * names.length));
    }
    function rangeProgress(sq, key, name, i, count) {
      var a = sq && sq.spec[key] && sq.spec[key][name];
      return a ? ((a[0] + a[1]) / 2 - 1) / (sq.n - 1) : (i + .5) / count;
    }

    // colors
    var colorSeq = seqs.colors;
    if (colorSeq) { colorSeq.shiftProgress = 0; colorSeq.set(1); }
    var colorST = ST.create({
      trigger: '#colors', start: 'top top', end: '+=220%', pin: '#colors .pin', scrub: .5,
      onUpdate: function (self) {
        // the section opens on Mint Glow: scrolling runs the color sequence backwards (teal, orange, white, black)
        var p = 1 - self.progress;
        if (colorSeq) {
          // Reframe the render so the board travels right-to-left into the page center without changing swatch order.
          colorSeq.shiftProgress = Math.round(self.progress * (colorSeq.n - 1)) / (colorSeq.n - 1);
          colorSeq.set(p);
        }
        else gsap.set('#colors .swing', { rotateY: -16 + p * 32, rotateX: 6 - p * 6 });
        setColor(rangeIndex(colorSeq, 'colors', FRAMES, p));
      }
    });
    setColor(3);
    $$('.cp').forEach(function (c, i) {
      c.addEventListener('click', function () { setColor(i, true); scrollTo(colorST.start + (colorST.end - colorST.start) * (1 - rangeProgress(colorSeq, 'colors', FRAMES[i], i, 4))); });
    });

    if (!REDUCED) {
      gsap.fromTo('.color-stills', { scale: 1.1 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: '#colors', start: 'top top', end: '+=220%', scrub: true } });
      $$('.card img').forEach(function (im) {
        gsap.to(im, { scale: 1, yPercent: 4, ease: 'none', scrollTrigger: { trigger: im.parentNode, start: 'top bottom', end: 'bottom top', scrub: true } });
      });
    }

    if (REDUCED) return;

    // reveals
    $$('[data-reveal]').forEach(function (el) {
      gsap.from(el, { y: 60, opacity: 0, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 88%' } });
    });
    gsap.set('.tile', { y: 90, opacity: 0, rotate: function (i) { return i % 2 ? 2 : -2; } });
    ST.batch('.tile', {
      start: 'top 92%',
      onEnter: function (b) { gsap.to(b, { y: 0, opacity: 1, rotate: 0, duration: .9, stagger: .09, ease: 'back.out(1.4)' }); }
    });
    gsap.from('#app-row li', { y: 70, opacity: 0, rotate: function (i) { return i % 2 ? 8 : -8; }, duration: .8, stagger: .07, ease: 'back.out(1.7)', scrollTrigger: { trigger: '#app-row', start: 'top 88%' } });
    gsap.from('.big em', { x: 80, duration: 1.2, ease: 'power3.out', scrollTrigger: { trigger: '.shows .big', start: 'top 85%' } });

    // numbers count up
    $$('[data-count]').forEach(function (el) {
      var end = +el.dataset.count, o = { v: 0 };
      ST.create({ trigger: el, start: 'top 90%', once: true, onEnter: function () {
        gsap.to(o, { v: end, duration: 1.6, ease: 'power3.out', onUpdate: function () {
          var v = Math.round(o.v); el.textContent = el.dataset.format === 'comma' ? v.toLocaleString('en-US') : v;
        } });
      } });
    });
    gsap.fromTo('.marquee', { xPercent: 6 }, { xPercent: -6, ease: 'none', scrollTrigger: { trigger: '.tech', start: 'top bottom', end: 'bottom top', scrub: true } });
    gsap.from('.tag', { scale: 0, rotate: -40, duration: .8, ease: 'back.out(2.5)', scrollTrigger: { trigger: '.wl-price', start: 'top 85%' } });
    gsap.from('.foot-mark', { y: 40, rotate: -15, duration: 1, ease: 'elastic.out(1, .5)', scrollTrigger: { trigger: '.foot', start: 'top 95%' } });
  }

  busy(Promise.all([
    new Promise(function (res) { if (document.readyState === 'complete') res(); else addEventListener('load', res); }),
    document.fonts ? document.fonts.ready : null
  ]));
  var boot = busy(ANIM && window.MooSeq ? window.MooSeq.load().then(function (s) { seqs = s; }) : Promise.resolve());
  boot.then(function () {
    if (ANIM) {
      try { initMotion(); } catch (e) { root.classList.add('no-anim'); wireStatic(); throw e; }
      if (params.has('y')) setTimeout(function () { window.scrollTo(0, +params.get('y')); ST.update(); }, 300);
    } else wireStatic();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (ST) ST.refresh(); });
    // draw each sequence's current frame once layout has settled
    requestAnimationFrame(function () { Object.keys(seqs).forEach(function (k) { seqs[k].redraw(); }); });
  });
})();
