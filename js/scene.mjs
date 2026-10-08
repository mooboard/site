/* mooboard.co/start in one scene + one three.js scene in the window over the cards + each card has a pose + a change
   of card moves the scene to the new pose in about a second + going back plays it back + a jump goes straight there +
   the mounting card plays the steps of the way picked + the hardware card's camera goes round its four spots + less
   motion cuts from pose to pose and plays nothing by itself

   the board is the homepage model assets/3d/board.glb + its face is the page's live board from js/board.js + the rail
   and its two hooks come from assets/3d/rail.glb with its at_* places as the board hangs + a new rail is a new
   rail.glb with the same names and nothing here changes */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { readGLB, loadModel, FINISH, RAILS, lightEdges, softShadow } from './viewer.mjs';

const BOARD = '/assets/3d/board.glb';
const RAIL = '/assets/3d/rail.glb';
const RED = { color: '#BB3D43', rough: 0.6 };   // the red edition frame as the tour paints it
const TEAL = '#2FD3B6';                          // the brand teal a shade deeper so it reads on a light wall
const FOV = 24;
// a clicked pair of large adhesive strips + the wall mounts page's numbers + its tab is part of its length
const STRIP = { len: 92.7, w: 19.05, tab: 19.05, t: 3.2, pocket: 1.0 };
const STRIP_OUT = STRIP.t - STRIP.pocket;   // 2.2 + how far the strips hold the rail off the wall
const HELD = 260;                            // how far from the wall the rail is held before it goes up
const SCREW = { head: 4.8, headH: 2.6, shank: 2.0, len: 30 };   // a black m4 x 30 truss head screw
// a self-drilling drywall anchor + its rim stays at the wall and its body and point go in
const ANCHOR = { len: 30, rim: 6.6, rimT: 1.4, body: 4.4, out: 0.7 };
const STROKE = { anchor: ANCHOR.len, screw: 34 };   // how far each part travels in as it is screwed home
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
        { dur: 5.8, cam: [[0, 1.0, 'anchors']], still: 4.85,
          set(S, t) {
            S.pencil = null;
            const k = ease(seg(t, 0, 1.0));
            S.rail = { ...S.rail, y: lerp(0, 40, k), z: lerp(0, 170, k), o: 1 - seg(t, 0.4, 1.0) };
            const d = drive(A, t, 1.2, 1.4, STROKE.anchor);
            S.anchors = d.parts;
            S.driver = d.tool && { ...d.tool, z: A.wall.z + ANCHOR.out + d.tool.off };
            S.seat = d.home.map((h, j) => (S.still ? (h ? 0.3 : -1) : pulse(t, d.homeAt[j], d.homeAt[j] + 0.7)));
            S.seatOn = 'wall';
          } },
        { dur: 6.0, cam: [[0, 1.2, 'screwIn']], still: 5.05,
          set(S, t) {
            const k = ease(seg(t, 0, 1.2));
            S.rail = { ...S.rail, y: lerp(40, 0, k), z: lerp(170, 0, k), o: seg(t, 0, 0.6) };
            const d = drive(A, t, 1.4, 1.4, STROKE.screw);
            S.screws = d.parts;
            S.driver = d.tool && { ...d.tool, z: A.screws[0].z + SCREW.headH + d.tool.off };
            S.seat = d.home.map((h, j) => (S.still ? (h ? 0.3 : -1) : pulse(t, d.homeAt[j], d.homeAt[j] + 0.7)));
            S.seatOn = 'rail';
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

// one screwdriver carries a part to each of the three marks from t0 every `each` seconds + turns it home + backs off
// + the part sits on its tip until it is home + `stroke` is how far a part goes in + where the driver and parts are
function drive(A, t, t0, each, stroke) {
  const res = { tool: null, parts: [null, null, null], home: [false, false, false], homeAt: [0, 1, 2].map((j) => t0 + (j + 0.8) * each) };
  if (t < t0 - 0.3) return res;
  const n = Math.min(2, Math.max(0, Math.floor((t - t0) / each)));
  const u = clamp01((t - t0 - n * each) / each);
  const at = n === 0 ? 0 : lerp(n - 1, n, ease(seg(u, 0, 0.25)));
  const a = A.screws[Math.floor(at)], b = A.screws[Math.min(2, Math.ceil(at))], f = at - Math.floor(at);
  const x = lerp(a.x, b.x, f), y = lerp(a.y, b.y, f), p = ease(seg(u, 0.3, 0.8));
  for (let j = 0; j < n; j++) { res.parts[j] = { x: A.screws[j].x, y: A.screws[j].y, off: 0, turn: 1 }; res.home[j] = true; }
  res.parts[n] = u < 0.3 ? { x, y, off: stroke, turn: 0 } : { x: A.screws[n].x, y: A.screws[n].y, off: stroke * (1 - p), turn: p };
  res.home[n] = u >= 0.8;
  const o = seg(t, t0 - 0.3, t0) * (1 - seg(t, t0 + 3 * each - 0.1, t0 + 3 * each + 0.25));
  res.tool = { x, y, off: u < 0.8 ? stroke * (1 - p) : stroke * ease(seg(u, 0.8, 1)), turn: p, o };
  return res;
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
function makeDriver() {
  const g = new THREE.Group(), steel = std('#A9B0B6', 0.3, 0.85);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(2.3, 5, 4), steel);
  tip.rotation.x = -Math.PI / 2; tip.position.z = 2.5;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 70, 12), steel);
  shaft.rotation.x = Math.PI / 2; shaft.position.z = 40;
  const ink = std('#24313A', 0.55), teal = std(TEAL, 0.5);
  const handle = new THREE.Mesh(new THREE.CapsuleGeometry(10.5, 60, 6, 16), ink);
  handle.rotation.x = Math.PI / 2; handle.position.z = 115.5;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 8, 20), teal);
  band.rotation.x = Math.PI / 2; band.position.z = 88;
  g.add(tip, shaft, handle, band);
  return g;
}
// the rim's front face at the origin + the body and its coarse thread go in along -z
function makeAnchor() {
  const g = new THREE.Group(), nylon = std('#D6D9DC', 0.55);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(ANCHOR.rim, ANCHOR.rim, ANCHOR.rimT, 24), nylon);
  rim.rotation.x = Math.PI / 2; rim.position.z = -ANCHOR.rimT / 2;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(ANCHOR.body, 1.1, ANCHOR.len - ANCHOR.rimT, 16), nylon);
  body.rotation.x = Math.PI / 2; body.position.z = -ANCHOR.rimT - (ANCHOR.len - ANCHOR.rimT) / 2;
  g.add(rim, body);
  for (let k = 0; k < 5; k++) {
    const r = lerp(6.0, 3.2, k / 4), th = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.75, 1.3, 20), nylon);
    th.rotation.x = Math.PI / 2; th.position.z = -4.5 - k * 5;
    g.add(th);
  }
  const slot = std('#5C6166', 0.7);
  for (const r of [0, Math.PI / 2]) { const c = new THREE.Mesh(new THREE.BoxGeometry(5.4, 1.2, 0.6), slot); c.rotation.z = r; c.position.z = 0.1; g.add(c); }
  return g;
}
function makeScrew() {
  const g = new THREE.Group(), steel = std('#2A2D31', 0.34, 0.65);
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

// ---- the extras for the box and the wi-fi cards ----
const EDGE = new THREE.LineBasicMaterial({ color: '#56626B', transparent: true, opacity: 0.45, depthWrite: false });
function edged(m) { m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 30), EDGE)); return m; }
// a 20 w usb-c wall charger + a white block with two prongs at the back and a usb-c port at the front
function makeCharger() {
  const g = new THREE.Group(), white = std('#F2F3F1', 0.5), metal = std('#B9BEC3', 0.3, 0.8), slot = std('#2A2D31', 0.6);
  const body = edged(new THREE.Mesh(new THREE.BoxGeometry(33, 33, 28), white));
  for (const x of [-6.3, 6.3]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1.6, 6.4, 16), metal); p.position.set(x, 0, -22); g.add(p); }
  const port = new THREE.Mesh(new THREE.BoxGeometry(9, 3.2, 0.6), slot);
  port.position.set(0, -6, 14.1);
  g.add(body, port);
  return g;
}
// the 2 m usb-c cable coiled in two loops with a plug at each end + it lies in its own xy plane
function makeCoil() {
  const g = new THREE.Group(), ink = std('#2A2E33', 0.55), metal = std('#B9BEC3', 0.3, 0.8);
  for (let i = 0; i < 2; i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(34 - i * 5, 2.2, 10, 56), ink); t.position.z = i * 4.4; g.add(t); }
  for (const [x, y, r] of [[22, -28, -0.65], [-30, 21, 2.5]]) {
    const p = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(22, 12, 6.5), ink), tip = new THREE.Mesh(new THREE.BoxGeometry(7, 8.4, 2.6), metal);
    tip.position.x = 14.5;
    p.add(body, tip);
    p.position.set(x, y, 2.2);
    p.rotation.z = r;
    g.add(p);
  }
  return g;
}
// the cable plugged into the board's usb-c port from below + it hangs straight down + made in the board's own frame
function makePlug() {
  const g = new THREE.Group(), ink = std('#2A2E33', 0.55), metal = std('#B9BEC3', 0.3, 0.8);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(8.4, 6, 2.6), metal);
  tip.position.y = 3;
  const body = new THREE.Mesh(new THREE.BoxGeometry(12, 22, 6.5), ink);
  body.position.y = -11;
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 260, 10), ink);
  cord.position.y = -152;
  g.add(tip, body, cord);
  return g;
}
// a numbered marker for the hardware card + a teal disc with its number + always on top + the same size on any screen
// the caps of BOOT and RESET as the buttons tour draws them + a rounded square with a dot and one with an arrow
const CAPS = [
  ['M12 7.4a4.6 4.6 0 1 0 0 9.2a4.6 4.6 0 1 0 0-9.2z', null],
  ['M11.4 4.2 14.6 6.6 11.4 9z', 'M15.9 8.6A5.4 5.4 0 1 1 12 6.6'],
];
function makeMarker(n) {
  const caps = n === 1, c = document.createElement('canvas');
  c.width = caps ? 272 : 128;
  c.height = 128;
  const x = c.getContext('2d');
  if (caps) {
    // the marker by the buttons + their two caps in ink on white as the hardware row has them
    CAPS.forEach(([fill, line], k) => {
      x.save();
      x.translate(4 + k * 140, 4);
      x.scale(120 / 24, 120 / 24);
      x.fillStyle = '#FFFFFF'; x.strokeStyle = '#0E1A22'; x.lineWidth = 2; x.lineCap = 'round';
      x.beginPath(); x.moveTo(7.5, 1.5);
      x.arcTo(22.5, 1.5, 22.5, 22.5, 6); x.arcTo(22.5, 22.5, 1.5, 22.5, 6); x.arcTo(1.5, 22.5, 1.5, 1.5, 6); x.arcTo(1.5, 1.5, 22.5, 1.5, 6);
      x.closePath(); x.fill(); x.stroke();
      x.fillStyle = '#0E1A22';
      x.fill(new Path2D(fill));
      if (line) x.stroke(new Path2D(line));
      x.restore();
    });
  } else {
    x.fillStyle = '#0E1A22'; x.beginPath(); x.arc(64, 64, 62, 0, 6.3); x.fill();
    x.fillStyle = '#77EDD7'; x.beginPath(); x.arc(64, 64, 55, 0, 6.3); x.fill();
    x.fillStyle = '#0E1A22'; x.font = '800 70px Nunito, system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(String(n), 64, 69);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false }));
  s.renderOrder = 20;
  s.userData.wide = c.width / c.height;
  return s;
}

// ---- the poses ----
// each part's place and turn and size and how much it shows + the camera + the board's face + a pose mixes into the
// next by easing every number and turning every part the short way + a part that comes or goes keeps its place
// unless it rides on the rail
const ACTORS = ['board', 'rail', 'level', 'pencil', 'driver', 'charger', 'coil', 'strip0', 'strip1', 'strip2', 'strip3',
  'screw0', 'screw1', 'screw2', 'screw3', 'screw4', 'anchor0', 'anchor1', 'anchor2'];
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3();
function blank() {
  const a = {};
  for (const n of ACTORS) a[n] = { p: [0, 0, 0], q: [0, 0, 0, 1], s: 1, o: 0 };
  return { a, cam: null, wall: 0, table: 0, floor: 0, plug: 0, markers: 0, marker: 0, ghost: 0, bubble: 0, marks: [0, 0, 0], led: 'off', fx: null };
}
function put(f, name, p, rx = 0, ry = 0, rz = 0, o = 1, s = 1) {
  _q.setFromEuler(_e.set(rx, ry, rz));
  f.a[name] = { p: [p[0], p[1], p[2]], q: [_q.x, _q.y, _q.z, _q.w], s, o };
}
function mixCam(a, b, k) {
  return { t: [0, 1, 2].map((i) => lerp(a.t[i], b.t[i], k)), az: a.az + wrap(b.az - a.az) * k, el: lerp(a.el, b.el, k),
    d: Math.exp(lerp(Math.log(a.d), Math.log(b.d), k)) };
}
// the strips and the level sit on the rail + one that comes or goes while the rail stays rides along with it and fades
// in the first or last part of the move
const RIDERS = ['strip0', 'strip1', 'strip2', 'strip3', 'level'];
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _p = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1);
// x's place on the rail as the rail sat at r + carried to where the rail is at now
function onRail(x, r, now) {
  _m.compose(_p.fromArray(r.p), _q.fromArray(r.q), ONE).invert();
  _m.multiply(_m2.compose(_p.fromArray(x.p), _q.fromArray(x.q), ONE));
  _m2.compose(_p.fromArray(now.p), _q.fromArray(now.q), ONE).multiply(_m).decompose(_p, _q, _v);
  return { p: [_p.x, _p.y, _p.z], q: [_q.x, _q.y, _q.z, _q.w] };
}
function mixFrame(A, B, k) {
  const f = { a: {} };
  for (const n of ACTORS) {
    const a = A.a[n], b = B.a[n];
    if (a.o <= 0.001 && b.o <= 0.001) { f.a[n] = b; continue; }
    const pa = a.o > 0.001 ? a : b, pb = b.o > 0.001 ? b : a;
    _q.fromArray(pa.q); _q2.fromArray(pb.q); _q.slerp(_q2, k);
    f.a[n] = { p: [0, 1, 2].map((i) => lerp(pa.p[i], pb.p[i], k)), q: [_q.x, _q.y, _q.z, _q.w], s: lerp(pa.s, pb.s, k), o: lerp(a.o, b.o, k) };
  }
  const ra = A.a.rail, rb = B.a.rail;
  if (ra.o > 0.001 && rb.o > 0.001) {
    for (const n of RIDERS) {
      const inA = A.a[n].o > 0.001, inB = B.a[n].o > 0.001;
      if (inA === inB) continue;
      Object.assign(f.a[n], onRail(inA ? A.a[n] : B.a[n], inA ? ra : rb, f.a.rail));
      f.a[n].o = inA ? A.a[n].o * (1 - seg(k, 0, 0.45)) : B.a[n].o * seg(k, 0.55, 1);
    }
    // a board that comes onto a rail that moves a long way waits until the rail is nearly home
    const far = Math.hypot(ra.p[0] - rb.p[0], ra.p[1] - rb.p[1], ra.p[2] - rb.p[2]) > 30;
    if (far && A.a.board.o <= 0.001 && B.a.board.o > 0.001) f.a.board.o = B.a.board.o * seg(k, 0.55, 1);
  }
  f.cam = mixCam(A.cam, B.cam, k);
  for (const key of ['wall', 'table', 'floor', 'plug', 'markers', 'ghost', 'bubble']) f[key] = lerp(A[key], B[key], k);
  f.marker = k < 0.5 ? A.marker : B.marker;
  f.marks = [0, 1, 2].map((i) => lerp(A.marks[i], B.marks[i], k));
  f.led = k < 0.4 ? A.led : B.led;
  f.fx = k < 0.5 ? A.fx : B.fx;
  return f;
}

