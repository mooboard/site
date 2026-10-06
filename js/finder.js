/* mooboard.co/hi and mooboard.co/portal + finds the boards on this phone network through api.mooboard.co and opens one + the page path picks what it does */
(function () {
  'use strict';
  var API = 'https://api.mooboard.co';
  var ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // the label's: no 0/O, no 1/I/L
  var INK = '#0E1A22';
  var TIMEOUT_MS = 6000;
  var AUTO_GO_MS = 3000;
  var TICK_MS = 100;   // the panel's startup card gives the pupils a new colour every 100 ms
  var PORTAL_GO_MS = 1500;          // how long the portal says it is opening the board it remembers
  var MINE = 'mooboard.portal';     // where the portal keeps the board it opened last
  var view = document.getElementById('view');
  var start = route(location.pathname);
  var onPortal = start.kind === 'portal';
  var pupils = [document.getElementById('pl'), document.getElementById('pr')];
  var rainbow = null;
  var autoGo = null;
  var top = document.getElementById('top');
  var hero = document.getElementById('hero');
  // each frame as boards name it + the site frame attribute and its name there
  var FRAMES = { midnight: ['black', 'Midnight'], moonlight: ['white', 'Moonlight'], sunset: ['orange', 'Sunset'], mint: ['teal', 'Mint Glow'], red: ['red', 'Red'] };
  var BOARD_JS = '/js/board.js';
  var mooBoard = null;     // the board js api once it is in
  var waiting = null;      // what waits for it
  var noBoardJs = false;   // it failed so the frames keep dark panels
  var unlit = [];          // panels shown and not drawn yet
  var screen = 0;          // counts views so a late answer for a view that is gone does nothing
  var installPrompt = null;   // the browser install prompt where it offers one
  var installOn = false;      // whether this view waits for a tap and may offer the install
  var retry = null;           // the last list or lookup the page asked for + try again asks for it again

  function validCode(c) {
    if (typeof c !== 'string' || c.length !== 4) return false;
    for (var i = 0; i < 4; i++) if (ALPHABET.indexOf(c.charAt(i)) < 0) return false;
    return true;
  }

  // 10/8, 172.16/12 or 192.168/16, written plainly: the only kind of address this page will send anyone to.
  function privateIPv4(s) {
    var m = typeof s === 'string' && /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/.exec(s);
    if (!m) return false;
    var o = [+m[1], +m[2], +m[3], +m[4]];
    if (o[0] > 255 || o[1] > 255 || o[2] > 255 || o[3] > 255) return false;
    return o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168);
  }

  // A board's code (/hi/5KAS, /wall/5kas/, a bare /5KAS ...), the boards near you (/hi), an older word that now
  // means /hi, or nothing.
  function route(pathname) {
    var path = String(pathname).replace(/\/index\.html$/, '/');
    if (/^\/portal\/?$/i.test(path)) return { kind: 'portal' };   // the everyday way in
    var m = /^\/(?:(?:hi|hello|wall|my|moo|go|open)\/)?([A-Za-z0-9]{4})\/?$/i.exec(path);
    if (m && validCode(m[1].toUpperCase())) return { kind: 'code', code: m[1].toUpperCase() };
    var w = /^\/(hi|hello|wall|my|moo|go|open)\/?$/i.exec(path);
    if (w) return w[1].toLowerCase() === 'hi' ? { kind: 'nearby' } : { kind: 'toHi' };
    return { kind: 'missing' };
  }

  // The loading cow: a random full hue in each pupil every tick, as on the panel, and black again once settled.
  function tick() {
    for (var i = 0; i < pupils.length; i++) {
      if (pupils[i]) pupils[i].setAttribute('fill', 'hsl(' + Math.floor(Math.random() * 360) + ',100%,50%)');
    }
  }
  function spin(on) {
    if (rainbow !== null) clearInterval(rainbow);
    rainbow = null;
    if (on) {
      tick();
      rainbow = setInterval(tick, TICK_MS);
      return;
    }
    for (var i = 0; i < pupils.length; i++) if (pupils[i]) pupils[i].setAttribute('fill', INK);
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function link(cls, text, href) {
    var a = el('a', cls, text);
    a.setAttribute('href', href);
    return a;
  }
  function button(cls, text, onClick) {
    var b = el('button', cls, text);
    b.setAttribute('type', 'button');
    b.addEventListener('click', onClick);
    return b;
  }
  function show(nodes, board) {
    screen++;
    if (autoGo !== null) clearTimeout(autoGo);
    autoGo = null;
    view.textContent = '';
    for (var i = 0; i < nodes.length; i++) view.appendChild(nodes[i]);
    // focus moves to the new heading so keyboard and screen reader users carry on from there
    nodes[0].setAttribute('tabindex', '-1');
    nodes[0].focus();
    setTop(board || null);
    lightUp();
    offerInstall(false);
  }
  // fn runs on the next key pressed anywhere + once
  function onKey(fn) {
    document.addEventListener('keydown', function hold() {
      document.removeEventListener('keydown', hold);
      fn();
    });
  }
  function guide() {
    var p = el('p', 'foot');
    p.appendChild(link('sub', 'Setup guide', 'https://mooboard.co/guide'));
    return p;
  }
  // the home network line with its question bold on a line of its own + a guest one never splits
  function sameNetwork(lead) {
    var p = el('p', 'hint');
    p.appendChild(el('b', '', lead));
    p.appendChild(document.createTextNode(' Your phone and mooboard need to be on the same home network, not a\u00a0guest\u00a0one.'));
    return p;
  }
  function isFrame(c) {
    return typeof c === 'string' && Object.prototype.hasOwnProperty.call(FRAMES, c);
  }
  // a board in its own frame + midnight when the api names none or one it does not know
  function frameOf(c) {
    return FRAMES[isFrame(c) ? c : 'midnight'];
  }
  // fn gets the board js api + it loads the first time a board is shown and never again after a failure
  function withBoards(fn) {
    if (mooBoard) {
      fn(mooBoard);
      return;
    }
    if (noBoardJs) return;
    if (waiting) {
      waiting.push(fn);
      return;
    }
    waiting = [fn];
    var s = document.createElement('script');
    s.src = BOARD_JS;
    s.onload = function () {
      var jobs = waiting || [];
      waiting = null;
      mooBoard = window.MooBoard && window.MooBoard.Board ? window.MooBoard : null;
      if (!mooBoard) {
        noBoardJs = true;
        return;
      }
      for (var i = 0; i < jobs.length; i++) jobs[i](mooBoard);
    };
    s.onerror = function () {
      waiting = null;
      noBoardJs = true;
    };
    document.head.appendChild(s);
  }
  // a small mooboard in its own frame + its panel lights up with the startup card cow once board js is in
  function mooboard(color) {
    var bz = el('span', 'bezel');
    bz.setAttribute('data-frame', frameOf(color)[0]);
    var led = el('span', 'led');
    bz.appendChild(led);
    unlit.push(led);
    return bz;
  }
  // draws the panels just shown + skips any the page has moved on from
  function lightUp() {
    if (!unlit.length) return;
    var leds = unlit;
    unlit = [];
    withBoards(function (mb) {
      var scene = mb.scenes && mb.scenes.mark ? 'mark' : 'moo';   // an older cached copy has no mark scene
      for (var i = 0; i < leds.length; i++) {
        if (leds[i].isConnected !== false) new mb.Board(leds[i], { scenes: [scene], auto: false, fps: 15 });
      }
    });
  }
  // the top shows the board a page is about in its own frame + else the cow
  function setTop(board) {
    hero.textContent = '';
    if (!board) {
      top.className = 'top';
      return;
    }
    var b = mooboard(board.frameColor);
    b.setAttribute('role', 'img');
    b.setAttribute('aria-label', (board.name ? board.name + ', ' : '') + 'a ' + frameOf(board.frameColor)[1] + ' mooboard');
    hero.appendChild(b);
    top.className = 'top lit';
  }
  // one board as a mini mooboard in its own frame + its name big and its code small + names go in as text never as markup
  function card(board, onClick) {
    var c = button('card', undefined, onClick);
    var mini = el('span', 'mini');
    mini.setAttribute('aria-hidden', 'true');
    mini.appendChild(mooboard(board.frameColor));
    c.appendChild(mini);
    var who = el('span', 'who');
    who.appendChild(el('b', '', board.name));
    if (validCode(board.code)) who.appendChild(el('small', '', board.code));
    c.appendChild(who);
    return c;
  }
  // The boards' cards, each with its Identify button beside it when `identify` makes one.
  function cards(boards, onPick, identify) {
    var list = el('div', 'cards');
    boards.forEach(function (b) {
      var c = card(b, function () { onPick(b); });
      if (identify) {
        var r = el('div', 'row');
        r.appendChild(c);
        r.appendChild(identify(b));
        list.appendChild(r);
      } else {
        list.appendChild(c);
      }
    });
    return list;
  }

  // Identify: the board flashes its light and its cow moos, on its own page in a new tab (an https page cannot
  // fetch a board's http address). A real link when the address is known, so no popup blocker stands in the way.
  function identifyLink(board) {
    var a = link('ident', 'Identify', 'http://' + board.localIp + '/identify');
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
    a.setAttribute('aria-label', 'Identify ' + board.name);
    return a;
  }

  // On a shared connection the address comes from /lookup after the tap, so the tab is opened in the tap itself
  // (a tab opened later would be blocked) and sent to the board once the address is in.
  function identifyButton(board, boards) {
    var b = button('ident', 'Identify', function () { identifyShared(board, boards); });
    b.setAttribute('aria-label', 'Identify ' + board.name);
    return b;
  }

  function identifyShared(board, boards) {
    var tab = window.open('', '_blank');
    if (tab) {
      try { tab.opener = null; } catch (e) { /* a tab that will not let go of us is still a tab */ }
    }
    function fail() {
      if (tab) {
        try { tab.close(); } catch (e) { /* already gone */ }
      }
      showShared(boards, board);
    }
    getJSON('/lookup/' + board.code).then(function (data) {
      if (!data || data.found !== true || !privateIPv4(data.localIp)) return fail();
      var url = 'http://' + data.localIp + '/identify';
      if (tab) tab.location.href = url;
      else location.href = url;   // no new tab allowed: this one, and the board's page links back to the list
    }, fail);
  }

  function getJSON(path) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = null;
    // the timer gives up by itself too where nothing can abort a fetch
    var late = new Promise(function (resolve, reject) {
      timer = setTimeout(function () {
        if (ctrl) ctrl.abort();
        reject(new Error('timeout'));
      }, TIMEOUT_MS);
    });
    var opts = { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' };
    if (ctrl) opts.signal = ctrl.signal;
    var got = fetch(API + path, opts).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
    return Promise.race([got, late])
      .then(function (data) {
        clearTimeout(timer);
        return data;
      }, function (err) {
        clearTimeout(timer);
        throw err;
      });
  }

  function go(ip, name, color, code) {
    if (!privateIPv4(ip)) return showNone();
    remember(code, name, color);
    show([el('h1', '', 'Opening ' + (name || 'your mooboard') + '…'), sameNetwork('Didn\u2019t open?')], { name: name, frameColor: color });
    spin(false);
    location.replace('http://' + ip + '/');
  }

  function showLoading(title) {
    show([el('h1', '', title), el('p', '', 'One moment.')]);
    spin(true);
  }

  // A new board is on nobody's network yet: its setup screen shows its own Wi-Fi (a Wi-Fi QR once the setup flow ships, the name and password today).
  function setupSteps() {
    var box = el('section', 'setup');
    box.appendChild(el('h2', '', 'Setting up a new mooboard?'));
    var ol = el('ol');
    ol.appendChild(el('li', '', 'Plug it in. Its screen shows how to join its own Wi-Fi.'));
    ol.appendChild(el('li', '', 'Scan the code with your phone\u2019s camera, or join mooboard-XXXX with the password shown.'));
    ol.appendChild(el('li', '', 'The setup page opens. Pick your home Wi-Fi.'));
    var back = el('li', '', 'Come back to ');
    back.appendChild(link('', 'mooboard.co/hi', '/hi/'));
    back.appendChild(document.createTextNode('.'));
    ol.appendChild(back);
    box.appendChild(ol);
    return box;
  }

  function showNone() {
    spin(false);
    show([
      el('h1', '', 'Open this on the same Wi-Fi as your mooboard'),
      el('p', '', 'Connect this phone to your home Wi-Fi, then open the link again.'),
      link('btn', 'Try mooboard.local', 'http://mooboard.local'),
      el('p', 'quiet', 'A VPN or iCloud Private Relay can hide that you are home. Turn it off for your home Wi-Fi, or tap the button above.'),
      button('link', 'Try again', again),
      setupSteps(),
      guide()
    ]);
    offerInstall(true);
  }

  // the api did not answer + offline or busy or too slow + which says nothing about the wifi
  function showDown() {
    spin(false);
    show([
      el('h1', '', 'Could not reach mooboard.co'),
      el('p', '', 'This phone may be offline, or mooboard.co is busy. Try again in a moment.'),
      button('btn', 'Try again', again),
      link('link', 'Try mooboard.local', 'http://mooboard.local'),
      guide()
    ]);
  }
  // asks for the last list or lookup again
  function again() {
    if (retry) retry();
  }

  function showMissing() {
    spin(false);
    show([el('h1', '', 'Page not found'), el('p', '', 'There is nothing at this address.'), link('btn', 'Go to mooboard.co', '/')]);
  }

  // Exactly one board: say so, and open it after a moment unless "Stay here" is tapped.
  function showOne(board) {
    spin(false);
    show([
      el('h1', '', 'Opening ' + board.name + '…'),
      cards([board], function (b) { go(b.localIp, b.name, b.frameColor, b.code); }),
      button('link', 'Stay here', function () { showPicked(board); }),
      sameNetwork('Didn\u2019t open?')
    ], board);
    autoGo = setTimeout(function () {
      autoGo = null;
      go(board.localIp, board.name, board.frameColor, board.code);
    }, AUTO_GO_MS);
    var here = screen;
    // a key pressed before it opens means stay so keyboard users get to choose
    onKey(function () {
      if (here === screen) showPicked(board);
    });
  }

  function showPicked(board) {
    spin(false);
    show([
      el('h1', '', 'mooboard'),
      el('p', '', 'Tap it to open it.'),
      cards([board], function (b) { go(b.localIp, b.name, b.frameColor, b.code); }),
      sameNetwork('Don\u2019t see your board?'),
      guide()
    ], board);
    offerInstall(true);
  }

  // Several boards: tap one to open it, or Identify it to see which board on the wall it is.
  function showList(boards) {
    spin(false);
    show([
      el('h1', '', 'Pick your mooboard'),
      el('p', '', 'Tap a board to open it.'),
      cards(boards, function (b) { go(b.localIp, b.name, b.frameColor, b.code); }, identifyLink),
      sameNetwork('Don\u2019t see your board?'),
      guide()
    ]);
    offerInstall(true);
  }

  // A shared internet connection (apartments, dorms): the list has no addresses. A tap asks for that board by its
  // code and opens it, and Identify finds out first whether it is the one on your wall.
  // missed names a board that did not answer + the list stays so another can be picked
  function showShared(boards, missed) {
    spin(false);
    show([
      el('h1', '', missed ? 'Could not reach ' + missed.name : 'Pick your mooboard'),
      el('p', '', missed ? 'Try again in a moment, or pick another board.' : 'This internet connection is shared.'),
      cards(boards, function (b) { openShared(b, boards); }, function (b) { return identifyButton(b, boards); }),
      sameNetwork('Don\u2019t see your board?'),
      guide()
    ]);
    offerInstall(true);
  }

  function openShared(board, boards) {
    function fail() { showShared(boards, board); }
    showLoading('Finding ' + board.name);
    getJSON('/lookup/' + board.code).then(function (data) {
      if (!data || data.found !== true || !privateIPv4(data.localIp)) return fail();
      go(data.localIp, typeof data.name === 'string' && data.name !== '' ? data.name : board.name, isFrame(data.frameColor) ? data.frameColor : board.frameColor, board.code);
    }, fail);
  }

  // the boards on this network + pick shows one board to tap rather than opening it
  function nearby(pick) {
    retry = function () { nearby(pick); };
    showLoading('Looking for your mooboard');
    getJSON('/nearby').then(function (data) {
      var list = data && Array.isArray(data.boards) ? data.boards : [];
      var named = list.filter(function (b) { return b && typeof b.name === 'string' && b.name !== ''; });
      if (data && data.shared === true) {
        var shared = named.filter(function (b) { return validCode(b.code); });
        return shared.length ? showShared(shared) : showNone();
      }
      var boards = named.filter(function (b) { return privateIPv4(b.localIp); });
      if (boards.length === 0) return showNone();
      if (boards.length === 1) return pick ? showPicked(boards[0]) : showOne(boards[0]);
      showList(boards);
    }, showDown);
  }

  // the board the portal opened last + its code and name and frame but never its address
  function remembered() {
    try {
      var b = JSON.parse(localStorage.getItem(MINE));
      return b && validCode(b.code) ? { code: b.code, name: typeof b.name === 'string' ? b.name : '', frameColor: b.frameColor } : null;
    } catch (e) {
      return null;
    }
  }
  function remember(code, name, color) {
    if (!onPortal || !validCode(code)) return;
    try {
      localStorage.setItem(MINE, JSON.stringify({ code: code, name: name || '', frameColor: isFrame(color) ? color : '' }));
    } catch (e) { /* a browser with no storage opens the list next time */ }
  }

  // the portal opens the board it remembers after a moment + pick another lists the boards instead
  function portal() {
    var mine = remembered();
    if (!mine) return nearby();
    spin(false);
    show([
      el('h1', '', 'Opening ' + (mine.name || 'your mooboard') + '…'),
      button('link', 'Pick another', function () { nearby(true); }),
      sameNetwork('Didn\u2019t open?')
    ], mine);
    var here = screen, found = null, due = false;
    var open = function () { go(found.localIp, found.name, found.frameColor, mine.code); };
    // a key pressed before it opens means pick so keyboard users get to choose
    onKey(function () {
      if (here === screen) nearby(true);
    });
    autoGo = setTimeout(function () {
      autoGo = null;
      due = true;
      if (found) open();
    }, PORTAL_GO_MS);
    getJSON('/lookup/' + mine.code).then(function (data) {
      if (here !== screen) return;
      if (!data || data.found !== true || !privateIPv4(data.localIp)) return nearby();
      found = {
        localIp: data.localIp,
        name: typeof data.name === 'string' && data.name !== '' ? data.name : mine.name,
        frameColor: isFrame(data.frameColor) ? data.frameColor : mine.frameColor
      };
      if (due) open();
    }, function () {
      if (here === screen) nearby();
    });
  }

  // add to home screen + where the browser offers its prompt a button and on an iphone the share steps + nothing once installed
  function installed() {
    try {
      return navigator.standalone === true || !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    } catch (e) {
      return false;
    }
  }
  function onIPhone() {
    return /iPhone|iPad|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function offerInstall(on) {
    installOn = on;
    renderInstall();
  }
  function renderInstall() {
    var box = document.getElementById('install');
    if (!box) return;
    box.textContent = '';
    if (!installOn || !onPortal || installed()) return;
    if (installPrompt) {
      box.appendChild(button('add', 'Add to home screen', function () {
        var p = installPrompt;
        installPrompt = null;
        renderInstall();
        try {
          p.prompt();
        } catch (e) { /* the browser took the prompt back */ }
      }));
      return;
    }
    if (onIPhone()) box.appendChild(shareSteps());
  }
  function shareSteps() {
    var p = el('p', 'steps');
    p.appendChild(el('b', '', 'Add mooboard to your Home Screen'));
    p.appendChild(document.createTextNode('Tap '));
    p.appendChild(shareIcon());
    p.appendChild(document.createTextNode(' Share, then Add to Home Screen.'));
    return p;
  }
  // the share icon as safari draws it + a box with an arrow up out of it
  function shareIcon() {
    var NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), path = document.createElementNS(NS, 'path');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'share');
    svg.setAttribute('aria-hidden', 'true');
    path.setAttribute('d', 'M12 3v12M8 7l4-4 4 4M8 10H6v11h12V10h-2');
    svg.appendChild(path);
    return svg;
  }

  // A printed link: straight to that board when this phone is on its network.
  function direct(code) {
    retry = function () { direct(code); };
    showLoading('Finding your mooboard');
    getJSON('/lookup/' + code).then(function (data) {
      if (data && data.found === true && privateIPv4(data.localIp)) {
        return go(data.localIp, typeof data.name === 'string' && data.name !== '' ? data.name : '', data.frameColor, code);
      }
      showNone();
    }, showDown);
  }

  if (onPortal) {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      installPrompt = e;
      renderInstall();
    });
    window.addEventListener('appinstalled', function () {
      installPrompt = null;
      renderInstall();
    });
    // the service worker that lets the portal install + it waits for the page to finish loading
    window.addEventListener('load', function () {
      if (navigator.serviceWorker) navigator.serviceWorker.register('/portal/sw.js').catch(function () {});
    });
    portal();
  }
  else if (start.kind === 'code') direct(start.code);
  else if (start.kind === 'nearby') nearby();
  else if (start.kind === 'toHi') location.replace('/hi/');
  else showMissing();
})();
