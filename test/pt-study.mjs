// node test/pt-study.mjs — post-tensioning feasibility numbers for the default design.
// Every hull number comes from the same code the app runs; tendon/material values are flagged as assumptions.
import Module from '../vendor/manifold.js';
import { buildDesign, DEFAULTS, sectionProps, sectionArea, solveDraft, WATER_PCF, analyze, polyLength } from '../hull.js';
import { createSolidKit, sheerRing } from '../solids.js';

const wasm = await Module(); wasm.setup();
const K = createSolidKit(wasm);
const d = buildDesign(DEFAULTS), p = d.p;
const r = K.build(d, { mold: false });
const A = analyze(p, r.hullSoup, r.shellSoup, sheerRing(d.hullRows), { endVoidIn3: r.endVoidIn3 });
const f = (v, n = 1) => Number(v).toFixed(n);
const out = {};

// ── section at midship and at the slalom max-moment station ──
const lo = -p.length / 2, hi = p.length / 2;
const sec0 = sectionProps(r.shellSoup, 0), secM = sectionProps(r.shellSoup, A.slalom.xMmax);
const props = s => ({ A: s.A, I: s.I, zNA: s.zNA, cTop: s.zmax - s.zNA, cBot: s.zNA - s.zmin });
out.midship = props(sec0); out.critical = props(secM);

// ── load cases: moments (lb·in), + = sagging ──
out.slalom = { M: A.slalom.Mmax, x: A.slalom.xMmax };
// 4-person co-ed sprint (same beam model, 4 paddlers)
const { longitudinalStrength } = await import('../hull.js');
const ext = { lo: [lo, 0, 0], hi: [hi, 0, 18] };
const xs4 = [0, 1, 2, 3].map(i => lo + p.paddlerInset + (p.length - 2 * p.paddlerInset) * i / 3);
const co = longitudinalStrength(p, r.hullSoup, r.shellSoup, 4, xs4, { lo: [lo, 0, A.keelZ], hi: [hi, 0, 18] });
out.coed4 = { M: co.Mmax, x: co.xMmax };
// transport: empty hull on two supports 24 in from each tip, dynamic factor 2 (a bump, a set-down)
{
  const n = 240, dx = p.length / n, gc = p.concreteDensity / 1728;
  const w = Array.from({ length: n }, (_, i) => sectionArea(r.shellSoup, lo + (i + 0.5) * dx, 30) * gc * dx + p.extraWeight / n);
  const W = w.reduce((a, b) => a + b, 0);
  const s1 = lo + 24, s2 = hi - 24;
  // reactions from moment balance about s1
  const mom = w.reduce((a, wi, i) => a + wi * (lo + (i + 0.5) * dx - s1), 0);
  const R2 = mom / (s2 - s1), R1 = W - R2;
  let V = 0, M = 0, best = 0, bx = 0;
  for (let i = 0; i < n; i++) {
    const x = lo + i * dx;
    if (x <= s1 && x + dx > s1) V += R1;
    if (x <= s2 && x + dx > s2) V += R2;
    V -= w[i]; M += V * dx;
    if (Math.abs(M) > Math.abs(best)) { best = M; bx = x; }
  }
  out.transport = { W, M: best * 2, x: bx, note: 'x2 dynamic' };
}

// ── stresses: sigma = -P/A - P*e*y/I + M*y/I, y up from NA, tension + ──
const stress = (s, M, P = 0, eBelowNA = 0) => {
  const top = -P / s.A + P * eBelowNA * s.cTop / s.I - M * s.cTop / s.I;
  const bot = -P / s.A - P * eBelowNA * s.cBot / s.I + M * s.cBot / s.I;
  return { top, bot };
};
const sc = out.critical;
out.cases = {};
for (const k of ['slalom', 'coed4', 'transport']) {
  const s = stress(sc, out[k].M);
  out.cases[k] = { M: out[k].M, top: s.top, bot: s.bot, maxT: Math.max(s.top, s.bot, 0), maxTwithFS: Math.max(s.top, s.bot, 0) * p.fs };
}

