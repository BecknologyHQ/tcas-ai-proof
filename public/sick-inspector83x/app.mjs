import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';

const TEST = new URLSearchParams(location.search).has('test');
const $ = id => document.getElementById(id);
const L = await (await fetch('layout.json')).json();
// USD (x along belt, y across, z up) -> three (x, z, -y)
const V = (x, y, z) => new T.Vector3(x, z, -y);
const DECK = L.deck_z, SX = L.sensor_x, RX = L.reject_x, LEN = L.conveyor_length, HALF = L.frame_half_width;
const [CW, CD, CH] = L.carton;

// ---------- line parameters (simulated line; optics from the SICK datasheet) ----------
const SPEED = 0.75;                 // m/s = 45 m/min
const PITCH = 0.75;                 // m carton pitch -> 60 packs/min
const DT = PITCH / SPEED;           // s between packs
const LOOP = 20;                    // s, defect pattern repeats every 20 packs
const DEFECTS = {3: 'B', 9: 'C', 13: 'D'};
const KMIN = -4;                    // line starts full
const X0 = CW / 2;                  // infeed position (carton fully on the belt)
const TRIG_X = L.trigger_x ?? SX - 0.30;      // photo-eye beam (x)
const ENC_MM = 0.1;                 // encoder resolution, mm/count (illustrative)
const XF = RX - 0.05;               // carton centre when the pusher fires (centred on the paddle)
const PUSH = 0.30, RET = 0.30, SLIDE = 0.45, DROP = 0.30, RESULT = 0.15;
const YL = L.lane_y ?? 0, YS = L.sensor_y ?? 0;      // lane registered on the near-side rail; sensor over the label
const REST = L.pusher?.rest_face ?? (L.roller_half_width - 0.02);   // paddle face at rest, just outside the lane
const PX0 = L.pusher?.paddle_x?.[0] ?? RX - 0.15;
const J = L.reject, [YA, ZA] = J.chute_start, [YB, ZB] = J.chute_end, EDGE_Y = YA - CD / 2;
const T_CAP = (SX - X0) / SPEED, T_TRIG = (TRIG_X - CW / 2 - X0) / SPEED, T_FIRE = (XF - X0) / SPEED;
const T_CONFIRM = T_FIRE + PUSH + 0.15, T_LAND = T_FIRE + PUSH + SLIDE + DROP, T_EXIT = (LEN - CW / 2 - X0) / SPEED;
const BIN_SWAP = 19.3;
const smooth = u => u * u * (3 - 2 * u);
const sku = k => DEFECTS[((k % 20) + 20) % 20] || 'A';
const id = k => `PK-${String(k + 1001).padStart(4, '0')}`;
// engineering numbers derived from the same geometry the animation uses
const OPT = {pixel_um: 2.74, sensor_mm: [6.75, 5.61], px: [2464, 2048], f_mm: 12, wd_mm: Math.round((L.working_distance ?? 0.5) * 1000), hz: 30, enc_khz_max: 50};
OPT.fov = OPT.sensor_mm.map(s => s * OPT.wd_mm / OPT.f_mm);
OPT.mmpx = OPT.pixel_um / 1000 * OPT.wd_mm / OPT.f_mm;
const retractClear = (() => { const need = (YL + CD / 2 - YA) / (REST - YA); let u = 0; while (smooth(u) < need) u += 0.001; return u * RET; })();
const STROKE_MM = (REST - YA) * 1000, PEAK_MS = 1.5 * (REST - YA) / PUSH;
const ENG = {
  mpm: SPEED * 60, ppm: 60 / DT, gap_mm: (PITCH - CW) * 1000,
  blur_exposure_us: OPT.mmpx / (SPEED * 1000) * 1e6,
  enc_khz: SPEED * 1000 / ENC_MM / 1000,
  trig_to_cap_mm: (SX - (TRIG_X - CW / 2)) * 1000, trig_to_fire_mm: (XF - (TRIG_X - CW / 2)) * 1000,
  budget_s: T_FIRE - T_CAP,
  margin_s: (PX0 - CW / 2 - XF + PITCH) / SPEED - (PUSH + retractClear), stroke_mm: STROKE_MM, peak_ms: PEAK_MS,
};
ENG.max_ppm = 60 * SPEED / (PITCH - ENG.margin_s * SPEED);
// bin slots (three rejects per 20 s window, then the bin is swapped)
const BB = L.bin_bbox, BCX = (BB[0][0] + BB[1][0]) / 2;
const SLOTS = [{x: BCX - 0.17, y: J.bin_center_y, z: J.bin_floor_z, yaw: 4}, {x: BCX + 0.17, y: J.bin_center_y + 0.01, z: J.bin_floor_z, yaw: -5},
  {x: BCX + 0.02, y: J.bin_center_y - 0.02, z: J.bin_floor_z + CH, yaw: 13}];

