// Stage 2 part 2: 3D surface geometry in the runway frame.
//
// Runway frame: origin on the centre line at threshold 1; x along the centre
// line towards threshold 2; y lateral (positive to the left of +x); z is
// elevation in the same datum as the input elevations (normally AMSL).
// All dimensions are measured horizontally (L-a).
//
// Directions: direction 1 = operations in +x (approach to threshold 1,
// take-off climbing out beyond runway end 2). Direction 2 is the reverse.
// Per-direction surfaces are built in a local frame (threshold at 0, landing
// direction +x) and rotated into the runway frame.
//
// Output facets are planar polygons: { v: [[x,y,z],...], holes?, vertical?, part? }.

import { resolveLegacy, resolveNew } from './resolve.js';

export const STRIP_EXTENSION_DEFAULT = 60;
/**
 * Strip beyond each runway end (3.4.2): 60 m for code 2, 3 or 4; 60 m for code 1
 * instrument; 30 m for code 1 non-instrument. Used when no value is supplied.
 */
export const stripExtensionFor = (codeNumber, approach) => (codeNumber === 1 && approach === 'NI' ? 30 : 60);
// Per semicircle. 144 keeps the chord inside the true arc by at most 0.24 m at
// 4 000 m radius and 0.64 m at 10 750 m (was 48: 2.1 m and 5.7 m; Stage 5 check).
const ARC_SEGMENTS = 144;
const EPS = 1e-9;

// ---------------------------------------------------------------- runway model

/**
 * rw = {
 *   length,                  // runway end to runway end (m)
 *   ends: [ { elevation,     // threshold elevation (m)
 *             displaced,     // displaced threshold distance from runway end (m), default 0
 *             clearway,      // clearway beyond this runway end (m), default 0
 *             stripExtension // strip beyond this runway end (m), default 60
 *           }, {...} ],
 *   aerodromeElevation,      // default: highest threshold
 * }
 */
export function runwayModel(rw) {
  if (!(rw?.length > 0)) throw new Error('Runway length missing or invalid');
  const ends = [0, 1].map(i => ({
    displaced: 0, clearway: 0, stripExtension: STRIP_EXTENSION_DEFAULT, ...(rw.ends?.[i] || {}),
  }));
  ends.forEach((e, i) => {
    if (!Number.isFinite(e.elevation)) throw new Error(`Threshold ${i + 1} elevation missing`);
  });
  const Lt = rw.length - ends[0].displaced - ends[1].displaced;
  if (!(Lt > 0)) throw new Error('Displaced thresholds leave no landing length');
  const zt = ends.map(e => e.elevation);
  // Decision 11: straight profile between thresholds; held level beyond them so
  // approach inner edges (at threshold elevation) meet the strip edge without a step.
  const profile = x => (x <= 0 ? zt[0] : x >= Lt ? zt[1] : zt[0] + ((zt[1] - zt[0]) * x) / Lt);
  return {
    length: rw.length, Lt, ends, zt, profile,
    aerodromeElevation: Number.isFinite(rw.aerodromeElevation) ? rw.aerodromeElevation : Math.max(...zt),
    highestThreshold: Math.max(...zt),
    thresholdX: [0, Lt],
    endX: [-ends[0].displaced, Lt + ends[1].displaced],
    stripEndX: [-ends[0].displaced - ends[0].stripExtension, Lt + ends[1].displaced + ends[1].stripExtension],
  };
}

/** Local frame for direction d (1 or 2). Distances are from the landing threshold. */
export function directionFrame(m, d) {
  const near = d - 1, far = 2 - d;
  const farEnd = m.Lt + m.ends[far].displaced;
  return {
    d, Lt: m.Lt, zt: m.zt[near], zFar: m.zt[far],
    profile: x => m.profile(d === 1 ? x : m.Lt - x),
    toRunway: d === 1 ? p => p : ([x, y, z]) => [m.Lt - x, -y, z],
    farEnd,                                          // threshold to far runway end
    farStripEnd: farEnd + m.ends[far].stripExtension, // threshold to far strip end
    farClearway: m.ends[far].clearway,
  };
}

// ---------------------------------------------------------------- primitives

const F = (v, extra = {}) => ({ v, ...extra });

function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) > 1e-6) out.push(p);
  }
  const a = out[0], b = out[out.length - 1];
  if (out.length > 1 && Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= 1e-6) out.pop();
  return out;
}

