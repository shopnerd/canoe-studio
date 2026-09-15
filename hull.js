// hull.js — the canoe design core. Pure math, no DOM, runs in the browser and in Node.
// Recreates canoe_script_012226.gh (Grasshopper): four control curves → tweened, rotated,
// plan-scaled station sections → lofted hull → mirrored to four quadrants.
// Coordinates: X = length (bow is +X), Y = width (starboard +Y), Z = up. Units: inches.

// ─── Parameters (defaults + slider ranges taken from the .gh file) ───────────────────────
export const PARAMS = [
  { group: 'Hull envelope', key: 'length', label: 'Length', def: 210, min: 60, max: 300, step: 1, unit: 'in' },
  { group: 'Hull envelope', key: 'width', label: 'Width (beam)', def: 30, min: 12, max: 48, step: 0.25, unit: 'in' },
  { group: 'Hull envelope', key: 'height', label: 'Depth (height)', def: 18, min: 6, max: 30, step: 0.25, unit: 'in' },

  { group: 'Cross section', key: 'xsBottomSetback', label: 'Bottom setback', def: 15, min: 0, max: 36, step: 0.1, unit: 'in', help: 'How far the flat of the bottom stops in from the side. Setback = half-beam gives a round/V bottom.' },
  { group: 'Cross section', key: 'xsMidX', label: 'Bilge point in (Y)', def: 3.818, min: 0, max: 24, step: 0.01, unit: 'in', help: 'Moves the bilge control point toward the centerline.' },
  { group: 'Cross section', key: 'xsMidZ', label: 'Bilge point down (Z)', def: 6.803, min: 0, max: 10, step: 0.01, unit: 'in', help: 'Moves the bilge control point down from mid-depth.' },

  { group: 'Profile (bow + keel)', key: 'pfBottomSetback', label: 'Bow overhang', def: 12, min: 0, max: 40, step: 0.1, unit: 'in', help: 'Where the stem meets the keel, measured back from the bow tip.' },
  { group: 'Profile (bow + keel)', key: 'pfRocker', label: 'Keel rocker', def: 3, min: 0, max: 8, step: 0.05, unit: 'in', help: 'How much the keel lifts at the forefoot (stem/keel joint).' },
  { group: 'Profile (bow + keel)', key: 'pfStemMidX', label: 'Stem point back (X)', def: 4.736, min: 0, max: 100, step: 0.01, unit: 'in' },
  { group: 'Profile (bow + keel)', key: 'pfStemMidZ', label: 'Stem point down (Z)', def: 4.37, min: -10, max: 10, step: 0.01, unit: 'in' },
  { group: 'Profile (bow + keel)', key: 'pfKeelMidX', label: 'Keel point fwd (X)', def: 6.96, min: -40, max: 100, step: 0.01, unit: 'in' },
  { group: 'Profile (bow + keel)', key: 'pfKeelMidZ', label: 'Keel point up (Z)', def: -0.5, min: -10, max: 10, step: 0.01, unit: 'in' },

  { group: 'Plan (top curve)', key: 'plFrontSetback', label: 'Full-beam point back', def: 104, min: 0, max: 150, step: 0.5, unit: 'in', help: 'Distance from the bow where the gunwale reaches full beam.' },
  { group: 'Plan (top curve)', key: 'plMidX', label: 'Shoulder point back (X)', def: 43.22, min: 0, max: 100, step: 0.01, unit: 'in' },
  { group: 'Plan (top curve)', key: 'plMidY', label: 'Shoulder point in (Y)', def: -3.93, min: -10, max: 10, step: 0.01, unit: 'in', help: 'Negative = fuller bow, positive = finer bow.' },

  { group: 'Sheer (top rocker)', key: 'shEndDrop', label: 'Sheer drop at ends', def: 2, min: -10, max: 10, step: 0.05, unit: 'in', help: 'How far the gunwale line drops from midship to the ends.' },
  { group: 'Sheer (top rocker)', key: 'shMidX', label: 'Sheer point back (X)', def: 0, min: -100, max: 100, step: 0.1, unit: 'in' },
  { group: 'Sheer (top rocker)', key: 'shMidZ', label: 'Sheer point up (Z)', def: -0.75, min: -10, max: 10, step: 0.01, unit: 'in' },

  { group: 'Lofting', key: 'divisions', label: 'Stations per half', def: 20, min: 2, max: 30, step: 1, unit: '', help: 'Number of tween sections between midship and the bow.' },
  { group: 'Lofting', key: 'rotDivisions', label: 'Rotation stations', def: 20, min: 1, max: 30, step: 1, unit: '', help: 'How quickly sections swing from transverse (0°) to the stem (90°). Lower = sections turn sooner.' },

  { group: 'Finishing', key: 'wall', label: 'Wall thickness', def: 0.5, min: 0.125, max: 1.5, step: 0.0625, unit: 'in' },
  { group: 'Finishing', key: 'endChop', label: 'Stern end chop', def: 0, min: 0, max: 150, step: 0.5, unit: 'in', help: 'Cuts this much off the stern — for printing/molding the hull in segments. Analysis always uses the whole hull.' },

  { group: 'Mold blocks', key: 'blocksPerRow', label: 'Blocks per row', def: 14, min: 2, max: 30, step: 1, unit: '' },
  { group: 'Mold blocks', key: 'rows', label: 'Rows', def: 2, min: 1, max: 4, step: 1, unit: '' },
  { group: 'Mold blocks', key: 'blockW', label: 'Block length (X)', def: 16, min: 4, max: 40, step: 0.5, unit: 'in' },
  { group: 'Mold blocks', key: 'blockD', label: 'Block width (Y)', def: 16, min: 4, max: 30, step: 0.5, unit: 'in' },
  { group: 'Mold blocks', key: 'blockH', label: 'Block height (Z)', def: 24, min: 4, max: 30, step: 0.5, unit: 'in' },
  { group: 'Mold blocks', key: 'zOffset', label: 'Floor under keel', def: 2, min: 0, max: 10, step: 0.25, unit: 'in', help: 'Block material left under the keel. Blocks are trimmed flat at depth + this.' },

  { group: 'Analysis inputs', key: 'concreteDensity', label: 'Concrete unit weight', def: 62, min: 30, max: 150, step: 0.5, unit: 'pcf', help: 'lb/ft³. Water is 62.4 — below that the hull floats swamped without foam. 2027 rules: oven-dried < 80.0 pcf.' },
  { group: 'Analysis inputs', key: 'crew', label: 'Paddlers', def: 2, min: 0, max: 4, step: 1, unit: '' },
  { group: 'Analysis inputs', key: 'crewWeight', label: 'Weight per paddler', def: 170, min: 80, max: 260, step: 5, unit: 'lb' },
  { group: 'Analysis inputs', key: 'crewCG', label: 'Paddler CG above keel', def: 14, min: 0, max: 36, step: 0.5, unit: 'in', help: 'Kneeling ≈ 12–16 in, sitting on a seat ≈ 18–22 in.' },
  { group: 'Analysis inputs', key: 'extraWeight', label: 'Other weight (reinf., paint)', def: 10, min: 0, max: 200, step: 1, unit: 'lb' },
  { group: 'Analysis inputs', key: 'foam', label: 'Flotation foam', def: 0, min: 0, max: 20, step: 0.1, unit: 'ft³', help: 'Encased in the end bulkheads. 2027 rules: only within 3 ft of the bow and stern tips.' },
  { group: 'Analysis inputs', key: 'speed', label: 'Speed for drag readout', def: 5, min: 1, max: 9, step: 0.1, unit: 'mph' },
  { group: 'Analysis inputs', key: 'paddlerPower', label: 'Effective power per paddler', def: 70, min: 20, max: 250, step: 5, unit: 'W', help: 'Power that actually pushes the boat (after paddle losses). Placeholder: calibrate it from a timed 200 m run on the Tow test guide.' },
  { group: 'Analysis inputs', key: 'formFactor', label: 'Form factor k', def: 0.08, min: 0, max: 0.4, step: 0.01, unit: '', help: 'Extra viscous drag from the hull shape, as a fraction of flat-plate friction. ~0.05–0.12 for slender hulls; a model tow test measures it.' },

  { group: 'Rules & structure', key: 'paddlerInset', label: 'End paddler from tip', def: 42, min: 12, max: 90, step: 1, unit: 'in', help: 'Where the bow and stern paddlers kneel. Middle paddlers are spaced evenly between them.' },
  { group: 'Rules & structure', key: 'letterLength', label: 'Lettering length needed', def: 72, min: 12, max: 180, step: 1, unit: 'in', help: 'Run of gunwale the school + canoe names need on each side (5 in letters).' },
  { group: 'Rules & structure', key: 'reinfThk', label: 'Reinforcement thickness', def: 0.1, min: 0, max: 0.75, step: 0.01, unit: 'in', help: 'Total of all primary reinforcement layers in the wall.' },
  { group: 'Rules & structure', key: 'poa', label: 'Mesh percent open area', def: 50, min: 0, max: 100, step: 1, unit: '%' },
  { group: 'Rules & structure', key: 'fc', label: 'Compressive strength f′c', def: 1500, min: 200, max: 8000, step: 50, unit: 'psi', help: 'From your cylinder tests. Placeholder until you have data.' },
  { group: 'Rules & structure', key: 'ft', label: 'Composite tensile strength', def: 300, min: 20, max: 3000, step: 10, unit: 'psi', help: 'Use the average first-crack stress from thin-strip bending tests (Learn › Strength test). Placeholder until you have data.' },
  { group: 'Rules & structure', key: 'fs', label: 'Factor of safety', def: 2, min: 1, max: 5, step: 0.1, unit: '' },
  { group: 'Rules & structure', key: 'kneePatch', label: 'Knee contact patch (square)', def: 4, min: 1, max: 12, step: 0.5, unit: 'in', help: 'Side of the loaded area for the punching-shear check.' },
];

