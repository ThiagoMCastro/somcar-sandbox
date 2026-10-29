'use strict';
/* Interface, desenho e interação do sandbox */

const world = new World();
const audio = new AudioEngine();
const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
const $ = id => document.getElementById(id);

let cam = { x: -60, y: -60, z: 0.6 };
let placing = null;          // {type, props}
let sel = null;              // {c} | {w}
let drag = null;             // {c,dx,dy} | {pan,sx,sy,cx,cy}
let wiring = null;           // {a:{c,t}, pts:[]}
let meterOn = false, probes = { red: null, black: null };
let mouse = { sx: 0, sy: 0, wx: 0, wy: 0 };
let speed = 1, particles = [], animT = 0;
const wireDef = { gauge: 10, mat: 'cu', color: 'auto' };

const PALETTE = [
  { type: 'battery', label: 'Bateria 12V 60Ah', col: '#555' },
  { type: 'ground', label: 'Ponto de terra (chassi)', col: '#999' },
  { type: 'fuse', label: 'Fusível / porta-fusível', col: '#ffca28' },
  { type: 'dist', label: 'Distribuidor', col: '#c9a227' },
  { type: 'switch', label: 'Chave (ignição/liga)', col: '#888' },
  { type: 'headunit', label: 'Rádio (Head unit)', col: '#29b6f6' },
  { type: 'amp4', label: 'Amplificador 4 canais', col: '#7e57c2' },
  { type: 'mono', label: 'Amplificador Mono 1000W', col: '#ab47bc' },
  { type: 'speaker', props: { model: '6' }, label: 'Alto-falante 6" 60W', col: '#78909c' },
  { type: 'speaker', props: { model: '6x9' }, label: 'Alto-falante 6x9" 100W', col: '#78909c' },
  { type: 'speaker', props: { model: 'tw', cap: true }, label: 'Tweeter 50W', col: '#90a4ae' },
  { type: 'speaker', props: { model: 'sub4' }, label: 'Subwoofer 12" 4Ω 400W', col: '#546e7a' },
  { type: 'speaker', props: { model: 'sub2' }, label: 'Subwoofer 12" 2Ω 600W', col: '#546e7a' },
  { type: 'subdvc', label: 'Subwoofer 12" DVC 2+2Ω', col: '#455a64' },
];
const ROLE_COL = { pos: '#e53935', neg: '#1b1b1b', rem: '#1e88e5', acc: '#fb8c00', spk: '#9aa0a6', sig: '#fdd835' };

/* ---------------- util ---------------- */
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const fmtA = I => Math.abs(I) < 1 ? (Math.abs(I) * 1000).toFixed(0) + ' mA' : Math.abs(I).toFixed(Math.abs(I) < 10 ? 2 : 1) + ' A';
const snap = v => Math.round(v / 10) * 10;
const toWorld = (sx, sy) => ({ x: sx / cam.z + cam.x, y: sy / cam.z + cam.y });
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => t.hidden = true, 3500); }

function hitTerm(wx, wy) {
  const r = Math.max(9, 7 / cam.z);
  for (let i = world.comps.length - 1; i >= 0; i--) {
    const c = world.comps[i];
    for (const t of DEFS[c.type].terms) if (Math.hypot(c.x + t.x - wx, c.y + t.y - wy) < r) return { c: c.id, t: t.id };
  }
  return null;
}
function hitComp(wx, wy) {
  for (let i = world.comps.length - 1; i >= 0; i--) {
    const c = world.comps[i], d = DEFS[c.type];
    if (wx >= c.x && wx <= c.x + d.w && wy >= c.y && wy <= c.y + d.h) return c;
  }
  return null;
}
function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function hitWire(wx, wy) {
  const tol = Math.max(5, 6 / cam.z);
  for (let i = world.wires.length - 1; i >= 0; i--) {
    const w = world.wires[i], p = world.wirePath(w);
    for (let k = 1; k < p.length; k++) if (segDist({ x: wx, y: wy }, p[k - 1], p[k]) < tol) return w;
  }
  return null;
}
const termOf = r => { const c = world.byId(r.c); return c && world.term(c, r.t); };

/* ---------------- toolbar ---------------- */
for (const g of GAUGES) $('wGauge').add(new Option(`${String(g).replace('.', ',')} mm² (${AWG[g]} AWG) · ~${AMPACITY[g]} A`, g));
$('wGauge').value = 10;
$('wGauge').onchange = e => wireDef.gauge = +e.target.value;
$('wMat').onchange = e => wireDef.mat = e.target.value;
$('wColor').onchange = e => wireDef.color = e.target.value;
for (const [k, s] of Object.entries(SIGNALS)) $('signal').add(new Option(s.name, k));
$('signal').onchange = e => world.signal = e.target.value;
$('motor').onchange = e => { world.motor = e.target.checked; world.log(world.motor ? '🚗 Motor ligado – alternador carregando (14,4 V, até 90 A)' : '🚗 Motor desligado – só bateria', 'info'); };
$('speed').onchange = e => speed = +e.target.value;
$('btnMeter').onclick = () => setMeter(!meterOn);
$('btnSound').onclick = () => {
  if (audio.on) { audio.stop(); $('btnSound').textContent = '🔇 Som desligado'; $('btnSound').classList.remove('on'); }
  else { audio.start(); $('btnSound').textContent = '🔊 Som ligado'; $('btnSound').classList.add('on'); }
};
$('btnExample').onclick = () => { if (!world.comps.length || confirm('Substituir a montagem atual pelo exemplo?')) buildExample(); };
$('btnClear').onclick = () => { if (confirm('Apagar tudo?')) { world.reset(); syncToolbar(); select(null); } };
$('btnExport').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([world.serialize()], { type: 'application/json' }));
  a.download = 'montagem-som.json'; a.click();
};
$('btnImport').onclick = () => $('file').click();
$('file').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try { world.load(await f.text()); syncToolbar(); select(null); } catch (err) { toast('Arquivo inválido'); }
  e.target.value = '';
};
function syncToolbar() { $('motor').checked = world.motor; $('signal').value = world.signal; }
function setMeter(on) {
  meterOn = on; $('btnMeter').classList.toggle('on', on); $('meter').hidden = !on;
  if (!on) probes = { red: null, black: null };
}

for (const item of PALETTE) {
  const b = document.createElement('button');
  b.className = 'pal'; b.innerHTML = `<i style="background:${item.col}"></i>${item.label}`;
  b.onclick = () => {
    placing = placing === item ? null : item; wiring = null;
    document.querySelectorAll('.pal').forEach(x => x.classList.toggle('on', x === b && placing));
  };
  $('palList').appendChild(b);
}
function clearPlacing() { placing = null; document.querySelectorAll('.pal').forEach(x => x.classList.remove('on')); }

