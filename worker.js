// worker.js — Manifold booleans + hydrostatics off the main thread.
import Module from './vendor/manifold.js';
import { buildDesign, resistanceCurve } from './hull.js';
import { createSolidKit, sheerRing, analyze } from './solids.js';

let K = null;
const ready = (async () => {
  const wasm = await Module({ locateFile: f => new URL('./vendor/' + f, import.meta.url).href });
  wasm.setup();
  K = createSolidKit(wasm);
})();

onmessage = async e => {
  const m = e.data;
  try {
    await ready;
    if (m.type === 'print') {
      const design = buildDesign(m.params);
      const res = K.buildPrint(design, m.opts);
      postMessage({ id: m.id, type: 'printed', res }, res.segments.map(g => g.soup.buffer));
      return;
    }
    if (m.type === 'foam') {
      const design = buildDesign(m.params);
      const res = K.buildFoam(design);
      postMessage({ id: m.id, type: 'foamed', res }, res.foamSoup ? [res.foamSoup.buffer, res.capSoup.buffer] : []);
      return;
    }
    if (m.type === 'build') {
      const t0 = performance.now();
      const design = buildDesign(m.params);
      const solids = K.build(design, { mold: m.mold });
      const t1 = performance.now();
      const analysis = analyze(design.p, solids.hullSoup, solids.shellSoup, sheerRing(design.hullRows), { endVoidIn3: solids.endVoidIn3 });
      try { analysis.resist = analysis.loaded.sunk ? null : resistanceCurve(design.p, solids.hullSoup, analysis.loaded); } catch (e) { analysis.resist = null; analysis.resistError = e.message; }
      const t2 = performance.now();
      // every soup comes from its own toSoup() call, so all buffers are distinct
      const transfer = [solids.hullSoup, solids.shellSoup, solids.printHullSoup, solids.printShellSoup, ...solids.blocks.map(b => b.soup)].map(s => s.buffer);
      postMessage({ id: m.id, type: 'built', solids, analysis, ms: { solids: t1 - t0, analysis: t2 - t1 } }, transfer);
    }
  } catch (err) {
    postMessage({ id: m.id, type: 'error', message: err.message || String(err) });
  }
};
postMessage({ type: 'boot' });