export const DEFAULTS = Object.fromEntries(PARAMS.map(p => [p.key, p.def]));

export const WATER_PCF = 62.4;            // fresh water, lb/ft³
export const FOAM_PCF = 2;               // typical EPS/XPS bulkhead foam
const IN3_PER_FT3 = 1728;

// ─── Small vector helpers (points are [x,y,z]) ──────────────────────────────────────────
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ─── Interpolated curve (Grasshopper "Interpolate (t)", chord-length knots) ─────────────
// Cubic Hermite spline, C2 at interior points. t0 / t1 = unit end tangents, or null for free ends.
// Returns { pts: polyline, knotIdx: index into pts of each input point }.
export function interpolate(points, t0, t1, perSeg = 48) {
  const P = [points[0]];
  for (let i = 1; i < points.length; i++) if (len(sub(points[i], P[P.length - 1])) > 1e-9) P.push(points[i]);
  const n = P.length - 1;
  if (n < 1) return { pts: [P[0]], knotIdx: points.map(() => 0) };
  const h = []; for (let i = 0; i < n; i++) h.push(len(sub(P[i + 1], P[i])));
  // tridiagonal system for derivatives D[0..n]
  const a = new Array(n + 1).fill(0), b = new Array(n + 1).fill(0), c = new Array(n + 1).fill(0);
  const r = [[], [], []];
  for (let k = 0; k < 3; k++) r[k] = new Array(n + 1).fill(0);
  if (t0) { b[0] = 1; for (let k = 0; k < 3; k++) r[k][0] = t0[k]; }
  else { b[0] = 2; c[0] = 1; for (let k = 0; k < 3; k++) r[k][0] = 3 * (P[1][k] - P[0][k]) / h[0]; }
  for (let i = 1; i < n; i++) {
    a[i] = h[i]; b[i] = 2 * (h[i - 1] + h[i]); c[i] = h[i - 1];
    for (let k = 0; k < 3; k++) r[k][i] = 3 * (h[i] * (P[i][k] - P[i - 1][k]) / h[i - 1] + h[i - 1] * (P[i + 1][k] - P[i][k]) / h[i]);
  }
  if (t1) { b[n] = 1; for (let k = 0; k < 3; k++) r[k][n] = t1[k]; }
  else { a[n] = 1; b[n] = 2; for (let k = 0; k < 3; k++) r[k][n] = 3 * (P[n][k] - P[n - 1][k]) / h[n - 1]; }
  const D = Array.from({ length: n + 1 }, () => [0, 0, 0]);
  for (let k = 0; k < 3; k++) {
    const cc = c.slice(), rr = r[k].slice(), bb = b.slice();
    for (let i = 1; i <= n; i++) { const m = a[i] / bb[i - 1]; bb[i] -= m * cc[i - 1]; rr[i] -= m * rr[i - 1]; }
    D[n][k] = rr[n] / bb[n];
    for (let i = n - 1; i >= 0; i--) D[i][k] = (rr[i] - cc[i] * D[i + 1][k]) / bb[i];
  }
  const pts = [P[0]], knotAt = [0];
  for (let i = 0; i < n; i++) {
    for (let s = 1; s <= perSeg; s++) {
      const u = s / perSeg, u2 = u * u, u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
      pts.push([0, 1, 2].map(k => h00 * P[i][k] + h10 * h[i] * D[i][k] + h01 * P[i + 1][k] + h11 * h[i] * D[i + 1][k]));
    }
    knotAt.push(pts.length - 1);
  }
  // map original point indices (before de-dup) to polyline indices
  const knotIdx = []; let j = 0;
  for (let i = 0; i < points.length; i++) {
    while (j < n && len(sub(points[i], P[j])) > 1e-9) j++;
    knotIdx.push(knotAt[Math.min(j, n)]);
  }
  return { pts, knotIdx };
}

// ─── Polyline utilities ─────────────────────────────────────────────────────────────────
export function polyLength(pl) { let s = 0; for (let i = 1; i < pl.length; i++) s += len(sub(pl[i], pl[i - 1])); return s; }

export function resample(pl, count) { // count points, uniform by arc length
  const cum = [0];
  for (let i = 1; i < pl.length; i++) cum.push(cum[i - 1] + len(sub(pl[i], pl[i - 1])));
  const total = cum[cum.length - 1];
  if (total < 1e-12) return Array.from({ length: count }, () => pl[0].slice());
  const out = []; let j = 1;
  for (let k = 0; k < count; k++) {
    const s = total * k / (count - 1);
    while (j < pl.length - 1 && cum[j] < s) j++;
    const seg = cum[j] - cum[j - 1];
    out.push(lerp(pl[j - 1], pl[j], seg > 0 ? clamp((s - cum[j - 1]) / seg, 0, 1) : 0));
  }
  return out;
}

// first crossing of coordinate `axis` = value, walking from the start. Returns {point, i, t} or null.
function crossAt(pl, axis, value) {
  for (let i = 1; i < pl.length; i++) {
    const a = pl[i - 1][axis] - value, b = pl[i][axis] - value;
    if (a === 0) return { point: pl[i - 1].slice(), i: i - 1, t: 0 };
    if (a * b < 0 || b === 0) { const t = a / (a - b); return { point: lerp(pl[i - 1], pl[i], t), i: i - 1, t }; }
  }
  return null;
}