/* ---------------- mouse ---------------- */
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('mousedown', e => {
  const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, w = toWorld(sx, sy);
  if (e.button === 2) { if (wiring) { wiring = null; return; } if (placing) { clearPlacing(); return; } }
  if (e.button !== 0) { drag = { pan: true, sx, sy, cx: cam.x, cy: cam.y }; return; }

  if (placing) {
    const d = DEFS[placing.type];
    const c = world.addComp(placing.type, snap(w.x - d.w / 2), snap(w.y - d.h / 2), placing.props);
    select({ c }); if (!e.shiftKey) clearPlacing();
    return;
  }
  const t = hitTerm(w.x, w.y);
  if (meterOn && t && !wiring) {
    if (!probes.red || probes.black) probes = { red: t, black: null }; else probes.black = t;
    return;
  }
  if (t) {
    if (!wiring) { wiring = { a: t, pts: [] }; return; }
    const res = world.addWire(wiring.a, t, wiring.pts, wireDef);
    if (!res.ok) { toast(res.msg); return; }
    wiring = null; select({ w: res.w });
    return;
  }
  if (wiring) { wiring.pts.push({ x: snap(w.x), y: snap(w.y) }); return; }
  const c = hitComp(w.x, w.y);
  if (c) { select({ c }); drag = { c, dx: w.x - c.x, dy: w.y - c.y }; world.comps.push(world.comps.splice(world.comps.indexOf(c), 1)[0]); return; }
  const wr = hitWire(w.x, w.y);
  if (wr) { select({ w: wr }); return; }
  select(null);
  drag = { pan: true, sx, sy, cx: cam.x, cy: cam.y };
});
window.addEventListener('mousemove', e => {
  const r = cv.getBoundingClientRect(); mouse.sx = e.clientX - r.left; mouse.sy = e.clientY - r.top;
  const w = toWorld(mouse.sx, mouse.sy); mouse.wx = w.x; mouse.wy = w.y;
  if (!drag) return;
  if (drag.pan) { cam.x = drag.cx - (mouse.sx - drag.sx) / cam.z; cam.y = drag.cy - (mouse.sy - drag.sy) / cam.z; }
  else if (drag.c) { drag.c.x = snap(w.x - drag.dx); drag.c.y = snap(w.y - drag.dy); }
});
window.addEventListener('mouseup', () => drag = null);
cv.addEventListener('wheel', e => {
  e.preventDefault();
  const before = toWorld(mouse.sx, mouse.sy);
  cam.z = Math.max(0.2, Math.min(3, cam.z * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
  cam.x = before.x - mouse.sx / cam.z; cam.y = before.y - mouse.sy / cam.z;
}, { passive: false });
cv.addEventListener('dblclick', () => {
  const c = hitComp(mouse.wx, mouse.wy); if (!c) return;
  if (c.type === 'switch') { c.props.on = !c.props.on; buildPanel(); }
  if (c.type === 'headunit') { c.props.power = !c.props.power; buildPanel(); }
});
window.addEventListener('keydown', e => {
  if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if (e.key === 'Escape') { wiring = null; clearPlacing(); if (meterOn) setMeter(false); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { deleteSel(); e.preventDefault(); }
  if (e.key === 'm' || e.key === 'M') setMeter(!meterOn);
  if (e.key === 'Backspace' && wiring) wiring.pts.pop();
});
function deleteSel() {
  if (!sel) return;
  if (sel.c) world.removeComp(sel.c); else world.removeWire(sel.w);
  select(null);
}

/* ---------------- painel ---------------- */
function select(s) { sel = s; buildPanel(); }
function field(label, html) { return `<div class="f"><label>${label}</label>${html}</div>`; }
function opts(list, cur) { return list.map(([v, t]) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${t}</option>`).join(''); }

function buildPanel() {
  const body = $('pBody');
  if (!sel) { $('pTitle').textContent = 'Nada selecionado'; body.innerHTML = '<p class="muted">Selecione um componente ou cabo para ver propriedades e medições.</p>'; $('pLive').innerHTML = ''; return; }
  let h = '';
  if (sel.w) {
    const w = sel.w;
    $('pTitle').textContent = w.kind === 'rca' ? 'Cabo RCA (sinal)' : 'Cabo de energia / áudio';
    if (w.kind === 'power') {
      h += field('Bitola', `<select data-w="gauge">${opts(GAUGES.map(g => [g, `${String(g).replace('.', ',')} mm² (${AWG[g]} AWG) · ~${AMPACITY[g]} A`]), w.gauge)}</select>`);
      h += field('Material', `<select data-w="mat">${opts([['cu', 'OFC (cobre puro)'], ['cca', 'CCA (alumínio cobreado – 65% mais resistivo)']], w.mat)}</select>`);
      h += field(`Comprimento (m) – 0 = automático (${fmt(world.wireAutoLen(w))} m)`, `<input type="number" min="0" step="0.1" data-w="len" value="${w.len || 0}">`);
      h += field('Cor', `<select data-w="color">${opts([['#e53935', 'Vermelho'], ['#2b2b2b', 'Preto'], ['#1e88e5', 'Azul'], ['#fdd835', 'Amarelo'], ['#fb8c00', 'Laranja'], ['#9aa0a6', 'Cinza'], ['#43a047', 'Verde'], ['#8e24aa', 'Roxo']], w.color)}</select>`);
    }
    h += `<div class="btns">${w.st.burnt ? '<button data-act="fixwire">Trocar cabo (novo)</button>' : ''}<button data-act="del">Excluir cabo</button></div>`;
  } else {
    const c = sel.c, p = c.props, d = DEFS[c.type];
    $('pTitle').textContent = compName(c);
    switch (c.type) {
      case 'fuse':
        h += field('Corrente nominal', `<select data-p="rating" data-num>${opts(FUSE_RATINGS.map(r => [r, r + ' A']), p.rating)}</select>`);
        h += `<div class="note">O fusível protege o <b>cabo</b>: escolha um valor menor que a capacidade do cabo e instale a até ~30 cm da bateria.</div>`;
        if (c.st.blown) h += `<div class="btns"><button data-act="fuse">🔁 Trocar fusível</button></div>`;
        break;
      case 'ground':
        h += field('Superfície do ponto', `<select data-p="surface">${opts([['lixado', 'Lixado até o metal (0,002 Ω)'], ['pintado', 'Sobre a tinta (≈0,35 Ω – mau contato)']], p.surface)}</select>`);
        break;
      case 'switch':
        h += `<div class="btns"><button data-act="toggle">${p.on ? '🟢 Ligada – clique para desligar' : '⚫ Desligada – clique para ligar'}</button></div>`;
        break;
      case 'headunit':
        h += `<div class="btns"><button data-act="power">${p.power ? '⏻ Desligar rádio' : '⏻ Ligar rádio'}</button></div>`;
        h += field(`Volume: <b id="volv">${p.volume}</b>/40`, `<input type="range" min="0" max="40" step="1" data-p="volume" data-num value="${p.volume}">`);
        h += `<div class="note">B+ (amarelo) = 12V constante · ACC (vermelho) = pós-chave · GND (preto) = terra · REM (azul) = liga amplificadores (máx. ~0,5 A). Pré-amplificador RCA 4 V.</div>`;
        break;
      case 'amp4': case 'mono':
        h += `<div class="note">${d.amp.model}<br>Fusível recomendado: <b>${d.amp.fuse} A</b> · Eficiência ${Math.round(d.amp.eff * 100)}%</div>`;
        h += field(`Ganho: <b id="gainv">${p.gain}</b>% <span class="muted" id="sensv"></span>`, `<input type="range" min="0" max="100" step="1" data-p="gain" data-num value="${p.gain}">`);
        h += `<div class="note">Ganho não é volume! Ganho alto = sensibilidade alta → clipping (distorção) que queima alto-falantes.</div>`;
        break;
      case 'speaker':
        h += field('Modelo', `<select data-p="model">${opts(Object.entries(SPK_MODELS).map(([k, m]) => [k, m.name]), p.model)}</select>`);
        if (SPK_MODELS[p.model].kind === 'tweeter') h += `<label class="chk"><input type="checkbox" data-p="cap" ${p.cap ? 'checked' : ''}> Com capacitor (crossover passa-altas)</label>`;
        break;
      case 'subdvc':
        h += `<div class="note">Duas bobinas de 2 Ω. Paralelo (B1+ com B2+, B1− com B2−) = 1 Ω. Série (B1− com B2+) = 4 Ω. Cuidado com a fase!</div>`;
        break;
    }
    const burnt = c.st.burnt || c.st.remBurnt;
    h += `<div class="btns">${burnt ? '<button data-act="repair">🔧 Substituir peça (nova)</button>' : ''}<button data-act="del">Excluir</button></div>`;
  }
  body.innerHTML = h;
  body.querySelectorAll('[data-p]').forEach(el => {
    const ev = el.type === 'range' ? 'input' : 'change';
    el.addEventListener(ev, () => {
      const k = el.dataset.p;
      sel.c.props[k] = el.type === 'checkbox' ? el.checked : el.dataset.num !== undefined ? +el.value : el.value;
      if (k === 'volume') $('volv').textContent = el.value;
      else if (k === 'gain') $('gainv').textContent = el.value;
      else buildPanel();
    });
  });
  body.querySelectorAll('[data-w]').forEach(el => el.addEventListener('change', () => {
    const k = el.dataset.w; sel.w[k] = k === 'gauge' || k === 'len' ? +el.value : el.value; buildPanel();
  }));
  body.querySelectorAll('[data-act]').forEach(el => el.addEventListener('click', () => {
    const a = el.dataset.act;
    if (a === 'del') deleteSel();
    else if (a === 'fuse') { sel.c.st.blown = false; sel.c.st.th = 0; world.log(`🔁 Fusível ${sel.c.props.rating} A substituído`); }
    else if (a === 'toggle') sel.c.props.on = !sel.c.props.on;
    else if (a === 'power') sel.c.props.power = !sel.c.props.power;
    else if (a === 'repair') { initState(sel.c); world.log(`🔧 ${compName(sel.c)} substituído por um novo`); }
    else if (a === 'fixwire') { sel.w.st = { T: T_AMB, burnt: false, I: 0, Iprev: 0 }; world.log('🔧 Cabo substituído'); }
    buildPanel();
  }));
  updateLive();
}

function row(k, v, cls = '') { return `<tr><td>${k}</td><td class="${cls}">${v}</td></tr>`; }
function hrow(k) { return `<tr class="h"><td colspan="2">${k}</td></tr>`; }
const tempCls = (t, w, b) => t > b ? 'bad' : t > w ? 'warn' : '';

function updateLive() {
  if (!sel) return;
  let h = '<table>';
  if (sel.w) {
    const w = sel.w, s = w.st;
    if (w.kind === 'rca') h += row('Sinal', 'Pré-amplificado (RCA)');
    else {
      const R = world.wireR(w), amp = world.wireAmpacity(w);
      h += row('Comprimento', fmt(world.wireLen(w)) + ' m');
      h += row('Resistência', (R * 1000).toFixed(2) + ' mΩ');
      h += row('Corrente', fmtA(s.I), Math.abs(s.I) > amp ? 'bad' : '');
      h += row('Capacidade (ar livre)', '~' + amp.toFixed(0) + ' A');
      h += row('Queda de tensão', fmt(Math.abs(s.I * R), 3) + ' V', Math.abs(s.I * R) > 0.5 ? 'warn' : '');
      h += row('Potência perdida (calor)', fmt(s.I * s.I * R, 1) + ' W');
      h += row('Temperatura', s.burnt ? '🔥 DERRETIDO' : fmt(s.T, 0) + ' °C', s.burnt ? 'bad' : tempCls(s.T, 70, WIRE_SMOKE));
    }
  } else {
    const c = sel.c, s = c.st, p = c.props;
    switch (c.type) {
      case 'battery':
        h += row('Tensão nos terminais', fmt(s.V) + ' V', s.V < 11.5 ? 'warn' : 'good');
        h += row('Corrente fornecida', fmtA(s.I), s.I > 300 ? 'bad' : '');
        h += row('Carga (SOC)', (s.soc * 100).toFixed(1) + ' %', s.soc < 0.3 ? 'bad' : '');
        h += row('Alternador', world.motor ? `ligado (${Math.min(ALT_MAX, Math.max(0, s.I)).toFixed(0)}/${ALT_MAX} A)` : 'desligado');
        break;
      case 'fuse':
        h += row('Estado', s.blown ? '💥 QUEIMADO (aberto)' : 'OK', s.blown ? 'bad' : 'good');
        h += row('Corrente', fmtA(s.I), Math.abs(s.I) > p.rating ? 'warn' : '');
        h += row('Aquecimento do elo', (s.th * 100).toFixed(0) + ' %', s.th > 0.7 ? 'warn' : '');
        break;
      case 'ground':
        h += row('Corrente para o chassi', fmtA(s.I));
        h += row('Calor no contato', fmt(s.P, 1) + ' W', s.P > 15 ? 'bad' : '');
        h += row('Tensão em relação ao chassi', fmt(world.voltDC(c, 'g'), 3) + ' V');
        break;
      case 'switch':
        h += row('Estado', p.on ? 'Ligada' : 'Desligada');
        h += row('Corrente', fmtA(s.I));
        break;
      case 'headunit':
        h += row('Estado', s.burnt ? '🔥 QUEIMADO' : s.on ? '🟢 Ligado' : '⚫ Desligado', s.burnt ? 'bad' : s.on ? 'good' : '');
        h += row('B+ → GND', fmt(s.vb) + ' V'); h += row('ACC → GND', fmt(s.va) + ' V');
        h += row('Saída REM', s.remBurnt ? '🔥 QUEIMADA' : fmt(s.vrem) + ' V / ' + fmtA(s.Irem), s.remBurnt ? 'bad' : s.Irem > 0.5 ? 'bad' : '');
        h += row('Saída RCA', fmt(s.vin, 2) + ' V RMS');
        break;
      case 'amp4': case 'mono': {
        const A = DEFS[c.type].amp;
        const stTxt = { off: s.uv ? '⚫ Desligado (subtensão)' : '⚫ Desligado', on: s.active ? '🟢 Ligado' : '🟡 Ligando (soft-start)', protect: '🔴 PROTEÇÃO', burnt: '🔥 QUEIMADO' }[s.status];
        h += row('Estado', stTxt, s.status === 'on' ? 'good' : s.status === 'off' ? '' : 'bad');
        if (s.status === 'protect' && s.protect) h += `<tr><td colspan="2" class="bad">${s.protect}</td></tr>`;
        if (s.burnt === 'short') h += `<tr><td colspan="2" class="bad">Em curto interno: drena corrente direto da bateria!</td></tr>`;
        h += row('+12V → GND (nos terminais)', fmt(s.vs) + ' V', s.vs < 11 ? 'warn' : '');
        h += row('REM', fmt(s.vrem) + ' V', s.vrem > 5 ? 'good' : '');
        h += row('Sinal RCA de entrada', fmt(s.vin) + ' V (sens. ' + fmt(s.sens) + ' V)');
        h += row('Clipping', s.clip > 0.01 ? `⚠️ ${(s.clip * 100).toFixed(0)}%` : 'não', s.clip > 0.1 ? 'bad' : s.clip > 0.01 ? 'warn' : 'good');
        h += row('Potência de saída (média)', fmt(s.Pout, 0) + ' W');
        h += row('Consumo', fmt(s.Pin, 0) + ' W / ' + fmtA(s.Pin / Math.max(1, s.vs)));
        h += row('Temperatura', fmt(s.T, 0) + ' °C', tempCls(s.T, 70, 85));
        h += hrow('Canais (sinal RMS de pico)');
        for (const ch of s.ch || []) h += row(ch.name, ch.Z === Infinity ? 'sem carga' : `${fmt(ch.V, 1)} V · ${fmt(ch.Z, 2)} Ω · ${fmt(ch.P, 0)} W`, ch.Z < A.Zmin * 0.99 ? 'warn' : '');
        if (c.type === 'amp4') h += `<tr><td colspan="2" class="muted">Ponte: CH1+ com CH2− (ou CH3+ com CH4−). Mín. 4 Ω em ponte.</td></tr>`;
        break;
      }
      case 'speaker': {
        const m = SPK_MODELS[p.model];
        h += row('Estado', s.burnt ? '🔥 QUEIMADO' : 'OK', s.burnt ? 'bad' : 'good');
        h += row('Impedância', m.z + ' Ω (Re ≈ ' + fmt(m.z * 0.85, 1) + ' Ω DC)');
        h += row('Tensão de sinal', fmt(Math.abs(s.Vac), 1) + ' V RMS');
        h += row('Potência média', fmt(s.P, 1) + ' W / ' + m.p + ' W RMS', s.P > m.p ? 'bad' : '');
        if (s.Pdc > 0.1) h += row('Potência DC (!)', fmt(s.Pdc, 1) + ' W', 'bad');
        h += row('Temp. da bobina', fmt(s.T, 0) + ' °C', tempCls(s.T, 180, 250));
        h += row('Polaridade', s.Vac < -0.3 ? '⚠️ invertida' : 'normal');
        break;
      }
      case 'subdvc':
        h += row('Estado', s.burnt ? '🔥 QUEIMADO' : s.phase ? 'OK' : '⚠️ FORA DE FASE', s.burnt || !s.phase ? 'bad' : 'good');
        s.coils.forEach((co, i) => {
          h += hrow('Bobina ' + (i + 1) + ' (2 Ω, 400 W)');
          h += row('Estado', co.burnt ? '🔥 queimada' : 'OK', co.burnt ? 'bad' : '');
          h += row('Sinal', fmt(co.V, 1) + ' V'); h += row('Potência média', fmt(co.P, 1) + ' W');
          h += row('Temperatura', fmt(co.T, 0) + ' °C', tempCls(co.T, 180, 250));
        });
        break;
      case 'dist': h += row('Barramento', fmt(world.voltDC(c, 'in')) + ' V'); break;
    }
    if (c.type === 'amp4' || c.type === 'mono') { const sv = $('sensv'); if (sv) sv.textContent = `(sens. ${fmt(c.st.sens)} V)`; }
  }
  $('pLive').innerHTML = h + '</table>';
}

/* ---------------- desenho ---------------- */
function resize() {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  cv.width = r.width * dpr; cv.height = r.height * dpr;
}
window.addEventListener('resize', resize);

function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function text(s, x, y, size = 11, col = '#ddd', align = 'center', weight = '') {
  ctx.font = `${weight} ${size}px system-ui, Segoe UI, sans-serif`; ctx.fillStyle = col; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y);
}

function drawCar() {
  ctx.save();
  ctx.strokeStyle = 'rgba(140,160,190,.25)'; ctx.lineWidth = 3; ctx.fillStyle = 'rgba(60,70,90,.12)';
  rr(0, 0, 1800, 800, 140); ctx.fill(); ctx.stroke();
  ctx.lineWidth = 2; ctx.setLineDash([12, 10]);
  ctx.beginPath(); ctx.moveTo(440, 30); ctx.lineTo(440, 770); ctx.moveTo(1320, 30); ctx.lineTo(1320, 770); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(120,140,170,.07)';
  for (const [x, y] of [[700, 140], [700, 500], [1000, 140], [1000, 500]]) { rr(x, y, 170, 160, 20); ctx.fill(); }
  for (const [x, y] of [[230, -20], [230, 780], [1450, -20], [1450, 780]]) { rr(x, y, 180, 40, 14); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill(); }
  text('COFRE DO MOTOR', 220, 770, 18, 'rgba(160,175,200,.35)', 'center', '700');
  text('HABITÁCULO', 880, 770, 18, 'rgba(160,175,200,.35)', 'center', '700');
  text('PORTA-MALAS', 1560, 770, 18, 'rgba(160,175,200,.35)', 'center', '700');
  ctx.restore();
}

function drawGrid(W, H) {
  const step = 50, x0 = Math.floor(cam.x / step) * step, y0 = Math.floor(cam.y / step) * step;
  ctx.strokeStyle = 'rgba(255,255,255,.035)'; ctx.lineWidth = 1 / cam.z;
  ctx.beginPath();
  for (let x = x0; x < cam.x + W / cam.z; x += step) { ctx.moveTo(x, cam.y); ctx.lineTo(x, cam.y + H / cam.z); }
  for (let y = y0; y < cam.y + H / cam.z; y += step) { ctx.moveTo(cam.x, y); ctx.lineTo(cam.x + W / cam.z, y); }
  ctx.stroke();
}

function mixCol(hex, to, f) {
  const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16);
  const ch = (v, s) => (v >> s) & 255;
  const m = s => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * f);
  return `rgb(${m(16)},${m(8)},${m(0)})`;
}

function strokePath(p) { ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y); for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y); ctx.stroke(); }

function drawWire(w) {
  const p = world.wirePath(w), s = w.st, isSel = sel && sel.w === w;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (w.kind === 'rca') {
    ctx.lineWidth = 5; ctx.strokeStyle = isSel ? '#ffb300' : '#111'; strokePath(p);
    ctx.lineWidth = 3; ctx.strokeStyle = '#cfd3d8'; strokePath(p);
    ctx.lineWidth = 1; ctx.strokeStyle = '#d32f2f'; strokePath(p);
    return;
  }
  const W = 1.6 + Math.sqrt(w.gauge) * 1.25;
  ctx.lineWidth = W + 3; ctx.strokeStyle = isSel ? '#ffb300' : 'rgba(0,0,0,.6)'; strokePath(p);
  if (s.burnt) {
    ctx.lineWidth = W; ctx.strokeStyle = '#3b2a1e'; ctx.setLineDash([6, 8]); strokePath(p); ctx.setLineDash([]);
    return;
  }
  let col = w.color;
  if (col === '#2b2b2b') ctx.lineWidth = W + 1.5, ctx.strokeStyle = '#555', strokePath(p);
  const heat = Math.max(0, Math.min(1, (s.T - 45) / (WIRE_MELT - 45)));
  ctx.lineWidth = W; ctx.strokeStyle = heat > 0 ? mixCol(col, '#ff7a00', heat) : col;
  if (heat > 0.5) { ctx.shadowColor = '#ff6a00'; ctx.shadowBlur = 20 * heat; }
  strokePath(p); ctx.shadowBlur = 0;
  const I = s.I;
  if (Math.abs(I) > 0.02) {
    const v = Math.min(220, 25 + 45 * Math.log10(1 + Math.abs(I))) * Math.sign(I);
    ctx.setLineDash([3, 12]); ctx.lineDashOffset = -animT * v;
    ctx.lineWidth = Math.max(1.2, W * 0.45); ctx.strokeStyle = `rgba(255,250,170,${Math.min(0.85, 0.25 + Math.abs(I) / 60)})`;
    strokePath(p); ctx.setLineDash([]);
  }
}

function drawTerm(c, t) {
  const x = c.x + t.x, y = c.y + t.y, d = DEFS[c.type];
  ctx.beginPath(); ctx.arc(x, y, t.kind === 's' ? 6 : 5.5, 0, Math.PI * 2);
  ctx.fillStyle = t.kind === 's' ? '#e0e0e0' : ROLE_COL[t.role]; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = t.kind === 's' ? '#d32f2f' : '#cfcfcf'; ctx.stroke();
  if (t.kind === 's') { ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fillStyle = '#ffca28'; ctx.fill(); }
  let lx = x, ly = y, al = 'center';
  if (t.x === 0) { lx = x + 9; al = 'left'; } else if (t.x === d.w) { lx = x - 9; al = 'right'; }
  else if (t.y === 0) ly = y + 13; else if (t.y === d.h) ly = y - 13;
  if (c.type !== 'ground') text(t.label, lx, ly, 9, '#e6e6e6', al, '600');
}

function drawComp(c) {
  const d = DEFS[c.type], s = c.st, p = c.props, x = c.x, y = c.y, isSel = sel && sel.c === c;
  ctx.save();
  switch (c.type) {
    case 'battery': {
      rr(x, y + 8, d.w, d.h - 8, 8); ctx.fillStyle = '#2f3338'; ctx.fill();
      rr(x, y + 8, d.w, 16, 6); ctx.fillStyle = '#3d4249'; ctx.fill();
      for (const [tx, col] of [[28, '#c62828'], [102, '#222']]) { rr(x + tx - 10, y - 2, 20, 12, 3); ctx.fillStyle = col; ctx.fill(); }
      text('12V 60Ah', x + d.w / 2, y + 44, 13, '#fff', 'center', '700');
      text(fmt(s.V) + ' V · ' + (s.soc * 100).toFixed(0) + '%', x + d.w / 2, y + 62, 10, s.V < 11.5 ? '#ff8a80' : '#9ccc65');
      break;
    }
    case 'ground': {
      ctx.strokeStyle = p.surface === 'pintado' ? '#ff8a65' : '#bbb'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(x + 25, y + 12); ctx.lineTo(x + 25, y + 28);
      for (const [w2, yy] of [[16, 28], [10, 35], [4, 42]]) { ctx.moveTo(x + 25 - w2, y + yy); ctx.lineTo(x + 25 + w2, y + yy); }
      ctx.stroke();
      text(p.surface === 'pintado' ? 'chassi (tinta!)' : 'chassi', x + 25, y + 52, 9, p.surface === 'pintado' ? '#ff8a65' : '#999');
      if (s.P > 15) { ctx.beginPath(); ctx.arc(x + 25, y + 12, 10, 0, 7); ctx.fillStyle = 'rgba(255,100,0,.35)'; ctx.fill(); }
      break;
    }
    case 'fuse': {
      rr(x + 6, y + 4, d.w - 12, d.h - 8, 6); ctx.fillStyle = '#20252b'; ctx.fill();
      rr(x + 22, y + 10, d.w - 44, d.h - 20, 3); ctx.fillStyle = s.blown ? '#3a2a20' : 'rgba(255,214,79,.25)'; ctx.fill();
      ctx.strokeStyle = s.blown ? '#5d4037' : mixCol('#ffd54f', '#ff3d00', Math.min(1, s.th)); ctx.lineWidth = 3;
      ctx.beginPath();
      if (s.blown) { ctx.moveTo(x + 26, y + 20); ctx.lineTo(x + 48, y + 20); ctx.moveTo(x + 62, y + 20); ctx.lineTo(x + 84, y + 20); }
      else { ctx.moveTo(x + 26, y + 20); ctx.lineTo(x + 84, y + 20); }
      ctx.stroke();
      text(p.rating + 'A' + (s.blown ? ' ✖' : ''), x + d.w / 2, y + 30, 10, s.blown ? '#ff8a80' : '#ffd54f', 'center', '700');
      break;
    }
    case 'dist':
      rr(x, y, d.w, d.h, 6); ctx.fillStyle = '#3a3320'; ctx.fill();
      rr(x + 16, y + 8, d.w - 32, d.h - 16, 4); ctx.fillStyle = '#c9a227'; ctx.fill();
      break;
    case 'switch': {
      rr(x, y, d.w, d.h, 8); ctx.fillStyle = '#262b31'; ctx.fill();
      ctx.strokeStyle = p.on ? '#66bb6a' : '#888'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x + 16, y + 22); ctx.lineTo(x + 64, p.on ? y + 22 : y + 6); ctx.stroke();
      text(p.on ? 'ON' : 'OFF', x + d.w / 2, y + 36, 9, p.on ? '#66bb6a' : '#999', 'center', '700');
      break;
    }
    case 'headunit': {
      rr(x, y, d.w, d.h, 8); ctx.fillStyle = '#15181c'; ctx.fill();
      rr(x + 12, y + 10, 110, 30, 4); ctx.fillStyle = s.on ? '#0d2a3a' : '#0b0d10'; ctx.fill();
      if (s.on) { text(`VOL ${p.volume}`, x + 67, y + 25, 15, '#4fc3f7', 'center', '700'); }
      else text(s.burnt ? 'QUEIMADO' : 'OFF', x + 67, y + 25, 12, s.burnt ? '#ff5252' : '#333', 'center', '700');
      ctx.beginPath(); ctx.arc(x + 155, y + 25, 15, 0, 7); ctx.fillStyle = '#2a2f36'; ctx.fill(); ctx.strokeStyle = '#555'; ctx.stroke();
      if (s.remBurnt) text('REM ✖', x + 115, y + 52, 9, '#ff5252');
      break;
    }
    case 'amp4': case 'mono': {
      const heat = Math.max(0, Math.min(1, (s.T - 40) / 60));
      rr(x, y, d.w, d.h, 10); ctx.fillStyle = s.burnt ? '#1a1414' : mixCol(c.type === 'amp4' ? '#3a2f5b' : '#4a2550', '#7a2a10', heat); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 3;
      for (let i = 30; i < d.w - 30; i += 12) { ctx.beginPath(); ctx.moveTo(x + i, y + 22); ctx.lineTo(x + i, y + d.h - 22); ctx.stroke(); }
      text(c.type === 'amp4' ? '4 CH · 4x100W' : 'MONO · 1000W', x + d.w / 2, y + d.h / 2 - 8, 14, '#fff', 'center', '800');
      text(fmt(s.T, 0) + ' °C', x + d.w / 2, y + d.h / 2 + 12, 10, heat > 0.6 ? '#ff8a65' : '#bbb');
      const leds = [['PWR', s.status === 'on' ? '#00e676' : '#123'], ['PROT', s.status === 'protect' || s.status === 'burnt' ? '#ff1744' : '#311'], ['CLIP', s.active && s.clip > 0.01 ? '#ffea00' : '#331']];
      leds.forEach(([l, col], i) => {
        const lx = x + 40 + i * 50, ly = y + d.h - 14;
        ctx.beginPath(); ctx.arc(lx, ly, 4, 0, 7); ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = col.length === 7 && col !== '#123' ? 8 : 0; ctx.fill(); ctx.shadowBlur = 0;
        text(l, lx + 8, ly, 8, '#aaa', 'left');
      });
      if (s.burnt) text('QUEIMADO', x + d.w / 2, y + 22, 12, '#ff5252', 'center', '800');
      break;
    }
    case 'speaker': case 'subdvc': {
      const m = c.type === 'speaker' ? SPK_MODELS[p.model] : { r: 52, kind: 'sub' };
      const cx = x + d.w / 2 + 6, cy = y + d.h / 2, burnt = !!s.burnt;
      rr(x, y, d.w, d.h, 8); ctx.fillStyle = '#1d2126'; ctx.fill();
      const wob = s.exc ? Math.sin(animT * (m.kind === 'sub' || world.signal === 'sine40' ? 40 : 90)) * s.exc * 3 : 0;
      ctx.beginPath(); ctx.arc(cx, cy, m.r + 4, 0, 7); ctx.fillStyle = '#0d0f12'; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, m.r + wob, 0, 7);
      const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, m.r);
      g.addColorStop(0, burnt ? '#2a1a14' : '#555'); g.addColorStop(1, burnt ? '#1a120e' : '#262a30');
      ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = '#3c4148'; ctx.lineWidth = 3; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, m.r * 0.32 + wob * 0.5, 0, 7); ctx.fillStyle = burnt ? '#222' : '#3a3f46'; ctx.fill();
      if (burnt) { ctx.strokeStyle = '#ff5252'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx - 14, cy - 14); ctx.lineTo(cx + 14, cy + 14); ctx.moveTo(cx + 14, cy - 14); ctx.lineTo(cx - 14, cy + 14); ctx.stroke(); }
      const T = c.type === 'speaker' ? s.T : Math.max(s.coils[0].T, s.coils[1].T);
      if (T > 150 && !burnt) { ctx.beginPath(); ctx.arc(cx, cy, m.r * 0.32, 0, 7); ctx.fillStyle = `rgba(255,90,0,${Math.min(0.7, (T - 150) / 200)})`; ctx.fill(); }
      const lbl = c.type === 'speaker' ? ({ '6': '6"', '6x9': '6x9"', tw: 'TW' + (p.cap ? '+C' : ''), sub4: '12" 4Ω', sub2: '12" 2Ω' })[p.model] : 'DVC 2+2Ω';
      text(lbl, cx, y + d.h - 8, 9, '#bbb', 'center', '700');
      if (c.type === 'subdvc' && !s.phase) text('FORA DE FASE', cx, y + 10, 9, '#ffb300', 'center', '700');
      break;
    }
  }
  if (isSel) { ctx.strokeStyle = '#ffb300'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); rr(x - 5, y - 5, d.w + 10, d.h + 10, 10); ctx.stroke(); ctx.setLineDash([]); }
  ctx.restore();
  for (const t of d.terms) drawTerm(c, t);
}

function drawProbe(r, col) {
  if (!r) return;
  const c = world.byId(r.c); if (!c) return;
  const p = world.termPos(c, r.t);
  ctx.strokeStyle = col; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 18, p.y - 30); ctx.stroke();
  ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, 7); ctx.stroke();
}

/* ---------------- partículas ---------------- */
function spawn(kind, x, y, n) {
  for (let i = 0; i < n; i++) {
    if (kind === 'spark') particles.push({ kind, x, y, vx: (Math.random() - 0.5) * 500, vy: (Math.random() - 0.8) * 450, life: 0.3 + Math.random() * 0.5 });
    else if (kind === 'smoke') particles.push({ kind, x: x + (Math.random() - 0.5) * 20, y, vx: (Math.random() - 0.5) * 20, vy: -30 - Math.random() * 40, life: 1.5 + Math.random() * 2, r: 6 + Math.random() * 8 });
    else if (kind === 'fire') particles.push({ kind, x: x + (Math.random() - 0.5) * 40, y, vx: (Math.random() - 0.5) * 30, vy: -60 - Math.random() * 60, life: 0.5 + Math.random() * 1.2, r: 5 + Math.random() * 8 });
  }
}
function updateParticles(dt) {
  for (const q of particles) {
    q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt;
    if (q.kind === 'spark') q.vy += 900 * dt; else q.r += dt * (q.kind === 'smoke' ? 10 : -3);
  }
  particles = particles.filter(q => q.life > 0 && (q.r === undefined || q.r > 0));
  if (particles.length > 1500) particles.splice(0, particles.length - 1500);
}
function drawParticles() {
  for (const q of particles) {
    if (q.kind === 'spark') {
      ctx.strokeStyle = `rgba(255,${200 + Math.random() * 55 | 0},80,${Math.min(1, q.life * 2)})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx * 0.02, q.y - q.vy * 0.02); ctx.stroke();
    } else if (q.kind === 'smoke') {
      ctx.fillStyle = `rgba(120,120,120,${Math.min(0.35, q.life * 0.15)})`; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 7); ctx.fill();
    } else {
      ctx.fillStyle = `rgba(255,${120 + Math.random() * 100 | 0},0,${Math.min(0.9, q.life)})`; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 7); ctx.fill();
    }
  }
}
function ambientEffects() {
  for (const w of world.wires) {
    if (w.kind !== 'power') continue;
    const s = w.st;
    if (s.burnt && world.time - s.burnTime < 6) { if (Math.random() < 0.5) { const m = world.wireMid(w); spawn('fire', m.x, m.y, 1); spawn('smoke', m.x, m.y, 1); } }
    else if (!s.burnt && s.T > 90 && Math.random() < (s.T - 90) / 120) {
      const p = world.wirePath(w), k = 1 + Math.floor(Math.random() * (p.length - 1)), f = Math.random();
      spawn('smoke', p[k - 1].x + (p[k].x - p[k - 1].x) * f, p[k - 1].y + (p[k].y - p[k - 1].y) * f, 1);
    }
  }
  for (const c of world.comps) {
    const s = c.st;
    const hot = (DEFS[c.type].amp && s.T > 80) || (s.burnt && world.time - (s.burnTime || 0) < 8) || (c.type === 'speaker' && s.T > 200);
    if (hot && Math.random() < 0.15) { const m = world.center(c); spawn('smoke', m.x, m.y - 10, 1); }
  }
}

