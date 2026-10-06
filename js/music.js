/* MooBoard radio.
   Reads music/radio.json (made by tools/make-radio.py): five songs played as Apple Music's 30 s previews, each fading
   in and crossfading into the next like a radio station. The site hosts no audio and no lyrics: previews stream from
   Apple, synced lyrics come from lrclib.net and stay in this browser's localStorage after the first visit.
   Starts playing on load but muted: the lyrics run on the board from the first second, sound comes on only when the
   visitor unmutes. A song whose preview won't play here is skipped. If the radio can't load, or none of its previews
   play, the archived placeholder songs (music/archive/, all original, played live through Web Audio from their
   "synth" block) play instead. */
(function () {
  'use strict';

  var list = [], idx = 0, playing = false, muted = true, startAt = 0, pausedPos = 0, ready = false;
  var timings = {}, audioEl = null, live = false, els = {}, XF = 2.2;
  var ac = null, bus = null, noiseBuf = null, gen = 0, timer = 0, events = null, evI = 0;

  function emit(type) { window.dispatchEvent(new CustomEvent('moomusic', { detail: { type: type } })); }
  function track() { return list[idx]; }
  function length() {
    var t = track();
    if (t && t.src && live && audioEl.duration) return audioEl.duration;
    return t ? (t.synth && t.synth.length) || (timings[t.id] && timings[t.id].length) || (t.src ? 30 : 25) : 25;
  }
  // The media clock. An audio element's currentTime moves in steps a few audio buffers long: on Chrome it reads up to
  // ~40 ms behind the sound it is sending out. Every reading is behind the true clock, never ahead, so the clock is the
  // upper envelope of the readings over the last half second, run on from there by the frame clock.
  var env = [], envEl = null;
  function mediaPos() {
    var a = audioEl, now = performance.now(), ct = a.currentTime;
    if (a !== envEl || a.paused || a.seeking || a.readyState < 3) { env.length = 0; envEl = a; return ct; }
    env.push([now, ct * 1000 - now * (a.playbackRate || 1)]);
    while (env.length > 2 && now - env[0][0] > 500) env.shift();
    var off = -1e15;
    for (var i = 0; i < env.length; i++) off = Math.max(off, env[i][1]);
    var p = (off + now * (a.playbackRate || 1)) / 1000;
    return p - ct > .12 ? ct : p;   // a stall or a seek: trust the reading
  }
  function pos() {
    var t = track();
    // muted, or while a preview is still starting, the radio runs on the clock
    if (t && t.src && live) return mediaPos();
    return playing ? (performance.now() - startAt) / 1000 : pausedPos;
  }
  // Where the lyrics are. Ahead of the media clock by LEAD: measured on these five previews (2026-10-06), the site's
  // word times (Whisper's onsets) sit a median 200 ms after the LRC's line times; with the sweep's own pre-roll (a
  // word's first column lights a sixth of the way through it, about 50 ms) a 150 ms lead puts the first word of a line
  // alight about when the LRC says the line starts, and a frame's drawing is in it. And behind it by the output's
  // latency while the sound is on: what the visitor hears left the element that long ago (none while muted).
  var LEAD = .15, outLatency = 0;
  function readLatency() {
    if (!ac) return;
    var l = (ac.outputLatency || 0) + (ac.baseLatency || 0);
    if (l >= 0 && l < 1) outLatency = l;
  }
  setInterval(function () { if (!muted) readLatency(); }, 5000);
  function lyricPos() { return pos() + LEAD - (muted ? 0 : outLatency); }

  /* ---------- radio lyrics: lrclib.net LRC, shifted onto the preview, words placed on Whisper's onsets ---------- */
  var LRC_API = 'https://lrclib.net/api/get/';
  function lrcText(id) {
    var key = 'moo-lrc-' + id;
    try { var c = localStorage.getItem(key); if (c) return Promise.resolve(c); } catch (e) { /* storage blocked */ }
    return fetch(LRC_API + id).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (j) {
      var s = j && j.syncedLyrics;
      if (s) try { localStorage.setItem(key, s); } catch (e) { /* storage full or blocked */ }
      return s || null;
    });
  }
  function radioTiming(t, lrc) {
    var raw = [], len = 30;
    lrc.split(/\r\n|\r|\n/).forEach(function (s) {
      // a line can carry several times (a repeated chorus) and word times, which the onsets stand in for
      var m, at = [], re = /^\s*\[(\d+):(\d+(?:\.\d+)?)\]/;
      while ((m = re.exec(s))) { at.push(+m[1] * 60 + +m[2] - t.at); s = s.slice(m[0].length); }
      s = s.replace(/<\d+:\d+(?:\.\d+)?>/g, '').replace(/\s+/g, ' ').trim();
      at.forEach(function (t0) { raw.push({ t0: t0, text: s }); });
    });
    raw.sort(function (a, b) { return a.t0 - b.t0; });
    raw.forEach(function (l, i) { l.t1 = raw[i + 1] ? raw[i + 1].t0 : l.t0 + 5; });
    var on = t.onsets || [], oi = 0, L = [];
    raw.forEach(function (l) {
      if (!l.text || l.t0 < -.5 || l.t0 >= len - .5) return;
      var parts = l.text.split(/\s+/), n = parts.length, got = [];
      while (oi < on.length && on[oi] < l.t0 - .6) oi++;
      while (oi < on.length && on[oi] < l.t1 - .15 && got.length < n) got.push(on[oi++]);
      while (oi < on.length && on[oi] < l.t1 - .15) oi++; // extra onsets Whisper split out of one word
      // words Whisper didn't catch share what's left of the line after the last one it did
      var had = got.length, from = had ? got[had - 1] : l.t0, rest = n - had, step = Math.min(.42, (l.t1 - from) / (rest + 1));
      for (var k = 0; k < rest; k++) got.push(from + step * (had ? k + 1 : k));
      var words = parts.map(function (w, k) { return { text: w, t0: got[k] }; });
      words.forEach(function (w, k) { w.t1 = words[k + 1] ? words[k + 1].t0 : Math.min(l.t1, w.t0 + .7); });
      // the line comes up at its LRC time where that is earlier than its first word (as the board does with a timed
      // sheet), but never before the line before it has started its last word
      var prevW = L.length ? L[L.length - 1].words : null, floor = prevW ? prevW[prevW.length - 1].t0 + .2 : -1e9;
      L.push({ text: l.text, words: words, t0: Math.max(floor, Math.min(l.t0, words[0].t0)), t1: l.t1 });
    });
    L.forEach(function (l, i) { if (L[i + 1]) l.t1 = Math.min(l.t1, L[i + 1].t0); });
    return { title: t.title, artist: t.artist, length: len, lines: L };
  }

  /* ---------- lyrics timing ---------- */
  function loadTiming(t) {
    if (t && t.lrclib && !timings[t.id]) {
      var lrc = t._lrc || (t._lrc = lrcText(t.lrclib));
      return lrc.then(function (s) {
        // only for a song still on the list: the archive reuses the radio's ids
        return s && list.indexOf(t) >= 0 ? (timings[t.id] = radioTiming(t, s)) : null;
      }).catch(function () { if (t._lrc === lrc) t._lrc = null; return null; });   // a failed fetch is tried again next time
    }
    if (!t || !t.lyrics || timings[t.id]) return Promise.resolve(timings[t && t.id]);
    // one fetch per song, also while it is still on its way
    return t._tm || (t._tm = fetch(t.lyrics).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j) return null;
        // Prayer-style timings: lines[].en (or .text) holds the words, words[] carry t0/t1 in seconds
        var off = (j.offsetMs || 0) / 1000, L = (j.lines || []).filter(function (l) { return l.words && l.words.length; });
        L.forEach(function (l, i) {
          var parts = String(l.en || l.text || '').split(/\s+/);
          l.words.forEach(function (w, k) { w.text = w.text || w.w || parts[k] || ''; w.t0 += off; w.t1 += off; });
          l.text = l.words.map(function (w) { return w.text; }).join(' ');
          l.t0 = l.words[0].t0;
        });
        L.forEach(function (l, i) { l.t1 = L[i + 1] ? L[i + 1].t0 : l.words[l.words.length - 1].t1 + .6; });
        j.lines = L;
        timings[t.id] = j; return j;
      }).catch(function () { t._tm = null; return null; }));
  }

  /* ---------- Web Audio placeholder synth ---------- */
  function ensureAudio() {
    if (ac) { if (ac.state === 'suspended' && !document.hidden) ac.resume(); return true; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ac = new AC();
    var comp = ac.createDynamicsCompressor(); comp.connect(ac.destination);
    ac.out = comp;
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    var d = noiseBuf.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }
  function hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function tone(o) {
    var at = o.at, osc = ac.createOscillator(), g = ac.createGain(), last = g;
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.from ? hz(o.from) : o.f, at);
    if (o.from) osc.frequency.exponentialRampToValueAtTime(o.f, at + .06);
    if (o.drop) osc.frequency.exponentialRampToValueAtTime(o.drop, at + o.dur);
    if (o.vib) { var l = ac.createOscillator(), lg = ac.createGain(); l.frequency.value = 5.5; lg.gain.value = o.f * .008; l.connect(lg); lg.connect(osc.frequency); l.start(at); l.stop(at + o.dur + .2); }
    if (o.lp) { var f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; osc.connect(f); f.connect(g); } else osc.connect(g);
    var v = o.vol, a = o.attack || .008;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(v, at + a);
    g.gain.setTargetAtTime(v * (o.sustain == null ? .6 : o.sustain), at + a + .02, o.decay || .09);
    g.gain.setTargetAtTime(0, at + o.dur, o.release || .03);
    last.connect(bus);
    osc.start(at); osc.stop(at + o.dur + .4);
  }
  function hit(at, dur, vol, freq, type) {
    var s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; f.type = type; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(.001, at + dur);
    s.connect(f); f.connect(g); g.connect(bus);
    s.start(at, Math.random() * .5); s.stop(at + dur + .02);
  }

  // turn a track's synth block into a time-sorted list of sounds
  function buildEvents(sy) {
    var ev = [], beat = 60 / sy.bpm, st = sy.style, len = sy.length, b, i;
    var LEAD = { country: { type: 'triangle', vol: .22, vib: 1 }, piano: { type: 'square', vol: .08, lp: 2600 }, hyper: { type: 'sawtooth', vol: .07, lp: 5200 },
      rnb: { type: 'sine', vol: .17, attack: .03, lp: 1800 }, psych: { type: 'sine', vol: .15, vib: 1, attack: .02 } }[st] || { type: 'square', vol: .1 };
    sy.lead.forEach(function (n) {
      ev.push({ t: n[0], k: 'lead', m: n[1], d: n[2] });
      if (st === 'hyper') ev.push({ t: n[0], k: 'lead2', m: n[1] + 12, d: n[2] });
    });
    sy.bass.forEach(function (n) { ev.push({ t: n[0], k: 'bass', m: n[1], d: n[2] }); });
    sy.chords.forEach(function (c) {
      var t0 = c[0], end = c[0] + c[2], notes = c[1];
      if (st === 'rnb' || st === 'psych') ev.push({ t: t0, k: 'pad', ms: notes, d: c[2] });
      if (st === 'country') for (b = t0 + beat; b < end; b += 2 * beat) ev.push({ t: b, k: 'strum', ms: notes });
      else if (st === 'piano') for (b = t0; b < end - .001; b += beat / 2) ev.push({ t: b, k: 'keys', ms: notes, acc: Math.round((b - t0) / beat * 2) % 8 === 0 });
      else if (st === 'psych') for (b = t0, i = 0; b < end - .001; b += beat / 2, i++) ev.push({ t: b, k: 'shimmer', m: notes[i % notes.length] + 12 });
      else if (st === 'hyper') for (b = t0, i = 0; b < end - .001; b += beat / 4, i++) ev.push({ t: b, k: 'arp', m: notes[i % notes.length] + 12 });
    });
    for (b = 0, i = 0; b < len - .001; b += beat / 4, i++) {
      var q = i % 16; // 16th position in the bar
      if (st === 'piano') { if (q === 0 || q === 8 || q === 10) ev.push({ t: b, k: 'kick' }); if (q === 4 || q === 12) ev.push({ t: b, k: 'snare' }); if (q % 2 === 0) ev.push({ t: b, k: 'hat' }); }
      if (st === 'country') { if (q === 0 || q === 8) ev.push({ t: b, k: 'kick', soft: 1 }); if (q === 4 || q === 12) ev.push({ t: b, k: 'snare', soft: 1 }); if (q % 4 === 2) ev.push({ t: b, k: 'brush' }); }
      if (st === 'hyper') { if (q % 4 === 0) ev.push({ t: b, k: 'kick' }); if (q === 4 || q === 12) ev.push({ t: b, k: 'clap' }); ev.push({ t: b, k: 'hat', soft: q % 2 }); }
      if (st === 'rnb') { if (q === 0 || q === 10) ev.push({ t: b, k: 'kick', soft: 1 }); if (q === 8) ev.push({ t: b, k: 'snare', soft: 1 }); if (q % 2 === 0) ev.push({ t: b + (q % 4 === 2 ? beat / 6 : 0), k: 'hat', soft: 1 }); if (q === 0) ev.push({ t: b, k: 'crackle' }); }
      if (st === 'psych') { if (q === 0 || q === 7) ev.push({ t: b, k: 'kick', soft: 1 }); if (q === 8) ev.push({ t: b, k: 'snare', soft: 1 }); if (q % 2 === 0) ev.push({ t: b, k: 'hat', soft: 1 }); }
    }
    ev.sort(function (a, b2) { return a.t - b2.t; });
    ev.lead = LEAD;
    return ev;
  }
  function play1(e, at) {
    var L = events.lead;
    switch (e.k) {
      case 'lead': tone({ at: at, type: L.type, f: hz(e.m), from: L.slide ? e.m - 1 : 0, dur: e.d, vol: L.vol, vib: L.vib, lp: L.lp, attack: L.attack }); break;
      case 'lead2': tone({ at: at, type: 'square', f: hz(e.m), dur: e.d * .6, vol: .025 }); break;
      case 'bass': tone({ at: at, type: 'triangle', f: hz(e.m), dur: e.d, vol: .3, sustain: .7 }); break;
      case 'arp': tone({ at: at, type: 'square', f: hz(e.m + 12), dur: .07, vol: .022, sustain: .3 }); break;
      case 'pad': e.ms.forEach(function (m) { tone({ at: at, type: 'triangle', f: hz(m), dur: e.d * .95, vol: .045, attack: .4, sustain: .9, decay: .6, release: .4 }); }); break;
      case 'strum': e.ms.forEach(function (m, i) { tone({ at: at + i * .018, type: 'sawtooth', f: hz(m), dur: .3, vol: .035, lp: 2200, sustain: .3 }); }); break;
      case 'keys': e.ms.forEach(function (m) { tone({ at: at, type: 'triangle', f: hz(m + 12), dur: .22, vol: e.acc ? .06 : .04, sustain: .25, decay: .12 }); }); break;
      case 'shimmer': tone({ at: at, type: 'sine', f: hz(e.m + 12), dur: .25, vol: .03, vib: 1, sustain: .4 }); break;
      case 'kick': tone({ at: at, type: 'sine', f: 150, drop: 40, dur: .18, vol: e.soft ? .32 : .5, sustain: .8 }); break;
      case 'snare': hit(at, .14, e.soft ? .12 : .22, 1800, 'bandpass'); break;
      case 'clap': hit(at, .09, e.soft ? .1 : .2, 1400, 'bandpass'); hit(at + .012, .1, e.soft ? .07 : .14, 1400, 'bandpass'); break;
      case 'brush': hit(at, .16, .08, 3000, 'lowpass'); break;
      case 'hat': hit(at, .03, e.soft ? .025 : .05, 7500, 'highpass'); break;
      case 'crackle': for (var c = 0; c < 3; c++) hit(at + Math.random() * .5, .01, .03, 3000, 'highpass'); break;
    }
  }
  function startSynth(at) {
    stopSynth();
    var t = track();
    if (!t || t.src || !t.synth || !ensureAudio()) return;
    var g = ++gen;
    bus = ac.createGain(); bus.gain.setValueAtTime(0, ac.currentTime); bus.gain.linearRampToValueAtTime(.55, ac.currentTime + .15); bus.connect(ac.out);
    events = t._ev || (t._ev = buildEvents(t.synth));
    evI = 0; while (evI < events.length && events[evI].t < at) evI++;
    timer = setInterval(function () {
      if (g !== gen) return;
      var p = pos(), now = ac.currentTime;
      while (evI < events.length && events[evI].t < p + .15) {
        var e = events[evI++], when = now + (e.t - p);
        if (when >= now - .01) play1(e, Math.max(now, when));
      }
    }, 25);
  }
  function stopSynth() {
    gen++; clearInterval(timer);
    if (bus && ac) { var b = bus; b.gain.cancelScheduledValues(ac.currentTime); b.gain.setTargetAtTime(0, ac.currentTime, .03); setTimeout(function () { b.disconnect(); }, 400); }
    bus = null;
  }

  /* ---------- transport ---------- */
  // one <audio> per radio song. The first is made up front so it is buffered when the sound comes on; each next one
  // is made when the song before it starts playing, which leaves a whole preview (30 s) to buffer before the crossfade
  // instead of fetching all five (about 5 MB) at page load. Muted, the radio plays no audio and runs on the clock.
  function el(t) {
    var a = els[t.id];
    if (a) return a;
    a = els[t.id] = new Audio(); a.preload = 'auto'; a.src = t.src; a.muted = muted; a._t = t;
    a.addEventListener('ended', function () { if (a === audioEl && playing) play(idx + 1, 0, 0); });
    a.addEventListener('playing', function () { onAir(a); });
    a.addEventListener('error', function () { fail(a); });
    // a pause or a play from outside the page (media keys, a call, the system's media controls) moves the radio too
    a.addEventListener('pause', function () { if (a === audioEl && playing && !muted && !a.ended && !a.error) pause(); });
    a.addEventListener('play', function () {
      if (a === audioEl && !playing && !muted) { playing = true; startAt = performance.now() - a.currentTime * 1000; emit('state'); }
    });
    return a;
  }
  // the next song's audio, made when this one starts
  function ahead() {
    var t = track(), nx = list[(idx + 1) % list.length];
    if (!muted && nx && nx.src && !nx.bad && nx !== t) el(nx);
  }
  // a preview that took a moment to start joins the clock where the lyrics got to
  function onAir(a) {
    if (a !== audioEl || live || muted || !playing) return;
    var p = pos();
    if (Math.abs(p - a.currentTime) > .3) try { a.currentTime = p; } catch (e) { /* ignore */ }
    live = true;
  }
  // a song whose preview won't play here is skipped until the visitor next turns the sound on
  function fail(a) {
    var t = a._t;
    if (els[t.id] === a) delete els[t.id];
    if (t.bad) return;
    t.bad = true;
    if (a === audioEl && playing && !muted) next();
  }
  // none of the previews play here, so the archive takes over or the radio goes back to muted
  var archiving = false;
  function archive() {
    if (archiving) return;
    archiving = true;
    json('music/archive/playlist.json').then(tracksOf).then(function (tracks) {
      if (!tracks.length) throw new Error('no archive');
      Object.keys(els).forEach(function (k) { els[k].pause(); });
      list = tracks; els = {}; audioEl = null; live = false; timings = {};
      list.forEach(function (t) { loadTiming(t); });
      if (playing) play(0, 0, 0);
      else { idx = 0; pausedPos = 0; emit('track'); }
    }).catch(function () { archiving = false; if (track().bad) setMuted(true); });
  }
  // volume ramps (iOS ignores volume; there the songs simply cut over)
  var fixedVolume = (function () { var a = new Audio(); a.volume = .5; return a.volume !== .5; })();
  function ramp(a, to, dur, done) {
    clearInterval(a._ramp);
    var from = a.volume, t0 = performance.now();
    if (!dur || fixedVolume) { a.volume = to; if (done) done(); return; }
    a._ramp = setInterval(function () {
      var k = Math.min(1, (performance.now() - t0) / (dur * 1000));
      a.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k >= 1) { clearInterval(a._ramp); if (done) done(); }
    }, 30);
  }
  // xf: seconds to crossfade from the song that was playing (the radio hand-over); 0 for a skip or a resume
  function play(i, at, xf) {
    if (!list.length) return;
    stopSynth();
    var old = audioEl;
    idx = (i + list.length) % list.length; at = at || 0;
    // with the sound on, songs whose preview won't play are skipped, and if none will the archive comes in
    for (var n = 0; !muted && n < list.length && track().bad; n++) { idx = (idx + 1) % list.length; at = 0; }
    var t = track();
    if (t.bad && !muted) archive();
    loadTiming(t).then(function () { emit('timing'); });
    loadTiming(list[(idx + 1) % list.length]);
    playing = true; startAt = performance.now() - at * 1000;
    if (t.src && !t.bad && !muted) {
      audioEl = el(t); audioEl.muted = muted;
      try { audioEl.currentTime = at; } catch (e) { /* not seekable yet */ }
      ramp(audioEl, at ? 1 : 0, 0);
      start(audioEl);
      if (!at) ramp(audioEl, 1, xf || .8);
      ahead();
    } else {
      audioEl = null; live = false;
      if (!muted) startSynth(at);
    }
    if (old && old !== audioEl) ramp(old, 0, xf || .25, function () { if (old !== audioEl) { old.pause(); try { old.currentTime = 0; } catch (e) { /* ignore */ } } });
    emit('track');
  }
  function start(a) {
    live = !a.paused;
    var pr = a.play();
    if (pr && pr.then) pr.then(function () { onAir(a); }, function (e) { if (a === audioEl) live = false; if (e && e.name === 'NotSupportedError') fail(a); });
    else live = true;
  }
  // a play before the radio is ready starts it there and then, inside the visitor's tap
  function go() { if (!ready && list.length) { ready = true; play(0, 0, 0); } }
  function next() { if (ready) play(idx + 1, 0, 0); }
  function pause() {
    if (!playing) return;
    pausedPos = pos(); playing = false; live = false; stopSynth();
    Object.keys(els).forEach(function (k) { els[k].pause(); });
    emit('state');
  }
  function resume() { if (!ready) go(); else if (!playing) play(idx, pausedPos, 0); emit('state'); }
  function setMuted(m) {
    // muted, the radio goes back to the clock and the preview stops where the lyrics are
    if (m && live) { startAt = performance.now() - pos() * 1000; live = false; }
    muted = m;
    var t = track();
    Object.keys(els).forEach(function (k) { els[k].muted = m; if (m) els[k].pause(); });
    if (m) stopSynth();
    else {
      // the unmute tap lets an AudioContext run, and a running one reports the output's latency
      if (ensureAudio() && ac.resume) ac.resume().then(readLatency, readLatency);
      list.forEach(function (s) { s.bad = false; });
      if (playing && t && !t.src) startSynth(pos());
      // the unmute tap is what lets the preview start: make it and join the clock where the lyrics are
      if (playing && t && t.src && !live) { var p = pos(); audioEl = el(t); try { audioEl.currentTime = p; } catch (e) { /* ignore */ } ramp(audioEl, 1, .5); start(audioEl); ahead(); }
    }
    emit('state');
  }

  setInterval(function () {
    if (!ready || !playing) return;
    var t = track();
    if (t && t.src) { if (pos() >= length() - XF) play(idx + 1, 0, XF); }
    else if (pos() >= length()) next();
  }, 100);

  document.addEventListener('visibilitychange', function () {
    if (ac && !muted) { if (document.hidden) ac.suspend(); else ac.resume(); }
  });

  // the system's media controls play and pause the radio, not just the song's audio
  if (navigator.mediaSession) try {
    navigator.mediaSession.setActionHandler('play', function () { if (muted) setMuted(false); resume(); });
    navigator.mediaSession.setActionHandler('pause', function () { pause(); });
  } catch (e) { /* action not supported */ }

  function json(u) { return fetch(u).then(function (r) { return r.ok ? r.json() : null; }); }
  function tracksOf(j) { return j ? (Array.isArray(j) ? j : (j.tracks || [])) : []; }
  // the radio, or the archive if the radio can't load; playback starts once the first song's audio and lyrics are in
  var loaded = json('music/radio.json').then(tracksOf, function () { return []; }).then(function (radio) {
    return radio.length ? radio : json('music/archive/playlist.json').then(tracksOf);
  }).then(function (tracks) {
    list = tracks;
    if (!list.length) return;
    list.forEach(function (t) { loadTiming(t); });
    if (list[0].src) el(list[0]);
    var first = list[0], audio = !first.src ? null : new Promise(function (res) {
      var a = el(first);
      if (a.readyState >= 3) res(); else { a.addEventListener('canplaythrough', res); a.addEventListener('error', res); }
    });
    var wait = new Promise(function (res) { setTimeout(res, 4000); });
    return Promise.race([Promise.all([audio, loadTiming(first)]), wait]).then(go);
  }).catch(function () {});

  /* ---------- cover art: abstract gradients, soft shapes, grain. No text. ---------- */
  var covers = {};
  function hexRgb(h) { h = h.replace('#', ''); return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)]; }
  function rgba(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')'; }
  function mixc(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function cover(t, size) {
    if (!t) return '';
    if (t.art) return t.art;
    if (covers[t.id]) return covers[t.id];
    size = size || 480;
    var cv = document.createElement('canvas'); cv.width = cv.height = size;
    var x = cv.getContext('2d'), seed = 0, i;
    for (i = 0; i < t.id.length; i++) seed = (seed * 31 + t.id.charCodeAt(i)) % 2147483647;
    var rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    var a = hexRgb(t.tint || '#77EDD7'), b = t.tint2 ? hexRgb(t.tint2) : mixc(a, [255, 255, 255], .45), ink = [14, 26, 34];
    var g = x.createLinearGradient(0, 0, size * (.3 + rnd() * .7), size);
    g.addColorStop(0, rgba(mixc(a, ink, .72), 1)); g.addColorStop(.55, rgba(mixc(a, ink, .25), 1)); g.addColorStop(1, rgba(b, 1));
    x.fillStyle = g; x.fillRect(0, 0, size, size);
    x.globalCompositeOperation = 'screen';
    for (i = 0; i < 5; i++) {
      var cx0 = rnd() * size, cy0 = rnd() * size, r = size * (.25 + rnd() * .45), c = [a, b, [255, 255, 255], mixc(a, b, .5)][i % 4];
      var rg = x.createRadialGradient(cx0, cy0, 0, cx0, cy0, r);
      rg.addColorStop(0, rgba(c, i % 4 === 2 ? .35 : .75)); rg.addColorStop(1, rgba(c, 0));
      x.fillStyle = rg; x.beginPath(); x.arc(cx0, cy0, r, 0, 6.3); x.fill();
    }
    x.globalCompositeOperation = 'source-over';
    // one soft round shape, like a sun or a moon
    var sx = size * (.3 + rnd() * .4), sy = size * (.3 + rnd() * .4), sr = size * (.12 + rnd() * .1);
    var sg = x.createRadialGradient(sx, sy, sr * .6, sx, sy, sr * 1.05);
    sg.addColorStop(0, rgba(mixc(b, [255, 255, 255], .5), .9)); sg.addColorStop(1, rgba(b, 0));
    x.fillStyle = sg; x.beginPath(); x.arc(sx, sy, sr * 1.05, 0, 6.3); x.fill();
    // a soft motif per colour
    var W = size, lt = mixc(b, [255, 255, 255], .6);
    x.save();
    if (t.id === 'red') { for (i = 6; i > 0; i--) { x.strokeStyle = rgba(lt, .05 + i * .02); x.lineWidth = W * .018; x.beginPath(); x.arc(W * .5, W * 1.02, W * .12 * i, Math.PI, 2 * Math.PI); x.stroke(); } }
    else if (t.id === 'yellow') { x.translate(sx, sy); for (i = 0; i < 18; i++) { x.rotate(Math.PI / 9); x.fillStyle = rgba(lt, .12); x.fillRect(sr * 1.3, -W * .006, W * .5, W * .012); } }
    else if (t.id === 'blue') { for (var gy = 0; gy < 12; gy++) for (var gx = 0; gx < 12; gx++) { var dd = Math.hypot(gx - 8, gy - 3); x.fillStyle = rgba(lt, Math.max(0, .5 - dd * .06)); x.beginPath(); x.arc((gx + .5) * W / 12, (gy + .5) * W / 12, W * .014, 0, 6.3); x.fill(); } }
    else if (t.id === 'violet') { for (i = 0; i < 40; i++) { x.fillStyle = rgba([255, 255, 255], rnd() * .6); x.beginPath(); x.arc(rnd() * W, rnd() * W * .6, W * .003 + rnd() * W * .004, 0, 6.3); x.fill(); } x.fillStyle = rgba(mixc(a, [0, 0, 0], .5), .9); x.beginPath(); x.arc(sx + sr * .45, sy - sr * .3, sr * .95, 0, 6.3); x.fill(); }
    else if (t.id === 'heat') { for (i = 0; i < 7; i++) { x.strokeStyle = rgba(i % 2 ? a : b, .35); x.lineWidth = W * .05; x.beginPath(); for (var wx = -10; wx <= W + 10; wx += 10) { var wy = W * (.55 + i * .07) + Math.sin(wx / W * 6 + i) * W * .04; if (wx < 0) x.moveTo(wx, wy); else x.lineTo(wx, wy); } x.stroke(); } }
    x.restore();
    // grain
    var img = x.getImageData(0, 0, size, size), d = img.data;
    for (i = 0; i < d.length; i += 4) { var n = (Math.random() - .5) * 26; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    x.putImageData(img, 0, 0);
    return (covers[t.id] = cv.toDataURL('image/jpeg', .86));
  }

  window.MooMusic = {
    cover: cover,
    list: function () { return list; },
    ready: function () { return ready; },
    loaded: loaded,
    playing: function () { return playing; },
    muted: function () { return muted; },
    track: track,
    timing: function () { var t = track(); return t && timings[t.id]; },
    pos: pos, lyricPos: lyricPos, length: length,
    sync: function () { return { lead: LEAD, outputLatency: muted ? 0 : outLatency }; },
    play: resume, pause: pause, next: next,
    mute: function () { setMuted(true); }, unmute: function () { setMuted(false); }
  };
})();
