import { animate as anime, stagger as animeStagger } from 'animejs';
import uPlot from 'uplot';
import { $, $$, cssVar, onResize } from '../lib/dom';
import { data, factor, gridTime, type Factor } from '../lib/data';
import { formatLike, navValue } from '../lib/format';
import { reducedMotion } from '../lib/motion';
import { focusTarget, scrollToTarget } from '../lib/scroll';
import { initSeg } from '../lib/seg';
import { onThemeChange } from '../lib/theme';

/**
 * 02 Factor catalog: vertical tabs, grouping toggle with FLIP reordering,
 * rolling statistics and a log-scale uPlot chart of every factor's growth.
 */
export function initCatalog(): void {
  const list = $('[data-factor-list]');
  const figure = $('[data-nav-chart]');
  const plot = $('[data-plot]');
  const readout = $('[data-readout]');
  const legendSelected = $('[data-legend-selected]');
  if (!list || !figure || !plot || !readout) return;

  const tabs = $$<HTMLButtonElement>('.factor-item', list);
  const panels = new Map($$('.factor-panel').map((p) => [p.dataset.code ?? '', p]));
  let selected = tabs.find((t) => t.getAttribute('aria-selected') === 'true')?.dataset.code ?? data.factors[0].code;
  let chart: uPlot | null = null;

  for (const el of $$('.stat__value')) el.dataset.text = el.textContent ?? '';
  splitCodes();

  // ── chart
  const xs = gridTime.map((t) => t / 1000);
  const yearTicks = data.grid
    .map((d, i) => ({ d, t: xs[i] }))
    .filter((p, i) => i === 0 || p.d.slice(0, 4) !== data.grid[i - 1].slice(0, 4))
    .map((p) => Date.UTC(Number(p.d.slice(0, 4)), 0, 1) / 1000);
  const LOG_TICKS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];

  const setReadout = (f: Factor, index: number | null) => {
    if (index === null || index < 0) {
      readout.innerHTML = `${f.code}: 1 → <b>${navValue(f.stats.navEnd)}</b> · ${f.formationStart} to ${f.returnEnd}`;
      return;
    }
    const v = f.nav[index];
    readout.innerHTML =
      v === null || v === undefined
        ? `Week to ${data.grid[index]} · no data`
        : `Week to ${data.grid[index]} · ${f.code} <b>${navValue(v)}</b>`;
  };

  const makeChart = (code: string) => {
    const sel = factor(code);
    const order = [...data.factors.filter((f) => f.code !== code), sel];
    // Canvas colours are baked in: read the theme tokens here and redraw on a theme change.
    const color = (name: string, fallback: string) => cssVar(name, plot) || fallback;
    const accent = color('--accent', '#e1251b');
    const ink = color('--fg', '#111111');
    const ink3 = color('--fg-3', '#6b6b6b');
    const rule = color('--line', '#d9d7d0');
    const grid = color('--fill', '#e9e7e1');
    const others = color('--mute-4', '#c4c1b9');
    const surface = color('--bg', '#ffffff');
    const font = `600 12px ${cssVar('--font') || 'sans-serif'}`;
    const width = plot.clientWidth || 600;
    const height = plot.clientHeight || 340;
    const narrow = width < 520;
    const last = order.length;

    const opts: uPlot.Options = {
      width,
      height,
      padding: [10, 4, 0, 0],
      legend: { show: false },
      scales: { x: { time: true }, y: { distr: 3, log: 10 } },
      axes: [
        {
          stroke: ink3,
          font,
          size: 34,
          gap: 6,
          grid: { show: false },
          ticks: { stroke: rule, width: 1, size: 5 },
          splits: (_u, _i, min, max) =>
            yearTicks.filter((t, i) => t >= min && t <= max && (!narrow || i % 2 === 1)),
          values: (_u, splits) => splits.map((s) => (s == null ? '' : String(new Date(s * 1000).getUTCFullYear()))),
        },
        {
          stroke: ink3,
          font,
          size: 46,
          gap: 6,
          grid: { stroke: grid, width: 1 },
          ticks: { show: false },
          splits: (_u, _i, min, max) => LOG_TICKS.filter((t) => t >= min * 0.999 && t <= max * 1.001),
          // keep every chosen tick (uPlot's default log filter would blank most of them)
          filter: (_u, splits) => splits,
          values: (_u, splits) => splits.map((s) => (s == null ? '' : s < 1 ? s.toFixed(1) : String(s))),
        },
      ],
      series: [
        {},
        ...order.map((f, i) => ({
          label: f.code,
          stroke: i === last - 1 ? accent : others,
          width: i === last - 1 ? 2.5 : 1.25,
          points: { show: false },
          spanGaps: false,
        })),
      ],
      cursor: {
        y: false,
        drag: { x: false, y: false, setScale: false },
        points: {
          size: (_u, si) => (si === last ? 9 : 0),
          fill: accent,
          stroke: surface,
          width: 2,
        },
      },
      hooks: {
        setCursor: [(u) => setReadout(sel, u.cursor.idx ?? null)],
        drawAxes: [
          (u) => {
            // Emphasize the starting value of 1.
            const y = Math.round(u.valToPos(1, 'y', true)) + 0.5;
            const { ctx, bbox } = u;
            ctx.save();
            ctx.strokeStyle = ink;
            ctx.lineWidth = 1 * devicePixelRatio;
            ctx.beginPath();
            ctx.moveTo(bbox.left, y);
            ctx.lineTo(bbox.left + bbox.width, y);
            ctx.stroke();
            ctx.restore();
          },
        ],
      },
    };
    const series: uPlot.AlignedData = [xs, ...order.map((f) => f.nav.map((v) => (v === null ? null : v)))];
    chart?.destroy();
    plot.replaceChildren();
    chart = new uPlot(opts, series, plot);
    if (legendSelected) legendSelected.textContent = sel.code;
    setReadout(sel, null);
  };

  const wipe = () => {
    if (reducedMotion()) return;
    plot.classList.remove('is-wiping');
    void plot.offsetWidth;
    plot.classList.add('is-wiping');
  };
  plot.addEventListener('animationend', () => plot.classList.remove('is-wiping'));

  // ── selection
  const select = (code: string, { focus = false, animated = true } = {}) => {
    if (!panels.has(code)) return;
    const previous = panels.get(selected);
    const changed = code !== selected;
    selected = code;
    for (const tab of tabs) {
      const on = tab.dataset.code === code;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on && focus) tab.focus();
    }
    const panel = panels.get(code);
    if (!panel) return;
    for (const [key, p] of panels) p.hidden = key !== code;
    $('[data-chart-slot]', panel)?.append(figure);
    if (!changed && chart) return;
    makeChart(code);
    if (animated && changed) {
      wipe();
      rollStats(panel, previous ?? null);
      riseCode(panel);
    }
  };

  for (const tab of tabs) tab.addEventListener('click', () => select(tab.dataset.code ?? ''));
  list.addEventListener('keydown', (event) => {
    const visible = tabs.filter((t) => t.offsetParent !== null);
    const ordered = visible.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    const index = ordered.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    let next = -1;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % ordered.length;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index - 1 + ordered.length) % ordered.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = ordered.length - 1;
    else return;
    event.preventDefault();
    select(ordered[next].dataset.code ?? '', { focus: true });
  });

  // ── grouping toggle with FLIP
  const groupSeg = $('[data-seg="group"]');
  const regroup = (mode: string, animated: boolean) => {
    const before = new Map(tabs.map((t) => [t, t.getBoundingClientRect().top]));
    const key = mode === 'theory' ? 'theory' : 'source';
    const labels = key === 'theory' ? data.theories : data.sources;
    const nodes: HTMLElement[] = [];
    for (const [groupKey, meta] of Object.entries(labels)) {
      const members = tabs.filter((t) => t.dataset[key] === groupKey);
      if (!members.length) continue;
      const head = document.createElement('div');
      head.className = 'factor-list__group';
      head.setAttribute('aria-hidden', 'true');
      head.innerHTML = `<span>${'group' in meta ? meta.group : meta.label}</span><span>${String(members.length).padStart(2, '0')}</span>`;
      nodes.push(head, ...members);
    }
    list.replaceChildren(...nodes);
    if (!animated || reducedMotion()) return;
    for (const t of tabs) {
      const dy = (before.get(t) ?? 0) - t.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) continue;
      t.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], {
        duration: 560,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      });
    }
    for (const head of $$('.factor-list__group', list)) {
      head.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: 160, fill: 'backwards' });
    }
  };
  if (groupSeg) {
    const seg = initSeg(groupSeg, (value) => regroup(value, true));
    regroup(seg.value(), false);
  }

  // ── links into the catalog and the methodology
  for (const link of $$<HTMLAnchorElement>('[data-method-link]')) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const code = link.dataset.methodLink ?? '';
      document.dispatchEvent(new CustomEvent('cf:method', { detail: code }));
      const block = document.getElementById('m-factors');
      if (block) scrollToTarget(block, () => focusTarget(document.getElementById(`method-${code}`) ?? block));
    });
  }
  for (const chip of $$<HTMLAnchorElement>('[data-factor-link]')) {
    chip.addEventListener('click', (event) => {
      event.preventDefault();
      openFactor(chip.dataset.factorLink ?? '');
    });
  }
  const openFactor = (code: string) => {
    select(code);
    const section = document.getElementById('factors');
    const tab = tabs.find((t) => t.dataset.code === code);
    if (section) scrollToTarget(section, () => tab?.focus({ preventScroll: true }));
  };
  document.addEventListener('cf:factor', (event) => openFactor((event as CustomEvent<string>).detail));

  // ── init
  select(selected, { animated: false });
  let lastWidth = plot.clientWidth;
  onThemeChange(() => {
    if (chart) makeChart(selected);
  });
  onResize(plot, (width, height) => {
    if (!chart || width < 10) return;
    const crossed = (width < 520) !== (lastWidth < 520);
    lastWidth = width;
    if (crossed) makeChart(selected);
    else chart.setSize({ width, height: height || 340 });
  });
  document.fonts?.ready.then(() => chart?.redraw(false, true));
}