/* ---------------- HUD / multímetro / tooltip ---------------- */
function updateHud() {
  const bats = world.comps.filter(c => c.type === 'battery');
  let h = `⏱ <b>${fmtTime(world.time)}</b>`;
  for (const b of bats) h += ` &nbsp; 🔋 <b>${fmt(b.st.V)} V</b> · ${fmtA(b.st.I)} · ${(b.st.soc * 100).toFixed(0)}%`;
  if (!bats.length) h += ' &nbsp; Coloque uma bateria para começar';
  if (world.motor) h += ' &nbsp; 🚗 alternador';
  if (speed === 0) h += ' &nbsp; ⏸ PAUSADO';
  $('hud').innerHTML = h;
}
const fmtTime = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
function probeName(r) { const c = world.byId(r.c); return c ? `${compName(c)} · ${world.term(c, r.t).label}` : '?'; }
function updateMeter() {
  if (!meterOn) return;
  let h = '<b>MULTÍMETRO</b>';
  if (probes.red && probes.black && world.byId(probes.red.c) && world.byId(probes.black.c)) {
    const [cr, cb] = [world.byId(probes.red.c), world.byId(probes.black.c)];
    const tr = world.term(cr, probes.red.t);
    if (tr.kind === 's') h += `<div class="lcd">RCA</div>`;
    else {
      const vdc = world.voltDC(cr, probes.red.t) - world.voltDC(cb, probes.black.t);
      const vac = world.voltAC(cr, probes.red.t) - world.voltAC(cb, probes.black.t);
      h += `<div class="lcd">${fmt(vdc, 2)}<small> V DC</small></div><div class="row">AC (sinal): <b>${fmt(Math.abs(vac), 2)} V</b></div>`;
    }
  } else h += `<div class="lcd">----</div>`;
  h += `<div class="row"><span class="red">● VERM:</span> ${probes.red ? probeName(probes.red) : 'clique num terminal'}</div>`;
  h += `<div class="row"><span class="blk">● PRETA:</span> ${probes.black ? probeName(probes.black) : probes.red ? 'clique no 2º terminal' : '—'}</div>`;
  $('meter').innerHTML = h;
}
function updateTip() {
  const tip = $('tip');
  if (drag) { tip.hidden = true; return; }
  let h = '';
  const t = hitTerm(mouse.wx, mouse.wy);
  if (t) {
    const c = world.byId(t.c), d = world.term(c, t.t);
    h = `<b>${compName(c)}</b> · ${d.label}`;
    if (d.kind === 'p') {
      h += `<br>Tensão (ref. chassi): <b>${fmt(world.voltDC(c, t.t), 2)} V</b>`;
      if (d.role === 'spk') h += `<br>Sinal AC: ${fmt(Math.abs(world.voltAC(c, t.t)), 2)} V`;
    } else h += '<br>Entrada/saída de sinal RCA';
    if (wiring) h += '<br><i>Clique para ligar aqui</i>';
  } else {
    const w = !hitComp(mouse.wx, mouse.wy) && hitWire(mouse.wx, mouse.wy);
    if (w) {
      if (w.kind === 'rca') h = '<b>Cabo RCA</b>';
      else {
        const R = world.wireR(w);
        h = `<b>Cabo ${String(w.gauge).replace('.', ',')} mm² (${AWG[w.gauge]} AWG) ${w.mat === 'cca' ? 'CCA' : 'OFC'}</b> · ${fmt(world.wireLen(w))} m`;
        h += w.st.burnt ? '<br><span class="bad">DERRETIDO</span>' : `<br>Corrente: <b>${fmtA(w.st.I)}</b> (máx ~${world.wireAmpacity(w).toFixed(0)} A) · ΔV ${fmt(Math.abs(w.st.I * R), 3)} V<br>Temperatura: ${fmt(w.st.T, 0)} °C`;
      }
    }
  }
  if (!h) { tip.hidden = true; return; }
  tip.innerHTML = h; tip.hidden = false;
  tip.style.left = Math.min(mouse.sx + 16, cv.clientWidth - tip.offsetWidth - 6) + 'px';
  tip.style.top = Math.min(mouse.sy + 16, cv.clientHeight - tip.offsetHeight - 6) + 'px';
}

