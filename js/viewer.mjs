/* mooboard 3D viewer: the board's outside (assets/3d/board.glb, the enclosure CAD's outer shell) turning slowly in
   the light, in any of the four frame colors, its LED face a live board.js board. main.js imports this only when the
   section comes near; three.js comes from the page's import map. The lighting follows the assembly viewer: neutral
   tone mapping, a room environment, a key light from the front left and a mint rim light from behind.

   Drag (or swipe sideways) to turn it, pinch (or pinch the trackpad) to zoom, double-click for a close-up; the arrow
   keys, + and - work when it has focus. The slow spin stops at the first touch; the spin button restarts it. */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// the four frames (sRGB), as the model's README gives them; the site's names for them on the left
export const FINISH = {
  teal: { color: '#77EDD7', rough: 0.28, opacity: 0.5, emissive: '#1FAE95', ei: 0.28 },   // Mint Glow, translucent
  orange: { color: '#F2762E', rough: 0.5 },                                                  // Sunset
  black: { color: '#262B30', rough: 0.6 },                                                   // Midnight
  white: { color: '#EEF1EE', rough: 0.55 },                                                  // Moonlight
};
// the wall rail and hooks in black or white petg matte under every finish + black unless the visitor picks white
// + the feet's felt pads go with them + null keeps the model's own dark felt
export const RAILS = {
  black: { color: '#1F2023', rough: 0.82, felt: null },
  white: { color: '#F2F2EF', rough: 0.82, felt: '#ECEAE4' },
};
const SPIN = 0.12;                 // rad/s: one turn in about 52 s
const HOME = { az: -0.42, pol: 1.50098 };  // front left, 4 degrees above
const MARGIN = 0.12;               // the spin's reach keeps this share of each half of the frame clear, across and up and down

// ---- the model: a plain glTF 2.0 binary (no extensions, no textures), read without GLTFLoader ------------------
const COMP = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
export function readGLB(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a glb');
  let off = 12, json = null, bin = null;
  while (off < buf.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 8, len)));
    else if (type === 0x004e4942) bin = buf.slice(off + 8, off + 8 + len);
    off += 8 + len;
  }
  const accessor = (i) => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView], T = COMP[a.componentType], n = SIZE[a.type];
    const start = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const arr = new T(bin.slice(start, start + a.count * n * T.BYTES_PER_ELEMENT));
    return new THREE.BufferAttribute(arr, n, !!a.normalized);
  };
  const mats = (json.materials || []).map((m) => {
    const p = m.pbrMetallicRoughness || {}, c = p.baseColorFactor || [1, 1, 1, 1];
    const mat = new THREE.MeshStandardMaterial({
      name: m.name || '',
      color: new THREE.Color().setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace),
      metalness: p.metallicFactor == null ? 1 : p.metallicFactor,
      roughness: p.roughnessFactor == null ? 1 : p.roughnessFactor,
      side: m.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    });
    if (m.emissiveFactor) mat.emissive.setRGB(m.emissiveFactor[0], m.emissiveFactor[1], m.emissiveFactor[2], THREE.LinearSRGBColorSpace);
    return mat;
  });
  const root = new THREE.Group();
  const build = (ni) => {
    const nd = json.nodes[ni], obj = new THREE.Group();
    obj.name = nd.name || '';
    if (nd.matrix) obj.applyMatrix4(new THREE.Matrix4().fromArray(nd.matrix));
    if (nd.translation) obj.position.fromArray(nd.translation);
    if (nd.rotation) obj.quaternion.fromArray(nd.rotation);
    if (nd.scale) obj.scale.fromArray(nd.scale);
    if (nd.mesh != null) {
      json.meshes[nd.mesh].primitives.forEach((pr) => {
        const g = new THREE.BufferGeometry();
        if (pr.attributes.POSITION != null) g.setAttribute('position', accessor(pr.attributes.POSITION));
        if (pr.attributes.NORMAL != null) g.setAttribute('normal', accessor(pr.attributes.NORMAL));
        if (pr.attributes.TEXCOORD_0 != null) g.setAttribute('uv', accessor(pr.attributes.TEXCOORD_0));
        if (pr.indices != null) g.setIndex(accessor(pr.indices));
        const mesh = new THREE.Mesh(g, pr.material != null ? mats[pr.material] : new THREE.MeshStandardMaterial());
        mesh.name = obj.name;
        obj.add(mesh);
      });
    }
    (nd.children || []).forEach((c) => obj.add(build(c)));
    return obj;
  };
  json.scenes[json.scene || 0].nodes.forEach((ni) => root.add(build(ni)));
  return { root, mats };
}

