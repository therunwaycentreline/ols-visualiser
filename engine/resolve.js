// Parameter resolution: pick the table column for the configuration, apply
// value modifiers from std.modifiers, select applicable surfaces, attach
// catalogue metadata. Output is dimensions only; geometry comes later.

const norm = s => String(s).trim().toLowerCase();
const asList = x => (Array.isArray(x) ? x : [x]);

function condHolds(cond, value) {
  if (value === undefined || value === null) return false;
  if (cond !== null && typeof cond === 'object') {
    if (cond.gt !== undefined && !(value > cond.gt)) return false;
    if (cond.gte !== undefined && !(value >= cond.gte)) return false;
    if (cond.lt !== undefined && !(value < cond.lt)) return false;
    if (cond.lte !== undefined && !(value <= cond.lte)) return false;
    return true;
  }
  return value === cond;
}

/** True if every condition in modifier.when holds for the config flags. */
export function whenHolds(when, flags) {
  return Object.entries(when).every(([k, c]) => condHolds(c, flags[k]));
}

function catalogueEntry(std, regime, set, name) {
  return std.surface_catalogue.find(
    c => c.regime === regime && c.set === set && norm(c.surface) === norm(name),
  );
}

function buildParams(rawParams, column) {
  const out = {};
  for (const [name, p] of Object.entries(rawParams)) {
    const v = p.values[column];
    if (v === null || v === undefined) continue;
    out[name] = { value: v, base: v, unit: p.unit, note: p.note, rules: [] };
  }
  return out;
}

function applyModifier(params, mod) {
  for (const pname of asList(mod.param)) {
    const p = params[pname];
    if (!p) continue;
    p.value = mod.set;
    p.rules.push(mod.rule);
  }
}

function surfaceMeta(std, regime, set, catName) {
  const c = catalogueEntry(std, regime, set, catName);
  if (!c) throw new Error(`No catalogue entry for ${regime} ${set} ${catName}`);
  return {
    clause: c.clause, obligation: c.obligation, obstacleRule: c.obstacle_rule,
    requiredWhen: c.required_when, heightReference: c.height_reference,
    geometryNotes: c.geometry_notes,
  };
}

// ---------- Legacy ----------

const LEGACY_IDS = {
  'conical': 'legacy_conical',
  'inner horizontal': 'legacy_inner_horizontal',
  'inner approach': 'legacy_inner_approach',
  'approach': 'legacy_approach',
  'transitional': 'legacy_transitional',
  'inner transitional': 'legacy_inner_transitional',
  'balked landing': 'legacy_balked_landing',
  'take-off climb': 'legacy_take_off_climb',
};

export function resolveLegacy(std, cfg) {
  if (!cfg.legacyColumn || !cfg.takeoffColumn) return [];
  const blocks = [
    ...std.legacy.table_4_1.map(s => ({ s, table: 'Table 4-1', column: cfg.legacyColumn })),
    ...std.legacy.table_4_2.map(s => ({ s, table: 'Table 4-2', column: cfg.takeoffColumn })),
  ];
  const out = [];
  for (const { s, table, column } of blocks) {
    const params = buildParams(s.params, column);
    if (!Object.keys(params).length) continue; // surface not applicable to this column
    for (const m of std.modifiers) {
      if (m.regime !== 'legacy' || m.table !== table) continue;
      if (m.columns && !m.columns.includes(column)) continue;
      if (m.block && !m.block.map(norm).includes(norm(s.surface))) continue;
      if (whenHolds(m.when, cfg.flags)) applyModifier(params, m);
    }
    out.push({
      id: LEGACY_IDS[norm(s.surface)],
      regime: 'legacy', set: 'OLS', table, column,
      title: s.surface,
      ...surfaceMeta(std, 'Legacy', 'OLS', s.surface),
      params,
    });
  }
  return out;
}

// ---------- New (Amendment 18) ----------

// table -> [id, set, catalogue surface name]
const NEW_TABLES = {
  'Table 4-1': ['ofs_approach', 'OFS', 'Approach'],
  'Table 4-2': ['ofs_approach', 'OFS', 'Approach'],
  '4.2.2': ['ofs_transitional', 'OFS', 'Transitional'],
  'Table 4-3': ['ofs_inner_approach', 'OFS', 'Inner approach'],
  'Table 4-4': ['ofs_inner_approach', 'OFS', 'Inner approach'],
  'Table 4-5': ['ofs_inner_approach', 'OFS', 'Inner approach'],
  'Table 4-6': ['ofs_inner_transitional', 'OFS', 'Inner transitional'],
  'Table 4-7': ['ofs_inner_transitional', 'OFS', 'Inner transitional'],
  'Table 4-8': ['ofs_inner_transitional', 'OFS', 'Inner transitional'],
  'Table 4-9': ['ofs_balked_landing', 'OFS', 'Balked landing'],
  'Table 4-10': ['oes_horizontal', 'OES', 'Horizontal'],
  'Table 4-11': ['oes_straight_in', 'OES', 'Straight-in instrument approaches'],
  'Table 4-12': ['oes_precision', 'OES', 'Precision approaches'],
  'Table 4-13': ['oes_departure', 'OES', 'Instrument departure'],
  'Table 4-14': ['oes_take_off_climb', 'OES', 'Take-off climb'],
  'Table 4-15': ['oes_take_off_climb', 'OES', 'Take-off climb'],
};

/** Which new-regime tables apply to this configuration (4.5.1, 4.5.2.1). */
export function selectNewTables(cfg) {
  const t = cfg.runwayType;
  const ofs = {
    NI: ['Table 4-1', '4.2.2', 'Table 4-3', 'Table 4-6'],
    NPA: ['Table 4-2', '4.2.2', 'Table 4-4', 'Table 4-7'],
    PA: ['Table 4-2', '4.2.2', 'Table 4-5', 'Table 4-8', 'Table 4-9'],
  }[t] || [];
  const oes = [];
  if (cfg.circlingOrCircuits) oes.push('Table 4-10');
  if (t === 'NPA' && !cfg.circlingOrCircuits) oes.push('Table 4-11');
  if (t === 'PA') oes.push('Table 4-12');
  if (cfg.instrumentDeparture) oes.push('Table 4-13');
  oes.push(cfg.mtomOver5700 ? 'Table 4-15' : 'Table 4-14');
  return [...ofs, ...oes];
}

export function resolveNew(std, cfg) {
  if (!cfg.adg) return [];
  const all = [...std.new.ofs, ...std.new.oes];
  const out = [];
  for (const table of selectNewTables(cfg)) {
    const s = all.find(x => x.table === table);
    const [id, set, catName] = NEW_TABLES[table];
    const params = buildParams(s.params, cfg.adg);
    for (const m of std.modifiers) {
      if (m.regime !== 'new' || !asList(m.table).includes(table)) continue;
      if (m.adg && !m.adg.includes(cfg.adg)) continue;
      if (whenHolds(m.when, cfg.flags)) applyModifier(params, m);
    }
    out.push({
      id, regime: 'new', set, table, column: cfg.adg,
      title: s.surface,
      ...surfaceMeta(std, 'New', set, catName),
      params,
    });
  }
  return out;
}

/** Convenience: both regimes for one configuration. */
export function resolveAll(std, cfg) {
  return { legacy: resolveLegacy(std, cfg), new: resolveNew(std, cfg) };
}
