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
  var root = document.documentElement;
  // without motion there is no intro to take the hero over from the head script
  if (!ANIM) { root.classList.add('no-anim'); root.classList.remove('intro', 'intro-late'); }
  var MB = window.MooBoard;

  /* ---------- pause motion: every loop holds a still frame, the music plays on ---------- */
  // the choice lasts the visit and is in place before the first board draws
  var paused = false, motionBtn = $('#motion'), stored = null;
  function setPaused(on) {
    paused = on;
    root.classList.toggle('motion-paused', on);
    if (MB && MB.setPaused) MB.setPaused(on);
    if (motionBtn) { motionBtn.setAttribute('aria-pressed', on); motionBtn.dataset.tip = on ? 'Play motion' : 'Pause motion'; }
    dispatchEvent(new CustomEvent('moomotion', { detail: on }));
  }
  try { stored = sessionStorage.getItem('moo-paused'); } catch (e) {}
  if (stored === '1') setPaused(true);
  if (motionBtn) motionBtn.addEventListener('click', function () {
    setPaused(!paused);
    try { sessionStorage.setItem('moo-paused', paused ? '1' : '0'); } catch (e) {}
  });

  // ask the browser for the board fonts so the canvas can use them
  if (document.fonts && document.fonts.load) {
    // (the Prayer face's Devanagari is pre-rendered, the board's own strips, so no Devanagari font loads)
    ['500 30px Fredoka', '600 30px Fredoka', '700 28px Fredoka']
      .forEach(function (f) { document.fonts.load(f, 'A1').catch(function () {}); });
  }

  /* ---------- boards ---------- */
  var HERO_SCENES = ['time', 'song', 'art', 'calendar', 'score', 'prayer', 'weather'];
  var first = HERO_SCENES.indexOf(params.get('scene'));
  if (first > 0) HERO_SCENES = HERO_SCENES.slice(first).concat(HERO_SCENES.slice(0, first));
  var heroEl = $('#hero-board');
  var hero = new MB.Board(heroEl, { scenes: HERO_SCENES, onGlow: tileGlow($('#top')) });

  var chips = $('#chips'), LABEL = {};
  MB.labels(HERO_SCENES).forEach(function (label, i) {
    LABEL[HERO_SCENES[i]] = label;
    var b = document.createElement('button');
    b.className = 'chip' + (i ? '' : ' on'); b.textContent = label; b.setAttribute('aria-pressed', i ? 'false' : 'true');
    b.dataset.scene = HERO_SCENES[i];
    b.addEventListener('click', function () { hero.go(HERO_SCENES[i]); });
    chips.appendChild(b);
  });
  // the board's accessible name says what it shows, the clock with its time
  var heroScene = HERO_SCENES[0];
  function heroName() {
    var what = heroScene === 'time' ? 'the time, ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : (LABEL[heroScene] || heroScene).toLowerCase();
    var name = 'Live mooboard display showing ' + what;
    if (heroEl.getAttribute('aria-label') !== name) heroEl.setAttribute('aria-label', name);
  }
  heroName(); setInterval(heroName, 10000);
  heroEl.addEventListener('scene', function (e) {
    heroScene = e.detail; heroName();
    $$('.chip', chips).forEach(function (c) { var on = c.dataset.scene === e.detail; c.classList.toggle('on', on); c.setAttribute('aria-pressed', on); });
  });
  $('#hero-tilt').addEventListener('click', function () { hero.step(); });

  // the glow goes on the board's own section (on :root it would restyle the whole page), and only when it changed
  function tileGlow(el) {
    var last = '';
    return function (c) { var v = (c[0] | 0) + ', ' + (c[1] | 0) + ', ' + (c[2] | 0); if (v !== last) el.style.setProperty('--glow', last = v); };
  }
  var boards = { hero: hero };
  // the story's board: once the camera settles it is the board's Cover lyric view of the song that's on (the album art,
  // the time under it, the lyrics beside); with nothing playing, the next song's cover and its first line, unsung. It
  // draws only while it shows (storyLive)
  var storyLive = 1;
  var story = new MB.Board($('#story-board'), { scenes: ['combo', 'time', 'weather'], auto: false, minScale: 10, onGlow: tileGlow($('#story')), when: function () { return storyLive > 0; } });
  boards.story = story;
  boards.wl = new MB.Board($('#wl-board'), { scenes: ['moo', 'time', 'calendar'], onGlow: tileGlow($('#waitlist')) });

  // the tiles and the app strip are far below the fold: their boards are built when they come within two
  // viewports (or on tap), and run at 30 fps
  var buildQueue = [];
  function drainBuilds() { var f = buildQueue.shift(); if (f) { f(); if (buildQueue.length) requestAnimationFrame(drainBuilds); } }
  function lazyBoard(led, opts, watch) {
    var b = null, make = function () { return b || (b = new MB.Board(led, opts)); };
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (e) {
        if (!e[0].isIntersecting) return;
        io.disconnect();
        // one board per frame: twenty at once would be a 100 ms task mid-scroll
        buildQueue.push(make); if (buildQueue.length === 1) requestAnimationFrame(drainBuilds);
      }, { rootMargin: '200% 0px' });
      io.observe(watch || led);
    } else make();
    return { moo: function () { make().moo(); } };
  }
  $$('.tile').forEach(function (t) {
    var bz = document.createElement('div'); bz.className = 'bezel'; bz.dataset.frame = t.dataset.frame;
    var led = document.createElement('div'); led.className = 'led'; bz.appendChild(led);
    t.insertBefore(bz, t.firstChild);
    var b = lazyBoard(led, { scenes: [t.dataset.scene], auto: false, weather: 'snow', fps: 30, onGlow: tileGlow(t) }, t);
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
      // the coloured frame 9 units of the 126 (it was 16): a thin rim round the dark tile, the same colours and corners
      (ghost ? '' : '<rect x="9" y="9" width="108" height="108" rx="23" fill="#0E1A22"/>') + dots + '</svg>';
  }
  var FRAME_OF = { orange: 'orange', white: 'white', black: 'black', teal: 'teal', ghost: 'black' };
  $$('#app-row li').forEach(function (li, n) {
    var name = li.textContent.trim(); li.textContent = '';
    var bz = document.createElement('div'); bz.className = 'bezel'; bz.dataset.frame = FRAME_OF[li.dataset.bg];
    var led = document.createElement('div'); led.className = 'led'; led.setAttribute('role', 'img'); led.setAttribute('aria-label', name + ' on mooboard');
    bz.appendChild(led); li.appendChild(bz);
    // the name goes back in as text, never as markup
    var label = document.createElement('span'); label.textContent = name;
    li.insertAdjacentHTML('beforeend', '<div class="app-name">' + appIcon(li, n) + '</div>');
    li.lastChild.appendChild(label);
    var b = lazyBoard(led, { scenes: [li.dataset.scene], auto: false, fps: 30 }, $('#app-row'));
    bz.addEventListener('click', function () { b.moo(); });
  });
  $$('.an').forEach(function (btn) {
    btn.addEventListener('click', function () { var r = $('#app-row'); r.scrollBy({ left: +btn.dataset.dir * r.clientWidth * .8, behavior: REDUCED ? 'auto' : 'smooth' }); });
  });

  /* ---------- the 4,096 LEDs card: a close-up of the dot matrix with a full-spectrum wave running across it ---------- */
  // Every LED is one cell of a tiny color image, scaled up without smoothing and cut into round dots by a pattern,
  // over the unlit panel, with a soft glow and a glassy sheen: five GPU draws a frame at 20 fps, only while the card
  // is on screen; one still frame under reduced motion or a pause
  (function () {
    var cv = $('.rainbow-leds');
    if (!cv || !cv.getContext) return;
    var card = cv.parentNode, ctx = cv.getContext('2d'), PITCH = 26, FPS = 20;
    var src = document.createElement('canvas'), sx = src.getContext('2d'), data = null;
    var W = 0, H = 0, cd = 0, cols = 0, rows = 0, pats = null, on = false, raf = 0, last = 0, prev = 0;
    function tile(cd, draw) { var c = document.createElement('canvas'); c.width = c.height = cd; draw(c.getContext('2d'), cd / 2); return ctx.createPattern(c, 'repeat'); }
    function size() {
      var dpr = Math.min(devicePixelRatio || 1, 2), w = Math.round(card.clientWidth * dpr), h = Math.round(card.clientHeight * dpr);
      if (!w || !h || (w === W && h === H)) return;
      W = cv.width = w; H = cv.height = h;
      cd = Math.max(10, Math.round(PITCH * dpr)); cols = Math.ceil(W / cd); rows = Math.ceil(H / cd);
      src.width = cols; src.height = rows; data = sx.createImageData(cols, rows);
      pats = {
        // a lit LED: a disc 62% of the pitch with a soft edge
        dot: tile(cd, function (x, m) { var g = x.createRadialGradient(m, m, 0, m, m, cd * .32); g.addColorStop(0, '#fff'); g.addColorStop(.78, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, cd, cd); }),
        // the unlit panel: dark board, gray dots with a faint rim
        panel: tile(cd, function (x, m) { x.fillStyle = '#141617'; x.fillRect(0, 0, cd, cd); x.fillStyle = '#25292b'; x.beginPath(); x.arc(m, m, cd * .3, 0, 6.3); x.fill(); x.strokeStyle = 'rgba(255,255,255,.06)'; x.lineWidth = Math.max(1, cd * .03); x.beginPath(); x.arc(m, m - cd * .02, cd * .29, 3.6, 5.8); x.stroke(); }),
        // each LED cap catches a little light at its upper left
        sheen: tile(cd, function (x, m) { var g = x.createRadialGradient(m - cd * .1, m - cd * .11, 0, m - cd * .1, m - cd * .11, cd * .16); g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, cd, cd); })
      };
      draw(last);
    }
    function hue(h) {   // h in turns -> [r, g, b] at full saturation
      h = ((h % 1) + 1) % 1 * 6;
      var f = h - Math.floor(h), q = 1 - f, i = Math.floor(h);
      return [[1, f, 0], [q, 1, 0], [0, 1, f], [0, q, 1], [f, 0, 1], [1, 0, q]][i];
    }
    function draw(t) {
      if (!W) return;
      var d = data.data;
      for (var y = 0; y < rows; y++) {
        // dimmer toward the bottom, where the number sits
        var fall = 1 - .5 * Math.max(0, Math.min(1, (y / rows - .4) / .6));
        for (var x = 0; x < cols; x++) {
          var c = hue(x / cols * .85 + y / rows * .22 + t * .09), v = (.5 + .5 * Math.sin(x * .55 + y * .3 + t * 2.6)) * .75 + .25;
          var k = v * fall * 255, i = (y * cols + x) * 4;
          // a little white in the brightest cores, like a real LED
          var wv = Math.max(0, v - .8) * 1.6;
          d[i] = Math.min(255, (c[0] + wv) * k); d[i + 1] = Math.min(255, (c[1] * .92 + wv) * k); d[i + 2] = Math.min(255, (c[2] + wv) * k); d[i + 3] = 255;
        }
      }
      sx.putImageData(data, 0, 0);
      var fw = cols * cd, fh = rows * cd;
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'copy'; ctx.imageSmoothingEnabled = false;
      ctx.drawImage(src, 0, 0, fw, fh);
      ctx.globalCompositeOperation = 'destination-in'; ctx.fillStyle = pats.dot; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = pats.panel; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .3; ctx.imageSmoothingEnabled = true; ctx.drawImage(src, 0, 0, fw, fh);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.fillStyle = pats.sheen; ctx.fillRect(0, 0, W, H);
    }
    function loop(now) {
      raf = on && !paused ? requestAnimationFrame(loop) : 0;
      if (now - prev < 1000 / FPS - 4) return;
      // the wave's clock runs only while it draws, so it carries on from the frame a pause held
      last += Math.min(now - prev, 100) / 1000; prev = now; draw(last);
    }
    function run() { if (on && !paused && !raf) raf = requestAnimationFrame(loop); }
    if (window.ResizeObserver) new ResizeObserver(size).observe(card); else addEventListener('resize', size);
    size();
    if (REDUCED || !('IntersectionObserver' in window)) return;
    addEventListener('moomotion', run);
    new IntersectionObserver(function (e) {
      on = e[0].isIntersecting;
      run();
    }, { rootMargin: '100px' }).observe(card);
  })();

  /* ---------- frame colors ---------- */
  // the frame colors, in the order they are shown everywhere: Mint Glow, Sunset, Midnight, Moonlight
  var FRAMES = ['teal', 'orange', 'black', 'white'];
  var CBG = { teal: '#D5F8EF', orange: '#FFE7D6', black: '#E9FBF7', white: '#E3F2EE' };
  var MARK_FRAME = { teal: '#77EDD7', orange: '#FF7A21', black: '#17191C', white: '#FFFFFF' };
  function setHeroFrame(f) {
    $('#hero-bezel').dataset.frame = f;
    $('.hero .stage').dataset.frame = f;
    $$('.mark').forEach(function (m) { m.style.setProperty('--mark-frame', MARK_FRAME[f]); m.dataset.frame = f; });
    $$('.swatches .sw').forEach(function (s) { s.classList.toggle('on', s.dataset.frame === f); s.setAttribute('aria-checked', s.dataset.frame === f); });
    setRadioTabStop('.swatches .sw', f);
  }
  $$('.swatches .sw').forEach(function (s) {
    s.addEventListener('click', function (e) { e.stopPropagation(); setColor(FRAMES.indexOf(s.dataset.frame), true); pulse($('#hero-bezel')); });
  });
  bindRadioKeys('.swatches .sw');

  // Pick your frame: the four frames in a row, Mint Glow first. Picking a color (button, arrow keys, a tap on a frame
  // or a sideways swipe) slides the row straight to that frame; no scroll scrubbing. Each frame's live board is built
  // when the section comes near and runs at 30 fps (only the frames on screen draw)
  var colorsSec = $('#colors'), frameRow = $('.frames', colorsSec), track = $('.frames-track', colorsSec), slides = $$('.fslide', colorsSec);
  var colorIdx = -1, swiped = false;
  slides.forEach(function (sl) {
    var led = $('.led', sl);
    lazyBoard(led, { scenes: [led.dataset.scene], auto: false, fps: 30, weather: led.dataset.weather, onGlow: tileGlow(sl) }, colorsSec);
    sl.addEventListener('click', function () { if (!swiped) setColor(FRAMES.indexOf(sl.dataset.frame), true); });
  });
  function setColor(i, fromUser) {
    if (i < 0) return;
    var f = FRAMES[i];
    // the hero, the row and the 3d board all wear the frame last picked, whichever picker it came from
    if (fromUser) setHeroFrame(f);
    if (i === colorIdx) return; colorIdx = i;
    colorsSec.style.setProperty('--cbg', CBG[f]);
    colorsSec.dataset.frame = f;
    track.style.setProperty('--i', i);
    slides.forEach(function (sl) { sl.classList.toggle('on', sl.dataset.frame === f); });
    $$('.cp').forEach(function (c) { c.classList.toggle('on', c.dataset.frame === f); c.setAttribute('aria-checked', c.dataset.frame === f); });
    setRadioTabStop('.color-pick .cp', f);
    setRadioTabStop('.v-pick .cp', f);
    if (viewer) viewer.setFrame(f);
  }
  var viewer = null;
  $$('.cp').forEach(function (c) { c.addEventListener('click', function () { setColor(FRAMES.indexOf(c.dataset.frame), true); }); });
  bindRadioKeys('.color-pick .cp');
  bindRadioKeys('.v-pick .cp');
  setColor(0);
  // a sideways swipe or drag steps one frame (the row is touch-action: pan-y, so vertical drags still scroll the page)
  var swipeAt = null;
  frameRow.addEventListener('pointerdown', function (e) { swipeAt = [e.clientX, e.clientY]; swiped = false; });
  frameRow.addEventListener('pointercancel', function () { swipeAt = null; });
  frameRow.addEventListener('pointerup', function (e) {
    if (!swipeAt) return;
    var dx = e.clientX - swipeAt[0], dy = e.clientY - swipeAt[1]; swipeAt = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    swiped = true; setTimeout(function () { swiped = false; }, 0);
    setColor(Math.max(0, Math.min(FRAMES.length - 1, colorIdx + (dx < 0 ? 1 : -1))), true);
  });
  /* ---------- the board in 3D: js/viewer.mjs and three.js load only when the section is a viewport away ---------- */
  // Until then (and wherever WebGL or the import fails) the poster stands in. The LED face is a board.js board drawn
  // by the viewer itself: the Cover lyric view (album art, small clock, lyrics) of the song that's on, as on the board
  (function () {
    var sec = $('#viewer');
    if (!sec) return;
    var cv = $('.v-canvas', sec), spinBtn = $('.v-spin', sec), closeBtn = $('.v-close', sec), hint = $('.v-hint span', sec);
    if (TOUCH && hint) hint.textContent = 'Swipe to turn it';
    var started = false;
    // (a browser that has WebGL but can't make a context fails in the viewer's start and keeps the poster)
    function gl() { return !!window.WebGLRenderingContext; }
    function begin() {
      if (started) return; started = true;
      if (!gl() || params.has('static')) return;
      var led = new MB.Board(document.createElement('div'), { scenes: ['combo'], auto: false, external: true, minScale: 8, maxScale: 8, look: { crisp: true } });
      busy(import(new URL('js/viewer.mjs', document.baseURI).href).then(function (m) {
        return m.start({
          canvas: cv, led: led, frame: colorsSec.dataset.frame || 'teal', reduced: REDUCED, model: 'assets/3d/board.glb',
          onSpin: function (on) { spinBtn.setAttribute('aria-pressed', on); $('span', spinBtn).textContent = on ? 'Pause' : 'Spin'; spinBtn.setAttribute('aria-label', on ? 'Pause the spin' : 'Spin it'); },
          onClose: function (on) { spinBack = false; closeBtn.setAttribute('aria-pressed', on); },
          onTouch: function () { spinBack = false; sec.classList.add('v-touched'); }
        });
      }).then(function (v) {
        viewer = v; sec.classList.add('v-live');
        if (paused) spinMotion();
      }).catch(function (e) { sec.classList.add('v-failed'); if (window.console) console.warn('3D viewer:', e && e.message); }));
    }
    // a pause stops the spin, and play starts it again if the pause was what stopped it and nobody has moved it since
    var spinBack = false;
    function spinMotion() {
      if (!viewer) return;
      if (paused) { spinBack = viewer.spinning(); if (spinBack) viewer.setSpin(false); }
      else if (spinBack) { spinBack = false; viewer.setSpin(true); }
    }
    addEventListener('moomotion', spinMotion);
    // the arrow and zoom keys and a trackpad pinch move it without a touch or a close-up
    cv.addEventListener('keydown', function (e) { if (/^(Arrow|[-+=_]$)/.test(e.key)) spinBack = false; });
    cv.addEventListener('wheel', function (e) { if (e.ctrlKey) spinBack = false; }, { passive: true });
    spinBtn.addEventListener('click', function () { spinBack = false; if (viewer) viewer.setSpin(!viewer.spinning()); });
    closeBtn.addEventListener('click', function () { if (viewer) viewer.closeUp(!viewer.close()); });
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (e) {
        if (!e[0].isIntersecting) return;
        io.disconnect();
        if (document.readyState === 'complete') begin(); else addEventListener('load', begin);
      }, { rootMargin: '100% 0px' });
      io.observe(sec);
    } else begin();
  })();

  function pulse(el) {
    if (!ANIM) return;
    gsap.fromTo(el, { scale: .97 }, { scale: 1, duration: .6, ease: 'elastic.out(1, .5)' });
  }

  /* ---------- moo ---------- */
  var wiggleT = 0;
  function moo(from) {
    MB.boards.forEach(function (b) { if (b.visible) b.moo(); });
    $$('.mark').forEach(function (m) { m.classList.remove('wiggle'); void m.getBoundingClientRect(); m.classList.add('wiggle'); });
    clearTimeout(wiggleT); wiggleT = setTimeout(function () { $$('.mark').forEach(function (m) { m.classList.remove('wiggle'); }); }, 1000);
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
    if (!on || REDUCED || paused) { eyeDots().forEach(function (c) { c.style.fill = ''; }); return; }
    (function hop() {
      eyeDots().forEach(function (c) {
        c.style.fill = 'hsl(' + Math.floor(Math.random() * 360) + ', 95%, 55%)';
      });
      rainbowT = setTimeout(hop, 80 + Math.random() * 40);
    })();
  }
  addEventListener('moomotion', function () { if (loads) rainbow(true); });
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
  // pupils: each eye has one dark LED that looks toward the pointer, in any of the eight directions around the
  // eye's center (or straight ahead when the pointer is on the eye itself). It stays on the mark's 4-unit LED grid,
  // one step out, so the white ring of the eye always shows around it. Touch screens: it follows a finger, and
  // glances around on its own now and then.
  var PUPILS = $$('.mark .pupil').map(function (c) { return { el: c, cx: +c.getAttribute('cx'), cy: +c.getAttribute('cy'), at: '0,0' }; });
  function pupilTo(p, ox, oy) {
    var k = ox + ',' + oy;
    if (k === p.at) return;
    p.at = k; p.el.setAttribute('cx', p.cx + ox * 4); p.el.setAttribute('cy', p.cy + oy * 4);
  }
  function lookAt(x, y) {
    PUPILS.forEach(function (p) {
      var svg = p.el.ownerSVGElement, m = svg.getScreenCTM();
      if (!m) return;
      var r = svg.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return;
      // the eye's center on screen, and how far away the pointer is in LED steps
      var ex = m.a * p.cx + m.c * p.cy + m.e, ey = m.b * p.cx + m.d * p.cy + m.f, step = 4 * Math.hypot(m.a, m.b);
      var dx = x - ex, dy = y - ey;
      if (Math.hypot(dx, dy) < step * 2) return pupilTo(p, 0, 0);
      var s = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4;
      pupilTo(p, Math.round(Math.cos(s)), Math.round(Math.sin(s)));
    });
  }
  if (!REDUCED && PUPILS.length) {
    var eyeRaf = 0, eyeX = 0, eyeY = 0;
    var aim = function (x, y) {
      eyeX = x; eyeY = y;
      if (!eyeRaf) eyeRaf = requestAnimationFrame(function () { eyeRaf = 0; lookAt(eyeX, eyeY); });
    };
    if (matchMedia('(pointer: fine)').matches) addEventListener('pointermove', function (e) { aim(e.clientX, e.clientY); });
    else {
      var touchedAt = 0, glanceT = 0;
      var touch = function (x, y) { touchedAt = performance.now(); aim(x, y); };
      addEventListener('pointerdown', function (e) { touch(e.clientX, e.clientY); }, { passive: true });
      addEventListener('touchmove', function (e) { var t = e.touches[0]; if (t) touch(t.clientX, t.clientY); }, { passive: true });
      // idle: every few seconds both eyes glance somewhere (a side more often than up or down) or look back ahead
      var glance = function () {
        glanceT = setTimeout(glance, 1800 + Math.random() * 2600);
        if (document.hidden || paused || performance.now() - touchedAt < 2500) return;
        if (Math.random() < .4) { PUPILS.forEach(function (p) { pupilTo(p, 0, 0); }); return; }
        var dirs = [[1, 0], [-1, 0], [1, 0], [-1, 0], [1, -1], [-1, -1], [1, 1], [-1, 1], [0, -1], [0, 1]], d = dirs[Math.floor(Math.random() * dirs.length)];
        PUPILS.forEach(function (p) { pupilTo(p, d[0], d[1]); });
      };
      glanceT = setTimeout(glance, 2500);
    }
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
  var heldByMusic = false, lastTrack = null, swapT = 0;
  function musicUI(type) {
    var M = window.MooMusic; if (!M || !M.ready()) return;
    var tr = M.track(), playing = M.playing(), muted = M.muted(), audible = playing && !muted;
    player.classList.toggle('paused', !playing);
    plPlay.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    // the name stays sound and aria-pressed says whether it is on, so a screen reader hears the state, not the action
    plMute.classList.toggle('on', !muted); plMute.setAttribute('aria-pressed', !muted);
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
      // the card fades out and back in with the new song, as the radio is by then (a newer song cancels the wait)
      clearTimeout(swapT); swapT = 0;
      if (np.classList.contains('show') && !REDUCED) { np.classList.remove('show'); swapT = setTimeout(function () { swapT = 0; fill(); musicUI(); }, 380); }
      else fill();
    }
    if (!swapT) np.classList.toggle('show', playing && !!tr);
    // hidden, the card leaves the tab order and what a screen reader can reach
    np.inert = !np.classList.contains('show');
    if (audible && !heldByMusic) { heldByMusic = true; hero.hold('song'); $$('.chip', chips).forEach(function (c) { var on = c.dataset.scene === 'song'; c.classList.toggle('on', on); c.setAttribute('aria-pressed', on); }); }
    else if (!audible && heldByMusic) { heldByMusic = false; hero.release(); }
  }
  addEventListener('moomusic', function (e) { musicUI(e.detail.type); });
  function openSong(e) {
    var M = window.MooMusic, tr = M && M.track();
    if (!tr || !tr.link || !np.classList.contains('show') || (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ')) return;
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

  /* ---------- nav ---------- */
  // solid once the page has scrolled, with motion or without (the white wordmark needs it over the light sections)
  var nav = $('#nav');
  function navSolid() { nav.classList.toggle('solid', scrollY > 40); }
  addEventListener('scroll', navSolid, { passive: true });
  navSolid();

  /* ---------- motion ---------- */
  // the story board follows the scroll only once the sequences are in, so it never sets off before one that holds it
  var storyST = null, seqsIn = false, lastScene = 'combo';
  function storyScene(p) {
    if (!seqsIn) return;
    var sc = seqs.hero && seqs.hero.spec.screen ? 'combo' : p < .36 ? 'time' : p < .7 ? 'combo' : 'weather';
    if (sc !== lastScene) { lastScene = sc; story.go(sc); }
  }
  function initMotion() {
    gsap.registerPlugin(ST);
    // whatever is already on screen when motion starts (a deep link, a restored position) stays as it is
    var shown = $$('[data-reveal], .tile, #app-row li, .tag').filter(function (el) { var r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
    function unseen(el) { return shown.indexOf(el) < 0; }
    var lenis = null;
    if (window.Lenis && !TOUCH) {
      var appRow = $('#app-row');
      lenis = new window.Lenis({
        lerp: .1, smoothWheel: true,
        // a mostly sideways swipe over the apps strip scrolls the strip, not the page
        virtualScroll: function (e) { return !(Math.abs(e.deltaX) > Math.abs(e.deltaY) && appRow.contains(e.event.target)); }
      });
      lenis.on('scroll', ST.update);
      gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
      gsap.ticker.lagSmoothing(0);
    }
    function scrollTo(y) { if (lenis) lenis.scrollTo(y, { duration: 1.2 }); else window.scrollTo({ top: y, behavior: 'smooth' }); }
    $$('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var id = a.getAttribute('href'), t = $(id);
        // a click meant for a new tab or window stays the browser's
        if (!t || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault(); scrollTo(t.getBoundingClientRect().top + scrollY);
        // as a native jump would, the url names the section and the next tab starts from it
        if (location.hash !== id) history.pushState(null, '', id);
        if (!t.hasAttribute('tabindex')) t.tabIndex = -1;
        t.focus({ preventScroll: true });
      });
    });

    // nav: slides away on the way down, back on the way up
    var lastY = 0;
    ST.create({ start: 0, end: 'max', onUpdate: function (self) {
      var y = self.scroll();
      // (the last small steps of a smooth scroll keep it as it is)
      if (y > 400 && y > lastY + 2) nav.classList.add('hide');
      else if (y <= 400 || y < lastY - 2) nav.classList.remove('hide');
      lastY = y;
    } });

    // hero intro: "mood board" drops its d and becomes mooboard
    var d = $('.pun .d'), gap = $('.pun .gap'), intro = gsap.timeline({ delay: .15 });
    // the words rise in only while the head script still hides them (a load slower than 3 s shows them, then the d drops)
    if (root.classList.contains('intro')) {
      intro.from('.pun .w, .pun .d', { yPercent: 60, opacity: 0, duration: .9, stagger: .08, ease: 'back.out(1.8)' })
        .from('[data-hero]', { y: 40, opacity: 0, duration: 1, stagger: .1, ease: 'power3.out', clearProps: 'transform' }, '-=.5');
    }
    root.classList.remove('intro', 'intro-late');
    // the widths are read just before the drop, once the display font is in
    intro.call(function () { gsap.set([d, gap], { width: function (i, el) { return el.getBoundingClientRect().width; } }); }, null, 1.45)
      .to(d, { rotation: 38, duration: .35, ease: 'power1.inOut' }, 1.5)
      .to(d, { rotation: 8, duration: .25, ease: 'power1.inOut' })
      .to(d, { y: '120%', rotation: 70, opacity: 0, duration: .6, ease: 'power2.in' })
      .to([d, gap], { width: 0, duration: .55, ease: 'power3.inOut' }, '-=.35')
      .fromTo('.pun', { scale: 1 }, { scale: 1.04, duration: .18, yoyo: true, repeat: 1, ease: 'power1.inOut' }, '-=.1');

    // hero parallax + tilt
    gsap.to('.dotfield', { yPercent: 18, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
    // parallax lives on wrappers so it never fights the intro tweens on the same elements (that caused the board to jump)
    gsap.fromTo('.stage-par', { y: 0, scale: 1 }, { y: 60, scale: .95, ease: 'none', immediateRender: false, scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
    gsap.fromTo('.pun-par', { y: 0, opacity: 1 }, { y: -60, opacity: .2, ease: 'none', immediateRender: false, scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
    if (matchMedia('(pointer: fine)').matches) {
      var tilt = $('#hero-tilt');
      $('.hero').addEventListener('pointermove', function (e) {
        var x = e.clientX / innerWidth - .5, y = e.clientY / innerHeight - .5;
        tilt.style.transform = 'rotateY(' + (x * 10).toFixed(2) + 'deg) rotateX(' + (-y * 8).toFixed(2) + 'deg)';
      });
      $('.hero').addEventListener('pointerleave', function () { tilt.style.transform = ''; });
    }

    // story: pinned from the start, as deep links and restored positions count on its length
    var caps = $$('#story .cap'), bar = $('#story .progress i');
    gsap.set('#story .spin', { rotateX: 58, rotateZ: -10, scale: .8, y: 40 });
    var storyTl = gsap.timeline({
      scrollTrigger: {
        trigger: '#story', start: 'top top', end: '+=260%', pin: '#story .pin', scrub: .6,
        onUpdate: function (self) {
          var p = self.progress;
          if (seqs.hero) seqs.hero.set(p);
          bar.style.transform = 'scaleX(' + p.toFixed(3) + ')';
          storyScene(p);
        }
      }
    });
    storyST = storyTl.scrollTrigger;
    // the 3d board turns until a sequence takes its place (the fallback is hidden from then on)
    gsap.set('#story .spin', { transformOrigin: '64% 50%' });
    storyTl.to('#story .spin', { rotateX: 0, rotateZ: 0, scale: 1, y: 0, duration: .34, ease: 'power2.out' }, 0)
      .to('#story .spin', { scale: 2.3, duration: .2, ease: 'power2.inOut' }, .38)
      .to('#story .spin', { scale: 1, rotateY: -12, duration: .18, ease: 'power2.inOut' }, .6)
      .to('#story .spin', { rotateY: 10, rotateX: 6, scale: .94, duration: .22, ease: 'sine.inOut' }, .78);
    storyTl.to(caps[0], { opacity: 0, y: -30, duration: .08 }, .3)
      .fromTo(caps[1], { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: .08 }, .38)
      .to(caps[1], { opacity: 0, y: -30, duration: .08 }, .64)
      .fromTo(caps[2], { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: .08 }, .72)
      .to({}, { duration: .2 }, .8);

    $$('.card img').forEach(function (im) {
      gsap.to(im, { scale: 1, yPercent: 4, ease: 'none', scrollTrigger: { trigger: im.parentNode, start: 'top bottom', end: 'bottom top', scrub: true } });
    });

    // reveals
    $$('[data-reveal]').filter(unseen).forEach(function (el) {
      gsap.from(el, { y: 60, opacity: 0, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 88%' } });
    });
    var tiles = $$('.tile').filter(unseen), apps = $$('#app-row li').filter(unseen);
    if (tiles.length) {
      // the css hover transition stays off while gsap moves them, and the hover lift is theirs again once they land
      gsap.set(tiles, { y: 90, opacity: 0, rotate: function (i) { return i % 2 ? 2 : -2; }, transition: 'none' });
      ST.batch(tiles, {
        start: 'top 92%',
        onEnter: function (b) { gsap.to(b, { y: 0, opacity: 1, rotate: 0, duration: .9, stagger: .09, ease: 'back.out(1.4)', clearProps: 'transform,transition' }); }
      });
    }
    if (apps.length) gsap.from(apps, { y: 70, opacity: 0, rotate: function (i) { return i % 2 ? 8 : -8; }, duration: .8, stagger: .07, ease: 'back.out(1.7)', scrollTrigger: { trigger: '#app-row', start: 'top 88%' } });
    if (unseen($('.shows .big'))) gsap.from('.shows .big em', { x: 80, duration: 1.2, ease: 'power3.out', scrollTrigger: { trigger: '.shows .big', start: 'top 85%' } });

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
    if (unseen($('.tag'))) gsap.from('.tag', { scale: 0, duration: .8, ease: 'back.out(2.5)', scrollTrigger: { trigger: '.wl-price', start: 'top 85%' } });
    gsap.from('.foot-mark', { y: 40, rotate: -15, duration: 1, ease: 'elastic.out(1, .5)', scrollTrigger: { trigger: '.foot', start: 'top 95%' } });
  }

  // the story's sequence joins once it has loaded
  function attachStory() {
    var storySeq = seqs.hero, scr = storySeq && storySeq.spec.screen;
    seqsIn = true;
    if (scr) {
      // the live board takes over the rendered LED face once the camera settles
      var live = $('#story .seq-live');
      live.appendChild($('#story-board'));
      // hidden, as .seq-live starts in css, until a frame shows it (a landing past the story starts it at the end)
      storyLive = 0;
      var liveBox = '';
      storySeq.onDraw = function (j) {
        var r = storySeq.rect, q = scr.rect, box = r.x + '|' + r.y + '|' + r.w + '|' + r.h;
        if (box !== liveBox) {
          // the box only moves on resize; writing it every frame would relayout the live board mid-scrub
          liveBox = box;
          live.style.left = (r.x + q[0] * r.w) + 'px'; live.style.top = (r.y + q[1] * r.h) + 'px';
          live.style.width = ((q[2] - q[0]) * r.w) + 'px'; live.style.height = ((q[3] - q[1]) * r.h) + 'px';
        }
        // over the render's own LED text from the frame the camera settles (manifest screen.from), faded in over 4
        // frames; written only when it changes, and the board stops drawing while it is hidden
        var op = Math.max(0, Math.min(1, (j - scr.from + 2) / 4));
        if (op !== storyLive) { storyLive = op; live.style.opacity = op; }
      };
    }
    if (storySeq && storyST) storySeq.set(storyST.progress);
    if (storySeq) storySeq.redraw();
    if (storyST) storyScene(storyST.progress);
  }

  if (ANIM) {
    try { initMotion(); } catch (e) { root.classList.add('no-anim'); root.classList.remove('intro', 'intro-late'); setTimeout(function () { throw e; }); }
  }
  busy(Promise.all([
    new Promise(function (res) { if (document.readyState === 'complete') res(); else addEventListener('load', res); }),
    document.fonts ? document.fonts.ready : null
  ]));
  var boot = busy(ANIM && window.MooSeq ? window.MooSeq.load().then(function (s) { seqs = s; }) : Promise.resolve());
  // with a sequence or without, the story board follows the scroll from here
  boot.then(attachStory, attachStory);
  boot.then(function () {
    if (ANIM && params.has('y')) setTimeout(function () { window.scrollTo(0, +params.get('y')); ST.update(); }, 300);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (ST) ST.refresh(); });
    // draw each sequence's current frame once layout has settled
    requestAnimationFrame(function () { Object.keys(seqs).forEach(function (k) { seqs[k].redraw(); }); });
  });
})();
