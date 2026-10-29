import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

/* =====================================================================
   SomCar 3D – primeira pessoa. Usa o mesmo motor elétrico (sim.js).
   Unidades em metros. Layout dos terminais vem de DEFS (px × K).
   ===================================================================== */
const K = 0.002;
const H3 = { battery: 0.19, ground: 0.01, fuse: 0.035, dist: 0.04, switch: 0.03, headunit: 0.055, amp4: 0.06, mono: 0.065, speaker: 0.05, subdvc: 0.3 };
const S3 = c => c.type === 'speaker' ? ({ '6': 1, '6x9': 1.15, tw: 0.6, sub4: 1.7, sub2: 1.7 })[c.props.model] : c.type === 'subdvc' ? 1.25 : 1;
const REACH = 3.2;
const UP = new THREE.Vector3(0, 1, 0);
const $ = id => document.getElementById(id);

class World3D extends World {
  addComp3(type, p, q, props) {
    const c = this.addComp(type, 0, 0, props);
    c.p = new THREE.Vector3().copy(p); c.q = new THREE.Quaternion().copy(q || new THREE.Quaternion());
    return c;
  }
  local(c, lx, ly, lz) { return new THREE.Vector3(lx, ly, lz).multiplyScalar(S3(c)).applyQuaternion(c.q).add(c.p); }
  termPos(c, tid) {
    const t = this.term(c, tid), d = DEFS[c.type];
    const v = this.local(c, (t.x - d.w / 2) * K, H3[c.type] + 0.016, (t.y - d.h / 2) * K);
    return { x: v.x, y: v.y, z: v.z };
  }
  center(c) { const v = this.local(c, 0, H3[c.type] + 0.04, 0); return { x: v.x, y: v.y, z: v.z }; }
  wireAutoLen(w) {
    const p = this.wirePath(w); let L = 0;
    for (let i = 1; i < p.length; i++) L += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y, p[i].z - p[i - 1].z);
    return Math.max(0.05, L * 1.05);
  }
  wireMid(w) {
    const p = this.wirePath(w), half = this.wireAutoLen(w) / 1.05 / 2; let acc = 0;
    for (let i = 1; i < p.length; i++) {
      const d = Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y, p[i].z - p[i - 1].z);
      if (acc + d >= half) { const f = (half - acc) / (d || 1); return { x: p[i - 1].x + (p[i].x - p[i - 1].x) * f, y: p[i - 1].y + (p[i].y - p[i - 1].y) * f, z: p[i - 1].z + (p[i].z - p[i - 1].z) * f }; }
      acc += d;
    }
    return p[0];
  }
  save() {
    return JSON.stringify({ v: 3, nid: this.nid, motor: this.motor, signal: this.signal,
      comps: this.comps.map(c => ({ id: c.id, type: c.type, p: c.p.toArray(), q: c.q.toArray(), props: c.props })),
      wires: this.wires.map(w => ({ id: w.id, a: w.a, b: w.b, pts: w.pts, kind: w.kind, gauge: w.gauge, mat: w.mat, color: w.color, len: w.len })) });
  }
  load3(json) {
    const d = typeof json === 'string' ? JSON.parse(json) : json;
    if (d.v !== 3) throw new Error('formato');
    this.reset(); this.nid = d.nid; this.motor = !!d.motor; this.signal = d.signal || 'music';
    for (const c of d.comps) {
      const n = { id: c.id, type: c.type, x: 0, y: 0, props: Object.assign({}, DEFS[c.type].props, c.props) };
      initState(n); n.p = new THREE.Vector3().fromArray(c.p); n.q = new THREE.Quaternion().fromArray(c.q);
      this.comps.push(n);
    }
    for (const w of d.wires) this.wires.push({ ...w, st: { T: T_AMB, burnt: false, I: 0, Iprev: 0 } });
  }
}

const world = new World3D();
const audio = new AudioEngine();

/* ------------------------------------------------------------------ */
/* Renderer / cena                                                     */
/* ------------------------------------------------------------------ */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#1b1e22');
scene.fog = new THREE.Fog('#1b1e22', 14, 30);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.02, 80);
camera.position.set(0.2, 1.65, 2.9);
camera.lookAt(0, 0.6, 0);
const controls = new PointerLockControls(camera, document.body);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

scene.add(new THREE.HemisphereLight('#dfe8ff', '#3a3530', 0.55));
const sun = new THREE.DirectionalLight('#ffffff', 1.4);
sun.position.set(3, 7, 4); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 20 });
sun.shadow.bias = -0.0005;
scene.add(sun);
for (const [x, z] of [[-3, -2], [3, -2], [0, 3]]) {
  const l = new THREE.PointLight('#fff4e0', 6, 12, 1.6); l.position.set(x, 3.6, z); scene.add(l);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.15), new THREE.MeshBasicMaterial({ color: '#fffbe8' }));
  lamp.position.set(x, 3.95, z); scene.add(lamp);
}
const workLight = new THREE.PointLight('#ffffff', 1.2, 4, 2); scene.add(workLight); // lanterna do jogador

function canvasTex(w, h, draw, repeat) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
  t.anisotropy = 8;
  return t;
}
const concreteTex = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#7d7f80'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 9000; i++) { const v = 100 + Math.random() * 60 | 0; g.fillStyle = `rgba(${v},${v},${v},.25)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  g.strokeStyle = 'rgba(40,40,40,.35)'; g.lineWidth = 3; g.strokeRect(0, 0, w, h);
}, 12);
const surfaces = [];   // meshes onde se pode instalar / passar cabo
function surf(mesh, chassis, name) { mesh.userData = { kind: 'surf', chassis, name }; mesh.receiveShadow = true; mesh.castShadow = true; surfaces.push(mesh); scene.add(mesh); return mesh; }
function box(w, h, d, mat, x, y, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; }

// oficina
surf(new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.9 })), false, 'chão da oficina').rotation.x = -Math.PI / 2;
const wallMat = new THREE.MeshStandardMaterial({ color: '#4b5560', roughness: 0.95 });
for (const [w, d, x, z] of [[24, 0.2, 0, -12], [24, 0.2, 0, 12], [0.2, 24, -12, 0], [0.2, 24, 12, 0]]) scene.add(box(w, 4, d, wallMat, x, 2, z));
const stripe = new THREE.MeshStandardMaterial({ color: '#d8a400' });
for (const x of [-3, 3]) scene.add(box(0.1, 0.005, 7, stripe, x, 0.003, 0));
// bancada
const benchMat = new THREE.MeshStandardMaterial({ color: '#6b4f33', roughness: 0.8 });
surf(box(2.4, 0.06, 0.8, benchMat, -0.5, 0.9, -3.4), false, 'bancada');
for (const [x, z] of [[-1.6, -3.1], [0.6, -3.1], [-1.6, -3.7], [0.6, -3.7]]) scene.add(box(0.06, 0.88, 0.06, new THREE.MeshStandardMaterial({ color: '#333' }), x, 0.44, z));

/* ---------------- carro (corte, sem teto, capô e tampa abertos) ---------------- */
function buildCar() {
  const metal = new THREE.MeshStandardMaterial({ color: '#7b8187', metalness: 0.6, roughness: 0.45 });
  const paint = new THREE.MeshStandardMaterial({ color: '#9b1c1c', metalness: 0.5, roughness: 0.3 });
  const plastic = new THREE.MeshStandardMaterial({ color: '#2a2c30', roughness: 0.8 });
  const fabric = new THREE.MeshStandardMaterial({ color: '#3a3f47', roughness: 1 });
  const engineMat = new THREE.MeshStandardMaterial({ color: '#55595e', metalness: 0.7, roughness: 0.5 });
  surf(box(4.3, 0.04, 1.74, metal, 0, 0.28, 0), true, 'assoalho (chassi)');
  surf(box(4.3, 0.62, 0.04, paint, 0, 0.6, -0.89), true, 'lateral (chassi)');
  surf(box(4.3, 0.62, 0.04, paint, 0, 0.6, 0.89), true, 'lateral (chassi)');
  surf(box(0.04, 0.62, 1.74, paint, 2.15, 0.6, 0), true, 'frente (chassi)');
  surf(box(0.04, 0.62, 1.74, paint, -2.15, 0.6, 0), true, 'traseira (chassi)');
  surf(box(0.04, 0.55, 1.74, metal, 1.3, 0.57, 0), true, 'parede de fogo (chassi)');
  surf(box(0.55, 0.45, 0.62, engineMat, 1.82, 0.525, 0.22), true, 'bloco do motor (chassi)');
  surf(box(0.35, 0.22, 1.66, plastic, 1.08, 0.86, 0), false, 'painel (plástico)');
  for (const z of [-0.42, 0.42]) {
    surf(box(0.5, 0.2, 0.5, fabric, 0.35, 0.4, z), false, 'banco');
    surf(box(0.1, 0.6, 0.5, fabric, 0.06, 0.75, z), false, 'encosto');
  }
  surf(box(0.5, 0.2, 1.6, fabric, -0.62, 0.4, 0), false, 'banco traseiro');
  surf(box(0.1, 0.55, 1.6, fabric, -0.92, 0.72, 0), false, 'encosto traseiro');
  surf(box(0.3, 0.025, 1.7, new THREE.MeshStandardMaterial({ color: '#2f2f2f', roughness: 1 }), -1.13, 1.0, 0), false, 'tampão traseiro (MDF)');
  // capô e tampa abertos
  const hood = box(0.85, 0.03, 1.72, paint, 0, 0, 0); hood.position.set(1.45, 1.35, 0); hood.rotation.z = 1.22; scene.add(hood);
  const lid = box(0.8, 0.03, 1.72, paint, 0, 0, 0); lid.position.set(-1.62, 1.38, 0); lid.rotation.z = -1.3; scene.add(lid);
  // rodas
  const tire = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.9 });
  for (const [x, z] of [[1.4, 0.82], [1.4, -0.82], [-1.4, 0.82], [-1.4, -0.82]]) {
    const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.22, 24), tire);
    wh.rotation.x = Math.PI / 2; wh.position.set(x, 0.31, z); wh.castShadow = true; scene.add(wh);
  }
  // volante
  const st = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.02, 8, 24), plastic); st.position.set(0.82, 0.95, -0.42); st.rotation.y = Math.PI / 2; st.rotation.x = 0.3; scene.add(st);
}
buildCar();

