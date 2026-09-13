// rules.js — competition rule checks, one entry per competition year.
// Source for 2027: ASCE Committee on Concrete Canoe Competitions (C4), "Request for Proposals — 2026-2027
// Concrete Canoe", issued September 8, 2026. A copy is kept at test/rfp2027.pdf.
// When a new RFP (or an addendum) comes out, add a new entry here — nothing else in the app hard-codes rules.

export const RULESETS = {
  2027: {
    year: 2027,
    title: '2026–27 ASCE Concrete Canoe Competition',
    finals: 'Society-wide Finals · Kansas State University, Manhattan, KS · June 17–19, 2027',
    issued: 'RFP issued September 8, 2026',
    url: 'https://www.asce.org/-/media/asce-images-and-files/communities/students-and-younger-members/documents/2026-2027-asce-concrete-canoe-competition-request-for-proposals.pdf',
    limits: {
      maxWall: 0.5, wallTol: 0.125,        // 6.1.1
      maxUnitWeight: 80.0,                 // Exhibit 5, oven-dried pcf
      maxReinfRatio: 0.5, minPOA: 40,      // Exhibit 5
      letterTopBelowGunwale: 1, letterHeight: 5, letterTol: 0.25, // 6.7.1 → freeboard for names (6.2.2)
      foamZone: 36,                        // 6.6, in from each tip
      seatMax: 20,                         // Exhibit 8, seats ≤ 20 × 20 × 20 in
    },
    dates: [
      ['Kick-off webinar', 'Sep 24, 2026'], ['Mix design webinar', 'Oct 8, 2026'], ['Letter of Intent & Qualifications', 'Nov 2, 2026'],
      ['Last day for RFIs', 'Jan 25, 2027'], ['Deliverables due (Symposia)', 'Feb 11, 2027'], ['Student Symposia', 'Mar – Apr 2027'],
      ['Deliverables due (Finals)', 'May 11, 2027'], ['Society-wide Finals', 'Jun 17–19, 2027'],
    ],
    races: [
      'Symposia: co-ed 200 m slalom (2), women’s & men’s 200 m sprint (2 each), co-ed 200 m sprint (4)',
      'Finals: co-ed 600 m endurance slalom (3), women’s & men’s 200 m sprint, co-ed 200 m heats & 400 m final (4)',
    ],
  },
};

