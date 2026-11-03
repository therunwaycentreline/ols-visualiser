// Stage 4 user interface. Engine modules stay pure; this file owns state,
// the panel, the map and the deck.gl overlay.

import { APPROACH_TYPES, deriveConfig } from '../engine/derive.js';
import { buildGeometry, heightAt } from '../engine/geometry.js';
import { findRunway, runwayInputs } from '../engine/georef.js';
import { indexSurfaces, lowestIndexed, diffGrid, DIFF_CLASSES } from '../engine/compare.js';
import { PRESETS } from './presets.js';
import { SETS, NAMES, PLAIN, COUNTERPART, MODES, APPROACH_LABELS } from './text.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const m1 = v => (Math.round(v * 10) / 10).toFixed(1);
const num = v => (v === '' || v == null || !isFinite(+v)) ? null : +v;
const DIFF_COLOURS = ['#762a83', '#9970ab', '#c2a5cf', '#ececec', '#a6dba0', '#5aae61', '#1b7837', '#9aa3ab', '#3b4650'];
const DEFAULT_ON = new Set(['legacy_approach', 'legacy_transitional',
  'ofs_approach', 'ofs_transitional', 'ofs_inner_approach', 'ofs_inner_transitional']);

// ---------------------------------------------------------------- state

const S = {
  icao: 'YBBN', rwy: '01R',
  preset: 'sampleA', arfl: 2800, wingspan: 60, vat: 145,
  approach: 'PA I', width: null,
  circ: true, idep: null, heavy: true, turn: false, dga: false,
  ov: { ends: [{}, {}] },
  mode: 'overlay', diffSet: 'all',
  on: new Set(DEFAULT_ON), sel: null,
};

