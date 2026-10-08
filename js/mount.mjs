/* mooboard.co/start + the mounting steps in 3d + js/start.js loads this only at the mounting card + three.js and the
   viewer's model reader come in by the page's import map

   the board is the homepage model assets/3d/board.glb without its own rail and hooks + the rail and both hooks come
   from assets/3d/rail.glb with the places the steps use as empty nodes (at_wall at_top at_pocket_1..4 at_screw_1..3
   at_hole_l at_hole_r at_latch at_entry at_click) all as the board hangs + a new rail is a new rail.glb with the same
   names and nothing here changes

   each way is a list of steps + a step sets the scene from its own time + the state at a moment is every earlier step
   played to its end and then this one to that time + so any step can be shown or played from its start */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { readGLB, loadModel, FINISH, RAILS } from './viewer.mjs';

const BOARD = '/assets/3d/board.glb';
const RAIL = '/assets/3d/rail.glb';
const RED = { color: '#BB3D43', rough: 0.6 };   // the red edition frame as the tour paints it
const TEAL = '#2FD3B6';                          // the brand teal a shade deeper so it reads on a light wall
const FOV = 24;
// a clicked pair of large adhesive strips + the wall mounts page's numbers + its tab is part of its length
const STRIP = { len: 92.7, w: 19.05, tab: 19.05, t: 3.2, pocket: 1.0 };
const STRIP_OUT = STRIP.t - STRIP.pocket;   // 2.2 + how far the strips hold the rail off the wall
const HELD = 260;                            // how far from the wall the rail is held before it goes up
const SCREW = { head: 4.8, headH: 2.6, shank: 2.0, len: 30 };   // an m4 x 30 truss head screw
const TILT = 0.035;                          // the rail's tilt before the level rights it

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const out = (k) => 1 - Math.pow(1 - k, 3);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const pulse = (t, a, b) => (t < a || t > b ? -1 : (t - a) / (b - a));

// the time a tool that visits the holes from t0 every `each` seconds is all the way in at hole n
const inAt = (t0, each, push, n) => t0 + n * each + (0.25 + push * 0.5) * each;
// where ease(k) reaches v
function easeTo(v) {
  let a = 0, b = 1;
  for (let i = 0; i < 30; i++) { const m = (a + b) / 2; if (ease(m) < v) a = m; else b = m; }
  return (a + b) / 2;
}

// ---- the steps + each one's length in seconds + the camera's moves + what it sets at its time t ----
// the rail goes up level + it comes in tilted and rights itself as the level settles on it
function railUp(S, t, from, t0, t1) {
  const k = ease(seg(t, t0, t1));
  S.rail = { ...S.rail, x: 0, y: 0, z: lerp(from, 0, k), o: 1, rz: TILT * (1 - ease(seg(t, t1 + 0.1, t1 + 1.0))) };
  S.level = seg(t, t1 - 0.4, t1 + 0.1);
}
// the two hanging steps are the same for every way + the studs go in at the round holes and drop + a lift and a slide
// left until the latch clicks as the round 3 rail has it + the board shows as an x-ray with its hooks in teal meanwhile
function hangSteps(A) {
  const toHole = { x: A.entry.x, y: 0.3 };   // the hooks' studs centred on the round holes
  const slide = [0.6, 2.4];
  const tClick = slide[0] + easeTo((A.entry.x - A.click.x) / A.entry.x) * (slide[1] - slide[0]);
  return [
    { dur: 3.8, cam: [[0, 1.8, 'hang']], still: 3.8,
      set(S, t) {
        S.clock = -1; S.level = 0; S.press = -1; S.seat = -1;
        const k = ease(seg(t, 0.3, 2.3)), push = ease(seg(t, 2.6, 3.3)), drop = seg(t, 3.35, 3.6);
        S.board = { x: toHole.x, y: lerp(toHole.y, A.entry.y, drop), z: lerp(lerp(HELD, 16, k), 0, push), o: seg(t, 0, 0.3), g: seg(t, 0.2, 1.2) };
        S.targets = S.still ? 0.3 : t < 0.6 || t > 3.3 ? -1 : (t - 0.6) % 1.0;
      } },
    { dur: 4.0, cam: [[2.6, 4.0, 'hung']], still: 2.5,
      set(S, t) {
        S.targets = -1;
        const lift = out(seg(t, 0.1, 0.5)), k = ease(seg(t, slide[0], slide[1]));
        S.board = { x: lerp(A.entry.x, 0, k), y: lerp(A.entry.y, 0, lift), z: 0, o: 1, g: 1 - seg(t, 2.8, 3.6) };
        S.arrow = S.still ? 0.5 : t < 0.4 || t > 2.6 ? -1 : seg(t, 0.4, 2.6);
        S.click = S.still ? 0.3 : pulse(t, tClick, tClick + 0.8);
      } },
  ];
}

