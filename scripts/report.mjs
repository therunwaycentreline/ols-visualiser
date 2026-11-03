// Build a static HTML progress report from the engine: derived config and
// resolved dimensions for the review samples, footnote rule status, test results.
// Usage: node scripts/report.mjs <out.html>
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { deriveConfig } from '../engine/derive.js';
import { resolveLegacy, resolveNew } from '../engine/resolve.js';
import { RULE_STATUS } from '../engine/rule_status.js';
import { buildGeometry, lowestAt } from '../engine/geometry.js';

const root = new URL('..', import.meta.url);
const std = JSON.parse(readFileSync(new URL('data/ols_standards.json', root)));
const out = process.argv[2] || 'report.html';

const SAMPLES = [
  { name: 'Sample A', blurb: 'Code 4 precision approach (CAT I), ADG IV aeroplane',
    input: { arfl: 2800, wingspan: 60, vat: 145, runwayWidth: 45, approach: 'PA I' },
    runway: { length: 3000, ends: [{ elevation: 10 }, { elevation: 10 }] } },
  { name: 'Sample B', blurb: 'Code 2 non-instrument runway, ADG I aeroplane',
    input: { arfl: 1000, wingspan: 12, vat: 80, runwayWidth: 18, approach: 'NI', mtomOver5700: false },
    runway: { length: 1000, ends: [{ elevation: 100 }, { elevation: 100 }] } },
];

// ---- tests ----
let tap = '';
try {
  tap = execFileSync(process.execPath, ['--test', '--test-reporter=tap', 'engine/test/derive_resolve.test.js', 'engine/test/geometry.test.js'],
    { cwd: new URL('.', root).pathname, encoding: 'utf8' });
} catch (e) { tap = e.stdout || ''; }
const tests = [...tap.matchAll(/^(not ok|ok) \d+ - (.+)$/gm)].map(m => ({ ok: m[1] === 'ok', name: m[2] }));
const passed = tests.filter(t => t.ok).length;

