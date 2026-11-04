// Stage 3: georeferencing. Runway frame (engine/geometry.js) to WGS84.
//
// The runway frame is placed on a local East-North-Up tangent plane at the
// runway midpoint on the WGS84 ellipsoid. Horizontal distances in the frame
// are tangent-plane distances; over 20 km the difference from the geodesic is
// a few centimetres. z is passed through unchanged (elevation AMSL, the same
// datum as the terrain tiles). No earth-curvature correction is applied to
// surface heights: Annex 14 dimensions are horizontal and heights are planar.
//
// Default runway inputs come from the trimmed OurAirports dataset
// (data/runways_paved.json). Every value carries its source so the UI can
// show it and the user can override it (confirmed by Dan, 3 Nov 2026).

const A = 6378137.0;               // WGS84 semi-major axis (m)
const F = 1 / 298.257223563;       // flattening
const E2 = F * (2 - F);            // first eccentricity squared
const RAD = Math.PI / 180;
export const FT = 0.3048;

// ---------------------------------------------------------------- geodesy

export function toEcef(lat, lon, h = 0) {
  const p = lat * RAD, l = lon * RAD;
  const N = A / Math.sqrt(1 - E2 * Math.sin(p) ** 2);
  return [(N + h) * Math.cos(p) * Math.cos(l), (N + h) * Math.cos(p) * Math.sin(l), (N * (1 - E2) + h) * Math.sin(p)];
}

export function fromEcef([X, Y, Z]) {
  const lon = Math.atan2(Y, X);
  const p = Math.hypot(X, Y);
  let lat = Math.atan2(Z, p * (1 - E2)), h = 0;
  for (let i = 0; i < 6; i++) {
    const N = A / Math.sqrt(1 - E2 * Math.sin(lat) ** 2);
    h = p / Math.cos(lat) - N;
    lat = Math.atan2(Z, p * (1 - (E2 * N) / (N + h)));
  }
  return [lat / RAD, lon / RAD, h];
}

/** ENU tangent plane at (lat0, lon0): toEnu(lat, lon) -> [e, n]; toGeo(e, n) -> [lat, lon]. */
export function enuPlane(lat0, lon0) {
  const p = lat0 * RAD, l = lon0 * RAD;
  const sp = Math.sin(p), cp = Math.cos(p), sl = Math.sin(l), cl = Math.cos(l);
  const E = [-sl, cl, 0], N = [-sp * cl, -sp * sl, cp], U = [cp * cl, cp * sl, sp];
  const O = toEcef(lat0, lon0, 0);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return {
    toEnu(lat, lon) {
      const P = toEcef(lat, lon, 0), d = [P[0] - O[0], P[1] - O[1], P[2] - O[2]];
      return [dot(d, E), dot(d, N), dot(d, U)];
    },
    // Inverse of toEnu: the ellipsoid point whose tangent-plane (e, n) is given
    // (the plane point dropped along the plane normal onto the ellipsoid).
    toGeo(e, n) {
      let u = -(e * e + n * n) / (2 * A), lat, lon;
      for (let i = 0; i < 4; i++) {
        const P = [0, 1, 2].map(k => O[k] + e * E[k] + n * N[k] + u * U[k]);
        let h; [lat, lon, h] = fromEcef(P);
        u -= h;
      }
      return [lat, lon];
    },
  };
}

// ---------------------------------------------------------------- runway placement

/**
 * geo = { ends: [ { lat, lon }, { lat, lon } ], displaced: [d1, d2] }
 * Runway ends as surveyed; thresholds are moved inwards along the centre line
 * by the displaced distances. Runway frame origin is threshold 1, x towards
 * threshold 2, y positive to the left of +x.
 */
export function placeRunway(geo) {
  const [a, b] = geo.ends;
  const [d1, d2] = geo.displaced || [0, 0];
  const plane = enuPlane((a.lat + b.lat) / 2, (a.lon + b.lon) / 2);
  const [ae, an] = plane.toEnu(a.lat, a.lon), [be, bn] = plane.toEnu(b.lat, b.lon);
  const length = Math.hypot(be - ae, bn - an);
  if (!(length > 0)) throw new Error('Runway ends coincide');
  const ux = (be - ae) / length, uy = (bn - an) / length; // east, north components of +x
  const vx = -uy, vy = ux;                               // left of +x
  const ox = ae + d1 * ux, oy = an + d1 * uy;            // threshold 1
  const bearing = ((Math.atan2(ux, uy) / RAD) + 360) % 360; // true bearing of +x at the midpoint
  return {
    length,                 // runway end to runway end, from coordinates (m)
    Lt: length - d1 - d2,   // threshold to threshold (m)
    bearing,                // direction 1 true bearing (deg); direction 2 = +180
    /** runway frame [x, y, z] -> [lon, lat, z] */
    toWGS([x, y, z]) {
      const [lat, lon] = plane.toGeo(ox + x * ux + y * vx, oy + x * uy + y * vy);
      return [lon, lat, z];
    },
    /** [lon, lat] -> runway frame [x, y] */
    fromWGS([lon, lat]) {
      const [e, n] = plane.toEnu(lat, lon);
      const dx = e - ox, dy = n - oy;
      return [dx * ux + dy * uy, dx * vx + dy * vy];
    },
  };
}