/* ------------------------------------------------------------------ */
/* Malhas dos componentes                                              */
/* ------------------------------------------------------------------ */
const ROLE_COL = { pos: '#d32f2f', neg: '#1a1a1a', rem: '#1e88e5', acc: '#fb8c00', spk: '#b0b0b0', sig: '#e8c34a' };
const BODY_COL = { battery: '#2f3338', ground: '#999', fuse: '#20252b', dist: '#3a3320', switch: '#262b31', headunit: '#15181c', amp4: '#3a2f5b', mono: '#4a2550', speaker: '#1d2126', subdvc: '#1f1f22' };
const meshes = new Map();   // c.id -> {g, body, tex, cv, cone, inner}
const wireMeshes = new Map(); // w.id -> {mesh, key}
let pickables = [];

function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
function txt(g, s, x, y, size, col, align = 'center', weight = '600') { g.font = `${weight} ${size}px system-ui, Segoe UI, sans-serif`; g.fillStyle = col; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, x, y); }

function drawFace(c, g) {
  const d = DEFS[c.type], s = c.st, p = c.props, W = d.w, H = d.h;
  g.clearRect(0, 0, W, H);
  switch (c.type) {
    case 'battery':
      g.fillStyle = '#3d4249'; g.fillRect(0, 0, W, H);
      txt(g, '12V 60Ah', W / 2, 40, 15, '#fff', 'center', '800');
      txt(g, `${s.V.toFixed(2)} V · ${(s.soc * 100).toFixed(0)}%`, W / 2, 60, 11, s.V < 11.5 ? '#ff8a80' : '#9ccc65');
      break;
    case 'ground': g.fillStyle = p.chassis === false ? '#a33' : '#888'; g.beginPath(); g.arc(W / 2, 12, 11, 0, 7); g.fill(); break;
    case 'fuse':
      g.fillStyle = '#20252b'; g.fillRect(0, 0, W, H);
      rr(g, 22, 8, W - 44, H - 16, 3); g.fillStyle = s.blown ? '#3a2a20' : 'rgba(255,214,79,.3)'; g.fill();
      g.strokeStyle = s.blown ? '#5d4037' : `hsl(${45 - 45 * Math.min(1, s.th)},100%,${60 - 10 * s.th}%)`; g.lineWidth = 4; g.beginPath();
      if (s.blown) { g.moveTo(26, 20); g.lineTo(48, 20); g.moveTo(62, 20); g.lineTo(84, 20); } else { g.moveTo(26, 20); g.lineTo(84, 20); }
      g.stroke(); txt(g, p.rating + 'A' + (s.blown ? ' ✖' : ''), W / 2, 31, 10, s.blown ? '#ff8a80' : '#ffd54f', 'center', '800');
      break;
    case 'dist': g.fillStyle = '#3a3320'; g.fillRect(0, 0, W, H); g.fillStyle = '#c9a227'; g.fillRect(16, 8, W - 32, H - 16); break;
    case 'switch':
      g.fillStyle = '#262b31'; g.fillRect(0, 0, W, H);
      g.strokeStyle = p.on ? '#66bb6a' : '#888'; g.lineWidth = 5; g.beginPath(); g.moveTo(16, 22); g.lineTo(64, p.on ? 22 : 6); g.stroke();
      txt(g, p.on ? 'ON' : 'OFF', W / 2, 36, 9, p.on ? '#66bb6a' : '#999', 'center', '800');
      break;
    case 'headunit':
      g.fillStyle = '#15181c'; g.fillRect(0, 0, W, H);
      rr(g, 12, 10, 110, 30, 4); g.fillStyle = s.on ? '#0d2a3a' : '#0b0d10'; g.fill();
      if (s.on) txt(g, `VOL ${p.volume}`, 67, 25, 16, '#4fc3f7', 'center', '800');
      else txt(g, s.burnt ? 'QUEIMADO' : 'OFF', 67, 25, 12, s.burnt ? '#ff5252' : '#444', 'center', '800');
      g.beginPath(); g.arc(155, 25, 15, 0, 7); g.fillStyle = '#2a2f36'; g.fill();
      if (s.remBurnt) txt(g, 'REM ✖', 115, 52, 9, '#ff5252');
      break;
    case 'amp4': case 'mono': {
      const heat = Math.max(0, Math.min(1, (s.T - 40) / 60));
      g.fillStyle = s.burnt ? '#1a1414' : `rgb(${(c.type === 'amp4' ? 58 : 74) + heat * 70 | 0},${(c.type === 'amp4' ? 47 : 37) - heat * 10 | 0},${(c.type === 'amp4' ? 91 : 80) - heat * 60 | 0})`;
      g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 4;
      for (let i = 30; i < W - 30; i += 12) { g.beginPath(); g.moveTo(i, 22); g.lineTo(i, H - 26); g.stroke(); }
      txt(g, c.type === 'amp4' ? '4 CH · 4x100W' : 'MONO · 1000W', W / 2, H / 2 - 8, 15, '#fff', 'center', '800');
      txt(g, `GAIN ${p.gain}% · ${s.T.toFixed(0)}°C`, W / 2, H / 2 + 12, 10, heat > 0.6 ? '#ff8a65' : '#ccc');
      [['PWR', s.status === 'on' ? '#00e676' : '#123'], ['PROT', s.status === 'protect' || s.status === 'burnt' ? '#ff1744' : '#311'], ['CLIP', s.active && s.clip > 0.01 ? '#ffea00' : '#331']].forEach(([l, col], i) => {
        const lx = 40 + i * 50, ly = H - 14; g.beginPath(); g.arc(lx, ly, 5, 0, 7); g.fillStyle = col; g.fill(); txt(g, l, lx + 9, ly, 8, '#bbb', 'left');
      });
      if (s.burnt) txt(g, 'QUEIMADO', W / 2, 20, 13, '#ff5252', 'center', '900');
      break;
    }
    case 'speaker': case 'subdvc':
      g.fillStyle = BODY_COL[c.type]; g.fillRect(0, 0, W, H);
      txt(g, c.type === 'speaker' ? ({ '6': '6"', '6x9': '6x9"', tw: 'TW' + (p.cap ? '+C' : ''), sub4: '12" 4Ω', sub2: '12" 2Ω' })[p.model] : 'DVC 2+2Ω', W / 2 + 6, H - 8, 9, '#bbb', 'center', '800');
      if (c.type === 'subdvc' && !s.phase) txt(g, 'FORA DE FASE', W / 2, 9, 9, '#ffb300', 'center', '800');
      if (s.burnt) txt(g, '✖ QUEIMADO', W / 2 + 6, 9, 9, '#ff5252', 'center', '800');
      break;
  }
  for (const t of d.terms) {
    let lx = t.x, ly = t.y, al = 'center';
    if (t.x === 0) { lx += 9; al = 'left'; } else if (t.x === W) { lx -= 9; al = 'right'; } else if (t.y === 0) ly += 13; else if (t.y === H) ly -= 13;
    if (c.type !== 'ground') txt(g, t.label, lx, ly, 9, '#fff', al, '700');
  }
}