// ---- formatting ----
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function fmt(p) {
  const v = p.value;
  if (typeof v === 'string') return `<span class="ref">${esc(v)}</span>`;
  if (p.unit === '%') return `${+(v * 100).toFixed(2)}<span class="u">%</span>`;
  if (p.unit === 'm') return `${v.toLocaleString('en-AU').replace(/,/g, ' ')}<span class="u">m</span>`;
  return esc(v);
}
function paramRows(s) {
  return Object.entries(s.params).map(([k, p]) => {
    const changed = p.rules.length
      ? `<span class="chip mod" title="Changed from ${esc(p.base)}">${p.rules.map(esc).join(', ')}</span>` : '';
    return `<tr><th scope="row">${esc(k)}</th><td class="num">${fmt(p)}${changed}</td></tr>`;
  }).join('');
}
const n0 = v => Math.round(v).toLocaleString('en-AU').replace(/,/g, ' ');
const n1 = v => (Math.round(v * 10) / 10).toLocaleString('en-AU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).replace(/,/g, ' ');
const SET_CLASS = { OLS: 'legacy', OFS: 'ofs', OES: 'oes' };

function pointsTable(s, z0) {
  const ins = s.instances[0];
  if (!ins.points.length) return '';
  const rows = ins.points.map(({ label, p }) =>
    `<tr><th scope="row">${esc(label)}</th><td class="num">${n0(p[0])}</td><td class="num">${n0(p[1] + 0)}</td><td class="num">${n1(p[2] - z0)}</td></tr>`).join('');
  const dir = ins.direction ? `Direction ${ins.direction} shown; direction ${ins.direction === 1 ? 2 : 1} mirrors it.` : 'One surface for the runway.';
  return `<div class="scroll inner"><table class="pts"><caption>Worked points (m). ${dir}</caption>
  <thead><tr><th scope="col">Point</th><th scope="col">x</th><th scope="col">y</th><th scope="col">Height</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function surfaceBlock(s, z0) {
  const g = s.geomRules.length ? `<span class="chip geo" title="Footnote rules applied by the geometry step">${s.geomRules.map(esc).join(', ')}</span>` : '';
  return `<details class="surf ${SET_CLASS[s.set]}">
  <summary><span class="sname">${esc(s.title)}${g}</span><span class="meta">${esc(s.table)} · ${esc(s.clause)}</span></summary>
  <table class="params">${paramRows(s)}</table>
  ${pointsTable(s, z0)}
  <p class="ob"><b>${esc(s.obligation)}.</b> ${esc(s.obstacleRule)}</p>
</details>`;
}

// ---- long section along the centre line ----
function longSection(G, key) {
  const m = G.runway, z0 = m.zt[0];
  const groups = [
    ['legacy', 'Legacy OLS', G.legacy],
    ['ofs', 'OFS', G.new.filter(s => s.set === 'OFS')],
    ['oes', 'OES', G.new.filter(s => s.set === 'OES')],
  ];
  const X0 = -16000, X1 = m.Lt + 16000, step = 25;
  const xs = []; for (let x = X0; x <= X1 + 1e-9; x += step) xs.push(x);
  const series = groups.map(([k, name, surfs]) => ({ k, name,
    pts: xs.map(x => { const r = lowestAt(surfs, x, 0); return r ? [r.z - z0, r.title + (r.direction ? ` (dir ${r.direction})` : '')] : null; }) }));
  const yMax = 350;
  const W = 960, H = 320, L = 48, R = 92, T = 14, B = 34;
  const sx = x => L + ((x - X0) / (X1 - X0)) * (W - L - R);
  const sy = z => T + (1 - Math.min(z, yMax) / yMax) * (H - T - B);
  const paths = series.map(se => {
    let d = '', pen = false;
    se.pts.forEach((p, i) => {
      if (!p || p[0] > yMax) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${sx(xs[i]).toFixed(1)},${sy(p[0]).toFixed(1)}`; pen = true;
    });
    return `<path class="ln ${se.k}" d="${d}"/>`;
  }).join('');
  const labels = series.map(se => {
    let i = se.pts.length - 1; while (i > 0 && (!se.pts[i] || se.pts[i][0] > yMax)) i--;
    return se.pts[i] ? { k: se.k, name: se.name, y: sy(se.pts[i][0]) } : null;
  }).filter(Boolean).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 14);
  const lab = labels.map(l => `<text class="dl ${l.k}t" x="${W - R + 8}" y="${(l.y + 4).toFixed(1)}">${esc(l.name)}</text>`).join('');
  let grid = '';
  for (let z = 0; z <= yMax; z += 50) grid += `<line class="grid" x1="${L}" x2="${W - R}" y1="${sy(z)}" y2="${sy(z)}"/><text class="tick" x="${L - 6}" y="${sy(z) + 4}" text-anchor="end">${z}</text>`;
  for (let km = Math.ceil(X0 / 4000) * 4; km * 1000 <= X1; km += 4) grid += `<text class="tick" x="${sx(km * 1000)}" y="${H - B + 16}" text-anchor="middle">${km}</text>`;
  const rwy = `<line class="rwy" x1="${sx(m.endX[0])}" x2="${sx(m.endX[1])}" y1="${sy(0)}" y2="${sy(0)}"/>`;
  const data = JSON.stringify({ X0, step, series: series.map(s => ({ k: s.k, name: s.name, pts: s.pts.map(p => p && [Math.round(p[0] * 10) / 10, p[1]]) })) });
  return `<figure class="chart" data-key="${key}">
  <figcaption><b>Long section on the centre line.</b> Lowest surface of each set, height above threshold 1 (m) against distance from threshold 1 (km). Runway in black; direction 1 approaches from the left. Over the runway the lowest surfaces are the opposite-direction balked landings and, for legacy, the inner horizontal.</figcaption>
  <div class="scroll inner"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Long section of lowest legacy, OFS and OES surfaces on the extended centre line">
    ${grid}${rwy}${paths}${lab}
    <line class="xh" x1="0" x2="0" y1="${T}" y2="${H - B}" hidden/>
    <rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/>
  </svg></div>
  <div class="tip" role="status" aria-live="polite">Hover or tap the chart to read heights.</div>
  <script type="application/json">${data.replace(/</g, '\\u003c')}</script>
</figure>`;
}

