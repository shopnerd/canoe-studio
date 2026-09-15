import Module from '../vendor/manifold.js';
import { buildDesign, DEFAULTS } from '../hull.js';
import { createSolidKit, toBinarySTL } from '../solids.js';
import { writeFileSync, mkdirSync } from 'node:fs';
const wasm = await Module(); wasm.setup();
const K = createSolidKit(wasm);
const d = buildDesign(DEFAULTS);
mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
for (const [scale, shape] of [[4, 'open'], [4, 'closed'], [6, 'solid'], [10, 'open']]) {
  const t = performance.now();
  const r = K.buildPrint(d, { scale, shape, wallMm: 3, maxLenIn: 35, jointMm: 12, boltMm: 6.5, envelopeIn: [36, 24, 36] });
  console.log(`1:${scale} ${shape}: ${r.n} part(s), model ${r.lengthIn.toFixed(1)} in, vol ${r.modelVolIn3.toFixed(1)} in³, ${(performance.now() - t).toFixed(0)} ms, joints`, r.joints.map(j => `${j.xModelIn.toFixed(1)}in/${j.holes}h`).join(' '));
  for (const g of r.segments) {
    console.log(`   ${g.name}: ${g.dimsIn.map(v => v.toFixed(2)).join(' × ')} in, ${g.volIn3.toFixed(1)} in³, fits F900: ${g.fits}, tris ${g.soup.length / 9}`);
    writeFileSync(new URL(`./out/${scale}-${shape}-${g.name}.stl`, import.meta.url), Buffer.from(toBinarySTL(g.soup, g.name)));
  }
}