// ---------- deterministic process model (pure function of time) ----------
const SLOPE = (ZA - ZB) / (YA - YB), CHUTE_DEG = -Math.atan2(ZA - ZB, YA - YB) * 180 / Math.PI;
const paddleAt = u => u <= 0 ? REST : u < PUSH ? REST + (YA - REST) * smooth(u / PUSH) : u < PUSH + RET ? YA + (REST - YA) * smooth((u - PUSH) / RET) : REST;
// carton on the transfer edge: tips as its centre of mass passes the rail edge, then rides the chute surface
const overEdge = (s, y) => { s.y = y; const over = Math.max(0, YA - y); s.pitch = CHUTE_DEG * Math.min(1, over / (CD / 2)); s.z = ZA - over * SLOPE; };
function cartonState(k, t) {
  const local = t - k * DT, s = {k, sku: sku(k), visible: local >= 0, x: X0 + SPEED * local, y: YL, z: DECK, yaw: 0, pitch: 0, fade: 1, phase: 'CONVEY'};
  if (!s.visible) return s;
  s.fade = Math.min(1, local / 0.2);
  if (s.sku !== 'A' && local >= T_FIRE) {
    const kk = local - T_FIRE, slot = SLOTS[Object.keys(DEFECTS).indexOf(String(((k % 20) + 20) % 20))];
    const xe = XF + 0.5 * SPEED * PUSH;          // rollers keep dragging the pack downstream while it is pushed
    if (kk < PUSH) { s.phase = 'PUSH'; s.x = XF + 0.5 * SPEED * kk * (2 - kk / PUSH); overEdge(s, Math.min(YL, paddleAt(kk) - CD / 2)); s.yaw = 3 * smooth(kk / PUSH); }
    else {
      const k2 = kk - PUSH;
      if (k2 < SLIDE) { const e = (k2 / SLIDE) ** 2; s.phase = 'CHUTE'; s.x = xe; s.yaw = 3; overEdge(s, EDGE_Y + e * (YB - EDGE_Y)); }
      else if (k2 < SLIDE + DROP) { const u = (k2 - SLIDE) / DROP; s.phase = 'DROP'; s.x = xe + u * (slot.x - xe); s.y = YB + u * (slot.y - YB); s.z = ZB + u * u * (slot.z - ZB); s.yaw = 3 + u * (slot.yaw - 3); s.pitch = (1 - u) * CHUTE_DEG; }
      else { s.phase = 'BINNED'; Object.assign(s, {x: slot.x, y: slot.y, z: slot.z, yaw: slot.yaw, pitch: 0}); }
    }
  } else if (local > T_EXIT) s.visible = false;
  else if (local > T_EXIT - 0.25) s.fade = (T_EXIT - local) / 0.25;
  return s;
}
function paddleFace(t) {
  const k0 = Math.floor((t - T_FIRE) / DT);
  for (let k = k0; k > k0 - 3; k--) {
    if (sku(k) === 'A' || k < KMIN) continue;
    const u = t - (k * DT + T_FIRE);
    if (u >= 0 && u <= PUSH + RET) return paddleAt(u);
  }
  return REST;
}
const REASON = {A: 'Label matches the PRODUCT A recipe', B: 'Wrong label: PRODUCT B printed on a PRODUCT A pack', C: 'Lot and best-by date missing', D: 'Code unreadable: printhead void lines'};
const CHECKS = {A: ['ok', 'ok', 'ok', 'ok'], B: ['fail', 'ok', 'ok', 'ok'], C: ['ok', 'fail', 'ok', 'ok'], D: ['ok', 'ok', 'fail', 'fail']};
function eventsBetween(t1, t2) {
  const out = [];
  for (let k = Math.max(KMIN, Math.floor((t1 - T_LAND) / DT) - 1); k * DT <= t2; k++) {
    const t0 = k * DT, s = sku(k), push = (tt, kind, text) => { if (tt > t1 && tt <= t2 && tt > 0) out.push({t: tt, k, sku: s, kind, text}); };
    push(t0 + T_CAP + RESULT, s === 'A' ? 'PASS' : 'FAIL', s === 'A' ? `${id(k)} PASS` : `${id(k)} FAIL ${REASON[s].split(':')[0].toLowerCase()}`);
    if (s !== 'A') { push(t0 + T_FIRE, 'DIVERT', `${id(k)} pusher fired at ${Math.round(ENG.trig_to_fire_mm / ENC_MM).toLocaleString()} counts`); push(t0 + T_CONFIRM, 'CONFIRM', `${id(k)} reject confirmed at chute eye`); }
  }
  const n = Math.floor(t2 / LOOP);
  for (let i = Math.max(0, Math.floor(t1 / LOOP)); i <= n; i++) { const tt = i * LOOP + BIN_SWAP; if (tt > t1 && tt <= t2) out.push({t: tt, k: -1, kind: 'SWAP', text: 'Reject bin swapped by operator'}); }
  return out.sort((a, b) => a.t - b.t);
}
function countUpTo(t, offset, pred) {   // packs k>=KMIN with k*DT+offset in (0,t] satisfying pred
  let n = 0;
  for (let k = Math.max(KMIN, Math.ceil(-offset / DT) - 1); k * DT + offset <= t; k++) if (k * DT + offset > 0 && pred(k)) n++;
  return n;
}
function snapshot(t) {
  const counts = {inspected: countUpTo(t, T_CAP + RESULT, () => true), fail: countUpTo(t, T_CAP + RESULT, k => sku(k) !== 'A'), rejects: countUpTo(t, T_CONFIRM, k => sku(k) !== 'A')};
  counts.pass = counts.inspected - counts.fail;
  const kLast = Math.floor((t - T_CAP - RESULT) / DT);
  const last = kLast >= KMIN && kLast * DT + T_CAP + RESULT > 0 ? {k: kLast, sku: sku(kLast), t: kLast * DT + T_CAP + RESULT} : null;
  const recentFail = (() => { for (let k = kLast; k > kLast - 4; k--) if (sku(k) !== 'A' && k * DT + T_CAP + RESULT > 0) return {k, sku: sku(k), t: k * DT + T_CAP + RESULT}; return null; })();
  const flash = (() => { const u = t - (Math.floor((t - T_CAP) / DT) * DT + T_CAP); return u >= 0 && u < 0.12; })();
  return {t, counts, last, recentFail, flash, face: paddleFace(t)};
}

