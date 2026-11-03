// Critical aeroplane presets. Values are indicative public figures and are NOT
// yet checked by Dan (decision D1). `checked` flips to true once he confirms a row.
// arfl and wingspan in metres, vat in knots (at maximum certificated landing mass).

export const PRESETS = [
  { id: 'c172', name: 'Cessna 172S', arfl: 497, wingspan: 11.0, vat: 52, mtomOver5700: false, checked: false },
  { id: 'be350', name: 'Beechcraft King Air 350', arfl: 1006, wingspan: 17.65, vat: 105, mtomOver5700: true, checked: false },
  { id: 'at76', name: 'ATR 72-600', arfl: 1333, wingspan: 27.05, vat: 113, mtomOver5700: true, checked: false },
  { id: 'dh8d', name: 'De Havilland Dash 8-400', arfl: 1425, wingspan: 28.42, vat: 119, mtomOver5700: true, checked: false },
  { id: 'a320', name: 'Airbus A320ceo', arfl: 2090, wingspan: 34.1, vat: 138, mtomOver5700: true, checked: false },
  { id: 'b738', name: 'Boeing 737-800 (winglets)', arfl: 2256, wingspan: 35.79, vat: 142, mtomOver5700: true, checked: false },
  { id: 'b789', name: 'Boeing 787-9', arfl: 2900, wingspan: 60.12, vat: 151, mtomOver5700: true, checked: false },
  { id: 'b77w', name: 'Boeing 777-300ER', arfl: 3200, wingspan: 64.8, vat: 149, mtomOver5700: true, checked: false },
  { id: 'a388', name: 'Airbus A380-800', arfl: 3000, wingspan: 79.75, vat: 138, mtomOver5700: true, checked: false },
  // Review samples from Stage 2 (checked by Dan, 2 to 3 Nov 2026)
  { id: 'sampleA', name: 'Sample A (code 4E, ADG IV)', arfl: 2800, wingspan: 60, vat: 145, mtomOver5700: true, checked: true },
  { id: 'sampleB', name: 'Sample B (code 2A, ADG I)', arfl: 1000, wingspan: 12, vat: 80, mtomOver5700: false, checked: true },
];