function closestPoint2D(pl, x, y) { // closest point on polyline in the XY plane
  let best = null, bd = Infinity;
  for (let i = 1; i < pl.length; i++) {
    const ax = pl[i - 1][0], ay = pl[i - 1][1], bx = pl[i][0], by = pl[i][1];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? clamp(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1) : 0;
    const px = ax + dx * t, py = ay + dy * t, d = (px - x) ** 2 + (py - y) ** 2;
    if (d < bd) { bd = d; best = [px, py]; }
  }
  return best;
}

function bounds(pts) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  return { lo, hi };
}

// ─── Stage 1: control curves ────────────────────────────────────────────────────────────
export function buildCurves(p) {
  const L2 = p.length / 2, W2 = p.width / 2, H = p.height;

  // Cross section at midship, YZ plane: sheer → bilge point → flat-bottom corner, then flat to centerline.
  const xsBS = clamp(p.xsBottomSetback, 0, W2);
  const xsCtrl = [[0, W2, H], [0, W2 - p.xsMidX, H / 2 - p.xsMidZ], [0, W2 - xsBS, 0]];
  const xsSpline = interpolate(xsCtrl, [0, 0, -1], [0, -1, 0]);
  const crossSection = xsSpline.pts.concat(W2 - xsBS > 1e-9 ? resample([[0, W2 - xsBS, 0], [0, 0, 0]], 12).slice(1) : []);

  // Profile, XZ plane: bow top → stem point → forefoot (stem/keel joint) → keel point → midship keel.
  const fore = [L2 - p.pfBottomSetback, 0, p.pfRocker];
  const pfCtrl = [[L2, 0, H], [L2 - p.pfStemMidX, 0, H / 2 - p.pfStemMidZ], fore,
    [fore[0] / 2 + p.pfKeelMidX, 0, fore[2] / 2 + p.pfKeelMidZ], [0, 0, 0]];
  const pf = interpolate(pfCtrl, [0, 0, -1], [-1, 0, 0]);
  const k = pf.knotIdx[2];
  const stem = pf.pts.slice(0, k + 1);   // bow top → forefoot   ("forward" in the .gh)
  const keel = pf.pts.slice(k);          // forefoot → midship   ("bottom" in the .gh)

  // Plan (gunwale in top view) at z = H: bow tip → shoulder point → full-beam point, then straight to midship.
  const plCtrl = [[L2, 0, H], [L2 - p.plMidX, W2 / 2 - p.plMidY, H], [L2 - p.plFrontSetback, W2, H]];
  const plSpline = interpolate(plCtrl, null, [-1, 0, 0]);
  const planBow = plSpline.pts.concat(L2 - p.plFrontSetback > 1e-9 ? [[0, W2, H]] : []);
  const plan = planBow.slice().reverse();   // midship → bow tip (Flip Curve in the .gh)

  // Sheer / top rocker, XZ plane: midship → mid point → bow end. Horizontal at midship so the mirror is smooth.
  const shCtrl = [[0, 0, H], [L2 / 2 - p.shMidX, 0, H - p.shEndDrop / 2 + p.shMidZ], [L2, 0, H - p.shEndDrop]];
  const sheer = interpolate(shCtrl, [1, 0, 0], null).pts;

  // Validation — the .gh nulls any curve that leaves its bounding rectangle. We flag instead.
  const tol = 1e-3;
  const inside = (pts, ax, bx, ay, by, lo1, hi1, lo2, hi2) => pts.every(q => q[ax] >= lo1 - tol && q[ax] <= hi1 + tol && q[ay] >= lo2 - tol && q[ay] <= hi2 + tol);
  const valid = {
    crossSection: inside(crossSection, 1, 0, 2, 0, 0, W2, 0, H),
    profile: inside(pf.pts, 0, 0, 2, 0, 0, L2, 0, H),
    plan: inside(plan, 0, 0, 1, 0, 0, L2, 0, W2),
    sheer: inside(sheer, 0, 0, 2, 0, 0, L2, 0, H),
  };

  return {
    crossSection, stem, keel, profile: pf.pts, plan, sheer, valid,
    ctrl: { crossSection: xsCtrl, profile: pfCtrl, plan: plCtrl, sheer: shCtrl },
  };
}

// height of a polyline (in XZ) at x — used for keel and sheer
function zAtX(pl, x) {
  const c = crossAt(pl, 0, x);
  if (c) return c.point[2];
  // outside range: clamp to nearest end
  const b = pl[0][0] < pl[pl.length - 1][0] ? [pl[0], pl[pl.length - 1]] : [pl[pl.length - 1], pl[0]];
  return x <= b[0][0] ? b[0][2] : b[1][2];
}

// ─── Stage 2: station sections (the "CANOE LOFTING" block of the .gh) ──────────────────
export function buildSections(p, curves, M = 40) {
  const H = p.height, N = Math.max(2, Math.round(p.divisions));
  const nRot = Math.max(1, Math.min(Math.round(p.rotDivisions), N));
  const EXT = 2; // extend section tops this far above the depth (mold cutter needs to poke through)

  // stem moved so the forefoot sits at the origin, then rotated 90° about Z into the YZ plane
  const fore = curves.stem[curves.stem.length - 1];
  const stemRot = curves.stem.map(q => { const d = sub(q, fore); return [-d[1], d[0], d[2]]; });
  const S = 96;
  const C0 = resample(curves.crossSection, S), C1 = resample(stemRot, S);

  const kb = bounds(curves.keel);
  const x0 = kb.lo[0], x1 = kb.hi[0];
  const sections = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const xi = x0 + (x1 - x0) * i / N;
    const zk = zAtX(curves.keel, xi);
    const th = -Math.PI / 2 * Math.min(i / nRot, 1);
    const ct = Math.cos(th), st = Math.sin(th);
    let sec = C0.map((a, s) => {
      const q = lerp(a, C1[s], t);                    // Tween Curve
      return [q[0] * ct - q[1] * st + xi, q[0] * st + q[1] * ct, q[2] + zk]; // rotate about keel point, place on keel
    });
    if (i === N) sec = sec.map(q => [q[0], 0, q[2]]);  // the last section is exactly the stem (kill float noise)
    // extend the top along its tangent so it reaches the depth plane
    const dir = norm(sub(sec[0], sec[1]));
    const need = H + EXT - sec[0][2];
    if (need > 0) sec.unshift(add(sec[0], mul(dir, need / Math.max(dir[2], 0.25))));
    // scale in Y so the section's width at z = H matches the plan (top) curve
    const hit = crossAt(sec, 2, H);
    if (hit && Math.abs(hit.point[1]) > 1e-6) {
      const cp = closestPoint2D(curves.plan, hit.point[0], hit.point[1]);
      const s = cp[1] / hit.point[1];
      sec = sec.map(q => [q[0], q[1] * s, q[2]]);
    }
    sections.push({ x: xi, zk, t, angle: -th * 180 / Math.PI, pts: resample(sec, M + 1) });
  }
  return sections;
}