// ---------- scene ----------
const host = $('stage');
const renderer = new T.WebGLRenderer({antialias: true, preserveDrawingBuffer: TEST});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
host.appendChild(renderer.domElement);
const scene = new T.Scene(); scene.background = new T.Color(0xdfe5e7);
scene.fog = new T.Fog(0xdfe5e7, 9, 22);
const pm = new T.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new T.PerspectiveCamera(36, 1, 0.02, 60);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.49; controls.minDistance = 0.6; controls.maxDistance = 9;
scene.add(new T.HemisphereLight(0xf2f6ff, 0x5b6266, 0.9));
const sun = new T.DirectionalLight(0xffffff, 2.2); sun.position.copy(V(-0.6, -3, 4.2)); sun.target.position.copy(V(1.4, 0, 0.6));
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, {left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 12}); sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);
const floor = new T.Mesh(new T.CircleGeometry(14, 64), new T.MeshStandardMaterial({color: 0xb9c0c3, roughness: 0.75}));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const aisle = new T.Mesh(new T.PlaneGeometry(6.5, 0.08), new T.MeshStandardMaterial({color: 0xe1b100, roughness: 0.6}));
aisle.rotation.x = -Math.PI / 2; aisle.position.copy(V(1.35, -HALF - 1.05, 0.002)); scene.add(aisle);

