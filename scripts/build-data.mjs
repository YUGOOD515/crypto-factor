#!/usr/bin/env node
/**
 * Build step: turns the latest data release into everything the site needs.
 *
 *   data/releases/<latest>/...  ──►  src/generated/site-data.json   (runtime chart data)
 *   data/meta/*.json            ──►  src/generated/partials.json    (pre-rendered HTML, KaTeX, SVG)
 *   data/legal/*                ──►  public/downloads/*.zip         (CSV + dictionary + license + citation)
 *
 * Only the release marked "latest" in data/releases/manifest.json is published.
 * Older releases stay in the repository as history.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import katex from 'katex';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = (...s) => path.join(ROOT, ...s);
const readJSON = (f) => JSON.parse(fs.readFileSync(p(f), 'utf8'));
const readText = (f) => fs.readFileSync(p(f), 'utf8');
const exists = (f) => fs.existsSync(p(f));

// ─────────────────────────────────────────────────────────── helpers
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const MINUS = '\u2212';
const signed = (v, d = 2, unit = '%') => (v < 0 ? MINUS : v > 0 ? '+' : '') + Math.abs(v).toFixed(d) + unit;
const plain = (v, d = 2, unit = '') => (v < 0 ? MINUS : '') + Math.abs(v).toFixed(d) + unit;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
const formatBytes = (n) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const pad2 = (n) => String(n).padStart(2, '0');

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const tex = (s, display = true) =>
  katex.renderToString(s, { displayMode: display, throwOnError: true, strict: 'ignore', output: 'htmlAndMathml' });

function glyph(source, theory, size = 14, cls = 'glyph') {
  const s = size, h = s / 2, sw = 2;
  const solid = theory === 'risk';
  let shape;
  if (source === 'onchain') {
    shape = solid
      ? `<circle cx="${h}" cy="${h}" r="${h}" fill="currentColor"/>`
      : `<circle cx="${h}" cy="${h}" r="${h - sw / 2}" fill="none" stroke="currentColor" stroke-width="${sw}"/>`;
  } else {
    shape = solid
      ? `<rect width="${s}" height="${s}" fill="currentColor"/>`
      : `<rect x="${sw / 2}" y="${sw / 2}" width="${s - sw}" height="${s - sw}" fill="none" stroke="currentColor" stroke-width="${sw}"/>`;
  }
  return `<svg class="${cls}" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" aria-hidden="true" focusable="false">${shape}</svg>`;
}

// ─────────────────────────────────────────────────────────── inputs
const manifest = readJSON('data/releases/manifest.json');
const RID = manifest.latest;
const REL_DIR = `data/releases/${RID}`;
const release = readJSON(`${REL_DIR}/release.json`);
const meta = readJSON('data/meta/factors.json');
const { papers } = readJSON('data/meta/papers.json');
const marketMeta = readJSON('data/meta/market.json');
const marketFile = `${REL_DIR}/market/token-classification-market-overview.json`;
const market = exists(marketFile) ? readJSON(marketFile) : null;
const paperById = Object.fromEntries(papers.map((x) => [x.id, x]));
const releaseLabel = RID.replace(/^(\d{4})(Q\d)$/, '$1 $2');
const dataThrough = release.data_through;

// ─────────────────────────────────────────────────────────── factor series + statistics
const series = {};
for (const code of meta.order) {
  const rows = parseCSV(readText(`${REL_DIR}/factors/${code}.csv`));
  series[code] = rows;
}
// master weekly grid = formation start of the longest series, then every return date
const mkt = series[meta.order[0]];
const grid = [mkt[0].formation_date, ...mkt.map((r) => r.return_date)];
const gridIndex = Object.fromEntries(grid.map((d, i) => [d, i]));

const factors = meta.order.map((code) => {
  const m = meta.factors[code];
  const cov = release.factors[code];
  const rows = series[code].filter((r) => r.factor_return !== '');
  const vals = rows.map((r) => Number(r.factor_return));
  const n = vals.length;
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  let iMin = 0, iMax = 0;
  vals.forEach((v, i) => { if (v < vals[iMin]) iMin = i; if (v > vals[iMax]) iMax = i; });
  const ret = new Array(grid.length).fill(null);
  const nav = new Array(grid.length).fill(null);
  const start = gridIndex[rows[0].formation_date];
  if (start === undefined) throw new Error(`${code}: formation start not on the weekly grid`);
  nav[start] = 1;
  let acc = 1;
  for (const r of rows) {
    const gi = gridIndex[r.return_date];
    if (gi === undefined) throw new Error(`${code}: return date ${r.return_date} not on grid`);
    const v = Number(r.factor_return);
    acc *= 1 + v;
    ret[gi] = v;
    nav[gi] = Number(acc.toPrecision(5));
  }
  const stats = {
    n,
    mean: mean * 100,
    sd: sd * 100,
    t: mean / (sd / Math.sqrt(n)),
    sharpe: (mean / sd) * Math.sqrt(52),
    min: vals[iMin] * 100,
    minDate: rows[iMin].return_date,
    max: vals[iMax] * 100,
    maxDate: rows[iMax].return_date,
    navEnd: acc,
    positiveShare: vals.filter((v) => v > 0).length / n,
  };
  return {
    code,
    short: m.short,
    variant: m.variant ?? null,
    name: m.name,
    fullName: m.fullName,
    source: m.source,
    theory: m.theory,
    paper: m.paper,
    paperRole: m.paperRole ?? 'source',
    masterId: cov.master_id,
    signalId: cov.signal_id,
    formationStart: cov.formation_start,
    formationEnd: cov.formation_end,
    returnEnd: cov.return_end,
    stats,
    ret,
    nav,
  };
});
const fByCode = Object.fromEntries(factors.map((f) => [f.code, f]));

// sparkline (log NAV) for the factor list
function sparkPath(f, w = 64, h = 20) {
  const pts = f.nav.map((v, i) => (v == null ? null : [i, Math.log10(v)])).filter(Boolean);
  const ys = pts.map((q) => q[1]);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const x0 = pts[0][0], x1 = pts[pts.length - 1][0];
  const step = Math.max(1, Math.floor(pts.length / 96));
  return pts
    .filter((_, i) => i % step === 0 || i === pts.length - 1)
    .map(([x, y], i) => `${i ? 'L' : 'M'}${(((x - x0) / (x1 - x0)) * w).toFixed(1)} ${(h - 1 - ((y - lo) / (hi - lo || 1)) * (h - 2)).toFixed(1)}`)
    .join('');
}

// ─────────────────────────────────────────────────────────── formulas (KaTeX, rendered once at build time)
const LS = String.raw`\tfrac{1}{2}\left(R_{SH,t+1}+R_{BH,t+1}\right)-\tfrac{1}{2}\left(R_{SL,t+1}+R_{BL,t+1}\right)`;
const F = {
  ret: String.raw`r_{i,t+1}=\frac{P_{i,t+1}}{P_{i,t}}-1`,
  // two displays (not one with \qquad) so they wrap onto separate lines on phones
  vw: String.raw`R_{p,t+1}=\sum_{i\in p} w_{i,t}\,r_{i,t+1},`,
  vw2: String.raw`w_{i,t}=\frac{\mathrm{MCAP}_{i,t}}{\sum_{j\in p}\mathrm{MCAP}_{j,t}}`,
  rf: String.raw`r_{f,t+1}=\left(1+\frac{\mathrm{RF}^{\,\mathrm{annual}}_{t}}{100}\right)^{7/365}-1`,
};
const FF = {
  MKT: {
    signal: String.raw`R_{m,t+1}=\sum_{i} w_{i,t}\,r_{i,t+1}`,
    factor: String.raw`\mathrm{MKT}_{t+1}=R_{m,t+1}-r_{f,t+1}`,
    extra: [['Weekly risk-free rate', F.rf]],
  },
  SMB: {
    signal: String.raw`\mathrm{SIZE}_{i,t}=\log\left(\mathrm{MCAP}_{i,t}\right)`,
    factor: String.raw`\mathrm{SMB}_{t+1}=R_{\mathrm{Small},t+1}-R_{\mathrm{Big},t+1}`,
  },
  MOM: {
    signal: String.raw`\mathrm{MOM2W}_{i,t}=\frac{P_{i,t}}{P_{i,t-2}}-1`,
    factor: String.raw`\mathrm{MOM}_{t+1}=${LS}`,
  },
  MOM3w: {
    signal: String.raw`\mathrm{MOM3W}_{i,t}=\frac{P_{i,t}}{P_{i,t-3}}-1`,
    factor: String.raw`\mathrm{MOM3w}_{t+1}=${LS}`,
  },
  M007_GLASSNODE: {
    signal: String.raw`\mathrm{VALUE}^{\mathrm{GN}}_{i,t}=\frac{\sum_{d\in t}\mathrm{AA}^{\mathrm{GN}}_{i,d}}{\mathrm{MCAP}_{i,t}}`,
    factor: String.raw`\mathrm{M007}^{\mathrm{GN}}_{t+1}=${LS}`,
  },
  M007_DUNE: {
    signal: String.raw`\mathrm{VALUE}^{\mathrm{DUNE}}_{i,t}=\frac{\sum_{d\in t}\mathrm{AA}^{\mathrm{DUNE}}_{i,d}}{\mathrm{MCAP}_{i,t}}`,
    factor: String.raw`\mathrm{M007}^{\mathrm{DUNE}}_{t+1}=${LS}`,
  },
  CANCHOR: {
    signal: String.raw`\mathrm{Nearness52}_{i,t}=\frac{P_{i,t}}{\max\left(P_{i,t-364},\ldots,P_{i,t}\right)}`,
    factor: String.raw`\mathrm{CANCHOR}_{t+1}=R_{\mathrm{High},t+1}-R_{\mathrm{Low},t+1}`,
    extra: [['Price break (Clean rule)', String.raw`r_{i,d}<-100\%\quad\text{or}\quad r_{i,d}>150\%`]],
  },
  ST: {
    signal: String.raw`\sigma_{i,d}=\frac{\left|r_{i,d}-r_{m,d}\right|}{\left|r_{i,d}\right|+\left|r_{m,d}\right|+\theta},\qquad\theta=0.10`,
    factor: String.raw`\mathrm{ST}_{t+1}=R_{\mathrm{High},t+1}-R_{\mathrm{Low},t+1}`,
    extra: [
      ['Salience weights', String.raw`\omega_{i,d}=\frac{\delta^{k_{i,d}}}{\sum_{s}\pi_{i,s}\,\delta^{k_{i,s}}},\qquad\pi_{i,d}=\frac{1}{N_{i,t}},\qquad\delta=0.70`],
      ['Coin-week signal', String.raw`\mathrm{STSignal}_{i,t}=\sum_{d}\pi_{i,d}\,\omega_{i,d}\,r_{i,d}-\sum_{d}\pi_{i,d}\,r_{i,d}`],
    ],
  },
};

// ─────────────────────────────────────────────────────────── diagrams (SVG, 4px grid)
const T = (x, y, s, cls = 'd-label', anchor = 'start') => `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}">${s}</text>`;

function calendarDiagram() {
  const cw = 40, ch = 32, g = 4, wk = 7 * cw + 6 * g, gap = 32, y = 28;
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  let s = '';
  [0, 1].forEach((w) => {
    const x0 = w * (wk + gap);
    s += T(x0, 14, w ? 'Holding week t+1' : 'Formation week t', 'd-eyebrow');
    days.forEach((d, i) => {
      const x = x0 + i * (cw + g);
      const sunday = i === 6;
      const cls = sunday ? (w ? 'd-node d-node--accent' : 'd-node d-node--ink') : 'd-node';
      s += `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" class="${cls}"/>`;
      s += T(x + cw / 2, y + 21, d, sunday ? 'd-label d-label--inv' : 'd-label d-label--muted', 'middle');
    });
  });
  const cx1 = 6 * (cw + g) + cw / 2, cx2 = wk + gap + 6 * (cw + g) + cw / 2, yb = y + ch + 24;
  s += `<path d="M${cx1} ${y + ch + 4}V${yb}H${cx2}V${y + ch + 10}" class="d-edge"/>`;
  s += `<path d="M${cx2 - 5} ${y + ch + 12}L${cx2} ${y + ch + 4}L${cx2 + 5} ${y + ch + 12}" class="d-edge"/>`;
  // each note is right-aligned under its own week, so the two never collide
  const r1 = cx1 + cw / 2, r2 = cx2 + cw / 2;
  s += T(r1, yb + 22, 'formation_date: Sunday t', 'd-label', 'end');
  s += T(r1, yb + 40, 'Signals, breakpoints and weights', 'd-label d-label--muted', 'end');
  s += T(r1, yb + 58, 'are measured here.', 'd-label d-label--muted', 'end');
  s += T(r2, yb + 22, 'return_date: Sunday t+1', 'd-label', 'end');
  s += T(r2, yb + 40, 'r = P(t+1) / P(t) − 1', 'd-label d-label--muted', 'end');
  const W = 2 * wk + gap;
  return `<svg class="diagram diagram--wide" viewBox="-1 0 ${W + 2} ${yb + 66}" role="img" aria-labelledby="dg-cal-t"><title id="dg-cal-t">Weekly calendar: the formation week runs Monday to Sunday t; the factor return is earned until the following Sunday t+1.</title>${s}</svg>`;
}

function filterDiagram() {
  const c = 24, g = 4, wk = 7 * c + 6 * g, gap = 20, y = 28;
  let s = '';
  ['t−1', 't', 't+1'].forEach((lab, w) => {
    const x0 = w * (wk + gap);
    s += T(x0, 14, `Week ${lab}`, w === 1 ? 'd-eyebrow d-eyebrow--strong' : 'd-eyebrow');
    for (let i = 0; i < 7; i++) {
      const x = x0 + i * (c + g);
      s += `<rect x="${x}" y="${y}" width="${c}" height="${c}" class="${w === 1 ? 'd-node d-node--ink' : 'd-node d-node--soft'}"/>`;
    }
  });
  const W = 3 * wk + 2 * gap, yb = y + c + 16;
  s += `<path d="M0 ${y + c + 6}V${yb}H${W}V${y + c + 6}" class="d-edge"/>`;
  s += `<path d="M${W / 2} ${yb}V${yb + 12}" class="d-edge"/>`;
  s += T(W / 2, yb + 30, 'filt(t) = 1 only if all 21 days are valid', 'd-label d-label--strong', 'middle');
  s += T(W / 2, yb + 48, 'First and last weeks of the sample use a 14-day, two-week window.', 'd-label d-label--muted', 'middle');
  return `<svg class="diagram diagram--wide" viewBox="-1 0 ${W + 2} ${yb + 56}" role="img" aria-labelledby="dg-flt-t"><title id="dg-flt-t">CoinMarketCap consistency filter: week t is kept only if all 21 days across weeks t−1, t and t+1 are valid.</title>${s}</svg>`;
}

// Narrow (phone) versions: the same diagrams stacked vertically at 1:1 scale,
// so labels stay at 11–13px instead of shrinking or scrolling sideways.
function calendarDiagramNarrow() {
  const cw = 36, ch = 32, g = 4, wk = 7 * cw + 6 * g;
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const rowY = [24, 164];
  let s = '';
  rowY.forEach((y, w) => {
    s += T(0, y - 10, w ? 'Holding week t+1' : 'Formation week t', 'd-eyebrow');
    days.forEach((d, i) => {
      const x = i * (cw + g);
      const sunday = i === 6;
      const cls = sunday ? (w ? 'd-node d-node--accent' : 'd-node d-node--ink') : 'd-node';
      s += `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" class="${cls}"/>`;
      s += T(x + cw / 2, y + 21, d, sunday ? 'd-label d-label--inv' : 'd-label d-label--muted', 'middle');
    });
  });
  // elbow from Sunday t to Sunday t+1, outside the cells on the right
  const xr = wk + 4, xa = wk + 16, y1 = rowY[0] + ch / 2, y2 = rowY[1] + ch / 2;
  s += `<path d="M${xr} ${y1}H${xa}V${y2}H${xr + 6}" class="d-edge"/>`;
  s += `<path d="M${xr + 12} ${y2 - 5}L${xr + 4} ${y2}L${xr + 12} ${y2 + 5}" class="d-edge"/>`;
  const n1 = rowY[0] + ch;
  s += T(0, n1 + 22, 'formation_date: Sunday t', 'd-label');
  s += T(0, n1 + 40, 'Signals, breakpoints and weights', 'd-label d-label--muted');
  s += T(0, n1 + 58, 'are measured here.', 'd-label d-label--muted');
  const n2 = rowY[1] + ch;
  s += T(0, n2 + 22, 'return_date: Sunday t+1', 'd-label');
  s += T(0, n2 + 40, 'r = P(t+1) / P(t) − 1', 'd-label d-label--muted');
  return `<svg class="diagram diagram--narrow" viewBox="-1 0 ${xa + 4} ${n2 + 48}" role="img" aria-labelledby="dg-cal-tn"><title id="dg-cal-tn">Weekly calendar: the formation week runs Monday to Sunday t; the factor return is earned until the following Sunday t+1.</title>${s}</svg>`;
}

function filterDiagramNarrow() {
  const c = 24, g = 4, x0 = 72, pitch = 34;
  let s = '';
  ['t−1', 't', 't+1'].forEach((lab, w) => {
    const y = w * pitch;
    s += T(0, y + 16, `Week ${lab}`, w === 1 ? 'd-eyebrow d-eyebrow--strong' : 'd-eyebrow');
    for (let i = 0; i < 7; i++) {
      s += `<rect x="${x0 + i * (c + g)}" y="${y}" width="${c}" height="${c}" class="${w === 1 ? 'd-node d-node--ink' : 'd-node d-node--soft'}"/>`;
    }
  });
  const x1 = x0 + 7 * c + 6 * g, yb = 2 * pitch + c + 16, mid = (x0 + x1) / 2;
  s += `<path d="M${x0} ${yb - 10}V${yb}H${x1}V${yb - 10}" class="d-edge"/>`;
  s += `<path d="M${mid} ${yb}V${yb + 12}" class="d-edge"/>`;
  s += T(0, yb + 32, 'filt(t) = 1 only if all 21 days are valid', 'd-label d-label--strong');
  s += T(0, yb + 50, 'First and last weeks of the sample use', 'd-label d-label--muted');
  s += T(0, yb + 68, 'a 14-day, two-week window.', 'd-label d-label--muted');
  return `<svg class="diagram diagram--narrow" viewBox="-1 0 ${x1 + 4} ${yb + 76}" role="img" aria-labelledby="dg-flt-tn"><title id="dg-flt-tn">CoinMarketCap consistency filter: week t is kept only if all 21 days across weeks t−1, t and t+1 are valid.</title>${s}</svg>`;
}

function sortDiagrams() {
  const W = 288;
  const legend = (y) =>
    `<rect x="0" y="${y - 10}" width="12" height="12" class="d-node d-node--ink"/>${T(18, y, 'Long', 'd-label d-label--muted')}` +
    `<rect x="74" y="${y - 10}" width="12" height="12" class="d-node d-node--short"/>${T(92, y, 'Short', 'd-label d-label--muted')}` +
    `<rect x="150" y="${y - 10}" width="12" height="12" class="d-node d-node--soft"/>${T(168, y, 'Not used', 'd-label d-label--muted')}`;
  const fig = (id, title, codes, body, h, caption) => `
<figure class="sort-fig" data-sort="${id}">
  <figcaption><span class="sort-fig__title">${title}</span><span class="sort-fig__codes">${codes}</span></figcaption>
  <svg class="diagram diagram--small" viewBox="-1 0 ${W + 2} ${h}" role="img" aria-label="${esc(caption)}">${body}</svg>
</figure>`;
  // market
  let a = `<rect x="0" y="24" width="208" height="40" class="d-node d-node--ink"/>${T(12, 49, 'All eligible coins', 'd-label d-label--inv')}`;
  a += `<text x="224" y="49" class="d-label d-label--strong">− r<tspan class="d-sub" dx="1" dy="4">f</tspan></text>`;
  a += T(0, 14, 'Value-weighted market', 'd-eyebrow') + legend(96);
  // univariate 30/70
  const seg = (x, w, cls, lab) => `<rect x="${x}" y="24" width="${w}" height="40" class="d-node ${cls}"/>${T(x + w / 2, 49, lab, cls.includes('ink') ? 'd-label d-label--inv' : 'd-label', 'middle')}`;
  let b = seg(0, 84, 'd-node--short', 'Low') + seg(88, 108, 'd-node--soft', 'Middle') + seg(200, 88, 'd-node--ink', 'High');
  b += T(86, 14, 'P30', 'd-eyebrow', 'middle') + T(198, 14, 'P70', 'd-eyebrow', 'middle');
  b += T(0, 84, 'ST = High − Low (strict breakpoints)', 'd-label') + T(0, 102, 'SMB = Small − Big: low minus high log MCAP', 'd-label') + legend(132);
  // 2x3
  let c = '';
  const cx = [56, 136, 216], cy = [24, 64];
  ['Low', 'Middle', 'High'].forEach((l, i) => (c += T(cx[i] + 36, 14, l, 'd-eyebrow', 'middle')));
  ['Small', 'Big'].forEach((r, j) => {
    c += T(0, cy[j] + 21, r, 'd-label d-label--muted');
    ['L', 'M', 'H'].forEach((k, i) => {
      const cls = k === 'H' ? 'd-node--ink' : k === 'L' ? 'd-node--short' : 'd-node--soft';
      c += `<rect x="${cx[i]}" y="${cy[j]}" width="72" height="36" class="d-node ${cls}"/>`;
      c += T(cx[i] + 36, cy[j] + 23, `${r[0]}${k}`, k === 'H' ? 'd-label d-label--inv' : 'd-label', 'middle');
    });
  });
  c += T(0, 124, '½(SH + BH) − ½(SL + BL)', 'd-label d-label--strong') + T(0, 142, 'Size median × signal P30 / P70', 'd-label d-label--muted') + legend(172);
  // deciles
  let d = '';
  for (let i = 0; i < 10; i++) {
    const cls = i === 9 ? 'd-node--ink' : i === 0 ? 'd-node--short' : 'd-node--soft';
    d += `<rect x="${i * 29}" y="24" width="26" height="40" class="d-node ${cls}"/>`;
  }
  d += T(13, 14, '≤P10', 'd-eyebrow', 'middle') + T(274, 14, '≥P90', 'd-eyebrow', 'middle');
  d += T(0, 84, 'High − Low, breakpoints inclusive', 'd-label') + T(0, 102, 'Coins exactly at the 52-week high stay in High', 'd-label d-label--muted') + legend(132);
  return [
    fig('market', 'Market portfolio', 'MKT', a, 104, 'MKT: all eligible coins, value-weighted, minus the risk-free rate.'),
    fig('uni', 'Univariate · 30 / 70', 'SMB · ST', b, 140, 'SMB and ST: one sort at the 30th and 70th percentiles; the two outer groups form the long and short legs.'),
    fig('2x3', 'Independent 2 × 3', 'MOM · MOM3w · M007', c, 180, 'MOM, MOM3w and M007: independent sort on size median and signal 30th / 70th percentiles, long the two High portfolios, short the two Low portfolios.'),
    fig('dec', 'Deciles · 10 / 90', 'CANCHOR', d, 140, 'CANCHOR: top decile minus bottom decile with inclusive breakpoints.'),
  ].join('');
}

// ─────────────────────────────────────────────────────────── downloads (ZIP with dictionary, license, citation)
const outDownloads = p('public/downloads');
fs.rmSync(outDownloads, { recursive: true, force: true });
fs.mkdirSync(outDownloads, { recursive: true });
const year = dataThrough.slice(0, 4);
const paperLine = (x) => `${x.authors} (${x.year}). "${x.title}." ${x.journal}. https://doi.org/${x.doi}`;
const citationTxt = readText('data/legal/CITATION.txt')
  .replace('{{YEAR}}', year).replace('{{RELEASE}}', RID).replace('{{DATA_THROUGH}}', dataThrough)
  .replace('{{PAPERS}}', papers.map((x) => {
    const codes = x.factors.map((f) => (f.role === 'extension' ? `${f.code} (extension)` : f.code)).join(', ');
    return `- ${paperLine(x)}\n  Factors: ${codes}`;
  }).join('\n'));
const datasetBib = `@misc{cryptofactor${RID.toLowerCase()},
  title        = {Crypto Factor: Weekly Cryptocurrency Factor Returns, Release ${RID}},
  year         = {${year}},
  note         = {Data through ${dataThrough}. DRAFT citation, pending confirmation},
  howpublished = {Site URL to be confirmed}
}`;
const paperBib = (x) => `@article{${x.bib.key},
  author  = {${x.bib.author}},
  title   = {${x.title}},
  journal = {${x.journal.replace('&', '\\&')}},
  year    = {${x.year}},
  doi     = {${x.doi}}
}`;
const citationBib = [datasetBib, ...papers.map(paperBib)].join('\n\n') + '\n';
const licenseTxt = readText('data/legal/LICENSE-DATA.txt');
const dictRows = parseCSV(readText('data/meta/data-dictionary.csv'));
const dictCsvFor = (codes, wide) => {
  const keep = dictRows.filter((r) => (r.file === '<FACTOR>.csv') || (wide && r.file === 'ALL_FACTORS_WIDE.csv'));
  const q = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = ['file,field,type,unit,description'];
  for (const r of keep) {
    const files = r.file === '<FACTOR>.csv' ? codes.map((c) => `factors/${c}.csv`).join(' | ') : r.file;
    lines.push([files, r.field, r.type, r.unit, r.description].map(q).join(','));
  }
  return lines.join('\n') + '\n';
};
const readmeFor = (title, files) => `CRYPTO FACTOR / ${title}
Release ${RID} · data through ${dataThrough} · weekly frequency

FILES
${files.map(([f, d]) => `  ${f.padEnd(28)} ${d}`).join('\n')}
  DATA_DICTIONARY.csv          Field definitions
  LICENSE.txt                  License (DRAFT, pending confirmation)
  CITATION.txt / CITATION.bib  How to cite the dataset and the source papers

CONVENTIONS
  - Weeks run Monday to Sunday. formation_date is the Sunday that closes the
    formation week; return_date is the following Sunday.
  - Returns are decimals rounded to 4 dp: 0.0125 = 1.25% per week.
  - A blank cell means missing, not zero.
  - MKT is in excess of the weekly risk-free rate. All other factors are
    long-short spreads with no risk-free rate subtracted.
  - M007_GLASSNODE and M007_DUNE are data-source variants of the same value
    factor. Do not put both in one regression as independent factors.
  - MOM3w is a research extension with no exact counterpart in the MS baseline.
  - CANCHOR is the Clean version (extreme daily returns treated as price breaks).
`;
const MTIME = new Date(`${dataThrough}T00:00:00Z`);
const downloads = {};
function writeZip(name, entries) {
  const files = {};
  for (const [f, content] of entries) files[`${name}/${f}`] = [strToU8(content), { mtime: MTIME }];
  const buf = zipSync(files, { level: 9 });
  fs.writeFileSync(path.join(outDownloads, `${name}.zip`), buf);
  return { file: `/downloads/${name}.zip`, bytes: buf.length, size: formatBytes(buf.length), sha256: crypto.createHash('sha256').update(buf).digest('hex'), files: entries.map((e) => e[0]) };
}
const common = (codes, wide) => [
  ['DATA_DICTIONARY.csv', dictCsvFor(codes, wide)],
  ['LICENSE.txt', licenseTxt],
  ['CITATION.txt', citationTxt],
  ['CITATION.bib', citationBib],
];
for (const f of factors) {
  const csv = readText(`${REL_DIR}/factors/${f.code}.csv`);
  downloads[f.code] = writeZip(`crypto-factor_${RID}_${f.code}`, [
    ['README.txt', readmeFor(`${f.code} (${f.fullName})`, [[`factors/${f.code}.csv`, 'Long format, one row per week']])],
    [`factors/${f.code}.csv`, csv],
    ...common([f.code], false),
  ]);
}
downloads.ALL = writeZip(`crypto-factor_${RID}_all-factors`, [
  ['README.txt', readmeFor('ALL FACTORS', [['factors/<FACTOR>.csv', 'Eight long-format files'], ['ALL_FACTORS_WIDE.csv', 'All factors side by side, one row per week']])],
  ...factors.map((f) => [`factors/${f.code}.csv`, readText(`${REL_DIR}/factors/${f.code}.csv`)]),
  ['ALL_FACTORS_WIDE.csv', readText(`${REL_DIR}/factors/ALL_FACTORS_WIDE.csv`)],
  ...common(factors.map((f) => f.code), true),
]);

// ─────────────────────────────────────────────────────────── partials (pre-rendered HTML)
const P = {};
const nf = factors.length;
P['release-label'] = esc(releaseLabel);
P['release-id'] = esc(RID);
P['data-through'] = esc(dataThrough);
P['data-through-long'] = esc(longDate(dataThrough));
P['weeks'] = String(fByCode.MKT.stats.n);
P['factor-count'] = pad2(nf);
P['coverage-years'] = `${grid[0].slice(0, 4)}–${dataThrough.slice(0, 4)}`;
P['formation-start'] = esc(grid[0]);
P['value-start'] = esc(fByCode.M007_GLASSNODE?.formationStart ?? '');

const best = fByCode.MKT.stats;
P['hero-facts'] = `<dl class="facts">
  <div class="fact"><dt>Factors</dt><dd>${pad2(nf)}</dd></div>
  <div class="fact"><dt>Weekly returns</dt><dd>${best.n}</dd></div>
  <div class="fact"><dt>Coverage</dt><dd>${P['coverage-years']}</dd></div>
  <div class="fact"><dt>Source papers</dt><dd>${pad2(papers.length)}</dd></div>
  <div class="fact"><dt>Updates</dt><dd>Quarterly</dd></div>
</dl>`;
P['hero-caption'] = `MKT, weekly excess return, ${grid[0]} to ${dataThrough}. Best week ${signed(best.max, 1)} (${best.maxDate}); worst week ${signed(best.min, 1)} (${best.minDate}).`;

const srcLabel = (s) => meta.sources[s].label;
const thLabel = (t) => meta.theories[t].label;
const paperCite = (x) => `${x.short} (${x.year})`;

// Fingerprint mark: the canvas is drawn client-side (src/fingerprint/mark.ts);
// the category glyph sits on it as a badge and stays visible without script.
const mark = (f, cls) =>
  `<span class="fmark ${cls}" data-source="${f.source}"><canvas class="fmark__print" data-mark="${f.code}" aria-hidden="true"></canvas><span class="fmark__badge">${glyph(f.source, f.theory, 10)}</span></span>`;

P['catalog-list'] = factors.map((f, i) => `
<button class="factor-item" type="button" role="tab" id="tab-${f.code}" aria-controls="panel-${f.code}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-code="${f.code}" data-source="${f.source}" data-theory="${f.theory}">
  ${mark(f, 'factor-item__mark')}
  <span class="factor-item__text"><span class="factor-item__code">${esc(f.code)}</span><span class="factor-item__name">${esc(f.name)}</span></span>
  <svg class="factor-item__spark" viewBox="0 0 64 20" aria-hidden="true" focusable="false"><path d="${sparkPath(f)}"/></svg>
</button>`).join('');

// Data fingerprint (src/fingerprint): the canvas is drawn client-side; the
// labels carry the statistics it is drawn from.
const countWord = (n) => ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'][n] ?? String(n);
const printParam = (pos, name, stat, value) =>
  `<div class="fprint__param fprint__param--${pos}"><dt><span class="fprint__name">${name}</span><span class="visually-hidden">: </span><span class="fprint__stat">${stat}</span></dt><dd>${value}</dd></div>`;
const fingerprint = (f) => {
  const s = f.stats;
  return `<figure class="fprint">
    <div class="fprint__stage">
      <canvas class="fprint__canvas" data-factor="${f.code}" role="img" aria-label="${esc(f.code)} data fingerprint"></canvas>
      <div class="fprint__toolbar"><span class="fprint__hint fprint__hint--pointer">Move the pointer to explore</span><span class="fprint__hint fprint__hint--touch">Drag sideways to explore</span><button class="fprint__motion" type="button" data-fp-motion aria-label="Pause animation">Ⅱ</button></div>
    </div>
    <dl class="fprint__params">
      ${printParam('tl', 'Hue', 'Data source', f.source === 'onchain' ? 'On-chain' : 'Trading')}
      ${printParam('tr', 'Mood', 'Sharpe ratio', plain(s.sharpe, 2))}
      ${printParam('bl', 'Roughness', 'Std. deviation', plain(s.sd, 2, '%'))}
      ${printParam('br', 'Activity', '|t|-statistic', plain(Math.abs(s.t), 2))}
    </dl>
    <figcaption class="fprint__caption">Data fingerprint of ${esc(f.code)}. Hue follows the data source, mood the Sharpe ratio, roughness the standard deviation and the speed of the motion the |t|-statistic, each scaled between the lowest and highest of the ${countWord(factors.length)} factors; the factor ID sets the phase.</figcaption>
  </figure>`;
};

const statCell = (key, label, value, display, note) =>
  `<div class="stat"><dt>${label}</dt><dd><span class="stat__value" data-stat="${key}" data-value="${value}">${display}</span></dd><dd class="stat__note">${note}</dd></div>`;
P['catalog-panels'] = factors.map((f, i) => {
  const m = meta.factors[f.code];
  const x = paperById[f.paper];
  const s = f.stats;
  const tags = [
    `<li class="tag">${glyph(f.source, f.theory, 10)}${srcLabel(f.source)}</li>`,
    `<li class="tag">${thLabel(f.theory)}</li>`,
    `<li class="tag">Weekly</li>`,
    f.paperRole === 'extension' ? `<li class="tag tag--flag">Research extension</li>` : '',
    f.source === 'onchain' ? `<li class="tag tag--flag">Source variant</li>` : '',
  ].join('');
  const notes = m.notes.length ? `<ul class="fp-notes">${m.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
  return `
<article class="factor-panel" role="tabpanel" id="panel-${f.code}" aria-labelledby="tab-${f.code}" data-code="${f.code}" tabindex="0"${i === 0 ? '' : ' hidden'}>
  <header class="fp-head">
    <p class="fp-ids">${esc(f.masterId)} <span aria-hidden="true">/</span> ${esc(f.signalId)}</p>
    <h3 class="fp-title"><span class="fp-code${f.code.length > 7 ? ' fp-code--long' : ''}">${esc(f.code)}</span> <span class="fp-name">${esc(f.fullName)}</span></h3>
    <ul class="tags">${tags}</ul>
  </header>
  <p class="fp-summary">${esc(m.summary)}</p>
  ${fingerprint(f)}
  <dl class="stats" aria-label="Summary statistics of weekly returns">
    ${statCell('mean', 'Mean', s.mean, plain(s.mean, 2, '%'), 'per week')}
    ${statCell('sd', 'Std. deviation', s.sd, plain(s.sd, 2, '%'), 'per week')}
    ${statCell('t', 't-statistic', s.t, plain(s.t, 2), `mean ÷ s.e., n = ${s.n}`)}
    ${statCell('sharpe', 'Sharpe ratio', s.sharpe, plain(s.sharpe, 2), 'annualized, ×√52')}
    ${statCell('min', 'Minimum', s.min, plain(s.min, 1, '%'), `week to ${s.minDate}`)}
    ${statCell('max', 'Maximum', s.max, plain(s.max, 1, '%'), `week to ${s.maxDate}`)}
  </dl>
  <div class="fp-chart-slot" data-chart-slot></div>
  <div class="fp-body">
    <div class="fp-desc">
      <h4 class="label">About</h4>
      <p>${esc(m.description)}</p>
      ${notes}
    </div>
    <dl class="meta">
      <div><dt>Type</dt><dd>${thLabel(f.theory)}, ${srcLabel(f.source).toLowerCase()}</dd></div>
      <div><dt>Frequency</dt><dd>Weekly, Monday to Sunday</dd></div>
      <div><dt>Coverage</dt><dd>${f.formationStart} to ${f.returnEnd} · ${s.n} weeks</dd></div>
      <div><dt>Last updated</dt><dd>Release ${esc(releaseLabel)} · data through ${dataThrough}</dd></div>
      <div><dt>Paper</dt><dd><a href="https://doi.org/${x.doi}" target="_blank" rel="noopener">${esc(paperCite(x))}</a>, <span class="meta__journal">${esc(x.journal)}</span>${f.paperRole === 'extension' ? ' (extension)' : ''}</dd></div>
    </dl>
  </div>
  <div class="fp-actions">
    <a class="btn btn--primary" href="${downloads[f.code].file}" download data-download><span class="btn__label">Download ${esc(f.code)}</span><span class="btn__meta">ZIP · ${downloads[f.code].size}</span><span class="btn__icon" aria-hidden="true"></span></a>
    <a class="link-arrow" href="#method-${f.code}" data-method-link="${f.code}">How ${esc(f.code)} is built</a>
  </div>
</article>`;
}).join('');

P['f-ret'] = tex(F.ret);
P['f-vw'] = tex(F.vw) + tex(F.vw2);
P['f-rf'] = tex(F.rf);
P['diagram-calendar'] = calendarDiagram() + calendarDiagramNarrow();
P['diagram-filter'] = filterDiagram() + filterDiagramNarrow();
P['diagram-sorts'] = sortDiagrams();

P['method-tabs'] = factors.map((f, i) => `<button type="button" class="seg__btn" role="tab" id="mtab-${f.code}" aria-controls="method-${f.code}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-code="${f.code}">${esc(f.code)}</button>`).join('');
P['method-panels'] = factors.map((f, i) => {
  const m = meta.factors[f.code];
  const ff = FF[f.code];
  const extra = (ff.extra ?? []).map(([lab, t]) => `<div class="mp-row"><h4 class="label">${esc(lab)}</h4><div class="math">${tex(t)}</div></div>`).join('');
  return `
<div class="method-panel" role="tabpanel" id="method-${f.code}" aria-labelledby="mtab-${f.code}" tabindex="0"${i === 0 ? '' : ' hidden'}>
  <header class="mp-head"><p class="fp-ids">${esc(f.masterId)} / ${esc(f.signalId)}</p><h4 class="mp-title">${esc(f.code)} <span>${esc(f.fullName)}</span></h4></header>
  <div class="mp-row"><h4 class="label">Signal</h4><div class="math">${tex(ff.signal)}</div></div>
  ${extra}
  <div class="mp-row"><h4 class="label">Sort</h4><p>${esc(m.sort)}</p></div>
  <div class="mp-row"><h4 class="label">Factor</h4><div class="math">${tex(ff.factor)}</div><p class="mp-direction">${esc(m.direction)}</p></div>
  <div class="mp-row mp-row--baseline"><h4 class="label">Relation to the MS baseline</h4><p>${esc(m.baseline)}</p></div>
</div>`;
}).join('');

P['baseline-table'] = `<table class="table table--compact"><caption class="visually-hidden">Relation of each factor to the MS paper baseline</caption><thead><tr><th scope="col">Factor</th><th scope="col">Relation to the MS baseline</th></tr></thead><tbody>${factors.map((f) => `<tr><th scope="row">${esc(f.code)}</th><td>${esc(meta.factors[f.code].baseline)}</td></tr>`).join('')}</tbody></table>`;

const citeText = (x) => paperLine(x);
P['papers-cards'] = papers.map((x, i) => `
<li class="paper" data-paper="${x.id}">
  <p class="paper__index">${pad2(i + 1)}</p>
  <p class="paper__meta"><span class="paper__year">${x.year}</span><span class="paper__journal">${esc(x.journal)}</span></p>
  <h3 class="paper__title">${esc(x.title)}</h3>
  <p class="paper__authors">${esc(x.authors)}</p>
  <p class="paper__summary">${esc(x.summary)}</p>
  <p class="paper__factors"><span class="label">Factors</span>${x.factors.map((f) => `<a class="chip${f.role === 'extension' ? ' chip--ext' : ''}" href="#factors" data-factor-link="${f.code}">${esc(f.code)}${f.role === 'extension' ? '<span class="chip__note">extension</span>' : ''}</a>`).join('')}</p>
  <div class="paper__actions">
    <a class="btn btn--light" href="https://doi.org/${x.doi}" target="_blank" rel="noopener"><span class="btn__label">Read at the journal</span><span class="btn__meta">doi.org/${esc(x.doi)}</span><span class="btn__icon btn__icon--out" aria-hidden="true"></span></a>
    <button type="button" class="btn btn--text btn--copy" data-copy="${esc(citeText(x))}"><span class="btn__label">Copy citation</span></button>
  </div>
</li>`).join('');

P['download-all'] = (() => {
  const d = downloads.ALL;
  return `<a class="dl-hero" href="${d.file}" download data-download>
  <span class="dl-hero__eyebrow">Complete package</span>
  <span class="dl-hero__title">All ${nf} factors</span>
  <span class="dl-hero__desc">${nf} long-format CSVs, the wide table, data dictionary, license and citation</span>
  <span class="dl-hero__meta"><span>ZIP</span><span>${d.size}</span><span>${d.files.length} files</span></span>
  <span class="dl-hero__btn btn btn--primary btn--lg"><span class="btn__label">Download all</span><span class="btn__icon" aria-hidden="true"></span></span>
</a>`;
})();

P['download-table'] = `<table class="table dl-table">
  <caption class="visually-hidden">Single-factor downloads</caption>
  <thead><tr><th scope="col">Factor</th><th scope="col" class="num hide-sm">Weeks</th><th scope="col" class="hide-md">Coverage</th><th scope="col" class="num">Size</th><th scope="col"><span class="visually-hidden">Download</span></th></tr></thead>
  <tbody>${factors.map((f) => {
    const d = downloads[f.code];
    return `<tr><th scope="row"><span class="dl-factor">${mark(f, 'dl-mark')}<span class="dl-code">${esc(f.code)}</span><span class="dl-name">${esc(f.fullName)}</span></span></th><td class="num hide-sm">${f.stats.n}</td><td class="hide-md dl-cov">${f.formationStart} – ${f.returnEnd}</td><td class="num dl-size">${d.size}</td><td class="dl-cell"><a class="btn btn--small" href="${d.file}" download data-download aria-label="Download ${esc(f.code)} (ZIP, ${d.size})" title="SHA-256 ${d.sha256}"><span class="btn__label">ZIP</span><span class="btn__icon" aria-hidden="true"></span></a></td></tr>`;
  }).join('')}</tbody>
</table>`;

P['download-tree'] = `<ul class="tree" aria-label="Contents of the complete package">
  <li class="tree__dir">crypto-factor_${RID}_all-factors/</li>
  <li><span>README.txt</span><span>Conventions and file list</span></li>
  <li class="tree__dir tree__dir--sub">factors/</li>
  ${factors.map((f) => `<li class="tree__sub"><span>${esc(f.code)}.csv</span><span>${f.stats.n} rows</span></li>`).join('')}
  <li><span>ALL_FACTORS_WIDE.csv</span><span>One row per week</span></li>
  <li><span>DATA_DICTIONARY.csv</span><span>Field definitions</span></li>
  <li><span>LICENSE.txt</span><span>Draft</span></li>
  <li><span>CITATION.txt · .bib</span><span>Dataset and papers</span></li>
</ul>`;

P['dictionary-table'] = `<table class="table table--compact dict-table">
  <caption class="visually-hidden">Data dictionary for the long-format factor files</caption>
  <thead><tr><th scope="col">Field</th><th scope="col">Type</th><th scope="col">Description</th></tr></thead>
  <tbody>${dictRows.filter((r) => r.file === '<FACTOR>.csv').map((r) => `<tr><th scope="row"><code>${esc(r.field)}</code></th><td>${esc(r.type)}${r.unit ? `<span class="dict-unit">${esc(r.unit)}</span>` : ''}</td><td>${esc(r.description)}</td></tr>`).join('')}</tbody>
</table>`;
P['citation-text'] = esc(`Crypto Factor (${year}). Weekly cryptocurrency factor returns, release ${RID} (data through ${dataThrough}). [Site URL to be confirmed]`);
P['citation-bib'] = esc(datasetBib);
P['citation-text-raw'] = P['citation-text'];

// market
let marketData = null;
if (market) {
  const cats = market.categories.map((c) => {
    const mm = marketMeta.categories[c.code] ?? {};
    const aa = c.activeAddressesThousands;
    return {
      code: c.code,
      name: c.name,
      shortLabel: c.shortLabel,
      shape: mm.shape ?? 'square',
      definition: mm.definition ?? null,
      definitionStatus: mm.definitionStatus ?? 'to-be-confirmed',
      tokenCount: c.tokenCount,
      mcap: c.marketCapUsdBillions,
      aa,
      index: aa.map((v) => Number(((v / aa[0]) * 100).toFixed(1))),
    };
  });
  const totN = cats.reduce((a, c) => a + c.tokenCount, 0);
  const totV = cats.reduce((a, c) => a + c.mcap, 0);
  cats.forEach((c) => { c.countShare = c.tokenCount / totN; c.valueShare = c.mcap / totV; });
  marketData = {
    status: marketMeta.status,
    notice: marketMeta.notice,
    years: market.activity.years,
    coverage: market.coverage.label,
    tokenCount: totN,
    mcap: totV,
    categories: cats,
    mapping: marketMeta.mapping,
  };
  const shapeSVG = (shape, size = 28, cls = 'mshape') => {
    const s = size, h = s / 2;
    const body = shape === 'circle' ? `<circle cx="${h}" cy="${h}" r="${h}"/>`
      : shape === 'triangle' ? `<path d="M${h} 0L${s} ${s}H0Z"/>`
      : shape === 'diamond' ? `<path d="M${h} 0L${s} ${h}L${h} ${s}L0 ${h}Z"/>`
      : `<rect width="${s}" height="${s}"/>`;
    return `<svg class="${cls}" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" aria-hidden="true" focusable="false">${body}</svg>`;
  };
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  P['market-notice'] = esc(marketMeta.notice);
  P['market-token-count'] = String(totN);
  P['market-mcap'] = `$${totV.toFixed(1)}B`;
  P['market-coverage'] = esc(market.coverage.label);
  P['market-bins'] = cats.map((c) => `<div class="bin" data-cat="${c.code}"><p class="bin__count"><span data-count="${c.tokenCount}">${c.tokenCount}</span><span class="bin__share">${pct(c.countShare)}</span></p><p class="bin__name">${shapeSVG(c.shape, 12, `mshape mshape--${c.code}`)}<span>${esc(c.shortLabel)}</span></p></div>`).join('');
  P['market-legend'] = `<table class="mlegend"><caption class="visually-hidden">Share of tokens and of market value by category</caption><thead><tr><th scope="col">Category</th><th scope="col" class="num">Tokens</th><th scope="col" class="num">Value</th></tr></thead><tbody>${cats.map((c) => `<tr data-cat="${c.code}"><th scope="row">${shapeSVG(c.shape, 12, `mshape mshape--${c.code}`)}<span>${esc(c.shortLabel)}</span></th><td class="num"><span class="mlegend__share" data-metric="count">${pct(c.countShare)}</span><span class="mlegend__abs">${c.tokenCount}</span></td><td class="num"><span class="mlegend__share" data-metric="value">${pct(c.valueShare)}</span><span class="mlegend__abs">$${c.mcap.toFixed(2)}B</span></td></tr>`).join('')}</tbody><tfoot><tr><th scope="row">Total</th><td class="num">${totN}</td><td class="num">$${totV.toFixed(2)}B</td></tr></tfoot></table>`;
  P['market-categories'] = cats.map((c) => `<li class="mcat" data-cat="${c.code}">
  <div class="mcat__shape">${shapeSVG(c.shape, 48, `mshape mshape--${c.code}`)}</div>
  <p class="mcat__code">${esc(c.code)}</p>
  <h4 class="mcat__name">${esc(c.name)}</h4>
  <p class="mcat__def${c.definition ? '' : ' mcat__def--tbc'}">${c.definition ? esc(c.definition) : 'Definition to be confirmed.'}</p>
  <dl class="mcat__nums"><div><dt>Tokens</dt><dd>${c.tokenCount}</dd></div><div><dt>Market value</dt><dd>$${c.mcap.toFixed(2)}B</dd></div><div><dt>Active addresses, ${market.activity.years.at(-1)} vs 2018</dt><dd>${(c.index.at(-1) / 100).toFixed(2)}×</dd></div></dl>
</li>`).join('');
  // Token → category table: published automatically once data/market/token-category-map.csv exists.
  const mapPath = p(marketMeta.mapping.file);
  const mapCols = marketMeta.mapping.columns.map((c) => c.field);
  if (fs.existsSync(mapPath)) {
    const text = fs.readFileSync(mapPath, 'utf8').replace(/^\uFEFF/, '');
    const head = text.split(/\r?\n/, 1)[0].split(',').map((h) => h.trim());
    if (head.join(',') !== mapCols.join(',')) throw new Error(`${marketMeta.mapping.file}: header must be ${mapCols.join(',')}`);
    const rows = parseCSV(text);
    const codes = mapCols.slice(2);
    const counts = Object.fromEntries(codes.map((c) => [c, 0]));
    rows.forEach((r, i) => {
      const flags = codes.map((c) => String(r[c]).trim());
      if (flags.some((v) => v !== '0' && v !== '1') || flags.filter((v) => v === '1').length !== 1)
        throw new Error(`${marketMeta.mapping.file}: row ${i + 2} must have exactly one category flag set to 1`);
      counts[codes[flags.indexOf('1')]]++;
    });
    for (const c of cats) if (counts[c.code] !== c.tokenCount) console.warn(`[data] warning: mapping has ${counts[c.code]} ${c.code} tokens, overview JSON says ${c.tokenCount}`);
    const name = `crypto-factor_${RID}_token-category-map.csv`;
    fs.copyFileSync(mapPath, path.join(outDownloads, name));
    const size = formatBytes(fs.statSync(mapPath).size);
    P['market-download-card'] = `<div class="mdl__card mdl__card--ready">
              <p class="mdl__status"><span class="status-dot" aria-hidden="true"></span>Available</p>
              <p class="mdl__title">Token → category table</p>
              <p class="mdl__desc">CSV, one row per token: ${rows.length} tokens, release ${esc(releaseLabel)}.</p>
              <a class="btn btn--light" href="/downloads/${name}" download data-download><span class="btn__label">Download CSV</span><span class="btn__meta">${size}</span><span class="btn__icon" aria-hidden="true"></span></a>
            </div>`;
  } else {
    P['market-download-card'] = `<div class="mdl__card">
              <p class="mdl__status"><span class="status-dot" aria-hidden="true"></span>Pending</p>
              <p class="mdl__title">Token → category table</p>
              <p class="mdl__desc">CSV, one row per token. It will be published once the final classification is delivered.</p>
              <button type="button" class="btn btn--light" disabled aria-disabled="true"><span class="btn__label">Not yet available</span></button>
            </div>`;
  }
  P['market-schema'] = `<table class="table table--compact"><caption class="visually-hidden">Columns of the token-to-category table</caption><thead><tr><th scope="col">Column</th><th scope="col">Type</th><th scope="col">Description</th></tr></thead><tbody>${marketMeta.mapping.columns.map((c) => `<tr><th scope="row"><code>${esc(c.field)}</code></th><td>${esc(c.type)}</td><td>${esc(c.description)}</td></tr>`).join('')}</tbody></table>`;
  P['market-sr-table'] = `<div class="visually-hidden"><table><caption>Active-address index by category (2018 = 100)</caption><thead><tr><th scope="col">Year</th>${cats.map((c) => `<th scope="col">${esc(c.shortLabel)}</th>`).join('')}</tr></thead><tbody>${market.activity.years.map((y, i) => `<tr><th scope="row">${y}</th>${cats.map((c) => `<td>${c.index[i]}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

// KaTeX stylesheet trimmed to woff2 (smaller build; every current browser supports woff2)
const katexCss = fs.readFileSync(p('node_modules/katex/dist/katex.min.css'), 'utf8')
  .replace(/src:url\((fonts\/[^)]+\.woff2)\) format\("woff2"\)[^;}]*/g, 'src:url(../../node_modules/katex/dist/$1) format("woff2")')
  .replace(/font-display:block/g, 'font-display:swap');