// Catmull-Rom between stations for a smooth loft, then mirror to the stern.
export function loftRows(sections, sub = 3) {
  const n = sections.length, M1 = sections[0].pts.length;
  const P = i => sections[clamp(i, 0, n - 1)].pts;
  const bow = [];
  for (let i = 0; i < n - 1; i++) {
    for (let s = 0; s < sub; s++) {
      const u = s / sub, u2 = u * u, u3 = u2 * u;
      const row = [];
      for (let j = 0; j < M1; j++) {
        const p0 = P(i - 1)[j], p1 = P(i)[j], p2 = P(i + 1)[j], p3 = P(i + 2)[j];
        row.push([0, 1, 2].map(k => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u3)));
      }
      bow.push(row);
    }
  }
  bow.push(P(n - 1).map(q => q.slice()));
  const stern = bow.slice(1).reverse().map(r => r.map(q => [-q[0], q[1], q[2]]));
  return stern.concat(bow); // rows from stern tip → midship → bow tip; each row = starboard half, top → keel centerline
}

// Clip every row (top → keel) to z ≤ zmax(x) and re-sample. Rows entirely above the cut are dropped.
export function clipRows(rows, zmax) {
  const out = [];
  for (const row of rows) {
    const M1 = row.length;
    const f = q => q[2] - zmax(q[0]);
    if (f(row[M1 - 1]) > 1e-9) continue;
    let j = M1 - 1;
    while (j > 0 && f(row[j - 1]) <= 0) j--;
    let pl = row.slice(j);
    if (j > 0) { const a = f(row[j - 1]), b = f(row[j]); pl.unshift(lerp(row[j - 1], row[j], a / (a - b))); }
    out.push(resample(pl, M1));
  }
  return out;
}

// ─── Stage 3: closed triangle soup from rows ────────────────────────────────────────────
// Each row = starboard half-section, top → keel centerline. The port side is the mirror.
// Consecutive rows are stitched; the gunwale edge is bridged (deck cap); open end rows get a fan cap.
// Coincident points (centerline, collapsed bow rows) are welded later by the Manifold loader.
export function rowsToSoup(rows, { capTop = true, capEnds = true } = {}) {
  const R = rows.length, M1 = rows[0].length, Lp = 2 * M1 - 1;
  const loop = row => { const s = row; const port = []; for (let j = M1 - 2; j >= 0; j--) port.push([s[j][0], -s[j][1], s[j][2]]); return s.concat(port); };
  const loops = rows.map(loop);
  const tris = [];
  const T = (a, b, c) => tris.push(a, b, c);
  for (let r = 0; r < R - 1; r++) {
    const A = loops[r], B = loops[r + 1];
    const cmax = capTop ? Lp : Lp - 1;
    for (let c = 0; c < cmax; c++) {
      const c2 = (c + 1) % Lp;
      T(A[c], A[c2], B[c2]); T(A[c], B[c2], B[c]);
    }
  }
  if (capEnds) for (const [r, flip] of [[0, true], [R - 1, false]]) {
    const Lr = loops[r];
    const width = Math.max(...rows[r].map(q => Math.abs(q[1])));
    if (width < 1e-4) continue; // collapsed to a seam — welding closes it
    const cen = [0, 0, 0]; for (const q of Lr) for (let k = 0; k < 3; k++) cen[k] += q[k] / Lr.length;
    for (let c = 0; c < Lp; c++) { const c2 = (c + 1) % Lp; flip ? T(cen, Lr[c2], Lr[c]) : T(cen, Lr[c], Lr[c2]); }
  }
  const soup = new Float32Array(tris.length * 3);
  tris.forEach((q, i) => { soup[3 * i] = q[0]; soup[3 * i + 1] = q[1]; soup[3 * i + 2] = q[2]; });
  if (massProps(soup).volume < 0) flipSoup(soup);
  return soup;
}

export function flipSoup(soup) {
  for (let i = 0; i < soup.length; i += 9) for (let k = 0; k < 3; k++) { const t = soup[i + 3 + k]; soup[i + 3 + k] = soup[i + 6 + k]; soup[i + 6 + k] = t; }
}

// Inner surface for the shell: offset each outer point inward along the surface normal by `t`,
// keep the starboard half (y ≥ 0), add a raised lip so the cutter opens the deck.
export function innerRows(rows, t, liftTo) {
  const R = rows.length, M1 = rows[0].length;
  const P = (r, j) => {
    r = clamp(r, 0, R - 1);
    if (j >= M1) { const q = rows[r][2 * (M1 - 1) - j]; return [q[0], -q[1], q[2]]; }
    return rows[r][clamp(j, 0, M1 - 1)];
  };
  const mid = Math.floor(R / 2);
  const out = [];
  let normalsSign = 0;
  for (let r = 0; r < R; r++) {
    const pts = [];
    for (let j = 0; j < M1; j++) {
      const du = sub(P(r, j + 1), P(r, j - 1)), dv = sub(P(r + 1, j), P(r - 1, j));
      let n = norm(cross(du, dv));
      if (!normalsSign) { // decide orientation once, at midship near the keel (normal must point down)
        const q = rows[mid][M1 - 2], du2 = sub(P(mid, M1 - 1), P(mid, M1 - 3)), dv2 = sub(P(mid + 1, M1 - 2), P(mid - 1, M1 - 2));
        normalsSign = cross(du2, dv2)[2] < 0 ? 1 : -1; void q;
      }
      n = mul(n, normalsSign);
      pts.push(sub(rows[r][j], mul(n, t)));
    }
    pts[M1 - 1][1] = 0;
    out.push(pts);
  }
  // clip to y ≥ 0 from the top; rows whose top already crossed the centerline end the inner hull
  const clipped = [];
  for (let r = 0; r < R; r++) {
    const pts = out[r];
    if (pts[0][1] <= 1e-6) { clipped.push(null); continue; }
    let j = 1; while (j < M1 - 1 && pts[j][1] > 0) j++;
    let pl = pts.slice(0, j);
    const a = pts[j - 1][1], b = pts[j][1];
    pl.push(j === M1 - 1 && b >= 0 ? pts[j] : lerp(pts[j - 1], pts[j], a / (a - b)));
    pl[pl.length - 1][1] = 0;
    if (polyLength(pl) < t) { clipped.push(null); continue; }
    const rs = resample(pl, M1);
    rs.unshift([rs[0][0], rs[0][1], liftTo]);
    clipped.push(rs);
  }
  // keep the contiguous run around midship
  let lo = mid, hi = mid;
  while (lo > 0 && clipped[lo - 1]) lo--;
  while (hi < R - 1 && clipped[hi + 1]) hi++;
  return clipped.slice(lo, hi + 1);
}

// ─── Whole design in one call ───────────────────────────────────────────────────────────
export function buildDesign(params, opts = {}) {
  const p = { ...DEFAULTS, ...params };
  const curves = buildCurves(p);
  const sections = buildSections(p, curves, opts.M || 40);
  const rows = loftRows(sections, opts.sub || 3);
  const H = p.height;
  const sheerZ = x => Math.min(H, zAtX(curves.sheer, Math.abs(x)));
  const hullRows = clipRows(rows, sheerZ);          // "canoe solid": trimmed to the sheer (top rocker)
  const moldRows = clipRows(rows, () => H + 1);      // "canoe": flat top, pokes above the block top for a clean cut
  return { p, curves, sections, rows, hullRows, moldRows, sheerZ };
}

// ─── Mass properties & hydrostatics on closed triangle soups ────────────────────────────
export function massProps(soup) {
  let V = 0, cx = 0, cy = 0, cz = 0, A = 0;
  for (let i = 0; i < soup.length; i += 9) {
    const ax = soup[i], ay = soup[i + 1], az = soup[i + 2], bx = soup[i + 3], by = soup[i + 4], bz = soup[i + 5], qx = soup[i + 6], qy = soup[i + 7], qz = soup[i + 8];
    const v = (ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx)) / 6;
    V += v; cx += v * (ax + bx + qx) / 4; cy += v * (ay + by + qy) / 4; cz += v * (az + bz + qz) / 4;
    const ux = bx - ax, uy = by - ay, uz = bz - az, wx = qx - ax, wy = qy - ay, wz = qz - az;
    A += 0.5 * Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
  }
  return { volume: V, centroid: V ? [cx / V, cy / V, cz / V] : [0, 0, 0], area: A };
}