const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const gltf = await loader.loadAsync('station.glb', e => { if (e.total) $('loading').textContent = `Loading the native station... ${Math.round(100 * e.loaded / e.total)}%`; });
const station = gltf.scene;
let sensorNode = null; station.traverse(o => { if (!sensorNode && /inspector83x/i.test(o.name)) sensorNode = o; });
station.updateMatrixWorld(true);
const probe = new T.Box3().setFromObject(sensorNode || station).getCenter(new T.Vector3());
if (probe.y < 1.0 && Math.abs(probe.z) > 1.0) station.rotation.x = -Math.PI / 2;
scene.add(station); station.updateMatrixWorld(true);
// rollers: brushed steel, spinning at belt surface speed (omega = v / r)
const rollerSteel = new T.MeshStandardMaterial({color: 0xb9c0c6, metalness: 0.85, roughness: 0.32});
// SICK housing colours matched to SICK product photography (cyan-blue body, slate front); the NVIDIA asset's preview colours read violet
const SICK_RECOLOR = {'F_8ef750a7454b44ab8ade7357d03c58b3': [0x0096cf, 0.15, 0.42], 'F_153149c8afa24093a925f935768d88d8': [0x007fbd, 0.15, 0.4], 'F_aae41b8d022d43f0944992353bdf3917': [0x3d4b60, 0.3, 0.45]};
const recolored = new Map();
station.traverse(o => { if (!o.isMesh) return; const ms = Array.isArray(o.material) ? o.material : [o.material];
  ms.forEach((m, i) => { const k = Object.keys(SICK_RECOLOR).find(k => (m.name || '').includes(k)); if (!k) return;
    if (!recolored.has(k)) { const [c, met, r] = SICK_RECOLOR[k], n = m.clone(); n.color.set(c); n.metalness = met; n.roughness = r; recolored.set(k, n); }
    if (Array.isArray(o.material)) o.material[i] = recolored.get(k); else o.material = recolored.get(k); }); });
const rollers = [];
station.traverse(o => {
  if (!o.isMesh) return; o.castShadow = true; o.receiveShadow = true;
  let p = o, roller = false; while (p) { if (/roller/i.test(p.name || '')) roller = true; p = p.parent; }
  if (roller) { o.material = rollerSteel; rollers.push(o); }
});
const spinners = [];
for (const m of rollers) {
  const b = new T.Box3().setFromObject(m), sz = b.getSize(new T.Vector3());
  if (!(sz.z > 3 * sz.x && sz.z > 3 * sz.y && Math.abs(sz.x - sz.y) < 0.25 * sz.x)) continue;   // a lone cylinder across the belt
  const pivot = new T.Group(); pivot.position.copy(b.getCenter(new T.Vector3())); scene.add(pivot); pivot.attach(m);
  spinners.push({pivot, r: sz.y / 2});
}
// pusher: paddle, piston rod and both guide rods are one rigid moving assembly
const moving = []; station.traverse(o => { if (/^(paddle|rod_)/i.test(o.name || '')) moving.push(o); });
const movingTop = moving.filter(o => !moving.includes(o.parent));
const moveRest = movingTop.map(o => o.position.clone());
const paddle = moving.find(o => /^paddle/i.test(o.name)) || null;

// cartons
const tl = new T.TextureLoader();
const labelTex = Object.fromEntries('ABCD'.split('').map(k => { const t = tl.load(`textures/label-${k}.png`); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8; return [k, t]; }));
function makeCarton() {
  const g = new T.Group(), kraft = new T.MeshStandardMaterial({color: 0xa47a4c, roughness: 0.9, transparent: true}), tapeM = new T.MeshStandardMaterial({color: 0xb48f5f, roughness: 0.45, transparent: true});
  const labM = new T.MeshStandardMaterial({map: labelTex.A, roughness: 0.7, transparent: true});
  const body = new T.Mesh(new T.BoxGeometry(CW, CH, CD), kraft); body.position.y = CH / 2; body.castShadow = body.receiveShadow = true;
  const tape = new T.Mesh(new T.BoxGeometry(CW + 0.004, 0.003, 0.05), tapeM); tape.position.y = CH + 0.0015;
  const lab = new T.Mesh(new T.PlaneGeometry(0.24, 0.15), labM); lab.rotation.x = -Math.PI / 2; lab.position.set(-0.155 + 0.12, CH + 0.0032, 0.11 - 0.075);
  g.add(body, tape, lab); g.userData = {mats: [kraft, tapeM, labM], labM, sku: 'A'}; scene.add(g); return g;
}
const POOL = 7, pool = Array.from({length: POOL}, makeCarton), binMesh = SLOTS.map(makeCarton);
const setSku = (g, s) => { if (g.userData.sku !== s) { g.userData.sku = s; g.userData.labM.map = labelTex[s]; g.userData.labM.needsUpdate = true; } };
const setFade = (g, a) => g.userData.mats.forEach(m => { m.opacity = a; m.transparent = a < 1; m.depthWrite = a > 0.5; });
const place = (g, c) => { g.position.copy(V(c.x, c.y, c.z)); g.rotation.set(T.MathUtils.degToRad(c.pitch || 0), T.MathUtils.degToRad(c.yaw), 0); };