const HASH_KEYS = { a: 'icao', r: 'rwy', p: 'preset', arfl: 'arfl', span: 'wingspan', vat: 'vat', ap: 'approach', w: 'width', m: 'mode', d: 'diffSet', s: 'sel' };
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  for (const [k, key] of Object.entries(HASH_KEYS)) if (h.has(k)) {
    const v = h.get(k);
    S[key] = ['arfl', 'wingspan', 'vat', 'width'].includes(key) ? num(v) : v;
  }
  for (const k of ['circ', 'heavy', 'turn', 'dga']) if (h.has(k)) S[k] = h.get(k) === '1';
  if (h.has('idep')) S.idep = h.get('idep') === '1';
  if (h.has('on')) S.on = new Set(h.get('on').split(',').filter(Boolean));
  if (h.has('ov')) try { S.ov = JSON.parse(atob(h.get('ov').replace(/-/g, '+').replace(/_/g, '/'))); } catch { /* ignore */ }
  if (!S.ov?.ends) S.ov = { ends: [{}, {}] };
}
function writeHash() {
  const h = new URLSearchParams();
  for (const [k, key] of Object.entries(HASH_KEYS)) if (S[key] != null && S[key] !== '') h.set(k, S[key]);
  for (const k of ['circ', 'heavy', 'turn', 'dga']) h.set(k, S[k] ? '1' : '0');
  if (S.idep != null) h.set('idep', S.idep ? '1' : '0');
  h.set('on', [...S.on].join(','));
  const ovUsed = S.ov.aerodromeElevation != null || S.ov.ends.some(e => Object.keys(e).length);
  if (ovUsed) h.set('ov', btoa(JSON.stringify(S.ov)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
  history.replaceState(null, '', '#' + h.toString());
}

// ---------------------------------------------------------------- data

const [STD, DATA] = await Promise.all(['./data/ols_standards.json', './data/runways_paved.json'].map(u => fetch(u).then(r => r.json())));
const F = Object.fromEntries(DATA.fields.map((k, i) => [k, i]));
const RWYS = new Map();
for (const r of DATA.rows) {
  const k = r[F.icao];
  if (!RWYS.has(k)) RWYS.set(k, []);
  RWYS.get(k).push({ le: r[F.le], he: r[F.he], len: r[F.len_ft], wid: r[F.wid_ft] });
}
const AIRPORTS = [...RWYS.keys()].map(icao => {
  const a = DATA.airports[icao] || [];
  return { icao, name: a[0] || '', country: a[2] || '', search: `${icao} ${a[0] || ''}`.toUpperCase() };
});

// ---------------------------------------------------------------- compute

let M = null; // current model: { row, I, cfg, G, P, surfaces, polys, rings, idxL, idxN }
let grid = null, gridKey = null;

function compute() {
  const errors = [];
  const row = findRunway(DATA, S.icao, S.rwy);
  if (!row) return { errors: [`${S.icao} runway ${S.rwy} not in the dataset`] };
  const I = runwayInputs(row, S.ov);
  const width = S.width ?? (I.widthM ? Math.round(I.widthM) : null); // whole metres: 148 ft must not read as over 45 m
  const cfg = deriveConfig({
    arfl: S.arfl, wingspan: S.wingspan, vat: S.vat, runwayWidth: width, approach: S.approach,
    digitalGoAroundSteering: S.dga, departureTurn: S.turn, mtomOver5700: S.heavy,
    circlingOrCircuits: S.circ, instrumentDeparture: S.idep ?? undefined,
  }, STD);
  errors.push(...cfg.errors);
  if (I.rw.ends.some(e => e.elevation == null)) errors.push('Threshold elevation missing: enter it under Runway values');
  let G = null;
  if (!errors.length) {
    try { G = buildGeometry(STD, cfg, I.rw); } catch (e) { errors.push(e.message); }
  }
  return { row, I, cfg, G, width, errors };
}

function prepare(m) {
  const P = m.I.placed, W = p => P.toWGS(p);
  const surfaces = [...m.G.legacy, ...m.G.new];
  const polys = [], rings = [];
  const key = p => p.map(c => Math.round(c * 100)).join(',');
  for (const s of surfaces) {
    const rgb = SETS[s.set].rgb;
    for (const ins of s.instances) {
      const edges = new Map();
      for (const f of ins.facets) {
        polys.push({ s, poly: [f.v.map(W), ...(f.holes || []).map(h => h.map(W))], rgb });
        for (const r of [f.v, ...(f.holes || [])]) r.forEach((a, i) => {
          const b = r[(i + 1) % r.length], k = [key(a), key(b)].sort().join('|');
          const e = edges.get(k); e ? e.n++ : edges.set(k, { a, b, n: 1 });
        });
      }
      for (const { a, b, n } of edges.values()) if (n === 1) rings.push({ s, path: [W(a), W(b)], rgb });
    }
  }
  const hw = (m.width || 45) / 2, d1 = m.I.geo.displaced[0], Lend = P.length - d1;
  const zr = x => m.G.runway.profile(x);
  const pave = [[-d1, -hw], [-d1, hw], [Lend, hw], [Lend, -hw]].map(([x, y]) => W([x, y, zr(x) + 0.3]));
  const thr = m.G.runway.thresholdX.map(x => [W([x, -hw, zr(x) + 0.4]), W([x, hw, zr(x) + 0.4])]);
  return { ...m, P, W, surfaces, polys, rings, pave, thr, idxL: indexSurfaces(m.G.legacy), idxN: indexSurfaces(m.G.new) };
}

const inMode = s => S.mode === 'overlay' || (S.mode === 'legacy' && s.set === 'OLS') || (S.mode === 'new' && s.set !== 'OLS');
const visible = s => S.mode !== 'diff' && inMode(s) && S.on.has(s.id);

// ---------------------------------------------------------------- map and layers

const map = window.map = new maplibregl.Map({
  container: 'map', attributionControl: false, maxPitch: 80, center: [153.117, -27.384], zoom: 12, pitch: 60,
  style: { version: 8, sources: {
    img: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19 },
    omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
    dem: { type: 'raster-dem', encoding: 'terrarium', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 14 },
  }, layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#3a4148' } },
    { id: 'img', type: 'raster', source: 'img' },
    { id: 'bld', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 13, paint: {
      'fill-extrusion-color': '#d9dde2', 'fill-extrusion-opacity': 0.85,
      'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0] } },
  ], terrain: { source: 'dem', exaggeration: 1 } },
});
map.touchPitch.enable();

const ON_TOP = { depthCompare: 'always', depthWriteEnabled: false };
const dashExt = new deck.PathStyleExtension({ dash: true });
function layers() {
  if (!M?.G) return [];
  const showSurf = S.mode !== 'diff';
  const sel = S.sel;
  return [
    new deck.PolygonLayer({ id: 'rwy', data: [{ p: M.pave }], getPolygon: d => d.p, getFillColor: [245, 245, 245, 150], stroked: false, _full3d: true, parameters: ON_TOP }),
    new deck.PathLayer({ id: 'thr', data: M.thr, getPath: d => d, getColor: [20, 200, 120, 255], widthUnits: 'pixels', getWidth: 3, parameters: ON_TOP }),
    new deck.SolidPolygonLayer({
      id: 'surf', data: showSurf ? M.polys.filter(d => visible(d.s)) : [], getPolygon: d => d.poly, _full3d: true,
      getFillColor: d => [...d.rgb, d.s.id === sel ? 120 : d.s.set === 'OLS' ? 55 : 70],
      pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 60], updateTriggers: { getFillColor: [sel] },
    }),
    new deck.PathLayer({
      id: 'edge-new', data: showSurf ? M.rings.filter(d => visible(d.s) && d.s.set !== 'OLS') : [], getPath: d => d.path,
      getColor: d => d.s.id === sel ? [255, 255, 255, 255] : [...d.rgb, 230], widthUnits: 'pixels', getWidth: d => d.s.id === sel ? 2.5 : 1.5,
      updateTriggers: { getColor: [sel], getWidth: [sel] },
    }),
    new deck.PathLayer({
      id: 'edge-ols', data: showSurf ? M.rings.filter(d => visible(d.s) && d.s.set === 'OLS') : [], getPath: d => d.path,
      getColor: d => d.s.id === sel ? [255, 255, 255, 255] : [...d.rgb, 240], widthUnits: 'pixels', getWidth: d => d.s.id === sel ? 2.5 : 2,
      getDashArray: [6, 4], dashJustified: true, extensions: [dashExt], updateTriggers: { getColor: [sel], getWidth: [sel] },
    }),
  ];
}

const tip = $('tip');
function showTip(html, x, y) {
  tip.innerHTML = html; tip.style.display = 'block';
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.max(4, Math.min(x + 14, innerWidth - r.width - 8)) + 'px';
  tip.style.top = Math.max(4, Math.min(y + 14, innerHeight - r.height - 8)) + 'px';
}
const hideTip = () => { tip.style.display = 'none'; };

function surfTip(s, coord) {
  const [x, y] = M.P.fromWGS(coord);
  let z = null;
  for (const ins of s.instances) { const h = heightAt(ins.facets, x, y); if (h !== null && (z === null || h < z)) z = h; }
  return `<b>${SETS[s.set].label}: ${esc(NAMES[s.id] || s.title)}</b>${esc(s.clause)} · ${esc(s.obligation || '')}`
    + (z !== null ? `<br><span class="m">${m1(z)} m</span> AMSL · <span class="m">${m1(z - M.G.runway.highestThreshold)} m</span> above highest THR` : '');
}

const overlay = new deck.MapboxOverlay({
  interleaved: true, layers: [],
  onHover: info => {
    if (S.mode === 'diff') return;
    if (!info.object || !info.coordinate) return hideTip();
    showTip(surfTip(info.object.s, info.coordinate) + '<br><span class="note">Click for details</span>', info.x, info.y);
  },
  onClick: info => {
    if (S.mode === 'diff' || !info.object) return;
    select(info.object.s.id);
    if (info.coordinate) showTip(surfTip(info.object.s, info.coordinate), info.x, info.y);
  },
});
const render = () => overlay.setProps({ layers: layers() });

const mapReady = new Promise(res => map.on('load', () => {
  map.addSource('cl', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'cl', type: 'line', source: 'cl', paint: { 'line-color': '#ffd400', 'line-width': 1.5 } });
  map.addControl(overlay);
  res();
}));