// Part of a closed soup below the plane n·p = d, n = (0, sin φ, cos φ). Tetrahedra use an apex on the
// plane, so the (unbuilt) waterplane cap adds no volume. Optionally returns the waterplane polygon moments.
// Allocation-free inner loop — this runs thousands of times per analysis.
export function submerged(soup, heelDeg, d, wantWaterplane = false) {
  const ph = heelDeg * Math.PI / 180, sn = Math.sin(ph), cs = Math.cos(ph);
  const oy = sn * d, oz = cs * d;
  let V = 0, bx = 0, by = 0, bz = 0, wet = 0;
  let wA = 0, wU = 0, wV = 0, Iuu = 0, Ivv = 0, umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  const px = new Float64Array(4), py = new Float64Array(4), pz = new Float64Array(4);
  const tx = new Float64Array(3), ty = new Float64Array(3), tz = new Float64Array(3), ts = new Float64Array(3);
  let inx = 0, iny = 0, inz = 0, outx = 0, outy = 0, outz = 0;
  function tet(ax, ay, az, bx_, by_, bz_, cx_, cy_, cz_) {
    const Ay = ay - oy, Az = az - oz, By = by_ - oy, Bz = bz_ - oz, Cy = cy_ - oy, Cz = cz_ - oz;
    const v = (ax * (By * Cz - Bz * Cy) - Ay * (bx_ * Cz - Bz * cx_) + Az * (bx_ * Cy - By * cx_)) / 6;
    V += v; bx += v * (ax + bx_ + cx_) / 4; by += v * (oy + ay + by_ + cy_) / 4; bz += v * (oz + az + bz_ + cz_) / 4;
    const ux = bx_ - ax, uy = by_ - ay, uz = bz_ - az, wx = cx_ - ax, wy = cy_ - ay, wz = cz_ - az;
    wet += 0.5 * Math.sqrt((uy * wz - uz * wy) ** 2 + (uz * wx - ux * wz) ** 2 + (ux * wy - uy * wx) ** 2);
  }
  for (let i = 0; i < soup.length; i += 9) {
    for (let k = 0; k < 3; k++) { tx[k] = soup[i + 3 * k]; ty[k] = soup[i + 3 * k + 1]; tz[k] = soup[i + 3 * k + 2]; ts[k] = ty[k] * sn + tz[k] * cs - d; }
    if (ts[0] <= 0 && ts[1] <= 0 && ts[2] <= 0) { tet(tx[0], ty[0], tz[0], tx[1], ty[1], tz[1], tx[2], ty[2], tz[2]); continue; }
    if (ts[0] > 0 && ts[1] > 0 && ts[2] > 0) continue;
    let m = 0;
    for (let k = 0; k < 3; k++) {
      const k2 = (k + 1) % 3, sa = ts[k], sb = ts[k2];
      if (sa <= 0) { px[m] = tx[k]; py[m] = ty[k]; pz[m] = tz[k]; m++; }
      if ((sa <= 0) !== (sb <= 0)) {
        const u = sa / (sa - sb);
        const x = tx[k] + (tx[k2] - tx[k]) * u, y = ty[k] + (ty[k2] - ty[k]) * u, z = tz[k] + (tz[k2] - tz[k]) * u;
        px[m] = x; py[m] = y; pz[m] = z; m++;
        if (sa <= 0) { outx = x; outy = y; outz = z; } else { inx = x; iny = y; inz = z; }
      }
    }
    for (let k = 1; k < m - 1; k++) tet(px[0], py[0], pz[0], px[k], py[k], pz[k], px[k + 1], py[k + 1], pz[k + 1]);
    if (wantWaterplane) { // waterline segment → waterplane polygon moments (Green's theorem)
      const u1 = outx, v1 = outy * cs - outz * sn, u2 = inx, v2 = iny * cs - inz * sn;
      const cr = u1 * v2 - u2 * v1;
      wA += cr / 2; wU += cr * (u1 + u2) / 6; wV += cr * (v1 + v2) / 6;
      Ivv += cr * (v1 * v1 + v1 * v2 + v2 * v2) / 12; Iuu += cr * (u1 * u1 + u1 * u2 + u2 * u2) / 12;
      umin = Math.min(umin, u1, u2); umax = Math.max(umax, u1, u2); vmin = Math.min(vmin, v1, v2); vmax = Math.max(vmax, v1, v2);
    }
  }
  const res = { V, B: V ? [bx / V, by / V, bz / V] : [0, 0, 0], wet };
  if (wantWaterplane) {
    const sgn = Math.sign(wA) || 1, A = Math.abs(wA);
    const uc = A ? sgn * wU / A : 0, vc = A ? sgn * wV / A : 0;
    res.wp = {
      area: A, centroidX: uc, centroidV: vc,
      IT: Math.abs(Ivv) - A * vc * vc,       // about the fore-aft axis through the waterplane centroid
      IL: Math.abs(Iuu) - A * uc * uc,       // about the transverse axis through the centroid
      LWL: umax - umin, BWL: vmax - vmin, xFwd: umax, xAft: umin,
    };
  }
  return res;
}

export function soupExtents(soup) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < soup.length; i += 3) for (let k = 0; k < 3; k++) { const v = soup[i + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
  return { lo, hi };
}

export function solveDraft(soup, targetV, heelDeg = 0, tol = 1e-4) {
  const ph = heelDeg * Math.PI / 180, sn = Math.sin(ph), cs = Math.cos(ph);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < soup.length; i += 3) { const v = soup[i + 1] * sn + soup[i + 2] * cs; if (v < lo) lo = v; if (v > hi) hi = v; }
  let flo = -targetV, fhi = submerged(soup, heelDeg, hi + 1e-6).V - targetV;
  if (fhi <= 0) return { d: hi, sunk: true };
  let side = 0, d = lo;
  for (let k = 0; k < 60; k++) {           // Illinois (regula falsi) — ~8–12 evaluations
    d = (lo * fhi - hi * flo) / (fhi - flo);
    const f = submerged(soup, heelDeg, d).V - targetV;
    if (Math.abs(f) < tol * targetV || hi - lo < 1e-6) break;
    if (f * fhi > 0) { hi = d; fhi = f; if (side === -1) flo /= 2; side = -1; }
    else { lo = d; flo = f; if (side === 1) fhi /= 2; side = 1; }
  }
  return { d, sunk: false };
}

// Triangles bucketed by X so station slices only visit nearby triangles (cached per soup).
const X_INDEX = new WeakMap();
function trianglesNearX(soup, x) {
  let ix = X_INDEX.get(soup);
  if (!ix) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < soup.length; i += 3) { if (soup[i] < lo) lo = soup[i]; if (soup[i] > hi) hi = soup[i]; }
    const nb = 256, w = (hi - lo) / nb || 1, buckets = Array.from({ length: nb }, () => []);
    for (let i = 0; i < soup.length; i += 9) {
      const a = Math.min(soup[i], soup[i + 3], soup[i + 6]), b = Math.max(soup[i], soup[i + 3], soup[i + 6]);
      const b0 = Math.max(0, Math.floor((a - lo) / w)), b1 = Math.min(nb - 1, Math.floor((b - lo) / w));
      for (let k = b0; k <= b1; k++) buckets[k].push(i);
    }
    ix = { lo, w, nb, buckets };
    X_INDEX.set(soup, ix);
  }
  const k = Math.floor((x - ix.lo) / ix.w);
  return k < 0 || k >= ix.nb ? [] : ix.buckets[k];
}