// the hardware card's camera + the whole board with its four markers + then each spot close up + board coordinates
const SPOTS = [
  { t: [0, 0, 0], az: -0.3, el: 0.16, w: 620, h: 270 },
  { t: [218, 64, -12], az: 0.32, el: 0.95, w: 190, h: 130 },
  { t: [184.6, -64, -14], az: 0.38, el: -0.72, w: 190, h: 130 },
  { t: [0, -64, -12], az: -0.12, el: -0.78, w: 190, h: 130 },
  { t: [-259, 0, 5], az: -1.25, el: 0.12, w: 240, h: 160 },
];
const MARKS = [[218, 88, -15], [184.6, -88, -17.7], [0, -90, -13], [-284, 0, 6]];   // where each marker sits by the board
const TOUR = [2.6, 3.0, 3.0, 3.0, 3.0];   // seconds at each spot as the camera goes round + then round again
const MOVE = 1.0;                         // seconds a change of card takes
const USB = [0, -65.8, -13];              // the usb-c port's mouth under the board

export async function create(o) {
  const [boardBuf, railBuf] = await Promise.all([loadModel(BOARD), loadModel(RAIL)]);
  if (document.fonts && document.fonts.load) await document.fonts.load('800 70px Nunito').catch(() => {});
  const canvas = o.canvas, reduced = !!o.reduced;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, matchMedia('(pointer: coarse)').matches ? 1.75 : 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.7;
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f8c, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-300, 620, 700);
  key.target.position.set(0, 0, -20);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -520, right: 520, top: 420, bottom: -420, near: 200, far: 2600 });
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

  // the wall comes in for the mounting and wi-fi cards + the table under the box's parts only takes shadows
  const wallMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(o.wall || '#E6EAED'), roughness: 0.97, transparent: true });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(8000, 5000), wallMat);
  wall.position.z = A.wall.z - 0.05;
  wall.receiveShadow = true;
  const tableMat = new THREE.ShadowMaterial({ opacity: 0.16 });
  const table = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), tableMat);
  table.rotation.x = -Math.PI / 2;
  table.receiveShadow = true;
  scene.add(wall, table);

  // the board + its own rail and hooks hidden + the hooks of rail.glb on it where the cad puts them + its face is the
  // page's live board + the cable that plugs into it + the four markers of the hardware card
  const board = new THREE.Group();
  for (const n of ['rail', 'hook_l', 'hook_r']) { const x = B.root.getObjectByName(n); if (x) x.visible = false; }
  board.add(B.root);
  const railMat = R.mats.find((m) => m.name === 'rail');
  const rc = RAILS[o.rail] || RAILS.black;
  railMat.color.set(rc.color); railMat.roughness = rc.rough; railMat.metalness = 0;
  const hookMat = railMat.clone();
  const hookColor = hookMat.color.clone(), teal = new THREE.Color(TEAL);
  const outlines = { board: [], rail: [] };   // a light part's outline + it fades as its part does
  for (const n of ['hook_l', 'hook_r']) {
    const h = R.root.getObjectByName(n);
    h.traverse((m) => { if (m.isMesh) m.material = hookMat; });
    outlines.board.push(lightEdges(h, ['rail']).material);
    board.add(h);
  }
  const finish = { ...FINISH, red: RED }[o.frame] || FINISH.black;
  const frameMat = B.mats.find((m) => m.name === 'frame');
  if (frameMat) {
    frameMat.color.set(finish.color); frameMat.roughness = finish.rough; frameMat.metalness = 0;
    frameMat.emissive.set(finish.emissive || '#000000'); frameMat.emissiveIntensity = finish.ei || 0;
  }
  const ledTex = new THREE.CanvasTexture(o.led.dots);
  ledTex.flipY = false;
  ledTex.colorSpace = THREE.SRGBColorSpace;
  const ledMat = new THREE.MeshBasicMaterial({ map: ledTex, toneMapped: false });
  B.root.getObjectByName('led_face').traverse((m) => { if (m.isMesh) m.material = ledMat; });
  const edgeMat = new THREE.LineBasicMaterial({ color: '#0E1A22', transparent: true, opacity: 0, depthWrite: false });
  const edges = [];
  B.root.traverse((m) => {
    if (!m.isMesh || !m.visible || m.parent.visible === false) return;
    const l = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 32), edgeMat);
    l.visible = false;
    m.add(l);
    edges.push(l);
  });
  outlines.board.push(lightEdges(B.root, ['frame']).material);
  const ghostMats = B.mats.filter((m) => m.name !== 'led' && m.name !== 'rail').concat(ledMat, hookMat);
  const baseOpacity = new Map(ghostMats.map((m) => [m, m === frameMat && finish.opacity != null ? finish.opacity : 1]));
  // a board that fades in or out shows as a solid + its depth goes in after the solid parts of the scene and before
  // anything see-through so only its front faces blend and its insides stay hidden
  const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const parts = [], solids = [];
  board.traverse((m) => { if (m.isMesh && m.visible && m.parent.visible !== false) parts.push(m); });
  for (const m of parts) {
    const d = new THREE.Mesh(m.geometry, depthOnly);
    d.renderOrder = 5;
    d.visible = false;
    m.add(d);
    solids.push(d);
  }
  for (const m of outlines.board) m.userData.base = m.opacity;
  const plug = makePlug();
  plug.position.fromArray(USB);
  board.add(plug);
  const markers = MARKS.map((p, k) => { const s = makeMarker(k + 1); s.position.fromArray(p); board.add(s); return s; });
  shadows(board, true);
  scene.add(board);

  // the rail turns about its own middle + the strips and the level are parts of their own that sit on it when they ride
  const railMesh = R.root.getObjectByName('rail');
  const C = new THREE.Box3().setFromObject(railMesh).getCenter(new THREE.Vector3());
  const railPivot = new THREE.Group(), railInner = new THREE.Group();
  railInner.position.copy(C).negate();
  railPivot.add(railInner);
  railInner.add(railMesh);
  outlines.rail.push(lightEdges(railMesh, ['rail']).material);
  for (const m of outlines.rail) m.userData.base = m.opacity;
  shadows(railPivot, true);
  scene.add(railPivot);
  const ride = new THREE.Group(), rideInner = new THREE.Group(), rider = new THREE.Object3D();   // a stand-in rail for the riders' places
  rideInner.position.copy(C).negate();
  ride.add(rideInner);
  rideInner.add(rider);
  const stripEdge = new THREE.LineBasicMaterial({ color: '#7d8a8f', transparent: true, opacity: 0.6 });
  const strips = A.pockets.map((p, k) => {
    const s = makeStrip(k % 2 === 0);
    s.children.forEach((m) => m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), stripEdge)));
    s.userData.home = new THREE.Vector3(p.x, p.y, p.z - STRIP.t / 2);
    shadows(s, true);
    scene.add(s);
    return s;
  });
  const level = makeLevel();
  const levelHome = new THREE.Vector3(A.top.x, A.top.y + 11, A.wall.z + 13.5);
  shadows(level, true);
  scene.add(level);

  // the tools and the parts that go into the wall + what they leave there + the box's charger and cable
  const pencil = makePencil(), driver = makeDriver(), charger = makeCharger(), coil = makeCoil();
  for (const x of [pencil, driver, charger, coil]) { shadows(x, true); scene.add(x); }
  const anchorEdge = new THREE.LineBasicMaterial({ color: '#7d8a8f', transparent: true, opacity: 0.55 });
  const anchors = [0, 1, 2].map(() => {
    const m = makeAnchor();
    m.traverse((x) => { if (x.isMesh) x.add(new THREE.LineSegments(new THREE.EdgesGeometry(x.geometry, 40), anchorEdge)); });
    shadows(m, true); scene.add(m);
    return m;
  });
  const screws = [0, 1, 2, 3, 4].map(() => { const s = makeScrew(); shadows(s, true); scene.add(s); return s; });
  const marks = A.screws.map((p) => { const d = disc(2.2, '#45464A'); d.position.set(p.x, p.y, A.wall.z + 0.08); scene.add(d); return d; });
  const presses = A.pockets.map(() => { const r = ring(); scene.add(r); return r; });
  const seats = A.screws.map(() => { const r = ring(6, 8.5); scene.add(r); return r; });
  const targets = A.holes.map(() => { const r = ring(5.5, 8); scene.add(r); return r; });
  const click = ring();
  const arrow = arrowLeft();
  scene.add(click, arrow);
  const objs = { board, rail: railPivot, level, pencil, driver, charger, coil };
  strips.forEach((s, k) => { objs['strip' + k] = s; });
  screws.forEach((s, k) => { objs['screw' + k] = s; });
  anchors.forEach((s, k) => { objs['anchor' + k] = s; });

  // soft shadows + under the board when it floats + behind the board and the rail on the wall as they come close
  const floorShade = softShadow(620, 170, 0);
  floorShade.rotation.x = -Math.PI / 2;
  const boardShade = softShadow(640, 230, 0), railShade = softShadow(330, 140, 0);
  scene.add(floorShade, boardShade, railShade);

  const cam = new THREE.PerspectiveCamera(FOV, 1, 10, 9000);
  let aspect = 1;
  const SHOTS = {
    railBack: { t: [0, C.y, C.z + HELD], az: 0.5, el: 0.34, w: 330, h: 170 },
    railWall: { t: [0, C.y + 6, C.z], az: -0.42, el: 0.22, w: 390, h: 190 },
    railClose: { t: [0, C.y - 4, C.z], az: -0.36, el: 0.16, w: 320, h: 160 },
    anchors: { t: [-14, A.screws[0].y - 8, A.wall.z + 55], az: -0.95, el: 0.24, w: 330, h: 180 },
    screwIn: { t: [0, C.y - 4, C.z + 45], az: -0.78, el: 0.24, w: 370, h: 200 },
    hang: { t: [-24, 6, 30], az: -0.58, el: 0.4, w: 720, h: 360 },
    hung: { t: [0, 0, 0], az: -0.36, el: 0.16, w: 640, h: 250 },
  };
  function shotCam(s) {
    const tv = Math.tan(THREE.MathUtils.degToRad(FOV / 2)), th = tv * aspect;
    return { t: s.t.slice(), az: s.az, el: s.el, d: Math.max(s.w / 2 / th, s.h / 2 / tv) };
  }

  // ---- the mounting card + the steps of the way picked + every earlier step played to its end then this one to t ----
  function stateAt(way, step, t, still) {
    const W = WAYS[way];
    const S = { rail: { x: 0, y: 0, z: HELD, ry: 0, rz: 0, o: 1 }, board: { x: 0, y: 0, z: 0, o: 0, g: 0 }, strips: null, level: 0,
      pencil: null, marks: [0, 0, 0], driver: null, anchors: [null, null, null], screws: [null, null, null], seat: -1, seatOn: 'rail',
      press: -1, targets: -1, arrow: -1, click: -1, clock: -1, ...W.start() };
    let camName = S.cam;
    for (let i = 0; i <= step; i++) {
      const st = W.steps[i];
      S.still = !!still && i === step;
      st.set(S, i < step ? st.dur : t);
      if (i < step) for (const m of st.cam) camName = m[2];
    }
    let c = shotCam(SHOTS[camName]);
    for (const [t0, t1, name] of W.steps[step].cam) {
      const to = shotCam(SHOTS[name]);
      if (t >= t1) { c = to; continue; }
      if (t > t0) c = mixCam(c, to, ease((t - t0) / (t1 - t0)));
      break;
    }
    S.camera = c;
    S.standoff = W.standoff;
    return S;
  }
  // a mounting moment as a pose
  function resolve(S) {
    const f = blank(), z0 = S.standoff;
    f.wall = 1;
    put(f, 'rail', [C.x + S.rail.x, C.y + S.rail.y, C.z + S.rail.z + z0], 0, S.rail.ry, S.rail.rz || 0, S.rail.o);
    ride.position.fromArray(f.a.rail.p);
    ride.rotation.set(0, S.rail.ry, S.rail.rz || 0);
    ride.updateMatrixWorld(true);
    ride.getWorldQuaternion(_q2);
    const rq = [_q2.x, _q2.y, _q2.z, _q2.w];
    strips.forEach((s, k) => {
      const p = S.strips ? S.strips[k] : -1;
      if (p < 0) return;
      _v.copy(s.userData.home);
      _v.z -= (1 - p) * 150;
      rideInner.localToWorld(_v);
      f.a['strip' + k] = { p: [_v.x, _v.y, _v.z], q: rq, s: 1, o: 1 };
    });
    if (S.level > 0.01) {
      _v.copy(levelHome);
      _v.y += (1 - out(S.level)) * 40;
      rideInner.localToWorld(_v);
      f.a.level = { p: [_v.x, _v.y, _v.z], q: rq, s: 1, o: 1 };
      f.bubble = (S.rail.rz || 0) * 260;
    }
    put(f, 'board', [S.board.x, S.board.y, S.board.z + z0], 0, 0, 0, S.board.o);
    f.ghost = S.board.g;
    if (S.pencil) {
      const a = A.screws[Math.floor(S.pencil.at)], b = A.screws[Math.min(2, Math.ceil(S.pencil.at))], k = S.pencil.at - Math.floor(S.pencil.at);
      put(f, 'pencil', [lerp(a.x, b.x, k), lerp(a.y, b.y, k), A.wall.z + lerp(60, 0.3, S.pencil.k)], -0.78, 0.2, 0, 1);
    }
    if (S.driver && S.driver.o > 0.02) put(f, 'driver', [S.driver.x, S.driver.y, S.driver.z], 0, 0, -S.driver.turn * 12, 1);
    S.anchors.forEach((p, k) => { if (p) put(f, 'anchor' + k, [p.x, p.y, A.wall.z + ANCHOR.out + p.off], 0, 0, -p.turn * 12, 1); });
    S.screws.forEach((p, k) => { if (p) put(f, 'screw' + k, [p.x, p.y, A.screws[k].z + z0 + p.off], 0, 0, -p.turn * 12, 1); });
    f.marks = S.marks.slice();
    f.fx = { z0, press: S.press, seat: S.seat, seatOn: S.seatOn, targets: S.targets, click: S.click, arrow: S.arrow, arrowX: S.board.x - 40, clock: S.clock };
    f.cam = S.camera;
    return f;
  }

  // ---- the cards' poses ----
  let readyAt = performance.now();
  function introPose(now) {
    const f = blank();
    const turn = reduced ? 0 : -0.55 * (1 - ease(seg((now - readyAt) / 1000, 0.15, 2.0)));
    put(f, 'board', [0, 0, 0], 0, turn, 0);
    f.cam = shotCam({ t: [0, 2, 0], az: -0.14, el: 0.08, w: 600, h: 250 });
    f.led = 'hello';
    f.floor = 1;
    return f;
  }
  // in the box + every part laid out on a table and seen from above + the board face down with its hooks up
  function boxPose() {
    const f = blank();
    put(f, 'board', [0, 22, -104], Math.PI / 2, 0, 0);
    put(f, 'rail', [-132, 2.8, 46], -Math.PI / 2, 0, 0);
    for (let k = 0; k < 4; k++) put(f, 'strip' + k, [92 + (k % 2) * 104, 1.6, 22 + (k >> 1) * 30], -Math.PI / 2, 0, 0);
    for (let k = 0; k < 5; k++) put(f, 'screw' + k, [-58 + k * 13, 4.8, 134], 0, 0, 0);
    for (let k = 0; k < 3; k++) put(f, 'anchor' + k, [26 + k * 17, 6.6, 138], 0, 0, 0);
    put(f, 'charger', [186, 16.5, 120], Math.PI / 2, 0, 0.35);
    put(f, 'coil', [-212, 2.4, 140], -Math.PI / 2, 0, 0);
    f.cam = shotCam({ t: [-8, 0, 22], az: 0, el: 1.0, w: 610, h: 430 });
    f.table = 1;
    return f;
  }
  // hardware + the board facing you + the camera goes round its four spots + a tapped row takes it there
  let touring = !reduced, spotPick = 0, spotShown = -1, spotFrom = null, spotAt = 0, tourAt = 0;
  function tourSpot(now) {
    const total = TOUR.reduce((a, b) => a + b, 0);
    let t = ((now - tourAt) / 1000) % total;
    for (let k = 0; k < TOUR.length; k++) { if (t < TOUR[k]) return k; t -= TOUR[k]; }
    return 0;
  }
  function hardwarePose(now) {
    const f = blank();
    put(f, 'board', [0, 0, 0]);
    const spot = touring ? tourSpot(now) : spotPick;
    if (spot !== spotShown) {
      spotFrom = spotShown < 0 || !last ? null : last.cam;
      spotShown = spot;
      spotAt = now;
      o.onSpot && o.onSpot(spot);
    }
    const to = shotCam(SPOTS[spot]);
    f.cam = spotFrom && !reduced ? mixCam(spotFrom, to, ease(seg((now - spotAt) / 1000, 0, MOVE))) : to;
    f.led = 'clock';
    f.floor = 1;
    f.markers = 1;
    f.marker = spot;
    return f;
  }
  // the board on the wall with the cable in + its screen as the card says
  function wallPose(led, c) {
    const f = blank();
    put(f, 'board', [0, 0, 0]);
    put(f, 'rail', [C.x, C.y, C.z]);
    f.wall = 1;
    f.plug = 1;
    f.led = led;
    f.cam = shotCam(c);
    return f;
  }
  // the mounting card's own clock + it plays from the rail step on the way in from an earlier card
  let mt = { way: 'strips', step: 0, time: 0, playing: false, held: false }, mtLast = 0;
  function mountPose() {
    return resolve(stateAt(mt.way, mt.step, mt.time, mt.held));
  }
  const POSE = {
    hello: introPose,
    box: boxPose,
    hardware: hardwarePose,
    mounting: mountPose,
    wifi: () => wallPose('join', { t: [0, 0, 0], az: -0.12, el: 0.05, w: 560, h: 210 }),
  };
  const poseOf = (id, now) => (POSE[id] || POSE.wifi)(now);

  // ---- drawing a pose ----
  let ghostNow = -1, ledNow = '', ledAt = 0, ledTicks = 0;
  function ghost(g, o2) {
    const key = g * 10 + o2;
    if (Math.abs(key - ghostNow) < 1e-4) return;
    ghostNow = key;
    for (const m of ghostMats) {
      const op = baseOpacity.get(m) * (1 - 0.86 * g) * o2, see = op < 0.999;
      if (m.transparent !== see) { m.transparent = see; m.needsUpdate = true; }
      m.opacity = op;
      m.depthWrite = op > 0.6;
    }
    edgeMat.opacity = 0.5 * g;
    for (const l of edges) l.visible = g > 0.01;
    const solid = g < 0.05 && o2 < 0.999;
    for (const d of solids) d.visible = solid;
    for (const m of outlines.board) m.opacity = m.userData.base * o2;
    hookMat.color.lerpColors(hookColor, teal, g);
    shadows(board, g < 0.35 && o2 > 0.6);
  }
  function fade(m, op) {
    const see = op < 0.999;
    if (m.transparent !== see) { m.transparent = see; m.needsUpdate = true; }
    m.opacity = op;
  }
  function grow(r, p, x, y, z, from, to) {
    r.visible = p >= 0 && p < 1;
    if (!r.visible) return;
    r.position.set(x, y, z);
    r.scale.setScalar(lerp(from, to, out(p)));
    r.material.opacity = (1 - p) * 0.95;
  }
  // a part casts its shadow only while it shows well + the board's own rule is in ghost()
  const casts = new Map();
  function cast(x, on) {
    if (casts.get(x) === on) return;
    casts.set(x, on);
    shadows(x, on);
  }
  function render(f, now) {
    for (const n of ACTORS) {
      const x = objs[n], st = f.a[n];
      x.visible = st.o > 0.02;
      if (!x.visible) continue;
      x.position.fromArray(st.p);
      x.quaternion.fromArray(st.q);
      x.scale.setScalar(n === 'board' || n === 'rail' ? st.s : st.s * (0.35 + 0.65 * st.o));
      if (n !== 'board') cast(x, st.o > 0.6);
    }
    ghost(f.ghost, f.a.board.o);
    fade(railMat, f.a.rail.o);
    for (const m of outlines.rail) m.opacity = m.userData.base * f.a.rail.o;
    level.userData.bubble.position.x = f.bubble;
    wall.visible = f.wall > 0.01;
    fade(wallMat, f.wall);
    table.visible = f.table > 0.01;
    tableMat.opacity = 0.16 * f.table;
    const bp = f.a.board.p, bo = f.a.board.o;
    floorShade.visible = f.floor > 0.01 && bo > 0.02;
    floorShade.position.set(bp[0], bp[1] - 82, bp[2]);
    floorShade.material.opacity = 0.42 * f.floor * bo;
    const near = (z) => clamp01(1 - z / 180);
    boardShade.position.set(bp[0], bp[1] - 8, A.wall.z + 0.25);
    boardShade.material.opacity = 0.62 * bo * near(bp[2]) * (1 - f.ghost) * f.wall;
    const rp = f.a.rail.p;
    railShade.position.set(rp[0], rp[1] - 6, A.wall.z + 0.2);
    railShade.material.opacity = 0.42 * f.a.rail.o * near(rp[2] - C.z) * f.wall;
    plug.visible = f.plug > 0.02;
    plug.position.set(USB[0], USB[1] - (1 - f.plug) * 40, USB[2]);
    markers.forEach((m, k) => {
      m.visible = f.markers > 0.02;
      m.material.opacity = f.markers;
      const size = f.marker === k + 1 ? 0.07 : 0.05;
      m.scale.set(size * m.userData.wide, size, 1);
    });
    marks.forEach((d, k) => { d.material.opacity = f.marks[k]; d.visible = f.marks[k] > 0; });
    // the steps' rings and arrow and the wait clock
    const fx = f.fx, z0 = fx ? fx.z0 : 0;
    seats.forEach((r, k) => grow(r, !fx || fx.seat === -1 ? -1 : fx.seat[k], A.screws[k].x, A.screws[k].y,
      fx && fx.seatOn === 'wall' ? A.wall.z + ANCHOR.out + 0.4 : A.front + z0 + 0.8, 0.9, 2));
    presses.forEach((r, k) => {
      const q = !fx || fx.press < 0 ? -1 : clamp01((fx.press - (k >> 1) * 0.15) / 0.75);
      grow(r, q < 1 ? q : -1, A.pockets[k].x, A.pockets[k].y, A.front + z0 + 0.6, 0.6, 1.9);
    });
    targets.forEach((r, k) => grow(r, fx ? fx.targets : -1, A.holes[k].x, A.holes[k].y, A.front + z0 + 0.6, 0.7, 1.9));
    grow(click, fx ? fx.click : -1, A.latch.x, A.latch.y, A.latch.z + z0 + 1, 0.5, 2.6);
    arrow.visible = !!fx && fx.arrow >= 0;
    if (arrow.visible) {
      arrow.position.set(fx.arrowX, 112, z0 + 30);
      arrow.material.opacity = Math.min(1, fx.arrow * 5, (1 - fx.arrow) * 5);
    }
    if (o.clock) {
      const c = fx ? fx.clock : -1;
      o.clock.style.opacity = c < 0 ? 0 : Math.min(1, c * 6);
      o.clock.style.setProperty('--turn', (c < 0 ? 0 : c * 360) + 'deg');
    }
    // the board's face + a new face crossfades as the board does it + a face that moves keeps drawing
    if (f.led !== ledNow) { ledNow = f.led; ledAt = now; o.led.go(ledNow); }
    if (now - ledTicks >= 1000 / 30 - 4 && (ledNow === 'hello' || now - ledAt < 1200)) {
      ledTicks = now;
      o.led.tick(now);
      ledTex.needsUpdate = true;
    }
    const c = f.cam, se = Math.sin(c.el), ce = Math.cos(c.el);
    cam.position.set(c.t[0] + c.d * ce * Math.sin(c.az), c.t[1] + c.d * se, c.t[2] + c.d * ce * Math.cos(c.az));
    cam.lookAt(c.t[0], c.t[1], c.t[2]);
    arrow.quaternion.copy(cam.quaternion);
    renderer.render(scene, cam);
  }

  // ---- the card + a change eases from the pose on screen to the new one + less motion cuts ----
  let card = o.card || 'hello', from = null, moveAt = -1e9, last = null, raf = 0, live = true, peek = null;
  const order = o.order || [];
  function frameAt(now) {
    if (peek) return peek(now);
    const to = poseOf(card, now);
    const k = reduced ? 1 : ease(seg((now - moveAt) / 1000, 0, MOVE));
    return from && k < 1 ? mixFrame(from, to, k) : to;
  }
  function busy(now) {
    if (!reduced && now - moveAt < MOVE * 1000) return true;
    if (card === 'mounting' && mt.playing) return true;
    if (card === 'hardware' && (touring || now - spotAt < MOVE * 1000)) return true;
    if (card === 'hello' && !reduced) return true;
    if (now - ledAt < 1200) return true;
    return false;
  }
  function tick(now) {
    raf = 0;
    if (card === 'mounting' && mt.playing) {
      const steps = WAYS[mt.way].steps;
      mt.time += Math.min(0.1, (now - mtLast) / 1000);
      while (mt.playing && mt.time >= steps[mt.step].dur) {
        if (mt.step + 1 < steps.length) { mt.time -= steps[mt.step].dur; mt.step++; o.onStep && o.onStep(mt.way, mt.step); }
        else { mt.time = steps[mt.step].dur; mt.playing = false; }
      }
      o.onTime && o.onTime(mt.way, mt.step, mt.time / steps[mt.step].dur);
    }
    mtLast = now;
    last = frameAt(now);
    render(last, now);
    run();
  }
  function run() {
    if (raf || !live || document.hidden) return;
    if (!busy(performance.now())) return;
    raf = requestAnimationFrame(tick);
  }
  function kick() {
    if (raf) return;
    mtLast = performance.now();
    raf = requestAnimationFrame(tick);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
  // the clock face keeps its time + a frame every 15 s while it shows
  setInterval(() => { if (ledNow === 'clock' && live && !document.hidden) { ledAt = performance.now(); kick(); } }, 15000);
  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    aspect = w / h;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    kick();
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  else addEventListener('resize', resize);
  resize();
  readyAt = performance.now();
  if (card === 'hardware') tourAt = readyAt;

  function playMount(step) {
    mt.step = step; mt.time = 0; mt.held = reduced; mt.playing = !reduced;
    if (reduced) mt.time = WAYS[mt.way].steps[step].still;
    o.onStep && o.onStep(mt.way, mt.step);
    if (reduced) o.onTime && o.onTime(mt.way, mt.step, 1);
    kick();
  }

  return {
    // a change of card + the scene moves to that card's pose
    card(id) {
      if (id === card) return;
      const was = order.indexOf(card), now = performance.now();
      from = last;
      moveAt = now;
      card = id;
      if (id === 'hardware') { touring = !reduced; spotPick = 0; spotShown = -1; tourAt = now; }
      if (id === 'mounting') {
        if (was >= 0 && was > order.indexOf('mounting')) {
          const steps = WAYS[mt.way].steps;
          mt.step = steps.length - 1; mt.time = steps[mt.step].dur; mt.playing = false; mt.held = false;
          o.onStep && o.onStep(mt.way, mt.step);
          o.onTime && o.onTime(mt.way, mt.step, 1);
        } else playMount(0);
      }
      kick();
    },
    // the way to put it up + it plays from the rail step
    way(w) { mt.way = w; playMount(0); },
    // a step of the way + it plays from there or shows its still with less motion
    step(s) { playMount(s); },
    steps: (w) => WAYS[w].steps.length,
    // a spot on the hardware card + the camera goes there and the tour stops
    spot(k) { touring = false; spotPick = k; kick(); },
    live(on) { live = !!on; if (live) kick(); else if (raf) { cancelAnimationFrame(raf); raf = 0; } },
    // renders for the owner + a card held at a moment + or two cards' poses mixed k of the way
    hold(spec) {
      const now = performance.now();
      if (spec.way) { mt.way = spec.way; mt.step = spec.step || 0; mt.time = spec.t == null ? WAYS[mt.way].steps[mt.step].still : spec.t; mt.playing = false; mt.held = spec.t == null; }
      if (spec.spot != null) { touring = false; spotPick = spec.spot; spotShown = spec.spot; spotFrom = null; }
      if (spec.card) { card = spec.card; from = null; moveAt = -1e9; }
      peek = spec.from ? () => mixFrame(poseOf(spec.from, now), poseOf(spec.card, now), ease(spec.k)) : null;
      if (spec.since != null) readyAt = now - spec.since * 1000;
      last = frameAt(now);
      for (let i = 0; i < 3; i++) { ledTicks = 0; render(last, now + i * 400); }
    },
  };
}