// Difference grid as a draped image (MapLibre raster layers drape on the terrain)
const canvas = document.createElement('canvas');
function drawDiff() {
  const key = JSON.stringify([S.icao, S.rwy, S.arfl, S.wingspan, S.vat, S.approach, S.width, S.circ, S.idep, S.heavy, S.turn, S.dga, S.ov, S.diffSet]);
  if (key !== gridKey) {
    const t = performance.now();
    const cell = innerWidth < 700 ? 150 : 100;
    grid = diffGrid(M.idxL, M.idxN, { cell, newFilter: S.diffSet === 'ofs' ? f => f.set === 'OFS' : undefined });
    gridKey = key;
    $('diff-status').textContent = `${grid.nx} × ${grid.ny} cells of ${cell} m, computed in ${Math.round(performance.now() - t)} ms.`;
  }
  const g = grid;
  canvas.width = g.nx; canvas.height = g.ny;
  const ctx = canvas.getContext('2d'), img = ctx.createImageData(g.nx, g.ny);
  const rgb = DIFF_COLOURS.map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)));
  const counts = new Array(DIFF_CLASSES.length).fill(0);
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
    const c = g.cls[j * g.nx + i]; // row j in grid is y increasing; canvas row 0 is the top (largest y)
    const p = ((g.ny - 1 - j) * g.nx + i) * 4;
    if (c < 0) { img.data[p + 3] = 0; continue; }
    counts[c]++;
    img.data.set([...rgb[c], 205], p);
  }
  ctx.putImageData(img, 0, 0);
  const x1 = g.x0 + g.nx * g.cell, y1 = g.y0 + g.ny * g.cell;
  const coordinates = [[g.x0, y1], [x1, y1], [x1, g.y0], [g.x0, g.y0]].map(([x, y]) => M.W([x, y, 0]).slice(0, 2));
  const src = map.getSource('diff');
  if (src) src.updateImage({ url: canvas.toDataURL(), coordinates });
  else {
    map.addSource('diff', { type: 'image', url: canvas.toDataURL(), coordinates });
    map.addLayer({ id: 'diff', type: 'raster', source: 'diff', paint: { 'raster-resampling': 'nearest', 'raster-opacity': 0.85, 'raster-fade-duration': 0 } }, 'bld');
  }
  const area = g.cell * g.cell / 1e6;
  $('diff-legend').innerHTML = DIFF_CLASSES.map((c, i) =>
    `<li><span class="sw" style="background:${DIFF_COLOURS[i]}"></span>${esc(c.label)}<span class="n">${counts[i] ? (counts[i] * area).toFixed(1) + ' km²' : ''}</span></li>`).join('');
  return coordinates;
}
function clearDiff() { if (map.getLayer('diff')) map.setLayoutProperty('diff', 'visibility', 'none'); }