// ---------------------------------------------------------------- defaults from OurAirports

const SRC = { oa: 'OurAirports', derived: 'Derived', fallback: 'Fallback', user: 'User', default: 'Default' };
export const SOURCES = SRC;
const v = (value, source, note) => ({ value, source, ...(note ? { note } : {}) });

/** Find one runway in the dataset by ICAO and either end designator. */
export function findRunway(data, icao, ident) {
  const f = Object.fromEntries(data.fields.map((k, i) => [k, i]));
  const row = data.rows.find(r => r[f.icao] === icao && (r[f.le] === ident || r[f.he] === ident));
  if (!row) return null;
  const o = Object.fromEntries(data.fields.map((k, i) => [k, row[i]]));
  const ap = data.airports[icao];
  return { ...o, airport: ap ? { name: ap[0], elevFt: ap[1], country: ap[2] } : null };
}

/**
 * Runway inputs with provenance. `row` from findRunway.
 * overrides (all optional, metres or decimal degrees):
 *   { ends: [ { lat, lon, elevation, displaced, clearway, stripExtension }, {...} ], aerodromeElevation }
 * Returns { idents, geo, rw, values, warnings } where values mirrors the
 * inputs as { value, source } for display.
 */
export function runwayInputs(row, overrides = {}, { stripExtension = 60 } = {}) {
  const warnings = [];
  const adElev = overrides.aerodromeElevation != null
    ? v(overrides.aerodromeElevation, SRC.user)
    : row.airport?.elevFt != null ? v(row.airport.elevFt * FT, SRC.oa) : null;
  const raw = [
    { lat: row.le_lat, lon: row.le_lon, elevFt: row.le_elev_ft, dthrFt: row.le_dthr_ft },
    { lat: row.he_lat, lon: row.he_lon, elevFt: row.he_elev_ft, dthrFt: row.he_dthr_ft },
  ];
  const ends = raw.map((r, i) => {
    const o = overrides.ends?.[i] || {};
    const pick = (key, oaVal, dflt) =>
      o[key] != null ? v(o[key], SRC.user) : oaVal != null ? v(oaVal, SRC.oa) : dflt;
    const elevation = o.elevation != null ? v(o.elevation, SRC.user)
      : r.elevFt != null ? v(r.elevFt * FT, SRC.oa, 'runway end, used as threshold')
      : adElev ? v(adElev.value, SRC.fallback, 'aerodrome elevation') : null;
    if (elevation?.source === SRC.fallback) warnings.push(`${[row.le, row.he][i]}: no end elevation, aerodrome elevation used`);
    if (!elevation) warnings.push(`${[row.le, row.he][i]}: no elevation available`);
    return {
      lat: pick('lat', r.lat), lon: pick('lon', r.lon),
      displaced: pick('displaced', r.dthrFt != null ? r.dthrFt * FT : null, v(0, SRC.default)),
      elevation,
      clearway: pick('clearway', null, v(0, SRC.default)),
      stripExtension: pick('stripExtension', null, v(stripExtension, SRC.default, '3.4.2')),
    };
  });
  const geo = {
    ends: ends.map(e => ({ lat: e.lat.value, lon: e.lon.value })),
    displaced: ends.map(e => e.displaced.value),
  };
  const placed = placeRunway(geo);
  const lengthOa = row.len_ft != null ? row.len_ft * FT : null;
  if (lengthOa && Math.abs(lengthOa - placed.length) > 30) {
    warnings.push(`Length from end coordinates (${Math.round(placed.length)} m) differs from listed length (${Math.round(lengthOa)} m)`);
  }
  const rw = {
    length: placed.length,
    ends: ends.map(e => ({
      elevation: e.elevation?.value, displaced: e.displaced.value,
      clearway: e.clearway.value, stripExtension: e.stripExtension.value,
    })),
    aerodromeElevation: adElev?.value,
  };
  return {
    idents: [row.le, row.he], icao: row.icao, airport: row.airport,
    widthM: row.wid_ft != null ? row.wid_ft * FT : null,
    geo, placed, rw, warnings,
    values: { ends, aerodromeElevation: adElev, length: v(placed.length, SRC.derived, 'from end coordinates'), lengthListed: lengthOa },
  };
}
