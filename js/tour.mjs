/* mooboard.co/hi/buttons + a short tour of the two buttons + the board in 3d in its own frame from ?frame= + the camera
   goes to a cap + the cap presses + the camera shows the panel doing what the board does + the panel's frames are the
   firmware's own renders in assets/tour/panel.png + three.js and the viewer's model reader come in by the page's import
   map + without webgl the panel alone in its bezel as the finder draws a board */
const W = 128, H = 32, S = 8;                  // the panel in leds + texture pixels a led as the viewer's face
const STRIP = '/assets/tour/panel.png';
const MODEL = '/assets/3d/board-tour.glb';
const FOV = 18;                                // the viewer's long lens
// each frame as boards name it + the site's name for it + midnight when ?frame= names none or one it does not know
const SITE_FRAMES = { midnight: 'black', moonlight: 'white', sunset: 'orange', mint: 'teal', red: 'red' };
const RED = { color: '#BB3D43', rough: 0.6 };  // the red edition frame as finder.css draws it
// each cap in assets/3d/board-tour.glb + pressed along its axis + its switch travels 0.4 mm which no camera that shows
// both caps can see so the tour presses it 1 mm
const CAPS = {
  boot: { node: 'cap_boot', axis: [0, -1, 0], travel: 1 },
  reset: { node: 'cap_reset', axis: [0, -1, 0], travel: 1 },
};
// the caps from the front right and above + aimed between them a little toward the one pressed
const CAP_SHOT = { mid: [218, 67.3, -12], lean: 3, az: 0.3, el: 0.75, d: 125 };
// the strip + the clock from the press 50 ms a frame with the fill from 1 s held + the let go over the portal card +
// the cards + the startup card every 100 ms + dark is no frame at all
const CLOCK = 0, HOLD = 0, LET_GO = 60, PORTAL = 68, GUIDE = 69, STARTING = 70, READY = 90, DARK = -1;
// each step as it plays + the camera's moves from a time to a time to a shot + the cap down and up + the panel by time
const PLAY = [
  { cap: 'boot', end: 4.4, moves: [[0.2, 1.7, 'cap'], [2.8, 4.2, 'panel']], press: [2.1, 2.32],
    frame: (t) => (t < 2.32 ? CLOCK : GUIDE) },
  { cap: 'boot', end: 6.6, moves: [[0.2, 1.7, 'cap'], [3.1, 4.5, 'panel']], press: [2.1, 5.1],
    frame: (t) => (t < 2.1 ? CLOCK : t < 5.1 ? HOLD + Math.min(59, Math.floor((t - 2.1) * 20)) : t < 5.5 ? LET_GO + Math.floor((t - 5.1) * 20) : PORTAL) },
  { cap: 'reset', end: 6.9, moves: [[0.2, 1.7, 'cap'], [2.6, 4.0, 'panel']], press: [2.1, 2.32],
    frame: (t) => (t < 2.1 ? CLOCK : t < 4.5 ? DARK : t < 6.5 ? STARTING + Math.floor((t - 4.5) * 10) : READY) },
];
const CARRY = 0.8;   // the panel keeps what the last step left on it until the camera has turned away
// with less motion asked for + still frames that cut from one to the next + each at a time with its shot and cap and panel
const STILL = [
  { cap: 'boot', end: 1.8, beats: [[0, 'cap', 1, CLOCK], [1.8, 'panel', 0, GUIDE]] },
  { cap: 'boot', end: 3.6, beats: [[0, 'cap', 1, CLOCK], [1.8, 'panel', 1, HOLD + 50], [3.6, 'panel', 0, PORTAL]] },
  { cap: 'reset', end: 4.6, beats: [[0, 'cap', 1, CLOCK], [1.8, 'panel', 0, DARK], [2.8, 'panel', 0, STARTING + 19], [4.6, 'panel', 0, READY]] },
];

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const steps = [...document.querySelectorAll('.step')];
const dotsEl = [...document.querySelectorAll('#dots li')];
const nav = document.getElementById('nav');
const stage = document.getElementById('stage');
const canvas = document.getElementById('board');
const want = new URLSearchParams(location.search).get('frame');
const finish = Object.prototype.hasOwnProperty.call(SITE_FRAMES, want) ? SITE_FRAMES[want] : 'black';

