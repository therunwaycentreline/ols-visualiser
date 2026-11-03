import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { placeRunway, findRunway, runwayInputs, enuPlane, FT } from '../georef.js';
import { deriveConfig } from '../derive.js';
import { buildGeometry } from '../geometry.js';

const root = new URL('../../', import.meta.url);
const data = JSON.parse(readFileSync(new URL('data/runways_paved.json', root)));
const std = JSON.parse(readFileSync(new URL('data/ols_standards.json', root)));

// Independent check: Vincenty inverse on WGS84 (distance m, initial bearing deg).
function vincenty([lon1, lat1], [lon2, lat2]) {
  const a = 6378137, f = 1 / 298.257223563, b = a * (1 - f), r = Math.PI / 180;
  const L = (lon2 - lon1) * r, U1 = Math.atan((1 - f) * Math.tan(lat1 * r)), U2 = Math.atan((1 - f) * Math.tan(lat2 * r));
  const sU1 = Math.sin(U1), cU1 = Math.cos(U1), sU2 = Math.sin(U2), cU2 = Math.cos(U2);
  let l = L, lp, sS, cS, S, sA, c2A, c2Sm;
  do {
    const sl = Math.sin(l), cl = Math.cos(l);
    sS = Math.hypot(cU2 * sl, cU1 * sU2 - sU1 * cU2 * cl); cS = sU1 * sU2 + cU1 * cU2 * cl; S = Math.atan2(sS, cS);
    sA = (cU1 * cU2 * sl) / sS; c2A = 1 - sA * sA; c2Sm = cS - (2 * sU1 * sU2) / c2A;
    const C = (f / 16) * c2A * (4 + f * (4 - 3 * c2A));
    lp = l; l = L + (1 - C) * f * sA * (S + C * sS * (c2Sm + C * cS * (-1 + 2 * c2Sm * c2Sm)));
  } while (Math.abs(l - lp) > 1e-12);
  const u2 = (c2A * (a * a - b * b)) / (b * b);
  const A = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const B = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const dS = B * sS * (c2Sm + (B / 4) * (cS * (-1 + 2 * c2Sm * c2Sm) - (B / 6) * c2Sm * (-3 + 4 * sS * sS) * (-3 + 4 * c2Sm * c2Sm)));
  const az = Math.atan2(cU2 * Math.sin(l), cU1 * sU2 - sU1 * cU2 * Math.cos(l)) / r;
  return { s: b * A * (S - dS), az: (az + 360) % 360 };
}

const YBBN = findRunway(data, 'YBBN', '01R');

test('dataset lookup: YBBN 01R/19L by either end', () => {
  assert.equal(YBBN.le, '01R'); assert.equal(YBBN.he, '19L');
  assert.deepEqual(findRunway(data, 'YBBN', '19L'), YBBN);
  assert.equal(findRunway(data, 'YBBN', '07'), null);
});

test('ENU plane round trip within 1 mm at 20 km', () => {
  const p = enuPlane(-27.39, 153.126);
  for (const [e, n] of [[0, 0], [20000, 0], [-15000, 12000], [3000, -20000]]) {
    const [lat, lon] = p.toGeo(e, n);
    const [e2, n2] = p.toEnu(lat, lon);
    assert.ok(Math.hypot(e2 - e, n2 - n) < 1e-3, `${e},${n}`);
  }
});

test('placement: ends, length and bearing agree with Vincenty', () => {
  const geo = { ends: [{ lat: YBBN.le_lat, lon: YBBN.le_lon }, { lat: YBBN.he_lat, lon: YBBN.he_lon }], displaced: [0, 0] };
  const P = placeRunway(geo);
  const g = vincenty([YBBN.le_lon, YBBN.le_lat], [YBBN.he_lon, YBBN.he_lat]);
  assert.ok(Math.abs(P.length - g.s) < 0.05, `${P.length} v ${g.s}`);
  assert.ok(Math.abs(P.bearing - g.az) < 0.01, `${P.bearing} v ${g.az}`);
  const e1 = P.toWGS([0, 0, 0]), e2 = P.toWGS([P.length, 0, 0]);
  assert.ok(vincenty(e1, [YBBN.le_lon, YBBN.le_lat]).s < 0.01);
  assert.ok(vincenty(e2, [YBBN.he_lon, YBBN.he_lat]).s < 0.01);
});

