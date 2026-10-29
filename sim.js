'use strict';
/* =====================================================================
   Motor de simulação elétrica (análise nodal) – Som automotivo
   - DC: bateria/alternador, cabos (resistência real por bitola/material/
     comprimento/temperatura), fusíveis, cargas de potência constante
   - AC (sinal de áudio, RMS equivalente): saídas do amplificador,
     alto-falantes, impedância vista por canal, ponte (bridge)
   - Térmico: cabos, fusíveis (curva tempo x corrente), bobinas, amp
   ===================================================================== */

const SCALE = 400;                     // px por metro (carro ≈ 4,5 m)
const RHO = { cu: 0.0172, cca: 0.0285 }; // Ω·mm²/m
const GAUGES = [0.5, 0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50];
const AWG = { 0.5: '20', 0.75: '18', 1: '17', 1.5: '16', 2.5: '14', 4: '12', 6: '10', 10: '8', 16: '6', 25: '4', 35: '2', 50: '1/0' };
const AMPACITY = { 0.5: 8, 0.75: 11, 1: 14, 1.5: 18, 2.5: 25, 4: 34, 6: 44, 10: 62, 16: 84, 25: 110, 35: 136, 50: 165 };
const FUSE_RATINGS = [5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 125, 150, 200, 250, 300];
const T_AMB = 25;
const ALT_MAX = 90;          // corrente máx. do alternador (A)
const R_INT = 0.012;         // resistência interna da bateria (Ω)
const ROUT = 0.05;           // impedância de saída do amplificador (Ω)
const WIRE_SMOKE = 110, WIRE_MELT = 165;

const SPK_MODELS = {
  '6':   { name: 'Alto-falante 6" 4Ω 60W RMS', z: 4, p: 60, kind: 'full', r: 26 },
  '6x9': { name: 'Alto-falante 6x9" 4Ω 100W RMS', z: 4, p: 100, kind: 'full', r: 32 },
  'tw':  { name: 'Tweeter 4Ω 50W RMS', z: 4, p: 50, kind: 'tweeter', r: 14 },
  'sub4':{ name: 'Subwoofer 12" 4Ω 400W RMS', z: 4, p: 400, kind: 'sub', r: 40 },
  'sub2':{ name: 'Subwoofer 12" 2Ω 600W RMS', z: 2, p: 600, kind: 'sub', r: 40 },
};
const DVC = { name: 'Subwoofer 12" DVC 2+2Ω 800W RMS', z: 2, p: 400 }; // por bobina

const SIGNALS = {
  music:  { name: 'Música (programa)', mf: 0.3, st: { full: 1, sub: 1, twc: 0.5, tw: 4 } },
  sine1k: { name: 'Senoide 1 kHz (teste)', mf: 1, st: { full: 1, sub: 1, twc: 1, tw: 1 } },
  sine40: { name: 'Senoide 40 Hz (grave)', mf: 1, st: { full: 1.8, sub: 1, twc: 0.15, tw: 12 } },
};

const T = (id, x, y, label, role, kind = 'p') => ({ id, x, y, label, role, kind });

const DEFS = {
  battery: { name: 'Bateria 12V 60Ah', w: 130, h: 80, props: { ah: 60 },
    terms: [T('pos', 28, 0, '+ Positivo', 'pos'), T('neg', 102, 0, '− Negativo', 'neg')] },
  ground: { name: 'Ponto de terra (chassi)', w: 50, h: 50, props: { surface: 'lixado' },
    terms: [T('g', 25, 12, 'Terra', 'neg')] },
  fuse: { name: 'Porta-fusível ANL', w: 110, h: 40, props: { rating: 60 },
    terms: [T('a', 0, 20, 'Entrada', 'pos'), T('b', 110, 20, 'Saída', 'pos')] },
  dist: { name: 'Distribuidor (bloco)', w: 70, h: 90, props: {},
    terms: [T('in', 0, 45, 'IN', 'pos'), T('o1', 70, 15, '1', 'pos'), T('o2', 70, 45, '2', 'pos'), T('o3', 70, 75, '3', 'pos')] },
  switch: { name: 'Chave liga/desliga', w: 80, h: 44, props: { on: true },
    terms: [T('a', 0, 22, 'A', 'pos'), T('b', 80, 22, 'B', 'pos')] },
  headunit: { name: 'Rádio (Head unit)', w: 190, h: 80, props: { volume: 18, power: true },
    terms: [T('bat', 25, 80, 'B+', 'pos'), T('acc', 55, 80, 'ACC', 'acc'), T('gnd', 85, 80, 'GND', 'neg'),
      T('rem', 115, 80, 'REM', 'rem'), T('rcaF', 150, 80, 'RCA D', 'sig', 's'), T('rcaR', 175, 80, 'RCA T', 'sig', 's')] },
  amp4: { name: 'Amplificador 4 canais', w: 230, h: 170, props: { gain: 40 },
    amp: { P: 100, Zr: 4, Zmin: 2, eff: 0.78, idle: 18, fuse: 40, model: '4x100W RMS @4Ω (14,4V) · 2Ω estável · ponte 4Ω',
      chans: [{ name: 'CH1', hot: 'o1p', ref: 'o1n', sign: 1 }, { name: 'CH2', hot: 'o2n', ref: 'o2p', sign: -1 },
              { name: 'CH3', hot: 'o3p', ref: 'o3n', sign: 1 }, { name: 'CH4', hot: 'o4n', ref: 'o4p', sign: -1 }] },
    terms: [T('p12', 0, 40, '+12V', 'pos'), T('gnd', 0, 85, 'GND', 'neg'), T('rem', 0, 130, 'REM', 'rem'), T('rca', 115, 0, 'RCA IN', 'sig', 's'),
      ...[1, 2, 3, 4].flatMap((n, i) => [T('o' + n + 'p', 230, 22 + i * 36, 'CH' + n + ' +', 'spk'), T('o' + n + 'n', 230, 40 + i * 36, 'CH' + n + ' −', 'spk')])] },
  mono: { name: 'Amplificador Mono (Classe D)', w: 210, h: 120, props: { gain: 35 },
    amp: { P: 1000, Zr: 1, Zmin: 1, eff: 0.86, idle: 25, fuse: 100, model: '1x1000W RMS @1Ω (14,4V) · 500W @2Ω · 250W @4Ω',
      chans: [{ name: 'OUT', hot: 'op', ref: 'on', sign: 1 }] },
    terms: [T('p12', 0, 30, '+12V', 'pos'), T('gnd', 0, 60, 'GND', 'neg'), T('rem', 0, 90, 'REM', 'rem'), T('rca', 105, 0, 'RCA IN', 'sig', 's'),
      T('op', 210, 45, 'SPK +', 'spk'), T('on', 210, 75, 'SPK −', 'spk')] },
  speaker: { name: 'Alto-falante', w: 90, h: 90, props: { model: '6x9', cap: true },
    terms: [T('p', 0, 33, '+', 'spk'), T('n', 0, 57, '−', 'spk')] },
  subdvc: { name: DVC.name, w: 130, h: 130, props: {},
    terms: [T('c1p', 0, 30, 'B1 +', 'spk'), T('c1n', 0, 52, 'B1 −', 'spk'), T('c2p', 0, 78, 'B2 +', 'spk'), T('c2n', 0, 100, 'B2 −', 'spk')] },
};