// status: 'pass' | 'warn' | 'fail' | 'info'
export function checkRules(year, p, a) {
  const R = RULESETS[year], L = R.limits, out = [];
  const add = (ref, title, status, detail) => out.push({ ref, title, status, detail });
  const f = (v, d = 2) => Number(v).toFixed(d);

  // 6.1.1 hull thickness
  const tMax = L.maxWall + L.wallTol;
  add('6.1.1', 'Hull thickness ≤ ½ in (+⅛ in tolerance)',
    p.wall <= L.maxWall + 1e-9 ? 'pass' : p.wall <= tMax + 1e-9 ? 'warn' : 'fail',
    p.wall <= L.maxWall + 1e-9 ? `Wall ${f(p.wall, 3)} in.` : p.wall <= tMax + 1e-9 ? `Wall ${f(p.wall, 3)} in is inside the ⅛ in tolerance only — no margin for thick spots at the weigh-in caliper check.` : `Wall ${f(p.wall, 3)} in exceeds ${f(tMax, 3)} in. Ribs and gunwales are excluded, the hull wall is not.`);

  // 6.2.2 freeboard, four-person co-ed loading, names visible
  const c = a.coed, need = L.letterTopBelowGunwale + L.letterHeight + L.letterTol;
  if (c.sunk) add('6.2.2', 'Freeboard with 4 co-ed paddlers', 'fail', 'The hull sinks under four-person loading.');
  else {
    const ok = c.letterRun >= p.letterLength;
    add('6.2.2', `Names above water with 4 paddlers (≥ ${f(need, 2)} in freeboard)`,
      c.minFreeboard >= need ? 'pass' : ok ? 'warn' : 'fail',
      `At ${f(c.weight, 0)} lb (hull + 4 × ${p.crewWeight} lb) the lowest gunwale sits ${f(c.minFreeboard)} in above water, ${f(c.midFreeboard)} in at midship. ` +
      (c.minFreeboard >= need ? 'Names fit anywhere along the hull.' :
        ok ? `Only ${f(c.letterRun, 0)} in of gunwale clears ${f(need, 2)} in — place the names there (needed ${p.letterLength} in).` :
          `Only ${f(c.letterRun, 0)} in of gunwale clears ${f(need, 2)} in, but the names need ${p.letterLength} in. Penalty: 30 s on the co-ed sprint.`));
  }

  // 6.6 flotation test + foam zone
  const s = a.swamp;
  const foamIn3 = p.foam * 1728, voidIn3 = a.endVoidIn3;
  add('6.6.1', 'Flotation (swamp) test',
    s.floats ? 'pass' : 'fail',
    s.floats ? `Swamped, it floats with ${f(s.margin, 1)} lb to spare (concrete + ${f(p.foam, 2)} ft³ foam).`
      : `Swamped, it is ${f(-s.margin, 1)} lb short. Add about ${f(s.foamNeededFt3, 2)} ft³ of foam in the end bulkheads, or lighten the concrete below 62.4 pcf.`);
  if (voidIn3 !== null) {
    const needIn3 = Math.max(foamIn3, s.floats ? 0 : s.foamNeededFt3 * 1728);
    add('6.6', `Foam fits within ${L.foamZone / 12} ft of bow and stern`,
      needIn3 === 0 ? 'info' : needIn3 <= voidIn3 ? 'pass' : 'fail',
      `Hollow space inside the last ${L.foamZone} in of both ends: ${f(voidIn3 / 1728, 2)} ft³. ` +
      (needIn3 === 0 ? 'No foam needed at these inputs.' : `Foam needed: ${f(needIn3 / 1728, 2)} ft³ — ${needIn3 <= voidIn3 ? 'it fits' : 'it does not fit; the hull has to float on its own design'}. Foam must be encased in concrete.`));
  }

  // Exhibit 5 materials
  add('Ex. 5', `Oven-dried unit weight < ${f(L.maxUnitWeight, 1)} pcf`,
    p.concreteDensity < L.maxUnitWeight ? 'pass' : 'fail',
    `Using ${f(p.concreteDensity, 1)} pcf. The limit is on the oven-dried unit weight of every mix (max two mixes).`);
  const ratio = p.wall > 0 ? p.reinfThk / p.wall : 1;
  add('Ex. 5', 'Reinforcement ≤ 50% of composite thickness',
    ratio <= L.maxReinfRatio + 1e-9 ? 'pass' : 'fail',
    `${f(p.reinfThk, 3)} in of reinforcement in a ${f(p.wall, 3)} in wall = ${f(ratio * 100, 0)}%.`);
  add('Ex. 5', `Each reinforcement layer ≥ ${L.minPOA}% open area`,
    p.poa >= L.minPOA ? 'pass' : 'fail', `Mesh POA ${f(p.poa, 0)}%.`);

  // 5.7.1 structure — informs, and flags when demand/capacity > 1 with the team's inputs
  const st = a.slalom.stress, pu = a.slalom.punching;
  const worst = Math.max(st.dcrTension, st.dcrCompression, pu.dcr);
  add('5.7.1', '3-person endurance slalom: bending & punching shear',
    worst > 1 ? 'fail' : worst > 0.8 ? 'warn' : 'pass',
    `With FS ${f(p.fs, 1)}: tension ${f(st.tensionFS, 0)} of ${f(p.ft, 0)} psi, compression ${f(st.compressionFS, 0)} of ${f(p.fc, 0)} psi, punching ${f(pu.vuFS, 0)} of φvc ${f(pu.phiVc, 0)} psi. Strengths are your inputs — replace the placeholders with test data.`);

  // 6.2.1 molds
  add('6.2.1', 'Mold built by hand — no CNC or 3D printing', 'info',
    'CNC mills, routers, laser cutters, water jets and 3D printers can’t make the mold — and a CNC hot-wire cutter falls under “not limited to”. CNC-made jigs and templates are allowed, so laser-cut the hot-wire templates (Build & export) and cut the foam blocks by hand along them. Printed mold blocks are for practice pieces only. Confirm your exact process with an RFI before Jan 25, 2027.');

  // Exhibit 8 seats
  add('Ex. 8', 'Seats ≤ 20 × 20 × 20 in', p.crewCG > L.seatMax + 12 ? 'warn' : 'info',
    `Paddler CG set at ${f(p.crewCG, 1)} in above the keel.` + (p.crewCG > L.seatMax + 12 ? ' That is higher than a 20 in seat allows.' : ''));
  return out;
}
