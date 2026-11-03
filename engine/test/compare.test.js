import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveConfig } from '../derive.js';
import { buildGeometry, lowestAt } from '../geometry.js';
import { indexSurfaces, lowestIndexed, diffGrid, classify, DIFF_CLASSES } from '../compare.js';

const std = JSON.parse(readFileSync(new URL('../../data/ols_standards.json', import.meta.url)));
const A = buildGeometry(std, deriveConfig({ arfl: 2800, wingspan: 60, vat: 145, runwayWidth: 45, approach: 'PA I' }, std),
  { length: 3000, ends: [{ elevation: 10 }, { elevation: 10 }] });
const B = buildGeometry(std, deriveConfig({ arfl: 1000, wingspan: 12, vat: 80, runwayWidth: 18, approach: 'NI', mtomOver5700: false }, std),
  { length: 1000, ends: [{ elevation: 100 }, { elevation: 100 }] });

test('indexed lowest surface matches lowestAt (both samples, both regimes)', () => {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const g of [A, B]) for (const reg of [g.legacy, g.new]) {
    const idx = indexSurfaces(reg);
    for (let k = 0; k < 800; k++) {
      const x = -16000 + rnd() * 35000, y = -12000 + rnd() * 24000;
      const a = lowestAt(reg, x, y), b = lowestIndexed(idx, x, y);
      if (a === null) { assert.equal(b, null); continue; }
      assert.ok(Math.abs(a.z - b.z) < 1e-6, `z at ${x},${y}`);
    }
  }
});

test('classify: sign convention and bins', () => {
  const key = (l, n) => DIFF_CLASSES[classify(l, n)]?.key;
  assert.equal(key(100, 40), 'lower50');
  assert.equal(key(100, 90), 'lower10');
  assert.equal(key(100, 95), 'lower1');
  assert.equal(key(100, 100.5), 'same');
  assert.equal(key(100, 105), 'higher1');
  assert.equal(key(100, 130), 'higher10');
  assert.equal(key(100, 200), 'higher50');
  assert.equal(key(100, null), 'legacyOnly');
  assert.equal(key(null, 100), 'newOnly');
  assert.equal(classify(null, null), -1);
});

test('diff grid, Sample A: on the extended centre line, 2 km out', () => {
  const g = diffGrid(indexSurfaces(A.legacy), indexSurfaces(A.new), { cell: 100 });
  // Cell centre at x = -2050, y = -50 / +50 straddle the CL; take the cell containing (-2050, 50).
  const i = Math.floor((-2050 - g.x0) / g.cell), j = Math.floor((50 - g.y0) / g.cell);
  const k = j * g.nx + i;
  const x = g.x0 + (i + 0.5) * g.cell;
  // Legacy PA I-3/4 approach 2 %, new OFS instrument approach 3.33 %; both start 60 m out at THR elevation 10 m.
  assert.ok(Math.abs(g.zl[k] - (10 + 0.02 * (-x - 60))) < 1e-3);
  assert.ok(g.zn[k] <= 10 + 0.0333 * (-x - 60) + 1e-3); // new could be lower via OES
  assert.ok(g.cls[k] >= 0);
});

test('diff grid, Sample B: OES horizontal reaches past the legacy conical (newOnly cells exist)', () => {
  const g = diffGrid(indexSurfaces(B.legacy), indexSurfaces(B.new), { cell: 200 });
  const counts = DIFF_CLASSES.map((_, c) => g.cls.filter(v => v === c).length);
  assert.ok(counts[8] > 0 || counts[7] > 0);
});