// ─────────────────────────────────────────────────────────── write
const gen = p('src/generated');
fs.mkdirSync(gen, { recursive: true });
const siteData = {
  release: { id: RID, label: releaseLabel, dataThrough, frequency: release.frequency },
  grid,
  factors: factors.map(({ ret, nav, ...rest }) => ({ ...rest, ret, nav })),
  papers: papers.map((x) => ({ id: x.id, short: x.short, year: x.year, journal: x.journal, title: x.title, doi: x.doi, factors: x.factors })),
  sources: meta.sources,
  theories: meta.theories,
  downloads: Object.fromEntries(Object.entries(downloads).map(([k, v]) => [k, { file: v.file, size: v.size }])),
  market: marketData,
};
fs.writeFileSync(path.join(gen, 'site-data.json'), JSON.stringify(siteData));
fs.writeFileSync(path.join(gen, 'partials.json'), JSON.stringify(P));
fs.writeFileSync(path.join(gen, 'katex.css'), katexCss);

const summary = factors.map((f) => `${f.code.padEnd(15)} n=${f.stats.n} mean=${f.stats.mean.toFixed(3)}% sd=${f.stats.sd.toFixed(2)}% t=${f.stats.t.toFixed(2)} SR=${f.stats.sharpe.toFixed(2)} min=${f.stats.min.toFixed(1)} max=${f.stats.max.toFixed(1)} nav=${f.stats.navEnd.toFixed(3)} zip=${downloads[f.code].size}`);
console.log(`[data] release ${RID} (data through ${dataThrough}), ${grid.length} grid weeks`);
console.log(summary.join('\n'));
console.log(`[data] all-factors zip ${downloads.ALL.size}; partials: ${Object.keys(P).length}`);