let index = 0, time = 0, playing = false, from = null, carry = null, view = null, panel = null, raf = 0, last = 0;

// the panel + a frame of the strip as round leds as board.js draws the viewer's face
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
// the lit dot and the unlit dot as board.js masks them for a face seen up close
function masks() {
  const bw = W * S, bh = H * S, cell = makeCanvas(S, S), cc = cell.getContext('2d');
  const g = cc.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.43);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.8, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  cc.fillStyle = g; cc.fillRect(0, 0, S, S);
  const m = makeCanvas(bw, bh), mx = m.getContext('2d');
  mx.fillStyle = mx.createPattern(cell, 'repeat'); mx.fillRect(0, 0, bw, bh);
  const cu = makeCanvas(S, S), cux = cu.getContext('2d');
  cux.fillStyle = '#1B1920'; cux.beginPath(); cux.arc(S / 2, S / 2, S * 0.36, 0, 6.3); cux.fill();
  const u = makeCanvas(bw, bh), ux = u.getContext('2d');
  ux.fillStyle = ux.createPattern(cu, 'repeat'); ux.fillRect(0, 0, bw, bh);
  return { m, u };
}
function painter(strip) {
  const dots = makeCanvas(W * S, H * S), dx = dots.getContext('2d'), mk = masks();
  let shown = null;
  return {
    dots,
    shown: () => shown,
    // true when the face changed
    paint(i) {
      if (i === shown) return false;
      shown = i;
      dx.globalCompositeOperation = 'copy';
      dx.imageSmoothingEnabled = false;
      if (i < 0) { dx.fillStyle = '#000'; dx.fillRect(0, 0, W * S, H * S); }
      else dx.drawImage(strip, 0, i * H, W, H, 0, 0, W * S, H * S);
      dx.globalCompositeOperation = 'destination-in'; dx.drawImage(mk.m, 0, 0);
      dx.globalCompositeOperation = 'destination-over'; dx.drawImage(mk.u, 0, 0);
      dx.globalCompositeOperation = 'source-over';
      return true;
    },
  };
}