// faint darker lines along the creases of the light parts only + a white frame or rail keeps its shape on a light
// backdrop + `names` are the materials it may outline + a dark part gets none
export function lightEdges(root, names, opacity = 0.48) {
  const mat = new THREE.LineBasicMaterial({ color: '#56626B', transparent: true, opacity, depthWrite: false });
  const lit = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b > 0.45;
  const out = [];
  root.traverse((m) => {
    if (!m.isMesh || !m.material || names.indexOf(m.material.name) < 0 || !lit(m.material.color)) return;
    const l = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 30), mat);
    m.add(l);
    out.push(l);
  });
  return { lines: out, material: mat };
}

// a soft round shadow on a plane w by h + darkest in the middle + for under a model or behind it on a wall
export function softShadow(w, h, opacity = 0.45) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d'), grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)'); grad.addColorStop(0.55, 'rgba(0,0,0,0.18)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity }));
}

// the model travels gzipped as hosts send glb plain + used as is when the host unpacked it or the browser cannot
export async function loadModel(url) {
  const get = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error('model ' + r.status); return r; };
  if ('DecompressionStream' in window) {
    try {
      const raw = await (await get(url + '.gz')).arrayBuffer(), head = new Uint8Array(raw, 0, 2);
      if (head[0] !== 0x1f || head[1] !== 0x8b) return raw;
      return await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    } catch (e) { /* fall through to the plain file */ }
  }
  return (await get(url)).arrayBuffer();
}

// a turn of the event loop, in idle time where the browser has some: the setup runs as several short tasks, not one
// long one, so a scroll toward the section never waits on it
const idle = () => new Promise((r) => ('requestIdleCallback' in window ? requestIdleCallback(() => r(), { timeout: 300 }) : setTimeout(r, 16)));

