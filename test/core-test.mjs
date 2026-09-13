// node test/core-test.mjs — builds the default design headless and prints the key numbers.
import Module from '../vendor/manifold.js';
import { buildDesign, DEFAULTS } from '../hull.js';
import { createSolidKit, sheerRing, analyze, toBinarySTL } from '../solids.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const wasm = await Module(); wasm.setup();
const K = createSolidKit(wasm);
const f = n => (typeof n === 'number' ? n.toFixed(3) : n);

let t = performance.now();
const d = buildDesign(DEFAULTS);
console.log('curves valid', d.curves.valid, 'sections', d.sections.length, 'rows', d.rows.length, 'hullRows', d.hullRows.length, `(${(performance.now() - t).toFixed(0)} ms)`);
console.log('stem ends', d.curves.stem[0].map(f), d.curves.stem.at(-1).map(f), 'keel end', d.curves.keel.at(-1).map(f));
for (const i of [0, 5, 10, 15, 20]) { const s = d.sections[i]; console.log(`station ${i} x=${f(s.x)} keelZ=${f(s.zk)} angle=${f(s.angle)} top=${s.pts[0].map(f)} keel=${s.pts.at(-1).map(f)}`); }

t = performance.now();
const r = K.build(d);
console.log('manifold build', (performance.now() - t).toFixed(0), 'ms; hull in3', f(r.hullVolume), 'shell in3', f(r.shellVolume), 'blocks', r.blocks.length, r.mold);

t = performance.now();
const A = analyze(d.p, r.hullSoup, r.shellSoup, sheerRing(d.hullRows), { endVoidIn3: r.endVoidIn3 });
console.log('analysis', (performance.now() - t).toFixed(0), 'ms');
const { loaded, empty, gz, swamp, speed } = A;
console.log('hull weight lb', f(A.hullWeight), 'total', f(A.totalWeight), 'G', A.G.map(f));
for (const L of [loaded, empty]) console.log(L.label, { draft: f(L.draft), freeboard: f(L.freeboard), LWL: f(L.LWL), BWL: f(L.BWL), Cb: f(L.Cb), Cp: f(L.Cp), Cwp: f(L.Cwp), KB: f(L.KB), BMt: f(L.BMt), KG: f(L.KG), GMt: f(L.GMt), wetted: f(L.wetted), Am: f(L.Am) });
console.log('GZ', gz.map(g => `${g[0]}:${g[1].toFixed(2)}`).join(' '), 'downflood', A.downflood, 'vanishing', A.vanishing);
console.log('swamp', swamp, 'speed', speed);

const S = A.slalom; console.log('end void ft3', (A.endVoidIn3/1728).toFixed(3), 'coed', { fbMin: A.coed.minFreeboard.toFixed(2), fbMid: A.coed.midFreeboard.toFixed(2), run: A.coed.letterRun.toFixed(1), span: A.coed.letterSpan });
console.log('slalom', { W: S.weight.toFixed(1), pos: S.positions.map(x=>x.toFixed(1)), Mmax: S.Mmax.toFixed(0), x: S.xMmax.toFixed(1), sag: S.sagging, Vmax: S.Vmax.toFixed(1), A: S.section.A.toFixed(2), zNA: S.section.zNA.toFixed(2), I: S.section.I.toFixed(1), stress: S.stress, punch: S.punching });
// sanity: box-like check of submerged volume = displacement
console.log('check displacement lb', f(loaded.displacementIn3 * 62.4 / 1728), 'vs', f(A.totalWeight));

mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
writeFileSync(new URL('./out/hull.stl', import.meta.url), Buffer.from(toBinarySTL(r.hullSoup)));
writeFileSync(new URL('./out/shell.stl', import.meta.url), Buffer.from(toBinarySTL(r.shellSoup)));
console.log('wrote test/out/*.stl');