/** Wrap each letter of the big factor code so it can rise in on selection. */
function splitCodes(): void {
  for (const code of $$('.fp-code')) {
    const text = code.textContent ?? '';
    const visual = document.createElement('span');
    visual.className = 'split';
    visual.setAttribute('aria-hidden', 'true');
    for (const ch of text) {
      const c = document.createElement('span');
      c.className = 'split__char';
      c.textContent = ch;
      visual.append(c);
    }
    const sr = document.createElement('span');
    sr.className = 'visually-hidden';
    sr.textContent = text;
    code.replaceChildren(sr, visual);
  }
}

function riseCode(panel: HTMLElement): void {
  if (reducedMotion()) return;
  const chars = $$('.split__char', panel);
  anime(chars, { translateY: ['105%', '0%'], duration: 700, delay: animeStagger(28), ease: 'outExpo' });
}

function rollStats(panel: HTMLElement, previous: HTMLElement | null): void {
  for (const el of $$('.stat__value', panel)) {
    const final = el.dataset.text ?? el.textContent ?? '';
    const to = Number(el.dataset.value);
    const from = Number($(`.stat__value[data-stat="${el.dataset.stat}"]`, previous ?? document.body)?.dataset.value ?? 0);
    if (reducedMotion() || !Number.isFinite(to) || !Number.isFinite(from) || previous === null) {
      el.textContent = final;
      continue;
    }
    const format = formatLike(final);
    const state = { v: from };
    anime(state, {
      v: to,
      duration: 800,
      ease: 'outExpo',
      onUpdate: () => {
        el.textContent = format(state.v);
      },
      onComplete: () => {
        el.textContent = final;
      },
    });
  }
}