map.on('mousemove', e => {
  if (S.mode !== 'diff' || !M?.G) return;
  const [x, y] = M.P.fromWGS([e.lngLat.lng, e.lngLat.lat]);
  const l = lowestIndexed(M.idxL, x, y), n = lowestIndexed(M.idxN, x, y, S.diffSet === 'ofs' ? f => f.set === 'OFS' : undefined);
  if (!l && !n) return hideTip();
  const line = (r, lbl) => r ? `${lbl}: ${esc(SETS[r.set].short)} ${esc(NAMES[r.id])} <span class="m">${m1(r.z)} m</span>` : `${lbl}: none`;
  const d = l && n ? n.z - l.z : null;
  showTip(`<b>${d == null ? (l ? 'Legacy surface only' : 'New surface only') : Math.abs(d) <= 1 ? 'About the same' : d < 0 ? `New is ${m1(-d)} m lower` : `New is ${m1(d)} m higher`}</b>${line(l, 'Legacy')}<br>${line(n, 'New')}<br><span class="note">Heights AMSL</span>`, e.point.x, e.point.y);
});
map.on('mouseout', hideTip);

// ---------------------------------------------------------------- camera

let topView = false;
function camera(animate = true) {
  if (!M?.G) return;
  const P = M.P, W = M.W;
  let opts;
  if (S.mode === 'diff' || topView) {
    const e = S.mode === 'diff' && grid ? { x0: grid.x0, x1: grid.x0 + grid.nx * grid.cell, y0: grid.y0, y1: grid.y0 + grid.ny * grid.cell }
      : { x0: -4500, x1: P.Lt + 4500, y0: -3000, y1: 3000 };
    const pts = [[e.x0, e.y0], [e.x1, e.y0], [e.x1, e.y1], [e.x0, e.y1]].map(([x, y]) => W([x, y, 0]));
    const b = pts.reduce((a, p) => [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[2], p[0]), Math.max(a[3], p[1])], [180, 90, -180, -90]);
    const cam = map.cameraForBounds([[b[0], b[1]], [b[2], b[3]]], { padding: padding() });
    opts = { ...cam, pitch: 0, bearing: 0 };
  } else {
    opts = { center: W([-1500, 0, 0]).slice(0, 2), zoom: P.Lt > 2500 ? 13.1 : 13.6, pitch: 60, bearing: P.bearing, padding: padding() };
  }
  animate ? map.easeTo({ ...opts, duration: 900 }) : map.jumpTo(opts);
}
function padding() {
  const p = $('panel').getBoundingClientRect();
  return innerWidth < 700 ? { top: 40, bottom: Math.min(p.height, innerHeight * 0.55), left: 10, right: 10 }
    : { top: 20, bottom: 20, left: p.right + 10, right: 20 };
}

// ---------------------------------------------------------------- panel: setup

$('preset').innerHTML = '<option value="">Custom</option>' + PRESETS.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
$('approach').innerHTML = APPROACH_TYPES.map(a => `<option value="${a}">${esc(APPROACH_LABELS[a])}</option>`).join('');

function setupFromState() {
  $('q').value = S.icao;
  $('preset').value = S.preset || '';
  $('arfl').value = S.arfl ?? ''; $('span').value = S.wingspan ?? ''; $('vat').value = S.vat ?? '';
  $('approach').value = S.approach;
  for (const k of ['circ', 'heavy', 'turn', 'dga']) $('f-' + k).checked = S[k];
}

