import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveConfig } from '../derive.js';
import { PRESETS } from '../../app/presets.js';

const std = JSON.parse(readFileSync(new URL('../../data/ols_standards.json', import.meta.url)));
// Expected code and ADG for each preset, so a change to a preset value shows up here.
const EXPECT = { c172: '1A I', be350: '2B IIB', at76: '3C IIB', dh8d: '3C IIB', a320: '4C IIC', b738: '4C IIC',
  b789: '4E IV', b77w: '4E IV', a388: '4F V', sampleA: '4E IV', sampleB: '2A I' };

test('every preset derives the expected code and ADG', () => {
  for (const p of PRESETS) {
    const c = deriveConfig({ ...p, runwayWidth: 45, approach: 'PA I' }, std);
    assert.equal(`${c.codeNumber}${c.codeLetter} ${c.adg}`, EXPECT[p.id], p.name);
  }
});