// illustrative FOV pyramid sized from the datasheet optics at the modelled working distance
const lensZ = L.sensor_bbox[0][2], fovH = lensZ - (DECK + CH);
const fw = OPT.fov[0] / 1000 / 2, fd = OPT.fov[1] / 1000 / 2;
const fovGeo = new T.BufferGeometry().setFromPoints([V(SX, YS, lensZ), V(SX - fw, YS - fd, DECK + CH), V(SX + fw, YS - fd, DECK + CH), V(SX + fw, YS + fd, DECK + CH), V(SX - fw, YS + fd, DECK + CH)]);
fovGeo.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1]); fovGeo.computeVertexNormals();
const fovMat = new T.MeshBasicMaterial({color: 0x29b6e8, transparent: true, opacity: 0.08, depthWrite: false, side: T.DoubleSide});
scene.add(new T.Mesh(fovGeo, fovMat));
const footMat = new T.LineBasicMaterial({color: 0x47d4ff, transparent: true, opacity: 0.5});
scene.add(new T.LineLoop(new T.BufferGeometry().setFromPoints([V(SX - fw, YS - fd, DECK + CH + 0.004), V(SX + fw, YS - fd, DECK + CH + 0.004), V(SX + fw, YS + fd, DECK + CH + 0.004), V(SX - fw, YS + fd, DECK + CH + 0.004)]), footMat));
// trigger beam + chute confirm beam (illustrative)
const beamMat = new T.MeshBasicMaterial({color: 0xff3b2f, transparent: true, opacity: 0.35});
const beam = new T.Mesh(new T.CylinderGeometry(0.0025, 0.0025, 2 * HALF + 0.04, 8), beamMat); beam.rotation.x = Math.PI / 2; beam.position.copy(V(TRIG_X, 0, DECK + 0.09)); scene.add(beam);
// stack light on the near gantry upright (illustrative)
const GY = HALF + 0.09, GT = L.gantry_top;
const lamp = (c, i) => { const m = new T.Mesh(new T.CylinderGeometry(0.036, 0.036, 0.062, 24), new T.MeshStandardMaterial({color: c, emissive: c, emissiveIntensity: 0.05, roughness: 0.35, transparent: true, opacity: 0.92})); m.position.copy(V(SX, -GY, GT + 0.11 + i * 0.064)); scene.add(m); return m; };
const pole = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, 0.08, 12), new T.MeshStandardMaterial({color: 0x3a3f44, metalness: 0.4, roughness: 0.4})); pole.position.copy(V(SX, -GY, GT + 0.05)); scene.add(pole);
const stack = {g: lamp(0x19b45a, 0), a: lamp(0xf2a900, 1), r: lamp(0xe0281b, 2)};
const cap = new T.Mesh(new T.CylinderGeometry(0.036, 0.036, 0.012, 24), new T.MeshStandardMaterial({color: 0x2b3035})); cap.position.copy(V(SX, -GY, GT + 0.11 + 2.5 * 0.064 + 0.006)); scene.add(cap);

