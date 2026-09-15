// Model tow-test planning numbers for the default design (Froude scaling + ITTC-57 friction).
import Module from '../vendor/manifold.js';
import { buildDesign, DEFAULTS, analyze, resistanceCurve, ittcCf } from '../hull.js';
import { createSolidKit, sheerRing } from '../solids.js';
const wasm = await Module(); wasm.setup();
const K = createSolidKit(wasm);
const d = buildDesign(DEFAULTS), r = K.build(d, { mold: false });
const A = analyze(d.p, r.hullSoup, r.shellSoup, sheerRing(d.hullRows), {});
const C = resistanceCurve(d.p, r.hullSoup, A.loaded);
const L = A.loaded, rho = 998.2, nu = 1.004e-6;
const S = L.wetted * 0.0254 ** 2, Lwl = L.LWL * 0.0254;
for (const lam of [4, 5]) {
  const Sm = S / lam ** 2, Lm = Lwl / lam;
  console.log(`\nλ=${lam}: model LWL ${(L.LWL / lam).toFixed(1)} in, overall ${(210 / lam).toFixed(1)} in, beam ${(30 / lam).toFixed(1)} in, draft ${(L.draft / lam).toFixed(2)} in, displacement race load ${(A.totalWeight / lam ** 3).toFixed(2)} lb (${(A.totalWeight / lam ** 3 * 453.6).toFixed(0)} g)`);
  for (const q of C.pts.filter(q => [3, 4, 5, 6, 7].includes(q.mph))) {
    const Vs = q.mph * 0.44704, Vm = Vs / Math.sqrt(lam);
    const Rwm = q.Rw * 4.44822 / lam ** 3;
    const Rfm = 0.5 * rho * Vm * Vm * Sm * ittcCf(Vm * Lm / nu) * (1 + d.p.formFactor);
    const Rm = Rwm + Rfm;
    console.log(`  full ${q.mph} mph → model ${(Vm).toFixed(2)} m/s (${(Vm / 0.44704).toFixed(2)} mph), Re ${(Vm * Lm / nu / 1e6).toFixed(2)}e6, model drag ${Rm.toFixed(3)} N = ${(Rm / 9.81 * 1000).toFixed(0)} gf (waves ${(Rwm / 9.81 * 1000).toFixed(0)} gf)`);
  }
}
console.log('\nfull scale S', (L.wetted / 144).toFixed(2), 'ft2  LWL', L.LWL.toFixed(1), 'in  race load', A.totalWeight.toFixed(0), 'lb');