// Section area below z = T at station x (upright), from a closed soup.
export function sectionArea(soup, x, T) {
  let A = 0;
  for (const i of trianglesNearX(soup, x)) {
    const P3 = [[soup[i], soup[i + 1], soup[i + 2]], [soup[i + 3], soup[i + 4], soup[i + 5]], [soup[i + 6], soup[i + 7], soup[i + 8]]];
    const s = P3.map(q => q[0] - x);
    const pts = [];
    for (let k = 0; k < 3; k++) {
      const a = P3[k], b = P3[(k + 1) % 3], sa = s[k], sb = s[(k + 1) % 3];
      if ((sa < 0) !== (sb < 0)) pts.push(lerp(a, b, sa / (sa - sb)));
    }
    if (pts.length !== 2) continue;
    const nt = cross(sub(P3[1], P3[0]), sub(P3[2], P3[0]));
    const dir = cross([1, 0, 0], nt);
    let [p, q] = pts;
    if (dot(sub(q, p), dir) < 0) [p, q] = [q, p];
    // clip segment to z <= T
    const fp = p[2] - T, fq = q[2] - T;
    if (fp > 0 && fq > 0) continue;
    if (fp > 0) p = lerp(p, q, fp / (fp - fq));
    else if (fq > 0) q = lerp(p, q, fp / (fp - fq));
    A += 0.5 * (p[1] * (q[2] - T) - q[1] * (p[2] - T));
  }
  return Math.abs(A);
}

// Transverse slice of a closed soup at X = x → closed loops of [y, z]. Used for section templates.
export function sliceLoops(soup, x) {
  const segs = [];
  const key = (y, z) => Math.round(y * 1e4) + ',' + Math.round(z * 1e4);
  for (const i of trianglesNearX(soup, x)) {
    const P3 = [[soup[i], soup[i + 1], soup[i + 2]], [soup[i + 3], soup[i + 4], soup[i + 5]], [soup[i + 6], soup[i + 7], soup[i + 8]]];
    const s = P3.map(q => q[0] - x);
    const pts = [];
    for (let k = 0; k < 3; k++) {
      let a = P3[k], b = P3[(k + 1) % 3], sa = s[k], sb = s[(k + 1) % 3];
      if ((sa < 0) !== (sb < 0)) {
        if (a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])))) { [a, b] = [b, a]; [sa, sb] = [sb, sa]; } // canonical edge order → identical points from both faces
        const q = lerp(a, b, sa / (sa - sb)); pts.push([q[1], q[2]]);
      }
    }
    if (pts.length === 2) segs.push(pts);
  }
  const adj = new Map();
  segs.forEach((sg, i) => { for (const e of [0, 1]) { const k = key(...sg[e]); if (!adj.has(k)) adj.set(k, []); adj.get(k).push(i); } });
  const used = new Uint8Array(segs.length), loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const loop = [segs[i][0], segs[i][1]];
    for (;;) {
      const k = key(...loop[loop.length - 1]);
      const nxt = (adj.get(k) || []).find(j => !used[j]);
      if (nxt === undefined) break;
      used[nxt] = 1;
      const sg = segs[nxt];
      loop.push(key(...sg[0]) === k ? sg[1] : sg[0]);
    }
    if (loop.length > 3) loops.push(loop);
  }
  return loops;
}

// ─── Full analysis (hull = closed outer soup, shell = concrete soup) ────────────────────
export function analyze(p, hullSoup, shellSoup, sheerRing, extra = {}) {
  const hull = massProps(hullSoup);
  const shell = massProps(shellSoup);
  const lbPerIn3 = p.concreteDensity / IN3_PER_FT3, waterPerIn3 = WATER_PCF / IN3_PER_FT3;
  const hullWeight = shell.volume * lbPerIn3;
  const crewWeight = p.crew * p.crewWeight;
  const ext = soupExtents(hullSoup);
  const keelZ = ext.lo[2];
  // CG: concrete shell at its centroid, paddlers on the centerline at crewCG above the keel, extras at the shell CG
  const W = hullWeight + crewWeight + p.extraWeight;
  const G = [0, 0, 0];
  const addW = (w, c) => { for (let k = 0; k < 3; k++) G[k] += w * c[k] / W; };
  addW(hullWeight + p.extraWeight, shell.centroid);
  addW(crewWeight, [0, 0, keelZ + p.crewCG]);

  const load = (weight, cg, label) => {
    const Vreq = weight / waterPerIn3;
    const sol = solveDraft(hullSoup, Vreq, 0);
    const sm = submerged(hullSoup, 0, sol.d, true);
    const wp = sm.wp, T = sol.d - keelZ, V = sm.V;
    const minSheer = Math.min(...sheerRing.map(q => q[2]));
    const KB = sm.B[2] - keelZ, BMt = wp.IT / V, BMl = wp.IL / V, KG = cg[2] - keelZ;
    let Am = 0, xm = 0;
    const sac = [];
    for (let k = 0; k <= 30; k++) {
      const x = wp.xAft + (wp.xFwd - wp.xAft) * k / 30;
      const a = sectionArea(hullSoup, x, sol.d);
      sac.push([x, a]);
      if (a > Am) { Am = a; xm = x; }
    }
    return {
      label, weight, sunk: sol.sunk, draft: T, waterline: sol.d, displacementIn3: V,
      freeboard: minSheer - sol.d, LWL: wp.LWL, BWL: wp.BWL, xAft: wp.xAft, xFwd: wp.xFwd, Awp: wp.area, wetted: sm.wet,
      LCB: sm.B[0], LCF: wp.centroidX, KB, BMt, BMl, KG, GMt: KB + BMt - KG, GMl: KB + BMl - KG,
      Cb: V / (wp.LWL * wp.BWL * T), Cwp: wp.area / (wp.LWL * wp.BWL), Cm: Am / (wp.BWL * T), Cp: V / (Am * wp.LWL),
      Am, xAm: xm, sac,
    };
  };

  const loaded = load(W, G, 'Race load');
  const empty = load(hullWeight + p.extraWeight, shell.centroid, 'Empty hull');

  // GZ curve at race load
  const gz = [];
  let downflood = null;
  for (let a = 0; a <= 90; a += 5) {
    const sol = solveDraft(hullSoup, loaded.displacementIn3, a);
    const sm = submerged(hullSoup, a, sol.d);
    const ph = a * Math.PI / 180;
    const h = [0, -Math.cos(ph), Math.sin(ph)];
    const arm = dot(sub(sm.B, G), h);
    gz.push([a, arm]);
    if (downflood === null) {
      const fb = Math.min(...sheerRing.map(q => q[1] * Math.sin(ph) + q[2] * Math.cos(ph))) - sol.d;
      if (fb <= 0) downflood = a;
    }
  }
  let vanishing = null;
  for (let k = 1; k < gz.length; k++) if (gz[k - 1][1] > 0 && gz[k][1] <= 0) { vanishing = gz[k - 1][0] + 5 * gz[k - 1][1] / (gz[k - 1][1] - gz[k][1]); break; }
  const maxGZ = gz.reduce((m, g) => g[1] > m[1] ? g : m, [0, -Infinity]);

  // Swamped: concrete + foam displace water, paddlers out. Floats if buoyancy ≥ weight.
  const swampBuoy = (shell.volume * waterPerIn3) + p.foam * WATER_PCF;
  const swampWeight = hullWeight + p.extraWeight + p.foam * FOAM_PCF;

  // Speed & friction drag (ITTC-57 friction line; residuary/wave drag not included)
  const LWLft = loaded.LWL / 12;
  const hullSpeedKn = 1.34 * Math.sqrt(LWLft), hullSpeedMph = hullSpeedKn * 1.15078;
  const v = p.speed * 0.44704, nu = 1.004e-6, rho = 998;
  const Re = v * (loaded.LWL * 0.0254) / nu;
  const Cf = 0.075 / (Math.log10(Re) - 2) ** 2;
  const Rf = 0.5 * rho * v * v * (loaded.wetted * 0.0254 * 0.0254) * Cf; // N
  const Fn = v / Math.sqrt(9.81 * loaded.LWL * 0.0254);

  // ── 2027 rules load cases ──
  const paddlerXs = n => {
    if (n <= 0) return [];
    const a = ext.lo[0] + p.paddlerInset, b = ext.hi[0] - p.paddlerInset;
    return n === 1 ? [(a + b) / 2] : Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1));
  };
  const gunwale = sheerRing.filter((_, i) => i % 2 === 0).slice().sort((u, v) => u[0] - v[0]);
  const coed = (() => {
    const Wc = hullWeight + p.extraWeight + 4 * p.crewWeight;
    const sol = solveDraft(hullSoup, Wc / waterPerIn3, 0);
    const fb = gunwale.map(q => [q[0], q[2] - sol.d]);
    const need = 6.25; // letters: top 1 in below the gunwale, 5 in + 1/4 in tolerance tall
    let best = 0, runStart = null, bestSpan = null;
    for (let i = 0; i < fb.length; i++) {
      if (fb[i][1] >= need) { if (runStart === null) runStart = fb[i][0]; const run = fb[i][0] - runStart; if (run >= best) { best = run; bestSpan = [runStart, fb[i][0]]; } }
      else runStart = null;
    }
    const mid = fb.reduce((m, f) => Math.abs(f[0]) < Math.abs(m[0]) ? f : m, fb[0]);
    return { weight: Wc, sunk: sol.sunk, waterline: sol.d, draft: sol.d - keelZ, minFreeboard: Math.min(...fb.map(f => f[1])), midFreeboard: mid[1], need, letterRun: best, letterSpan: bestSpan, profile: fb };
  })();
  const slalom = longitudinalStrength(p, hullSoup, shellSoup, 3, paddlerXs(3), ext);

  return {
    hullVolumeIn3: hull.volume, hullLength: ext.hi[0] - ext.lo[0],
    endVoidIn3: extra.endVoidIn3 ?? null,
    coed, slalom, shellVolumeIn3: shell.volume, shellAreaIn2: shell.area / 2,
    hullWeight, crewWeight, totalWeight: W, G, keelZ,
    loaded, empty, gz, downflood, vanishing, maxGZ,
    swamp: { buoyancy: swampBuoy, weight: swampWeight, margin: swampBuoy - swampWeight, floats: swampBuoy >= swampWeight, foamNeededFt3: Math.max(0, (hullWeight + p.extraWeight - shell.volume * waterPerIn3) / (WATER_PCF - FOAM_PCF)) },
    speed: { hullSpeedMph, Fn, Re, Cf, dragLb: Rf * 0.224809, dragN: Rf },
  };
}

