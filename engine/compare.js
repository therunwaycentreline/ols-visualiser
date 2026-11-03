// Legacy v new comparison: fast lowest-surface queries and a plan grid of
// height differences. Pure functions over buildGeometry output.

import { planeOf, inPoly, onSegment } from './geometry.js';

/** Precompute plane and plan bounding box for every non-vertical facet. */
export function indexSurfaces(surfaces) {
  const out = [];
  for (const s of surfaces) for (const ins of s.instances) for (const f of ins.facets) {
    if (f.vertical) continue;
    const { n, c } = planeOf(f.v);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of f.v) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    out.push({ id: s.id, set: s.set, direction: ins.direction, v: f.v, holes: f.holes, n, c, x0, x1, y0, y1 });
  }
  return out;
}

/** Plan extent of an index: { x0, x1, y0, y1 }. */
export function extentOf(...idxs) {
  const e = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const idx of idxs) for (const f of idx) {
    e.x0 = Math.min(e.x0, f.x0); e.x1 = Math.max(e.x1, f.x1);
    e.y0 = Math.min(e.y0, f.y0); e.y1 = Math.max(e.y1, f.y1);
  }
  return e;
}

/** Lowest surface over (x, y): { z, id, set, direction } or null. Same result as lowestAt. */
export function lowestIndexed(idx, x, y, filter) {
  let best = null;
  for (const f of idx) {
    if (x < f.x0 - 1e-6 || x > f.x1 + 1e-6 || y < f.y0 - 1e-6 || y > f.y1 + 1e-6) continue;
    if (filter && !filter(f)) continue;
    if (!inPoly(f.v, x, y)) continue;
    if (f.holes?.some(h => inPoly(h, x, y) && !h.some((p, i) => onSegment(x, y, p, h[(i + 1) % h.length])))) continue;
    const z = f.c[2] - (f.n[0] * (x - f.c[0]) + f.n[1] * (y - f.c[1])) / f.n[2];
    if (best === null || z < best.z - 1e-9) best = { z, id: f.id, set: f.set, direction: f.direction };
  }
  return best;
}

/**
 * Difference classes for new minus legacy (metres). Negative = new surface is
 * lower than legacy (more restrictive). 'legacyOnly' / 'newOnly' where only one
 * regime has a surface over the point.
 */
export const DIFF_CLASSES = [
  { key: 'lower50', label: 'New lower by 50 m or more', test: d => d <= -50 },
  { key: 'lower10', label: 'New lower by 10 to 50 m', test: d => d <= -10 },
  { key: 'lower1', label: 'New lower by 1 to 10 m', test: d => d < -1 },
  { key: 'same', label: 'Within 1 m', test: d => d <= 1 },
  { key: 'higher1', label: 'New higher by 1 to 10 m', test: d => d < 10 },
  { key: 'higher10', label: 'New higher by 10 to 50 m', test: d => d < 50 },
  { key: 'higher50', label: 'New higher by 50 m or more', test: () => true },
  { key: 'legacyOnly', label: 'Legacy surface only' },
  { key: 'newOnly', label: 'New surface only' },
];

export function classify(zl, zn) {
  if (zl == null && zn == null) return -1;
  if (zn == null) return 7;
  if (zl == null) return 8;
  const d = zn - zl;
  return DIFF_CLASSES.findIndex(c => c.test && c.test(d));
}

/**
 * Sample both regimes on a grid in the runway frame. Cell centres at
 * x0 + (i + ½)·cell. Returns typed arrays (NaN where no surface) and the class
 * of each cell (-1 none).
 */
export function diffGrid(legacyIdx, newIdx, { cell = 100, pad = 0, newFilter } = {}) {
  const e = extentOf(legacyIdx, newIdx);
  const x0 = Math.floor((e.x0 - pad) / cell) * cell, y0 = Math.floor((e.y0 - pad) / cell) * cell;
  const nx = Math.ceil((e.x1 + pad - x0) / cell), ny = Math.ceil((e.y1 + pad - y0) / cell);
  const zl = new Float32Array(nx * ny).fill(NaN), zn = new Float32Array(nx * ny).fill(NaN);
  const cls = new Int8Array(nx * ny).fill(-1);
  for (let j = 0; j < ny; j++) {
    const y = y0 + (j + 0.5) * cell;
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * cell, k = j * nx + i;
      const l = lowestIndexed(legacyIdx, x, y), n = lowestIndexed(newIdx, x, y, newFilter);
      if (l) zl[k] = l.z;
      if (n) zn[k] = n.z;
      cls[k] = classify(l?.z, n?.z);
    }
  }
  return { x0, y0, cell, nx, ny, zl, zn, cls };
}
