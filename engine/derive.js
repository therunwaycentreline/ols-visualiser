// Input model and derivation: code number, code letter, ADG, legacy columns.
// Pure functions. `std` is the parsed data/ols_standards.json.

export const APPROACH_TYPES = ['NI', 'NPA', 'PA I', 'PA II/III'];

function inBand(x, band) {
  if (band.gte !== undefined && !(x >= band.gte)) return false;
  if (band.lt !== undefined && !(x < band.lt)) return false;
  return true;
}

/** Aerodrome reference code number from ARFL (m). */
export function codeNumber(arfl, std) {
  if (!(arfl > 0)) return null;
  const b = std.derivation.code_number.bands.find(b => inBand(arfl, b));
  return b ? b.code : null;
}

/** Aerodrome reference code letter from wingspan (m). Null at 80 m and above. */
export function codeLetter(span, std) {
  if (!(span > 0)) return null;
  const b = std.derivation.code_letter.bands.find(b => inBand(span, b));
  return b ? b.letter : null;
}

/** Vat per 1.8.2 Note: max(1.3 Vso, 1.23 Vs1g). Either may be missing. */
export function vatFrom({ vso, vs1g } = {}) {
  const c = [];
  if (vso > 0) c.push(1.3 * vso);
  if (vs1g > 0) c.push(1.23 * vs1g);
  return c.length ? Math.max(...c) : null;
}

/** ADG from Vat (kt) and wingspan (m), following derivation.adg.algorithm. Null if outside the table. */
export function adg(vat, span) {
  if (!(vat > 0) || !(span > 0)) return null;
  if (vat >= 166 || span >= 80) return null;
  if (span >= 65) return 'V';
  if (span >= 52) return 'IV';
  if (span >= 36) return 'III';
  if (vat >= 121) return 'IIC';
  if (vat >= 91) return 'IIB';
  if (span >= 24) return 'IIA';
  return 'I';
}

/** Legacy Table 4-1 column. Throws for PA II/III with code 1 or 2 (no such column). */
export function legacyColumn(approach, code) {
  if (!code) return null;
  switch (approach) {
    case 'NI': return `NI-${code}`;
    case 'NPA': return code <= 2 ? 'NPA-1/2' : `NPA-${code}`;
    case 'PA I': return code <= 2 ? 'PA I-1/2' : 'PA I-3/4';
    case 'PA II/III':
      if (code <= 2) throw new Error('PA II/III is only defined for code 3 or 4 (legacy Table 4-1)');
      return 'PA II/III-3/4';
    default: throw new Error(`Unknown approach type: ${approach}`);
  }
}

/** Legacy Table 4-2 column. */
export function takeoffColumn(code) {
  if (!code) return null;
  return code === 1 ? 'Code 1' : code === 2 ? 'Code 2' : 'Code 3 or 4';
}

/** New regime runway type: 'NI' | 'NPA' | 'PA'. */
export function newRunwayType(approach) {
  if (!APPROACH_TYPES.includes(approach)) throw new Error(`Unknown approach type: ${approach}`);
  return approach.startsWith('PA') ? 'PA' : approach;
}

/**
 * Normalise user input and derive everything both regimes need.
 *
 * input = {
 *   arfl, wingspan,                 // m
 *   vat | { vso, vs1g },            // kt
 *   runwayWidth,                    // m
 *   approach,                       // 'NI' | 'NPA' | 'PA I' | 'PA II/III'
 *   digitalGoAroundSteering,        // bool, default false (Code F footnotes)
 *   departureTurn,                  // bool, legacy T4-2 c (heading change >15° IMC / VMC night)
 *   mtomOver5700,                   // bool, default true (selects Table 4-15 v 4-14)
 *   circlingOrCircuits,             // bool, default true (horizontal OES, 4.5.2.1 a)
 *   instrumentDeparture,            // bool, default approach !== 'NI' (4.5.2.1 d)
 * }
 */
export function deriveConfig(input, std) {
  const warnings = [];
  const errors = [];
  const approach = input.approach;
  if (!APPROACH_TYPES.includes(approach)) errors.push(`Unknown approach type: ${approach}`);

  const vat = input.vat > 0 ? input.vat : vatFrom(input);
  const cn = codeNumber(input.arfl, std);
  const cl = codeLetter(input.wingspan, std);
  const g = adg(vat, input.wingspan);

  if (!cn) errors.push('ARFL missing or invalid');
  if (!cl) errors.push(input.wingspan >= 80 ? 'Wingspan 80 m or more: outside code letter table' : 'Wingspan missing or invalid');
  if (!g) {
    if (vat >= 166 || input.wingspan >= 80) errors.push('Outside ADG table (Vat 166 kt or more, or wingspan 80 m or more)');
    else errors.push('Vat or wingspan missing: ADG cannot be derived');
  }
  if (!(input.runwayWidth > 0)) errors.push('Runway width missing or invalid');

  let legacyCol = null;
  try { legacyCol = legacyColumn(approach, cn); } catch (e) { errors.push(e.message); }

  const digitalGA = !!input.digitalGoAroundSteering;
  const mtomOver5700 = input.mtomOver5700 !== false;
  if (!mtomOver5700 && g && !['I', 'IIA', 'IIB'].includes(g)) {
    warnings.push(`Table 4-14 (≤5 700 kg) has no values for ADG ${g}; Table 4-15 used`);
  }

  return {
    approach,
    runwayType: APPROACH_TYPES.includes(approach) ? newRunwayType(approach) : null,
    vat, codeNumber: cn, codeLetter: cl, adg: g,
    legacyColumn: legacyCol,
    takeoffColumn: takeoffColumn(cn),
    runwayWidth: input.runwayWidth,
    flags: {
      code_letter: cl,
      runway_width_m: input.runwayWidth,
      code_f_without_digital_goaround: cl === 'F' && !digitalGA,
      departure_turn_gt_15deg_imc_or_night: !!input.departureTurn,
    },
    mtomOver5700: mtomOver5700 || (g && !['I', 'IIA', 'IIB'].includes(g)),
    circlingOrCircuits: input.circlingOrCircuits !== false,
    instrumentDeparture: input.instrumentDeparture ?? approach !== 'NI',
    warnings, errors,
  };
}
