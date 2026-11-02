import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  codeNumber, codeLetter, adg, vatFrom, legacyColumn, takeoffColumn, deriveConfig,
} from '../derive.js';
import { resolveLegacy, resolveNew, selectNewTables } from '../resolve.js';
import { RULE_STATUS } from '../rule_status.js';

const std = JSON.parse(readFileSync(new URL('../../data/ols_standards.json', import.meta.url)));

const val = (surfaces, id, param) => surfaces.find(s => s.id === id)?.params[param]?.value;
const rules = (surfaces, id, param) => surfaces.find(s => s.id === id)?.params[param]?.rules;

// ---------- derivation ----------

test('ADG test cases from the JSON', () => {
  for (const c of std.derivation.adg.test_cases) {
    assert.equal(adg(c.vat, c.span), c.adg, `vat ${c.vat} span ${c.span}`);
  }
});

test('ADG bounds are "up to but not including"', () => {
  assert.equal(adg(165.9, 79.9), 'V');
  assert.equal(adg(166, 30), null);
  assert.equal(adg(100, 80), null);
  assert.equal(adg(120.9, 35.9), 'IIB');
  assert.equal(adg(121, 35.9), 'IIC');
  assert.equal(adg(90.9, 23.9), 'I');
  assert.equal(adg(150, 36), 'III'); // span governs from 36 m regardless of Vat
});

test('code number bands', () => {
  const cases = [[799, 1], [800, 2], [1199, 2], [1200, 3], [1799, 3], [1800, 4], [3500, 4]];
  for (const [arfl, code] of cases) assert.equal(codeNumber(arfl, std), code, `ARFL ${arfl}`);
  assert.equal(codeNumber(0, std), null);
});

test('code letter bands', () => {
  const cases = [[14.9, 'A'], [15, 'B'], [24, 'C'], [36, 'D'], [52, 'E'], [65, 'F'], [79.9, 'F']];
  for (const [span, l] of cases) assert.equal(codeLetter(span, std), l, `span ${span}`);
  assert.equal(codeLetter(80, std), null);
});

test('Vat from Vso and Vs1g (1.8.2 Note)', () => {
  assert.equal(vatFrom({ vso: 100, vs1g: 110 }), 1.23 * 110);
  assert.equal(vatFrom({ vso: 100 }), 130);
  assert.equal(vatFrom({}), null);
});

test('legacy column mapping', () => {
  assert.equal(legacyColumn('NI', 3), 'NI-3');
  assert.equal(legacyColumn('NPA', 2), 'NPA-1/2');
  assert.equal(legacyColumn('NPA', 4), 'NPA-4');
  assert.equal(legacyColumn('PA I', 1), 'PA I-1/2');
  assert.equal(legacyColumn('PA I', 3), 'PA I-3/4');
  assert.equal(legacyColumn('PA II/III', 4), 'PA II/III-3/4');
  assert.throws(() => legacyColumn('PA II/III', 2));
  assert.equal(takeoffColumn(1), 'Code 1');
  assert.equal(takeoffColumn(3), 'Code 3 or 4');
});

test('deriveConfig reports errors rather than throwing', () => {
  const c = deriveConfig({ arfl: 1000, wingspan: 20, vat: 90, runwayWidth: 30, approach: 'PA II/III' }, std);
  assert.ok(c.errors.some(e => e.includes('PA II/III')));
  const d = deriveConfig({ arfl: 3000, wingspan: 85, vat: 150, runwayWidth: 60, approach: 'PA I' }, std);
  assert.equal(d.adg, null);
  assert.ok(d.errors.length > 0);
});

// ---------- modifiers: new regime ----------

const cfgFor = (over) => deriveConfig({
  arfl: 2500, wingspan: 20, vat: 85, runwayWidth: 30, approach: 'NI', ...over,
}, std);

test('N-41a/b: NI approach inner edge, ADG I, by runway width', () => {
  const at = w => val(resolveNew(std, cfgFor({ runwayWidth: w })), 'ofs_approach', 'Length of inner edge');
  assert.equal(at(23), 60);
  assert.equal(at(23.1), 80);
  assert.equal(at(30), 80);
  assert.equal(at(30.1), 100);
});