// ---- plan view ----
function planView(G) {
  const m = G.runway;
  const X0 = -16500, X1 = m.Lt + 16500, Y = 11500;
  const W = 460, H = Math.round(W * (2 * Y) / (X1 - X0));
  const sx = x => ((x - X0) / (X1 - X0)) * W, sy = y => H / 2 - (y / (2 * Y)) * H;
  const panel = (title, surfs) => {
    const polys = surfs.flatMap(s => s.instances.flatMap(i => i.facets.filter(f => !f.vertical).map(f => {
      const ring = r => r.map(p => `${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ');
      if (f.holes) return `<path class="fp ${SET_CLASS[s.set]}" fill-rule="evenodd" d="M${ring(f.v)}Z${f.holes.map(h => `M${ring(h)}Z`).join('')}"/>`;
      return `<polygon class="fp ${SET_CLASS[s.set]}" points="${ring(f.v)}"/>`;
    }))).join('');
    const bar = `<line class="sb" x1="${W - 12 - sx(5000) + sx(0)}" x2="${W - 12}" y1="${H - 10}" y2="${H - 10}"/><text class="tick" x="${W - 12}" y="${H - 15}" text-anchor="end">5 km</text>`;
    return `<figure class="plan"><figcaption>${esc(title)}</figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Plan view of ${esc(title)} footprints">
      <rect width="${W}" height="${H}" class="pbg"/>${polys}
      <line class="rwy" x1="${sx(m.endX[0])}" x2="${sx(m.endX[1])}" y1="${sy(0)}" y2="${sy(0)}"/>${bar}</svg></figure>`;
  };
  return `<div class="plans">${panel('Legacy OLS', G.legacy)}${panel('OFS (magenta) and OES (amber)', G.new)}</div>`;
}

// ---- probe table ----
function probeTable(G) {
  const m = G.runway, z0 = m.zt[0];
  const sets = [G.legacy, G.new.filter(s => s.set === 'OFS'), G.new.filter(s => s.set === 'OES')];
  const P = [
    ...[500, 1000, 2000, 3000, 5000, 10000, 15000].map(d => [`Extended CL, ${n0(d)} m before threshold 1`, -d, 0]),
    ...[100, 200, 300, 500, 1000, 3000].map(d => [`Abeam threshold 1, ${n0(d)} m from CL`, 0, d]),
    ...[2000, 5000].map(d => [`Abeam runway mid point, ${n0(d)} m from CL`, m.Lt / 2, d]),
    ...[1000, 3000, 8000].map(d => [`Extended CL, ${n0(d)} m beyond runway end 2`, m.endX[1] + d, 0]),
  ];
  const cell = r => r ? `<td class="num">${n1(r.z - z0)}<span class="by">${esc(r.title)}${r.direction ? ` · dir ${r.direction}` : ''}</span></td>` : '<td class="num none">none</td>';
  const rows = P.map(([label, x, y]) => `<tr><th scope="row">${esc(label)}</th>${sets.map(S => cell(lowestAt(S, x, y))).join('')}</tr>`).join('');
  return `<div class="scroll"><table class="probe"><caption>Lowest surface of each set at named points, height above threshold 1 (m)</caption>
  <thead><tr><th scope="col">Point</th><th scope="col"><span class="key legacy"></span>Legacy OLS</th><th scope="col"><span class="key ofs"></span>OFS</th><th scope="col"><span class="key oes"></span>OES</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function sampleSection(sm, idx) {
  const c = deriveConfig(sm.input, std);
  const G = buildGeometry(std, c, sm.runway);
  const L = G.legacy, N = G.new, z0 = G.runway.zt[0];
  const i = sm.input, r = sm.runway;
  const facts = [
    ['ARFL', `${i.arfl} m`], ['Wingspan', `${i.wingspan} m`], ['Vat', `${i.vat} kt`],
    ['Runway width', `${i.runwayWidth} m`], ['Approach', i.approach],
  ];
  const rwy = [
    ['Runway length', `${n0(r.length)} m`], ['Threshold elevations', r.ends.map(e => `${e.elevation} m`).join(' / ')],
    ['Aerodrome elevation', `${G.runway.aerodromeElevation} m`], ['Strip beyond end', `${G.runway.ends[0].stripExtension} m`],
    ['Displaced / clearway', 'none'],
  ];
  const derived = [
    ['Code', `${c.codeNumber}${c.codeLetter}`], ['ADG', c.adg],
    ['Legacy column', c.legacyColumn], ['Take-off column', c.takeoffColumn],
  ];
  const kv = arr => arr.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  return `<section class="sample">
  <header><h2>${esc(sm.name)}</h2><p>${esc(sm.blurb)}</p></header>
  <div class="cfg">
    <dl class="inputs" aria-label="Aeroplane inputs">${kv(facts)}</dl>
    <dl class="inputs" aria-label="Runway inputs">${kv(rwy)}</dl>
    <dl class="derived" aria-label="Derived">${kv(derived)}</dl>
  </div>
  ${c.warnings.length ? `<p class="warn">${c.warnings.map(esc).join('<br>')}</p>` : ''}
  ${longSection(G, idx)}
  ${probeTable(G)}
  ${planView(G)}
  <div class="cols">
    <div class="col"><h3><span class="key legacy"></span>Legacy OLS <small>${L.length} surfaces</small></h3>${L.map(s => surfaceBlock(s, z0)).join('')}</div>
    <div class="col"><h3><span class="key ofs"></span><span class="key oes"></span>Amendment 18 OFS and OES <small>${N.length} surfaces</small></h3>${N.map(s => surfaceBlock(s, z0)).join('')}</div>
  </div>
</section>`;
}

const ruleRows = std.footnote_rules.map(r => {
  const st = RULE_STATUS[r.id];
  return `<tr><td class="mono">${esc(r.id)}</td><td>${esc(r.applies_to)}</td><td>${esc(r.effect)}</td><td><span class="chip st-${st}">${st}</span></td></tr>`;
}).join('');
const counts = Object.values(RULE_STATUS).reduce((a, s) => (a[s] = (a[s] || 0) + 1, a), {});

const html = `<title>OLS Engine Progress</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
/* Layout: single reading column, samples split legacy | new side by side, collapsing to one column on phones */
:root{
  --bg:#f6f7f9; --panel:#ffffff; --fg:#17202b; --muted:#5b6675; --line:#dde2e8;
  --legacy:#1f5a99; --new:#a0287a; --ofs:#a0287a; --oes:#b86e00; --rwy:#17202b; --ok:#2d7a4a; --warn:#9a6a00; --pend:#6b5ca8;
  --display:"Barlow Semi Condensed","Arial Narrow",system-ui,sans-serif;
  --body:"Barlow",system-ui,-apple-system,"Segoe UI",sans-serif;
  --mono:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#11161d; --panel:#18202a; --fg:#e4e9ef; --muted:#97a3b2; --line:#2a3542;
  --legacy:#5b97d6; --new:#d066ae; --ofs:#d066ae; --oes:#b8801c; --rwy:#e4e9ef; --ok:#5fc287; --warn:#e2b04a; --pend:#a99ae6; color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#11161d; --panel:#18202a; --fg:#e4e9ef; --muted:#97a3b2; --line:#2a3542;
  --legacy:#5b97d6; --new:#d066ae; --ofs:#d066ae; --oes:#b8801c; --rwy:#e4e9ef; --ok:#5fc287; --warn:#e2b04a; --pend:#a99ae6; color-scheme:dark}
body{background:var(--bg);color:var(--fg);font:15px/1.5 var(--body)}
.wrap{max-width:1100px;margin:0 auto;padding-block:28px 56px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:grid;gap:28px}
h1,h2,h3{font-family:var(--display);text-wrap:balance;margin:0;line-height:1.15}
h1{font-size:2rem;font-weight:700}
h2{font-size:1.45rem;font-weight:600}
h3{font-size:1.05rem;font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
h3 small{font:400 .8rem var(--body);color:var(--muted)}
.eyebrow{font:600 .72rem var(--body);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
.lede{color:var(--muted);max-width:65ch;margin:6px 0 0}
.status{display:flex;flex-wrap:wrap;gap:10px 24px;padding:14px 16px;background:var(--panel);border:1px solid var(--line);border-radius:6px}
.status div{display:grid;gap:2px}
.status b{font:600 1.05rem var(--display)}
.stages{display:flex;flex-wrap:wrap;gap:6px;list-style:none;padding:0;margin:0}
.stages li{font-size:.82rem;padding:3px 10px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}
.stages li.done{color:var(--ok);border-color:currentColor}
.stages li.now{color:var(--fg);border-color:var(--fg);font-weight:600}
.sample{display:grid;gap:14px}
.sample header p{margin:2px 0 0;color:var(--muted)}
.cfg{display:flex;flex-wrap:wrap;gap:12px}
dl{display:flex;flex-wrap:wrap;gap:6px 18px;margin:0;padding:10px 14px;border-radius:6px;border:1px solid var(--line);background:var(--panel)}
dl.derived{border-color:var(--fg)}
dt{font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
dd{margin:0;font:500 .95rem var(--mono)}
.warn{color:var(--warn);margin:0;font-size:.9rem}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.col{display:grid;gap:8px;align-content:start;min-width:0}
.dot{width:10px;height:10px;border-radius:50%;display:inline-block}
.dot.legacy{background:var(--legacy)} .dot.new{background:var(--new)}
.surf{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--legacy);border-radius:4px}
.surf.new{border-left-color:var(--new)}
.surf summary{cursor:pointer;padding:9px 12px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;list-style-position:inside}
.surf summary:focus-visible{outline:2px solid var(--fg);outline-offset:2px}
.sname{font-weight:600}
.meta{font:.78rem var(--mono);color:var(--muted)}
.params{width:100%;border-collapse:collapse;font-size:.88rem}
.params th{font-weight:400;text-align:left;color:var(--muted);padding:4px 12px;border-top:1px solid var(--line)}
.params td{padding:4px 12px;border-top:1px solid var(--line);text-align:right}
.num{font-family:var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap}
.u{color:var(--muted);margin-left:2px;font-size:.85em}
.ref{font-family:var(--body);font-style:italic;white-space:normal;color:var(--fg)}
.ob{margin:0;padding:8px 12px 10px;font-size:.82rem;color:var(--muted);border-top:1px solid var(--line)}
.chip{display:inline-block;font:500 .72rem var(--mono);padding:1px 7px;border-radius:999px;border:1px solid currentColor;margin-left:8px;vertical-align:1px}
.chip.mod{color:var(--new)}
.st-implemented{color:var(--ok)} .st-pending{color:var(--pend)} .st-noted{color:var(--muted)} .st-deferred{color:var(--warn)}
.scroll{overflow-x:auto;background:var(--panel);border:1px solid var(--line);border-radius:6px}
.rules{border-collapse:collapse;width:100%;font-size:.86rem;min-width:640px}
.rules th{text-align:left;font:600 .72rem var(--body);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:8px 12px}
.rules td{padding:6px 12px;border-top:1px solid var(--line);vertical-align:top}
.rules .chip{margin-left:0}
.mono{font-family:var(--mono)}
.tests{columns:2 280px;gap:24px;padding:0;margin:0;list-style:none;font-size:.88rem}
.tests li{break-inside:avoid;padding:3px 0;display:flex;gap:8px}
.tests .p{color:var(--ok);font-family:var(--mono)} .tests .f{color:var(--warn);font-family:var(--mono)}
.decisions{margin:0;padding-left:20px;max-width:75ch}
.decisions li{margin:4px 0}
.surf.ofs{border-left-color:var(--ofs)} .surf.oes{border-left-color:var(--oes)}
.key{width:14px;height:3px;display:inline-block;vertical-align:middle;margin-right:6px;background:var(--legacy)}
.key.ofs{background:repeating-linear-gradient(90deg,var(--ofs) 0 5px,transparent 5px 8px)}
.key.oes{background:repeating-linear-gradient(90deg,var(--oes) 0 2px,transparent 2px 5px)}
.chip.geo{color:var(--ok)}
.chart{margin:0;display:grid;gap:6px;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:12px}
.chart figcaption,.plan figcaption{font-size:.85rem;color:var(--muted)}
.chart svg{display:block;width:100%;min-width:640px;height:auto}
.scroll.inner{border:0;border-radius:0;background:none}
.grid{stroke:var(--line);stroke-width:1}
.tick{fill:var(--muted);font:11px var(--mono)}
.rwy{stroke:var(--rwy);stroke-width:4;stroke-linecap:butt}
.ln{fill:none;stroke-width:2;stroke-linejoin:round}
.ln.legacy{stroke:var(--legacy)} .ln.ofs{stroke:var(--ofs);stroke-dasharray:7 4} .ln.oes{stroke:var(--oes);stroke-dasharray:2 3}
.dl{font:600 12px var(--body);fill:var(--fg)}
.xh{stroke:var(--muted);stroke-width:1}
.tip{font:.82rem var(--mono);color:var(--fg);min-height:2.6em;font-variant-numeric:tabular-nums}
.tip span{display:inline-block;margin-right:14px}
.probe{border-collapse:collapse;width:100%;min-width:640px;font-size:.86rem}
.probe caption,.pts caption{text-align:left;padding:8px 12px;color:var(--muted);font-size:.82rem}
.probe th,.probe td{padding:6px 12px;border-top:1px solid var(--line);text-align:left;vertical-align:top}
.probe thead th{font:600 .72rem var(--body);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.probe tbody th{font-weight:400}
.probe .num{font-family:var(--mono);font-variant-numeric:tabular-nums}
.by{display:block;font:.72rem var(--body);color:var(--muted)}
.none{color:var(--muted)}
.plans{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.plan{margin:0;display:grid;gap:4px;min-width:0}
.plan svg{width:100%;height:auto;display:block;border:1px solid var(--line);border-radius:4px}
.pbg{fill:var(--panel)}
.fp{stroke-width:.6;fill-opacity:.07}
.fp.legacy{fill:var(--legacy);stroke:var(--legacy)} .fp.ofs{fill:var(--ofs);stroke:var(--ofs)} .fp.oes{fill:var(--oes);stroke:var(--oes)}
.sb{stroke:var(--fg);stroke-width:2}
.pts{width:100%;border-collapse:collapse;font-size:.82rem;border-top:1px solid var(--line)}
.pts th,.pts td{padding:3px 12px}
.pts thead th{font:600 .7rem var(--body);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);text-align:right}
.pts thead th:first-child,.pts tbody th{text-align:left}
.pts tbody th{font-weight:400;color:var(--muted)}
.pts td{text-align:right}
@media (max-width:760px){.plans{grid-template-columns:1fr}}
@media (max-width:760px){.cols{grid-template-columns:1fr}}
</style>
<div class="wrap">
  <header>
    <div class="eyebrow">Airport OLS v OFS/OES Visualiser · Build progress</div>
    <h1>Stage 2: surface geometry engine</h1>
    <p class="lede">Surface geometry for the two review configurations, built from the standards JSON. Every surface is now a set of planar 3D facets in the runway frame (x along the centre line from threshold 1, y lateral, heights above threshold 1). Check the long sections, the point table and the worked points in each surface; this is the Stage 2 review. Generated ${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', dateStyle: 'medium', timeStyle: 'short' })} AEST.</p>
  </header>

  <div class="status">
    <div><span class="eyebrow">Stages</span><ol class="stages">
      <li class="done">1 Platform</li><li class="done">2 Engine</li><li class="now">3 Rendering</li><li>4 Interface</li><li>5 Verification</li></ol></div>
    <div><span class="eyebrow">Tests</span><b style="color:var(${passed === tests.length ? '--ok' : '--warn'})">${passed} of ${tests.length} passing</b></div>
    <div><span class="eyebrow">Footnote rules</span><b>${counts.implemented || 0} done · ${counts.noted || 0} noted · ${counts.deferred || 0} deferred</b></div>
  </div>

  <section style="display:grid;gap:8px">
    <h2>Geometry assumptions</h2>
    <ul class="decisions">
      <li><b>Confirmed:</b> runway profile is straight between thresholds and held level beyond them, so approach inner edges (at threshold elevation) meet the strip edge without a step.</li>
      <li><b>Confirmed:</b> transitional lower edges run along the strip edge to each strip end, using the displaced threshold and strip extension inputs. Where the strip runs beyond the approach inner edge, the lower of the strip and approach side transitionals governs.</li>
      <li><b>Confirmed:</b> take-off climb and departure inner edges take the runway end elevation. The "highest point between runway end and inner edge" needs clearway ground data.</li>
      <li><b>Confirmed:</b> strip beyond each runway end defaults to 60 m and aerodrome elevation to the highest threshold. Both are inputs.</li>
      <li><b>Confirmed:</b> OFS inner approach starts at the OFS approach inner edge distance (60 m, or 30 m for NI ADG I), as a rectangle in the approach plane.</li>
      <li><b>Confirmed:</b> precision approach OES transitional rises from both approach sections, the lower component and both missed approach sections until it reaches 300 m above threshold (Figure 4-6).</li>
      <li><b>v1 limit:</b> each runway is set up on its own (code, ADG, approach type), and both ends of a runway share one approach type. Different types at each end and several runways shown together are in the parking lot.</li>
    </ul>
  </section>

  ${SAMPLES.map((sm, i) => sampleSection(sm, i)).join('')}

  <section style="display:grid;gap:10px">
    <h2>Footnote rules</h2>
    <p class="lede" style="margin:0">Reference extents (end of strip, end of runway, clearway) are now resolved by the geometry step; the chip on a surface shows which ones applied in that sample. Deferred rules wait on inputs in the parking lot.</p>
    <div class="scroll"><table class="rules"><thead><tr><th>Rule</th><th>Applies to</th><th>Effect</th><th>Status</th></tr></thead><tbody>${ruleRows}</tbody></table></div>
  </section>

  <section style="display:grid;gap:10px">
    <h2>Tests</h2>
    <ul class="tests">${tests.map(t => `<li><span class="${t.ok ? 'p' : 'f'}">${t.ok ? 'pass' : 'FAIL'}</span>${esc(t.name)}</li>`).join('')}</ul>
  </section>
</div>
<script>
document.querySelectorAll('figure.chart').forEach(fig => {
  const D = JSON.parse(fig.querySelector('script[type="application/json"]').textContent);
  const svg = fig.querySelector('svg'), hit = fig.querySelector('.hit'), xh = fig.querySelector('.xh'), tip = fig.querySelector('.tip');
  const x0 = +hit.getAttribute('x'), w = +hit.getAttribute('width'), n = D.series[0].pts.length;
  const fmt = v => v.toFixed(1);
  function show(ev) {
    const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    const i = Math.max(0, Math.min(n - 1, Math.round(((p.x - x0) / w) * (n - 1))));
    const sx = x0 + (i / (n - 1)) * w;
    xh.setAttribute('x1', sx); xh.setAttribute('x2', sx); xh.hidden = false;
    const x = D.X0 + i * D.step;
    tip.innerHTML = '<span>' + (x / 1000).toFixed(2) + ' km from THR 1</span>' + D.series.map(s => {
      const v = s.pts[i]; return '<span>' + s.name + ': ' + (v ? fmt(v[0]) + ' m (' + v[1] + ')' : 'none') + '</span>';
    }).join('');
  }
  hit.addEventListener('pointermove', show); hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', () => { xh.hidden = true; });
});
</script>
`;
writeFileSync(out, html);
console.log(`wrote ${out}: ${passed}/${tests.length} tests`);
