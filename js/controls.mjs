/* mooboard controls: the "press it" section. The board's top and bottom up close in 3D (assets/3d/board.glb) with a
   tap target on every control, and a live board beside it doing what that control does. The caps press, the wheel
   turns, the mic switch slides. Without WebGL the targets sit in a plain row. three.js and the viewer's model reader
   come in by the page's import map. Every word this section shows is in TEXT below. */

// all the words, in one place
export const TEXT = {
  hint: 'Tap a button',
  top: 'Top', bottom: 'Bottom',
  prevSong: 'Back a song', nextSong: 'Next song', paused: 'Paused', playing: 'Playing',
  prevScreen: 'Back a screen', nextScreen: 'Next screen', held: 'Holding this screen', moving: 'Screens moving again',
  home: 'Back to the clock', wheel: 'Scrolling screens',
  mic: 'Hears the music', micOff: 'Mics off', micOn: 'Mics on',
  speaker: 'Alarms, timers, and chimes', reset: 'Restarting',
  label: {
    prev: 'Back', play: 'Play or pause', next: 'Next', boot: 'Home', wheel: 'Scroll wheel',
    mic: 'Mic', speaker: 'Speaker', micSwitch: 'Mic switch', reset: 'Restart',
  },
};

// the glyph shown beside each control for its first 5 seconds on screen (text glyphs stay text, never emoji)
const SVG = (d) => '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
const GLYPH = {
  prev: '\u25C0\uFE0E', play: '\u23EF\uFE0E', next: '\u25B6\uFE0E', boot: '\u25CF', reset: '\u21BB',
  wheel: SVG('<path d="M7 8l-4 4 4 4M17 8l4 4-4 4M3 12h18"/>'),
  mic: SVG('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  speaker: SVG('<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'),
  micSwitch: SVG('<rect x="3" y="8" width="18" height="8" rx="4"/><circle cx="16" cy="12" r="2.2" fill="currentColor"/>'),
};
const FOV = 22;
const SCREENS = ['time', 'weather', 'song', 'art', 'calendar', 'score'];
// each control: its node in the model, the view it lives on, and how it moves (Hardware, 2026-10-20)
const PARTS = {
  prev: { node: 'cap_prev', view: 'top', press: [0, -1, 0] },
  play: { node: 'cap_play', view: 'top', press: [0, -1, 0] },
  next: { node: 'cap_next', view: 'top', press: [0, -1, 0] },
  boot: { node: 'cap_boot', view: 'top', press: [0, -1, 0] },
  // the wheel's 40 ridges repeat every 9 degrees, and the model keeps only its outside
  wheel: { node: 'wheel', view: 'top', turn: [223.5, 58.8, -16.5], pitch: Math.PI / 20 },
  reset: { node: 'cap_reset', view: 'bottom', press: [0, 1, 0] },
  micSwitch: { node: 'mic_switch', view: 'bottom', slide: 1.5 },
  // the holes on the bottom wall (y -67.3, facing down)
  mic: { at: [[173.85, -67.3, -8], [232.55, -67.3, -8]], view: 'bottom' },
  speaker: { at: [[209.2, -67.3, -13.3]], view: 'bottom' },
};

// ---- sounds, made on the spot (a tap is the only thing that plays one) ----
let ac = null;
function audio() {
  if (!ac) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; ac = new A(); }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}