/** Arcs of radius R centred on (xa,0) and (xb,0) joined by tangents. Returns [x,y] CCW. */
export function stadium(xa, xb, R, n = ARC_SEGMENTS) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / n;
    pts.push([xb + R * Math.cos(a), R * Math.sin(a)]);
  }
  for (let i = 0; i <= n; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / n;
    pts.push([xa + R * Math.cos(a), R * Math.sin(a)]);
  }
  return pts;
}

/** Trapezoidal sections from an inner edge at x0 running in direction dir (+1/-1). */
function splay({ x0, hw0, z0, dir, sections, part }) {
  const facets = [], corners = [{ dist: 0, hw: hw0, z: z0 }];
  let x = x0, hw = hw0, z = z0, dist = 0;
  for (const s of sections) {
    if (!(s.length > 0)) continue;
    const x1 = x + dir * s.length, hw1 = hw + s.div * s.length, z1 = z + s.slope * s.length;
    facets.push(F([[x, -hw, z], [x, hw, z], [x1, hw1, z1], [x1, -hw1, z1]], part ? { part } : {}));
    x = x1; hw = hw1; z = z1; dist += s.length;
    corners.push({ dist, hw, z });
  }
  return { facets, corners };
}

/** Single-slope climb surface diverging to a final width, then parallel (+x). */
function climb({ x0, hw0, z0, div, finalHW, length, slope }) {
  const zAt = x => z0 + slope * (x - x0);
  const x1 = x0 + length;
  const xc = finalHW > hw0 ? x0 + (finalHW - hw0) / div : x0;
  if (xc >= x1) {
    const hw1 = hw0 + div * length;
    return { facets: [F([[x0, -hw0, z0], [x0, hw0, z0], [x1, hw1, zAt(x1)], [x1, -hw1, zAt(x1)]])], xc: null };
  }
  return {
    facets: [F(dedupe([
      [x0, -hw0, z0], [x0, hw0, z0], [xc, finalHW, zAt(xc)], [x1, finalHW, zAt(x1)],
      [x1, -finalHW, zAt(x1)], [xc, -finalHW, zAt(xc)],
    ]))],
    xc,
  };
}

const cutAt = (p, q, top) => {
  const t = (top - p[2]) / (q[2] - p[2]);
  return p.map((v, i) => v + t * (q[i] - v));
};
const mirrorY = f => ({ ...f, v: f.v.map(([x, y, z]) => [x, -y, z]).reverse() });

/**
 * Surface rising at `slope` perpendicular to the centre line from a lower edge
 * up to the plane z = top. `edge` is the +y lower edge, points in increasing x.
 * Each edge segment gives one planar facet; both sides are returned.
 */
function transitional(edge, slope, top, part) {
  const up = p => [p[0], p[1] + (top - p[2]) / slope, top];
  const out = [];
  for (let i = 0; i + 1 < edge.length; i++) {
    let p = edge[i], q = edge[i + 1];
    if (q[0] - p[0] < EPS) continue;
    if (p[2] >= top && q[2] >= top) continue;
    if (p[2] > top) p = cutAt(p, q, top);
    if (q[2] > top) q = cutAt(p, q, top);
    const f = F(dedupe([p, q, up(q), up(p)]), part ? { part } : {});
    if (f.v.length >= 3) out.push(f, mirrorY(f));
  }
  return out;
}

/** Vertical wall of height h standing on the lower edge, both sides. */
function wall(edge, h, part) {
  const out = [];
  for (let i = 0; i + 1 < edge.length; i++) {
    const p = edge[i], q = edge[i + 1];
    const f = F([p, q, [q[0], q[1], q[2] + h], [p[0], p[1], p[2] + h]], { vertical: true, part });
    out.push(f, mirrorY(f));
  }
  return out;
}

/** Insert profile break points (local x = 0 and Lt) into a strip edge between xs and xe. */
function stripEdge(fr, hw, xs, xe) {
  const xsPts = [xs, 0, fr.Lt, xe].filter(x => x >= xs - EPS && x <= xe + EPS).sort((a, b) => a - b);
  return xsPts.map(x => [x, hw, fr.profile(x)]);
}

const flat = (pts2d, z) => pts2d.map(([x, y]) => [x, y, z]);

// ---------------------------------------------------------------- height queries

