import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveConfig } from '../derive.js';
import { buildGeometry, heightAt, lowestAt, planeOf, runwayModel } from '../geometry.js';
import { RULE_STATUS } from '../rule_status.js';

const std = JSON.parse(readFileSync(new URL('../../data/ols_standards.json', import.meta.url)));

const A_IN = { arfl: 2800, wingspan: 60, vat: 145, runwayWidth: 45, approach: 'PA I' };
const A_RW = { length: 3000, ends: [{ elevation: 10 }, { elevation: 10 }] };
const B_IN = { arfl: 1000, wingspan: 12, vat: 80, runwayWidth: 18, approach: 'NI', mtomOver5700: false };
const B_RW = { length: 1000, ends: [{ elevation: 100 }, { elevation: 100 }] };
// Sloping runway: THR 1 at 10 m, THR 2 at 16 m, aerodrome elevation 18 m.
const SLOPE_RW = { length: 2000, aerodromeElevation: 18, ends: [{ elevation: 10 }, { elevation: 16 }] };

const geo = (input, rw) => buildGeometry(std, deriveConfig(input, std), rw);
const surf = (g, id) => [...g.legacy, ...g.new].find(s => s.id === id);
const inst = (g, id, d = 1) => surf(g, id).instances.find(i => i.direction === (surf(g, id).instances[0].direction === null ? null : d));
const pt = (g, id, label, d = 1) => inst(g, id, d).points.find(p => p.label === label).p;
const near = (a, b, tol = 1e-6, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b}, got ${a}`);
const zAt = (g, id, x, y, d = 1) => heightAt(inst(g, id, d).facets, x, y);

const A = geo(A_IN, A_RW), B = geo(B_IN, B_RW);

test('every facet is planar (all samples, both regimes)', () => {
  for (const g of [A, B, geo(A_IN, SLOPE_RW), geo({ ...A_IN, approach: 'NPA', circlingOrCircuits: false }, SLOPE_RW)]) {
    for (const s of [...g.legacy, ...g.new]) for (const i of s.instances) for (const f of i.facets) {
      const { n, c } = planeOf(f.v);
      for (const p of f.v) {
        const d = Math.abs((p[0] - c[0]) * n[0] + (p[1] - c[1]) * n[1] + (p[2] - c[2]) * n[2]);
        assert.ok(d < 1e-6, `${s.id} off plane by ${d}`);
      }
    }
  }
});

test('runway model: thresholds, ends, strip ends, profile', () => {
  const m = runwayModel({ length: 2000, ends: [{ elevation: 10, displaced: 200 }, { elevation: 16, stripExtension: 30 }] });
  assert.equal(m.Lt, 1800);
  assert.deepEqual(m.endX, [-200, 1800]);
  assert.deepEqual(m.stripEndX, [-260, 1830]);
  assert.equal(m.profile(900), 13);
  assert.equal(m.profile(-500), 10); // level beyond the thresholds
  assert.equal(m.aerodromeElevation, 16);
});

// ---------- legacy, Sample A (PA I-3/4) ----------

test('legacy approach PA I-3/4: L-b horizontal at 150 m, 15 000 m total', () => {
  const s = surf(A, 'legacy_approach');
  assert.ok(s.geomRules.includes('L-b'));
  const e = inst(A, 'legacy_approach').extents;
  near(e.secondLength, 3600); near(e.horizontalLength, 8400); near(e.totalLength, 15000);
  assert.deepEqual(pt(A, 'legacy_approach', 'End of section 1, CL'), [-3060, 0, 70]);
  assert.deepEqual(pt(A, 'legacy_approach', 'End of section 2, CL').map(v => +v.toFixed(6)), [-6660, 0, 160]);
  assert.deepEqual(pt(A, 'legacy_approach', 'Outer edge, corner').map(v => +v.toFixed(6)), [-15060, 2390, 160]);
  near(zAt(A, 'legacy_approach', -1060, 0), 30, 1e-9, '1 000 m out at 2%');
});

test('legacy approach PA I-1/2 has no horizontal section (12 000 m at 3%)', () => {
  const g = geo({ ...A_IN, arfl: 1000 }, A_RW);
  const e = inst(g, 'legacy_approach').extents;
  assert.equal(e.secondLength, 12000);
  assert.equal(e.horizontalLength, undefined);
  near(pt(g, 'legacy_approach', 'Outer edge, CL')[2], 10 + 75 + 360);
});

test('legacy inner horizontal and conical: arcs on strip ends, above aerodrome elevation', () => {
  assert.deepEqual(pt(A, 'legacy_inner_horizontal', 'Outer edge on extended CL beyond strip end 1'), [-4060, 0, 55]);
  assert.deepEqual(pt(A, 'legacy_conical', 'Outer edge on extended CL beyond strip end 1'), [-6060, 0, 155]);
  near(zAt(A, 'legacy_conical', -5060, 0), 105, 1e-6, 'conical half way');
  const g = geo(A_IN, SLOPE_RW);
  near(pt(g, 'legacy_inner_horizontal', 'Outer edge abeam runway mid point')[2], 18 + 45);
});

test('legacy transitional: 14.3% from strip edge to IHS, follows approach side', () => {
  near(zAt(A, 'legacy_transitional', 0, 140 + 100), 10 + 14.3, 1e-9);
  near(pt(A, 'legacy_transitional', 'Upper edge abeam threshold 1')[1], 140 + 45 / 0.143, 1e-9);
  // 1 000 m out the approach edge is at 140 + 150 = 290 m and 30 m high; 100 m further out laterally:
  near(zAt(A, 'legacy_transitional', -1060, 390), 30 + 14.3, 1e-9);
});

test('legacy transitional is continuous across the approach / strip join', () => {
  for (const y of [200, 300, 400]) {
    near(zAt(A, 'legacy_transitional', -60 - 1e-6, y), zAt(A, 'legacy_transitional', -60 + 1e-6, y), 1e-4);
  }
});

test('legacy balked landing: 1 800 m (L-d caps at runway end), top in IHS', () => {
  assert.deepEqual(pt(A, 'legacy_balked_landing', 'Inner edge, CL'), [1800, 0, 10]);
  near(pt(A, 'legacy_balked_landing', 'Outer edge, corner')[2], 55);
  const short = geo(A_IN, { length: 1500, ends: [{ elevation: 10 }, { elevation: 10 }] });
  assert.ok(surf(short, 'legacy_balked_landing').geomRules.includes('L-d'));
  assert.equal(pt(short, 'legacy_balked_landing', 'Inner edge, CL')[0], 1500);
  assert.ok(!surf(A, 'legacy_balked_landing').geomRules.includes('L-d'));
});

test('legacy balked landing PA I-1/2: inner edge at end of strip (L-c)', () => {
  const g = geo({ ...A_IN, arfl: 1000 }, { length: 1100, ends: [{ elevation: 10 }, { elevation: 10, stripExtension: 60 }] });
  assert.ok(surf(g, 'legacy_balked_landing').geomRules.includes('L-c'));
  assert.equal(pt(g, 'legacy_balked_landing', 'Inner edge, CL')[0], 1160);
});

test('legacy inner transitional runs to the balked landing then up its side', () => {
  near(zAt(A, 'legacy_inner_transitional', 1000, 60 + 30), 10 + 30 * 0.333, 1e-9);
  assert.equal(inst(A, 'legacy_inner_transitional').extents.alongStripTo, 1800);
});

test('legacy take-off climb: 60 m beyond end, clearway moves it (L-T2b), final width', () => {
  assert.deepEqual(pt(A, 'legacy_take_off_climb', 'Inner edge, CL'), [3060, 0, 10]);
  near(pt(A, 'legacy_take_off_climb', 'Reaches final width')[0], 3060 + (600 - 90) / 0.125);
  const g = geo(A_IN, { length: 3000, ends: [{ elevation: 10 }, { elevation: 10, clearway: 300 }] });
  assert.ok(surf(g, 'legacy_take_off_climb').geomRules.includes('L-T2b'));
  assert.equal(pt(g, 'legacy_take_off_climb', 'Inner edge, CL')[0], 3300);
  const turn = geo({ ...A_IN, departureTurn: true }, A_RW);
  near(pt(turn, 'legacy_take_off_climb', 'Reaches final width')[1], 900);
});

// ---------- new, Sample A (ADG IV precision) ----------

test('OFS approach ADG IV instrument: 185 m, 10%, 4 500 m at 3.33%', () => {
  assert.deepEqual(pt(A, 'ofs_approach', 'Outer edge, corner').map(v => +v.toFixed(6)), [-4560, 542.5, 159.85]);
});

test('OFS tops are 60 m above the highest threshold (sloping runway)', () => {
  const g = geo(A_IN, SLOPE_RW);
  near(pt(g, 'ofs_transitional', 'Upper edge abeam threshold 1')[2], 76);
  near(pt(g, 'ofs_balked_landing', 'Outer edge, corner', 1)[2], 76);
  near(pt(g, 'ofs_balked_landing', 'Outer edge, corner', 2)[2], 76);
  near(Math.abs(pt(g, 'ofs_inner_transitional', 'Upper edge abeam threshold', 2)[1]), 60 + (76 - 16) / 0.333, 1e-9);
});

test('OFS transitional lower edge follows the runway profile (decision 11)', () => {
  const g = geo(A_IN, SLOPE_RW);
  near(zAt(g, 'ofs_transitional', 1000, 92.5 + 50), 13 + 10, 1e-9); // mid runway 13 m, plus 50 m at 20%
});

test('OFS inner approach starts at the approach inner edge with the approach slope (N3)', () => {
  near(pt(A, 'ofs_inner_approach', 'Outer edge, corner')[0], -60 - 1350);
  near(pt(A, 'ofs_inner_approach', 'Outer edge, corner')[2], 10 + 1350 * 0.0333);
});

test('OFS balked landing: 1 800 m or runway end (N-BL-b); end of strip for ADG I-IIB (N-BL-a)', () => {
  assert.deepEqual(pt(A, 'ofs_balked_landing', 'Inner edge, CL'), [1800, 0, 10]);
  const short = geo(A_IN, { length: 1500, ends: [{ elevation: 10 }, { elevation: 10 }] });
  assert.ok(surf(short, 'ofs_balked_landing').geomRules.includes('N-BL-b'));
  assert.equal(pt(short, 'ofs_balked_landing', 'Inner edge, CL')[0], 1500);
  const small = geo({ ...A_IN, wingspan: 20, vat: 100, arfl: 1300 }, A_RW); // ADG IIB
  assert.ok(surf(small, 'ofs_balked_landing').geomRules.includes('N-BL-a'));
  assert.equal(pt(small, 'ofs_balked_landing', 'Inner edge, CL')[0], 3060);
});

test('OFS inner transitional PA: no vertical section, to balked landing (N-IT-PA)', () => {
  const s = surf(A, 'ofs_inner_transitional');
  assert.ok(s.geomRules.includes('N-IT-PA'));
  assert.ok(!inst(A, 'ofs_inner_transitional').facets.some(f => f.vertical));
});

test('precision approach OES: 300 m at both outer edges, transitional to 300 m', () => {
  near(pt(A, 'oes_precision', 'Approach end of 1st section, CL')[2], 70);
  near(pt(A, 'oes_precision', 'Approach outer edge, CL')[2], 310);
  assert.equal(pt(A, 'oes_precision', 'Approach outer edge, CL')[0], -12660);
  near(pt(A, 'oes_precision', 'Missed approach outer edge, CL')[2], 310);
  near(zAt(A, 'oes_precision', 400, 0), 10, 1e-9, 'lower component at threshold elevation');
  near(zAt(A, 'oes_precision', 400, 150 + 100), 10 + 14.3, 1e-9);
});

test('instrument departure OES: 5 m above CL at end of TODA, 15° then 30° splay, ends 300 m up', () => {
  assert.deepEqual(pt(A, 'oes_departure', 'Inner edge, CL (end of TODA)'), [3000, 0, 15]);
  const c = pt(A, 'oes_departure', 'End of 1st section, corner');
  near(c[1], 150 + 3500 * 0.268, 1e-9);
  near(pt(A, 'oes_departure', 'Outer edge, corner')[2], 310, 1e-9);
});

test('take-off climb OES >5 700 kg starts at end of TODA', () => {
  assert.deepEqual(pt(A, 'oes_take_off_climb', 'Inner edge, CL'), [3000, 0, 10]);
  const g = geo(A_IN, { length: 3000, ends: [{ elevation: 10 }, { elevation: 10, clearway: 200 }] });
  assert.equal(pt(g, 'oes_take_off_climb', 'Inner edge, CL')[0], 3200);
});

test('horizontal OES: arcs on thresholds, above aerodrome elevation', () => {
  assert.deepEqual(pt(A, 'oes_horizontal', 'Outer edge on extended CL beyond threshold 1'), [-10750, 0, 100]);
});

// ---------- new and legacy, Sample B (code 2 NI, ADG I) ----------

test('Sample B: legacy NI-2 and OFS NI ADG I approach dimensions', () => {
  assert.deepEqual(pt(B, 'legacy_approach', 'Outer edge, corner'), [-2560, 290, 200]);
  assert.deepEqual(pt(B, 'ofs_approach', 'Outer edge, corner').map(v => +v.toFixed(6)), [-1630, 190, 180]);
});

test('Sample B: OFS inner transitional NI has a 6 m vertical section to end of strip (N-IT-a)', () => {
  assert.ok(surf(B, 'ofs_inner_transitional').geomRules.includes('N-IT-a'));
  assert.deepEqual(pt(B, 'ofs_inner_transitional', 'Far end of lower edge'), [1060, 30, 100]);
  assert.ok(inst(B, 'ofs_inner_transitional').facets.some(f => f.vertical));
  near(zAt(B, 'ofs_inner_transitional', 500, 30 + 20), 106 + 8, 1e-9);
});

test('NI inner transitional ADG IIC-V: 1 800 m or runway end (N-IT-b)', () => {
  const g = geo({ ...B_IN, wingspan: 40, vat: 110, arfl: 1300, mtomOver5700: true }, { length: 1500, ends: [{ elevation: 0 }, { elevation: 0 }] });
  assert.ok(surf(g, 'ofs_inner_transitional').geomRules.includes('N-IT-b'));
  assert.equal(inst(g, 'ofs_inner_transitional').extents.alongStripTo, 1500);
});

test('Sample B: take-off climb OES ≤5 700 kg, clearway beyond 30 m moves it (N-TOCS-b)', () => {
  assert.deepEqual(pt(B, 'oes_take_off_climb', 'Inner edge, CL'), [1030, 0, 100]);
  const g = geo(B_IN, { length: 1000, ends: [{ elevation: 100 }, { elevation: 100, clearway: 100 }] });
  assert.ok(surf(g, 'oes_take_off_climb').geomRules.includes('N-TOCS-b'));
  assert.equal(pt(g, 'oes_take_off_climb', 'Inner edge, CL')[0], 1100);
});

test('straight-in OES (NPA, no circling): ADG I lower section inside a 60 m rectangle (N-SI)', () => {
  const g = geo({ ...A_IN, approach: 'NPA', circlingOrCircuits: false }, A_RW);
  const s = surf(g, 'oes_straight_in');
  assert.ok(s.geomRules.includes('N-SI'));
  near(zAt(g, 'oes_straight_in', 1500, 3000), 55, 1e-9, 'inside lower');
  near(zAt(g, 'oes_straight_in', 1500, 3600), 70, 1e-9, 'upper beyond lower');
  near(zAt(g, 'oes_straight_in', -5000, 0), 70, 1e-9);
  assert.equal(zAt(g, 'oes_straight_in', -5400, 0), null);
});

// ---------- directions, comparison, register ----------

test('direction 2 surfaces are built from threshold 2', () => {
  const g = geo(A_IN, SLOPE_RW);
  const fix = p => p.map(v => v + 0); // normalise -0
  assert.deepEqual(fix(pt(g, 'legacy_approach', 'Inner edge, CL', 2)), [2060, 0, 16]);
  assert.deepEqual(fix(pt(g, 'legacy_take_off_climb', 'Inner edge, CL', 2)), [-60, 0, 10]);
});

test('lowestAt picks the governing surface', () => {
  assert.equal(lowestAt(A.legacy, -1000, 0).id, 'legacy_approach');
  assert.equal(lowestAt(A.legacy, -1000, 0).direction, 1);
  assert.equal(lowestAt(A.new.filter(s => s.set === 'OES'), 0, 2000).id, 'oes_horizontal');
});

test('no footnote rule is left pending', () => {
  assert.deepEqual(Object.entries(RULE_STATUS).filter(([, s]) => s === 'pending'), []);
  for (const r of std.footnote_rules) assert.ok(['implemented', 'noted', 'deferred'].includes(RULE_STATUS[r.id]), r.id);
});

test('precision approach OES transitional runs along both approach and both missed approach sections (Figure 4-6)', () => {
  // Approach 2nd section, 1 000 m into it: edge 750 m out at 95 m; 100 m further out at 14.3%.
  near(zAt(A, 'oes_precision', -4060, 850), 95 + 14.3, 1e-9);
  // Missed approach 2nd section, 1 000 m into it: edge 714.64 m out at 80 m.
  near(zAt(A, 'oes_precision', 3700, 714.64 + 100), 80 + 14.3, 1e-9);
});

test('transitional lower edge runs along the strip to the strip end beyond a displaced threshold', () => {
  // THR 1 displaced 300 m: strip end 360 m before THR 1, approach inner edge 60 m before it.
  const rw = { length: 3000, ends: [{ elevation: 10, displaced: 300 }, { elevation: 10 }] };
  const g = geo(A_IN, rw);
  // OFS: 200 m before THR 1, 50 m outside the strip edge line (92.5 m): 20% gives 10 m.
  near(zAt(g, 'ofs_transitional', -200, 142.5), 20, 1e-9, 'OFS strip edge governs');
  // Without a displaced threshold the same point sits under the approach side transitional only.
  assert.ok(zAt(A, 'ofs_transitional', -200, 142.5) > 20 + 1);
  // Legacy PA: the approach side transitional is already lower there, so it still governs.
  near(lowestAt(g.legacy, -200, 240).z, 10 + 0.02 * 140 + 0.143 * (240 - 140 - 0.15 * 140), 1e-9);
  // Only the displaced end gains a strip piece (one facet each side); a standard runway gains none.
  assert.equal(surf(g, 'ofs_transitional').instances[0].facets.length,
    surf(A, 'ofs_transitional').instances[0].facets.length + 2);
});

test('strip beyond runway end defaults by 3.4.2: 30 m code 1 NI, else 60 m', () => {
  const c1ni = deriveConfig({ arfl: 700, wingspan: 11, vat: 55, runwayWidth: 23, approach: 'NI', mtomOver5700: false }, std);
  const c1npa = deriveConfig({ arfl: 700, wingspan: 11, vat: 55, runwayWidth: 23, approach: 'NPA', mtomOver5700: false }, std);
  const rw = { length: 900, ends: [{ elevation: 0 }, { elevation: 0 }] };
  assert.deepEqual(buildGeometry(std, c1ni, rw).runway.stripEndX, [-30, 930]);
  assert.deepEqual(buildGeometry(std, c1npa, rw).runway.stripEndX, [-60, 960]);
  assert.deepEqual(buildGeometry(std, c1ni, { ...rw, ends: [{ elevation: 0, stripExtension: 45 }, { elevation: 0 }] }).runway.stripEndX, [-45, 930]);
  assert.deepEqual(A.runway.stripEndX, [-60, 3060]);
});

test('arcs: inner horizontal chord stays within 0.3 m of the 4 000 m radius', () => {
  const ihs = inst(A, 'legacy_inner_horizontal');
  const [xa, xb] = A.runway.stripEndX;
  // Probe just inside the true arc at 45° off the far strip end: must still be covered.
  const r = 4000 - 0.3, a = Math.PI / 4 + 0.0123;
  assert.ok(heightAt(ihs.facets, xb + r * Math.cos(a), r * Math.sin(a)) !== null);
});
