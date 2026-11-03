// Display names and plain language summaries for the general audience.
// Wording to be checked by Dan. House rule: no dashes as punctuation.

export const SETS = {
  OLS: { label: 'Legacy OLS', short: 'OLS', rgb: [224, 161, 0], dash: true,
    blurb: 'Obstacle limitation surfaces under the current Annex 14, applicable until 20 November 2030.' },
  OFS: { label: 'New OFS', short: 'OFS', rgb: [214, 57, 57],
    blurb: 'Obstacle free surfaces from 21 November 2030. New objects are not allowed to penetrate them.' },
  OES: { label: 'New OES', short: 'OES', rgb: [46, 125, 230],
    blurb: 'Obstacle evaluation surfaces from 21 November 2030. An object above them needs an aeronautical study, not automatic refusal.' },
};

export const NAMES = {
  legacy_conical: 'Conical', legacy_inner_horizontal: 'Inner horizontal', legacy_approach: 'Approach',
  legacy_inner_approach: 'Inner approach', legacy_transitional: 'Transitional', legacy_inner_transitional: 'Inner transitional',
  legacy_balked_landing: 'Balked landing', legacy_take_off_climb: 'Take-off climb',
  ofs_approach: 'Approach', ofs_transitional: 'Transitional', ofs_inner_approach: 'Inner approach',
  ofs_inner_transitional: 'Inner transitional', ofs_balked_landing: 'Balked landing',
  oes_horizontal: 'Horizontal', oes_straight_in: 'Straight-in instrument approach', oes_precision: 'Precision approach',
  oes_departure: 'Instrument departure', oes_take_off_climb: 'Take-off climb',
};

/** Nearest equivalent in the other regime, for "compare with". */
export const COUNTERPART = {
  legacy_approach: 'ofs_approach', ofs_approach: 'legacy_approach',
  legacy_inner_approach: 'ofs_inner_approach', ofs_inner_approach: 'legacy_inner_approach',
  legacy_transitional: 'ofs_transitional', ofs_transitional: 'legacy_transitional',
  legacy_inner_transitional: 'ofs_inner_transitional', ofs_inner_transitional: 'legacy_inner_transitional',
  legacy_balked_landing: 'ofs_balked_landing', ofs_balked_landing: 'legacy_balked_landing',
  legacy_take_off_climb: 'oes_take_off_climb', oes_take_off_climb: 'legacy_take_off_climb',
  legacy_inner_horizontal: 'oes_horizontal', oes_horizontal: 'legacy_inner_horizontal',
  legacy_conical: 'oes_horizontal',
};

export const PLAIN = {
  legacy_conical: 'A sloping skirt rising outward from the edge of the inner horizontal surface. It keeps the airspace around the aerodrome clear for aircraft manoeuvring before landing.',
  legacy_inner_horizontal: 'A flat surface 45 m above the aerodrome, covering the area where aircraft fly visual circuits. Tall objects here can be a hazard to circling aircraft.',
  legacy_approach: 'A sloping plane rising from just before the threshold along the extended centre line. It protects aircraft on final approach.',
  legacy_inner_approach: 'A narrow rectangle at the start of the approach surface, kept clear for precision approaches where aircraft fly very close to the ground.',
  legacy_transitional: 'Steep side slopes rising from the runway strip and the approach surface edges up to the inner horizontal surface. They protect an aircraft that drifts sideways near the runway.',
  legacy_inner_transitional: 'Steeper side slopes close to a precision runway. Only frangible navigation aids may stand inside them.',
  legacy_balked_landing: 'A sloping surface beyond the threshold that protects an aircraft aborting a landing and climbing away.',
  legacy_take_off_climb: 'A sloping surface beyond the runway end that protects aircraft climbing out after take-off.',
  ofs_approach: 'The protected slope on final approach. Under the new rules this is an obstacle free surface: new objects are not allowed through it.',
  ofs_transitional: 'Side slopes from the runway strip and approach edges up to 60 m above the highest threshold. Obstacle free.',
  ofs_inner_approach: 'The rectangle at the start of the approach that must stay clear apart from frangible visual aids. Under the new rules it applies to every runway.',
  ofs_inner_transitional: 'The innermost side protection near the runway. On non-instrument and non-precision runways it starts with a short vertical wall, then slopes up.',
  ofs_balked_landing: 'Protects an aircraft aborting a precision approach and climbing away along the runway. Obstacle free.',
  oes_horizontal: 'A flat surface over the area used for circling and visual circuits. Its height and size grow with the aeroplane design group. An object above it triggers an aeronautical study.',
  oes_straight_in: 'Used where circling is not in use: a lower ring around the runway and a higher rectangle beyond it. An object above it triggers an aeronautical study.',
  oes_precision: 'Surfaces protecting a precision approach and its missed approach, based on the basic ILS surfaces. An object above them triggers an aeronautical study.',
  oes_departure: 'A widening surface beyond the take-off distance available, protecting instrument departures. An object above it triggers an aeronautical study.',
  oes_take_off_climb: 'A sloping surface protecting aircraft climbing out after take-off. Under the new rules penetration triggers an aeronautical study rather than a prohibition.',
};

export const MODES = [
  { id: 'overlay', label: 'Overlay', blurb: 'Legacy and new surfaces together.' },
  { id: 'legacy', label: 'Legacy', blurb: 'Legacy OLS only.' },
  { id: 'new', label: 'New', blurb: 'New OFS and OES only.' },
  { id: 'diff', label: 'Difference', blurb: 'Plan view: is the lowest new surface lower or higher than the lowest legacy surface?' },
];

export const APPROACH_LABELS = {
  'NI': 'Non-instrument', 'NPA': 'Non-precision approach', 'PA I': 'Precision approach CAT I', 'PA II/III': 'Precision approach CAT II/III',
};