let logCount = 0;
function flushLog() {
  if (world.logs.length === logCount) return;
  const box = $('log');
  for (let i = logCount; i < world.logs.length; i++) {
    const l = world.logs[i], div = document.createElement('div');
    div.className = l.level; div.innerHTML = `<span class="t">${fmtTime(l.t)}</span>`; div.append(l.msg);
    box.prepend(div);
  }
  logCount = world.logs.length;
  while (box.children.length > 200) box.lastChild.remove();
}

/* ---------------- loop ---------------- */
let last = performance.now(), liveT = 0, saveT = 0;
function frame(now) {
  const rdt = Math.min(0.05, (now - last) / 1000); last = now;
  animT += rdt;
  if (speed > 0) {
    const simDt = rdt * speed, n = Math.max(1, Math.ceil(simDt / 0.05));
    for (let i = 0; i < n; i++) world.step(simDt / n);
  }
  if (world.logs.length < logCount) logCount = 0, $('log').innerHTML = '';
  for (const e of world.events) {
    if (e.kind === 'pop') audio.pop(); else if (e.kind === 'crackle') audio.crackle(); else spawn(e.kind, e.x, e.y, e.n);
  }
  world.events.length = 0;
  ambientEffects(); updateParticles(rdt);
  audio.update(speed > 0 ? world.audio : { sub: 0, full: 0, tw: 0, clip: 0 }, world.signal);

  const dpr = window.devicePixelRatio || 1, W = cv.width / dpr, H = cv.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#12151a'; ctx.fillRect(0, 0, W, H);
  ctx.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, -cam.x * cam.z * dpr, -cam.y * cam.z * dpr);
  drawGrid(W, H); drawCar();
  for (const w of world.wires) drawWire(w);
  if (wiring) {
    const c = world.byId(wiring.a.c);
    if (c) {
      const p = [world.termPos(c, wiring.a.t), ...wiring.pts, { x: snap(mouse.wx), y: snap(mouse.wy) }];
      ctx.setLineDash([8, 6]); ctx.lineWidth = 3; ctx.strokeStyle = termOf(wiring.a).kind === 's' ? '#ddd' : '#ffb300'; strokePath(p); ctx.setLineDash([]);
    } else wiring = null;
  }
  for (const c of world.comps) drawComp(c);
  const ht = hitTerm(mouse.wx, mouse.wy);
  if (ht) { const c = world.byId(ht.c), p = world.termPos(c, ht.t); ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, 7); ctx.strokeStyle = '#ffb300'; ctx.lineWidth = 2; ctx.stroke(); }
  if (placing) {
    const d = DEFS[placing.type];
    ctx.globalAlpha = 0.4; ctx.strokeStyle = '#ffb300'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    rr(snap(mouse.wx - d.w / 2), snap(mouse.wy - d.h / 2), d.w, d.h, 8); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  if (meterOn) { drawProbe(probes.red, '#e53935'); drawProbe(probes.black, '#111'); }
  drawParticles();

  liveT += rdt; saveT += rdt;
  if (liveT > 0.15) { liveT = 0; updateLive(); updateHud(); updateMeter(); }
  updateTip(); flushLog();
  if (saveT > 3) { saveT = 0; try { localStorage.setItem('somcar', world.serialize()); } catch (e) {} }
  requestAnimationFrame(frame);
}