export function onSegment(px, py, a, b) {
  const [ax, ay] = a, [bx, by] = b;
  const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const len = Math.hypot(bx - ax, by - ay);
  if (Math.abs(cross) > 1e-6 * Math.max(1, len)) return false;
  return px >= Math.min(ax, bx) - 1e-6 && px <= Math.max(ax, bx) + 1e-6
    && py >= Math.min(ay, by) - 1e-6 && py <= Math.max(ay, by) + 1e-6;
}

export function inPoly(v, x, y) {
  let inside = false;
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    if (onSegment(x, y, v[j], v[i])) return true;
    const [xi, yi] = v[i], [xj, yj] = v[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Newell normal and a point on the facet plane. */
export function planeOf(v) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < v.length; i++) {
    const [x1, y1, z1] = v[i], [x2, y2, z2] = v[(i + 1) % v.length];
    nx += (y1 - y2) * (z1 + z2); ny += (z1 - z2) * (x1 + x2); nz += (x1 - x2) * (y1 + y2);
  }
  const c = v.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]).map(s => s / v.length);
  const n = Math.hypot(nx, ny, nz);
  return { n: [nx / n, ny / n, nz / n], c };
}

/** Lowest height of any non-vertical facet over plan point (x, y), or null. */
export function heightAt(facets, x, y) {
  let best = null;
  for (const f of facets) {
    if (f.vertical || !inPoly(f.v, x, y)) continue;
    if (f.holes?.some(h => inPoly(h, x, y) && !h.some((p, i) => onSegment(x, y, p, h[(i + 1) % h.length])))) continue;
    const { n, c } = planeOf(f.v);
    const z = c[2] - (n[0] * (x - c[0]) + n[1] * (y - c[1])) / n[2];
    if (best === null || z < best) best = z;
  }
  return best;
}

// ---------------------------------------------------------------- helpers

const val = (s, name) => {
  const p = s.params[name];
  if (!p) throw new Error(`${s.id}: missing parameter "${name}"`);
  return p.value;
};

/**
 * Resolve a distance that may be a reference string (end of strip) or a tabled
 * number capped by the end of runway ("1 800 m or end of runway, whichever less").
 */
function refDistance(v, fr, { stripRule, runwayRule, capAtRunwayEnd }, used) {
  if (typeof v === 'string') {
    if (/^end of strip/i.test(v)) { used.add(stripRule); return fr.farStripEnd; }
    throw new Error(`Unresolved reference: ${v}`);
  }
  if (capAtRunwayEnd && fr.farEnd < v) {
    used.add(runwayRule);
    return fr.farEnd;
  }
  return v;
}

function instance(fr, facets, points, extra = {}) {
  const T = fr ? fr.toRunway : p => p;
  return {
    direction: fr ? fr.d : null,
    facets: facets.map(f => ({ ...f, v: f.v.map(T), ...(f.holes ? { holes: f.holes.map(h => h.map(T)) } : {}) })),
    points: points.map(([label, p]) => ({ label, p: T(p) })),
    ...extra,
  };
}

const DIRS = [1, 2];

// ---------------------------------------------------------------- legacy builders

function legacyApproachDims(s) {
  const D = val(s, 'Distance from threshold'), W = val(s, 'Length of inner edge');
  const div = val(s, 'Divergence (each side)');
  const L1 = val(s, 'First section length'), s1 = val(s, 'First section slope');
  const rules = new Set(), sections = [{ length: L1, slope: s1, div }];
  const extents = { firstLength: L1 };
  if (s.params['Second section length']) {
    const s2 = val(s, 'Second section slope');
    if (s.params['Horizontal section length']) {
      // L-b: 2nd section ends where it reaches 150 m above threshold; horizontal to total length.
      const total = val(s, 'Total length');
      const L2 = (150 - s1 * L1) / s2;
      sections.push({ length: L2, slope: s2, div }, { length: total - L1 - L2, slope: 0, div });
      Object.assign(extents, { secondLength: L2, horizontalLength: total - L1 - L2 });
      rules.add('L-b');
    } else {
      const L2 = val(s, 'Second section length');
      sections.push({ length: L2, slope: s2, div });
      extents.secondLength = L2;
    }
  }
  extents.totalLength = sections.reduce((a, x) => a + x.length, 0);
  return { D, W, sections, rules, extents };
}

