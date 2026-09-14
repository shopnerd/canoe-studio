// app.js — UI, 3D viewer, curve editors, analysis panels, exports.
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { PARAMS, DEFAULTS, buildDesign, sliceLoops, WATER_PCF } from './hull.js';
import { toBinarySTL, makeZip } from './solids.js';
import { RULESETS, checkRules } from './rules.js';
const RULE_YEAR = 2027;

const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (html) e.innerHTML = html; return e; };
const PSPEC = Object.fromEntries(PARAMS.map(p => [p.key, p]));
const COLORS = { crossSection: '#7048e8', profile: '#c2255c', plan: '#2b8a3e', sheer: '#1f6fb2', accent: '#d9480f' };
const GROUP_COLOR = { 'Cross section': COLORS.crossSection, 'Profile (bow + keel)': COLORS.profile, 'Plan (top curve)': COLORS.plan, 'Sheer (top rocker)': COLORS.sheer };
const fmt = (v, d = 2) => { if (v === null || v === undefined || !isFinite(v)) return '—'; const s = Number(v).toFixed(d); return /^-0\.?0*$/.test(s) ? s.slice(1) : s; };
const STORE = 'canoe-studio:v1';

// ─── state ──────────────────────────────────────────────────────────────────────────────
let params = { ...DEFAULTS };
let designName = 'Untitled canoe';
let design = null;       // latest buildDesign() on the main thread
let built = null;        // latest worker result {solids, analysis}
let builtKey = '';       // params key of `built`
let baseline = null;     // pinned analysis for comparison
const undo = [];

function loadInitial() {
  try {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('p')) {
      const o = JSON.parse(decodeURIComponent(escape(atob(h.get('p')))));
      Object.assign(params, sanitize(o.params || o)); if (o.name) designName = o.name; return;
    }
  } catch { /* bad link — fall through */ }
  try { const s = JSON.parse(localStorage.getItem(STORE)); if (s) { Object.assign(params, sanitize(s.params)); designName = s.name || designName; baseline = s.baseline || null; } } catch { /* no storage */ }
}
function sanitize(o) { const out = {}; for (const k in o) if (PSPEC[k] && isFinite(+o[k])) out[k] = +o[k]; return out; }
function persist() { try { localStorage.setItem(STORE, JSON.stringify({ params, name: designName, baseline })); } catch { /* private mode */ } }
const paramsKey = (p = params) => JSON.stringify(PARAMS.map(s => p[s.key]));

// ─── parameter panel ────────────────────────────────────────────────────────────────────
const inputs = {};
function buildParamPanel() {
  const root = $('#params');
  const groups = [...new Set(PARAMS.map(p => p.group))];
  for (const g of groups) {
    const det = el('details', { class: 'group' });
    det.open = !['Mold blocks', 'Lofting', 'Analysis inputs', 'Rules & structure'].includes(g);
    const sum = el('summary', {}, `<span>${g}</span>` + (GROUP_COLOR[g] ? `<i class="swatch" style="background:${GROUP_COLOR[g]}"></i>` : ''));
    det.append(sum);
    const body = el('div', { class: 'body' });
    for (const s of PARAMS.filter(p => p.group === g)) {
      const row = el('div', { class: 'prm', 'data-key': s.key });
      const id = 'p_' + s.key;
      row.innerHTML = `<div class="row"><label for="${id}">${s.label}</label><input class="num" type="number" step="${s.step}" aria-label="${s.label} value"><span class="unit">${s.unit}</span></div>
        <input id="${id}" type="range" min="${s.min}" max="${s.max}" step="${s.step}">` + (s.help ? `<div class="help">${s.help}</div>` : '');
      const range = row.querySelector('input[type=range]'), num = row.querySelector('.num');
      range.addEventListener('pointerdown', () => pushUndo());
      range.addEventListener('keydown', () => pushUndo());
      range.addEventListener('input', () => setParam(s.key, +range.value, 'range'));
      num.addEventListener('change', () => { pushUndo(); setParam(s.key, +num.value, 'num'); });
      inputs[s.key] = { row, range, num };
      body.append(row);
    }
    det.append(body);
    root.append(det);
  }
  syncInputs();
}
function syncInputs() {
  for (const s of PARAMS) {
    const { row, range, num } = inputs[s.key];
    const v = params[s.key];
    range.value = v;
    if (document.activeElement !== num) num.value = +v.toFixed(s.step < 0.01 ? 4 : s.step < 1 ? 3 : 0);
    row.classList.toggle('changed', Math.abs(v - s.def) > 1e-9);
  }
}
function clampParam(key, v) { const s = PSPEC[key]; return Math.min(s.max, Math.max(s.min, s.step >= 1 ? Math.round(v) : v)); }
function setParam(key, v, source) {
  if (!isFinite(v)) return;
  params[key] = clampParam(key, v);
  if (source !== 'range') syncInputs(); else { const s = PSPEC[key]; inputs[key].num.value = +params[key].toFixed(s.step < 0.01 ? 4 : s.step < 1 ? 3 : 0); inputs[key].row.classList.toggle('changed', Math.abs(params[key] - s.def) > 1e-9); }
  scheduleUpdate();
}
function setParams(obj) { for (const k in obj) params[k] = clampParam(k, obj[k]); syncInputs(); scheduleUpdate(); }
function pushUndo() { const k = paramsKey(); if (!undo.length || paramsKey(undo[undo.length - 1]) !== k) { undo.push({ ...params }); if (undo.length > 100) undo.shift(); } }

// ─── update pipeline ────────────────────────────────────────────────────────────────────
let rafPending = false;
function scheduleUpdate() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; update(); });
}
function update() {
  try {
    design = buildDesign(params);
  } catch (err) { setStatus('error', 'Geometry error: ' + err.message); return; }
  updateScene();
  drawEditors();
  drawWarnings();
  persist();
  scheduleWorker();
}

// ─── worker ─────────────────────────────────────────────────────────────────────────────
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let workerBusy = false, workerQueued = false, workerTimer = 0, reqId = 0, workerReady = false;
function needMold() { return layerOn('mold') || activeTab === 'build'; }
function scheduleWorker(delay = 350) {
  clearTimeout(workerTimer);
  workerTimer = setTimeout(sendWorker, delay);
}
function sendWorker() {
  if (!workerReady) { workerQueued = true; return; }
  if (workerBusy) { workerQueued = true; return; }
  const key = paramsKey() + (needMold() ? ':m' : '');
  if (built && builtKey === key) return;
  if (built && !needMold() && builtKey === paramsKey() + ':m') return; // already have more than we need
  workerBusy = true;
  setStatus('busy', needMold() ? 'Building solids, mold blocks & analysis…' : 'Building shell & analysis…');
  worker.postMessage({ type: 'build', id: ++reqId, params: { ...params }, mold: needMold(), key });
  worker._key = key;
}
worker.onmessage = e => {
  const m = e.data;
  if (m.type === 'boot') { workerReady = true; sendWorker(); return; }
  workerBusy = false;
  if (m.type === 'error') { setStatus('error', 'Solid build failed: ' + m.message); }
  else if (m.type === 'built') {
    built = m; builtKey = worker._key;
    const stale = !builtKey.startsWith(paramsKey());
    setStatus(stale ? 'busy' : 'ok', stale ? 'Updating…' : `Solids ${m.ms.solids.toFixed(0)} ms · analysis ${m.ms.analysis.toFixed(0)} ms`);
    updateSolids();
    renderAnalysis();
    renderRules();
    renderBuild();
    drawEditors();
    drawWarnings();
  }
  if (workerQueued) { workerQueued = false; sendWorker(); }
  else sendWorker();
};
worker.onerror = e => setStatus('error', 'Worker failed to start: ' + (e.message || 'check the console'));

function setStatus(kind, text) {
  const s = $('#status');
  s.classList.toggle('busy', kind === 'busy'); s.classList.toggle('error', kind === 'error');
  $('#statusText').textContent = text;
}

// ─── three.js scene ─────────────────────────────────────────────────────────────────────
const vp = $('#viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
vp.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 1, 5000);
camera.up.set(0, 0, 1);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.12;
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.8); sun.position.set(200, -300, 400); scene.add(sun);
const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-300, 200, 100); scene.add(fill);