function compName(c) {
  if (c.type === 'speaker') return SPK_MODELS[c.props.model].name;
  if (c.type === 'fuse') return `Fusível ${c.props.rating}A`;
  return DEFS[c.type].name;
}

function initState(c) {
  const s = c.st = {};
  switch (c.type) {
    case 'battery': s.soc = 1; s.I = 0; s.V = 12.7; s.ig = 0; break;
    case 'fuse': s.blown = false; s.th = 0; s.I = 0; break;
    case 'amp4': case 'mono': Object.assign(s, { status: 'off', T: T_AMB, burnt: null, protect: null, protectUntil: 0,
      Pin: 0, Pout: 0, Pd: 0, vs: 0, vg: 12, vrem: 0, revT: 0, dOn: false, Irev: 0, Iref: 0, clip: 0, ch: [], onSince: 0, vin: 0 }); break;
    case 'speaker': Object.assign(s, { T: T_AMB, burnt: null, mech: 0, P: 0, exc: 0, Vac: 0 }); break;
    case 'subdvc': Object.assign(s, { coils: [{ T: T_AMB, burnt: false, P: 0, V: 0 }, { T: T_AMB, burnt: false, P: 0, V: 0 }], mech: 0, burnt: null, exc: 0, phase: true }); break;
    case 'headunit': Object.assign(s, { on: false, remBurnt: false, remHeat: 0, Irem: 0, burnt: false, vb: 0, vin: 0, vg: 12 }); break;
    case 'ground': s.I = 0; s.P = 0; break;
    case 'switch': s.I = 0; break;
  }
}

function solveNodal(n, elems) {
  const m = n - 1, V = new Float64Array(n);
  if (m <= 0) return V;
  const A = new Float64Array(m * m), b = new Float64Array(m);
  for (let i = 0; i < m; i++) A[i * m + i] = 1e-7; // gmin (fuga)
  for (const e of elems) {
    const g = 1 / e.r, a = e.a - 1, c = e.b - 1;
    if (a >= 0) A[a * m + a] += g;
    if (c >= 0) A[c * m + c] += g;
    if (a >= 0 && c >= 0) { A[a * m + c] -= g; A[c * m + a] -= g; }
    if (e.v) { const i = e.v * g; if (a >= 0) b[a] += i; if (c >= 0) b[c] -= i; }
  }
  for (let k = 0; k < m; k++) {
    let p = k, mx = Math.abs(A[k * m + k]);
    for (let i = k + 1; i < m; i++) { const v = Math.abs(A[i * m + k]); if (v > mx) { mx = v; p = i; } }
    if (p !== k) {
      for (let j = 0; j < m; j++) { const t = A[k * m + j]; A[k * m + j] = A[p * m + j]; A[p * m + j] = t; }
      const t = b[k]; b[k] = b[p]; b[p] = t;
    }
    const piv = A[k * m + k];
    if (Math.abs(piv) < 1e-18) continue;
    for (let i = k + 1; i < m; i++) {
      const f = A[i * m + k] / piv;
      if (f === 0) continue;
      for (let j = k; j < m; j++) A[i * m + j] -= f * A[k * m + j];
      b[i] -= f * b[k];
    }
  }
  for (let i = m - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < m; j++) s -= A[i * m + j] * V[j + 1];
    const d = A[i * m + i];
    V[i + 1] = Math.abs(d) < 1e-18 ? 0 : s / d;
  }
  return V;
}