const LEGACY = {
  legacy_inner_horizontal(s, ctx) {
    const { m } = ctx;
    const R = val(s, 'Radius (from reference point/s)');
    const z = m.aerodromeElevation + val(s, 'Height (above elevation datum)');
    const [xa, xb] = m.stripEndX;
    return [instance(null, [F(flat(stadium(xa, xb, R), z))], [
      ['Outer edge on extended CL beyond strip end 1', [xa - R, 0, z]],
      ['Outer edge abeam runway mid point', [(xa + xb) / 2, R, z]],
    ], { extents: { height: z, radius: R, centres: [xa, xb] } })];
  },

  legacy_conical(s, ctx) {
    const { m, byId } = ctx;
    const ihs = byId.legacy_inner_horizontal;
    const R = val(ihs, 'Radius (from reference point/s)');
    const z0 = m.aerodromeElevation + val(ihs, 'Height (above elevation datum)');
    const H = val(s, 'Height (above inner horizontal)'), sl = val(s, 'Slope');
    const R2 = R + H / sl;
    const [xa, xb] = m.stripEndX;
    const a = stadium(xa, xb, R), b = stadium(xa, xb, R2);
    const facets = [];
    for (let i = 0; i < a.length; i++) {
      const j = (i + 1) % a.length;
      const f = dedupe([[...a[i], z0], [...a[j], z0], [...b[j], z0 + H], [...b[i], z0 + H]]);
      if (f.length >= 3) facets.push(F(f));
    }
    return [instance(null, facets, [
      ['Inner edge on extended CL beyond strip end 1', [xa - R, 0, z0]],
      ['Outer edge on extended CL beyond strip end 1', [xa - R2, 0, z0 + H]],
    ], { extents: { innerRadius: R, outerRadius: R2, top: z0 + H } })];
  },

  legacy_approach(s, ctx) {
    const dims = legacyApproachDims(s);
    dims.rules.forEach(r => ctx.used.add(r));
    return DIRS.map(d => {
      const fr = directionFrame(ctx.m, d);
      const { facets, corners } = splay({ x0: -dims.D, hw0: dims.W / 2, z0: fr.zt, dir: -1, sections: dims.sections });
      const pts = corners.map((c, i) => [
        i === 0 ? 'Inner edge, CL' : i === corners.length - 1 ? 'Outer edge, CL' : `End of section ${i}, CL`,
        [-dims.D - c.dist, 0, c.z]]);
      const last = corners[corners.length - 1];
      pts.push(['Outer edge, corner', [-dims.D - last.dist, last.hw, last.z]]);
      return instance(fr, facets, pts, { extents: dims.extents });
    });
  },

  legacy_inner_approach(s, ctx) {
    const W = val(s, 'Width'), D = val(s, 'Distance from threshold'), L = val(s, 'Length'), sl = val(s, 'Slope');
    return DIRS.map(d => {
      const fr = directionFrame(ctx.m, d);
      const { facets } = splay({ x0: -D, hw0: W / 2, z0: fr.zt, dir: -1, sections: [{ length: L, slope: sl, div: 0 }] });
      return instance(fr, facets, [
        ['Inner edge, CL', [-D, 0, fr.zt]], ['Outer edge, corner', [-D - L, W / 2, fr.zt + sl * L]]]);
    });
  },

  legacy_balked_landing(s, ctx) {
    const top = ihsTop(ctx);
    return DIRS.map(d => {
      const fr = directionFrame(ctx.m, d);
      const g = balked(s, fr, top, ctx, { stripRule: 'L-c', runwayRule: 'L-d' });
      return g.inst;
    });
  },

  legacy_transitional(s, ctx) {
    const a = ctx.byId.legacy_approach;
    const dims = legacyApproachDims(a);
    const top = ihsTop(ctx);
    const edge = runwayTransitionalEdge(ctx.m, dims.D, dims.W / 2, dims.sections);
    const facets = [edge, ...stripBeyondApproach(ctx.m, dims.D, dims.W / 2)]
      .flatMap(e => transitional(e, val(s, 'Slope'), top));
    return [instance(null, facets, transitionalPoints(ctx.m, dims.W / 2, val(s, 'Slope'), top))];
  },

  legacy_inner_transitional(s, ctx) {
    const ia = ctx.byId.legacy_inner_approach, bl = ctx.byId.legacy_balked_landing;
    const top = ihsTop(ctx);
    const W = val(ia, 'Width'), D = val(ia, 'Distance from threshold'), L = val(ia, 'Length'), sl = val(ia, 'Slope');
    return DIRS.map(d => {
      const fr = directionFrame(ctx.m, d);
      const b = balked(bl, fr, top, ctx, { stripRule: 'L-c', runwayRule: 'L-d' });
      const edge = [[-D - L, W / 2, fr.zt + sl * L], [-D, W / 2, fr.zt],
        ...stripEdge(fr, W / 2, -D, b.X).slice(1), ...b.sideEdge.slice(1)];
      const facets = transitional(edge, val(s, 'Slope'), top);
      return instance(fr, facets, [
        ['Lower edge abeam threshold', [0, W / 2, fr.zt]],
        ['Upper edge abeam threshold', [0, W / 2 + (top - fr.zt) / val(s, 'Slope'), top]],
      ], { extents: { alongStripTo: b.X } });
    });
  },

  legacy_take_off_climb(s, ctx) {
    return DIRS.map(d => takeOff(s, directionFrame(ctx.m, d), ctx, {
      distance: val(s, 'Distance from runway end'), rule: 'L-T2b' }));
  },
};