// ─── Structure: hull as a floating beam (2027 RFP 5.7.1 load case) ─────────────────────
// Polygon properties of the concrete at station x: area, neutral axis height, Ix about it.
export function sectionProps(shellSoup, x) {
  const loops = sliceLoops(shellSoup, x);
  let A = 0, Sz = 0, Izz = 0, zmin = Infinity, zmax = -Infinity;
  for (const lp of loops) {
    let a = 0, sz = 0, iz = 0;
    for (let i = 0; i < lp.length; i++) {
      const [y1, z1] = lp[i], [y2, z2] = lp[(i + 1) % lp.length];
      const cr = y1 * z2 - y2 * z1;
      a += cr / 2; sz += cr * (z1 + z2) / 6; iz += cr * (z1 * z1 + z1 * z2 + z2 * z2) / 12;
      zmin = Math.min(zmin, z1); zmax = Math.max(zmax, z1);
    }
    const sg = Math.sign(a) || 1;
    A += a * sg; Sz += sz * sg; Izz += iz * sg;
  }
  if (A <= 0) return { A: 0, zNA: 0, I: 0, zmin: 0, zmax: 0, loops };
  const zNA = Sz / A;
  return { A, zNA, I: Izz - A * zNA * zNA, zmin, zmax, loops };
}

export function longitudinalStrength(p, hullSoup, shellSoup, nPaddlers, xs, ext) {
  const gw = WATER_PCF / 1728, gc = p.concreteDensity / 1728;
  const x0 = ext.lo[0], x1 = ext.hi[0], n = 120, dx = (x1 - x0) / n;
  const stations = Array.from({ length: n }, (_, i) => x0 + (i + 0.5) * dx);
  const zTop = ext.hi[2] + 1;
  const concreteW = stations.map(x => sectionArea(shellSoup, x, zTop) * gc * dx);
  const extraW = p.extraWeight / n;
  const Wtot = concreteW.reduce((a, b) => a + b, 0) + p.extraWeight + nPaddlers * p.crewWeight;
  const sol = solveDraft(hullSoup, Wtot / gw, 0);
  let buoy = stations.map(x => sectionArea(hullSoup, x, sol.d) * gw * dx);
  const Btot = buoy.reduce((a, b) => a + b, 0) || 1;
  buoy = buoy.map(b => b * Wtot / Btot); // close the discretisation error so the beam is in equilibrium
  // shear and moment at strip boundaries; loads positive upward, so M > 0 = sagging (bottom in tension)
  const V = [0], M = [0], X = [x0];
  let v = 0, m = 0;
  for (let i = 0; i < n; i++) {
    const xa = x0 + i * dx, xb = xa + dx;
    const nP = xs.filter(xp => xp >= xa && xp < xb).length;
    const vStart = v;
    v += buoy[i] - concreteW[i] - extraW - nP * p.crewWeight;
    m += (vStart + v) / 2 * dx;
    V.push(v); M.push(m); X.push(xb);
  }
  const mEnd = M[n];
  for (let i = 0; i <= n; i++) M[i] -= mEnd * (X[i] - x0) / (x1 - x0); // small residual from ignoring trim
  let iM = 0, iV = 0;
  for (let i = 0; i <= n; i++) { if (Math.abs(M[i]) > Math.abs(M[iM])) iM = i; if (Math.abs(V[i]) > Math.abs(V[iV])) iV = i; }
  const sec = sectionProps(shellSoup, X[iM]);
  const Mmax = M[iM];
  const cTop = sec.zmax - sec.zNA, cBot = sec.zNA - sec.zmin;
  const sigTop = sec.I ? -Mmax * cTop / sec.I : 0, sigBot = sec.I ? Mmax * cBot / sec.I : 0; // + tension, − compression
  const tension = Math.max(sigTop, sigBot, 0), compression = -Math.min(sigTop, sigBot, 0);
  // punching shear, ACI 318 two-way (λ = 1, φ = 0.75): one paddler on a square knee patch, d = half the wall
  const d = p.wall / 2, a = p.kneePatch, b0 = 4 * (a + d);
  const vu = p.crewWeight / (b0 * d), phiVc = 0.75 * 4 * Math.sqrt(p.fc);
  return {
    paddlers: nPaddlers, positions: xs, weight: Wtot, waterline: sol.d,
    X, V, M, Mmax, xMmax: X[iM], sagging: Mmax > 0, Vmax: V[iV], xVmax: X[iV],
    section: { A: sec.A, zNA: sec.zNA - ext.lo[2], I: sec.I, cTop, cBot, loops: sec.loops },
    stress: { top: sigTop, bottom: sigBot, tension, compression, tensionFS: tension * p.fs, compressionFS: compression * p.fs,
      dcrTension: tension * p.fs / p.ft, dcrCompression: compression * p.fs / p.fc },
    punching: { d, b0, vu, vuFS: vu * p.fs, phiVc, dcr: vu * p.fs / phiVc },
  };
}