test('N-41c/d: NI approach inner edge, ADG IIA/IIB and IIC', () => {
  const at = (w, vat, span) =>
    val(resolveNew(std, cfgFor({ runwayWidth: w, vat, wingspan: span })), 'ofs_approach', 'Length of inner edge');
  // IIA (span 24, Vat 85)
  assert.equal(at(30, 85, 24), 80);
  assert.equal(at(45, 85, 24), 100);
  assert.equal(at(45.1, 85, 24), 110);
  // IIC (Vat 130): only d applies
  assert.equal(at(45, 130, 20), 100);
  assert.equal(at(46, 130, 20), 110);
  // III: no modifier
  assert.equal(at(60, 130, 40), 125);
});

test('N-42a/b/c: instrument approach inner edge', () => {
  const at = (w, vat, span) =>
    val(resolveNew(std, cfgFor({ approach: 'NPA', runwayWidth: w, vat, wingspan: span })), 'ofs_approach', 'Length of inner edge');
  assert.equal(at(30, 85, 20), 110);
  assert.equal(at(31, 85, 20), 125);   // a
  assert.equal(at(30, 95, 20), 125);
  assert.equal(at(31, 95, 20), 140);   // b (IIB)
  assert.equal(at(30, 130, 20), 140);  // c: DECREASE from 155
  assert.equal(at(31, 130, 20), 155);
});

test('N-IA-a and N-BL-c: Code F without digital go-around steering', () => {
  const base = { arfl: 3200, wingspan: 70, vat: 150, runwayWidth: 60, approach: 'PA I' };
  const without = resolveNew(std, deriveConfig(base, std));
  const withDG = resolveNew(std, deriveConfig({ ...base, digitalGoAroundSteering: true }, std));
  assert.equal(val(without, 'ofs_inner_approach', 'Length of inner edge'), 140);
  assert.equal(val(without, 'ofs_balked_landing', 'Length of inner edge'), 140);
  assert.deepEqual(rules(without, 'ofs_balked_landing', 'Length of inner edge'), ['N-BL-c']);
  assert.equal(val(withDG, 'ofs_inner_approach', 'Length of inner edge'), 120);
  assert.equal(val(withDG, 'ofs_balked_landing', 'Length of inner edge'), 120);
});

// ---------- modifiers: legacy ----------

test('L-e: legacy inner approach width and balked landing inner edge, code F', () => {
  const base = { arfl: 3200, wingspan: 70, vat: 150, runwayWidth: 60, approach: 'PA I' };
  const f = resolveLegacy(std, deriveConfig(base, std));
  assert.equal(val(f, 'legacy_inner_approach', 'Width'), 140);
  assert.equal(val(f, 'legacy_balked_landing', 'Length of inner edge'), 140);
  const dg = resolveLegacy(std, deriveConfig({ ...base, digitalGoAroundSteering: true }, std));
  assert.equal(val(dg, 'legacy_inner_approach', 'Width'), 120);
  const e = resolveLegacy(std, deriveConfig({ ...base, wingspan: 64 }, std));
  assert.equal(val(e, 'legacy_inner_approach', 'Width'), 120);
  // approach inner edge is not touched by L-e
  assert.equal(val(f, 'legacy_approach', 'Length of inner edge'), 280);
});

test('L-T2c: legacy take-off climb final width with turn', () => {
  const base = { arfl: 2500, wingspan: 35, vat: 140, runwayWidth: 45, approach: 'NPA' };
  assert.equal(val(resolveLegacy(std, deriveConfig(base, std)), 'legacy_take_off_climb', 'Final width'), 1200);
  assert.equal(val(resolveLegacy(std, deriveConfig({ ...base, departureTurn: true }, std)), 'legacy_take_off_climb', 'Final width'), 1800);
  // code 2: no effect
  const c2 = deriveConfig({ ...base, arfl: 1000, departureTurn: true }, std);
  assert.equal(val(resolveLegacy(std, c2), 'legacy_take_off_climb', 'Final width'), 580);
});

test('every modifier in the JSON is exercised by a passing case above', () => {
  const covered = ['N-41a', 'N-41b', 'N-41c', 'N-41d', 'N-42a', 'N-42b', 'N-42c', 'N-IA-a', 'N-BL-c', 'L-e', 'L-T2c'];
  assert.deepEqual(std.modifiers.map(m => m.rule).sort(), covered.sort());
});

// ---------- surface selection ----------