function renderRunways() {
  const list = RWYS.get(S.icao) || [];
  $('rwys').innerHTML = list.length ? list.map(r => {
    const on = r.le === S.rwy || r.he === S.rwy;
    const dims = r.len ? `${Math.round(r.len * 0.3048)}${r.wid ? ' × ' + Math.round(r.wid * 0.3048) : ''} m` : '';
    return `<button type="button" data-r="${esc(r.le)}" aria-pressed="${on}">${esc(r.le)}/${esc(r.he)} <small>${dims}</small></button>`;
  }).join('') : '<span class="sub">No paved runways with both end coordinates for this airport.</span>';
}

function renderDerived(m) {
  const c = m.cfg;
  const p = PRESETS.find(p => p.id === S.preset);
  $('preset-note').innerHTML = p && !p.checked ? 'Indicative values <span class="badge">not yet verified</span>' : '';
  const row = (k, v, why) => `<dt>${k}</dt><dd><b>${esc(v ?? 'n/a')}</b>${why ? ' · ' + esc(why) : ''}</dd>`;
  const band = (x, bands, key) => { const b = bands.find(b => (b.gte === undefined || x >= b.gte) && (b.lt === undefined || x < b.lt)); return !b ? '' : b.lt === undefined ? `${b.gte} m or more` : b.gte === undefined ? `under ${b.lt} m` : `${b.gte} to under ${b.lt} m`; };
  $('derived').innerHTML = `<dl class="kv" style="grid-column:1/-1">`
    + row('Code number', c.codeNumber, S.arfl ? `ARFL ${S.arfl} m (${band(S.arfl, STD.derivation.code_number.bands)})` : '')
    + row('Code letter', c.codeLetter, S.wingspan ? `span ${S.wingspan} m (${band(S.wingspan, STD.derivation.code_letter.bands)})` : '')
    + row('ADG', c.adg, c.vat ? `Vat ${Math.round(c.vat)} kt, span ${S.wingspan} m` : '')
    + row('Legacy column', c.legacyColumn, `take-off ${c.takeoffColumn ?? 'n/a'}`)
    + row('New runway type', { NI: 'Non-instrument', NPA: 'Non-precision', PA: 'Precision' }[c.runwayType] ?? null)
    + '</dl>';
  $('f-dga').disabled = c.codeLetter !== 'F';
  $('f-dga').closest('label').classList.toggle('off', c.codeLetter !== 'F');
  $('f-idep').checked = c.instrumentDeparture;
  $('width').value = S.width ?? (m.width ?? '');
  $('width-src').innerHTML = S.width != null ? '<span class="src user">User</span>' : m.width ? '<span class="src">OurAirports</span>' : '<span class="src fb">Missing: enter width</span>';
}

const RV_FIELDS = [['lat', 'Lat', 6], ['lon', 'Lon', 6], ['elevation', 'THR elev (m)', 1], ['displaced', 'Displaced (m)', 0], ['clearway', 'Clearway (m)', 0], ['stripExtension', 'Strip beyond end (m)', 0]];
function renderRunwayValues(m) {
  const I = m.I;
  const srcCls = s => s === 'Fallback' ? 'fb' : s === 'User' ? 'user' : '';
  const cell = (i, f, d) => {
    const x = I.values.ends[i][f];
    return `<td><input type="number" step="any" data-end="${i}" data-f="${f}" value="${x?.value != null ? (+x.value).toFixed(d) : ''}"><div class="src ${srcCls(x?.source)}">${esc(x?.source ?? 'n/a')}</div></td>`;
  };
  const ad = I.values.aerodromeElevation;
  $('rvals').innerHTML = `<table class="rv"><tr><th></th><th>${esc(I.idents[0])}</th><th>${esc(I.idents[1])}</th></tr>`
    + RV_FIELDS.map(([f, label, d]) => `<tr><th>${label}</th>${cell(0, f, d)}${cell(1, f, d)}</tr>`).join('')
    + `<tr><th>AD elev (m)</th><td colspan="2"><input type="number" step="any" data-f="aerodromeElevation" value="${ad?.value != null ? (+ad.value).toFixed(1) : ''}"><div class="src ${srcCls(ad?.source)}">${esc(ad?.source ?? 'n/a')}</div></td></tr>`
    + `<tr><th>Length</th><td colspan="2" class="n" style="text-align:left">${m1(I.values.length.value)} m <span class="src">from end coordinates${I.values.lengthListed ? `; listed ${m1(I.values.lengthListed)} m` : ''}</span></td></tr></table>`;
}

// ---------------------------------------------------------------- panel: surfaces