// a cowbell note: two square tones through a band pass, quick to fade
function bell(t, f, gain) {
  const a = audio(); if (!a) return;
  const out = a.createGain(), bp = a.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = f * 1.4; bp.Q.value = 3;
  out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(gain, t + 0.005); out.gain.exponentialRampToValueAtTime(0.0008, t + 0.55);
  for (const m of [1, 1.48]) { const o = a.createOscillator(); o.type = 'square'; o.frequency.value = f * m; o.connect(bp); o.start(t); o.stop(t + 0.6); }
  bp.connect(out); out.connect(a.destination);
}
// a soft sine note
function tone(t, f, gain, len) {
  const a = audio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = 'sine'; o.frequency.value = f;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0008, t + len);
  o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + len + 0.05);
}
const SOUND = {
  // the find-my-board cowbell climb
  speaker() { const a = audio(); if (!a) return; const t = a.currentTime + 0.02; [523, 659, 784, 1047].forEach((f, i) => bell(t + i * 0.16, f, 0.12)); },
  // the startup sound, two notes up
  reset() { const a = audio(); if (!a) return; const t = a.currentTime + 0.6; tone(t, 587, 0.12, 0.5); tone(t + 0.18, 880, 0.12, 0.8); },
  click() { const a = audio(); if (!a) return; tone(a.currentTime, 1800, 0.025, 0.04); },
};