test('new regime surface selection', () => {
  assert.deepEqual(selectNewTables(cfgFor({})),
    ['Table 4-1', '4.2.2', 'Table 4-3', 'Table 4-6', 'Table 4-10', 'Table 4-15']);
  assert.deepEqual(selectNewTables(cfgFor({ approach: 'NPA', circlingOrCircuits: false })),
    ['Table 4-2', '4.2.2', 'Table 4-4', 'Table 4-7', 'Table 4-11', 'Table 4-13', 'Table 4-15']);
  assert.deepEqual(selectNewTables(cfgFor({ approach: 'PA II/III' })),
    ['Table 4-2', '4.2.2', 'Table 4-5', 'Table 4-8', 'Table 4-9', 'Table 4-10', 'Table 4-12', 'Table 4-13', 'Table 4-15']);
  // ≤5 700 kg only valid for ADG I to IIB
  assert.ok(selectNewTables(cfgFor({ mtomOver5700: false })).includes('Table 4-14'));
  const big = cfgFor({ mtomOver5700: false, vat: 130 });
  assert.ok(selectNewTables(big).includes('Table 4-15'));
  assert.ok(big.warnings.length === 1);
});

test('legacy surfaces drop out where the column has no values', () => {
  const ni = resolveLegacy(std, cfgFor({}));
  assert.deepEqual(ni.map(s => s.id), [
    'legacy_conical', 'legacy_inner_horizontal', 'legacy_approach', 'legacy_transitional', 'legacy_take_off_climb',
  ]);
});

test('every resolved surface carries catalogue metadata', () => {
  for (const approach of ['NI', 'NPA', 'PA I', 'PA II/III']) {
    const c = cfgFor({ approach });
    for (const s of [...resolveLegacy(std, c), ...resolveNew(std, c)]) {
      assert.ok(s.id && s.clause && s.obligation && s.obstacleRule, `${approach} ${s.title}`);
    }
  }
});

// ---------- footnote rule register ----------

test('every footnote rule has a v1 status', () => {
  const ids = std.footnote_rules.map(r => r.id).sort();
  assert.deepEqual(Object.keys(RULE_STATUS).sort(), ids);
  for (const s of Object.values(RULE_STATUS)) {
    assert.ok(['implemented', 'noted', 'deferred'].includes(s));
  }
});

// ---------- the two review configurations ----------

test('Sample A: code 4 PA I, ADG IV (ARFL 2800, span 60, Vat 145, rwy 45)', () => {
  const c = deriveConfig({ arfl: 2800, wingspan: 60, vat: 145, runwayWidth: 45, approach: 'PA I' }, std);
  assert.equal(c.codeNumber, 4); assert.equal(c.codeLetter, 'E'); assert.equal(c.adg, 'IV');
  assert.equal(c.legacyColumn, 'PA I-3/4');
  const L = resolveLegacy(std, c), N = resolveNew(std, c);
  assert.equal(val(L, 'legacy_approach', 'Length of inner edge'), 280);
  assert.equal(val(L, 'legacy_inner_horizontal', 'Radius (from reference point/s)'), 4000);
  assert.equal(val(L, 'legacy_take_off_climb', 'Final width'), 1200);
  assert.equal(val(N, 'ofs_approach', 'Length of inner edge'), 185);
  assert.equal(val(N, 'ofs_inner_approach', 'Length of inner edge'), 120);
  assert.equal(val(N, 'ofs_balked_landing', 'Distance from threshold'), 1800);
  assert.equal(val(N, 'oes_horizontal', 'Radius (arcs on thresholds, tangent joins)'), 10750);
  assert.equal(val(N, 'oes_take_off_climb', 'Length of inner edge'), 180);
});

test('Sample B: code 2 NI, ADG I (ARFL 1000, span 12, Vat 80, rwy 18)', () => {
  const c = deriveConfig({ arfl: 1000, wingspan: 12, vat: 80, runwayWidth: 18, approach: 'NI', mtomOver5700: false }, std);
  assert.equal(c.codeNumber, 2); assert.equal(c.codeLetter, 'A'); assert.equal(c.adg, 'I');
  assert.equal(c.legacyColumn, 'NI-2');
  const L = resolveLegacy(std, c), N = resolveNew(std, c);
  assert.equal(val(L, 'legacy_approach', 'Length of inner edge'), 80);
  assert.equal(val(L, 'legacy_inner_horizontal', 'Radius (from reference point/s)'), 2500);
  assert.equal(val(N, 'ofs_approach', 'Length of inner edge'), 60);
  assert.equal(val(N, 'ofs_inner_transitional', 'Length after threshold'), 'End of strip (a)');
  assert.equal(val(N, 'oes_horizontal', 'Radius (arcs on thresholds, tangent joins)'), 3350);
  assert.equal(val(N, 'oes_take_off_climb', 'Length of inner edge'), 60);
});