function makeComp(c) {
  const d = DEFS[c.type], w = d.w * K, h = d.h * K, ht = H3[c.type];
  const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner); inner.scale.setScalar(S3(c));
  const bodyMat = new THREE.MeshStandardMaterial({ color: BODY_COL[c.type], roughness: 0.55, metalness: c.type.startsWith('amp') || c.type === 'mono' ? 0.6 : 0.2 });
  let body;
  if (c.type === 'ground') {
    body = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, ht, 6), new THREE.MeshStandardMaterial({ color: '#aaa', metalness: 0.9, roughness: 0.3 }));
    body.position.set((d.terms[0].x - d.w / 2) * K, ht / 2, (d.terms[0].y - d.h / 2) * K);
  } else { body = new THREE.Mesh(new THREE.BoxGeometry(w, ht, h), bodyMat); body.position.y = ht / 2; }
  body.castShadow = body.receiveShadow = true; body.userData = { kind: 'comp', c }; inner.add(body);
  const cv = document.createElement('canvas'); cv.width = d.w * 3; cv.height = d.h * 3;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  if (c.type !== 'ground') {
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, transparent: true }));
    face.rotation.x = -Math.PI / 2; face.position.y = ht + 0.0008; face.userData = { kind: 'comp', c }; inner.add(face);
  }
  let cone = null;
  if (c.type === 'speaker' || c.type === 'subdvc') {
    const r = (c.type === 'speaker' ? SPK_MODELS[c.props.model].r : 52) * K;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.006, 0.006, 8, 32), new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.9 }));
    ring.rotation.x = Math.PI / 2; ring.position.set(6 * K, ht + 0.004, 0); inner.add(ring);
    cone = new THREE.Group(); cone.position.set(6 * K, ht - 0.02, 0); inner.add(cone);
    const coneMesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.3, 0.025, 32, 1, true), new THREE.MeshStandardMaterial({ color: '#2b2e33', roughness: 0.85, side: THREE.DoubleSide }));
    coneMesh.position.y = 0.0125; cone.add(coneMesh);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 0.3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#3a3f46', roughness: 0.5 }));
    cone.add(cap); cone.userData.cap = cap;
    coneMesh.userData = cap.userData = { kind: 'comp', c };
  }
  if (c.type === 'battery') for (const t of d.terms) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.02, 12), new THREE.MeshStandardMaterial({ color: '#888', metalness: 0.9, roughness: 0.3 }));
    cap.position.set((t.x - d.w / 2) * K, ht + 0.005, (t.y - d.h / 2) * K); inner.add(cap);
  }
  const proxies = [];
  for (const t of d.terms) {
    const lx = (t.x - d.w / 2) * K, lz = (t.y - d.h / 2) * K;
    const post = new THREE.Mesh(t.kind === 's' ? new THREE.CylinderGeometry(0.006, 0.006, 0.02, 12) : new THREE.CylinderGeometry(0.0055, 0.0055, 0.018, 8),
      new THREE.MeshStandardMaterial({ color: t.kind === 's' ? '#e8c34a' : ROLE_COL[t.role], metalness: t.kind === 's' ? 0.9 : 0.3, roughness: 0.35 }));
    post.position.set(lx, ht + 0.009, lz); inner.add(post);
    if (t.kind === 's') { const rg = new THREE.Mesh(new THREE.TorusGeometry(0.0075, 0.0018, 6, 16), new THREE.MeshStandardMaterial({ color: '#c62828' })); rg.rotation.x = Math.PI / 2; rg.position.set(lx, ht + 0.012, lz); inner.add(rg); }
    const proxy = new THREE.Mesh(new THREE.SphereGeometry(0.017, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    proxy.position.set(lx, ht + 0.016, lz); proxy.userData = { kind: 'term', c, t: t.id }; inner.add(proxy); proxies.push(proxy);
  }
  scene.add(g);
  const m = { g, inner, body, bodyMat, tex, cv, ctx: cv.getContext('2d'), cone, proxies, model: c.props.model };
  meshes.set(c.id, m);
  drawFaceTex(c, m);
  return m;
}
function drawFaceTex(c, m) { m.ctx.setTransform(3, 0, 0, 3, 0, 0); drawFace(c, m.ctx); m.tex.needsUpdate = true; }

function polyCurve(pts) {
  const path = new THREE.CurvePath();
  let prev = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i], next = pts[i + 1];
    if (!next) { path.add(new THREE.LineCurve3(prev, p)); break; }
    const r = Math.min(0.035, p.distanceTo(pts[i - 1]) / 2, p.distanceTo(next) / 2);
    const a = p.clone().add(pts[i - 1].clone().sub(p).setLength(r)), b = p.clone().add(next.clone().sub(p).setLength(r));
    if (a.distanceTo(prev) > 1e-4) path.add(new THREE.LineCurve3(prev, a));
    path.add(new THREE.QuadraticBezierCurve3(a, p, b));
    prev = b;
  }
  return path;
}
function wireRadius(w) { return w.kind === 'rca' ? 0.0035 : Math.sqrt(w.gauge / Math.PI) / 1000 + 0.0011; }
function makeWireGeo(w) {
  const raw = world.wirePath(w).map(p => new THREE.Vector3(p.x, p.y, p.z)), pts = [raw[0]];
  for (const p of raw.slice(1)) if (p.distanceTo(pts.at(-1)) > 0.004) pts.push(p);
  if (pts.length < 2) pts.push(pts[0].clone().add(new THREE.Vector3(0, 0.005, 0)));
  const curve = polyCurve(pts);
  const segs = Math.min(600, Math.max(8, Math.ceil(curve.getLength() * 60) + pts.length * 6));
  return new THREE.TubeGeometry(curve, segs, wireRadius(w), 7, false);
}
function wireKey(w) { return world.wirePath(w).map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`).join('|') + w.gauge; }

function sync() {
  for (const c of world.comps) {
    let m = meshes.get(c.id);
    if (m && c.type === 'speaker' && m.model !== c.props.model) { disposeComp(c.id); m = null; }
    if (!m) m = makeComp(c);
    m.g.position.copy(c.p); m.g.quaternion.copy(c.q);
  }
  for (const id of [...meshes.keys()]) if (!world.comps.find(c => c.id === id)) disposeComp(id);
  for (const w of world.wires) {
    const key = wireKey(w); let wm = wireMeshes.get(w.id);
    if (!wm) {
      const mat = new THREE.MeshStandardMaterial({ color: w.kind === 'rca' ? '#1c1c1c' : w.color, roughness: 0.45, metalness: 0.05 });
      wm = { mesh: new THREE.Mesh(makeWireGeo(w), mat), key }; wm.mesh.castShadow = true; wm.mesh.userData = { kind: 'wire', w };
      scene.add(wm.mesh); wireMeshes.set(w.id, wm);
    } else if (wm.key !== key) { wm.mesh.geometry.dispose(); wm.mesh.geometry = makeWireGeo(w); wm.key = key; }
  }
  for (const [id, wm] of [...wireMeshes]) if (!world.wires.find(w => w.id === id)) { scene.remove(wm.mesh); wm.mesh.geometry.dispose(); wireMeshes.delete(id); }
  pickables = [...surfaces];
  for (const m of meshes.values()) m.g.traverse(o => { if (o.isMesh && o.userData.kind) pickables.push(o); });
  for (const wm of wireMeshes.values()) pickables.push(wm.mesh);
}
function disposeComp(id) {
  const m = meshes.get(id); if (!m) return;
  scene.remove(m.g); m.g.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose?.(); } }); m.tex.dispose(); meshes.delete(id);
}

/* ------------------------------------------------------------------ */
/* Partículas                                                          */
/* ------------------------------------------------------------------ */
const dotTex = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
class PSys {
  constructor(max, size, blending, opacity) {
    this.max = max; this.list = [];
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.pts = new THREE.Points(this.geo, new THREE.PointsMaterial({ size, map: dotTex, vertexColors: true, transparent: true, opacity, depthWrite: false, blending }));
    this.pts.frustumCulled = false; scene.add(this.pts);
  }
  add(p) { if (this.list.length >= this.max) this.list.shift(); this.list.push(p); }
  update(dt, grav, fade) {
    for (const p of this.list) { p.life -= dt; p.vy -= grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; if (p.y < 0.01) { p.y = 0.01; p.vy *= -0.3; p.vx *= 0.5; p.vz *= 0.5; } }
    this.list = this.list.filter(p => p.life > 0);
    for (let i = 0; i < this.max; i++) {
      const p = this.list[i];
      if (p) { this.pos.set([p.x, p.y, p.z], i * 3); const f = fade ? Math.min(1, p.life / p.max * 1.5) : 1; this.col.set([p.r * f, p.g * f, p.b * f], i * 3); }
      else this.pos.set([0, -50, 0], i * 3);
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
  }
}
const sparks = new PSys(1500, 0.018, THREE.AdditiveBlending, 1);
const smoke = new PSys(700, 0.35, THREE.NormalBlending, 0.35);
const fire = new PSys(600, 0.12, THREE.AdditiveBlending, 0.9);
const rnd = (a) => (Math.random() - 0.5) * a;
function spawn(kind, x, y, z, n) {
  for (let i = 0; i < n; i++) {
    if (kind === 'spark') { const l = 0.3 + Math.random() * 0.6; sparks.add({ x, y, z, vx: rnd(4), vy: Math.random() * 3, vz: rnd(4), life: l, max: l, r: 1, g: 0.8 + Math.random() * 0.2, b: 0.35 }); }
    else if (kind === 'smoke') { const l = 2 + Math.random() * 3, v = 0.35 + Math.random() * 0.2; smoke.add({ x: x + rnd(0.05), y, z: z + rnd(0.05), vx: rnd(0.15), vy: 0.25 + Math.random() * 0.3, vz: rnd(0.15), life: l, max: l, r: v, g: v, b: v }); }
    else if (kind === 'fire') { const l = 0.4 + Math.random() * 0.8; fire.add({ x: x + rnd(0.1), y, z: z + rnd(0.1), vx: rnd(0.2), vy: 0.4 + Math.random() * 0.6, vz: rnd(0.2), life: l, max: l, r: 1, g: 0.35 + Math.random() * 0.4, b: 0.05 }); }
  }
}

/* ------------------------------------------------------------------ */
/* Ferramentas / estado do jogador                                     */
/* ------------------------------------------------------------------ */
const INVENTORY = [
  { type: 'fuse', label: 'Porta-fusível ANL', props: { rating: 60 } },
  { type: 'ground', label: 'Parafuso de terra' },
  { type: 'dist', label: 'Distribuidor' },
  { type: 'switch', label: 'Chave liga/desliga' },
  { type: 'headunit', label: 'Rádio (Head unit)' },
  { type: 'amp4', label: 'Amplificador 4 canais' },
  { type: 'mono', label: 'Amplificador Mono 1000W' },
  { type: 'speaker', label: 'Alto-falante 6" 60W', props: { model: '6' } },
  { type: 'speaker', label: 'Alto-falante 6x9" 100W', props: { model: '6x9' } },
  { type: 'speaker', label: 'Tweeter 50W (c/ capacitor)', props: { model: 'tw', cap: true } },
  { type: 'speaker', label: 'Tweeter 50W (SEM capacitor)', props: { model: 'tw', cap: false } },
  { type: 'speaker', label: 'Subwoofer 12" 4Ω 400W', props: { model: 'sub4' } },
  { type: 'speaker', label: 'Subwoofer 12" 2Ω 600W', props: { model: 'sub2' } },
  { type: 'subdvc', label: 'Sub 12" DVC 2+2Ω (caixa)' },
  { type: 'battery', label: 'Bateria 12V 60Ah' },
];
const TOOLS = ['Mão', 'Cabo', 'Multímetro', 'Peça'];
let tool = 0, invSel = INVENTORY[5];
let wiring = null;                 // {a:{c,t}, pts:[]}
let carry = null;                  // {c, origP, origQ, rot, isNew}
let ghostRot = 0;
let probes = { red: null, black: null };
const wireDef = { gauge: 10, mat: 'cu', color: 'auto' };
let aim = null;                    // resultado do raycast
let speed = 1;
const keys = {};
let crouch = false;

const ray = new THREE.Raycaster(); ray.far = REACH;
const ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#ffb300', transparent: true, opacity: 0.25, depthWrite: false }));
const ghostEdges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: '#ffb300' }));
ghost.add(ghostEdges); ghost.visible = false; scene.add(ghost);
const handLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: '#ffb300', dashSize: 0.02, gapSize: 0.015 }));
handLine.frustumCulled = false; scene.add(handLine);
const pendingTube = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: '#ffb300', transparent: true, opacity: 0.6 }));
scene.add(pendingTube);
const highlight = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.003, 6, 24), new THREE.MeshBasicMaterial({ color: '#ffb300', depthTest: false }));
highlight.renderOrder = 10; scene.add(highlight);
const probeMarks = ['#e53935', '#111'].map(col => { const m = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.08, 10), new THREE.MeshStandardMaterial({ color: col })); m.visible = false; scene.add(m); return m; });

function doRaycast() {
  ray.setFromCamera(new THREE.Vector2(0, 0), camera);
  const ignore = carry ? new Set() : null;
  if (carry) meshes.get(carry.c.id)?.g.traverse(o => ignore.add(o));
  const hits = ray.intersectObjects(pickables, false).filter(h => !ignore || !ignore.has(h.object));
  if (!hits.length) return null;
  // terminais têm prioridade se estiverem quase na mesma distância
  const term = hits.find(h => h.object.userData.kind === 'term' && h.distance < hits[0].distance + 0.03);
  const h = term || hits[0];
  const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : UP.clone();
  return { ...h.object.userData, point: h.point, normal: n, dist: h.distance, object: h.object };
}

function surfaceQuat(n, rot) {
  const q = new THREE.Quaternion().setFromUnitVectors(UP, n.clone().normalize());
  return q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, rot));
}
function placeTarget() {
  if (!aim || aim.kind !== 'surf') return null;
  return { p: aim.point.clone(), q: surfaceQuat(aim.normal, ghostRot), chassis: aim.chassis, name: aim.name };
}

/* ------------------------------------------------------------------ */
/* Entrada                                                             */
/* ------------------------------------------------------------------ */
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => t.hidden = true, 3200); }
function setTool(i) { tool = (i + TOOLS.length) % TOOLS.length; if (tool !== 1) wiring = null; if (tool !== 3 && carry?.isNew) carry = null; if (tool === 3 && !carry) carry = { isNew: true, item: invSel }; renderHotbar(); }

const isTouch = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && innerWidth < 1100) || location.search.includes('touch');
let touchPlaying = false;
function playing() { return controls.isLocked || touchPlaying; }
function resume() {
  if (isTouch) { touchPlaying = true; $('menu').classList.add('hidden'); document.body.classList.add('touchplay'); }
  else controls.lock();
}
function pause() { touchPlaying = false; document.body.classList.remove('touchplay'); $('menu').classList.remove('hidden'); joy.x = joy.y = 0; }
controls.addEventListener('lock', () => $('menu').classList.add('hidden'));
controls.addEventListener('unlock', () => { $('menu').classList.remove('hidden'); for (const k in keys) keys[k] = false; });
$('play').onclick = () => resume();

/* ---------------- controles de toque ---------------- */
const joy = { id: null, x: 0, y: 0, ox: 0, oy: 0 };
const look = { id: null, x: 0, y: 0, sx: 0, sy: 0, t: 0, moved: false };
const eul = new THREE.Euler(0, 0, 0, 'YXZ');
if (isTouch) {
  document.body.classList.add('touch');
  renderer.setPixelRatio(Math.min(1.5, devicePixelRatio)); sun.shadow.mapSize.set(1024, 1024);
  const pad = $('joy'), knob = $('knob');
  pad.addEventListener('touchstart', e => { e.preventDefault(); const t = e.changedTouches[0], r = pad.getBoundingClientRect(); joy.id = t.identifier; joy.ox = r.left + r.width / 2; joy.oy = r.top + r.height / 2; moveJoy(t); }, { passive: false });
  const moveJoy = t => {
    let dx = t.clientX - joy.ox, dy = t.clientY - joy.oy; const L = Math.hypot(dx, dy), max = 50;
    if (L > max) { dx *= max / L; dy *= max / L; }
    joy.x = dx / max; joy.y = dy / max; knob.style.transform = `translate(${dx}px,${dy}px)`;
  };
  const game = renderer.domElement;
  game.addEventListener('touchstart', e => {
    e.preventDefault();
    const t = e.changedTouches[0];
    if (look.id === null) Object.assign(look, { id: t.identifier, x: t.clientX, y: t.clientY, sx: t.clientX, sy: t.clientY, t: performance.now(), moved: false });
  }, { passive: false });
  window.addEventListener('touchmove', e => {
    for (const t of e.changedTouches) {
      if (t.identifier === joy.id) moveJoy(t);
      else if (t.identifier === look.id && touchPlaying) {
        const dx = t.clientX - look.x, dy = t.clientY - look.y; look.x = t.clientX; look.y = t.clientY;
        if (Math.hypot(t.clientX - look.sx, t.clientY - look.sy) > 10) look.moved = true;
        eul.setFromQuaternion(camera.quaternion); eul.y -= dx * 0.006; eul.x = Math.max(-1.5, Math.min(1.5, eul.x - dy * 0.006));
        camera.quaternion.setFromEuler(eul);
      }
    }
  }, { passive: true });
  window.addEventListener('touchend', e => {
    for (const t of e.changedTouches) {
      if (t.identifier === joy.id) { joy.id = null; joy.x = joy.y = 0; knob.style.transform = ''; }
      if (t.identifier === look.id) { if (!look.moved && performance.now() - look.t < 300 && touchPlaying) leftClick(); look.id = null; }
    }
  });
  const btn = (id, fn) => $(id).addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); fn(); }, { passive: false });
  btn('tUse', () => leftClick()); btn('tBack', () => rightClick()); btn('tE', () => interact()); btn('tX', () => removeAimed());
  btn('tR', () => { ghostRot += Math.PI / 2; }); btn('tC', () => { crouch = !crouch; }); btn('tMenu', () => pause());
  btn('tPlus', () => { if (aim && (aim.kind === 'comp' || aim.kind === 'term')) adjust(aim.c, 1); });
  btn('tMinus', () => { if (aim && (aim.kind === 'comp' || aim.kind === 'term')) adjust(aim.c, -1); });
  $('hotbar').addEventListener('touchstart', e => { const d = e.target.closest('[data-tool]'); if (d) { e.preventDefault(); setTool(+d.dataset.tool); } }, { passive: false });
}

document.addEventListener('mousedown', e => {
  if (!playing()) return;
  if (e.button === 2) { rightClick(); return; }
  if (e.button !== 0) return;
  leftClick();
});
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('wheel', e => {
  if (!playing()) return;
  const dir = e.deltaY < 0 ? 1 : -1;
  if (tool === 0 && aim && aim.kind === 'comp' && adjust(aim.c, dir)) return;
  setTool(tool - dir);
}, { passive: true });

function adjust(c, dir) {
  const p = c.props;
  if (c.type === 'headunit') { p.volume = Math.max(0, Math.min(40, p.volume + dir)); return true; }
  if (c.type === 'amp4' || c.type === 'mono') { p.gain = Math.max(0, Math.min(100, p.gain + dir * 5)); return true; }
  if (c.type === 'fuse') { const i = FUSE_RATINGS.indexOf(p.rating); p.rating = FUSE_RATINGS[Math.max(0, Math.min(FUSE_RATINGS.length - 1, i + dir))]; return true; }
  if (c.type === 'ground') { p.surface = p.surface === 'pintado' ? 'lixado' : 'pintado'; toast(p.surface === 'pintado' ? 'Ponto de terra sobre a TINTA (mau contato)' : 'Ponto de terra lixado até o metal'); return true; }
  return false;
}

function leftClick() {
  if (carry) {
    const pt = placeTarget(); if (!pt) { toast('Mire numa superfície para instalar'); return; }
    if (carry.isNew) {
      const it = carry.item, c = world.addComp3(it.type, pt.p, pt.q, it.props);
      if (c.type === 'ground') { c.props.chassis = pt.chassis; if (!pt.chassis) toast('⚠️ Terra instalado fora do chassi (' + pt.name + ') – NÃO vai aterrar!'); }
      world.log(`🔩 ${compName(c)} instalado em: ${pt.name}`);
      carry = { isNew: true, item: it }; // continua com a peça na mão
    } else {
      carry.c.p.copy(pt.p); carry.c.q.copy(pt.q);
      if (carry.c.type === 'ground') carry.c.props.chassis = pt.chassis;
      carry = null;
    }
    sync(); return;
  }
  if (tool === 3) { carry = { isNew: true, item: invSel }; return leftClick(); }
  if (!aim) return;
  if (tool === 1) {
    if (aim.kind === 'term') {
      const t = { c: aim.c.id, t: aim.t };
      if (!wiring) { wiring = { a: t, pts: [] }; return; }
      const r = world.addWire(wiring.a, t, wiring.pts, wireDef);
      if (!r.ok) { toast(r.msg); return; }
      const w = r.w;
      world.log(w.kind === 'rca' ? '🔌 Cabo RCA conectado' : `🔌 Cabo ${String(w.gauge).replace('.', ',')} mm² ${w.mat === 'cca' ? 'CCA' : 'OFC'} conectado (${world.wireLen(w).toFixed(2)} m)`);
      wiring = null; sync(); return;
    }
    if (wiring) { const p = aim.point.clone().addScaledVector(aim.normal, wireRadiusDef() + 0.002); wiring.pts.push({ x: p.x, y: p.y, z: p.z }); }
    else toast('Mire num terminal para começar o cabo');
    return;
  }
  if (tool === 2) {
    if (aim.kind !== 'term') return;
    const t = { c: aim.c.id, t: aim.t };
    if (!probes.red || probes.black) probes = { red: t, black: null }; else probes.black = t;
    return;
  }
  if (tool === 0 && (aim.kind === 'comp' || aim.kind === 'term')) {
    carry = { c: aim.c, origP: aim.c.p.clone(), origQ: aim.c.q.clone() }; ghostRot = 0;
  }
}
function rightClick() {
  if (carry) { if (!carry.isNew) { carry.c.p.copy(carry.origP); carry.c.q.copy(carry.origQ); sync(); } carry = null; return; }
  if (wiring) { if (wiring.pts.length) wiring.pts.pop(); else wiring = null; }
}
function wireRadiusDef() { return Math.sqrt(wireDef.gauge / Math.PI) / 1000 + 0.0011; }

function interact() {
  if (!aim) return;
  if (aim.kind === 'wire') {
    const w = aim.w; if (w.st.burnt) { w.st = { T: T_AMB, burnt: false, I: 0, Iprev: 0 }; world.log('🔧 Cabo substituído por um novo'); }
    return;
  }
  if (aim.kind !== 'comp' && aim.kind !== 'term') return;
  const c = aim.c, s = c.st, p = c.props;
  if (c.type === 'fuse' && s.blown) { s.blown = false; s.th = 0; world.log(`🔁 Fusível ${p.rating} A trocado`); }
  else if (s.burnt || s.remBurnt) { initState(c); world.log(`🔧 ${compName(c)} substituído por um novo`); }
  else if (c.type === 'switch') { p.on = !p.on; audio.on && audio.crackle(); }
  else if (c.type === 'headunit') p.power = !p.power;
  else if (c.type === 'speaker' && SPK_MODELS[p.model].kind === 'tweeter') { p.cap = !p.cap; toast(p.cap ? 'Capacitor instalado no tweeter' : 'Capacitor REMOVIDO do tweeter'); }
}
function removeAimed() {
  if (!aim) return;
  if (aim.kind === 'wire') { world.removeWire(aim.w); world.log('✂️ Cabo removido'); }
  else if (aim.kind === 'comp' || aim.kind === 'term') { world.removeComp(aim.c); world.log(`🗑️ ${compName(aim.c)} removido`); if (probes.red?.c === aim.c.id || probes.black?.c === aim.c.id) probes = { red: null, black: null }; }
  sync();
}

document.addEventListener('keydown', e => {
  if (e.code === 'Tab') { e.preventDefault(); if (playing()) controls.unlock(); else resume(); return; }
  if (!playing()) return;
  keys[e.code] = true;
  if (e.code.startsWith('Digit')) { const n = +e.code.slice(5); if (n >= 1 && n <= 4) setTool(n - 1); }
  if (e.code === 'KeyE') interact();
  if (e.code === 'KeyX') removeAimed();
  if (e.code === 'KeyR') { ghostRot += Math.PI / 2 * (e.shiftKey ? -1 : 1); }
  if (e.code === 'KeyC') crouch = !crouch;
  if (e.code === 'KeyG') { const i = GAUGES.indexOf(wireDef.gauge); wireDef.gauge = GAUGES[(i + (e.shiftKey ? -1 : 1) + GAUGES.length) % GAUGES.length]; $('wGauge').value = wireDef.gauge; renderHotbar(); }
  if (e.code === 'KeyT') { wireDef.mat = wireDef.mat === 'cu' ? 'cca' : 'cu'; $('wMat').value = wireDef.mat; renderHotbar(); }
});
document.addEventListener('keyup', e => keys[e.code] = false);

/* ------------------------------------------------------------------ */
/* Menu                                                                */
/* ------------------------------------------------------------------ */
for (const g of GAUGES) $('wGauge').add(new Option(`${String(g).replace('.', ',')} mm² (${AWG[g]} AWG) · ~${AMPACITY[g]} A`, g));
$('wGauge').value = wireDef.gauge;
$('wGauge').onchange = e => { wireDef.gauge = +e.target.value; renderHotbar(); };
$('wMat').onchange = e => { wireDef.mat = e.target.value; renderHotbar(); };
$('wColor').onchange = e => wireDef.color = e.target.value;
for (const [k, s] of Object.entries(SIGNALS)) $('signal').add(new Option(s.name, k));
$('signal').onchange = e => world.signal = e.target.value;
$('motor').onchange = e => { world.motor = e.target.checked; world.log(world.motor ? '🚗 Motor ligado – alternador 14,4 V' : '🚗 Motor desligado'); };
$('speed').onchange = e => speed = +e.target.value;
$('sound').onchange = e => e.target.checked ? audio.start() : audio.stop();
$('btnExample').onclick = () => { buildExample(); resume(); };
$('btnReset').onclick = () => { if (confirm('Começar do zero (carro só com a bateria de fábrica)?')) { factoryCar(); resume(); } };
$('btnExport').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([world.save()], { type: 'application/json' })); a.download = 'somcar3d.json'; a.click(); };
$('btnImport').onclick = () => $('file').click();
$('file').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { world.load3(await f.text()); syncMenu(); sync(); } catch (err) { toast('Arquivo inválido (precisa ser da versão 3D)'); } e.target.value = ''; };
function syncMenu() { $('motor').checked = world.motor; $('signal').value = world.signal; }
function renderInv() {
  $('inv').innerHTML = '';
  for (const it of INVENTORY) {
    const b = document.createElement('button'); b.textContent = it.label; b.classList.toggle('on', it === invSel);
    b.onclick = () => { invSel = it; carry = { isNew: true, item: it }; ghostRot = 0; setTool(3); renderInv(); resume(); };
    $('inv').appendChild(b);
  }
}
function renderHotbar() {
  const sub = ['interagir / mover', `${String(wireDef.gauge).replace('.', ',')} mm² ${wireDef.mat === 'cca' ? 'CCA' : 'OFC'}`, 'medir tensão', invSel.label];
  $('hotbar').innerHTML = TOOLS.map((t, i) => `<div data-tool="${i}" class="${i === tool ? 'on' : ''}"><b>${i + 1}</b> ${t}<small>${sub[i]}</small></div>`).join('');
  $('meter').hidden = tool !== 2;
}

/* ------------------------------------------------------------------ */
/* Montagens                                                           */
/* ------------------------------------------------------------------ */
const Q = (n, rot = 0) => surfaceQuat(new THREE.Vector3(...n), rot);
function factoryCar() {
  world.reset(); probes = { red: null, black: null }; wiring = null; carry = null;
  const B = world.addComp3('battery', new THREE.Vector3(1.72, 0.3, -0.52), Q([0, 1, 0], Math.PI / 2));
  const G = world.addComp3('ground', new THREE.Vector3(1.52, 0.3, -0.25), Q([0, 1, 0]));
  world.addWire({ c: B.id, t: 'neg' }, { c: G.id, t: 'g' }, [], { gauge: 25, color: '#2b2b2b' });
  world.log('🚗 Carro de fábrica: bateria no cofre com o cabo negativo ligado ao chassi. Monte o resto!');
  syncMenu(); sync();
}
function route(a, b, z, y = 0.33) {
  const A = world.termPos(world.byId(a.c), a.t), Bp = world.termPos(world.byId(b.c), b.t);
  return [{ x: A.x, y: A.y + 0.05, z: A.z }, { x: A.x, y, z }, { x: Bp.x, y, z }, { x: Bp.x, y: Bp.y + 0.05, z: Bp.z }];
}
function buildExample() {
  factoryCar();
  const [B, G1] = world.comps;
  const add = (t, p, q, props) => world.addComp3(t, new THREE.Vector3(...p), q || Q([0, 1, 0]), props);
  const F1 = add('fuse', [1.5, 0.3, -0.62], null, { rating: 150 }), F2 = add('fuse', [1.5, 0.3, -0.75], null, { rating: 10 });
  const H = add('headunit', [1.08, 0.97, 0], Q([0, 1, 0], -Math.PI / 2), { volume: 18 });
  const Ksw = add('switch', [1.08, 0.97, -0.45], Q([0, 1, 0], -Math.PI / 2));
  const G4 = add('ground', [0.95, 0.3, 0.3]);
  const D = add('dist', [-1.3, 0.3, -0.62]);
  const A = add('amp4', [-1.85, 0.3, -0.45], null, { gain: 40 });
  const M = add('mono', [-1.85, 0.3, 0.05], null, { gain: 35 });
  const S = add('subdvc', [-1.82, 0.3, 0.6]);
  const G2 = add('ground', [-1.45, 0.3, -0.3]), G3 = add('ground', [-1.45, 0.3, 0.05]);
  const FL = add('speaker', [0.55, 0.55, -0.87], Q([0, 0, 1]), { model: '6' }), FR = add('speaker', [0.55, 0.55, 0.87], Q([0, 0, -1]), { model: '6' });
  const RL = add('speaker', [-1.13, 1.0125, -0.5], null, { model: '6x9' }), RR = add('speaker', [-1.13, 1.0125, 0.5], null, { model: '6x9' });
  const T = (c, t) => ({ c: c.id, t });
  const W = (a, b, z, gauge, color, y) => world.addWire(a, b, z === null ? [] : route(a, b, z, y), { gauge, color });
  W(T(B, 'pos'), T(F1, 'a'), null, 35);
  W(T(F1, 'b'), T(D, 'in'), -0.8, 35);
  W(T(D, 'o1'), T(A, 'p12'), -0.75, 10);
  W(T(D, 'o2'), T(M, 'p12'), -0.7, 25);
  W(T(A, 'gnd'), T(G2, 'g'), null, 10);
  W(T(M, 'gnd'), T(G3, 'g'), null, 25);
  W(T(F1, 'a'), T(F2, 'a'), null, 2.5);
  W(T(F2, 'b'), T(H, 'bat'), -0.6, 2.5, '#fdd835', 0.5);
  W(T(F2, 'b'), T(Ksw, 'a'), -0.65, 1.5, '#fdd835', 0.5);
  W(T(Ksw, 'b'), T(H, 'acc'), null, 1.5, '#fb8c00');
  W(T(H, 'gnd'), T(G4, 'g'), 0.3, 1.5, null, 0.5);
  W(T(H, 'rem'), T(A, 'rem'), -0.55, 0.75);
  W(T(A, 'rem'), T(M, 'rem'), null, 0.75);
  W(T(H, 'rcaF'), T(A, 'rca'), -0.15);
  W(T(H, 'rcaR'), T(M, 'rca'), -0.1);
  const outs = [['o1p', FL, 'p'], ['o1n', FL, 'n'], ['o2p', FR, 'p'], ['o2n', FR, 'n'], ['o3p', RL, 'p'], ['o3n', RL, 'n'], ['o4p', RR, 'p'], ['o4n', RR, 'n']];
  outs.forEach(([o, spk, t], i) => W(T(A, o), T(spk, t), spk === FL || spk === RL ? -0.82 + i * 0.01 : 0.78 + i * 0.01, 1.5, t === 'p' ? '#43a047' : '#9aa0a6'));
  W(T(M, 'op'), T(S, 'c1p'), null, 4, '#43a047'); W(T(S, 'c1p'), T(S, 'c2p'), null, 4, '#43a047');
  W(T(M, 'on'), T(S, 'c1n'), null, 4, '#9aa0a6'); W(T(S, 'c1n'), T(S, 'c2n'), null, 4, '#9aa0a6');
  world.log('📦 Montagem exemplo instalada. Vá até o painel, ligue o rádio (E) e use a rodinha para o volume.');
  syncMenu(); sync();
}

/* ------------------------------------------------------------------ */
/* HUD / informações                                                   */
/* ------------------------------------------------------------------ */
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const fmtA = I => Math.abs(I) < 1 ? (Math.abs(I) * 1000).toFixed(0) + ' mA' : Math.abs(I).toFixed(Math.abs(I) < 10 ? 2 : 1) + ' A';
const fmtT = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const row = (k, v, cls = '') => `<tr><td>${k}</td><td class="${cls}">${v}</td></tr>`;
const hrow = k => `<tr class="h"><td colspan="2">${k}</td></tr>`;
const tcls = (t, w, b) => t > b ? 'bad' : t > w ? 'warn' : '';

function infoHTML(a) {
  if (!a) return null;
  if (a.kind === 'wire') {
    const w = a.w, s = w.st;
    if (w.kind === 'rca') return `<h3>Cabo RCA</h3><div class="keys">[X] remover</div>`;
    const R = world.wireR(w), amp = world.wireAmpacity(w);
    return `<h3>Cabo ${String(w.gauge).replace('.', ',')} mm² (${AWG[w.gauge]} AWG) ${w.mat === 'cca' ? 'CCA' : 'OFC'}</h3><table>` +
      row('Comprimento', fmt(world.wireLen(w)) + ' m') + row('Resistência', (R * 1000).toFixed(2) + ' mΩ') +
      row('Corrente', fmtA(s.I), Math.abs(s.I) > amp ? 'bad' : '') + row('Capacidade', '~' + amp.toFixed(0) + ' A') +
      row('Queda de tensão', fmt(Math.abs(s.I * R), 3) + ' V', Math.abs(s.I * R) > 0.5 ? 'warn' : '') +
      row('Temperatura', s.burnt ? '🔥 DERRETIDO' : fmt(s.T, 0) + ' °C', s.burnt ? 'bad' : tcls(s.T, 70, WIRE_SMOKE)) +
      `</table><div class="keys">${s.burnt ? '[E] trocar cabo · ' : ''}[X] remover</div>`;
  }
  if (a.kind === 'surf') return null;
  const c = a.c, s = c.st, p = c.props;
  let h = `<h3>${compName(c)}</h3>`;
  if (a.kind === 'term') { const t = world.term(c, a.t); h += `<div>Terminal <b>${t.label}</b>${t.kind === 'p' ? ` · <b>${fmt(world.voltDC(c, a.t))} V</b> (ref. chassi)` : ' · RCA'}</div>`; }
  h += '<table>';
  let keysTxt = '[Clique c/ Mão] mover · [X] remover';
  switch (c.type) {
    case 'battery':
      h += row('Tensão', fmt(s.V) + ' V', s.V < 11.5 ? 'warn' : 'good') + row('Corrente', fmtA(s.I), s.I > 300 ? 'bad' : '') + row('Carga', (s.soc * 100).toFixed(1) + ' %');
      break;
    case 'fuse':
      h += row('Estado', s.blown ? '💥 QUEIMADO' : 'OK', s.blown ? 'bad' : 'good') + row('Corrente', fmtA(s.I)) + row('Aquecimento do elo', (s.th * 100).toFixed(0) + '%', s.th > 0.7 ? 'warn' : '');
      keysTxt = (s.blown ? '[E] trocar fusível · ' : '') + '[Rodinha] valor · ' + keysTxt; break;
    case 'ground':
      h += row('Fixado em', p.chassis === false ? '⚠️ fora do chassi' : 'metal do carro', p.chassis === false ? 'bad' : 'good') + row('Superfície', p.surface === 'pintado' ? 'tinta (mau contato)' : 'lixada', p.surface === 'pintado' ? 'warn' : '') + row('Corrente', fmtA(s.I)) + row('Calor no contato', fmt(s.P, 1) + ' W', s.P > 15 ? 'bad' : '');
      keysTxt = '[Rodinha] lixar/tinta · ' + keysTxt; break;
    case 'switch': h += row('Estado', p.on ? 'Ligada' : 'Desligada') + row('Corrente', fmtA(s.I)); keysTxt = '[E] liga/desliga · ' + keysTxt; break;
    case 'headunit':
      h += row('Estado', s.burnt ? '🔥 QUEIMADO' : s.on ? '🟢 Ligado' : '⚫ Desligado', s.burnt ? 'bad' : s.on ? 'good' : '') + row('Volume', p.volume + '/40') +
        row('B+ / ACC', fmt(s.vb, 1) + ' V / ' + fmt(s.va, 1) + ' V') + row('REM', s.remBurnt ? '🔥 queimada' : fmt(s.vrem, 1) + ' V · ' + fmtA(s.Irem), s.remBurnt ? 'bad' : '') + row('Saída RCA', fmt(s.vin) + ' V');
      keysTxt = '[E] liga/desliga · [Rodinha] volume · ' + keysTxt; break;
    case 'amp4': case 'mono': {
      const A = DEFS[c.type].amp;
      const stTxt = { off: s.uv ? '⚫ Desligado (subtensão)' : '⚫ Desligado', on: s.active ? '🟢 Ligado' : '🟡 Ligando', protect: '🔴 PROTEÇÃO', burnt: '🔥 QUEIMADO' }[s.status];
      h += row('Estado', stTxt, s.status === 'on' ? 'good' : s.status === 'off' ? '' : 'bad');
      if (s.status === 'protect' && s.protect) h += `<tr><td colspan="2" class="bad">${s.protect}</td></tr>`;
      h += row('Ganho', p.gain + '% (sens. ' + fmt(s.sens) + ' V)') + row('+12V→GND', fmt(s.vs) + ' V', s.vs < 11 ? 'warn' : '') + row('REM', fmt(s.vrem, 1) + ' V') +
        row('Clipping', s.clip > 0.01 ? `⚠️ ${(s.clip * 100).toFixed(0)}%` : 'não', s.clip > 0.1 ? 'bad' : s.clip > 0.01 ? 'warn' : 'good') +
        row('Saída (média)', fmt(s.Pout, 0) + ' W') + row('Consumo', fmtA(s.Pin / Math.max(1, s.vs))) + row('Temperatura', fmt(s.T, 0) + ' °C', tcls(s.T, 70, 85));
      h += hrow(A.model);
      for (const ch of s.ch || []) h += row(ch.name, ch.Z === Infinity ? 'sem carga' : `${fmt(ch.Z, 2)} Ω · ${fmt(ch.P, 0)} W`, ch.Z < A.Zmin * 0.99 ? 'warn' : '');
      keysTxt = `[Rodinha] ganho · fusível rec. ${A.fuse} A · ` + keysTxt; break;
    }
    case 'speaker': {
      const m = SPK_MODELS[p.model];
      h += row('Estado', s.burnt ? '🔥 QUEIMADO' : 'OK', s.burnt ? 'bad' : 'good') + row('Impedância', m.z + ' Ω') + row('Potência média', fmt(s.P, 1) + ' / ' + m.p + ' W', s.P > m.p ? 'bad' : '') +
        (s.Pdc > 0.1 ? row('Potência DC (!)', fmt(s.Pdc, 1) + ' W', 'bad') : '') + row('Temp. bobina', fmt(s.T, 0) + ' °C', tcls(s.T, 180, 250));
      if (m.kind === 'tweeter') { h += row('Capacitor', p.cap ? 'sim' : 'NÃO', p.cap ? '' : 'bad'); keysTxt = '[E] pôr/tirar capacitor · ' + keysTxt; }
      break;
    }
    case 'subdvc':
      h += row('Estado', s.burnt ? '🔥 QUEIMADO' : s.phase ? 'OK' : '⚠️ FORA DE FASE', s.burnt || !s.phase ? 'bad' : 'good');
      s.coils.forEach((co, i) => { h += row(`Bobina ${i + 1}`, co.burnt ? '🔥' : `${fmt(co.P, 0)} W · ${fmt(co.T, 0)} °C`, tcls(co.T, 180, 250)); });
      break;
    case 'dist': h += row('Barramento', fmt(world.voltDC(c, 'in')) + ' V'); break;
  }
  if ((s.burnt || s.remBurnt) && c.type !== 'fuse') keysTxt = '[E] substituir peça · ' + keysTxt;
  return h + `</table><div class="keys">${keysTxt}</div>`;
}

function aimHint() {
  if (isTouch) return aimHintRaw().replace(/\[Clique\]/g, '[Toque/USAR]').replace(/\[Direito\]/g, '[↶]');
  return aimHintRaw();
}
function aimHintRaw() {
  if (carry) return `<b>[Clique]</b> instalar ${carry.isNew ? carry.item.label : compName(carry.c)} · <b>[R]</b> girar · <b>[Direito]</b> cancelar`;
  if (!aim) return wiring ? 'cabo na mão – mire numa superfície ou terminal' : '';
  if (tool === 1) {
    if (aim.kind === 'term') return wiring ? '<b>[Clique]</b> conectar aqui' : '<b>[Clique]</b> começar cabo neste terminal';
    return wiring ? `<b>[Clique]</b> prender cabo aqui (${fmt(pendingLen(), 2)} m) · <b>[Direito]</b> desfazer` : '';
  }
  if (tool === 2 && aim.kind === 'term') return probes.red && !probes.black ? '<b>[Clique]</b> ponta PRETA' : '<b>[Clique]</b> ponta VERMELHA';
  if (tool === 3) return aim.kind === 'surf' ? `<b>[Clique]</b> instalar em ${aim.name}` : '';
  return '';
}
function pendingLen() {
  if (!wiring) return 0;
  const c = world.byId(wiring.a.c); if (!c) return 0;
  const p = [world.termPos(c, wiring.a.t), ...wiring.pts]; let L = 0;
  for (let i = 1; i < p.length; i++) L += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y, p[i].z - p[i - 1].z);
  if (aim) L += aim.point.distanceTo(new THREE.Vector3(p.at(-1).x, p.at(-1).y, p.at(-1).z));
  return L;
}
function updateMeter() {
  if (tool !== 2) return;
  let h = '<b>MULTÍMETRO</b>';
  const cr = probes.red && world.byId(probes.red.c), cb = probes.black && world.byId(probes.black.c);
  if (cr && cb && world.term(cr, probes.red.t).kind === 'p' && world.term(cb, probes.black.t).kind === 'p') {
    const vdc = world.voltDC(cr, probes.red.t) - world.voltDC(cb, probes.black.t), vac = world.voltAC(cr, probes.red.t) - world.voltAC(cb, probes.black.t);
    h += `<div class="lcd">${fmt(vdc)}<small> V DC</small></div><div class="row">AC (sinal): <b>${fmt(Math.abs(vac))} V</b></div>`;
  } else h += '<div class="lcd">----</div>';
  const nm = r => { const c = r && world.byId(r.c); return c ? `${compName(c)} · ${world.term(c, r.t).label}` : '—'; };
  h += `<div class="row"><span class="red">● VERM:</span> ${nm(probes.red)}</div><div class="row"><span class="blk">● PRETA:</span> ${nm(probes.black)}</div>`;
  $('meter').innerHTML = h;
}
function updateStatus() {
  let h = `⏱ <b>${fmtT(world.time)}</b>`;
  for (const b of world.comps.filter(c => c.type === 'battery')) h += ` · 🔋 <b>${fmt(b.st.V)} V</b> ${fmtA(b.st.I)} ${(b.st.soc * 100).toFixed(0)}%`;
  if (world.motor) h += ' · 🚗 motor'; if (speed === 0) h += ' · ⏸'; if (crouch) h += ' · agachado';
  $('status').innerHTML = h;
}
let logCount = 0;
function flushLog() {
  if (world.logs.length < logCount) { logCount = 0; $('log').innerHTML = ''; }
  for (let i = logCount; i < world.logs.length; i++) {
    const l = world.logs[i], d = document.createElement('div'); d.className = l.level; d.textContent = `${fmtT(l.t)}  ${l.msg}`;
    $('log').prepend(d); setTimeout(() => d.style.opacity = 0, 12000); setTimeout(() => d.remove(), 13000);
  }
  logCount = world.logs.length;
  while ($('log').children.length > 7) $('log').lastChild.remove();
}

/* ------------------------------------------------------------------ */
/* Loop                                                                */
/* ------------------------------------------------------------------ */
const tmpV = new THREE.Vector3();
let last = performance.now(), hudT = 0, faceT = 0, saveT = 0, animT = 0, eye = 1.65;
function frame(now) {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now; animT += dt;

  // movimento
  if (playing()) {
    const sp = (keys.ShiftLeft ? 4 : 2) * (crouch ? 0.5 : 1) * dt;
    if (keys.KeyW) controls.moveForward(sp); if (keys.KeyS) controls.moveForward(-sp);
    if (keys.KeyD) controls.moveRight(sp); if (keys.KeyA) controls.moveRight(-sp);
    if (joy.x || joy.y) { controls.moveForward(-joy.y * sp * 1.2); controls.moveRight(joy.x * sp * 1.2); }
    camera.position.x = Math.max(-11.5, Math.min(11.5, camera.position.x)); camera.position.z = Math.max(-11.5, Math.min(11.5, camera.position.z));
  }
  eye += ((crouch ? 0.95 : 1.65) - eye) * Math.min(1, dt * 10); camera.position.y = eye;
  workLight.position.copy(camera.position);

  // simulação
  if (speed > 0) { const sd = dt * speed, n = Math.max(1, Math.ceil(sd / 0.05)); for (let i = 0; i < n; i++) world.step(sd / n); }
  for (const e of world.events) { if (e.kind === 'pop') audio.pop(); else if (e.kind === 'crackle') audio.crackle(); else spawn(e.kind, e.x, e.y, e.z, e.n); }
  world.events.length = 0;
  audio.update(speed > 0 ? world.audio : { sub: 0, full: 0, tw: 0, clip: 0 }, world.signal);

  // mira
  aim = playing() ? doRaycast() : null;
  if (carry) {
    const pt = placeTarget();
    if (pt) {
      if (carry.isNew) {
        const d = DEFS[carry.item.type], s = carry.item.type === 'speaker' ? S3({ type: 'speaker', props: carry.item.props }) : carry.item.type === 'subdvc' ? 1.25 : 1;
        ghost.visible = true; ghost.scale.set(d.w * K * s, H3[carry.item.type] * s, d.h * K * s);
        ghost.quaternion.copy(pt.q); ghost.position.copy(pt.p).add(tmpV.set(0, ghost.scale.y / 2, 0).applyQuaternion(pt.q));
      } else { ghost.visible = false; carry.c.p.copy(pt.p); carry.c.q.copy(pt.q); }
    } else ghost.visible = false;
  } else ghost.visible = false;

  // cabo na mão
  if (wiring && world.byId(wiring.a.c)) {
    const c = world.byId(wiring.a.c), pts = [world.termPos(c, wiring.a.t), ...wiring.pts].map(p => new THREE.Vector3(p.x, p.y, p.z));
    if (pts.length >= 2) {
      const k = pts.map(p => p.toArray().join()).join('|') + wireDef.gauge;
      if (pendingTube.userData.k !== k) { pendingTube.geometry.dispose(); pendingTube.geometry = new THREE.TubeGeometry(polyCurve(pts), pts.length * 20, wireRadiusDef(), 6); pendingTube.userData.k = k; }
      pendingTube.visible = true;
    } else pendingTube.visible = false;
    const end = aim ? aim.point : camera.getWorldDirection(tmpV).multiplyScalar(1).add(camera.position);
    handLine.geometry.setFromPoints([pts.at(-1), end.clone()]); handLine.computeLineDistances(); handLine.visible = true;
  } else { handLine.visible = false; pendingTube.visible = false; if (wiring) wiring = null; }

  // destaque do terminal
  if (aim && aim.kind === 'term') { const p = world.termPos(aim.c, aim.t); highlight.position.set(p.x, p.y, p.z); highlight.lookAt(camera.position); highlight.visible = true; }
  else highlight.visible = false;
  $('cross').classList.toggle('term', !!aim && aim.kind === 'term');
  [probes.red, probes.black].forEach((r, i) => {
    const c = r && world.byId(r.c), m = probeMarks[i];
    m.visible = !!c && tool === 2;
    if (m.visible) { const p = world.termPos(c, r.t); m.position.set(p.x + (i ? 0.012 : -0.012), p.y + 0.04, p.z); m.rotation.z = Math.PI; }
  });

  // atualização visual de peças e cabos
  sync();
  for (const c of world.comps) {
    const m = meshes.get(c.id);
    if (m.cone) { const exc = c.st.exc || 0; m.cone.position.y = H3[c.type] - 0.02 + Math.sin(animT * ((c.type === 'subdvc' || SPK_MODELS[c.props.model]?.kind === 'sub' || world.signal === 'sine40') ? 38 : 75)) * exc * 0.006; }
    m.bodyMat.emissive?.set(c.st.burnt ? '#000' : (DEFS[c.type].amp && c.st.T > 60) ? new THREE.Color('#ff3300').multiplyScalar(Math.min(0.5, (c.st.T - 60) / 80)) : '#000');
    m.bodyMat.color.set(c.st.burnt ? '#1a1412' : BODY_COL[c.type]);
  }
  for (const w of world.wires) {
    const wm = wireMeshes.get(w.id); if (!wm || w.kind === 'rca') continue;
    const s = w.st, mat = wm.mesh.material;
    if (s.burnt) { mat.color.set('#20160f'); mat.emissive.set('#000'); }
    else {
      const heat = Math.max(0, Math.min(1, (s.T - 45) / (WIRE_MELT - 45)));
      mat.color.set(w.color).lerp(new THREE.Color('#ff7a00'), heat * 0.8);
      mat.emissive.set('#ff4400').multiplyScalar(heat > 0.4 ? (heat - 0.4) * 1.5 : 0);
    }
  }
  faceT += dt;
  if (faceT > 0.25) { faceT = 0; for (const c of world.comps) drawFaceTex(c, meshes.get(c.id)); }

  // efeitos contínuos
  for (const w of world.wires) {
    if (w.kind !== 'power') continue;
    const s = w.st;
    if (s.burnt && world.time - s.burnTime < 8) { if (Math.random() < 0.6) { const m = world.wireMid(w); spawn('fire', m.x, m.y, m.z, 2); spawn('smoke', m.x, m.y + 0.05, m.z, 1); } }
    else if (!s.burnt && s.T > 90 && Math.random() < (s.T - 90) / 100) { const p = world.wirePath(w), k = 1 + Math.floor(Math.random() * (p.length - 1)), f = Math.random(); spawn('smoke', p[k - 1].x + (p[k].x - p[k - 1].x) * f, p[k - 1].y + (p[k].y - p[k - 1].y) * f, p[k - 1].z + (p[k].z - p[k - 1].z) * f, 1); }
  }
  for (const c of world.comps) {
    const s = c.st, hot = (DEFS[c.type].amp && s.T > 80) || (s.burnt && world.time - (s.burnTime || 0) < 10) || (c.type === 'speaker' && s.T > 200);
    if (hot && Math.random() < 0.2) { const p = world.center(c); spawn('smoke', p.x, p.y, p.z, 1); }
  }
  sparks.update(dt, 9.8, true); smoke.update(dt, -0.05, true); fire.update(dt, -0.3, true);

  // HUD
  hudT += dt;
  if (hudT > 0.12) {
    hudT = 0;
    const ih = infoHTML(aim); $('info').hidden = !ih; if (ih) $('info').innerHTML = ih;
    updateStatus(); updateMeter();
  }
  $('aimHint').innerHTML = aimHint();
  flushLog();
  saveT += dt; if (saveT > 3) { saveT = 0; try { localStorage.setItem('somcar3d', world.save()); } catch (e) {} }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ */
renderInv(); renderHotbar();
try { const s = localStorage.getItem('somcar3d'); if (s) { world.load3(s); syncMenu(); sync(); world.log('💾 Montagem anterior restaurada'); } else factoryCar(); }
catch (e) { factoryCar(); }
if (location.search.includes('demo')) {
  buildExample(); if (isTouch) resume(); else $('menu').classList.add('hidden');
  const v = new URLSearchParams(location.search).get('cam');
  if (v) { const [x, y, z, tx, ty, tz] = v.split(',').map(Number); camera.position.set(x, y, z); eye = y; camera.lookAt(tx, ty, tz); }
  world.comps.find(c => c.type === 'headunit').props.volume = 30;
}
requestAnimationFrame(frame);
