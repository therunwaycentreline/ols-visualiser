// v1 handling of every footnote rule in std.footnote_rules.
// implemented: done in code and tested
// (pending was used during Stage 2 part 1; all geometry rules are now implemented)
// noted:       carried as a note on the surface, no change to geometry
// deferred:    needs an input that is in the parking lot (OCA/H, approach angle, mixed ADG)
export const RULE_STATUS = {
  'L-a': 'implemented',       // dimensions measured horizontally (geometry convention)
  'L-b': 'implemented',       // 150 m horizontal case; OCA/H override deferred
  'L-c': 'implemented',
  'L-d': 'implemented',
  'L-e': 'implemented',
  'L-T2b': 'implemented',
  'L-T2c': 'implemented',
  'L-T2d': 'noted',
  'L-4.2.23': 'noted',
  'N-41a': 'implemented',
  'N-41b': 'implemented',
  'N-41c': 'implemented',
  'N-41d': 'implemented',
  'N-41e': 'deferred',
  'N-41f': 'deferred',
  'N-42a': 'implemented',
  'N-42b': 'implemented',
  'N-42c': 'implemented',
  'N-42d': 'deferred',
  'N-42e': 'deferred',
  'N-IA-a': 'implemented',
  'N-IA-b': 'deferred',
  'N-IT-a': 'implemented',
  'N-IT-b': 'implemented',
  'N-IT-PA': 'implemented',
  'N-BL-a': 'implemented',
  'N-BL-b': 'implemented',
  'N-BL-c': 'implemented',
  'N-HS-note': 'deferred',
  'N-HS-group': 'implemented',
  'N-SI': 'implemented',
  'N-TOCS-b': 'implemented',
  'N-TOCS-a': 'noted',
  'N-TOCS-slope': 'noted',
  'N-Vat': 'implemented',
  'N-ADG-gap': 'implemented',
};