// ── material: lightweight concrete modulus of rupture and modulus (ACI 318 estimates) ──
const fc = p.fc, wc = p.concreteDensity, lambda = 0.75;
out.concrete = { fr: 7.5 * lambda * Math.sqrt(fc), Ec: Math.pow(wc, 1.5) * 33 * Math.sqrt(fc) };

// ── concentric prestress needed so no case goes into tension, with FS ──
const needSigma = Math.max(...Object.values(out.cases).map(c => c.maxTwithFS));
out.concentric = { sigma: needSigma, P: needSigma * sc.A };

// ── keel-only tendon: eccentric below the NA ──
const eKeel = sc.cBot - 0.5; // tendon ~0.5 in above the outside of the keel
const Pk = 1400;
const sk0 = stress(sc, 0, Pk, eKeel), skH = stress(sc, out.slalom.M * p.fs, Pk, eKeel);
out.keelOnly = { e: eKeel, P: Pk, prestressOnly: sk0, withSlalomFS: skH };

// ── tendon candidate (ASSUMPTIONS — check the actual datasheet) ──
const tendon = { name: '1/8 in 7x19 galvanized wire rope', MBS: 2000, area: 0.0063, E: 13e6, wideIn: 0.125 };
const Pj = 0.7 * tendon.MBS; // working force at anchorage
out.tendon = { ...tendon, Pj, stressKsi: Pj / tendon.area / 1000 };

// ── losses ──
const Ltendon = polyLength(d.curves.keel) * 2; // keel tendon length, bow to stern along the rocker
const elong = Pj * Ltendon / (tendon.area * tendon.E);
const slip = 1 / 16;
const shrink = 1000e-6, creepCoef = 2.5;
const sigC = out.concentric.P / sc.A;
out.losses = {
  length: Ltendon, elongation: elong,
  seatingPct: 100 * slip / elong,
  shrinkagePct: 100 * shrink * tendon.E * tendon.area / Pj,
  creepPct: 100 * (sigC / out.concrete.Ec) * creepCoef * tendon.E * tendon.area / Pj,
  constructionalStretchNote: 'wire rope bedding-in 0.5–0.75% of length unless pre-stretched',
};
out.losses.totalPct = out.losses.seatingPct + out.losses.shrinkagePct + out.losses.creepPct + 3; // +3% friction/relaxation allowance

// ── plan-curvature side pull if tendons follow the hull sides ──
// a tendon along the gunwale (plan curve), sagitta = half-beam over the hull length
const sag = p.width / 2, span = p.length;
const wLat = 8 * Pj * sag / (span * span);
const wall = p.wall, H = p.height;
const mCant = wLat * H;                    // lb·in per inch, side wall as a cantilever from the bilge
const zWall = wall * wall / 6;
out.sidePull = { perTendon: Pj, lbPerIn: wLat, wallMoment: mCant, wallStress: mCant / zWall, thwartSpacing36: { M: wLat * 36 * 36 / 8 } };

// ── keel tendon along the rocker: load-balancing uplift ──
const rocker = p.pfRocker, keelSpan = Ltendon;
out.balance = { upliftLbPerIn: 8 * Pj * rocker / (keelSpan * keelSpan), totalUplift: 8 * Pj * rocker / keelSpan, hullWeight: A.hullWeight };

// ── anchorage ──
const plate = 1.5; // in square
out.anchor = { plate, bearing: Pj / (plate * plate), allowable: 0.7 * fc, burstingRough: 0.25 * Pj };

// ── thickness rule check for a tendon inside the wall ──
out.thickness = { wall, tendon: tendon.wideIn, twoMeshLayers: 0.08, ratio: (tendon.wideIn + 0.08) / wall };

console.log(JSON.stringify(out, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v, 2));