const relax = (x, ss, dt, tau) => ss + (x - ss) * Math.exp(-dt / tau);

class World {
  constructor() { this.reset(); }

  reset() {
    this.comps = []; this.wires = []; this.nid = 1;
    this.motor = false; this.signal = 'music'; this.time = 0;
    this.events = []; this.logs = [];
    this.nodes = new Map([['0', 0]]); this.Vdc = new Float64Array(1); this.Vac = new Float64Array(1);
    this.audio = { sub: 0, full: 0, tw: 0, clip: 0, cancel: false };
  }

  byId(id) { return this.comps.find(c => c.id === id); }

  addComp(type, x, y, props) {
    const c = { id: 'c' + this.nid++, type, x, y, props: Object.assign({}, DEFS[type].props, props || {}) };
    initState(c);
    this.comps.push(c);
    return c;
  }

  term(c, tid) { return DEFS[c.type].terms.find(t => t.id === tid); }
  termPos(c, tid) { const t = this.term(c, tid); return { x: c.x + t.x, y: c.y + t.y }; }

  addWire(a, b, pts = [], opts = {}) {
    const ca = this.byId(a.c), cb = this.byId(b.c);
    if (!ca || !cb) return { ok: false, msg: 'Terminal inválido' };
    if (a.c === b.c && a.t === b.t) return { ok: false, msg: 'Não dá para ligar um terminal nele mesmo' };
    const ta = this.term(ca, a.t), tb = this.term(cb, b.t);
    if (ta.kind !== tb.kind) return { ok: false, msg: 'Cabo RCA (sinal) só liga em terminais RCA. Cabo de energia não entra em RCA.' };
    const kind = ta.kind === 's' ? 'rca' : 'power';
    let color = opts.color && opts.color !== 'auto' ? opts.color : null;
    if (!color) {
      const role = ta.role;
      color = kind === 'rca' ? '#d8d8d8' : role === 'pos' ? '#e53935' : role === 'neg' ? '#2b2b2b' : role === 'rem' ? '#1e88e5' : role === 'acc' ? '#fb8c00' : '#9aa0a6';
    }
    const w = { id: 'w' + this.nid++, a: { ...a }, b: { ...b }, pts: pts.map(p => ({ ...p })), kind,
      gauge: kind === 'rca' ? 0.2 : (opts.gauge || 10), mat: opts.mat || 'cu', color, len: opts.len || 0,
      st: { T: T_AMB, burnt: false, I: 0, Iprev: 0, smoked: false } };
    this.wires.push(w);
    return { ok: true, w };
  }

  removeComp(c) {
    this.comps = this.comps.filter(x => x !== c);
    this.wires = this.wires.filter(w => w.a.c !== c.id && w.b.c !== c.id);
  }
  removeWire(w) { this.wires = this.wires.filter(x => x !== w); }

  wirePath(w) {
    const ca = this.byId(w.a.c), cb = this.byId(w.b.c);
    return [this.termPos(ca, w.a.t), ...w.pts, this.termPos(cb, w.b.t)];
  }
  wireAutoLen(w) {
    const p = this.wirePath(w); let L = 0;
    for (let i = 1; i < p.length; i++) L += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
    return Math.max(0.05, L / SCALE);
  }
  wireLen(w) { return w.len > 0 ? w.len : this.wireAutoLen(w); }
  wireR(w) { return RHO[w.mat] * this.wireLen(w) / w.gauge * (1 + 0.0039 * (w.st.T - 20)) + 0.0004; /* + terminais */ }
  wireAmpacity(w) { return (AMPACITY[w.gauge] || 5) * (w.mat === 'cca' ? 0.78 : 1); }
  wireMid(w) {
    const p = this.wirePath(w), L = this.wireAutoLen(w) * SCALE / 2; let acc = 0;
    for (let i = 1; i < p.length; i++) {
      const d = Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
      if (acc + d >= L) { const f = (L - acc) / (d || 1); return { x: p[i - 1].x + (p[i].x - p[i - 1].x) * f, y: p[i - 1].y + (p[i].y - p[i - 1].y) * f }; }
      acc += d;
    }
    return p[0];
  }
  center(c) { const d = DEFS[c.type]; return { x: c.x + d.w / 2, y: c.y + d.h / 2 }; }

  log(msg, level = 'info') { this.logs.push({ t: this.time, msg, level }); }
  emit(kind, p, n = 1) { this.events.push({ kind, x: p.x, y: p.y, z: p.z || 0, n }); }

  burn(c, mode, msg) {
    if (c.st.burnt) return;
    c.st.burnt = mode; c.st.burnTime = this.time;
    this.log(`🔥 ${compName(c)}: ${msg}`, 'bad');
    this.emit('spark', this.center(c), 30); this.emit('smoke', this.center(c), 25); this.emit('pop', this.center(c));
  }