// the timeline
function ease(k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }
function wrap(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
// a move pans the aim and turns and zooms + it backs off on the way when the aim travels far so it never dives in
function mixCam(a, b, k) {
  const far = Math.hypot(b.t[0] - a.t[0], b.t[1] - a.t[1], b.t[2] - a.t[2]);
  const arc = 0.7 * Math.min(1, far / 150) * Math.sin(Math.PI * k);
  return {
    t: [0, 1, 2].map((i) => a.t[i] + (b.t[i] - a.t[i]) * k),
    az: a.az + wrap(b.az - a.az) * k, el: a.el + (b.el - a.el) * k,
    d: Math.exp(Math.log(a.d) + (Math.log(b.d) - Math.log(a.d)) * k + arc),
  };
}
// the cap goes down in 80 ms and comes up in 120 ms
function pressAt(press, t) {
  if (t < press[0]) return 0;
  if (t < press[1]) return Math.min(1, (t - press[0]) / 0.08);
  return Math.max(0, 1 - (t - press[1]) / 0.12);
}
// where the step stands at time t + the camera + the cap and how far down + the panel's frame
function stateAt(i, t) {
  if (reduced) {
    const sc = STILL[i];
    let b = sc.beats[0];
    for (const beat of sc.beats) if (t >= beat[0]) b = beat;
    return { cam: view ? view.shot(b[1], sc.cap) : null, cap: sc.cap, down: b[2], frame: b[3] };
  }
  const sc = PLAY[i];
  let cam = from;
  if (view) {
    for (const [t0, t1, name] of sc.moves) {
      const to = view.shot(name, sc.cap);
      if (t >= t1) { cam = to; continue; }
      if (t > t0) cam = mixCam(cam, to, ease((t - t0) / (t1 - t0)));
      break;
    }
  }
  return { cam, cap: sc.cap, down: pressAt(sc.press, t), frame: carry !== null && t < CARRY ? carry : sc.frame(t) };
}
function apply() {
  const s = stateAt(index, time);
  const changed = panel ? panel.paint(s.frame) : false;
  if (view) view.draw(s, changed);
  return s;
}
function tick(now) {
  raf = 0;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const end = (reduced ? STILL : PLAY)[index].end;
  if (playing) {
    time = Math.min(end, time + dt);
    if (time >= end) playing = false;
  }
  apply();
  if (playing) raf = requestAnimationFrame(tick);
}
function run() {
  if (raf || !panel) return;
  last = performance.now();
  raf = requestAnimationFrame(tick);
}

// the steps + the words + the dots + back from the second + next and done on the last
function button(cls, text, onClick) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = cls; b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}
// done closes the tab the setup opened + else it goes to mooboard.co/hi + a tab that will not close goes there too
function done() {
  if (history.length <= 1) {
    window.close();
    setTimeout(() => { location.href = '/hi/'; }, 300);
    return;
  }
  location.href = '/hi/';
}
function showStep(i, focus) {
  steps.forEach((s, k) => s.classList.toggle('on', k === i));
  dotsEl.forEach((d, k) => d.classList.toggle('on', k === i));
  nav.textContent = '';
  if (i > 0) nav.appendChild(button('back', 'Back', () => go(i - 1)));
  nav.appendChild(i < steps.length - 1 ? button('btn', 'Next', () => go(i + 1)) : button('btn', 'Done', done));
  if (focus) {
    const h = steps[i].querySelector('h1');
    h.setAttribute('tabindex', '-1');
    h.focus();
  }
}
// a step plays from its start + the camera sets off from wherever it is
function go(i, focus = true) {
  if (view) from = view.current();
  carry = panel && !reduced ? panel.shown() : null;
  index = i; time = 0; playing = true;
  showStep(i, focus);
  apply();
  run();
}

