// Foam planner check: default design, then heavier mixes, then a mix lighter than water.
import Module from '../vendor/manifold.js';
import { buildDesign, DEFAULTS, sliceLoops } from '../hull.js';
import { createSolidKit, toBinarySTL } from '../solids.js';
import { writeFileSync, mkdirSync } from 'node:fs';
const wasm = await Module(); wasm.setup();
const K = createSolidKit(wasm);
mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
const f = (v, d = 2) => Number(v).toFixed(d);
for (const [label, over] of [['default 62 pcf', {}], ['heavy 70 pcf', { concreteDensity: 70 }], ['light 58 pcf', { concreteDensity: 58 }], ['80 pcf + 40 lb extras', { concreteDensity: 80, extraWeight: 40 }]]) {
  const d = buildDesign({ ...DEFAULTS, ...over });
  const t = performance.now();
  const r = K.buildFoam(d);
  const ms = (performance.now() - t).toFixed(0);
  if (!r.needed) { console.log(`${label}: no foam needed (sinking ${f(r.sinkingLb, 1)} lb), ${ms} ms`); continue; }
  console.log(`${label}: bulkhead ${f(r.d, 2)} in from each tip, fits=${r.fits}, sinking ${f(r.sinkingLb, 1)} lb (+caps -> ${f(r.sinkTotalLb, 1)}), lift ${f(r.liftLb, 1)} lb, margin ${f(r.marginPct, 0)}%, ${ms} ms`);
  console.log(`   per end: foam ${f(r.foamIn3 / 1728, 3)} ft3 = ${f(r.foamLb, 2)} lb, cap concrete ${f(r.capIn3 / 1728, 3)} ft3 = ${f(r.capLb, 1)} lb, foam top z ${f(r.foamTopZ, 2)}; tris foam ${r.foamSoup.length / 9}, caps ${r.capSoup.length / 9}`);
  // independent swamp check from the plan's own volumes
  const gw = 62.4 / 1728, gc = d.p.concreteDensity / 1728, gf = d.p.foamPcf / 1728;
  const Vs = K.build(d, { mold: false }).shellVolume;
  const buoy = gw * (Vs + 2 * r.capIn3 + 2 * r.foamIn3), wt = gc * (Vs + 2 * r.capIn3) + gf * 2 * r.foamIn3 + d.p.extraWeight;
  console.log(`   swamped: buoyancy ${f(buoy, 1)} lb vs weight ${f(wt, 1)} lb -> net ${f(buoy - wt, 1)} lb (planner says ${f(r.liftLb - r.sinkTotalLb, 1)})`);
  const loops = sliceLoops(r.foamSoup, r.tip - r.d + 0.05);
  console.log(`   bulkhead slice: ${loops.length} loop(s), ${loops[0]?.length} pts, width ${loops.length ? f(Math.max(...loops[0].map(q => q[0])) - Math.min(...loops[0].map(q => q[0])), 2) : '-'} in`);
  const tag = label.split(' ')[0];
  writeFileSync(new URL(`./out/foam-${tag}.stl`, import.meta.url), Buffer.from(toBinarySTL(r.foamSoup, 'foam')));
  writeFileSync(new URL(`./out/foam-caps-${tag}.stl`, import.meta.url), Buffer.from(toBinarySTL(r.capSoup, 'caps')));
}
