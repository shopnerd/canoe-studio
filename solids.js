// solids.js — Manifold (WASM) booleans: watertight hull, concrete shell, mold blocks, STL/ZIP writers.
// Isomorphic: used by worker.js in the browser and by test/core-test.mjs in Node.
import { rowsToSoup, innerRows, analyze, massProps } from './hull.js';

export function createSolidKit(wasm) {
  const { Manifold, Mesh } = wasm;

  function fromSoup(pos, tol = 2e-6) {
    const nTri = pos.length / 9;
    let mx = 1e-9; for (let i = 0; i < pos.length; i++) mx = Math.max(mx, Math.abs(pos[i]));
    const q = mx * tol;
    const key = new Map(), verts = [], tri = new Uint32Array(nTri * 3);
    for (let i = 0; i < nTri * 3; i++) {
      const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
      const k = Math.round(x / q) + ',' + Math.round(y / q) + ',' + Math.round(z / q);
      let idx = key.get(k);
      if (idx === undefined) { idx = verts.length / 3; key.set(k, idx); verts.push(x, y, z); }
      tri[i] = idx;
    }
    const keep = [];
    for (let t = 0; t < nTri; t++) {
      const a = tri[3 * t], b = tri[3 * t + 1], c = tri[3 * t + 2];
      if (a !== b && b !== c && a !== c) keep.push(a, b, c);
    }
    const mesh = new Mesh({ numProp: 3, vertProperties: new Float32Array(verts), triVerts: new Uint32Array(keep) });
    mesh.merge();
    const m = new Manifold(mesh);
    const st = m.status();
    if (st && st !== 'NoError' && st.value !== 0) throw new Error('Hull mesh is not a closed solid (' + (st.constructor?.name || st) + ')');
    return m;
  }

  function toSoup(m) {
    const mesh = m.getMesh();
    const np = mesh.numProp, vp = mesh.vertProperties, tv = mesh.triVerts;
    const out = new Float32Array(mesh.numTri * 9);
    for (let t = 0; t < mesh.numTri; t++) for (let c = 0; c < 3; c++) {
      const v = tv[3 * t + c] * np;
      out[9 * t + 3 * c] = vp[v]; out[9 * t + 3 * c + 1] = vp[v + 1]; out[9 * t + 3 * c + 2] = vp[v + 2];
    }
    return out;
  }

  // design = buildDesign(...) output. Returns plain data (soups + numbers) safe to postMessage.
  function build(design, { mold = true } = {}) {
    const { p, hullRows, moldRows } = design;
    const H = p.height, L2 = p.length / 2;
    const garbage = [];
    const keep = m => (garbage.push(m), m);

    const hull = keep(fromSoup(rowsToSoup(hullRows)));
    const inner = keep(fromSoup(rowsToSoup(innerRows(hullRows, p.wall, H + 4))));
    const shell = keep(hull.subtract(inner));
    // hollow space inside the hull within 36 in of each tip — where 2027 rules allow flotation foam
    const zone = 36, big = Math.max(p.width, H) * 4;
    const bowBox = keep(Manifold.cube([zone + 10, big, big]).translate([L2 - zone, -big / 2, -big / 4]));
    const bowVoid = keep(keep(hull.intersect(inner)).intersect(bowBox));
    const endVoidIn3 = 2 * bowVoid.volume(); // the stern is the mirror image

    const chop = p.endChop > 0 ? -L2 + p.endChop : null;
    const hullC = chop === null ? hull : keep(hull.trimByPlane([1, 0, 0], chop));
    const shellC = chop === null ? shell : keep(shell.trimByPlane([1, 0, 0], chop));

    const out = {
      hullSoup: toSoup(hull), shellSoup: toSoup(shell),
      printHullSoup: toSoup(hullC), printShellSoup: toSoup(shellC),
      hullVolume: hull.volume(), shellVolume: shell.volume(),
      printShellVolume: shellC.volume(), endVoidIn3,
      blocks: [],
    };

    if (mold) {
      let canoe = keep(fromSoup(rowsToSoup(moldRows)));
      if (chop !== null) canoe = keep(canoe.trimByPlane([1, 0, 0], chop));
      const n = Math.round(p.blocksPerRow), rows = Math.round(p.rows);
      const bw = p.blockW, bd = p.blockD, bh = Math.min(p.blockH, H + p.zOffset);
      let dx = 0;
      if (chop !== null) dx = (-(bw * n / 2) + bw) - canoe.boundingBox().min[0];
      const cutter = keep(canoe.translate([dx, 0, p.zOffset]));
      out.moldOffset = [dx, 0, p.zOffset];
      let blockVol = 0, cavityVol = 0;
      for (let iy = 0; iy < rows; iy++) for (let ix = 0; ix < n; ix++) {
        const x0 = -n * bw / 2 + ix * bw, y0 = -rows * bd / 2 + iy * bd;
        const box = keep(Manifold.cube([bw, bd, bh]).translate([x0, y0, 0]));
        const cut = keep(box.subtract(cutter));
        const v = cut.volume();
        blockVol += v; cavityVol += bw * bd * bh - v;
        if (v > 1e-6) out.blocks.push({ name: `block-r${iy + 1}-c${String(ix + 1).padStart(2, '0')}`, soup: toSoup(cut), volume: v, touched: bw * bd * bh - v > 1e-3 });
      }
      out.mold = { count: out.blocks.length, blockVolume: blockVol, cavityVolume: cavityVol, blockHeight: bh, arrayLength: n * bw, arrayWidth: rows * bd,
        fitsLength: p.length - (p.endChop || 0) <= n * bw - (chop !== null ? bw : 0) + 1e-6, fitsWidth: p.width <= rows * bd };
    }
    for (const m of garbage) try { m.delete(); } catch { /* already freed */ }
    return out;
  }

  return { fromSoup, toSoup, build };
}

export function sheerRing(hullRows) {
  const ring = [];
  for (const r of hullRows) { ring.push(r[0]); ring.push([r[0][0], -r[0][1], r[0][2]]); }
  return ring;
}

export { analyze, massProps };

// ─── Writers ────────────────────────────────────────────────────────────────────────────
export function toBinarySTL(soup, name = 'canoe', scale = 1) {
  const nTri = soup.length / 9;
  const buf = new ArrayBuffer(84 + nTri * 50);
  const dv = new DataView(buf);
  new Uint8Array(buf, 0, 80).set(new TextEncoder().encode(('canoe-studio: ' + name).slice(0, 80)));
  dv.setUint32(80, nTri, true);
  let o = 84;
  for (let t = 0; t < nTri; t++) {
    const i = 9 * t;
    const ax = soup[i], ay = soup[i + 1], az = soup[i + 2], bx = soup[i + 3], by = soup[i + 4], bz = soup[i + 5], cx = soup[i + 6], cy = soup[i + 7], cz = soup[i + 8];
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay), ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az), nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const l = Math.hypot(nx, ny, nz) || 1;
    dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
    for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + 4 * k, soup[i + k] * scale, true);
    dv.setUint16(o + 48, 0, true);
    o += 50;
  }
  return buf;
}

// Minimal store-only ZIP (no compression) so a set of mold blocks downloads as one file.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
export function makeZip(files) { // files: [{name, data: ArrayBuffer|Uint8Array}]
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
    const name = enc.encode(f.name), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, u) => s + u.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