// the board in 3d
async function board3d(dots) {
  const [THREE, env, V] = await Promise.all([
    import('three'), import('three/addons/environments/RoomEnvironment.js'), import('./viewer.mjs'),
  ]);
  const buf = await V.loadModel(MODEL);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 3));
  renderer.toneMapping = THREE.NeutralToneMapping;
  const scene = new THREE.Scene();
  // the viewer's light + a room environment + a key light from the front left + a mint rim light from behind
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new env.RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.8;
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x7d8f8a, 0.65));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-320, 420, 520); scene.add(key);
  const rim = new THREE.DirectionalLight(0xd2fbf2, 1.0); rim.position.set(420, 180, -560); scene.add(rim);
  const cam = new THREE.PerspectiveCamera(FOV, 1, 5, 8000);

  const { root, mats } = V.readGLB(buf);
  scene.add(root);
  const tex = new THREE.CanvasTexture(dots);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  root.getObjectByName('led_face').traverse((m) => { if (m.isMesh) m.material = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }); });
  // the frame in the board's own finish as the viewer paints it
  const f = { ...V.FINISH, red: RED }[finish], frameMat = mats.find((m) => m.name === 'frame');
  if (frameMat) {
    const glass = f.opacity != null && f.opacity < 1;
    frameMat.color.set(f.color); frameMat.roughness = f.rough; frameMat.metalness = 0;
    frameMat.transparent = glass; frameMat.opacity = glass ? f.opacity : 1; frameMat.depthWrite = !glass;
    frameMat.emissive.set(f.emissive || '#000000'); frameMat.emissiveIntensity = f.ei || 0;
  }
  // a light frame keeps its outline on the light backdrop + a soft shadow under the board grounds it
  V.lightEdges(root, ['frame']);
  const shade = V.softShadow(620, 160, 0.42);
  shade.rotation.x = -Math.PI / 2;
  shade.position.y = -68.5;
  scene.add(shade);
  // each cap from the model + it moves along its axis from where it rests
  const caps = {};
  for (const name of Object.keys(CAPS)) {
    const spec = CAPS[name], node = root.getObjectByName(spec.node);
    caps[name] = { node, rest: node ? node.position.clone() : null, push: new THREE.Vector3(...spec.axis).normalize().multiplyScalar(spec.travel) };
  }

  let aspect = 1, dirty = true, cur = null;
  function fit(target, az, el, w, h) {
    const tv = Math.tan(THREE.MathUtils.degToRad(FOV / 2)), th = tv * aspect;
    return { t: target, az, el, d: Math.max(w / 2 / th, h / 2 / tv) };
  }
  // the shots + the whole board from the front right + the caps from the front right and above + the panel face on
  function shot(name, cap) {
    if (name === 'panel') return fit([0, 0, 22], 0.1, 0.08, 548, 150);
    if (name === 'over') return fit([0, 0, 0], 0.5, 0.28, 580, 240);
    const m = CAP_SHOT.mid, lean = cap === 'boot' ? CAP_SHOT.lean : -CAP_SHOT.lean;
    return { t: [m[0] + lean, m[1], m[2]], az: CAP_SHOT.az, el: CAP_SHOT.el, d: CAP_SHOT.d };
  }
  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    aspect = w / h;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    dirty = true;
  }
  function draw(s, faceChanged) {
    if (faceChanged) { tex.needsUpdate = true; dirty = true; }
    const c = s.cam || shot('over');
    if (!cur || c.d !== cur.d || c.az !== cur.az || c.el !== cur.el || c.t.some((v, i) => v !== cur.t[i])) dirty = true;
    cur = c;
    for (const name of Object.keys(caps)) {
      const k = caps[name], down = name === s.cap ? s.down : 0;
      if (!k.node) continue;
      const p = k.rest.clone().addScaledVector(k.push, down);
      if (!p.equals(k.node.position)) { k.node.position.copy(p); dirty = true; }
    }
    if (!dirty) return;
    const sp = Math.sin(c.el), cp = Math.cos(c.el);
    cam.position.set(c.t[0] + c.d * cp * Math.sin(c.az), c.t[1] + c.d * sp, c.t[2] + c.d * cp * Math.cos(c.az));
    cam.lookAt(c.t[0], c.t[1], c.t[2]);
    renderer.render(scene, cam);
    dirty = false;
  }
  if (window.ResizeObserver) new ResizeObserver(() => { resize(); apply(); }).observe(canvas);
  else addEventListener('resize', () => { resize(); apply(); });
  resize();
  return { shot, draw, current: () => cur || shot('over') };
}
// no webgl + the panel alone in its bezel as the finder draws a board
function flat(dots) {
  stage.classList.add('flat');
  canvas.remove();
  const bz = document.createElement('span'), led = document.createElement('span');
  bz.className = 'bezel'; led.className = 'led';
  bz.setAttribute('data-frame', finish);
  led.appendChild(dots);
  bz.appendChild(led);
  stage.appendChild(bz);
}

// the frames and the 3d load side by side + the tour starts once both are in
async function start() {
  const strip = new Image();
  strip.src = STRIP;
  const p = painter(strip);
  const three = window.WebGLRenderingContext ? board3d(p.dots).catch(() => null) : Promise.resolve(null);
  await strip.decode();
  view = await three;
  if (view) from = view.shot('over');
  else flat(p.dots);
  panel = p;
  apply();
  stage.addEventListener('click', () => go(index, false));   // a tap on the board plays the step again
  return new Promise((resolve) => setTimeout(() => { go(index, false); resolve(); }, reduced ? 0 : 500));
}

showStep(0, false);
// the frames that will not load leave the words and the buttons to teach alone
const ready = start().catch(() => { stage.hidden = true; });
// renders for the owner + ?shots holds the tour at a step and a time
if (/[?&]shots\b/.test(location.search)) {
  window.mooTour = {
    ready,
    seek(i, t) {
      playing = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      index = i; time = t;
      if (view) from = i > 0 ? view.shot('panel') : view.shot('over');
      carry = i > 0 && !reduced ? PLAY[i - 1].frame(PLAY[i - 1].end) : null;
      showStep(i, false);
      return apply();
    },
    end: (i) => (reduced ? STILL : PLAY)[i].end,
  };
}