const groups = {};
for (const k of ['hull', 'stations', 'curves', 'shell', 'water', 'mold', 'ground']) { groups[k] = new THREE.Group(); scene.add(groups[k]); }
const mats = {
  hull: new THREE.MeshStandardMaterial({ color: 0xcfccc3, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
  shell: new THREE.MeshStandardMaterial({ color: 0xa9a79f, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }),
  water: new THREE.MeshBasicMaterial({ color: 0x1f6fb2, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
  mold: new THREE.MeshStandardMaterial({ color: 0xe6d3a3, roughness: 0.9, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
  station: new THREE.LineBasicMaterial({ color: 0x3b4048, transparent: true, opacity: 0.45 }),
  sheerLine: new THREE.LineBasicMaterial({ color: 0x1f2328 }),
  waterEdge: new THREE.LineBasicMaterial({ color: 0x1f6fb2 }),
};

function disposeGroup(g) { for (const c of [...g.children]) { g.remove(c); c.geometry?.dispose(); } }
function layerOn(name) { return $(`#layerToggles input[data-layer="${name}"]`).checked; }

function rowsGeometry(rows) {
  const R = rows.length, M1 = rows[0].length, Lp = 2 * M1 - 1;
  const pos = new Float32Array(R * Lp * 3);
  let o = 0;
  for (const row of rows) {
    for (let j = 0; j < M1; j++) { pos[o++] = row[j][0]; pos[o++] = row[j][1]; pos[o++] = row[j][2]; }
    for (let j = M1 - 2; j >= 0; j--) { pos[o++] = row[j][0]; pos[o++] = -row[j][1]; pos[o++] = row[j][2]; }
  }
  const idx = [];
  for (let r = 0; r < R - 1; r++) for (let c = 0; c < Lp - 1; c++) {
    const a = r * Lp + c, b = a + 1, d = a + Lp, e = d + 1;
    idx.push(a, b, e, a, e, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function soupGeometry(soup) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(soup, 3));
  g.computeVertexNormals();
  return g;
}
function lineGeo(pls) {
  const pts = [];
  for (const pl of pls) for (let i = 1; i < pl.length; i++) pts.push(...pl[i - 1], ...pl[i]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); return g;
}

let framedFor = '';
function updateScene() {
  const d = design, p = d.p;
  // hull surface
  disposeGroup(groups.hull);
  if (d.hullRows.length > 1) {
    groups.hull.add(new THREE.Mesh(rowsGeometry(d.hullRows), mats.hull));
    const top = d.hullRows.map(r => r[0]);
    groups.hull.add(new THREE.Line(lineGeo([top.concat(top.slice().reverse().map(q => [q[0], -q[1], q[2]]), [top[0]])]), mats.sheerLine));
  }
  // station lines (every 'sub' row) — the guide contours
  disposeGroup(groups.stations);
  const sub = 3, mid = Math.floor(d.rows.length / 2);
  const st = [];
  if (d.hullRows.length === d.rows.length) d.hullRows.forEach((r, i) => { if ((i - mid) % sub === 0) st.push(r.concat(r.slice().reverse().slice(1).map(q => [q[0], -q[1], q[2]]))); });
  groups.stations.add(new THREE.LineSegments(lineGeo(st), mats.station));
  // control curves in 3D
  disposeGroup(groups.curves);
  const cv = d.curves;
  for (const [k, pls] of [['crossSection', [cv.crossSection]], ['profile', [cv.profile]], ['plan', [cv.plan]], ['sheer', [cv.sheer]]]) {
    const m = new THREE.LineBasicMaterial({ color: COLORS[k] });
    groups.curves.add(new THREE.Line(lineGeo(pls), m));
    for (const c of d.curves.ctrl[k]) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), new THREE.MeshBasicMaterial({ color: COLORS[k] }));
      s.position.set(...c); groups.curves.add(s);
    }
  }
  // ground grid (1 ft squares)
  disposeGroup(groups.ground);
  const size = Math.ceil(p.length * 1.3 / 12) * 12;
  const grid = new THREE.GridHelper(size, size / 12, 0xcfcac0, 0xe1ddd4);
  grid.rotation.x = Math.PI / 2; grid.position.z = -0.02;
  groups.ground.add(grid);

  const fk = `${p.length}|${p.width}|${p.height}`;
  if (!framedFor) setView('iso', false);
  framedFor = fk;
  applyLayers();
}

function updateSolids() {
  const s = built.solids, p = design.p;
  disposeGroup(groups.shell);
  groups.shell.add(new THREE.Mesh(soupGeometry(s.printShellSoup), mats.shell));
  disposeGroup(groups.mold);
  if (s.blocks.length) {
    for (const b of s.blocks) groups.mold.add(new THREE.Mesh(soupGeometry(b.soup), mats.mold));
    groups.mold.position.set(-s.moldOffset[0], 0, -s.moldOffset[2]);
    const edges = new THREE.LineBasicMaterial({ color: 0x8a7443, transparent: true, opacity: 0.6 });
    const n = Math.round(p.blocksPerRow), rows = Math.round(p.rows), bh = s.mold.blockHeight;
    const segs = [];
    for (let iy = 0; iy < rows; iy++) for (let ix = 0; ix < n; ix++) {
      const x0 = -n * p.blockW / 2 + ix * p.blockW, y0 = -rows * p.blockD / 2 + iy * p.blockD;
      const c = [[x0, y0], [x0 + p.blockW, y0], [x0 + p.blockW, y0 + p.blockD], [x0, y0 + p.blockD], [x0, y0]];
      segs.push(c.map(q => [q[0], q[1], bh]), c.map(q => [q[0], q[1], 0]));
    }
    groups.mold.add(new THREE.LineSegments(lineGeo(segs), edges));
  }
  disposeGroup(groups.water);
  const L = built.analysis.loaded;
  if (L && !L.sunk) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(L.LWL + 60, p.width + 40), mats.water);
    w.position.set((L.xFwd + L.xAft) / 2 || 0, 0, L.waterline); groups.water.add(w);
  }
  applyLayers();
}

function applyLayers() {
  const shellOn = layerOn('shell') && groups.shell.children.length;
  groups.hull.visible = layerOn('hull') && !shellOn;
  groups.stations.visible = layerOn('stations');
  groups.curves.visible = layerOn('curves');
  groups.shell.visible = !!shellOn;
  groups.water.visible = layerOn('water');
  groups.mold.visible = layerOn('mold');
  drawLegend();
}
function drawLegend() {
  const items = [];
  if (layerOn('curves')) items.push(['Cross section', COLORS.crossSection], ['Profile', COLORS.profile], ['Plan', COLORS.plan], ['Sheer', COLORS.sheer]);
  if (layerOn('water') && built?.analysis?.loaded) items.push([`Waterline at race load (${fmt(built.analysis.totalWeight, 0)} lb)`, '#1f6fb2']);
  $('#legend').innerHTML = items.map(([t, c]) => `<span><i style="background:${c}"></i>${t}</span>`).join('');
}

let camAnim = null;
function setView(name, animate = true) {
  const p = design ? design.p : DEFAULTS;
  const L = p.length, H = p.height;
  const target = new THREE.Vector3(0, 0, H * 0.4);
  const pos = {
    iso: new THREE.Vector3(L * 0.95, -L * 1.45, L * 0.75),
    side: new THREE.Vector3(0, -L * 2.3, H * 0.5),
    top: new THREE.Vector3(0, -L * 0.02, L * 2.4),
    front: new THREE.Vector3(L * 0.5 + p.width * 6, 0, H * 0.6),
  }[name];
  if (name === 'front') target.set(0, 0, H * 0.45);
  document.querySelectorAll('#viewPresets button').forEach(b => b.classList.toggle('on', b.dataset.view === name));
  if (!animate) { camera.position.copy(pos); controls.target.copy(target); controls.update(); return; }
  camAnim = { t0: performance.now(), fromP: camera.position.clone(), fromT: controls.target.clone(), toP: pos, toT: target };
}
function resize() {
  const r = vp.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  renderer.domElement.style.width = r.width + 'px'; renderer.domElement.style.height = r.height + 'px';
  camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(vp);
(function loop(now) {
  if (camAnim) {
    const k = Math.min(1, (now - camAnim.t0) / 420), e = 1 - Math.pow(1 - k, 3);
    camera.position.lerpVectors(camAnim.fromP, camAnim.toP, e);
    controls.target.lerpVectors(camAnim.fromT, camAnim.toT, e);
    if (k >= 1) camAnim = null;
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
})(performance.now());

// ─── 2D curve editors ───────────────────────────────────────────────────────────────────
let drag = null; // { editor, id }
const editorState = {};

function editorSpecs() {
  const d = design, p = d.p, c = d.curves, L2 = p.length / 2, W2 = p.width / 2, H = p.height;
  const wl = built?.analysis?.loaded && !built.analysis.loaded.sunk && builtKey.startsWith(paramsKey()) ? built.analysis.loaded.waterline : null;
  const yz = q => [q[1], q[2]], xz = q => [q[0], q[2]], xy = q => [q[0], q[1]];
  const mirrorY = pts => pts.map(q => [-q[1], q[2]]);
  return {
    edSection: {
      range: [-W2, W2, 0, H], exag: 1, pad: 26, valid: c.valid.crossSection, box: [0, W2, 0, H], axes: ['y', 'z'],
      ghosts: [mirrorY(c.crossSection)],
      curves: [{ pts: c.crossSection.map(yz), color: COLORS.crossSection }],
      water: wl,
      fixed: [yz(c.ctrl.crossSection[0]), [0, 0]],
      handles: [
        { id: 'bilge', pt: yz(c.ctrl.crossSection[1]), label: 'bilge', set: (u, v) => ({ xsMidX: W2 - u, xsMidZ: H / 2 - v }) },
        { id: 'corner', pt: yz(c.ctrl.crossSection[2]), label: 'bottom', set: u => ({ xsBottomSetback: W2 - u }) },
      ],
      lines: [[yz(c.ctrl.crossSection[0]), yz(c.ctrl.crossSection[2])]],
    },
    edProfile: {
      range: [0, L2, 0, H], exag: +$('#vexag').value, pad: 26, valid: c.valid.profile && c.valid.sheer, box: [0, L2, 0, H], axes: ['x', 'z'],
      curves: [{ pts: c.profile.map(xz), color: COLORS.profile }, { pts: c.sheer.map(xz), color: COLORS.sheer, dash: true }],
      water: wl,
      fixed: [xz(c.ctrl.profile[0]), [0, 0], [0, H]],
      handles: [
        { id: 'stem', pt: xz(c.ctrl.profile[1]), label: 'stem', set: (u, v) => ({ pfStemMidX: L2 - u, pfStemMidZ: H / 2 - v }) },
        { id: 'fore', pt: xz(c.ctrl.profile[2]), label: 'forefoot', set: (u, v) => ({ pfBottomSetback: L2 - u, pfRocker: v }) },
        { id: 'keel', pt: xz(c.ctrl.profile[3]), label: 'keel', set: (u, v) => { const fx = L2 - params.pfBottomSetback, fz = params.pfRocker; return { pfKeelMidX: u - fx / 2, pfKeelMidZ: v - fz / 2 }; } },
        { id: 'shmid', pt: xz(c.ctrl.sheer[1]), label: 'sheer', color: COLORS.sheer, set: (u, v) => ({ shMidX: L2 / 2 - u, shMidZ: v - H + params.shEndDrop / 2 }) },
        { id: 'shend', pt: xz(c.ctrl.sheer[2]), label: 'sheer end', color: COLORS.sheer, set: (u, v) => ({ shEndDrop: H - v }) },
      ],
      lines: [],
    },
    edPlan: {
      range: [0, L2, 0, W2], exag: +$('#vexag').value, pad: 26, valid: c.valid.plan, box: [0, L2, 0, W2], axes: ['x', 'y'],
      curves: [{ pts: c.plan.map(xy), color: COLORS.plan }],
      fixed: [xy(c.ctrl.plan[0]), [0, W2]],
      handles: [
        { id: 'shoulder', pt: xy(c.ctrl.plan[1]), label: 'shoulder', set: (u, v) => ({ plMidX: L2 - u, plMidY: W2 / 2 - v }) },
        { id: 'full', pt: xy(c.ctrl.plan[2]), label: 'full beam', set: u => ({ plFrontSetback: L2 - u }) },
      ],
      lines: [],
    },
  };
}

function drawEditors() {
  if (!design) return;
  const specs = editorSpecs();
  for (const id in specs) drawEditor(id, specs[id]);
  drawBodyPlan();
}

function drawEditor(id, s) {
  const fig = document.getElementById(id), svg = fig.querySelector('svg');
  const Wpx = Math.max(280, fig.clientWidth || 400);
  const [u0, u1, v0, v1] = s.range;
  const k = (Wpx - 2 * s.pad) / (u1 - u0), kv = k * s.exag;
  const Hpx = Math.round((v1 - v0) * kv + 2 * s.pad);
  const X = u => s.pad + (u - u0) * k, Y = v => Hpx - s.pad - (v - v0) * kv;
  editorState[id] = { s, inv: (px, py) => [u0 + (px - s.pad) / k, v0 + (Hpx - s.pad - py) / kv] };
  svg.setAttribute('viewBox', `0 0 ${Wpx} ${Hpx}`);
  svg.style.height = Hpx + 'px';
  const path = pts => 'M' + pts.map(q => X(q[0]).toFixed(1) + ',' + Y(q[1]).toFixed(1)).join('L');
  let h = '';
  // 12-inch grid
  for (let u = Math.ceil(u0 / 12) * 12; u <= u1; u += 12) h += `<line class="grid" x1="${X(u)}" x2="${X(u)}" y1="${Y(v0)}" y2="${Y(v1)}"/>`;
  for (let v = Math.ceil(v0 / 6) * 6; v <= v1; v += 6) h += `<line class="grid" x1="${X(u0)}" x2="${X(u1)}" y1="${Y(v)}" y2="${Y(v)}"/>`;
  const [b0, b1, b2, b3] = s.box;
  h += `<rect class="box${s.valid ? '' : ' bad'}" x="${X(b0)}" y="${Y(b3)}" width="${X(b1) - X(b0)}" height="${Y(b2) - Y(b3)}"/>`;
  if (s.water != null) h += `<line class="wl" x1="${X(u0)}" x2="${X(u1)}" y1="${Y(s.water)}" y2="${Y(s.water)}"/><text x="${X(u0) + 3}" y="${Y(s.water) - 3}" style="fill:#1f6fb2">waterline</text>`;
  for (const g of s.ghosts || []) h += `<path class="ghost" d="${path(g)}"/>`;
  for (const ln of s.lines) h += `<path class="ctrl-line" d="${path(ln)}"/>`;
  for (const c of s.curves) h += `<path class="curve" d="${path(c.pts)}" style="stroke:${c.color}${c.dash ? ';stroke-dasharray:6 3' : ''}"/>`;
  for (const f of s.fixed) h += `<circle class="fixed" cx="${X(f[0])}" cy="${Y(f[1])}" r="3.5"/>`;
  for (const hd of s.handles) {
    const on = drag && drag.editor === id && drag.id === hd.id;
    const x = X(hd.pt[0]), y = Y(hd.pt[1]);
    h += `<circle class="hit" data-h="${hd.id}" cx="${x}" cy="${y}" r="14"/>`;
    h += `<circle class="handle${on ? ' drag' : ''}" data-h="${hd.id}" cx="${x}" cy="${y}" r="6" style="${hd.color ? 'fill:' + hd.color : ''}"/>`;
     const lx = x > Wpx - 70 ? x - 9 : x + 9;
    h += `<text class="hlabel" text-anchor="${x > Wpx - 70 ? 'end' : 'start'}" x="${lx}" y="${y - 8}" style="${hd.color ? 'fill:' + hd.color : ''}">${hd.label}</text>`;
  }
  // dimension ticks
  h += `<text x="${X(u1) - 2}" y="${Hpx - 4}" text-anchor="end">${s.axes[0]} ${fmt(u1, 1)}″</text><text x="${4}" y="${Hpx - 4}">${s.axes[1]} ${fmt(v1, 1)}″${s.exag !== 1 ? ` · ${s.exag}× vertical` : ''}</text>`;
  svg.innerHTML = h;
  let flag = fig.querySelector('.flag');
  if (!flag) { flag = el('span', { class: 'flag' }); fig.querySelector('figcaption').append(flag); }
  flag.className = 'flag ' + (s.valid ? 'ok' : 'bad');
  flag.textContent = s.valid ? 'inside box' : 'leaves its box';
}

for (const id of ['edSection', 'edProfile', 'edPlan']) {
  const svg = document.querySelector(`#${id} svg`);
  svg.addEventListener('pointerdown', e => {
    const hid = e.target.getAttribute && e.target.getAttribute('data-h');
    if (!hid) return;
    pushUndo();
    drag = { editor: id, id: hid };
    svg.setPointerCapture(e.pointerId);
    e.preventDefault();
    drawEditors();
  });
  svg.addEventListener('pointermove', e => {
    if (!drag || drag.editor !== id) return;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    const st = editorState[id];
    const [u, v] = st.inv(loc.x, loc.y);
    const hd = st.s.handles.find(h => h.id === drag.id);
    if (hd) setParams(hd.set(u, v));
  });
  const end = () => { if (drag) { drag = null; drawEditors(); } };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
}
$('#vexag').addEventListener('change', drawEditors);

function drawBodyPlan() {
  const fig = $('#edLines'), svg = fig.querySelector('svg');
  const p = design.p, W2 = p.width / 2, H = p.height;
  const Wpx = Math.max(280, fig.clientWidth || 400), pad = 20;
  const k = (Wpx - 2 * pad) / (2 * W2 + 2);
  const Hpx = Math.round((H + 1) * k + 2 * pad);
  const X = y => Wpx / 2 + y * k, Y = z => Hpx - pad - z * k;
  svg.setAttribute('viewBox', `0 0 ${Wpx} ${Hpx}`); svg.style.height = Hpx + 'px';
  let h = `<line class="grid" x1="${X(0)}" x2="${X(0)}" y1="${Y(0)}" y2="${Y(H + 1)}"/>`;
  const upToDate = built && builtKey.startsWith(paramsKey());
  const L2 = p.length / 2, n = 10;
  // true transverse sections from the solid when available; otherwise the lofted rows
  if (upToDate) {
    for (let i = 0; i <= n; i++) {
      const x = (L2 - 1.5) * i / n;
      for (const side of [1, -1]) {
        const loops = sliceLoops(built.solids.hullSoup, side * x);
        for (const lp of loops) {
          const half = lp.filter(q => side > 0 ? q[0] >= -1e-6 : q[0] <= 1e-6);
          if (half.length < 2) continue;
          h += `<path class="station${side > 0 ? ' bow' : ''}" d="M${lp.map(q => (X(side > 0 ? Math.max(0, q[0]) : Math.min(0, q[0]))).toFixed(1) + ',' + Y(q[1]).toFixed(1)).join('L')}"/>`;
        }
      }
    }
    const L = built.analysis.loaded;
    if (L && !L.sunk) h += `<line class="wl" x1="${pad}" x2="${Wpx - pad}" y1="${Y(L.waterline)}" y2="${Y(L.waterline)}"/>`;
    h += `<text x="${Wpx - 4}" y="${Hpx - 5}" text-anchor="end">bow half →</text><text x="4" y="${Hpx - 5}">← stern half</text>`;
  } else {
    h += `<text x="${Wpx / 2}" y="${Hpx / 2}" text-anchor="middle">building sections…</text>`;
  }
  svg.innerHTML = h;
}

// ─── warnings over the viewport ─────────────────────────────────────────────────────────
function drawWarnings() {
  const w = [];
  const v = design.curves.valid;
  const names = { crossSection: 'Cross section', profile: 'Profile', plan: 'Plan curve', sheer: 'Sheer' };
  for (const k in v) if (!v[k]) w.push(['bad', `${names[k]} leaves its bounding box`]);
  if (built && builtKey.startsWith(paramsKey())) {
    const a = built.analysis;
    if (a.loaded.sunk) w.push(['bad', 'Sinks at race load']);
    else {
      if (a.loaded.freeboard <= 0) w.push(['bad', `Gunwale under water at race load`]);
      if (a.loaded.GMt <= 0) w.push(['bad', 'Negative GM — unstable upright']);
    }
    const fails = checkRules(RULE_YEAR, design.p, a).filter(c => c.status === 'fail');
    if (fails.length) w.push(['warn', `${fails.length} ${RULE_YEAR} rule check${fails.length > 1 ? 's' : ''} failing — see Rules ${RULE_YEAR}: ${fails.map(c => c.ref).join(', ')}`]);
    const m = built.solids.mold;
    if (m && !m.fitsWidth) w.push(['warn', 'Mold blocks narrower than the beam']);
    if (m && !m.fitsLength) w.push(['warn', 'Mold blocks shorter than the hull']);
  }
  $('#warnings').innerHTML = w.map(([c, t]) => `<div class="${c === 'warn' ? 'warn' : ''}">${t}</div>`).join('');
}

// ─── analysis panel ─────────────────────────────────────────────────────────────────────
const ft3 = in3 => in3 / 1728, ft2 = in2 => in2 / 144;
function metricList(a) {
  return {
    hullWeight: a.hullWeight, draft: a.loaded.draft, freeboard: a.loaded.freeboard, GMt: a.loaded.GMt,
    hullSpeed: a.speed.hullSpeedMph, drag: a.speed.dragLb, concrete: ft3(a.shellVolumeIn3), wetted: ft2(a.loaded.wetted),
    maxGZ: a.maxGZ[1], Cp: a.loaded.Cp, LWL: a.loaded.LWL,
  };
}
function delta(key, value, better, digits = 2) {
  if (!baseline || baseline[key] === undefined) return '';
  const dv = value - baseline[key];
  if (Math.abs(dv) < Math.pow(10, -digits) / 2) return `<div class="d">= baseline</div>`;
  const cls = better === 'up' ? (dv > 0 ? 'up' : 'down') : better === 'down' ? (dv < 0 ? 'up' : 'down') : '';
  return `<div class="d ${cls}">${dv > 0 ? '+' : '−'}${Math.abs(dv).toFixed(digits)} vs baseline</div>`;
}
function card(label, value, unit, key, better, digits = 1, extraCls = '') {
  return `<div class="card ${extraCls}"><div class="k">${label}</div><div class="v">${value}<small>${unit}</small></div>${key ? delta(key, metricList(built.analysis)[key], better, digits) : ''}</div>`;
}

function renderAnalysis() {
  const a = built.analysis, L = a.loaded, E = a.empty, p = design.p;
  const stale = !builtKey.startsWith(paramsKey());
  let h = '';
  if (stale) h += `<div class="note">Showing the previous build — updating…</div>`;
  h += `<div class="cards">
    ${card('Hull weight', fmt(a.hullWeight, 0), 'lb', 'hullWeight', 'down', 1)}
    ${card('Draft (race load)', L.sunk ? 'sinks' : fmt(L.draft, 2), L.sunk ? '' : 'in', 'draft', null, 2)}
    ${card('Freeboard', L.sunk ? '—' : fmt(L.freeboard, 2), 'in', 'freeboard', 'up', 2, L.freeboard < 4 ? 'fail' : '')}
    ${card('GM (stability)', fmt(L.GMt, 2), 'in', 'GMt', 'up', 2, L.GMt <= 0 ? 'fail' : '')}
    ${card('Hull speed', fmt(a.speed.hullSpeedMph, 2), 'mph', 'hullSpeed', 'up', 2)}
    ${card('Swamp test', a.swamp.floats ? 'floats' : 'sinks', '', null, null, 0, a.swamp.floats ? 'pass' : 'fail')}
  </div>`;

  h += `<h3>Weight &amp; materials</h3><table class="kv">
    <tr><td>Concrete volume</td><td>${fmt(ft3(a.shellVolumeIn3), 3)} ft³</td><td>${fmt(a.shellVolumeIn3, 0)} in³</td></tr>
    <tr><td>Hull weight at ${fmt(p.concreteDensity, 1)} pcf</td><td>${fmt(a.hullWeight, 1)} lb</td><td></td></tr>
    <tr><td>Paddlers (${p.crew} × ${p.crewWeight} lb) + other</td><td>${fmt(a.crewWeight + p.extraWeight, 0)} lb</td><td></td></tr>
    <tr><td><b>Race load</b></td><td><b>${fmt(a.totalWeight, 1)} lb</b></td><td></td></tr>
    <tr><td>Center of gravity above keel (KG)</td><td>${fmt(L.KG, 2)} in</td><td></td></tr>
    <tr><td>Hull surface area (outside)</td><td>${fmt(ft2(a.shellAreaIn2), 1)} ft²</td><td></td></tr>
  </table>
  <div class="note ${a.swamp.floats ? 'good' : 'bad'}"><b>Swamp flotation:</b> filled with water, the concrete + foam gives ${fmt(a.swamp.buoyancy, 1)} lb of buoyancy against ${fmt(a.swamp.weight, 1)} lb of hull.
  ${a.swamp.floats ? `Margin ${fmt(a.swamp.margin, 1)} lb — it floats.` : `Short by ${fmt(-a.swamp.margin, 1)} lb — add about <b>${fmt(a.swamp.foamNeededFt3, 2)} ft³</b> of flotation foam, or lighten the mix below ${WATER_PCF} pcf.`}
  Check your competition year's exact swamp-test rule.</div>`;

  h += `<h3>Hydrostatics</h3><table class="kv">
    <tr><th></th><th>Race load</th><th>Empty</th></tr>
    ${[
      ['Displacement', v => fmt(v.weight, 0) + ' lb'],
      ['Draft', v => v.sunk ? 'sinks' : fmt(v.draft, 2) + ' in'],
      ['Freeboard (lowest gunwale)', v => fmt(v.freeboard, 2) + ' in'],
      ['Waterline length', v => fmt(v.LWL, 1) + ' in'],
      ['Waterline beam', v => fmt(v.BWL, 2) + ' in'],
      ['Length / beam', v => fmt(v.LWL / v.BWL, 2)],
      ['Wetted surface', v => fmt(ft2(v.wetted), 2) + ' ft²'],
      ['Waterplane area', v => fmt(ft2(v.Awp), 2) + ' ft²'],
      ['Block coefficient C<sub>b</sub>', v => fmt(v.Cb, 3)],
      ['Prismatic coefficient C<sub>p</sub>', v => fmt(v.Cp, 3)],
      ['Midship coefficient C<sub>m</sub>', v => fmt(v.Cm, 3)],
      ['Waterplane coefficient C<sub>wp</sub>', v => fmt(v.Cwp, 3)],
      ['Center of buoyancy (LCB, + fwd)', v => fmt(v.LCB, 2) + ' in'],
      ['KB (buoyancy above keel)', v => fmt(v.KB, 2) + ' in'],
      ['BM transverse', v => fmt(v.BMt, 2) + ' in'],
      ['KG (weight above keel)', v => fmt(v.KG, 2) + ' in'],
      ['GM transverse', v => fmt(v.GMt, 2) + ' in'],
      ['GM longitudinal', v => fmt(v.GMl, 0) + ' in'],
    ].map(([t, f]) => `<tr><td>${t}</td><td>${f(L)}</td><td>${f(E)}</td></tr>`).join('')}
  </table>
  <p class="hint">Paddlers are modeled as a point weight on the centerline at the CG height set in <i>Analysis inputs</i>. Larger GM = stiffer, less tippy.</p>`;

  h += `<h3>Stability — righting arm (GZ)</h3><div class="chart">${gzChart(a)}</div>
  <table class="kv">
    <tr><td>Max righting arm</td><td>${fmt(a.maxGZ[1], 2)} in at ${a.maxGZ[0]}°</td><td></td></tr>
    <tr><td>Gunwale reaches the water</td><td>${a.downflood !== null ? a.downflood + '°' : '> 90°'}</td><td></td></tr>
    <tr><td>Capsize (GZ back to zero)</td><td>${a.vanishing !== null ? fmt(a.vanishing, 0) + '°' : '> 90°'}</td><td></td></tr>
  </table>
  <p class="hint">Heeled at race load, paddlers fixed in the boat. Past the gunwale angle the hull would take on water — the curve beyond it is theoretical.</p>`;

  h += `<h3>Sectional area curve</h3><div class="chart">${sacChart(L)}</div>
  <p class="hint">Submerged area of each cross section along the waterline, stern (left) to bow (right). A smooth, full curve is easier to push; C<sub>p</sub> ${fmt(L.Cp, 3)}.</p>`;

  h += `<h3>Speed &amp; drag</h3><table class="kv">
    <tr><td>Theoretical hull speed (1.34 √LWL)</td><td>${fmt(a.speed.hullSpeedMph, 2)} mph</td><td>${fmt(a.speed.hullSpeedMph / 1.15078, 2)} kn</td></tr>
    <tr><td>Froude number at ${fmt(p.speed, 1)} mph</td><td>${fmt(a.speed.Fn, 3)}</td><td></td></tr>
    <tr><td>Skin-friction drag at ${fmt(p.speed, 1)} mph</td><td>${fmt(a.speed.dragLb, 2)} lb</td><td>${fmt(a.speed.dragN, 1)} N</td></tr>
  </table>
  <p class="hint">ITTC-1957 friction line on the wetted surface. Wave-making drag is not included — it grows fast near hull speed, so treat this as a floor for comparing designs.</p>`;

  $('#analysis').innerHTML = h;
}

function chartFrame(xs, ys, W, Hc, pad, xfmt, yfmt, xticks, yticks) {
  const [x0, x1] = xs, [y0, y1] = ys;
  const X = x => pad.l + (x - x0) / (x1 - x0) * (W - pad.l - pad.r), Y = y => Hc - pad.b - (y - y0) / (y1 - y0) * (Hc - pad.t - pad.b);
  let h = '';
  for (const t of yticks) h += `<line class="gridl" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${pad.l - 4}" y="${Y(t) + 3}" text-anchor="end">${yfmt(t)}</text>`;
  for (const t of xticks) h += `<text x="${X(t)}" y="${Hc - pad.b + 13}" text-anchor="middle">${xfmt(t)}</text>`;
  h += `<line class="axis" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(0 < y0 ? y0 : 0)}" y2="${Y(0 < y0 ? y0 : 0)}"/>`;
  return { X, Y, h };
}
function niceTicks(lo, hi, n = 4) {
  const span = hi - lo || 1, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= step0);
  const out = []; for (let t = Math.floor(lo / step + 1e-9) * step; t < hi + step - 1e-9; t += step) out.push(+t.toFixed(6));
  return out;
}
function gzChart(a) {
  const W = 408, Hc = 170, pad = { l: 36, r: 10, t: 10, b: 22 };
  const all = a.gz.map(g => g[1]).concat(baseline?.gz ? baseline.gz.map(g => g[1]) : []);
  const lo = Math.min(0, ...all), hi = Math.max(0.5, ...all);
  const yt = niceTicks(lo, hi);
  const f = chartFrame([0, 90], [yt[0], yt[yt.length - 1]], W, Hc, pad, t => t + '°', t => t + '″', [0, 15, 30, 45, 60, 75, 90], yt);
  let h = f.h;
  if (a.downflood !== null) h += `<line class="mark" x1="${f.X(a.downflood)}" x2="${f.X(a.downflood)}" y1="${pad.t}" y2="${Hc - pad.b}"/><text class="mark-t" x="${f.X(a.downflood) + 3}" y="${pad.t + 9}">gunwale</text>`;
  if (baseline?.gz) h += `<path class="line base" d="M${baseline.gz.map(g => f.X(g[0]) + ',' + f.Y(g[1])).join('L')}"/>`;
  h += `<path class="line" d="M${a.gz.map(g => f.X(g[0]).toFixed(1) + ',' + f.Y(g[1]).toFixed(1)).join('L')}"/>`;
  return `<svg viewBox="0 0 ${W} ${Hc}" role="img" aria-label="Righting arm versus heel angle">${h}</svg>`;
}
function sacChart(L) {
  const W = 408, Hc = 140, pad = { l: 40, r: 10, t: 10, b: 22 };
  const xs = L.sac.map(s => s[0]), ys = L.sac.map(s => s[1]).concat(baseline?.sac ? baseline.sac.map(s => s[1]) : []);
  const x0 = Math.min(...xs, ...(baseline?.sac ? baseline.sac.map(s => s[0]) : [])), x1 = Math.max(...xs, ...(baseline?.sac ? baseline.sac.map(s => s[0]) : []));
  const yt = niceTicks(0, Math.max(...ys, 1));
  const f = chartFrame([x0, x1], [0, yt[yt.length - 1]], W, Hc, pad, t => t + '″', t => t, niceTicks(x0, x1, 5), yt);
  let h = f.h;
  h += `<path class="area" d="M${f.X(L.sac[0][0])},${f.Y(0)}L${L.sac.map(s => f.X(s[0]).toFixed(1) + ',' + f.Y(s[1]).toFixed(1)).join('L')}L${f.X(L.sac.at(-1)[0])},${f.Y(0)}Z"/>`;
  if (baseline?.sac) h += `<path class="line base" d="M${baseline.sac.map(s => f.X(s[0]) + ',' + f.Y(s[1])).join('L')}"/>`;
  h += `<path class="line" d="M${L.sac.map(s => f.X(s[0]).toFixed(1) + ',' + f.Y(s[1]).toFixed(1)).join('L')}"/>`;
  h += `<text x="${pad.l + 2}" y="${pad.t + 8}">in²</text>`;
  return `<svg viewBox="0 0 ${W} ${Hc}" role="img" aria-label="Sectional area curve">${h}</svg>`;
}

$('#btnBaseline').addEventListener('click', () => {
  if (!built) return;
  baseline = { ...metricList(built.analysis), gz: built.analysis.gz, sac: built.analysis.loaded.sac, name: designName };
  persist(); renderAnalysis(); toast('Pinned — cards now show the difference from this design');
});

// ─── rules panel ────────────────────────────────────────────────────────────────────────
function renderRules() {
  const a = built.analysis, p = design.p, R = RULESETS[RULE_YEAR];
  const stale = !builtKey.startsWith(paramsKey());
  const checks = checkRules(RULE_YEAR, p, a);
  const count = st => checks.filter(c => c.status === st).length;
  const S = a.slalom, c = a.coed;
  let h = stale ? `<div class="note">Showing the previous build — updating…</div>` : '';
  h += `<div class="rules-head"><b>${R.title}</b><span>${R.finals}</span><span>${R.issued} · <a href="${R.url}" target="_blank" rel="noopener">read the RFP (PDF)</a> · <a href="learn/rules-2027.html" target="_blank" rel="noopener">plain-English guide</a></span>
    <div class="tally">${['fail', 'warn', 'pass', 'info'].filter(count).map(st => `<i class="s-${st}">${count(st)} ${st === 'info' ? 'notes' : st === 'warn' ? 'close' : st}</i>`).join('')}</div></div>`;
  h += `<ul class="checks">${checks.map(k => `<li class="s-${k.status}"><span class="st">${k.status === 'warn' ? 'close' : k.status}</span><b>${k.title}<small>§${k.ref}</small></b><p>${k.detail}</p></li>`).join('')}</ul>`;

  h += `<h3>Freeboard — 4 co-ed paddlers (§6.2.2)</h3><div class="chart">${freeboardChart(c)}</div>
  <p class="hint">Gunwale height above the waterline along the hull at ${fmt(c.weight, 0)} lb. Names (5 in letters, top 1 in below the gunwale) need the gunwale above the red line where they're painted.</p>`;

  h += `<h3>Structure — 3-person endurance slalom (§5.7.1)</h3>
  <p class="hint" style="margin-top:0">The hull as a floating beam: concrete weight along its length, ${S.paddlers} paddlers at ${S.positions.map(x => fmt(x, 0) + '″').join(', ')}, balanced by buoyancy at a ${fmt(S.waterline - a.keelZ, 2)} in draft (level trim).</p>
  <div class="chart">${beamChart(S, 'M', 'Bending moment (lb·in)')}</div>
  <div class="chart" style="margin-top:8px">${beamChart(S, 'V', 'Shear (lb)')}</div>
  <table class="kv" style="margin-top:8px">
    <tr><td>Max moment (${S.sagging ? 'sagging — bottom in tension' : 'hogging — top in tension'})</td><td>${fmt(Math.abs(S.Mmax), 0)} lb·in</td><td>at x ${fmt(S.xMmax, 1)}″</td></tr>
    <tr><td>Max shear</td><td>${fmt(Math.abs(S.Vmax), 1)} lb</td><td>at x ${fmt(S.xVmax, 1)}″</td></tr>
  </table>
  <div class="two" style="margin-top:10px">
    <div class="chart">${sectionChart(S.section)}</div>
    <table class="kv">
      <tr><td>Concrete area</td><td>${fmt(S.section.A, 2)} in²</td></tr>
      <tr><td>Neutral axis above keel</td><td>${fmt(S.section.zNA, 2)} in</td></tr>
      <tr><td>I<sub>x</sub></td><td>${fmt(S.section.I, 0)} in⁴</td></tr>
      <tr><td>c top / bottom</td><td>${fmt(S.section.cTop, 2)} / ${fmt(S.section.cBot, 2)} in</td></tr>
    </table>
  </div>
  <table class="kv" style="margin-top:10px">
    <tr><th></th><th>No FS</th><th>× FS ${fmt(p.fs, 1)}</th></tr>
    <tr><td>Max tension (vs ${fmt(p.ft, 0)} psi)</td><td>${fmt(S.stress.tension, 1)} psi</td><td>${fmt(S.stress.tensionFS, 1)} psi</td></tr>
    <tr><td>Max compression (vs ${fmt(p.fc, 0)} psi)</td><td>${fmt(S.stress.compression, 1)} psi</td><td>${fmt(S.stress.compressionFS, 1)} psi</td></tr>
    <tr><td>Punching shear v<sub>u</sub> (vs φv<sub>c</sub> ${fmt(S.punching.phiVc, 0)} psi)</td><td>${fmt(S.punching.vu, 1)} psi</td><td>${fmt(S.punching.vuFS, 1)} psi</td></tr>
  </table>
  <p class="hint">Section properties come from the exact shell slice at the max-moment station. The RFP asks for <b>hand-calculated</b> section properties in the Calculation Package — use these to check your hand calcs, not to replace them. Punching shear: ACI 318 two-way, φ = 0.75, v<sub>c</sub> = 4√f′c, one paddler (${p.crewWeight} lb) on a ${fmt(p.kneePatch, 1)} in square patch, d = ½ wall, b₀ = ${fmt(S.punching.b0, 2)} in.</p>`;

  h += `<h3>Races</h3><ul style="margin:0;padding-left:18px;color:var(--ink-2)">${R.races.map(r => `<li>${r}</li>`).join('')}</ul>`;
  h += `<h3>Key dates</h3><table class="kv">${R.dates.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td><td></td></tr>`).join('')}</table>
  <p class="hint">Mix design rules (c/cm &lt; 0.50, 30–50% ASTM C595 cement, ≥ 35% aggregate volume, two mixes max) live in the RFP's Excel templates and aren't checked here.</p>`;
  $('#rules').innerHTML = h;
}
function freeboardChart(c) {
  const W = 408, Hc = 150, pad = { l: 36, r: 10, t: 10, b: 22 };
  const xs = c.profile.map(q => q[0]), ys = c.profile.map(q => q[1]);
  const yt = niceTicks(Math.min(0, ...ys), Math.max(c.need + 1, ...ys));
  const f = chartFrame([Math.min(...xs), Math.max(...xs)], [yt[0], yt.at(-1)], W, Hc, pad, t => t + '″', t => t + '″', niceTicks(Math.min(...xs), Math.max(...xs), 5), yt);
  let h = f.h;
  if (c.letterSpan) h += `<rect x="${f.X(c.letterSpan[0])}" y="${pad.t}" width="${f.X(c.letterSpan[1]) - f.X(c.letterSpan[0])}" height="${Hc - pad.t - pad.b}" fill="#e3f3e6"/>`;
  h += `<line class="need" x1="${pad.l}" x2="${W - pad.r}" y1="${f.Y(c.need)}" y2="${f.Y(c.need)}"/><text x="${W - pad.r - 2}" y="${f.Y(c.need) - 3}" text-anchor="end" style="fill:#c92a2a">${c.need}″ for names</text>`;
  h += `<path class="line" d="M${c.profile.map(q => f.X(q[0]).toFixed(1) + ',' + f.Y(q[1]).toFixed(1)).join('L')}"/>`;
  return `<svg viewBox="0 0 ${W} ${Hc}" role="img" aria-label="Freeboard along the hull">${h}</svg>`;
}
function beamChart(S, key, label) {
  const W = 408, Hc = 130, pad = { l: 48, r: 10, t: 14, b: 22 };
  const vals = S[key], xs = S.X;
  const yt = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));
  const f = chartFrame([xs[0], xs.at(-1)], [yt[0], yt.at(-1)], W, Hc, pad, t => t + '″', t => Math.abs(t) >= 1000 ? (t / 1000) + 'k' : t, niceTicks(xs[0], xs.at(-1), 5), yt);
  let h = f.h + `<line class="axis" x1="${pad.l}" x2="${W - pad.r}" y1="${f.Y(0)}" y2="${f.Y(0)}"/>`;
  for (const x of S.positions) h += `<path class="pad" d="M${f.X(x) - 4},${pad.t - 10}L${f.X(x) + 4},${pad.t - 10}L${f.X(x)},${pad.t - 3}Z"/>`;
  h += `<path class="line ${key === 'M' ? 'm' : 'v'}" d="M${xs.map((x, i) => f.X(x).toFixed(1) + ',' + f.Y(vals[i]).toFixed(1)).join('L')}"/>`;
  h += `<text x="${pad.l + 4}" y="${Hc - pad.b - 4}">${label}</text>`;
  return `<svg viewBox="0 0 ${W} ${Hc}" role="img" aria-label="${label}">${h}</svg>`;
}
function sectionChart(sec) {
  const W = 200, Hc = 130, pad = 10;
  const pts = (sec.loops || []).flat();
  if (!pts.length) return '';
  const y0 = Math.min(...pts.map(q => q[0])), y1 = Math.max(...pts.map(q => q[0])), z0 = Math.min(...pts.map(q => q[1])), z1 = Math.max(...pts.map(q => q[1]));
  const k = Math.min((W - 2 * pad) / (y1 - y0), (Hc - 2 * pad) / (z1 - z0));
  const X = y => W / 2 + (y - (y0 + y1) / 2) * k, Y = z => Hc - pad - (z - z0) * k;
  let h = sec.loops.map(lp => `<path class="sec" d="M${lp.map(q => X(q[0]).toFixed(1) + ',' + Y(q[1]).toFixed(1)).join('L')}Z"/>`).join('');
  const zna = sec.zNA + built.analysis.keelZ;
  h += `<line class="na" x1="${pad}" x2="${W - pad}" y1="${Y(zna)}" y2="${Y(zna)}"/><text x="${pad}" y="${Y(zna) - 3}" style="fill:#d9480f">N.A.</text>`;
  return `<svg viewBox="0 0 ${W} ${Hc}" role="img" aria-label="Critical concrete section">${h}</svg>`;
}

// ─── build & export panel ───────────────────────────────────────────────────────────────
let stlUnits = 'in', templateSpacing = 12;
function renderBuild() {
  const s = built.solids, p = design.p;
  const stale = !builtKey.startsWith(paramsKey());
  const m = s.mold;
  let h = stale ? `<div class="note">Showing the previous build — updating…</div>` : '';
  h += `<h3>Mold blocks</h3><div class="note">2027 rule 6.2.1: competition molds can't be made with CNC or 3D printing. Use the printed blocks for practice pieces, and build the real mold by hand — the <b>hot-wire templates</b> below give one laser-cuttable profile at every block joint.</div>`;
  if (m) {
    h += `<div class="cards">
      <div class="card"><div class="k">Blocks</div><div class="v">${m.count}<small>pcs</small></div></div>
      <div class="card"><div class="k">Each block</div><div class="v" style="font-size:14px">${fmt(p.blockW, 1)}×${fmt(p.blockD, 1)}×${fmt(m.blockHeight, 1)}<small>in</small></div></div>
      <div class="card"><div class="k">Block material</div><div class="v">${fmt(ft3(m.blockVolume), 1)}<small>ft³</small></div></div>
    </div>
    <table class="kv">
      <tr><td>Array footprint</td><td>${fmt(m.arrayLength, 0)} × ${fmt(m.arrayWidth, 0)} in</td><td></td></tr>
      <tr><td>Cavity (canoe) volume removed</td><td>${fmt(ft3(m.cavityVolume), 2)} ft³</td><td></td></tr>
      <tr><td>Floor under keel · blocks trimmed at</td><td>${fmt(p.zOffset, 2)} in · ${fmt(m.blockHeight, 2)} in</td><td></td></tr>
      <tr><td>Hull fits the array</td><td>${m.fitsLength && m.fitsWidth ? 'yes' : `<span style="color:var(--bad)">${!m.fitsLength ? 'too long' : ''}${!m.fitsLength && !m.fitsWidth ? ', ' : ''}${!m.fitsWidth ? 'too wide' : ''}</span>`}</td><td></td></tr>
    </table>`;
  } else h += `<p class="muted">Building mold blocks…</p>`;

  const bb = extents(s.printShellSoup);
  h += `<h3>Print / cast pieces</h3><table class="kv">
    <tr><td>Concrete shell${p.endChop > 0 ? ` (stern chopped ${fmt(p.endChop, 1)} in)` : ''}</td><td>${fmt(ft3(s.printShellVolume), 3)} ft³</td><td>${fmt(s.printShellVolume * p.concreteDensity / 1728, 1)} lb</td></tr>
    <tr><td>Overall size</td><td>${fmt(bb.hi[0] - bb.lo[0], 1)} × ${fmt(bb.hi[1] - bb.lo[1], 1)} × ${fmt(bb.hi[2] - bb.lo[2], 1)} in</td><td></td></tr>
  </table>`;

  h += `<h3>Export</h3>
  <div class="opts">
    <label class="inline">STL units <select id="stlUnits"><option value="in">inches (as modeled)</option><option value="mm">millimetres</option></select></label>
    <label class="inline">Template spacing <input id="tplSpacing" type="number" min="3" max="48" step="1" value="${templateSpacing}" style="width:56px"> in</label>
  </div>
  <div class="exports">
    <div class="what"><b>Concrete shell</b><span>STL, wall ${fmt(p.wall, 3)} in — the “BAKE ME” output</span></div><button data-x="shell">STL</button>
    <div class="what"><b>Hull solid</b><span>STL, outer surface closed at the gunwale</span></div><button data-x="hull">STL</button>
    <div class="what"><b>Hot-wire templates</b><span>Full-size SVG, one profile at each of the ${m ? Math.round(p.blocksPerRow) + 1 : ''} block joints — rule-compliant jigs</span></div><button data-x="hotwire" ${m ? '' : 'disabled'}>SVG</button>
    <div class="what"><b>Mold blocks (print)</b><span>ZIP, one STL per block — practice pieces, not a competition mold</span></div><button data-x="blocks" ${m ? '' : 'disabled'}>ZIP</button>
    <div class="what"><b>Section templates</b><span>Full-size SVG, a station every ${templateSpacing} in — print or laser-cut</span></div><button data-x="templates">SVG</button>
    <div class="what"><b>Table of offsets</b><span>CSV of half-breadths at 1 in waterlines</span></div><button data-x="offsets">CSV</button>
    <div class="what"><b>Design file</b><span>JSON with every parameter, reopen with Open</span></div><button data-x="json">JSON</button>
  </div>`;
  $('#build').innerHTML = h;
  $('#stlUnits').value = stlUnits;
  $('#stlUnits').addEventListener('change', e => { stlUnits = e.target.value; });
  $('#tplSpacing').addEventListener('change', e => { templateSpacing = Math.max(3, Math.min(48, +e.target.value || 12)); renderBuild(); });
  $('#build').querySelectorAll('button[data-x]').forEach(b => b.addEventListener('click', () => doExport(b.dataset.x)));
}
function extents(soup) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < soup.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], soup[i + k]); hi[k] = Math.max(hi[k], soup[i + k]); }
  return { lo, hi };
}
const slug = () => (designName || 'canoe').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'canoe';
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function doExport(kind) {
  if (!built) return;
  const s = built.solids, p = design.p, sc = stlUnits === 'mm' ? 25.4 : 1, tag = `${p.length}x${p.width}x${p.height}in`;
  if (kind === 'shell') download(new Blob([toBinarySTL(s.printShellSoup, 'shell', sc)], { type: 'model/stl' }), `${slug()}-shell-${tag}-${stlUnits}.stl`);
  if (kind === 'hull') download(new Blob([toBinarySTL(s.printHullSoup, 'hull', sc)], { type: 'model/stl' }), `${slug()}-hull-${tag}-${stlUnits}.stl`);
  if (kind === 'blocks' && s.blocks.length) download(makeZip(s.blocks.map(b => ({ name: `${b.name}.stl`, data: toBinarySTL(b.soup, b.name, sc) }))), `${slug()}-mold-blocks-${stlUnits}.zip`);
  if (kind === 'json') download(new Blob([JSON.stringify({ app: 'canoe-studio', version: 1, name: designName, params }, null, 2)], { type: 'application/json' }), `${slug()}.json`);
  if (kind === 'templates') download(new Blob([templatesSVG()], { type: 'image/svg+xml' }), `${slug()}-section-templates.svg`);
  if (kind === 'hotwire' && s.mold) download(new Blob([hotwireSVG()], { type: 'image/svg+xml' }), `${slug()}-hot-wire-templates.svg`);
  if (kind === 'offsets') download(new Blob([offsetsCSV()], { type: 'text/csv' }), `${slug()}-offsets.csv`);
  toast('Downloaded');
}
function stationsList() {
  const L2 = design.p.length / 2, out = [];
  for (let x = 0; x < L2 - 0.5; x += templateSpacing) { out.push(x); if (x > 0) out.push(-x); }
  return out.sort((a, b) => a - b);
}
function templatesSVG() {
  const soup = built.solids.hullSoup, p = design.p;
  const cells = stationsList().map(x => ({ x, loops: sliceLoops(soup, x) })).filter(c => c.loops.length);
  const cw = p.width + 4, ch = p.height + 5, cols = Math.max(1, Math.floor(40 / cw));
  const rowsN = Math.ceil(cells.length / cols), W = cols * cw, H = rowsN * ch + 2;
  let body = '';
  cells.forEach((c, i) => {
    const ox = (i % cols) * cw + cw / 2, oy = Math.floor(i / cols) * ch + ch - 2;
    for (const lp of c.loops) body += `<path d="M${lp.map(q => (ox + q[0]).toFixed(3) + ',' + (oy - q[1]).toFixed(3)).join('L')}Z" fill="none" stroke="#000" stroke-width="0.02"/>`;
    body += `<line x1="${ox}" x2="${ox}" y1="${oy + 0.6}" y2="${oy - p.height - 0.6}" stroke="#d9480f" stroke-width="0.015" stroke-dasharray="0.3 0.2"/>`;
    body += `<text x="${ox - p.width / 2}" y="${oy + 1.3}" font-size="0.7" font-family="monospace">Station ${c.x >= 0 ? '+' : ''}${c.x.toFixed(1)} in ${c.x > 0 ? '(bow)' : c.x < 0 ? '(stern)' : '(midship)'} — ${designName}</text>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W}in" height="${H}in" viewBox="0 0 ${W} ${H}">\n<!-- Canoe Studio section templates, 1 unit = 1 inch, true scale. Orange line = centerline. -->\n${body}\n</svg>`;
}
function hotwireSVG() {
  const s = built.solids, p = design.p, m = s.mold, off = s.moldOffset;
  const n = Math.round(p.blocksPerRow), rows = Math.round(p.rows);
  const bw = p.blockW, W = rows * p.blockD, bh = m.blockHeight;
  const cw = W + 4, ch = bh + 4, cols = Math.max(1, Math.floor(44 / cw));
  const count = n + 1, H = Math.ceil(count / cols) * ch + 1, SW = cols * cw;
  let body = '';
  for (let k = 0; k <= n; k++) {
    const xm = -n * bw / 2 + k * bw, xh = xm - off[0];
    const ox = (k % cols) * cw + 2, oy = Math.floor(k / cols) * ch + 1;
    const X = y => ox + W / 2 + y, Y = z => oy + bh - z;
    body += `<rect x="${ox}" y="${oy}" width="${W}" height="${bh}" fill="none" stroke="#000" stroke-width="0.02"/>`;
    for (let r = 1; r < rows; r++) body += `<line x1="${ox + r * p.blockD}" x2="${ox + r * p.blockD}" y1="${oy}" y2="${oy + bh}" stroke="#999" stroke-width="0.015" stroke-dasharray="0.3 0.2"/>`;
    const loops = sliceLoops(s.hullSoup, xh);
    for (const lp of loops) {
      const zTop = Math.max(...lp.map(q => q[1]));
      const yL = Math.min(...lp.filter(q => q[1] > zTop - 0.05).map(q => q[0])), yR = Math.max(...lp.filter(q => q[1] > zTop - 0.05).map(q => q[0]));
      body += `<path d="M${lp.map(q => X(q[0]).toFixed(3) + ',' + Y(q[1] + off[2]).toFixed(3)).join('L')}Z" fill="none" stroke="#d9480f" stroke-width="0.03"/>`;
      body += `<line x1="${X(yL)}" x2="${X(yL)}" y1="${Y(zTop + off[2])}" y2="${oy}" stroke="#d9480f" stroke-width="0.03"/><line x1="${X(yR)}" x2="${X(yR)}" y1="${Y(zTop + off[2])}" y2="${oy}" stroke="#d9480f" stroke-width="0.03"/>`;
    }
    body += `<text x="${ox}" y="${oy + bh + 1.1}" font-size="0.7" font-family="monospace">Joint ${k} of ${n} · ${loops.length ? 'hull x ' + xh.toFixed(1) + ' in' : 'past the hull — plain block'} — ${designName}</text>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${SW}in" height="${H}in" viewBox="0 0 ${SW} ${H}">\n<!-- Canoe Studio hot-wire templates. 1 unit = 1 inch, true scale. Black = block end (${W} x ${bh} in), orange = cut line (hull surface, ${off[2]} in floor under the keel). Pin a matching pair to each block end and guide the wire by hand. -->\n${body}\n</svg>`;
}
function offsetsCSV() {
  const soup = built.solids.hullSoup, p = design.p;
  const wls = []; for (let z = 1; z <= Math.ceil(p.height); z += 1) wls.push(z);
  let csv = `# ${designName} — half-breadths (in) at waterlines above the keel; blank = no hull\nstation_x_in,` + wls.map(z => `WL${z}`).join(',') + ',keel_z_in,gunwale_z_in\n';
  for (const x of stationsList()) {
    const loops = sliceLoops(soup, x);
    const pts = loops.flat();
    if (!pts.length) continue;
    const row = wls.map(z => {
      let best = null;
      for (const lp of loops) for (let i = 1; i < lp.length; i++) {
        const a = lp[i - 1], b = lp[i];
        if ((a[1] - z) * (b[1] - z) <= 0 && a[1] !== b[1]) { const y = a[0] + (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]); if (y >= 0 && (best === null || y > best)) best = y; }
      }
      return best === null ? '' : best.toFixed(3);
    });
    csv += `${x.toFixed(2)},${row.join(',')},${Math.min(...pts.map(q => q[1])).toFixed(3)},${Math.max(...pts.map(q => q[1])).toFixed(3)}\n`;
  }
  return csv;
}

// ─── top bar, tabs, toggles ─────────────────────────────────────────────────────────────
let activeTab = 'curves';
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
  activeTab = b.dataset.tab;
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === activeTab));
  if (activeTab === 'curves') drawEditors();
  if (activeTab === 'build') sendWorker();
  if (activeTab === 'rules' && built) renderRules();
}));
document.querySelectorAll('#viewPresets button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
document.querySelectorAll('#layerToggles input').forEach(i => i.addEventListener('change', () => { applyLayers(); if (i.dataset.layer === 'mold' && i.checked) sendWorker(); }));

$('#designName').value = designName;
$('#designName').addEventListener('input', e => { designName = e.target.value; persist(); });
$('#btnReset').addEventListener('click', () => { pushUndo(); params = { ...DEFAULTS }; syncInputs(); scheduleUpdate(); toast('Reset to the Grasshopper file values'); });
$('#btnUndo').addEventListener('click', doUndo);
addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !['INPUT', 'SELECT'].includes(document.activeElement.tagName)) { e.preventDefault(); doUndo(); } });
function doUndo() { const prev = undo.pop(); if (!prev) return toast('Nothing to undo'); params = prev; syncInputs(); scheduleUpdate(); }
$('#btnSave').addEventListener('click', () => doExportJSON());
function doExportJSON() { download(new Blob([JSON.stringify({ app: 'canoe-studio', version: 1, name: designName, params }, null, 2)], { type: 'application/json' }), `${slug()}.json`); }
$('#fileOpen').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const o = JSON.parse(await f.text());
    pushUndo(); params = { ...DEFAULTS, ...sanitize(o.params || o) }; designName = o.name || f.name.replace(/\.json$/i, '');
    $('#designName').value = designName; syncInputs(); scheduleUpdate(); toast('Opened ' + designName);
  } catch { toast('That file is not a Canoe Studio design'); }
  e.target.value = '';
});
$('#btnLink').addEventListener('click', async () => {
  const changed = {}; for (const s of PARAMS) if (Math.abs(params[s.key] - s.def) > 1e-9) changed[s.key] = params[s.key];
  const code = btoa(unescape(encodeURIComponent(JSON.stringify({ name: designName, params: changed }))));
  const url = location.href.split('#')[0] + '#p=' + code;
  history.replaceState(null, '', '#p=' + code);
  try { await navigator.clipboard.writeText(url); toast('Link copied — it carries every changed parameter'); } catch { toast('Link is in the address bar'); }
});
$('#btnAbout').addEventListener('click', () => $('#about').showModal());

let toastT = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200); }
new ResizeObserver(() => { if (design && activeTab === 'curves') drawEditors(); }).observe($('.panel'));

// ─── go ─────────────────────────────────────────────────────────────────────────────────
loadInitial();
buildParamPanel();
$('#designName').value = designName;
update();
window.__canoe = { get params() { return params; }, get built() { return built; }, get design() { return design; }, setParams, exports: { hotwireSVG, templatesSVG, offsetsCSV } };
