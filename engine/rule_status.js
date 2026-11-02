// v1 handling of every footnote rule in std.footnote_rules.
// implemented: done in code and tested
// pending:     belongs to the geometry step of Stage 2, not yet written
// noted:       carried as a note on the surface, no change to geometry
// deferred:    needs an input that is in the parking lot (OCA/H, approach angle, mixed ADG)
export const RULE_STATUS = {
  'L-a': 'pending',       // dimensions measured horizontally (geometry convention)
  'L-b': 'pending',       // 150 m horizontal case; OCA/H override deferred
  'L-c': 'pending',
  'L-d': 'pending',
  'L-e': 'implemented',
  'L-T2b': 'pending',
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
  'N-IT-a': 'pending',
  'N-IT-b': 'pending',
  'N-IT-PA': 'pending',
  'N-BL-a': 'pending',
  'N-BL-b': 'pending',
  'N-BL-c': 'implemented',
  'N-HS-note': 'deferred',
  'N-HS-group': 'implemented',
  'N-SI': 'pending',
  'N-TOCS-b': 'pending',
  'N-TOCS-a': 'noted',
  'N-TOCS-slope': 'noted',
  'N-Vat': 'implemented',
  'N-ADG-gap': 'implemented',
};