export async function start(o) {
  const { stage, canvas, board, caption, viewBtns, reduced, frame } = o;
  const M = () => window.MooMusic;
  const music = () => { const m = M(); return !!(m && m.ready && m.ready() && m.playing()); };
  let held = false, micOff = false, mine = false, capTimer = 0;

  function say(s) {
    caption.textContent = s;
    caption.classList.remove('pop'); void caption.offsetWidth; caption.classList.add('pop');
    clearTimeout(capTimer); capTimer = setTimeout(() => { caption.textContent = TEXT.hint; caption.classList.remove('pop'); }, 3200);
  }
  function screen(dir) {
    const cur = board.pending || board.next || board.cur, i = Math.max(0, SCREENS.indexOf(cur));
    const n = SCREENS[(i + dir + SCREENS.length) % SCREENS.length];
    board.go(n);
    return board.scenes[n] && board.scenes[n].label;
  }
  // what each control does (owner, 2026-10-20): the arrows and play run the music while a song plays and the
  // screens otherwise, the wheel scrolls the screens, home goes back to the clock
  const ACT = {
    prev() { if (music()) { M().prev(); board.go('song'); say(TEXT.prevSong); } else say(screen(-1) || TEXT.prevScreen); },
    next() { if (music()) { M().next(); board.go('song'); say(TEXT.nextSong); } else say(screen(1) || TEXT.nextScreen); },
    play() {
      const m = M();
      if (music()) { m.pause(); mine = true; say(TEXT.paused); return; }
      if (mine && m) { m.play(); mine = false; board.go('song'); say(TEXT.playing); return; }
      held = !held; board.auto = !held; say(held ? TEXT.held : TEXT.moving);
    },
    boot() { board.go('time'); say(TEXT.home); },
    wheel(dir) { say(screen(dir || 1) || TEXT.wheel); },
    mic() { board.go('vis'); say(micOff ? TEXT.micOff : TEXT.mic); },
    micSwitch() { micOff = !micOff; board.micOff = micOff; board.go('vis'); say(micOff ? TEXT.micOff : TEXT.micOn); },
    speaker() { SOUND.speaker(); board.moo(); say(TEXT.speaker); },
    reset() {
      SOUND.reset(); say(TEXT.reset);
      board.el.classList.add('off');
      setTimeout(() => { board.el.classList.remove('off'); board.go('mark'); setTimeout(() => board.go('time'), 1800); }, 650);
    },
  };

  // the tap targets, one per control (two for the mic's two holes)
  const hots = [];
  for (const name of Object.keys(PARTS)) {
    const n = PARTS[name].at ? PARTS[name].at.length : 1;
    for (let k = 0; k < n; k++) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ctl-hot'; b.dataset.part = name;
      b.setAttribute('aria-label', TEXT.label[name]);
      if (k) b.tabIndex = -1;
      const tag = document.createElement('span');
      tag.className = 'ctl-tag'; tag.setAttribute('aria-hidden', 'true'); tag.innerHTML = GLYPH[name];
      stage.appendChild(b); stage.appendChild(tag); hots.push({ el: b, tag, name, k });
    }
  }
  caption.textContent = TEXT.hint;

  let gl = null;
  try { gl = await scene3d(); } catch (e) { gl = null; if (window.console) console.warn('controls 3D:', e && e.message); }
  if (!gl) {
    // no WebGL: the targets in a plain row with their names
    stage.classList.add('flat'); canvas.remove();
    hots.forEach((h) => { h.tag.remove(); if (h.k) h.el.remove(); else h.el.textContent = TEXT.label[h.name]; });
    viewBtns.forEach((v) => v.remove());
  }

  function fire(name, dir) {
    SOUND.click();
    if (gl) gl.animate(name, dir);
    ACT[name](dir);
  }
  hots.forEach((h) => {
    h.el.addEventListener('click', () => fire(h.name));
    if (h.name === 'wheel') {
      // a sideways drag or a scroll over the wheel turns it a screen at a time
      let x0 = null, acc = 0;
      h.el.addEventListener('pointerdown', (e) => { x0 = e.clientX; acc = 0; try { h.el.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ } });
      h.el.addEventListener('pointermove', (e) => {
        if (x0 == null) return; const dx = e.clientX - x0; acc += dx; x0 = e.clientX;
        if (gl) gl.roll(dx);
        if (Math.abs(acc) > 28) { SOUND.click(); ACT.wheel(acc > 0 ? 1 : -1); acc = 0; h.drag = true; }
      });
      const end = () => { x0 = null; };
      h.el.addEventListener('pointerup', end); h.el.addEventListener('pointercancel', end);
      h.el.addEventListener('click', (e) => { if (h.drag) { h.drag = false; e.stopImmediatePropagation(); } }, true);
      h.el.addEventListener('wheel', (e) => { e.preventDefault(); if (Math.abs(e.deltaY) + Math.abs(e.deltaX) > 4) fire('wheel', (e.deltaY || e.deltaX) > 0 ? 1 : -1); }, { passive: false });
    }
  });
  viewBtns.forEach((v) => v.addEventListener('click', () => gl && gl.view(v.dataset.view)));

  // the glyphs: shown beside the controls of a side the first time it is on screen, gone 5 s later
  const seen = {}; let onScreen = false, tagTimer = 0;
  function tags(view) {
    if (!onScreen || seen[view] || (gl && !gl.settled())) return;
    seen[view] = true;
    stage.classList.add('tags-on');
    clearTimeout(tagTimer); tagTimer = setTimeout(() => stage.classList.remove('tags-on'), 5000);
  }
  if (window.IntersectionObserver) new IntersectionObserver((e) => { onScreen = e[e.length - 1].isIntersecting; if (gl) tags(gl.current()); }, { threshold: 0.5 }).observe(stage);
  if (gl) gl.onSettle = tags;

  return { setFrame: (f) => gl && gl.setFrame(f) };

  // ---- the board in 3D ----
  async function scene3d() {
    if (!window.WebGLRenderingContext) return null;
    const [THREE, env, V] = await Promise.all([
      import('three'), import('three/addons/environments/RoomEnvironment.js'), import('./viewer.mjs'),
    ]);
    const buf = await V.loadModel('assets/3d/board.glb');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.toneMapping = THREE.NeutralToneMapping;
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new env.RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.8;
    pmrem.dispose();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x7d8f8a, 0.65));
    const key = new THREE.DirectionalLight(0xffffff, 2.1); key.position.set(-380, 520, 300); scene.add(key);
    const under = new THREE.DirectionalLight(0xffffff, 0.9); under.position.set(150, -500, 400); scene.add(under);
    const cam = new THREE.PerspectiveCamera(FOV, 1, 5, 8000);
    const { root, mats } = V.readGLB(buf);
    scene.add(root);
    // the face dark (the live board beside it shows what it does), the rail and hooks out of the way
    const face = root.getObjectByName('led_face');
    if (face) face.traverse((m) => { if (m.isMesh) m.material = new THREE.MeshStandardMaterial({ color: 0x111314, roughness: 0.5 }); });
    for (const n of ['rail', 'hook_l', 'hook_r']) { const x = root.getObjectByName(n); if (x) x.visible = false; }
    const byName = (n) => mats.find((m) => m.name === n);
    const frameMat = byName('frame'), buttons = byName('buttons'), feet = byName('feet');
    function setFrame(name) {
      const f = V.FINISH[name] || V.FINISH.teal;
      for (const m of [frameMat, buttons]) if (m) {
        m.color.set(f.color); m.roughness = f.rough; m.metalness = f.metal || 0;
        const glass = f.opacity != null && f.opacity < 1;
        m.transparent = glass; m.opacity = glass ? f.opacity : 1; m.depthWrite = !glass;
        m.emissive.set(f.emissive || '#000000'); m.emissiveIntensity = f.ei || 0; m.needsUpdate = true;
      }
      dirty = true;
    }
    if (feet) { feet.color.set(V.RAILS.black.color); feet.roughness = V.RAILS.black.rough; }
    V.lightEdges(root, ['frame', 'buttons']);

    // each moving part from where it rests
    const parts = {};
    for (const name of Object.keys(PARTS)) {
      const p = PARTS[name], node = p.node && root.getObjectByName(p.node);
      parts[name] = { node, rest: node ? node.position.clone() : null, rot: node ? node.rotation.z : 0, v: 0, goal: 0, spin: 0 };
    }
    // the wheel turns on its own axle: a pivot at the axle carries it
    const W = parts.wheel;
    if (W.node) {
      const pv = new THREE.Group(), at = new THREE.Vector3(...PARTS.wheel.turn);
      pv.position.copy(at); W.node.parent.add(pv); W.node.position.sub(at); pv.add(W.node);
      W.pivot = pv;
    }
    // where a part sits, for its tap target and the camera
    root.updateMatrixWorld(true);
    function centre(name, k) {
      const p = PARTS[name];
      if (p.at) return new THREE.Vector3(...p.at[k || 0]);
      const node = parts[name].node; if (!node) return null;
      // the middle of the face you can see: the top of a part on the top wall, the bottom of one on the bottom wall
      const box = new THREE.Box3().setFromObject(node), c = box.getCenter(new THREE.Vector3());
      c.y = p.view === 'top' ? box.max.y : box.min.y;
      return c;
    }
    const rest = {};
    for (const h of hots) rest[h.name + h.k] = centre(h.name, h.k);
    // the two views: the top wall from the front and above, the bottom wall from the front and below
    function aim(view) {
      const pts = hots.filter((h) => PARTS[h.name].view === view).map((h) => rest[h.name + h.k]).filter(Boolean);
      const box = new THREE.Box3().setFromPoints(pts), mid = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
      const top = view === 'top';
      return { t: [mid.x, mid.y, mid.z + (top ? 2 : 1)], az: top ? 0.22 : 0.16, el: top ? 0.88 : -0.86, span: Math.max(size.x, 40) + 24 };
    }
    const VIEWS = { top: aim('top'), bottom: aim('bottom') };
    let view = 'top', from = VIEWS.top, to = VIEWS.top, k = 1, aspect = 1, dirty = true;

    function resize() {
      const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      aspect = w / h; cam.aspect = aspect; cam.updateProjectionMatrix(); dirty = true;
    }
    function camAt(c) {
      const tv = Math.tan(THREE.MathUtils.degToRad(FOV / 2)), d = Math.max(c.span / 2 / (tv * aspect), c.span * 0.32 / tv);
      const sp = Math.sin(c.el), cp = Math.cos(c.el);
      cam.position.set(c.t[0] + d * cp * Math.sin(c.az), c.t[1] + d * sp, c.t[2] + d * cp * Math.cos(c.az));
      cam.lookAt(c.t[0], c.t[1], c.t[2]);
      cam.updateMatrixWorld();
    }
    const L = (a, b, u) => a + (b - a) * u;
    function frameCam() {
      const u = k < 1 ? 0.5 - 0.5 * Math.cos(Math.PI * k) : 1;
      // between views the camera swings round the front, past level
      camAt({ t: from.t.map((v, i) => L(v, to.t[i], u)), az: L(from.az, to.az, u), el: L(from.el, to.el, u), span: L(from.span, to.span, u) + Math.sin(Math.PI * u) * 60 });
    }
    function place() {
      const w = canvas.clientWidth, h = canvas.clientHeight, v = new THREE.Vector3();
      for (const hh of hots) {
        const p = rest[hh.name + hh.k], on = PARTS[hh.name].view === view && k >= 1;
        hh.el.classList.toggle('away', !on);
        hh.el.tabIndex = on && !hh.k ? 0 : -1;
        if (!p) continue;
        v.copy(p).project(cam);
        const x = (v.x + 1) / 2 * w, y = (1 - v.y) / 2 * h;
        hh.el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
        // the glyph sits off the control: above it on the top, below it on the bottom
        hh.tag.style.transform = 'translate(' + x.toFixed(1) + 'px,' + (y + (view === 'top' ? -34 : 34)).toFixed(1) + 'px)';
        hh.tag.classList.toggle('away', !on);
      }
    }
    let last = 0, raf = 0;
    function loop(now) {
      raf = 0;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016; last = now;
      let moving = false;
      if (k < 1) { k = reduced ? 1 : Math.min(1, k + dt / 0.9); moving = true; if (k >= 1) { from = to; place(); if (api.onSettle) api.onSettle(view); } }
      for (const name of Object.keys(parts)) {
        const q = parts[name], p = PARTS[name];
        if (!q.node) continue;
        if (p.turn) q.goal = q.spin;
        q.v += (q.goal - q.v) * Math.min(1, dt * (p.turn ? 10 : 30));
        if (Math.abs(q.goal - q.v) > 0.002) moving = true;
        if (q.goal && Math.abs(q.goal - q.v) < 0.02 && p.press) q.goal = 0;
        if (p.press) q.node.position.copy(q.rest).add(new THREE.Vector3(...p.press).multiplyScalar(q.v));
        if (p.slide) q.node.position.set(q.rest.x + q.v * p.slide, q.rest.y, q.rest.z);
        if (p.turn && q.pivot) {
          // a turn past one ridge steps back by one: it looks the same, and the part of the wheel that isn't
          // modelled never comes round
          while (q.v > p.pitch) { q.v -= p.pitch; q.spin -= p.pitch; }
          while (q.v < -p.pitch) { q.v += p.pitch; q.spin += p.pitch; }
          q.pivot.rotation.z = q.v;
        }
      }
      frameCam();
      if (k < 1) place();
      renderer.render(scene, cam);
      if (moving) raf = requestAnimationFrame(loop);
    }
    function kick() { if (!raf) { last = 0; raf = requestAnimationFrame(loop); } }
    if (window.ResizeObserver) new ResizeObserver(() => { resize(); frameCam(); place(); kick(); }).observe(canvas);
    resize(); setFrame(frame || 'teal'); frameCam(); place(); kick();

    const api = {
      settled: () => k >= 1,
      current: () => view,
      roll(dx) { const q = parts.wheel; if (q.pivot) { q.spin -= dx * 0.035; kick(); } },
      setFrame(f) { setFrame(f); kick(); },
      view(v) {
        if (v === view || !VIEWS[v]) return;
        from = VIEWS[view]; to = VIEWS[v]; view = v; k = reduced ? 1 : 0;
        viewBtns.forEach((b) => { const on = b.dataset.view === v; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
        hots.forEach((h) => { h.el.classList.add('away'); h.tag.classList.add('away'); });
        if (reduced) { from = to; place(); }
        kick();
      },
      animate(name, dir) {
        const q = parts[name], p = PARTS[name];
        if (!q || !q.node) return;
        if (p.press) q.goal = 1;
        if (p.slide) q.goal = q.goal ? 0 : 1;
        // right turns the top of the wheel to the right (clockwise seen from the front)
        if (p.turn) q.spin -= (dir || 1) * 0.9;
        kick();
      },
    };
    return api;
  }
}