// ---------- cameras ----------
const VIEWS = {
  overview: {pos: V(3.75, -3.35, 2.0), target: V(1.4, -0.3, 0.86)},
  inspect: {pos: V(1.9, 0.62, 1.82), target: V(SX - 0.03, YS + 0.03, 1.28)},
  reject: {pos: V(2.95, -1.75, 1.75), target: V(RX, -0.4, 0.7)},
};
const desired = {pos: VIEWS.overview.pos.clone(), target: VIEWS.overview.target.clone()};
camera.position.copy(desired.pos); controls.target.copy(desired.target);
let tour = true, view = 'overview', userMoving = false;
function setView(name, fromTour = false) {
  view = name; desired.pos.copy(VIEWS[name].pos); desired.target.copy(VIEWS[name].target);
  if (!fromTour) { tour = false; $('tour').classList.remove('selected'); }
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('selected', !tour && b.dataset.view === name));
}
controls.addEventListener('start', () => { userMoving = true; if (tour) { tour = false; $('tour').classList.remove('selected'); } });
controls.addEventListener('end', () => { userMoving = false; desired.pos.copy(camera.position); desired.target.copy(controls.target); });
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));
$('tour').onclick = () => { tour = true; $('tour').classList.add('selected'); document.querySelectorAll('[data-view]').forEach(b => b.classList.remove('selected')); };
// tour keyed to the defect packs (k = 9 and 13 in each 20-pack window)
const TOUR = (() => { const r9 = 9 * DT + T_CAP, f9 = 9 * DT + T_FIRE, r13 = 13 * DT + T_CAP; return [[0, 'overview'], [r9 - 1.6, 'inspect'], [f9 - 0.6, 'reject'], [r13 - 1.4, 'inspect'], [13 * DT + T_FIRE - 0.6, 'reject'], [13 * DT + T_LAND + 0.8, 'overview']]; })();
function tourView(t) { const tt = ((t % LOOP) + LOOP) % LOOP; let v = 'overview'; for (const [s, n] of TOUR) if (tt >= s) v = n; return v; }

// ---------- UI ----------
let clock = 0, paused = false, logT = 0, log = [];
$('pause').onclick = () => { paused = !paused; $('pause').textContent = paused ? 'Play' : 'Pause'; };
$('replay').onclick = () => { clock = 0; logT = 0; log = []; paused = false; $('pause').textContent = 'Pause'; };
const chapters = {overview: '01 / 60 PACKS A MINUTE', inspect: '02 / READ, OCR, VERIFY', reject: '03 / TRACK AND DIVERT'};
const notes = {overview: 'Real SICK Inspector83x model on an NVIDIA conveyor asset. Belt 45 m/min.', inspect: `One triggered image per pack. ${OPT.fov[0].toFixed(0)} x ${OPT.fov[1].toFixed(0)} mm field of view at ${OPT.wd_mm} mm.`, reject: `Encoder-tracked: the pusher fires ${Math.round(ENG.trig_to_fire_mm / ENC_MM).toLocaleString()} counts after the trigger edge.`};

let shown = '';
function updateUI(s) {
  $('clock').textContent = `${s.t.toFixed(1)} s`;
  $('countI').textContent = s.counts.inspected.toLocaleString(); $('countP').textContent = s.counts.pass.toLocaleString(); $('countR').textContent = s.counts.rejects.toLocaleString();
  $('rate').textContent = s.counts.inspected ? (100 * s.counts.fail / s.counts.inspected).toFixed(1) + '%' : '0.0%';
  // hold a FAIL on screen for 1.6 s so a reader can see it at line speed
  const hold = s.recentFail && s.t - s.recentFail.t < 1.6 ? s.recentFail : s.last;
  const key = hold ? hold.k + hold.sku : 'none';
  if (key !== shown) {
    shown = key; const dec = $('decision');
    if (!hold) { dec.className = 'decision waiting'; dec.innerHTML = 'READY<span>Waiting for the first trigger</span>'; $('itemId').textContent = 'No pack inspected'; }
    else {
      const pass = hold.sku === 'A';
      dec.className = 'decision ' + (pass ? 'pass' : 'reject');
      dec.innerHTML = (pass ? 'PASS' : 'REJECT') + `<span>${REASON[hold.sku]}</span>`;
      $('itemId').textContent = id(hold.k);
      $('crop').src = `textures/label-${hold.sku}.png`;
      CHECKS[hold.sku].forEach((st, i) => { $('roi' + i).className = 'roi ' + st; $('chk' + i).className = st; });
    }
  }
  if (hold) {
    const t0 = hold.k * DT, d = hold.sku === 'A' ? 'Continues downstream' : s.t < t0 + T_FIRE ? 'Pusher queued' : s.t < t0 + T_CONFIRM ? 'Diverting' : 'Confirmed at chute eye';
    if ($('dispo').textContent !== d) $('dispo').textContent = d;
  }
  if (s.t < logT) { logT = 0; log = []; }
  const ev = eventsBetween(logT, s.t); logT = s.t;
  if (ev.length) { log = [...ev.reverse(), ...log].slice(0, 7); $('events').innerHTML = log.map(e => `<li class="${e.kind.toLowerCase()}"><b>${e.t.toFixed(2)} s</b> ${e.text}</li>`).join(''); }
  const cv = tour ? tourView(s.t) : view;
  $('chapter').textContent = chapters[cv]; $('sceneNote').textContent = notes[cv];
}