test('displaced threshold moves origin along the centre line', () => {
  const geo = { ends: [{ lat: YBBN.le_lat, lon: YBBN.le_lon }, { lat: YBBN.he_lat, lon: YBBN.he_lon }], displaced: [60, 100] };
  const P = placeRunway(geo);
  const t1 = P.toWGS([0, 0, 0]), t2 = P.toWGS([P.Lt, 0, 0]);
  assert.ok(Math.abs(vincenty([YBBN.le_lon, YBBN.le_lat], t1).s - 60) < 0.01);
  assert.ok(Math.abs(vincenty(t2, [YBBN.he_lon, YBBN.he_lat]).s - 100) < 0.01);
  assert.ok(Math.abs(P.Lt - (P.length - 160)) < 1e-9);
});

test('distances and directions far from the runway (15 km approach)', () => {
  const geo = { ends: [{ lat: YBBN.le_lat, lon: YBBN.le_lon }, { lat: YBBN.he_lat, lon: YBBN.he_lon }], displaced: [0, 0] };
  const P = placeRunway(geo);
  const t1 = P.toWGS([0, 0, 0]);
  const az = vincenty(t1, P.toWGS([P.Lt, 0, 0])).az; // centre line azimuth at threshold 1
  const far = vincenty(t1, P.toWGS([-15000, 0, 0]));
  assert.ok(Math.abs(far.s - 15000) < 0.1, `${far.s}`);
  // 0.0005 deg is 0.13 m of lateral offset at 15 km
  assert.ok(Math.abs(((far.az - az + 360) % 360) - 180) < 0.0005, 'extended centre line stays on the runway azimuth');
  const left = vincenty(t1, P.toWGS([0, 1000, 0]));
  assert.ok(Math.abs(left.s - 1000) < 0.01);
  assert.ok(Math.abs(((left.az - az + 360) % 360) - 270) < 0.001, 'y positive is left of direction 1');
  const back = P.fromWGS(P.toWGS([-12000, 3500, 0]));
  assert.ok(Math.hypot(back[0] + 12000, back[1] - 3500) < 1e-3);
});

test('z passes through unchanged', () => {
  const P = placeRunway({ ends: [{ lat: -27, lon: 153 }, { lat: -26.99, lon: 153 }] });
  assert.equal(P.toWGS([100, 0, 123.4])[2], 123.4);
});

test('inputs from OurAirports with provenance (YBBN 01R/19L)', () => {
  const I = runwayInputs(YBBN);
  const [e1, e2] = I.values.ends;
  assert.equal(e1.elevation.source, 'OurAirports'); assert.ok(Math.abs(e1.elevation.value - 12 * FT) < 1e-9);
  assert.ok(Math.abs(e1.displaced.value - 197 * FT) < 1e-9); assert.equal(e1.displaced.source, 'OurAirports');
  assert.equal(e2.displaced.value, 0);
  assert.equal(e1.clearway.source, 'Default'); assert.equal(e1.stripExtension.value, 60);
  assert.ok(Math.abs(I.rw.aerodromeElevation - 13 * FT) < 1e-9);
  assert.ok(Math.abs(I.placed.Lt - (I.placed.length - 197 * FT)) < 1e-6);
});

test('missing end elevation falls back to aerodrome elevation with a warning', () => {
  const row = findRunway(data, 'YBBN', '01L');
  assert.equal(row.le_elev_ft, null);
  const I = runwayInputs(row);
  assert.equal(I.values.ends[0].elevation.source, 'Fallback');
  assert.ok(Math.abs(I.rw.ends[0].elevation - 13 * FT) < 1e-9);
  assert.ok(I.warnings.some(w => w.includes('aerodrome elevation used')));
});

test('user overrides win and are marked', () => {
  const I = runwayInputs(YBBN, { ends: [{ lat: -27.404, elevation: 4.0, displaced: 0 }, { clearway: 300 }], aerodromeElevation: 4.6 });
  assert.equal(I.values.ends[0].lat.source, 'User'); assert.equal(I.geo.ends[0].lat, -27.404);
  assert.equal(I.rw.ends[0].elevation, 4.0); assert.equal(I.rw.ends[0].displaced, 0);
  assert.equal(I.rw.ends[1].clearway, 300); assert.equal(I.values.aerodromeElevation.source, 'User');
});

test('end to end: geometry thresholds land on the georeferenced thresholds', () => {
  const I = runwayInputs(YBBN);
  const cfg = deriveConfig({ arfl: 2800, wingspan: 60, vat: 145, runwayWidth: 45, approach: 'PA I' }, std);
  const G = buildGeometry(std, cfg, I.rw);
  assert.ok(Math.abs(G.runway.Lt - I.placed.Lt) < 1e-6);
  const thr2 = I.placed.toWGS([G.runway.thresholdX[1], 0, 0]);
  // threshold 2 has no displacement, so it is the 19L runway end
  assert.ok(vincenty(thr2, [YBBN.he_lon, YBBN.he_lat]).s < 0.01);
});