function ihsTop(ctx) {
  const ihs = ctx.byId.legacy_inner_horizontal;
  return ctx.m.aerodromeElevation + val(ihs, 'Height (above elevation datum)');
}

/** Balked landing in the local frame; also returns its +y side edge for inner transitionals. */
function balked(s, fr, top, ctx, rules) {
  const X = refDistance(val(s, 'Distance from threshold'), fr, {
    ...rules, capAtRunwayEnd: typeof val(s, 'Distance from threshold') === 'number',
  }, ctx.used);
  const hw = val(s, 'Length of inner edge') / 2, div = val(s, 'Divergence (each side)'), sl = val(s, 'Slope');
  const z0 = fr.profile(X);
  const L = Math.max(0, (top - z0) / sl);
  const { facets } = splay({ x0: X, hw0: hw, z0, dir: 1, sections: [{ length: L, slope: sl, div }] });
  const inst = instance(fr, facets, [
    ['Inner edge, CL', [X, 0, z0]], ['Outer edge, corner', [X + L, hw + div * L, top]]],
  { extents: { distanceFromThreshold: X, length: L } });
  return { inst, X, sideEdge: [[X, hw, z0], [X + L, hw + div * L, top]] };
}

function takeOff(s, fr, ctx, { distance, rule }) {
  const startFromEnd = Math.max(distance, fr.farClearway);
  if (fr.farClearway > distance) ctx.used.add(rule);
  const x0 = fr.farEnd + startFromEnd, z0 = fr.profile(fr.farEnd);
  const hw0 = val(s, 'Length of inner edge') / 2, sl = val(s, 'Slope'), L = val(s, 'Length');
  const { facets, xc } = climb({ x0, hw0, z0, div: val(s, 'Divergence (each side)'),
    finalHW: val(s, 'Final width') / 2, length: L, slope: sl });
  const pts = [['Inner edge, CL', [x0, 0, z0]]];
  if (xc !== null) pts.push(['Reaches final width', [xc, val(s, 'Final width') / 2, z0 + sl * (xc - x0)]]);
  pts.push(['Outer edge, CL', [x0 + L, 0, z0 + sl * L]]);
  return instance(fr, facets, pts, { extents: { startBeyondRunwayEnd: startFromEnd } });
}

/** Lower edge (+y side) of a runway-wide transitional: approach 1 side, strip, approach 2 side. */
function runwayTransitionalEdge(m, D, hw, sections) {
  const corners = [{ dist: 0, hw, z: 0 }];
  let dist = 0, w = hw, rise = 0;
  for (const s of sections) {
    dist += s.length; w += s.div * s.length; rise += s.slope * s.length;
    corners.push({ dist, hw: w, z: rise });
  }
  const side1 = corners.slice().reverse().map(c => [-D - c.dist, c.hw, m.zt[0] + c.z]);
  const strip = [-D, 0, m.Lt, m.Lt + D].map(x => [x, hw, m.profile(x)]);
  const side2 = corners.map(c => [m.Lt + D + c.dist, c.hw, m.zt[1] + c.z]);
  return [...side1, ...strip.slice(1, -1), ...side2];
}

/**
 * Strip edge between an approach inner edge and the strip end, where the strip
 * runs further out than the approach inner edge (displaced threshold, or strip
 * extension beyond the approach inner edge distance). The transitional lower
 * edge runs along the strip to its end; where the approach side transitional is
 * lower, lowestAt picks it. Returns zero, one or two edges (+y side).
 */