// ---------- loop ----------
function apply(t) {
  const s = snapshot(t);
  const kHi = Math.floor(t / DT), kLo = Math.max(KMIN, Math.floor((t - Math.max(T_EXIT, T_LAND)) / DT));
  pool.forEach(g => g.visible = false);
  for (let k = kLo; k <= kHi; k++) {
    const c = cartonState(k, t); if (!c.visible || c.phase === 'BINNED') continue;
    const g = pool[((k % POOL) + POOL) % POOL]; setSku(g, c.sku); setFade(g, c.fade); place(g, c); g.visible = true;
  }
  // bin contents: rejects of the current 20-pack window that have landed, faded out at the bin swap
  const w = Math.floor(t / LOOP), tw = t - w * LOOP;
  Object.entries(DEFECTS).forEach(([kk, sk], i) => {
    const k = w * LOOP / DT + Number(kk), g = binMesh[i], landed = t >= k * DT + T_LAND && k >= KMIN;
    g.visible = landed && tw < BIN_SWAP + 0.4; if (!g.visible) return;
    setSku(g, sk); place(g, {...SLOTS[i], pitch: 0}); setFade(g, tw > BIN_SWAP ? Math.max(0, 1 - (tw - BIN_SWAP) / 0.4) : 1);
  });
  const off = V(0, s.face - REST, 0).applyQuaternion(station.quaternion.clone().invert());
  movingTop.forEach((o, i) => { const l = off.clone(); if (o.parent && o.parent !== station) { const q = new T.Quaternion(); o.parent.getWorldQuaternion(q); l.copy(V(0, s.face - REST, 0)).applyQuaternion(q.invert()); } o.position.copy(moveRest[i]).add(l); });
  spinners.forEach(r => { r.pivot.rotation.z = -(SPEED / r.r) * t; });
  fovMat.opacity = s.flash ? 0.24 : 0.07;
  const lastRes = s.last && t - s.last.t < 0.9 ? s.last : null;
  footMat.color.set(lastRes ? (lastRes.sku === 'A' ? 0x19c46a : 0xff2d1f) : 0x47d4ff); footMat.opacity = lastRes || s.flash ? 1 : 0.45;
  const red = s.recentFail && t - s.recentFail.t < 1.2 && Math.floor((t - s.recentFail.t) * 6) % 2 === 0;
  const amber = tw > BIN_SWAP - 1.5 && tw < BIN_SWAP + 0.4;
  stack.g.material.emissiveIntensity = red || amber ? 0.05 : 1.6; stack.r.material.emissiveIntensity = red ? 2.2 : 0.05; stack.a.material.emissiveIntensity = amber ? 1.8 : 0.05;
  beamMat.opacity = (() => { for (let k = kHi; k >= kLo; k--) { const c = cartonState(k, t); if (c.visible && c.phase === 'CONVEY' && Math.abs(c.x - TRIG_X) < CW / 2) return 0.9; } return 0.3; })();
  updateUI(s); return s;
}
function resize() { const w = host.clientWidth, h = host.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w < 560 ? 50 : 36; camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(host); resize();
$('loading').remove();

// engineering notes + timing strip, computed from the same constants as the animation
const fmt = (v, d = 0) => Number(v).toLocaleString(undefined, {minimumFractionDigits: d, maximumFractionDigits: d});
document.querySelectorAll('[data-eng]').forEach(el => {
  const v = {mpm: fmt(ENG.mpm), ppm: fmt(ENG.ppm), gap: fmt(ENG.gap_mm), fovh: fmt(OPT.fov[0]), fovv: fmt(OPT.fov[1]), wd: fmt(OPT.wd_mm), mmpx: fmt(OPT.mmpx, 2),
    blur: fmt(Math.floor(ENG.blur_exposure_us / 10) * 10), enc: fmt(ENG.enc_khz, 1), cap: fmt(ENG.trig_to_cap_mm), fire: fmt(ENG.trig_to_fire_mm), firec: fmt(ENG.trig_to_fire_mm / ENC_MM),
    capc: fmt(ENG.trig_to_cap_mm / ENC_MM), budget: fmt(ENG.budget_s * 1000), margin: fmt(ENG.margin_s * 1000), maxppm: fmt(Math.floor(ENG.max_ppm)), stroke: fmt(ENG.stroke_mm), bar: fmt(0.5 / OPT.mmpx, 1)}[el.dataset.eng];
  if (v !== undefined) el.textContent = v;
});
const tl2 = $('timeline');
if (tl2) {
  const total = ENG.trig_to_fire_mm + 450, P = mm => (100 * mm / total).toFixed(2) + '%';
  const marks = [[0, 'Trigger eye', '0 counts'], [ENG.trig_to_cap_mm, 'Image capture', `${fmt(ENG.trig_to_cap_mm / ENC_MM)} counts`], [ENG.trig_to_cap_mm + RESULT * SPEED * 1000, 'Result ready', 'simulated'], [ENG.trig_to_fire_mm, 'Pusher fires', `${fmt(ENG.trig_to_fire_mm / ENC_MM)} counts`], [ENG.trig_to_fire_mm + PUSH * 0.6 * SPEED * 1000 + 150, 'Chute eye confirms', 'or stop the line']];
  tl2.innerHTML = `<div class="tl-budget" style="left:${P(ENG.trig_to_cap_mm)};width:${P(ENG.trig_to_fire_mm - ENG.trig_to_cap_mm)}"><span>${fmt(ENG.budget_s * 1000)} ms from capture to pusher (decision budget)</span></div><div class="tl-bar"></div>` +
    marks.map(([mm, a, b], i) => `<div class="tl-mark${i % 2 ? ' low' : ''}${i === marks.length - 1 ? ' end' : ''}" style="left:${P(mm)}"><i></i><b>${a}</b><span>${b}</span><em>${fmt(mm)} mm</em></div>`).join('');
}

let last = performance.now(), manual = false;
function frame(dt) {
  apply(clock);
  if (tour) { const v = tourView(clock); desired.pos.copy(VIEWS[v].pos); desired.target.copy(VIEWS[v].target); }
  if (!userMoving) { const k = 1 - Math.exp(-dt * 3.2); camera.position.lerp(desired.pos, k); controls.target.lerp(desired.target, k); }
  controls.update(); renderer.render(scene, camera);
}
renderer.setAnimationLoop(now => {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (manual) return;
  if (!paused && !TEST) clock += dt;
  frame(dt);
});
if (TEST) window.demoProof = {ready: true, capture: (t, dt) => { manual = true; clock = t; frame(dt); return true; }, tour: () => { tour = true; },
  LOOP, DT, T_CAP, T_FIRE, T_LAND, T_CONFIRM, RESULT, DEFECTS, ENG, OPT, spinners: spinners.length,
  setTime: t => { clock = t; return apply(t); }, carton: (k, t) => cartonState(k, t), events: (a, b) => eventsBetween(a, b), face: t => paddleFace(t),
  settle: () => { camera.position.copy(desired.pos); controls.target.copy(desired.target); controls.update(); },
  setView: v => { tour = false; setView(v); camera.position.copy(desired.pos); controls.target.copy(desired.target); controls.update(); },
  setCam: (p, q) => { tour = false; desired.pos.copy(V(...p)); desired.target.copy(V(...q)); camera.position.copy(desired.pos); controls.target.copy(desired.target); controls.update(); },
  sensorNode: sensorNode?.name || null, recolored: [...recolored.keys()], paddle: paddle?.name || null, movingParts: moving.map(o => o.name), YL, REST, YA, PX0, CW, CD,
  rigid: () => { const p = new T.Vector3(); paddle.getWorldPosition(p); return moving.filter(o => o !== paddle).map(o => { const q = new T.Vector3(); o.getWorldPosition(q); return q.sub(p).toArray().map(v => +v.toFixed(5)); }); }, scene, renderer};