// ─── Hydrodynamics: Michell thin-ship wave resistance (J.H. Michell 1898) ──────────────────
// Rw = (4 ρ g² / π U²) ∫₁^∞ (I² + J²) λ² / √(λ² − 1) dλ,  I + iJ = ∬ f_x e^(−k₀λ² z) e^(i k₀ λ x) dx dz,
// f(x, z) = half-breadth, z = depth below the waterline, k₀ = g/U². Integrated by parts in x (f = 0 at
// the ends), exact exponential weights for a piecewise-linear f, and λ = sec θ to remove the singularity.
// Checked against Michell's own worked example (test/core-test.mjs). All inputs SI.
export function michellRw(off, U, rho = 998.2, g = 9.81, nTheta = 1200) {
  const { nx, nz, hx, hz, x0, f } = off; // f[(nx+1)*(nz+1)], f[i*(nz+1)+j] at x0+i*hx, depth j*hz
  const k0 = g / (U * U);
  const lamMax = Math.max(1.02, 2 * Math.PI / (k0 * hx));
  const thMax = Math.acos(1 / lamMax);
  const n = nTheta % 2 ? nTheta + 1 : nTheta, dth = thMax / n;
  const re = new Float64Array(nz + 1), im = new Float64Array(nz + 1), wz = new Float64Array(nz + 1);
  let total = 0;
  for (let q = 0; q <= n; q++) {
    const th = q * dth;
    if (th >= Math.PI / 2) continue;
    const sec = 1 / Math.cos(th), k = k0 * sec, kap = k0 * sec * sec;
    // x weights: ∫ hat_i(x) e^{ikx} dx = e^{ikx_i} h sinc²(kh/2)
    const s = k * hx / 2, sinc2 = s < 1e-8 ? 1 : (Math.sin(s) / s) ** 2;
    // z weights: ∫ hat_j(z) e^{−κz} dz, written to avoid overflow
    const a = kap * hz;
    if (a < 1e-7) { for (let j = 0; j <= nz; j++) wz[j] = (j === 0 || j === nz) ? hz / 2 : hz; }
    else {
      const e1 = Math.exp(-a);
      wz[0] = (a - 1 + e1) / (kap * kap * hz);
      for (let j = 1; j < nz; j++) wz[j] = Math.exp(-kap * (j - 1) * hz) * (1 - e1) * (1 - e1) / (kap * kap * hz);
      wz[nz] = Math.exp(-kap * (nz - 1) * hz) * (1 - (1 + a) * e1) / (kap * kap * hz);
    }
    re.fill(0); im.fill(0);
    for (let i = 1; i < nx; i++) {
      const ph = k * (x0 + i * hx), c = Math.cos(ph), sn = Math.sin(ph), base = i * (nz + 1);
      for (let j = 0; j <= nz; j++) { const v = f[base + j]; if (v) { re[j] += v * c; im[j] += v * sn; } }
    }
    let Sr = 0, Si = 0;
    for (let j = 0; j <= nz; j++) { Sr += re[j] * wz[j]; Si += im[j] * wz[j]; }
    Sr *= hx * sinc2; Si *= hx * sinc2;
    const F = k * k * (Sr * Sr + Si * Si) * sec * sec * sec; // (I²+J²) λ²/√(λ²−1) dλ/dθ = … sec³θ
    total += F * (q === 0 || q === n ? 1 : q % 2 ? 4 : 2);
  }
  total *= dth / 3;
  return 4 * rho * g * g / (Math.PI * U * U) * total;
}

// Half-breadth offsets of the submerged hull, from a closed soup (inches) → SI grid for michellRw.
export function hullOffsets(soup, waterZ, xAft, xFwd, nx = 96, nz = 16) {
  const IN = 0.0254;
  const ext = soupExtents(soup);
  const keel = ext.lo[2], T = waterZ - keel;
  const pad = (xFwd - xAft) * 0.01;
  const xa = xAft - pad, xb = xFwd + pad, hx = (xb - xa) / nx, hz = T / nz;
  const f = new Float64Array((nx + 1) * (nz + 1));
  for (let i = 1; i < nx; i++) {
    const loops = sliceLoops(soup, xa + i * hx);
    for (let j = 0; j <= nz; j++) {
      const z = waterZ - j * hz;
      let best = 0;
      for (const lp of loops) for (let s = 0; s < lp.length; s++) {
        const p = lp[s], r = lp[(s + 1) % lp.length];
        if ((p[1] - z) * (r[1] - z) <= 0 && p[1] !== r[1]) {
          const y = Math.abs(p[0] + (r[0] - p[0]) * (z - p[1]) / (r[1] - p[1]));
          if (y > best) best = y;
        }
      }
      f[i * (nz + 1) + j] = best * IN;
    }
  }
  return { nx, nz, hx: hx * IN, hz: hz * IN, x0: xa * IN, f, T: T * IN, L: (xb - xa) * IN };
}

// ITTC-1957 friction line
export const ittcCf = Re => 0.075 / (Math.log10(Re) - 2) ** 2;

// Resistance curve and race-speed prediction at a given loaded waterline.
export function resistanceCurve(p, hullSoup, loaded) {
  const rho = 998.2, g = 9.81, nu = 1.004e-6, LB = 4.44822;
  const off = hullOffsets(hullSoup, loaded.waterline, loaded.xAft, loaded.xFwd);
  const S = loaded.wetted * 0.0254 * 0.0254, Lwl = loaded.LWL * 0.0254;
  const pts = [];
  for (let mph = 1; mph <= 9.0001; mph += 0.5) {
    const U = mph * 0.44704;
    const Rf = 0.5 * rho * U * U * S * ittcCf(U * Lwl / nu) * (1 + p.formFactor);
    const Rw = michellRw(off, U, rho, g, 600);
    pts.push({ mph, Fn: U / Math.sqrt(g * Lwl), Rf: Rf / LB, Rw: Rw / LB, R: (Rf + Rw) / LB, P: (Rf + Rw) * U });
  }
  // speed where total resistance power = crew effective power (bisection on the tabulated curve)
  const speedFor = watts => {
    for (let k = 1; k < pts.length; k++) if (pts[k].P >= watts) {
      const a = pts[k - 1], b = pts[k], t = (watts - a.P) / (b.P - a.P);
      return a.mph + (b.mph - a.mph) * t;
    }
    return null;
  };
  const crewN = Math.max(1, p.crew);
  const vRace = speedFor(crewN * p.paddlerPower);
  const at = mph => { const k = pts.findIndex(q => q.mph >= mph - 1e-9); return k < 0 ? null : pts[k]; };
  return {
    pts, off: { nx: off.nx, nz: off.nz, L: off.L, T: off.T },
    crew: crewN, raceMph: vRace, time200: vRace ? 200 / (vRace * 0.44704) : null,
    atSpeed: at(Math.round(p.speed * 2) / 2),
  };
}