function stripBeyondApproach(m, D, hw) {
  const out = [];
  const [s1, s2] = m.stripEndX;
  if (s1 < -D - EPS) out.push([s1, -D].map(x => [x, hw, m.profile(x)]));
  if (s2 > m.Lt + D + EPS) out.push([m.Lt + D, s2].map(x => [x, hw, m.profile(x)]));
  return out;
}

function transitionalPoints(m, hw, slope, top) {
  return [
    ['Lower edge abeam threshold 1', [0, hw, m.zt[0]]],
    ['Upper edge abeam threshold 1', [0, hw + (top - m.zt[0]) / slope, top]],
  ];
}

// ---------------------------------------------------------------- new builders

const ofsTop = ctx => ctx.m.highestThreshold + 60;

function ofsApproachDims(s) {
  return {
    D: val(s, 'Distance from threshold'), W: val(s, 'Length of inner edge'),
    div: val(s, 'Divergence (each side)'), L: val(s, 'Length'), slope: val(s, 'Slope'),
  };
}

const NEW = {
  ofs_approach(s, ctx) {
    const a = ofsApproachDims(s);
    return DIRS.map(d => {
      const fr = directionFrame(ctx.m, d);
      const { facets } = splay({ x0: -a.D, hw0: a.W / 2, z0: fr.zt, dir: -1,
        sections: [{ length: a.L, slope: a.slope, div: a.div }] });
      return instance(fr, facets, [
        ['Inner edge, CL', [-a.D, 0, fr.zt]],
        ['Outer edge, CL', [-a.D - a.L, 0, fr.zt + a.slope * a.L]],
        ['Outer edge, corner', [-a.D - a.L, a.W / 2 + a.div * a.L, fr.zt + a.slope * a.L]],
      ]);
    });
  },

  ofs_transitional(s, ctx) {
    const a = ofsApproachDims(ctx.byId.ofs_approach);
    const top = ofsTop(ctx), sl = val(s, 'Slope (maximum)');
    const edge = runwayTransitionalEdge(ctx.m, a.D, a.W / 2, [{ length: a.L, slope: a.slope, div: a.div }]);
    const facets = [edge, ...stripBeyondApproach(ctx.m, a.D, a.W / 2)].flatMap(e => transitional(e, sl, top));
    return [instance(null, facets, transitionalPoints(ctx.m, a.W / 2, sl, top))];
  },

  ofs_inner_approach(s, ctx) {
    const a = ofsApproachDims(ctx.byId.ofs_approach);
    const W = val(s, 'Length of inner edge'), L = val(s, 'Length');
    return DIRS.map(d => {
      const fr = directionFrame(ctx.m, d);
      // Starts at the approach inner edge; slope = OFS approach slope (N3).
      const { facets } = splay({ x0: -a.D, hw0: W / 2, z0: fr.zt, dir: -1,
        sections: [{ length: L, slope: a.slope, div: 0 }] });
      return instance(fr, facets, [
        ['Inner edge, CL', [-a.D, 0, fr.zt]], ['Outer edge, corner', [-a.D - L, W / 2, fr.zt + a.slope * L]]]);
    });
  },

  ofs_balked_landing(s, ctx) {
    return DIRS.map(d => balked(s, directionFrame(ctx.m, d), ofsTop(ctx), ctx,
      { stripRule: 'N-BL-a', runwayRule: 'N-BL-b' }).inst);
  },

  ofs_inner_transitional(s, ctx) {
    const a = ofsApproachDims(ctx.byId.ofs_approach);
    const ia = ctx.byId.ofs_inner_approach;
    const W = val(ia, 'Length of inner edge'), L = val(ia, 'Length'), hw = W / 2;
    const top = ofsTop(ctx);
    const isPA = !!s.params.Slope;
    return DIRS.map(d => {
      const fr = directionFrame(ctx.m, d);
      const head = [[-a.D - L, hw, fr.zt + a.slope * L], [-a.D, hw, fr.zt]];
      if (isPA) {
        ctx.used.add('N-IT-PA');
        const b = balked(ctx.byId.ofs_balked_landing, fr, top, ctx, { stripRule: 'N-BL-a', runwayRule: 'N-BL-b' });
        const edge = [...head, ...stripEdge(fr, hw, -a.D, b.X).slice(1), ...b.sideEdge.slice(1)];
        const sl = val(s, 'Slope');
        return instance(fr, transitional(edge, sl, top), [
          ['Lower edge abeam threshold', [0, hw, fr.zt]],
          ['Upper edge abeam threshold', [0, hw + (top - fr.zt) / sl, top]],
        ], { extents: { alongStripTo: b.X } });
      }
      const X = refDistance(val(s, 'Length after threshold'), fr, {
        stripRule: 'N-IT-a', runwayRule: 'N-IT-b',
        capAtRunwayEnd: typeof val(s, 'Length after threshold') === 'number',
      }, ctx.used);
      const hv = val(s, 'Height of vertical section'), sl = val(s, 'Slope of inclined section');
      const edge = [...head, ...stripEdge(fr, hw, -a.D, X).slice(1)];
      const raised = edge.map(([x, y, z]) => [x, y, z + hv]);
      const facets = [...wall(edge, hv, 'vertical'), ...transitional(raised, sl, top, 'inclined')];
      return instance(fr, facets, [
        ['Lower edge abeam threshold', [0, hw, fr.zt]],
        ['Top of vertical section abeam threshold', [0, hw, fr.zt + hv]],
        ['Upper edge abeam threshold', [0, hw + (top - fr.zt - hv) / sl, top]],
        ['Far end of lower edge', [X, hw, fr.profile(X)]],
      ], { extents: { alongStripTo: X } });
    });
  },

  oes_horizontal(s, ctx) {
    const { m } = ctx;
    const R = val(s, 'Radius (arcs on thresholds, tangent joins)');
    const z = m.aerodromeElevation + val(s, 'Height above aerodrome elevation');
    return [instance(null, [F(flat(stadium(0, m.Lt, R), z))], [
      ['Outer edge on extended CL beyond threshold 1', [-R, 0, z]],
      ['Outer edge abeam runway mid point', [m.Lt / 2, R, z]],
    ], { extents: { height: z, radius: R } })];
  },

  oes_straight_in(s, ctx) {
    const { m, std } = ctx;
    ctx.used.add('N-SI');
    const hz = std.new.oes.find(t => t.table === 'Table 4-10');
    const R1 = hz.params['Radius (arcs on thresholds, tangent joins)'].values.I; // ADG I horizontal OES
    const zLow = m.aerodromeElevation + val(s, 'Lower section height');
    const zUp = m.aerodromeElevation + val(s, 'Upper section height');
    const hw = val(s, 'Upper section shorter side (centred on CL)') / 2;
    const ext = val(s, 'Upper section longer side from threshold(s)');
    const lower = stadium(0, m.Lt, R1);
    const rect = [[-ext, -hw], [m.Lt + ext, -hw], [m.Lt + ext, hw], [-ext, hw]];
    return [instance(null, [
      F(flat(lower, zLow), { part: 'lower' }),
      F(flat(rect, zUp), { part: 'upper', holes: [flat(lower, zUp)] }),
    ], [
      ['Lower section edge on extended CL', [-R1, 0, zLow]],
      ['Upper section corner', [-ext, hw, zUp]],
    ], { extents: { lowerRadius: R1, upperLength: m.Lt + 2 * ext, upperWidth: 2 * hw } })];
  },

  oes_precision(s, ctx) {
    const g = n => val(s, n);
    return DIRS.map(d => {
      const fr = directionFrame(ctx.m, d);
      const D = g('Approach: distance from threshold'), hw = g('Approach: length of inner edge') / 2;
      const app = splay({ x0: -D, hw0: hw, z0: fr.zt, dir: -1, part: 'approach', sections: [
        { length: g('Approach 1st: length'), slope: g('Approach 1st: slope'), div: g('Approach 1st: divergence (each side)') },
        { length: g('Approach 2nd: length'), slope: g('Approach 2nd: slope'), div: g('Approach 2nd: divergence (each side)') },
      ] });
      const Xm = g('Missed approach: distance after threshold'), hwm = g('Missed approach: length of inner edge') / 2;
      const mis = splay({ x0: Xm, hw0: hwm, z0: fr.zt, dir: 1, part: 'missed approach', sections: [
        { length: g('Missed 1st: length'), slope: g('Missed 1st: slope'), div: g('Missed 1st: divergence (each side)') },
        { length: g('Missed 2nd: length'), slope: g('Missed 2nd: slope'), div: g('Missed 2nd: divergence (each side)') },
      ] });
      // Lower component at threshold elevation (4.3.4.12), between the two inner edges.
      const ground = F([[-D, -hw, fr.zt], [Xm, -hwm, fr.zt], [Xm, hwm, fr.zt], [-D, hw, fr.zt]], { part: 'lower component' });
      const top = fr.zt + 300; // 4.3.4.8 b
      const edge = [
        ...app.corners.slice().reverse().map(c => [-D - c.dist, c.hw, c.z]),
        ...mis.corners.map(c => [Xm + c.dist, c.hw, c.z]),
      ];
      const sl = g('Transitional: slope');
      const lastA = app.corners[app.corners.length - 1], lastM = mis.corners[mis.corners.length - 1];
      return instance(fr, [...app.facets, ground, ...mis.facets, ...transitional(edge, sl, top, 'transitional')], [
        ['Approach inner edge, CL', [-D, 0, fr.zt]],
        ['Approach end of 1st section, CL', [-D - app.corners[1].dist, 0, app.corners[1].z]],
        ['Approach outer edge, CL', [-D - lastA.dist, 0, lastA.z]],
        ['Missed approach inner edge, CL', [Xm, 0, fr.zt]],
        ['Missed approach outer edge, CL', [Xm + lastM.dist, 0, lastM.z]],
        ['Transitional upper edge abeam threshold', [0, hw + 300 / sl, top]],
      ]);
    });
  },

  oes_departure(s, ctx) {
    const g = n => val(s, n);
    return DIRS.map(d => {
      const fr = directionFrame(ctx.m, d);
      const x0 = fr.farEnd + fr.farClearway, z0 = fr.profile(fr.farEnd) + 5; // 4.3.5.3
      const sl = g('Slope');
      const { facets, corners } = splay({ x0, hw0: g('Length of inner edge') / 2, z0, dir: 1, sections: [
        { length: g('1st section length'), slope: sl, div: g('1st section divergence') },
        { length: g('2nd section length'), slope: sl, div: g('2nd section divergence') },
      ] });
      const last = corners[corners.length - 1];
      return instance(fr, facets, [
        ['Inner edge, CL (end of TODA)', [x0, 0, z0]],
        ['End of 1st section, corner', [x0 + corners[1].dist, corners[1].hw, corners[1].z]],
        ['Outer edge, corner', [x0 + last.dist, last.hw, last.z]],
      ]);
    });
  },

  oes_take_off_climb(s, ctx) {
    const isLight = !!s.params['Distance from runway end'];
    return DIRS.map(d => takeOff(s, directionFrame(ctx.m, d), ctx, isLight
      ? { distance: val(s, 'Distance from runway end'), rule: 'N-TOCS-b' }
      : { distance: 0, rule: null }));
  },
};