export async function start(o) {
  const { canvas, led, reduced } = o;
  const modelBytes = loadModel(o.model);   // the model downloads while the scene is set up
  modelBytes.catch(() => {});              // (a failure surfaces where it is awaited, not as a stray rejection)
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  const coarse = matchMedia('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.75 : 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  const scene = new THREE.Scene();
  await idle();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.8;
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x7d8f8a, 0.65));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-320, 420, 520); scene.add(key);
  const rim = new THREE.DirectionalLight(0xd2fbf2, 1.0); rim.position.set(420, 180, -560); scene.add(rim);
  const cam = new THREE.PerspectiveCamera(18, 1, 10, 8000);   // a long lens: a product shot, not a fisheye

  // a soft shadow on the floor under the board
  const sh = document.createElement('canvas'); sh.width = sh.height = 128;
  const sg = sh.getContext('2d'), grad = sg.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.5)'); grad.addColorStop(0.55, 'rgba(0,0,0,0.16)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  sg.fillStyle = grad; sg.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(600, 170), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sh), transparent: true, depthWrite: false, opacity: 0.45 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = -125; scene.add(shadow);

  const buf = await modelBytes;
  await idle();
  const { root, mats } = readGLB(buf);
  scene.add(root);
  // the spin's reach: the cylinder the board sweeps round the vertical axis the camera circles, its radius half the
  // diagonal of the board's length and depth (the farthest corner from the axis), its height the board's
  const box = new THREE.Box3().setFromObject(root), yLo = box.min.y, yHi = box.max.y;
  let reach = 0;
  for (const x of [box.min.x, box.max.x]) for (const z of [box.min.z, box.max.z]) reach = Math.max(reach, Math.hypot(x, z));

  // the LED face: the live board's dot picture, 8 px per LED; glTF's v runs down, so no flip
  const tex = new THREE.CanvasTexture(led.dots);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const face = root.getObjectByName('led_face');
  face.traverse((m) => { if (m.isMesh) m.material = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }); });
  const frameMat = mats.find((m) => m.name === 'frame');
  const dot = mats.find((m) => m.name === 'status_dot');
  if (dot) { dot.emissive = new THREE.Color('#3aa8ff'); dot.emissiveIntensity = 0.9; }
  const rail = mats.find((m) => m.name === 'rail');
  const felt = mats.find((m) => m.name === 'felt');
  const feltDark = felt ? felt.color.clone() : null;
  function setRail(name) {
    const r = RAILS[name] || RAILS.black;
    if (rail) { rail.color.set(r.color); rail.roughness = r.rough; rail.metalness = 0; }
    if (felt) { if (r.felt) felt.color.set(r.felt); else felt.color.copy(feltDark); }
    dirty = true;
  }

  function setFrame(name) {
    const f = FINISH[name] || FINISH.teal, m = frameMat;
    if (!m) return;
    m.color.set(f.color); m.roughness = f.rough; m.metalness = 0;
    const glass = f.opacity != null && f.opacity < 1;
    m.transparent = glass; m.opacity = glass ? f.opacity : 1; m.depthWrite = !glass;
    m.emissive.set(f.emissive || '#000000'); m.emissiveIntensity = f.ei || 0;
    m.needsUpdate = true;
    dirty = true;
  }

  // ---- the camera: an orbit round the board's centre, eased toward a goal ----
  let az = HOME.az, pol = HOME.pol, dist = 900, fitD = 900, zoom = 1;
  let goal = null, vAz = 0, spinning = !reduced, close = false, dirty = true;
  const pointers = new Map();
  let lastMove = 0, pinch = 0;
  function fit() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1, aspect = w / h;
    renderer.setSize(w, h, false);
    cam.aspect = aspect;
    // the cylinder in frame at the home tilt (the camera t above level, looking at the centre): one distance keeps it
    // inside the frame less the margin across, one up and down, and the camera takes the farther
    const tV = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * (1 - MARGIN), tH = tV * aspect;
    const t = Math.PI / 2 - HOME.pol, s = Math.sin(t), c = Math.cos(t);
    // across: the circle's silhouette (asin(reach / d) seen level) at the height that comes nearest
    const across = Math.max(yLo * s, yHi * s) + Math.hypot(reach * c, reach / tH);
    // up and down: the top and the bottom at the circle's nearest and farthest points, end on to the camera
    let upDown = 0;
    for (const y of [yLo, yHi]) for (const z of [-reach, reach]) upDown = Math.max(upDown, y * s + z * c + Math.abs(y * c - z * s) / tV);
    fitD = Math.max(across, upDown);
    cam.updateProjectionMatrix();
    dirty = true;
  }
  function closeD() {
    const hHalf = Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.aspect);
    return 22 + 262 / Math.tan(hHalf) ;
  }
  function wrap(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
  function setSpin(on) { spinning = !!on; if (on) { goal = null; close = false; o.onClose && o.onClose(false); } o.onSpin && o.onSpin(spinning); }
  function stopAll() { if (spinning) setSpin(false); goal = null; }
  function closeUp(on) {
    close = !!on;
    if (close) { if (spinning) setSpin(false); goal = { az: 0, pol: Math.PI / 2, d: closeD() / fitD }; }
    else goal = { az: HOME.az, pol: HOME.pol, d: 1 };
    o.onClose && o.onClose(close);
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stopAll(); vAz = 0; lastMove = performance.now();
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    o.onTouch && o.onTouch();
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y, now = performance.now(), dt = Math.max(1, now - lastMove) / 1000;
    p.x = e.clientX; p.y = e.clientY; lastMove = now;
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0 && d > 0) zoom = THREE.MathUtils.clamp(zoom * pinch / d, 0.42, 1.6);
      pinch = d; dirty = true;
      return;
    }
    const k = 2.4 * Math.PI / Math.max(320, canvas.clientWidth);
    az -= dx * k; pol = THREE.MathUtils.clamp(pol - dy * k, 0.35, Math.PI - 0.35);
    vAz = -dx * k / dt; dirty = true;
  });
  const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = 0; if (performance.now() - lastMove > 80) vAz = 0; };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); pinch = 0; vAz = 0; });
  // a trackpad pinch arrives as a wheel event with ctrlKey; a plain wheel still scrolls the page
  canvas.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault(); stopAll();
    zoom = THREE.MathUtils.clamp(zoom * Math.exp(e.deltaY * 0.01), 0.42, 1.6); dirty = true;
  }, { passive: false });
  canvas.addEventListener('dblclick', () => closeUp(!close));
  canvas.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: [0.3, 0], ArrowRight: [-0.3, 0], ArrowUp: [0, -0.2], ArrowDown: [0, 0.2] }[e.key];
    if (step) { e.preventDefault(); stopAll(); goal = { az: az + step[0], pol: THREE.MathUtils.clamp(pol + step[1], 0.35, Math.PI - 0.35), d: zoom }; return; }
    if (e.key === '+' || e.key === '=') { stopAll(); goal = { az, pol, d: THREE.MathUtils.clamp(zoom * 0.8, 0.42, 1.6) }; }
    else if (e.key === '-' || e.key === '_') { stopAll(); goal = { az, pol, d: THREE.MathUtils.clamp(zoom * 1.25, 0.42, 1.6) }; }
    else if (e.key === 'Home' || e.key === 'Escape') { stopAll(); closeUp(false); }
  });

  // ---- the loop: only while the section is on screen and the tab is visible; the face at 30 fps ----
  let visible = true, raf = 0, last = performance.now(), ledAt = 0;
  function frame(now) {
    raf = 0;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (spinning) { az += SPIN * dt; dirty = true; }
    else if (Math.abs(vAz) > 0.01 && !pointers.size) { az += vAz * dt; vAz *= Math.exp(-dt / 0.28); dirty = true; }
    if (goal) {
      const k = 1 - Math.exp(-dt / 0.32), da = wrap(goal.az - az);
      az += da * k; pol += (goal.pol - pol) * k; zoom += (goal.d - zoom) * k;
      if (Math.abs(da) < 0.002 && Math.abs(goal.pol - pol) < 0.002 && Math.abs(goal.d - zoom) < 0.002) goal = null;
      dirty = true;
    }
    if (now - ledAt >= 1000 / 30 - 4) { ledAt = now; led.tick(now); tex.needsUpdate = true; dirty = true; }
    if (dirty) {
      dist = fitD * zoom;
      const s = Math.sin(pol);
      cam.position.set(dist * s * Math.sin(az), dist * Math.cos(pol), dist * s * Math.cos(az));
      cam.lookAt(0, 0, 0);
      renderer.render(scene, cam);
      dirty = false;
    }
    if (visible && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function run() { if (!raf && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  if ('IntersectionObserver' in window) new IntersectionObserver((e) => { visible = e[0].isIntersecting; run(); }, { rootMargin: '80px' }).observe(canvas);
  document.addEventListener('visibilitychange', run);
  if (window.ResizeObserver) new ResizeObserver(fit).observe(canvas); else addEventListener('resize', fit);
  fit();
  setFrame(o.frame);
  setRail(o.rail);
  await idle();
  // draw once now, so the poster can step aside on a finished frame
  led.tick(performance.now()); tex.needsUpdate = true;
  dist = fitD * zoom;
  cam.position.set(dist * Math.sin(pol) * Math.sin(az), dist * Math.cos(pol), dist * Math.sin(pol) * Math.cos(az));
  cam.lookAt(0, 0, 0);
  renderer.render(scene, cam);
  run();
  o.onSpin && o.onSpin(spinning);
  return { setFrame, setRail, setSpin, spinning: () => spinning, closeUp, close: () => close, renderer };
}
