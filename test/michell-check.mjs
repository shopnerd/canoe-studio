// Validates michellRw against Michell (1898) worked example, reproduced in Tuck (1989), ANZIAM J. B 30:365-377.
// Hull y = ±c(1+cos ax)(1+cos bz); length 2π/a = 200 ft, draft π/b = 20 ft, max breadth 8c = 32 ft, U = 20 ft/s → R ≈ 940 lb wt.
import { michellRw } from '../hull.js';
const FT = 0.3048, LBF = 4.44822;
const L = 200 * FT, D = 20 * FT, c = 4 * FT, a = 2 * Math.PI / L, b = Math.PI / D, U = 20 * FT;
function grid(nx, nz) {
  const hx = L / nx, hz = D / nz, x0 = -L / 2, f = new Float64Array((nx + 1) * (nz + 1));
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) f[i * (nz + 1) + j] = c * (1 + Math.cos(a * (x0 + i * hx))) * (1 + Math.cos(b * j * hz));
  return { nx, nz, hx, hz, x0, f };
}
for (const [nx, nz, nt] of [[60, 10, 400], [120, 20, 1200], [240, 40, 2400]]) {
  const off = grid(nx, nz);
  const fresh = michellRw(off, U, 998.2) / LBF, sea = michellRw(off, U, 1025) / LBF;
  console.log(`grid ${nx}x${nz}, θ ${nt}: R = ${fresh.toFixed(0)} lbf fresh, ${sea.toFixed(0)} lbf sea  (Michell: ≈940; Tuck's integral 0.6157 vs Michell's 0.620 → ≈933)`);
}