// ---------------------------------------------------------------- entry point

function buildRegime(resolved, builders, base) {
  const byId = Object.fromEntries(resolved.map(s => [s.id, s]));
  return resolved.map(s => {
    const used = new Set();
    const b = builders[s.id];
    if (!b) throw new Error(`No geometry builder for ${s.id}`);
    const instances = b(s, { ...base, byId, used });
    used.delete(null);
    return { ...s, geomRules: [...used].sort(), instances };
  });
}

/** Geometry for both regimes. cfg from deriveConfig, rw as runwayModel input. */
export function buildGeometry(std, cfg, rw) {
  // Unsupplied strip extensions take the 3.4.2 value for this code and approach type.
  const se = stripExtensionFor(cfg.codeNumber, cfg.approach);
  const m = runwayModel({ ...rw, ends: [0, 1].map(i => ({ stripExtension: se, ...(rw.ends?.[i] || {}) })) });
  const base = { std, cfg, m };
  return {
    runway: m,
    legacy: buildRegime(resolveLegacy(std, cfg), LEGACY, base),
    new: buildRegime(resolveNew(std, cfg), NEW, base),
  };
}

/** All non-vertical facets of a set of surfaces. */
export const facetsOf = surfaces => surfaces.flatMap(s => s.instances.flatMap(i => i.facets));

/** Lowest surface at a plan point: { z, id, title, direction } or null. */
export function lowestAt(surfaces, x, y) {
  let best = null;
  for (const s of surfaces) for (const i of s.instances) {
    const z = heightAt(i.facets, x, y);
    if (z !== null && (best === null || z < best.z - 1e-9)) best = { z, id: s.id, title: s.title, direction: i.direction };
  }
  return best;
}