function ways(A) {
  return {
    strips: {
      standoff: STRIP_OUT,
      start: () => ({ rail: { x: 0, y: 0, z: HELD, ry: Math.PI, o: 1, rz: 0 }, strips: [0, 0, 0, 0], cam: 'railBack' }),
      steps: [
        { dur: 3.6, cam: [], still: 3.6,
          set(S, t) { S.strips = S.strips.map((_, k) => out(seg(t, 0.5 + 0.5 * k, 1.2 + 0.5 * k))); } },
        { dur: 5.0, cam: [[0.2, 2.6, 'railWall']], still: 5.0,
          set(S, t) {
            S.rail = { ...S.rail, ry: lerp(Math.PI, 0, ease(seg(t, 0, 1.3))) };
            railUp(S, t, HELD, 0.7, 2.5);
            S.press = S.still ? 0.3 : pulse(t, 3.6, 4.9);
          } },
        { dur: 2.8, cam: [], still: 2.8,
          set(S, t) { S.press = -1; S.level = 1 - seg(t, 0, 0.4); S.clock = seg(t, 0.2, 2.6); } },
        ...hangSteps(A),
      ],
    },
    screws: {
      standoff: 0,
      start: () => ({ rail: { x: 0, y: 0, z: HELD, ry: 0, o: 1, rz: 0 }, cam: 'railWall' }),
      steps: [
        { dur: 3.4, cam: [], still: 3.4,
          set(S, t) { railUp(S, t, HELD, 0.2, 1.9); } },
        { dur: 4.6, cam: [[0, 1.0, 'railClose']], still: 3.55,
          set(S, t) {
            S.level = 1 - seg(t, 0, 0.4);
            S.pencil = tool(t, 0.6, 1.15, 4.6, 0.45, 0.25);
            S.marks = [0, 1, 2].map((k) => seg(t, inAt(0.6, 1.15, 0.45, k) - 0.1, inAt(0.6, 1.15, 0.45, k) + 0.05));
          } },
        { dur: 5.2, cam: [[0, 1.0, 'drill']], still: 4.5,
          set(S, t) {
            S.pencil = null;
            const k = ease(seg(t, 0, 1.0));
            S.rail = { ...S.rail, y: lerp(0, 40, k), z: lerp(0, 170, k), o: 1 - seg(t, 0.4, 1.0) };
            S.drill = tool(t, 1.2, 1.25, 5.0, 0.4, 0.4);
            S.holes = [0, 1, 2].map((j) => seg(t, inAt(1.2, 1.25, 0.4, j) - 0.05, inAt(1.2, 1.25, 0.4, j) + 0.15));
          } },
        { dur: 4.6, cam: [[0, 1.2, 'railClose']], still: 4.6,
          set(S, t) {
            S.drill = null;
            const k = ease(seg(t, 0, 1.2));
            S.rail = { ...S.rail, y: lerp(40, 0, k), z: lerp(170, 0, k), o: seg(t, 0, 0.6) };
            S.screws = [0, 1, 2].map((j) => (t < 1.2 + j * 0.9 ? -1 : ease(seg(t, 1.3 + j * 0.9, 2.3 + j * 0.9))));
            S.seat = [0, 1, 2].map((j) => (S.still ? 0.3 : pulse(t, 2.3 + j * 0.9, 3.0 + j * 0.9)));
          } },
        ...hangSteps(A),
      ],
    },
  };
}

