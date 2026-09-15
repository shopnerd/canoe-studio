import Module from '../vendor/manifold.js';
import { buildDesign, DEFAULTS, analyze, hullOffsets, michellRw } from '../hull.js';
import { createSolidKit, sheerRing } from '../solids.js';
const wasm = await Module(); wasm.setup();
const K = createSolidKit(wasm);
const d = buildDesign(DEFAULTS), r = K.build(d, { mold: false });
const A = analyze(d.p, r.hullSoup, r.shellSoup, sheerRing(d.hullRows), {});
const L = A.loaded;
for (const [nx, nz, nt] of [[64, 10, 400], [96, 16, 600], [96, 16, 900], [160, 24, 1500]]) {
  let t = performance.now();
  const off = hullOffsets(r.hullSoup, L.waterline, L.xAft, L.xFwd, nx, nz);
  const t1 = performance.now();
  const row = [3, 4, 5, 6, 7].map(m => (michellRw(off, m * 0.44704, 998.2, 9.81, nt) / 4.448).toFixed(2));
  console.log(`${nx}x${nz} θ${nt}  offsets ${(t1 - t).toFixed(0)} ms  5 speeds ${(performance.now() - t1).toFixed(0)} ms  Rw lb @3-7 mph: ${row.join(' ')}`);
}