function renderModes() {
  $('modes').innerHTML = MODES.map(md => `<button type="button" role="radio" data-m="${md.id}" aria-checked="${S.mode === md.id}">${md.label}</button>`).join('');
  $('mode-blurb').textContent = MODES.find(md => md.id === S.mode).blurb;
  $('diff').hidden = S.mode !== 'diff';
  $('sets').hidden = S.mode === 'diff';
  document.querySelectorAll('#diff-set button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === S.diffSet));
}

function renderSets() {
  if (!M?.G) { $('sets').innerHTML = ''; return; }
  $('sets').innerHTML = Object.entries(SETS).map(([set, X]) => {
    const list = M.surfaces.filter(s => s.set === set && inMode(s));
    if (!list.length) return '';
    const n = list.filter(s => S.on.has(s.id)).length;
    return `<div class="set"><div class="row"><label class="head"><input type="checkbox" data-set="${set}" ${n === list.length ? 'checked' : ''}><span class="sw ${set.toLowerCase()}"></span>${X.label}</label></div>
      <div class="blurb">${esc(X.blurb)}</div>
      ${list.map(s => `<div class="row indent ${S.sel === s.id ? 'sel' : ''}"><label><input type="checkbox" data-id="${s.id}" ${S.on.has(s.id) ? 'checked' : ''}>${esc(NAMES[s.id] || s.title)} <span class="src">${esc(s.clause)}</span></label><button type="button" class="info" data-info="${s.id}" aria-label="Details for ${esc(X.short)} ${esc(NAMES[s.id])}">i</button></div>`).join('')}</div>`;
  }).join('');
  document.querySelectorAll('[data-set]').forEach(h => {
    const ids = M.surfaces.filter(s => s.set === h.dataset.set && inMode(s)).map(s => s.id);
    const n = ids.filter(i => S.on.has(i)).length;
    h.indeterminate = n > 0 && n < ids.length;
  });
}

// ---------------------------------------------------------------- panel: details

const fmtVal = p => {
  const f = v => v == null ? 'n/a' : typeof v === 'string' ? v : p.unit === '%' ? `${+(v * 100).toFixed(2)} %` : `${v.toLocaleString('en-AU')} ${p.unit || ''}`;
  return p.base !== undefined && p.base !== p.value ? `${f(p.base)} → ${f(p.value)}` : f(p.value);
};

function renderDetail() {
  const s = M?.G && M.surfaces.find(x => x.id === S.sel);
  if (!s) { $('detail').innerHTML = '<p class="sub">Click or tap a surface on the map, or the i next to a name in the Surfaces list, to see its dimensions, clause and obstacle rule.</p>'; return; }
  const X = SETS[s.set], cp = COUNTERPART[s.id] && M.surfaces.find(x => x.id === COUNTERPART[s.id]);
  const hidden = !visible(s);
  const params = Object.entries(s.params || {}).map(([k, p]) => `<tr class="${p.rules?.length ? 'mod' : ''}"><td>${esc(k)}${p.rules?.length ? ` <span class="rule">${p.rules.map(esc).join(', ')}</span>` : ''}${p.note ? `<div class="note">${esc(p.note)}</div>` : ''}</td><td class="n">${esc(fmtVal(p))}</td></tr>`).join('');
  const dirName = d => d == null ? '' : `RWY ${M.I.idents[d - 1]} operations`;
  const pts = s.instances.filter(i => i.points?.length).map(i => `<h3>Key heights${i.direction ? ': ' + esc(dirName(i.direction)) : ''}</h3><table>`
    + i.points.map(p => `<tr><td>${esc(p.label)}</td><td class="n">${m1(p.p[2])} m</td></tr>`).join('') + '</table>').join('');
  $('detail').innerHTML = `<h2><span class="sw ${s.set.toLowerCase()}" style="display:inline-block;vertical-align:-1px"></span> ${esc(X.label)}</h2>
    <h1>${esc(NAMES[s.id] || s.title)}</h1>
    <p class="plain">${esc(PLAIN[s.id] || '')}</p>
    ${hidden ? `<button type="button" class="link" data-show="${s.id}">Show on map</button>` : ''}
    <dl class="kv">
      <dt>Clause</dt><dd>${esc(s.clause)} · ${esc(s.table)}${s.column ? `, column ${esc(s.column)}` : ''}</dd>
      <dt>Obligation</dt><dd>${esc(s.obligation)}</dd>
      <dt>Required when</dt><dd>${esc(s.requiredWhen)}</dd>
      <dt>Obstacle rule</dt><dd>${esc(s.obstacleRule)}</dd>
      <dt>Height reference</dt><dd>${esc(s.heightReference)}</dd>
      ${s.geometryNotes ? `<dt>Geometry</dt><dd>${esc(s.geometryNotes)}</dd>` : ''}
      ${s.geomRules?.length ? `<dt>Rules applied</dt><dd>${s.geomRules.map(r => `<span class="rule">${esc(r)}</span>`).join('')}</dd>` : ''}
    </dl>
    <h3>Dimensions</h3><table>${params}</table>
    ${pts}
    ${cp ? `<p><button type="button" class="link" data-info="${cp.id}">Compare: ${esc(SETS[cp.set].label)} ${esc(NAMES[cp.id])}</button></p>` : ''}`;
}

function select(id) {
  S.sel = id;
  if (id && !S.on.has(id)) { /* keep visibility as user set; detail offers "Show on map" */ }
  tab('details'); renderSets(); renderDetail(); render(); writeHash();
  if (innerWidth < 700) $('panel').classList.remove('collapsed');
}

// ---------------------------------------------------------------- tabs, collapse

function tab(name) {
  document.querySelectorAll('.tabs [role=tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach(t => { t.hidden = t.id !== 'tab-' + name; });
}
document.querySelector('.tabs').addEventListener('click', e => { if (e.target.dataset.tab) tab(e.target.dataset.tab); });
$('grip').onclick = () => {
  const c = $('panel').classList.toggle('collapsed');
  $('grip').setAttribute('aria-expanded', !c);
};

// ---------------------------------------------------------------- update cycle

let lastRunwayKey = null;
async function update({ recentre = false } = {}) {
  const m = compute();
  $('err').textContent = m.errors.join('. ');
  renderRunways();
  if (m.cfg) renderDerived(m);
  if (m.I) renderRunwayValues(m);
  $('warns').innerHTML = m.I ? [...m.I.warnings, ...(m.cfg?.warnings || [])].map(w => `<li>${esc(w)}</li>`).join('') : '';
  if (m.row) {
    $('title').textContent = `${m.row.icao} RWY ${m.I.idents.join('/')} · ${m.row.airport?.name ?? ''}`;
  }
  if (m.G) {
    M = prepare(m);
    const c = m.cfg;
    $('cfg').textContent = `Code ${c.codeNumber}${c.codeLetter} · ADG ${c.adg} · ${APPROACH_LABELS[c.approach]} · ${Math.round(M.P.length)} m × ${m.width} m · ${M.P.bearing.toFixed(1)}° T`;
  } else {
    M = m.I ? { ...m } : null;
    $('cfg').textContent = 'Fix the inputs marked below to draw surfaces.';
  }
  if (S.sel && M?.G && !M.surfaces.some(s => s.id === S.sel)) S.sel = null;
  renderModes(); renderSets(); renderDetail();
  writeHash();
  await mapReady;
  if (m.row) {
    map.getSource('cl').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[m.row.le_lon, m.row.le_lat], [m.row.he_lon, m.row.he_lat]] } });
  }
  render();
  if (M?.G && S.mode === 'diff') { map.getLayer('diff') && map.setLayoutProperty('diff', 'visibility', 'visible'); drawDiff(); }
  else clearDiff();
  const rk = `${S.icao}/${S.rwy}`;
  if (M?.G && (recentre || rk !== lastRunwayKey)) { camera(lastRunwayKey !== null); lastRunwayKey = rk; }
  window.__ready = true;
}