// a tool that visits the three holes one after another + from t0 every `each` seconds + it comes in and goes in at
// each hole + leaves at `gone` + `push` and `hold` are the share of a visit spent going in and staying in
function tool(t, t0, each, gone, push, hold) {
  if (t < t0 - 0.35 || t > gone + 0.35) return null;
  const o = seg(t, t0 - 0.35, t0) * (1 - seg(t, gone, gone + 0.35));
  const n = Math.min(2, Math.max(0, Math.floor((t - t0) / each)));
  const u = clamp01((t - t0 - n * each) / each);
  const goIn = seg(u, 0.25, 0.25 + push * 0.5), goOut = seg(u, 0.25 + push * 0.5 + hold * 0.5, 0.95);
  const from = n === 0 ? 0 : n - 1;
  const move = ease(seg(u, 0, 0.25));
  return { o, at: lerp(from, n, n === 0 ? 1 : move), k: ease(goIn) * (1 - ease(goOut)), spin: u };
}

// ---- the models ----
function ledDots() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#050608'; x.fillRect(0, 0, 1024, 256);
  x.fillStyle = '#18171C';
  for (let j = 0; j < 32; j++) for (let i = 0; i < 128; i++) { x.beginPath(); x.arc(i * 8 + 4, j * 8 + 4, 2.7, 0, 6.3); x.fill(); }
  return c;
}
function shadows(o, cast) { o.traverse((m) => { if (m.isMesh) m.castShadow = cast; }); }
function std(color, rough, metal = 0) { return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }); }

