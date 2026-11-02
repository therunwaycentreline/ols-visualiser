// Build a static HTML progress report from the engine: derived config and
// resolved dimensions for the review samples, footnote rule status, test results.
// Usage: node scripts/report.mjs <out.html>
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { deriveConfig } from '../engine/derive.js';
import { resolveLegacy, resolveNew } from '../engine/resolve.js';
import { RULE_STATUS } from '../engine/rule_status.js';

const root = new URL('..', import.meta.url);
const std = JSON.parse(readFileSync(new URL('data/ols_standards.json', root)));
const out = process.argv[2] || 'report.html';

const SAMPLES = [
  { name: 'Sample A', blurb: 'Code 4 precision approach (CAT I), ADG IV aeroplane',
    input: { arfl: 2800, wingspan: 60, vat: 145, runwayWidth: 45, approach: 'PA I' } },
  { name: 'Sample B', blurb: 'Code 2 non-instrument runway, ADG I aeroplane',
    input: { arfl: 1000, wingspan: 12, vat: 80, runwayWidth: 18, approach: 'NI', mtomOver5700: false } },
];

// ---- tests ----
let tap = '';
try {
  tap = execFileSync(process.execPath, ['--test', '--test-reporter=tap', 'engine/test/derive_resolve.test.js'],
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
function surfaceBlock(s) {
  return `<details class="surf ${s.regime}">
  <summary><span class="sname">${esc(s.title)}</span><span class="meta">${esc(s.table)} · ${esc(s.clause)}</span></summary>
  <table class="params">${paramRows(s)}</table>
  <p class="ob"><b>${esc(s.obligation)}.</b> ${esc(s.obstacleRule)}</p>
</details>`;
}

function sampleSection(sm) {
  const c = deriveConfig(sm.input, std);
  const L = resolveLegacy(std, c), N = resolveNew(std, c);
  const i = sm.input;
  const facts = [
    ['ARFL', `${i.arfl} m`], ['Wingspan', `${i.wingspan} m`], ['Vat', `${i.vat} kt`],
    ['Runway width', `${i.runwayWidth} m`], ['Approach', i.approach],
  ];
  const derived = [
    ['Code', `${c.codeNumber}${c.codeLetter}`], ['ADG', c.adg],
    ['Legacy column', c.legacyColumn], ['Take-off column', c.takeoffColumn],
  ];
  const kv = arr => arr.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  return `<section class="sample">
  <header><h2>${esc(sm.name)}</h2><p>${esc(sm.blurb)}</p></header>
  <div class="cfg">
    <dl class="inputs" aria-label="Inputs">${kv(facts)}</dl>
    <dl class="derived" aria-label="Derived">${kv(derived)}</dl>
  </div>
  ${c.warnings.length ? `<p class="warn">${c.warnings.map(esc).join('<br>')}</p>` : ''}
  <div class="cols">
    <div class="col"><h3><span class="dot legacy"></span>Legacy OLS <small>${L.length} surfaces</small></h3>${L.map(surfaceBlock).join('')}</div>
    <div class="col"><h3><span class="dot new"></span>Amendment 18 OFS and OES <small>${N.length} surfaces</small></h3>${N.map(surfaceBlock).join('')}</div>
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
  --legacy:#1f5a99; --new:#a0287a; --ok:#2d7a4a; --warn:#9a6a00; --pend:#6b5ca8;
  --display:"Barlow Semi Condensed","Arial Narrow",system-ui,sans-serif;
  --body:"Barlow",system-ui,-apple-system,"Segoe UI",sans-serif;
  --mono:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#11161d; --panel:#18202a; --fg:#e4e9ef; --muted:#97a3b2; --line:#2a3542;
  --legacy:#6fa8e8; --new:#e07bc0; --ok:#5fc287; --warn:#e2b04a; --pend:#a99ae6; color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#11161d; --panel:#18202a; --fg:#e4e9ef; --muted:#97a3b2; --line:#2a3542;
  --legacy:#6fa8e8; --new:#e07bc0; --ok:#5fc287; --warn:#e2b04a; --pend:#a99ae6; color-scheme:dark}
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
@media (max-width:760px){.cols{grid-template-columns:1fr}}
</style>
<div class="wrap">
  <header>
    <div class="eyebrow">Airport OLS v OFS/OES Visualiser · Build progress</div>
    <h1>Stage 2: surface geometry engine</h1>
    <p class="lede">What the engine produces so far for the two review configurations. Dimensions are resolved from the standards JSON with footnote modifiers applied; 3D geometry is the next step. Generated ${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', dateStyle: 'medium', timeStyle: 'short' })} AEST.</p>
  </header>

  <div class="status">
    <div><span class="eyebrow">Stages</span><ol class="stages">
      <li class="done">1 Platform</li><li class="now">2 Engine</li><li>3 Rendering</li><li>4 Interface</li><li>5 Verification</li></ol></div>
    <div><span class="eyebrow">Tests</span><b style="color:var(${passed === tests.length ? '--ok' : '--warn'})">${passed} of ${tests.length} passing</b></div>
    <div><span class="eyebrow">Footnote rules</span><b>${counts.implemented || 0} done · ${counts.pending || 0} pending · ${counts.noted || 0} noted · ${counts.deferred || 0} deferred</b></div>
  </div>

  <section style="display:grid;gap:8px">
    <h2>Decisions this session</h2>
    <ul class="decisions">
      <li><b>Confirmed:</b> horizontal OES on by default (circling assumed), as the closest match to the legacy inner horizontal and conical. Straight-in OES appears only when circling is turned off on a non-precision runway.</li>
      <li><b>To confirm:</b> Code F footnotes are driven by a "digital go-around steering fitted" input, default no.</li>
      <li><b>To confirm:</b> MTOM 5 700 kg or less with ADG IIC or above falls back to Table 4-15, with a warning.</li>
    </ul>
  </section>

  ${SAMPLES.map(sampleSection).join('')}

  <section style="display:grid;gap:10px">
    <h2>Footnote rules</h2>
    <p class="lede" style="margin:0">Pending rules are reference extents (end of strip, end of runway, clearway) that need runway geometry. Deferred rules wait on inputs in the parking lot.</p>
    <div class="scroll"><table class="rules"><thead><tr><th>Rule</th><th>Applies to</th><th>Effect</th><th>Status</th></tr></thead><tbody>${ruleRows}</tbody></table></div>
  </section>

  <section style="display:grid;gap:10px">
    <h2>Tests</h2>
    <ul class="tests">${tests.map(t => `<li><span class="${t.ok ? 'p' : 'f'}">${t.ok ? 'pass' : 'FAIL'}</span>${esc(t.name)}</li>`).join('')}</ul>
  </section>
</div>
`;
writeFileSync(out, html);
console.log(`wrote ${out}: ${passed}/${tests.length} tests`);