let timer = null;
const later = () => { clearTimeout(timer); timer = setTimeout(update, 200); };

// ---------------------------------------------------------------- events

// Airport search
const qList = $('q-list');
let hits = [], hi = 0;
function search() {
  const q = $('q').value.trim().toUpperCase();
  if (!q) { qList.hidden = true; return; }
  const a = AIRPORTS.filter(x => x.icao.startsWith(q));
  const b = q.length >= 3 ? AIRPORTS.filter(x => !x.icao.startsWith(q) && x.search.includes(q)) : [];
  hits = [...a.sort((x, y) => x.icao.length - y.icao.length || x.icao.localeCompare(y.icao)), ...b].slice(0, 8);
  hi = 0;
  qList.innerHTML = hits.length ? hits.map((x, i) => `<li role="option" data-i="${i}" aria-selected="${i === hi}"><b>${esc(x.icao)}</b><span>${esc(x.name)} <span class="src">${esc(x.country)}</span></span></li>`).join('')
    : '<li class="sub">No match in the paved runway dataset</li>';
  qList.hidden = false;
}
function pickAirport(x) {
  if (!x) return;
  S.icao = x.icao; $('q').value = x.icao; qList.hidden = true;
  const r = RWYS.get(x.icao)?.slice().sort((p, q) => (q.len || 0) - (p.len || 0))[0];
  S.rwy = r ? r.le : '';
  S.width = null; S.ov = { ends: [{}, {}] }; S.sel = null;
  update({ recentre: true });
}
$('q').addEventListener('input', search);
$('q').addEventListener('focus', () => { $('q').select(); });
$('q').addEventListener('keydown', e => {
  if (qList.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); hi = (hi + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
    qList.querySelectorAll('li').forEach((li, i) => li.setAttribute('aria-selected', i === hi));
  } else if (e.key === 'Enter') { e.preventDefault(); pickAirport(hits[hi]); }
  else if (e.key === 'Escape') qList.hidden = true;
});
qList.addEventListener('mousedown', e => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); pickAirport(hits[+li.dataset.i]); } });
$('q').addEventListener('blur', () => setTimeout(() => { qList.hidden = true; }, 150));