function makeStrip(left) {
  const g = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.BoxGeometry(STRIP.len - STRIP.tab, STRIP.w, STRIP.t), std('#F4F3EF', 0.92));
  const tab = new THREE.Mesh(new THREE.BoxGeometry(STRIP.tab, STRIP.w, 0.8), std('#DAD7D0', 0.8));
  const dir = left ? -1 : 1;
  pad.position.x = -dir * STRIP.tab / 2;
  tab.position.x = dir * (STRIP.len - STRIP.tab) / 2;
  g.add(pad, tab);
  return g;
}
function makeLevel() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(200, 22, 26), std('#C9CED1', 0.45, 0.35));
  const face = new THREE.Mesh(new THREE.BoxGeometry(46, 13, 1), std('#1F2629', 0.6));
  face.position.z = 13.2;
  const vial = new THREE.Mesh(new THREE.CapsuleGeometry(4, 28, 4, 12), std('#C9EE6A', 0.25));
  vial.rotation.z = Math.PI / 2; vial.position.z = 14;
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(3.3, 14, 10), std('#FBFFF2', 0.2));
  bubble.position.z = 16.6;
  const tick = std('#1F2629', 0.6);
  for (const x of [-6.2, 6.2]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 10, 0.6), tick); m.position.set(x, 0, 18.4); g.add(m); }
  g.add(body, face, vial, bubble);
  g.userData.bubble = bubble;
  return g;
}
function makePencil() {
  const g = new THREE.Group();
  const wood = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 120, 6), std('#F2B632', 0.6));
  wood.position.y = 74;
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 0.9, 12, 6), std('#E8C79A', 0.8));
  cone.position.y = 8;
  const lead = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.1, 2.5, 8), std('#2B2B2E', 0.5));
  lead.position.y = 1.25;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(3.7, 3.7, 9, 12), std('#F38BA8', 0.7));
  cap.position.y = 138;
  g.add(wood, cone, lead, cap);
  g.rotation.x = Math.PI / 2;   // its point toward the wall
  const holder = new THREE.Group();
  holder.add(g);
  return holder;
}
function makeDrill() {
  const g = new THREE.Group(), spin = new THREE.Group();
  const bit = new THREE.Mesh(new THREE.CylinderGeometry(3, 2.4, 56, 12), std('#9AA2A8', 0.35, 0.8));
  bit.rotation.x = Math.PI / 2; bit.position.z = 28;
  const chuck = new THREE.Mesh(new THREE.CylinderGeometry(9, 11, 28, 18), std('#2A3034', 0.5, 0.3));
  chuck.rotation.x = Math.PI / 2; chuck.position.z = 70;
  spin.add(bit, chuck);
  const ink = std('#24313A', 0.55), teal = std(TEAL, 0.5);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(21, 80, 6, 18), ink);
  body.rotation.x = Math.PI / 2; body.position.z = 138;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(21.6, 21.6, 9, 24), teal);
  band.rotation.x = Math.PI / 2; band.position.z = 100;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(26, 92, 32), ink);
  grip.position.set(0, -58, 160); grip.rotation.x = -0.18;
  const pack = new THREE.Mesh(new THREE.BoxGeometry(52, 24, 66), teal);
  pack.position.set(0, -110, 168);
  g.add(spin, body, band, grip, pack);
  g.userData.spin = spin;
  return g;
}
function makeScrew() {
  const g = new THREE.Group(), steel = std('#4A4E54', 0.32, 0.75);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(SCREW.head * 0.86, SCREW.head, SCREW.headH, 20), steel);
  head.rotation.x = Math.PI / 2; head.position.z = SCREW.headH / 2;
  const slot = std('#111214', 0.7);
  for (const r of [0, Math.PI / 2]) { const s = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.1, 0.8), slot); s.rotation.z = r; s.position.z = SCREW.headH + 0.1; g.add(s); }
  const shank = new THREE.Mesh(new THREE.CylinderGeometry(SCREW.shank, SCREW.shank * 0.7, SCREW.len, 12), steel);
  shank.rotation.x = Math.PI / 2; shank.position.z = -SCREW.len / 2;
  g.add(head, shank);
  return g;
}
// a flat teal ring that grows and fades + drawn over everything so it shows through the x-ray board
function ring(r0 = 7, r1 = 10) {
  const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 40), new THREE.MeshBasicMaterial({ color: TEAL, transparent: true, depthTest: false }));
  m.renderOrder = 10;
  return m;
}
function arrowLeft() {
  const s = new THREE.Shape();
  s.moveTo(-34, 0); s.lineTo(-12, 15); s.lineTo(-12, 6); s.lineTo(34, 6); s.lineTo(34, -6); s.lineTo(-12, -6); s.lineTo(-12, -15); s.closePath();
  const m = new THREE.Mesh(new THREE.ShapeGeometry(s), new THREE.MeshBasicMaterial({ color: TEAL, transparent: true, depthTest: false }));
  m.renderOrder = 11;
  return m;
}
function disc(r, color) {
  return new THREE.Mesh(new THREE.CircleGeometry(r, 20), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 }));
}