  nodeOf(c, tid) { return this.nodes.get(c.id + ':' + tid); }
  voltDC(c, tid) { const i = this.nodeOf(c, tid); return i === undefined ? NaN : (this.Vdc[i] || 0); }
  voltAC(c, tid) { const i = this.nodeOf(c, tid); return i === undefined ? NaN : (this.Vac[i] || 0); }

  /* ------------------------------------------------------------------ */
  step(dt) {
    this.time += dt;
    const comps = this.comps, sig = SIGNALS[this.signal];
    const byId = new Map(comps.map(c => [c.id, c]));
    const nodes = new Map([['0', 0]]);
    const nk = (c, t) => { const k = c.id + ':' + t; let i = nodes.get(k); if (i === undefined) { i = nodes.size; nodes.set(k, i); } return i; };
    for (const c of comps) for (const t of DEFS[c.type].terms) if (t.kind === 'p') nk(c, t.id);
    this.nodes = nodes;

    // ----- elementos passivos comuns (DC e AC) -----
    const passive = [];
    const R = (arr, a, b, r, tag) => arr.push({ a, b, r, tag });
    for (const w of this.wires) {
      if (w.kind !== 'power' || w.st.burnt) continue;
      const ca = byId.get(w.a.c), cb = byId.get(w.b.c);
      if (!ca || !cb) continue;
      R(passive, nk(ca, w.a.t), nk(cb, w.b.t), this.wireR(w), { w });
    }
    for (const c of comps) {
      const p = c.props, s = c.st, N = t => nk(c, t);
      switch (c.type) {
        case 'ground': if (p.chassis !== false) R(passive, N('g'), 0, p.surface === 'pintado' ? 0.35 : 0.002, { c, k: 'gnd' }); break;
        case 'fuse': if (!s.blown) R(passive, N('a'), N('b'), 0.0003 + 0.08 / p.rating, { c, k: 'fuse' }); break;
        case 'dist': for (const t of ['in', 'o1', 'o2', 'o3']) R(passive, N(t), N('_bus'), 0.0002); break;
        case 'switch': if (p.on) R(passive, N('a'), N('b'), 0.003, { c, k: 'sw' }); break;
        case 'amp4': case 'mono': {
          const A = DEFS[c.type].amp;
          R(passive, N('_ref'), N('gnd'), 0.005, { c, k: 'ref' });
          for (const ch of A.chans) R(passive, N(ch.ref), N('_ref'), 0.0005);
          break;
        }
      }
    }

    // ----- DC -----
    const dcBase = passive.slice();
    for (const c of comps) {
      const p = c.props, s = c.st, N = t => nk(c, t);
      switch (c.type) {
        case 'headunit': R(dcBase, N('bat'), N('gnd'), 1000); R(dcBase, N('acc'), N('gnd'), 10000); break;
        case 'amp4': case 'mono':
          R(dcBase, N('rem'), N('gnd'), 10000); R(dcBase, N('p12'), N('gnd'), 2000);
          if (s.burnt === 'short') R(dcBase, N('p12'), N('gnd'), 0.025, { c, k: 'short' });
          break;
        case 'speaker': if (!s.burnt) R(dcBase, N('p'), N('n'), 0.85 * SPK_MODELS[p.model].z, { c, k: 'coil', i: 0 }); break;
        case 'subdvc':
          if (!s.coils[0].burnt) R(dcBase, N('c1p'), N('c1n'), 0.85 * DVC.z, { c, k: 'coil', i: 0 });
          if (!s.coils[1].burnt) R(dcBase, N('c2p'), N('c2n'), 0.85 * DVC.z, { c, k: 'coil', i: 1 });
          break;
      }
    }
    for (const c of comps) { if (c.st.Idc) c.st.Idc = [0, 0]; }

    let V = null, el = null;
    for (let it = 0; it < 16; it++) {
      el = dcBase.slice();
      for (const c of comps) {
        const p = c.props, s = c.st, N = t => nk(c, t);
        if (c.type === 'battery') {
          const voc = 11.9 + 0.8 * s.soc; let v = voc, r = R_INT;
          if (this.motor) { if (s.ig < ALT_MAX) { v = 14.4; r = 0.004; } else v = voc + ALT_MAX * R_INT; }
          s._v = v; s._r = r;
          el.push({ a: N('pos'), b: N('neg'), r, v, tag: { c, k: 'bat' } });
        } else if (c.type === 'amp4' || c.type === 'mono') {
          if (s.status === 'on' && s.Pin > 0) { const vs = Math.max(s.vg, 4); el.push({ a: N('p12'), b: N('gnd'), r: vs * vs / s.Pin }); }
          if (s.dOn && s.burnt !== 'short') el.push({ a: N('gnd'), b: N('p12'), r: 0.02, v: 0.7, tag: { c, k: 'diode' } });
        } else if (c.type === 'headunit') {
          if (s.on) {
            const vs = Math.max(s.vg, 4); el.push({ a: N('bat'), b: N('gnd'), r: vs * vs / 14 });
            if (!s.remBurnt) el.push({ a: N('bat'), b: N('rem'), r: 2, tag: { c, k: 'rem' } });
          }
        }
      }
      V = solveNodal(nodes.size, el);
      let change = 0;
      for (const c of comps) {
        const s = c.st, N = t => nk(c, t);
        if (c.type === 'battery') {
          const I = (s._v - (V[N('pos')] - V[N('neg')])) / s._r; change = Math.max(change, Math.abs(I - s.ig) / 50); s.ig = I;
        } else if (c.type === 'amp4' || c.type === 'mono') {
          const vs = V[N('p12')] - V[N('gnd')];
          change = Math.max(change, Math.abs(vs - s.vg));
          s.vg = it === 0 ? vs : 0.5 * s.vg + 0.5 * vs;
          if (!s.dOn && -vs > 0.75) { s.dOn = true; change = 1; }
          else if (s.dOn && -vs < 0.65) { s.dOn = false; change = 1; }
        } else if (c.type === 'headunit') {
          const vs = V[N('bat')] - V[N('gnd')]; change = Math.max(change, Math.abs(vs - s.vg)); s.vg = 0.5 * s.vg + 0.5 * vs;
        }
      }
      if (it > 1 && change < 0.003) break;
    }
    this.Vdc = V;

    // correntes DC
    for (const c of comps) {
      if (c.type === 'amp4' || c.type === 'mono') { c.st.Irev = 0; c.st.Iref = 0; }
      if (c.type === 'headunit') c.st.Irem = 0;
      if (c.type === 'speaker' || c.type === 'subdvc') c.st.Idc = [0, 0];
    }
    for (const w of this.wires) if (w.kind === 'power') { w.st.Iprev = w.st.I; w.st.I = 0; }
    for (const e of el) {
      if (!e.tag) continue;
      const I = (V[e.a] - V[e.b] - (e.v || 0)) / e.r, t = e.tag;
      if (t.w) t.w.st.I = I;
      else if (t.k === 'bat') t.c.st.I = -I;
      else if (t.k === 'fuse' || t.k === 'gnd' || t.k === 'sw') t.c.st.I = I;
      else if (t.k === 'ref') t.c.st.Iref = I;
      else if (t.k === 'diode') t.c.st.Irev = -I;
      else if (t.k === 'rem') t.c.st.Irem = I;
      else if (t.k === 'coil') t.c.st.Idc[t.i] = I;
    }

    // ----- lógica: bateria / rádio -----
    let totalBatt = 0;
    for (const c of comps) {
      const s = c.st, p = c.props, N = t => nk(c, t);
      if (c.type === 'battery') {
        s.V = V[N('pos')] - V[N('neg')];
        totalBatt += s.I;
        if (this.motor && s.I < ALT_MAX) s.soc = Math.min(1, s.soc + (ALT_MAX - s.I) * 0.25 * dt / 3600 / p.ah);
        else s.soc = Math.max(0, s.soc - Math.max(0, this.motor ? s.I - ALT_MAX : s.I) * dt / 3600 / p.ah);
        if (s.I > 500) {
          if (!s.shortLogged) { this.log(`⚡ CURTO-CIRCUITO na bateria! ${s.I.toFixed(0)} A`, 'bad'); s.shortLogged = true; }
          if (Math.random() < 0.5) this.emit('spark', this.termPos(c, 'pos'), 6);
        } else if (s.I < 200) s.shortLogged = false;
      } else if (c.type === 'headunit') {
        const vb = V[N('bat')] - V[N('gnd')], va = V[N('acc')] - V[N('gnd')];
        s.vb = vb; s.va = va; s.vrem = V[N('rem')] - V[N('gnd')];
        if (!s.burnt && vb < -1.5) { this.burn(c, 'open', 'Polaridade invertida no rádio – queimou'); }
        const thr = s.on ? 9 : 10;
        s.on = !s.burnt && p.power && vb > thr && va > 8;
        s.vin = s.on && p.volume > 0 ? 4 * Math.pow(10, (p.volume - 40) * 0.75 / 20) : 0;
        if (s.on && !s.remBurnt && s.Irem > 0.5) {
          s.remHeat += dt;
          if (s.remHeat > 1.5) { s.remBurnt = true; this.log(`🔥 Saída REM do rádio queimou (${s.Irem.toFixed(2)} A). REM suporta ~0,3–0,5 A: use relé para muitos amplificadores ou não ligue o REM em carga/terra.`, 'bad'); this.emit('smoke', this.termPos(c, 'rem'), 10); }
        } else s.remHeat = Math.max(0, s.remHeat - dt * 0.5);
      }
    }
    this.totalBatt = totalBatt;

    // RCA: entrada de sinal dos amplificadores
    const rcaIn = new Map();
    for (const w of this.wires) {
      if (w.kind !== 'rca') continue;
      for (const [x, y] of [[w.a, w.b], [w.b, w.a]]) {
        const src = byId.get(y.c), dst = byId.get(x.c);
        if (src && dst && src.type === 'headunit' && DEFS[dst.type].amp && x.t === 'rca')
          rcaIn.set(dst.id, Math.max(rcaIn.get(dst.id) || 0, src.st.vin));
      }
    }

    // ----- lógica: amplificadores (pré-AC) -----
    let maxClip = 0;
    for (const c of comps) {
      const A = DEFS[c.type].amp; if (!A) continue;
      const s = c.st, p = c.props, N = t => nk(c, t);
      const vs = V[N('p12')] - V[N('gnd')], vrem = V[N('rem')] - V[N('gnd')];
      s.vs = vs; s.vrem = vrem;
      if (!s.burnt) {
        if (s.dOn && s.Irev > 1) {
          s.revT += dt;
          if (!s.revLogged) { this.log(`⚠️ ${compName(c)}: polaridade invertida! Diodo de proteção conduzindo ${s.Irev.toFixed(0)} A – o fusível precisa abrir.`, 'warn'); s.revLogged = true; }
          if (s.revT > 0.15) this.burn(c, 'short', 'polaridade invertida – diodo de proteção e MOSFETs em curto');
        } else { s.revT = Math.max(0, s.revT - dt); if (s.revT === 0) s.revLogged = false; }
        if (Math.abs(s.Iref) > 60) this.burn(c, 'open', `trilha de terra dos alto-falantes queimou (${Math.abs(s.Iref).toFixed(0)} A). Saída negativa ligada ao +12V?`);
        for (const ch of A.chans) {
          if (!s.burnt && Math.abs(V[N(ch.hot)] - V[N('gnd')]) > 5) this.burn(c, 'open', `saída ${ch.name} recebeu tensão DC externa (ligada ao +12V?) – estágio de saída queimou`);
        }
      }
      const was = s.status, wasActive = was === 'on' || was === 'protect';
      if (s.protect && (s.protectKind === 'temp' ? s.T < 70 : this.time > s.protectUntil)) { s.protect = null; }
      let st;
      if (s.burnt) st = 'burnt';
      else if (vrem < 5 || vs < (wasActive ? 9.0 : 10.5)) st = 'off';
      else if (vs > 16.5) { st = 'protect'; s.protect = 'Sobretensão (> 16,5 V)'; s.protectKind = 'ov'; s.protectUntil = this.time + 1; }
      else st = s.protect ? 'protect' : 'on';
      s.uv = st === 'off' && vrem >= 5 && vs > 1 && !s.burnt;
      if (st === 'off' && wasActive && s.uv && !s.uvLogged) { this.log(`⚠️ ${compName(c)} desligou por subtensão (${vs.toFixed(1)} V nos terminais). Cabo fino / terra ruim / bateria fraca?`, 'warn'); s.uvLogged = true; }
      if (st === 'on' && was !== 'on' && was !== 'protect') { s.onSince = this.time; s.uvLogged = false; }
      if (st === 'protect' && was !== 'protect') this.log(`🛑 ${compName(c)} entrou em PROTEÇÃO: ${s.protect}`, 'warn');
      s.status = st;
      s.vin = rcaIn.get(c.id) || 0;
      const Vnom = Math.sqrt(A.P * A.Zr);
      s.Vmax = Vnom * Math.min(1.06, Math.max(0, vs / 14.4));
      const sens = 8 * Math.pow(0.025, p.gain / 100);
      s.sens = sens;
      const vdem = Vnom * s.vin / sens;
      const cr = s.Vmax > 0 ? vdem / s.Vmax : 0;
      s.clip = cr > 1 ? 1 - 1 / cr : 0;
      s.vout = cr <= 1 ? vdem : s.Vmax * (1 + 0.414 * s.clip);
      s.active = st === 'on' && this.time - s.onSince > 1.2;
      if (s.active) maxClip = Math.max(maxClip, s.clip);
    }

    // ----- AC (sinal) -----
    const ac = passive.slice();
    for (const c of comps) {
      const p = c.props, s = c.st, N = t => nk(c, t);
      switch (c.type) {
        case 'battery': R(ac, N('pos'), N('neg'), R_INT); break;
        case 'amp4': case 'mono': {
          const A = DEFS[c.type].amp;
          R(ac, N('p12'), N('gnd'), 0.05);
          if (s.active) A.chans.forEach((ch, i) => ac.push({ a: N(ch.hot), b: N('_ref'), r: ROUT, v: ch.sign * s.vout, tag: { c, k: 'ch', i } }));
          break;
        }
        case 'speaker': if (!s.burnt) R(ac, N('p'), N('n'), SPK_MODELS[p.model].z); break;
        case 'subdvc':
          if (!s.coils[0].burnt) R(ac, N('c1p'), N('c1n'), DVC.z);
          if (!s.coils[1].burnt) R(ac, N('c2p'), N('c2n'), DVC.z);
          break;
      }
    }
    const Va = solveNodal(nodes.size, ac);
    this.Vac = Va;
    for (const c of comps) if (DEFS[c.type].amp) c.st.ch = DEFS[c.type].amp.chans.map(ch => ({ name: ch.name, V: 0, I: 0, P: 0, Z: Infinity }));
    for (const e of ac) {
      if (!e.tag || e.tag.k !== 'ch') continue;
      const vt = Va[e.a] - Va[e.b], I = (e.v - vt) / e.r;
      const ch = e.tag.c.st.ch[e.tag.i];
      ch.V = Math.abs(vt); ch.I = Math.abs(I); ch.P = Math.max(0, vt * I); ch.Z = ch.I > 1e-3 ? ch.V / ch.I : Infinity;
    }

    // ----- amplificadores (pós-AC) -----
    for (const c of comps) {
      const A = DEFS[c.type].amp; if (!A) continue;
      const s = c.st;
      let Pt = 0, minZ = Infinity;
      if (s.active) {
        for (const ch of s.ch) {
          Pt += ch.P; minZ = Math.min(minZ, ch.Z);
          if (ch.Z < 0.4 * A.Zmin && !s.protect) {
            s.protect = `curto-circuito / impedância muito baixa no ${ch.name} (${ch.Z.toFixed(2)} Ω, mín. ${A.Zmin} Ω)`; s.protectKind = 'short'; s.protectUntil = this.time + 3;
            this.log(`🛑 ${compName(c)} entrou em PROTEÇÃO: ${s.protect}`, 'warn'); s.status = 'protect'; s.active = false;
            this.emit('spark', this.center(c), 4);
          }
        }
      }
      if (s.active) {
        const Pavg = Pt * sig.mf;
        const effZ = A.eff * Math.pow(Math.min(1, minZ / A.Zmin), 0.35);
        s.Pout = Pavg; s.Pd = Pavg * (1 / effZ - 1) + A.idle; s.Pin = Pavg + s.Pd; s.minZ = minZ;
      } else {
        s.Pout = 0; s.Pd = s.status === 'on' || s.status === 'protect' ? A.idle : 0; s.Pin = s.Pd; s.minZ = Infinity;
        if (!s.active) for (const ch of s.ch) { ch.P = 0; }
      }
      if (s.burnt === 'short') { const I = Math.abs(s.vs) / 0.025; s.Pd = Math.min(5000, I * I * 0.025); }
      const Rth = 60 / (0.6 * A.P * A.chans.length * (1 / A.eff - 1) + A.idle);
      s.T = relax(s.T, T_AMB + s.Pd * Rth, dt, 60);
      if (s.T > 85 && !s.protect && !s.burnt) {
        s.protect = 'superaquecimento (> 85 °C)'; s.protectKind = 'temp';
        this.log(`🌡️ ${compName(c)} entrou em PROTEÇÃO térmica (${s.T.toFixed(0)} °C). Impedância baixa demais ou volume/ganho alto com senoide?`, 'warn');
      }
    }

    // ----- alto-falantes -----
    const au = { sub: 0, full: 0, tw: 0, clip: maxClip, cancel: false };
    const stressOf = (kind, cap) => kind === 'tweeter' ? (cap ? sig.st.twc : sig.st.tw) * (1 + 3 * maxClip) : kind === 'sub' ? sig.st.sub : sig.st.full;
    for (const c of comps) {
      const s = c.st, p = c.props, N = t => nk(c, t);
      if (c.type === 'speaker') {
        const m = SPK_MODELS[p.model];
        const Vc = s.burnt ? 0 : Va[N('p')] - Va[N('n')];
        const Pac = Vc * Vc / m.z, Pdc = s.Idc[0] * s.Idc[0] * 0.85 * m.z;
        const k = stressOf(m.kind, p.cap);
        const Pth = Pac * sig.mf * k + Pdc * 1.5;
        s.Vac = Vc; s.P = Pac * sig.mf; s.Pdc = Pdc;
        s.T = relax(s.T, T_AMB + 200 * Pth / m.p, dt, m.kind === 'tweeter' ? 2 : m.kind === 'sub' ? 8 : 5);
        if (!s.burnt) {
          if (Pdc > 2 && !s.dcLogged) { this.log(`⚠️ ${m.name}: recebendo corrente CONTÍNUA (${Math.abs(s.Idc[0]).toFixed(1)} A). Alto-falante não pode ir direto na bateria!`, 'warn'); s.dcLogged = true; }
          if (s.T > 300) this.burn(c, 'open', `bobina queimou por superaquecimento (${(Pth).toFixed(0)} W térmicos, suporta ${m.p} W RMS)`);
          if (Pac * k > 2.8 * m.p) s.mech += dt; else s.mech = Math.max(0, s.mech - dt * 0.5);
          if (!s.burnt && s.mech > 0.6) this.burn(c, 'open', m.kind === 'tweeter' && !p.cap ? 'tweeter sem capacitor recebeu graves – bobina destruída' : `excursão excessiva (${(Pac * k).toFixed(0)} W de pico) – suspensão/bobina danificada`);
        }
        s.exc = s.burnt ? 0 : Math.min(1.4, Math.sqrt(Pac / m.p));
        if (!s.burnt) au[m.kind === 'tweeter' ? 'tw' : m.kind] += Pac * sig.mf;
      } else if (c.type === 'subdvc') {
        const k = stressOf('sub');
        let Ptot = 0;
        s.coils.forEach((co, i) => {
          const Vc = co.burnt ? 0 : Va[N(`c${i + 1}p`)] - Va[N(`c${i + 1}n`)];
          const Pac = Vc * Vc / DVC.z, Pdc = s.Idc[i] * s.Idc[i] * 0.85 * DVC.z;
          co.V = Vc; co.P = Pac * sig.mf; co.Pdc = Pdc; Ptot += Pac;
          co.T = relax(co.T, T_AMB + 200 * (Pac * sig.mf * k + Pdc * 1.5) / DVC.p, dt, 8);
          if (!co.burnt && co.T > 300) { co.burnt = true; this.log(`🔥 ${DVC.name}: bobina ${i + 1} queimou por superaquecimento`, 'bad'); this.emit('smoke', this.center(c), 20); this.emit('pop', this.center(c)); }
        });
        const a = s.coils[0].V, b = s.coils[1].V;
        s.phase = !(Math.abs(a) > 0.5 && Math.abs(b) > 0.5 && Math.sign(a) !== Math.sign(b));
        if (!s.phase && !s.phaseLogged) { this.log('⚠️ Subwoofer DVC: bobinas FORA DE FASE – uma empurra, a outra puxa. Quase nenhum som e a bobina aquece!', 'warn'); s.phaseLogged = true; }
        if (s.phase) s.phaseLogged = false;
        if (Ptot * k > 2.8 * DVC.p * 2) s.mech += dt; else s.mech = Math.max(0, s.mech - dt * 0.5);
        if (s.mech > 0.6 && !s.coils[0].burnt) { s.coils[0].burnt = s.coils[1].burnt = true; this.log(`🔥 ${DVC.name}: excursão excessiva (${Ptot.toFixed(0)} W) – suspensão rasgou/bobina raspou`, 'bad'); this.emit('pop', this.center(c)); this.emit('smoke', this.center(c), 20); }
        s.burnt = s.coils[0].burnt && s.coils[1].burnt ? 'open' : null;
        s.exc = s.phase ? Math.min(1.4, Math.sqrt(Ptot / (2 * DVC.p))) : 0.05;
        if (s.phase) au.sub += Ptot * sig.mf; else au.cancel = true;
      }
    }
    this.audio = au;

    // ----- fusíveis, cabos, terra -----
    for (const c of comps) {
      const s = c.st, p = c.props;
      if (c.type === 'fuse' && !s.blown) {
        const r = Math.abs(s.I) / p.rating;
        s.th = relax(s.th, r * r / 1.3, dt, 4);
        if (s.th >= 1 || r > 25) {
          s.blown = true; s.th = 0;
          this.log(`💥 Fusível ${p.rating} A queimou (corrente ${Math.abs(s.I).toFixed(0)} A)`, r > 4 ? 'bad' : 'warn');
          this.emit('spark', this.center(c), 18); this.emit('pop', this.center(c));
        }
      } else if (c.type === 'ground') {
        const r = p.surface === 'pintado' ? 0.35 : 0.002;
        s.P = s.I * s.I * r;
        if (s.P > 15 && !s.hotLogged) { this.log(`⚠️ Ponto de terra ${p.surface === 'pintado' ? 'com TINTA' : ''} dissipando ${s.P.toFixed(0)} W – mau contato aquece e derruba a tensão. Lixe até o metal!`, 'warn'); s.hotLogged = true; }
        if (s.P > 40 && Math.random() < 0.2) this.emit('smoke', this.termPos(c, 'g'), 1);
      }
    }
    for (const w of this.wires) {
      if (w.kind !== 'power' || w.st.burnt) continue;
      const s = w.st, amp = this.wireAmpacity(w);
      const r = s.I / amp;
      const tau = 8 + 6 * Math.sqrt(w.gauge);
      s.T = relax(s.T, T_AMB + 45 * r * r, dt, tau);
      if (Math.abs(s.I) > 150 && Math.abs(s.Iprev) < 20) {
        for (const pt of [this.wirePath(w)[0], this.wirePath(w).at(-1)]) this.emit('spark', pt, 12);
        this.emit('crackle', this.wireMid(w));
      }
      if (s.T > WIRE_SMOKE && !s.smoked) { s.smoked = true; this.log(`💨 Cabo ${w.gauge} mm² (${AWG[w.gauge]} AWG) esquentando: ${s.T.toFixed(0)} °C com ${Math.abs(s.I).toFixed(0)} A (suporta ~${amp.toFixed(0)} A). Isolação começando a derreter!`, 'warn'); }
      if (s.T < WIRE_SMOKE - 20) s.smoked = false;
      if (s.T > WIRE_MELT) {
        s.burnt = true; s.burnTime = this.time; s.I = 0;
        this.log(`🔥 Cabo ${w.gauge} mm² DERRETEU e pegou fogo! Faltou fusível adequado (protege o CABO) perto da bateria.`, 'bad');
        this.emit('fire', this.wireMid(w), 40); this.emit('spark', this.wireMid(w), 25); this.emit('pop', this.wireMid(w));
      }
    }
  }

  /* ------------------------------------------------------------------ */
  serialize() {
    return JSON.stringify({ v: 1, nid: this.nid, motor: this.motor, signal: this.signal,
      comps: this.comps.map(c => ({ id: c.id, type: c.type, x: c.x, y: c.y, props: c.props })),
      wires: this.wires.map(w => ({ id: w.id, a: w.a, b: w.b, pts: w.pts, kind: w.kind, gauge: w.gauge, mat: w.mat, color: w.color, len: w.len })) });
  }
  load(json) {
    const d = typeof json === 'string' ? JSON.parse(json) : json;
    this.reset();
    this.nid = d.nid || 1; this.motor = !!d.motor; this.signal = d.signal || 'music';
    for (const c of d.comps) { if (!DEFS[c.type]) continue; const n = { ...c, props: Object.assign({}, DEFS[c.type].props, c.props) }; initState(n); this.comps.push(n); }
    for (const w of d.wires) this.wires.push({ ...w, st: { T: T_AMB, burnt: false, I: 0, Iprev: 0 } });
  }
}