/* ---------------- montagem exemplo ---------------- */
function buildExample() {
  world.reset(); logCount = 0; $('log').innerHTML = '';
  const add = (t, x, y, p) => world.addComp(t, x, y, p);
  const B = add('battery', 60, 80), G1 = add('ground', 200, 200);
  const F1 = add('fuse', 230, 60, { rating: 150 }), F2 = add('fuse', 230, 130, { rating: 10 });
  const D = add('dist', 1360, 60), A = add('amp4', 1480, 40, { gain: 40 }), M = add('mono', 1480, 300, { gain: 35 });
  const S = add('subdvc', 1560, 560), G2 = add('ground', 1380, 240), G3 = add('ground', 1380, 420);
  const H = add('headunit', 470, 330, { volume: 18 }), K = add('switch', 470, 470), G4 = add('ground', 640, 480);
  const FL = add('speaker', 880, 30, { model: '6' }), FR = add('speaker', 880, 680, { model: '6' });
  const RL = add('speaker', 1200, 30, { model: '6x9' }), RR = add('speaker', 1200, 680, { model: '6x9' });
  const W = (c1, t1, c2, t2, pts, gauge, color) => world.addWire({ c: c1.id, t: t1 }, { c: c2.id, t: t2 }, pts.map(([x, y]) => ({ x, y })), { gauge, mat: 'cu', color });
  W(B, 'pos', F1, 'a', [[88, 40], [200, 40], [200, 80]], 35);
  W(F1, 'b', D, 'in', [[360, 80], [360, 25], [1330, 25], [1330, 105]], 35);
  W(D, 'o1', A, 'p12', [[1455, 75], [1455, 80]], 10);
  W(D, 'o2', M, 'p12', [[1445, 105], [1445, 330]], 25);
  W(B, 'neg', G1, 'g', [[162, 212]], 35);
  W(A, 'gnd', G2, 'g', [[1465, 125], [1465, 225], [1405, 225]], 10);
  W(M, 'gnd', G3, 'g', [[1465, 360], [1465, 405], [1405, 405]], 25);
  W(F1, 'a', F2, 'a', [[215, 80], [215, 150]], 2.5);
  W(F2, 'b', H, 'bat', [[380, 150], [380, 440], [495, 440]], 2.5, '#fdd835');
  W(F2, 'b', K, 'a', [[360, 150], [360, 492]], 1.5, '#fdd835');
  W(K, 'b', H, 'acc', [[565, 492], [565, 455], [525, 455]], 1.5, '#fb8c00');
  W(H, 'gnd', G4, 'g', [[555, 465], [665, 465]], 1.5);
  W(H, 'rem', A, 'rem', [[585, 445], [1300, 445], [1300, 170]], 0.75);
  W(A, 'rem', M, 'rem', [[1470, 170], [1470, 390]], 0.75);
  W(H, 'rcaF', A, 'rca', [[620, 520], [1320, 520], [1320, 10], [1595, 10]]);
  W(H, 'rcaR', M, 'rca', [[645, 510], [1310, 510], [1310, 280], [1585, 280]]);
  const outs = [['o1p', FL, 'p', true], ['o1n', FL, 'n', true], ['o2p', FR, 'p', false], ['o2n', FR, 'n', false],
                ['o3p', RL, 'p', true], ['o3n', RL, 'n', true], ['o4p', RR, 'p', false], ['o4n', RR, 'n', false]];
  outs.forEach(([ot, spk, st, up], k) => {
    const from = world.termPos(A, ot), to = world.termPos(spk, st);
    const X = 1735 + k * 7, Y = up ? -15 - k * 7 : 815 + k * 7, X2 = to.x - 15 - (k % 2) * 8;
    W(A, ot, spk, st, [[X, from.y], [X, Y], [X2, Y], [X2, to.y]], 1.5, st === 'p' ? '#43a047' : '#9aa0a6');
  });
  W(M, 'op', S, 'c1p', [[1720, 345], [1720, 540], [1540, 540], [1540, 590]], 4, '#43a047');
  W(S, 'c1p', S, 'c2p', [[1530, 590], [1530, 638]], 4, '#43a047');
  W(M, 'on', S, 'c1n', [[1730, 375], [1730, 550], [1515, 550], [1515, 612]], 4, '#9aa0a6');
  W(S, 'c1n', S, 'c2n', [[1545, 612], [1545, 660]], 4, '#9aa0a6');
  syncToolbar(); select(null);
  world.log('📦 Montagem exemplo carregada: bateria → fusível 150 A (35 mm²) → distribuidor → amp 4 canais + mono; sub DVC em paralelo (1 Ω). Rádio com fusível 10 A e chave de ignição.');
  world.log('💡 Ligue o som (botão no topo), suba o volume do rádio e o ganho dos amps. Experimente: tirar o fusível, usar cabo fino, inverter a bateria, tweeter sem capacitor...');
}

/* ---------------- início ---------------- */
resize();
try {
  const saved = localStorage.getItem('somcar');
  if (saved) { world.load(saved); syncToolbar(); world.log('💾 Montagem anterior restaurada.'); } else buildExample();
} catch (e) { buildExample(); }
requestAnimationFrame(frame);