export async function create(o) {
  const [boardBuf, railBuf] = await Promise.all([loadModel(BOARD), loadModel(RAIL)]);
  const canvas = o.canvas;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const wallColor = new THREE.Color(o.wall || '#ECEAE5');
  scene.background = wallColor;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.7;
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f8c, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-300, 520, 700);
  key.target.position.set(0, 0, -20);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -460, right: 460, top: 360, bottom: -360, near: 200, far: 2400 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.8;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0xd2fbf2, 0.5);
  rim.position.set(420, 180, 300);
  scene.add(rim);

  const B = readGLB(boardBuf), R = readGLB(railBuf);
  const at = (n) => {
    const node = R.root.getObjectByName(n);
    if (!node) throw new Error('rail.glb has no ' + n);
    return node.position.clone();
  };
  const A = {
    wall: at('at_wall'), top: at('at_top'), latch: at('at_latch'), entry: at('at_entry'), click: at('at_click'),
    holes: [at('at_hole_l'), at('at_hole_r')], pockets: [1, 2, 3, 4].map((k) => at('at_pocket_' + k)),
    screws: [1, 2, 3].map((k) => at('at_screw_' + k)),
  };
  A.front = A.holes[0].z;
  const WAYS = ways(A);

  // the wall + it only takes shadows
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(8000, 5000), new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.97 }));
  wall.position.z = A.wall.z - 0.05;
  wall.receiveShadow = true;
  scene.add(wall);

  // the board + its own rail and hooks hidden + the hooks of rail.glb on it where the cad puts them
  const board = new THREE.Group();
  for (const n of ['rail', 'hook_l', 'hook_r']) { const x = B.root.getObjectByName(n); if (x) x.visible = false; }
  board.add(B.root);
  const railMat = R.mats.find((m) => m.name === 'rail');
  const rc = RAILS[o.rail] || RAILS.black;
  railMat.color.set(rc.color); railMat.roughness = rc.rough; railMat.metalness = 0;
  const hookMat = railMat.clone();
  const hookColor = hookMat.color.clone(), teal = new THREE.Color(TEAL);
  for (const n of ['hook_l', 'hook_r']) {
    const h = R.root.getObjectByName(n);
    h.traverse((m) => { if (m.isMesh) m.material = hookMat; });
    board.add(h);
  }
  // the frame in the board's own finish as the viewer paints it
  const finish = { ...FINISH, red: RED }[o.frame] || FINISH.black;
  const frameMat = B.mats.find((m) => m.name === 'frame');
  if (frameMat) {
    frameMat.color.set(finish.color); frameMat.roughness = finish.rough; frameMat.metalness = 0;
    frameMat.emissive.set(finish.emissive || '#000000'); frameMat.emissiveIntensity = finish.ei || 0;
  }
  const ledTex = new THREE.CanvasTexture(ledDots());
  ledTex.colorSpace = THREE.SRGBColorSpace;
  ledTex.flipY = false;
  const ledMat = new THREE.MeshBasicMaterial({ map: ledTex });
  B.root.getObjectByName('led_face').traverse((m) => { if (m.isMesh) m.material = ledMat; });
  // the x-ray: each part's edges in ink over a faint fill + only while the hooks go on
  const edgeMat = new THREE.LineBasicMaterial({ color: '#0E1A22', transparent: true, opacity: 0, depthWrite: false });
  const edges = [];
  B.root.traverse((m) => {
    if (!m.isMesh || !m.visible || m.parent.visible === false) return;
    const l = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 32), edgeMat);
    l.visible = false;
    m.add(l);
    edges.push(l);
  });
  const ghostMats = B.mats.filter((m) => m.name !== 'led' && m.name !== 'rail').concat(ledMat);
  const baseOpacity = new Map(ghostMats.map((m) => [m, m === frameMat && finish.opacity != null ? finish.opacity : 1]));
  shadows(board, true);
  scene.add(board);

  // the rail turns about its own middle + its strips and level ride with it
  const railMesh = R.root.getObjectByName('rail');
  const C = new THREE.Box3().setFromObject(railMesh).getCenter(new THREE.Vector3());
  const railPivot = new THREE.Group(), railInner = new THREE.Group();
  railPivot.position.copy(C);
  railInner.position.copy(C).negate();
  railPivot.add(railInner);
  railInner.add(railMesh);
  const stripEdge = new THREE.LineBasicMaterial({ color: '#7d8a8f', transparent: true, opacity: 0.6 });
  const strips = A.pockets.map((p, k) => {
    const s = makeStrip(k % 2 === 0);
    s.children.forEach((m) => m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), stripEdge)));
    s.position.set(p.x, p.y, p.z - STRIP.t / 2);
    s.userData.home = s.position.clone();
    railInner.add(s);
    return s;
  });
  // the level stands on the rail's top edge with its back to the wall
  const level = makeLevel();
  const levelHome = new THREE.Vector3(A.top.x, A.top.y + 11, A.wall.z + 13.5);
  level.position.copy(levelHome);
  railPivot.add(level);
  level.position.sub(C);
  const levelLocal = level.position.clone();
  shadows(railPivot, true);
  scene.add(railPivot);

  // the tools and what they leave on the wall
  const pencil = makePencil(), drill = makeDrill();
  shadows(pencil, true); shadows(drill, true);
  scene.add(pencil, drill);
  const marks = A.screws.map((p) => { const d = disc(2.2, '#45464A'); d.position.set(p.x, p.y, A.wall.z + 0.08); scene.add(d); return d; });
  const holes = A.screws.map((p) => { const d = disc(3.1, '#141416'); d.position.set(p.x, p.y, A.wall.z + 0.12); scene.add(d); return d; });
  const screws = A.screws.map(() => { const s = makeScrew(); shadows(s, true); scene.add(s); return s; });
  const presses = A.pockets.map(() => { const r = ring(); scene.add(r); return r; });
  const seats = A.screws.map(() => { const r = ring(6, 8.5); scene.add(r); return r; });
  const targets = A.holes.map(() => { const r = ring(5.5, 8); scene.add(r); return r; });
  const click = ring();
  const arrow = arrowLeft();
  scene.add(click, arrow);

  const cam = new THREE.PerspectiveCamera(FOV, 1, 10, 9000);
  let aspect = 1;
  const SHOTS = {
    railBack: { t: [0, C.y, C.z + HELD], az: 0.5, el: 0.34, w: 330, h: 170 },
    railWall: { t: [0, C.y + 6, C.z], az: -0.42, el: 0.22, w: 390, h: 190 },
    railClose: { t: [0, C.y - 4, C.z], az: -0.36, el: 0.16, w: 320, h: 160 },
    drill: { t: [0, A.screws[0].y - 52, A.wall.z + 70], az: -1.0, el: 0.22, w: 470, h: 300 },
    hang: { t: [-24, 6, 30], az: -0.58, el: 0.4, w: 720, h: 360 },
    hung: { t: [0, 0, 0], az: -0.36, el: 0.16, w: 640, h: 250 },
  };
  function shotCam(name) {
    const s = SHOTS[name], tv = Math.tan(THREE.MathUtils.degToRad(FOV / 2)), th = tv * aspect;
    return { t: s.t, az: s.az, el: s.el, d: Math.max(s.w / 2 / th, s.h / 2 / tv) };
  }
  function mix(a, b, k) {
    return { t: [0, 1, 2].map((i) => lerp(a.t[i], b.t[i], k)), az: a.az + wrap(b.az - a.az) * k, el: lerp(a.el, b.el, k),
      d: Math.exp(lerp(Math.log(a.d), Math.log(b.d), k)) };
  }

  // ---- the state at a moment + every earlier step played to its end and then this one to t ----
  function stateAt(way, step, t, still) {
    const W = WAYS[way];
    const S = { rail: { x: 0, y: 0, z: HELD, ry: 0, rz: 0, o: 1 }, board: { x: 0, y: 0, z: 0, o: 0, g: 0 }, strips: null, level: 0,
      pencil: null, marks: [0, 0, 0], drill: null, holes: [0, 0, 0], screws: [-1, -1, -1], seat: -1, press: -1, targets: -1,
      arrow: -1, click: -1, clock: -1, ...W.start() };
    let camName = S.cam;
    for (let i = 0; i <= step; i++) {
      const st = W.steps[i];
      S.still = !!still && i === step;
      st.set(S, i < step ? st.dur : t);
      if (i < step) for (const m of st.cam) camName = m[2];
    }
    // the camera sets off from where the last step left it
    let c = shotCam(camName);
    for (const [t0, t1, name] of W.steps[step].cam) {
      const to = shotCam(name);
      if (t >= t1) { c = to; continue; }
      if (t > t0) c = mix(c, to, ease((t - t0) / (t1 - t0)));
      break;
    }
    S.camera = peek ? { t: peek.t, az: peek.az, el: peek.el, d: Math.max(peek.w / 2 / (Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * aspect), peek.h / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2))) } : c;
    S.standoff = W.standoff;
    return S;
  }

  let ghostNow = -1, peek = null;
  function ghost(g) {
    if (Math.abs(g - ghostNow) < 1e-4) return;
    ghostNow = g;
    for (const m of ghostMats) {
      const op = baseOpacity.get(m) * (1 - 0.86 * g), see = op < 0.999;
      if (m.transparent !== see) { m.transparent = see; m.needsUpdate = true; }
      m.opacity = op;
      m.depthWrite = op > 0.6;
    }
    edgeMat.opacity = 0.5 * g;
    for (const l of edges) l.visible = g > 0.01;
    hookMat.color.lerpColors(hookColor, teal, g);
    shadows(board, g < 0.35);
  }
  function fade(m, op) {
    const see = op < 0.999;
    if (m.transparent !== see) { m.transparent = see; m.needsUpdate = true; }
    m.opacity = op;
  }
  function grow(r, p, at, from, to) {
    r.visible = p >= 0 && p < 1;
    if (!r.visible) return;
    r.position.copy(at);
    r.scale.setScalar(lerp(from, to, out(p)));
    r.material.opacity = (1 - p) * 0.95;
  }
  function apply(S) {
    const z0 = S.standoff;
    railPivot.position.set(C.x + S.rail.x, C.y + S.rail.y, C.z + S.rail.z + z0);
    railPivot.rotation.set(0, S.rail.ry, S.rail.rz || 0);
    railPivot.visible = S.rail.o > 0.001;
    fade(railMat, S.rail.o);
    strips.forEach((s, k) => {
      const p = S.strips ? S.strips[k] : -1;
      s.visible = p >= 0;
      if (p >= 0) s.position.set(s.userData.home.x, s.userData.home.y, s.userData.home.z - (1 - p) * 150);
    });
    // the level settles on the rail and keeps itself level + its bubble shows the rail's tilt
    level.visible = S.level > 0.01;
    level.position.copy(levelLocal);
    level.position.y += (1 - out(S.level)) * 40;
    level.userData.bubble.position.x = (S.rail.rz || 0) * 260;
    board.visible = S.board.o > 0.001;
    board.position.set(S.board.x, S.board.y, S.board.z + z0);
    ghost(S.board.g);
    // the tools at the screw holes + the pencil's point and the drill's bit reach the wall when in
    const between = (i) => {
      const a = A.screws[Math.floor(i)], b = A.screws[Math.min(2, Math.ceil(i))], f = i - Math.floor(i);
      return [lerp(a.x, b.x, f), lerp(a.y, b.y, f)];
    };
    pencil.visible = !!S.pencil;
    if (S.pencil) {
      const [x, y] = between(S.pencil.at);
      pencil.position.set(x, y, A.wall.z + lerp(60, 0.3, S.pencil.k));
      pencil.rotation.set(-0.78, 0.2, 0);
    }
    drill.visible = !!S.drill;
    if (S.drill) {
      const [x, y] = between(S.drill.at);
      drill.position.set(x, y, A.wall.z + lerp(36, -8, S.drill.k));
      drill.userData.spin.rotation.z = S.drill.k > 0.02 ? S.drill.spin * 90 : 0;
    }
    marks.forEach((d, k) => { d.material.opacity = S.marks[k]; d.visible = S.marks[k] > 0; });
    holes.forEach((d, k) => { d.material.opacity = S.holes[k]; d.visible = S.holes[k] > 0; });
    screws.forEach((s, k) => {
      const p = S.screws[k];
      s.visible = p >= 0;
      if (p >= 0) {
        const h = A.screws[k];
        s.position.set(h.x, h.y, h.z + z0 + (1 - p) * 46);
        s.rotation.z = -p * 14;
      }
    });
    const v = new THREE.Vector3();
    seats.forEach((r, k) => grow(r, S.seat === -1 ? -1 : S.seat[k], v.set(A.screws[k].x, A.screws[k].y, A.front + z0 + 0.8), 0.8, 2));
    presses.forEach((r, k) => {
      const q = S.press < 0 ? -1 : clamp01((S.press - (k >> 1) * 0.15) / 0.75);
      grow(r, q < 1 ? q : -1, v.set(A.pockets[k].x, A.pockets[k].y, A.front + z0 + 0.6), 0.6, 1.9);
    });
    targets.forEach((r, k) => grow(r, S.targets, v.set(A.holes[k].x, A.holes[k].y, A.front + z0 + 0.6), 0.7, 1.9));
    grow(click, S.click, v.set(A.latch.x, A.latch.y, A.latch.z + z0 + 1), 0.5, 2.6);
    arrow.visible = S.arrow >= 0;
    if (arrow.visible) {
      arrow.position.set(S.board.x - 40, 112, z0 + 30);
      arrow.material.opacity = Math.min(1, S.arrow * 5, (1 - S.arrow) * 5);
    }
    if (o.clock) {
      o.clock.style.opacity = S.clock < 0 ? 0 : Math.min(1, S.clock * 6);
      o.clock.style.setProperty('--turn', (S.clock < 0 ? 0 : S.clock * 360) + 'deg');
    }
    const c = S.camera, se = Math.sin(c.el), ce = Math.cos(c.el);
    cam.position.set(c.t[0] + c.d * ce * Math.sin(c.az), c.t[1] + c.d * se, c.t[2] + c.d * ce * Math.cos(c.az));
    cam.lookAt(c.t[0], c.t[1], c.t[2]);
    arrow.quaternion.copy(cam.quaternion);
  }

  // ---- playing + the render loop runs only while it plays on a card that shows ----
  let way = 'strips', step = 0, time = 0, playing = false, live = true, raf = 0, last = 0, held = false;
  function draw() { apply(stateAt(way, step, time, held)); renderer.render(scene, cam); }
  function tick(now) {
    raf = 0;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (playing) {
      const steps = WAYS[way].steps;
      time += dt;
      while (playing && time >= steps[step].dur) {
        if (step + 1 < steps.length) { time -= steps[step].dur; step++; o.onStep && o.onStep(way, step); }
        else { time = steps[step].dur; playing = false; o.onEnd && o.onEnd(way); }
      }
      o.onTime && o.onTime(way, step, time / steps[step].dur);
    }
    draw();
    run();
  }
  function run() {
    if (raf || !playing || !live || document.hidden) return;
    raf = requestAnimationFrame(tick);
  }
  document.addEventListener('visibilitychange', () => { last = performance.now(); run(); });
  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    aspect = w / h;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    if (!raf) draw();
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  else addEventListener('resize', resize);
  resize();

  return {
    steps: (w) => WAYS[w].steps.length,
    // plays a way from one of its steps
    play(w, s = 0) { way = w; step = s; time = 0; playing = true; peek = null; held = false; last = performance.now(); o.onStep && o.onStep(way, step); draw(); run(); },
    // holds a moment + the step's still when no time is given + `look` is a camera of its own for the owner's renders
    show(w, s, t, look) {
      way = w; step = s; playing = false; peek = look || null; held = t == null;
      time = t == null ? WAYS[w].steps[s].still : Math.min(t, WAYS[w].steps[s].dur);
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      draw();
    },
    playing: () => playing,
    // the card shows or not + nothing draws while it is away
    live(on) { live = !!on; if (live) { last = performance.now(); run(); } else if (raf) { cancelAnimationFrame(raf); raf = 0; } },
  };
}
