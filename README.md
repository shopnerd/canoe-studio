# Canoe Studio

Browser version of `canoe_script_012226.gh` (the team's Grasshopper concrete-canoe definition) plus analysis tools. No build step, vanilla JS, runs entirely client-side.

Live: https://shopnerd.github.io/canoe-studio/

Run locally: `npx http-server . -a 127.0.0.1 -p 8917 -c-1` → http://127.0.0.1:8917/ (needs a server — module worker + WASM).
Headless check: `node test/core-test.mjs` (builds the default design, prints hydrostatics, writes test/out/*.stl).

## Files
- `hull.js` — design core (pure math, Node + browser): PARAMS (defaults/ranges from the .gh), curves, station sections, loft, clipping, triangle soups, hydrostatics (`submerged`, `solveDraft`, `sectionArea`, `sliceLoops`, `analyze`).
- `solids.js` — Manifold 3.5.3 booleans: hull solid, concrete shell (hull − inward offset), stern chop, mold blocks; binary STL + store-only ZIP writers.
- `rules.js` — competition rule checks keyed by year (2027 = RFP issued 2026-09-08; the PDF is linked from the app, not redistributed). New RFP or addendum → add a year entry; nothing else hard-codes rules.
- `worker.js` — runs solids + analysis off the main thread.
- `app.js` — UI: parameter panel, three.js viewer, draggable 2D curve editors, analysis + build tabs, exports, undo, share link, localStorage.
- `test/ghparse.py`, `test/graph.py`, `test/graph.txt` — decoder for the .gh binary (GH_IO) and the dumped component graph the port was built from.

## How the .gh maps
1. **Curve generation** — cross section (YZ), profile = stem + keel split at the forefoot (XZ), plan/top curve (XY at z=H), sheer/top rocker (XZ). Interpolate(t) with chord knots → `interpolate()`. Validation boxes → `curves.valid` (flagged, not nulled).
2. **Canoe lofting** — stem moved to origin and rotated 90°; N+1 stations along the keel; Tween(cross section → stem, t=i/N); placed on keel; rotated −90°·min(i/nRot,1) about Z at the keel point; top extended to z=H; Y-scaled so width at z=H = plan curve closest point. Catmull-Rom loft, mirrored.
3. **Final shaping** — trim to sheer (min(H, sheer(x))), stern chop (Manifold trimByPlane), shell = hull − inner (offset along normals, clipped at y=0, raised lip).
4. **Mold blocks** — n×rows boxes trimmed at H+zOffset, minus canoe (flat top, moved up zOffset; X-aligned to one block in when chopped).

## Interpretations (not verifiable without Rhino)
- Top-rocker tangent: the .gh has end tangent −X at the bow end with points running midship→bow (would hook); we use a horizontal tangent at midship instead.
- The .gh's two List Items after "Split with Breps" both read index 0; we take stem = bow piece, keel = midship piece (matches how they're used downstream).
- Shell faces removed in the .gh are picked by sorted face centroid; we simply open the deck (and the chopped end).
- Analysis (not in the .gh): fresh water, paddlers as a centerline point mass, GZ with fixed CG, ITTC-57 friction only.

## 2027 rules integration (added 2026-09-13)
- Checks: 6.1.1 wall ≤ ½ in (+⅛ tol) · 6.2.2 names visible with 4 co-ed paddlers → freeboard ≥ 1 + 5 + ¼ = 6.25 in over the lettering run · 6.6.1 swamp test · 6.6 foam only within 36 in of tips (hollow volume computed with Manifold) · Ex.5 oven-dried < 80.0 pcf, reinforcement ≤ 50% of thickness, POA ≥ 40% · 5.7.1 3-person endurance slalom beam (shear/moment, exact section I, stresses with/without FS) + ACI two-way punching · 6.2.1 no CNC/3D-printed molds (info) · Ex.8 seats ≤ 20 in.
- 6.2.1 means the script's printed mold blocks can't be the competition mold. Hand hot-wire along CNC-cut templates is allowed ("jigs or templates"); a CNC hot-wire machine is not. Build & export → "Hot-wire templates" gives a profile at every block joint.
- Beam model: level trim, buoyancy per strip scaled to close equilibrium, moment residual removed linearly. The RFP wants hand-calculated section properties in the Calculation Package — the app is a cross-check.
- Not checked: mix design proportions (c/cm, C595 share, aggregate %), which live in the RFP's Excel templates.