$('rwys').addEventListener('click', e => {
  const b = e.target.closest('button[data-r]'); if (!b) return;
  S.rwy = b.dataset.r; S.width = null; S.ov = { ends: [{}, {}] }; S.sel = null;
  update({ recentre: true });
});

// Aeroplane
$('preset').addEventListener('change', e => {
  S.preset = e.target.value;
  const p = PRESETS.find(p => p.id === S.preset);
  if (p) { Object.assign(S, { arfl: p.arfl, wingspan: p.wingspan, vat: p.vat, heavy: p.mtomOver5700 }); setupFromState(); }
  update();
});
for (const [id, key] of [['arfl', 'arfl'], ['span', 'wingspan'], ['vat', 'vat']]) {
  $(id).addEventListener('input', e => { S[key] = num(e.target.value); S.preset = ''; $('preset').value = ''; later(); });
}
$('b-vat').onclick = () => {
  const vso = num($('vso').value), vs1g = num($('vs1g').value);
  const c = [vso && 1.3 * vso, vs1g && 1.23 * vs1g].filter(Boolean);
  if (!c.length) return;
  S.vat = Math.round(Math.max(...c) * 10) / 10; $('vat').value = S.vat; S.preset = ''; $('preset').value = ''; update();
};

// Runway use
$('approach').addEventListener('change', e => { S.approach = e.target.value; S.idep = null; update(); });
$('width').addEventListener('input', e => { S.width = num(e.target.value); later(); });
for (const k of ['circ', 'heavy', 'turn', 'dga']) $('f-' + k).addEventListener('change', e => { S[k] = e.target.checked; update(); });
$('f-idep').addEventListener('change', e => { S.idep = e.target.checked; update(); });

// Runway value overrides
$('rvals').addEventListener('change', e => {
  const t = e.target; if (!t.dataset.f) return;
  const v = num(t.value);
  if (t.dataset.end == null) { v == null ? delete S.ov.aerodromeElevation : S.ov.aerodromeElevation = v; }
  else { const o = S.ov.ends[+t.dataset.end]; v == null ? delete o[t.dataset.f] : o[t.dataset.f] = v; }
  update();
});
$('b-reset').onclick = () => { S.ov = { ends: [{}, {}] }; S.width = null; update(); };

// Surfaces
$('modes').addEventListener('click', e => {
  const b = e.target.closest('[data-m]'); if (!b) return;
  const was = S.mode; S.mode = b.dataset.m; hideTip();
  update().then(() => { if ((was === 'diff') !== (S.mode === 'diff')) camera(); });
});
$('diff-set').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; S.diffSet = b.dataset.v; update(); });
$('sets').addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.id) t.checked ? S.on.add(t.dataset.id) : S.on.delete(t.dataset.id);
  if (t.dataset.set) M.surfaces.filter(s => s.set === t.dataset.set && inMode(s)).forEach(s => t.checked ? S.on.add(s.id) : S.on.delete(s.id));
  renderSets(); renderDetail(); render(); writeHash();
});
document.addEventListener('click', e => {
  const i = e.target.closest('[data-info]'); if (i) return select(i.dataset.info);
  const sh = e.target.closest('[data-show]');
  if (sh) {
    const s = M.surfaces.find(x => x.id === sh.dataset.show);
    S.on.add(s.id);
    if (!inMode(s)) S.mode = 'overlay';
    update();
  }
});

// View buttons
let ter = true, bld = true;
$('b-ter').onclick = e => { ter = !ter; map.setTerrain(ter ? { source: 'dem', exaggeration: 1 } : null); e.target.setAttribute('aria-pressed', ter); };
$('b-bld').onclick = e => { bld = !bld; map.setLayoutProperty('bld', 'visibility', bld ? 'visible' : 'none'); e.target.setAttribute('aria-pressed', bld); };
$('b-top').onclick = e => { topView = !topView; e.target.textContent = topView ? '3D view' : 'Top view'; camera(); };

// ---------------------------------------------------------------- start

readHash();
setupFromState();
if (innerWidth < 700) { $('panel').classList.add('collapsed'); $('grip').setAttribute('aria-expanded', 'false'); }
if (S.sel) tab('details');
await update({ recentre: true });
window.__S = S; window.__M = () => M;
