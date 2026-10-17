import scrollama from 'scrollama';
import { $, $$, debounce, svgEl } from '../lib/dom';
import { data, yearStarts, type Factor } from '../lib/data';
import { reducedMotion } from '../lib/motion';
import { gsap, ScrollTrigger } from '../lib/scroll';

/**
 * 01 Overview: a sticky factor map that regroups as the reader scrolls.
 * Step 0 lineup · 1 by data source (shape) · 2 by theory (fill) · 3 weekly returns.
 */

type Mode = 'wide' | 'narrow';

const SPLIT_QUERY = '(max-width: 767px), (max-width: 1024px) and (orientation: portrait)';
type GroupKey = 'trading' | 'onchain' | 'risk' | 'behavioral';

interface Geometry {
  w: number;
  h: number;
  glyph: number;
  lineup: { xs: number[]; y0: number; pitch: number };
  groupA: { xs: number[]; y0: number; pitch: number };
  groupB: { xs: number[]; y0: number; pitch: number };
  labelA: [number, number];
  labelB: [number, number];
  divider: [number, number, number, number];
  names: { lineup: boolean; grouped: boolean };
  timeline: { x0: number; x1: number; y: number; caption: [number, number] };
  axis: { x0: number; x1: number; y: number };
  rows: {
    top: number;
    pitch: number;
    half: number;
    x0: number;
    x1: number;
    glyph: number;
    glyphX: number;
    glyphDy: number;
    labelX: number;
    labelDy: number;
  };
  note: [number, number];
  yearEvery: number;
}

const GEOMETRY: Record<Mode, Geometry> = {
  wide: {
    w: 760,
    h: 520,
    glyph: 40,
    lineup: { xs: [95, 285, 475, 665], y0: 120, pitch: 160 },
    groupA: { xs: [80, 235, 390], y0: 200, pitch: 150 },
    groupB: { xs: [622], y0: 200, pitch: 150 },
    labelA: [20, 92],
    labelB: [510, 92],
    divider: [485, 64, 485, 440],
    names: { lineup: true, grouped: true },
    timeline: { x0: 40, x1: 720, y: 410, caption: [40, 386] },
    axis: { x0: 184, x1: 750, y: 474 },
    rows: { top: 34, pitch: 56, half: 19, x0: 184, x1: 750, glyph: 14, glyphX: 10, glyphDy: 0, labelX: 28, labelDy: 5 },
    note: [184, 514],
    yearEvery: 1,
  },
  narrow: {
    w: 360,
    h: 440,
    glyph: 28,
    lineup: { xs: [90, 270], y0: 40, pitch: 85 },
    groupA: { xs: [60, 180, 300], y0: 92, pitch: 76 },
    groupB: { xs: [90, 270], y0: 334, pitch: 76 },
    labelA: [0, 26],
    labelB: [0, 268],
    divider: [0, 236, 360, 236],
    names: { lineup: true, grouped: false },
    timeline: { x0: 16, x1: 344, y: 394, caption: [16, 372] },
    axis: { x0: 0, x1: 360, y: 392 },
    rows: { top: 38, pitch: 44, half: 11, x0: 0, x1: 360, glyph: 9, glyphX: 4.5, glyphDy: -19, labelX: 14, labelDy: -15 },
    note: [0, 434],
    yearEvery: 3,
  },
};

interface NodeState {
  x: number;
  y: number;
  s: number;
  round: boolean;
  outline: boolean;
  label: boolean;
  name: boolean;
}

interface Frame {
  nodes: Map<string, NodeState>;
  groups: GroupKey[];
  divider: boolean;
  axis: 'timeline' | 'axis' | 'none';
  rows: boolean;
}

const CLIP_AT = 0.3; // common bar scale: ±30% per week

function slots(spec: { xs: number[]; y0: number; pitch: number }, n: number): [number, number][] {
  const cols = spec.xs.length;
  return Array.from({ length: n }, (_, i) => [spec.xs[i % cols], spec.y0 + Math.floor(i / cols) * spec.pitch]);
}

function frameFor(step: number, g: Geometry, factors: Factor[]): Frame {
  const nodes = new Map<string, NodeState>();
  const round = (f: Factor) => step >= 1 && f.source === 'onchain';
  const outline = (f: Factor) => step >= 2 && f.theory === 'behavioral';

  if (step === 0) {
    slots(g.lineup, factors.length).forEach(([x, y], i) => {
      nodes.set(factors[i].code, { x, y, s: g.glyph, round: false, outline: false, label: true, name: g.names.lineup });
    });
    return { nodes, groups: [], divider: false, axis: 'timeline', rows: false };
  }

  if (step === 1 || step === 2) {
    const inA = (f: Factor) => (step === 1 ? f.source === 'trading' : f.theory === 'risk');
    const a = factors.filter(inA);
    const b = factors.filter((f) => !inA(f));
    const place = (list: Factor[], spec: Geometry['groupA']) =>
      slots(spec, list.length).forEach(([x, y], i) => {
        const f = list[i];
        nodes.set(f.code, { x, y, s: g.glyph, round: round(f), outline: outline(f), label: true, name: g.names.grouped });
      });
    place(a, g.groupA);
    place(b, g.groupB);
    return {
      nodes,
      groups: step === 1 ? ['trading', 'onchain'] : ['risk', 'behavioral'],
      divider: true,
      axis: 'none',
      rows: false,
    };
  }

  factors.forEach((f, i) => {
    const band = g.rows.top + i * g.rows.pitch;
    nodes.set(f.code, {
      x: g.rows.glyphX,
      y: band + g.rows.glyphDy,
      s: g.rows.glyph,
      round: round(f),
      outline: outline(f),
      label: false,
      name: false,
    });
  });
  return { nodes, groups: [], divider: false, axis: 'axis', rows: true };
}

interface Built {
  mode: Mode;
  geo: Geometry;
  nodes: Map<string, { g: SVGGElement; glyph: SVGRectElement; label: SVGGElement; name: SVGTextElement }>;
  groups: Map<GroupKey, SVGGElement>;
  divider: SVGLineElement;
  axis: { g: SVGGElement; line: SVGLineElement; ticks: SVGLineElement[]; labels: SVGTextElement[]; caption: SVGTextElement };
  rows: SVGGElement;
  clips: SVGRectElement[];
  note: SVGTextElement;
}

const GROUP_TEXT: Record<GroupKey, [string, string]> = {
  trading: ['Trading data', 'CoinMarketCap price, market cap, volume'],
  onchain: ['On-chain data', 'Glassnode or Dune active addresses'],
  risk: ['Risk factors', 'Systematic sources of return'],
  behavioral: ['Behavioral factors', 'Investor psychology'],
};

function build(svg: SVGSVGElement, mode: Mode, factors: Factor[]): Built {
  const geo = GEOMETRY[mode];
  svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${geo.w} ${geo.h}`);
  const defs = svgEl('defs', {}, svg);
  const N = data.grid.length;

  const divider = svgEl(
    'line',
    { class: 'fm-divider', x1: geo.divider[0], y1: geo.divider[1], x2: geo.divider[2], y2: geo.divider[3], opacity: 0 },
    svg,
  );

  const groups = new Map<GroupKey, SVGGElement>();
  (Object.keys(GROUP_TEXT) as GroupKey[]).forEach((key) => {
    const left = key === 'trading' || key === 'risk';
    const [x, y] = left ? geo.labelA : geo.labelB;
    const count = factors.filter((f) => f.source === key || f.theory === key).length;
    const g = svgEl('g', { class: 'fm-group', opacity: 0 }, svg);
    svgEl('text', { class: 'fm-group-label', x, y }, g).textContent = `${GROUP_TEXT[key][0]} · ${count}`;
    svgEl('text', { class: 'fm-group-sub', x, y: y + 20 }, g).textContent = GROUP_TEXT[key][1];
    groups.set(key, g);
  });

  // Weekly-return barcode rows (step 3).
  const rows = svgEl('g', { class: 'fm-rows', opacity: 0 }, svg);
  const clips: SVGRectElement[] = [];
  const r = geo.rows;
  const step = (r.x1 - r.x0) / N;
  const barW = Math.max(step * 0.9, 0.6);
  factors.forEach((f, i) => {
    const band = r.top + i * r.pitch;
    const clip = svgEl('clipPath', { id: `fm-clip-${mode}-${i}` }, defs);
    clips.push(svgEl('rect', { x: r.x0, y: -r.half - 2, width: 0, height: r.half * 2 + 4 }, clip));
    const row = svgEl('g', { class: 'fm-row', transform: `translate(0 ${band})` }, rows);
    let pos = '';
    let neg = '';
    f.ret.forEach((value, index) => {
      if (value === null) return;
      const h = Math.max(0.6, (Math.min(Math.abs(value), CLIP_AT) / CLIP_AT) * r.half);
      const x = r.x0 + index * step;
      const seg = `M${x.toFixed(2)} ${(value >= 0 ? -h : 0).toFixed(2)}h${barW.toFixed(2)}v${h.toFixed(2)}h${(-barW).toFixed(2)}Z`;
      if (value >= 0) pos += seg;
      else neg += seg;
    });
    const bars = svgEl('g', { 'clip-path': `url(#fm-clip-${mode}-${i})` }, row);
    svgEl('path', { class: 'fm-bars-pos', d: pos }, bars);
    svgEl('path', { class: 'fm-bars-neg', d: neg }, bars);
    svgEl('line', { class: 'fm-baseline', x1: r.x0, x2: r.x1, y1: 0, y2: 0 }, row);
    svgEl('text', { class: 'fm-code fm-row-code', x: r.labelX, y: r.labelDy }, row).textContent = f.code;
  });
  const note = svgEl('text', { class: 'fm-group-sub fm-note', x: geo.note[0], y: geo.note[1], opacity: 0 }, svg);
  note.textContent = 'One scale for all rows; weeks beyond ±30% are clipped.';

  // Shared calendar: a timeline in step 0 that becomes the time axis in step 3.
  const axisG = svgEl('g', { class: 'fm-axis', opacity: 0 }, svg);
  // The axis group is translated to the timeline's y, so the caption sits relative to it.
  const caption = svgEl('text', { class: 'fm-group-sub', x: geo.timeline.caption[0], y: geo.timeline.caption[1] - geo.timeline.y }, axisG);
  caption.textContent = 'One weekly calendar, Monday to Sunday';
  const line = svgEl('line', { class: 'fm-timeline', x1: geo.timeline.x0, x2: geo.timeline.x1, y1: 0, y2: 0 }, axisG);
  const ticks: SVGLineElement[] = [];
  const labels: SVGTextElement[] = [];
  const years = yearStarts();
  const firstYear = years[0]?.year ?? 0;
  for (const { year, index } of years) {
    const x = geo.timeline.x0 + (index / (N - 1)) * (geo.timeline.x1 - geo.timeline.x0);
    ticks.push(svgEl('line', { class: 'fm-tick', x1: x, x2: x, y1: -5, y2: 5, 'data-index': index }, axisG));
    const label = svgEl('text', { x, y: 22, 'text-anchor': 'middle', 'data-index': index }, axisG);
    label.textContent = String(year);
    if ((year - firstYear) % geo.yearEvery !== 0) label.setAttribute('visibility', 'hidden');
    labels.push(label);
  }

  // Factor glyphs on top.
  const nodes: Built['nodes'] = new Map();
  for (const f of factors) {
    const g = svgEl('g', { class: 'fm-node' }, svg);
    const s = geo.glyph;
    const glyph = svgEl('rect', { class: 'fm-glyph', x: -s / 2, y: -s / 2, width: s, height: s, rx: 0 }, g);
    const label = svgEl('g', { class: 'fm-label' }, g);
    svgEl('text', { class: 'fm-code', y: s / 2 + 22, 'text-anchor': 'middle' }, label).textContent = f.code;
    const name = svgEl('text', { class: 'fm-name', y: s / 2 + 40, 'text-anchor': 'middle' }, label);
    name.textContent = f.name;
    nodes.set(f.code, { g, glyph, label, name });
  }

  return { mode, geo, nodes, groups, divider, axis: { g: axisG, line, ticks, labels, caption }, rows, clips, note };
}

export function initOverview(): void {
  const root = $('[data-scrolly]');
  const svg = $<SVGSVGElement>('[data-factor-map]');
  if (!root || !svg) return;
  const steps = $$('.step', root);
  const factors = data.factors;
  // Phones and portrait tablets use the split layout (map on top, text below);
  // keep in sync with the matching @media block in styles/sections.css.
  const narrowQuery = window.matchMedia(SPLIT_QUERY);
  let built = build(svg, narrowQuery.matches ? 'narrow' : 'wide', factors);
  let current = 0;

  const apply = (stepIndex: number, animated: boolean) => {
    const b = built;
    const geo = b.geo;
    const frame = frameFor(stepIndex, geo, factors);
    const d = animated && !reducedMotion() ? 0.9 : 0;
    const tween = (target: gsap.TweenTarget, vars: gsap.TweenVars) =>
      d ? gsap.to(target, { duration: d, ease: 'power3.inOut', overwrite: 'auto', ...vars }) : gsap.set(target, vars);

    svg.classList.toggle('is-rows', frame.rows);
    factors.forEach((f, i) => {
      const node = b.nodes.get(f.code);
      const state = frame.nodes.get(f.code);
      if (!node || !state) return;
      const delay = d ? i * 0.03 : 0;
      tween(node.g, { x: state.x, y: state.y, delay });
      tween(node.glyph, {
        attr: { x: -state.s / 2, y: -state.s / 2, width: state.s, height: state.s, rx: state.round ? state.s / 2 : 0 },
        delay,
      });
      node.glyph.classList.toggle('is-outline', state.outline);
      tween(node.label, { opacity: state.label ? 1 : 0, duration: d * 0.5, delay: state.label ? d * 0.5 : 0 });
      tween(node.name, { opacity: state.name ? 1 : 0, duration: d * 0.5 });
    });

    for (const [key, g] of b.groups) {
      const on = frame.groups.includes(key);
      tween(g, { opacity: on ? 1 : 0, y: on ? 0 : 10, duration: d * 0.6, delay: on ? d * 0.45 : 0 });
    }
    tween(b.divider, { opacity: frame.divider ? 1 : 0, duration: d * 0.6 });

    // Timeline ↔ axis.
    const N = data.grid.length;
    const span = frame.axis === 'axis' ? geo.axis : geo.timeline;
    const xAt = (index: number) => span.x0 + (index / (N - 1)) * (span.x1 - span.x0);
    tween(b.axis.g, { opacity: frame.axis === 'none' ? 0 : 1, y: span.y, duration: d * 0.8 });
    tween(b.axis.line, { attr: { x1: span.x0, x2: span.x1 } });
    b.axis.ticks.forEach((tick, i) => {
      const x = xAt(Number(tick.dataset.index));
      tween(tick, { attr: { x1: x, x2: x } });
      tween(b.axis.labels[i], { attr: { x } });
    });
    tween(b.axis.caption, { opacity: frame.axis === 'timeline' ? 1 : 0, duration: d * 0.5 });

    // Barcode rows.
    tween(b.rows, { opacity: frame.rows ? 1 : 0, duration: d * 0.6, delay: frame.rows ? d * 0.4 : 0 });
    tween(b.note, { opacity: frame.rows ? 1 : 0, duration: d * 0.6, delay: frame.rows ? d * 0.6 : 0 });
    const full = geo.rows.x1 - geo.rows.x0 + 2;
    b.clips.forEach((clip, i) => {
      gsap.killTweensOf(clip);
      if (!frame.rows) {
        gsap.set(clip, { attr: { width: 0 }, delay: d * 0.6 });
      } else if (d) {
        gsap.fromTo(clip, { attr: { width: 0 } }, { attr: { width: full }, duration: 1.3, delay: 0.45 + i * 0.08, ease: 'power2.out' });
      } else {
        gsap.set(clip, { attr: { width: full } });
      }
    });
  };

  const activate = (index: number, animated: boolean) => {
    current = index;
    steps.forEach((s, i) => s.classList.toggle('is-active', i === index));
    apply(index, animated);
  };

  activate(0, false);
  root.classList.add('is-ready');

  // Wide: text column beside the map, trigger at 60%. Narrow: the map is pinned
  // in the top half, so a step triggers as it rises into the lower reading area.
  const offsetFor = (narrow: boolean) => (narrow ? 0.8 : 0.6);
  const scroller = scrollama();
  scroller
    .setup({ step: steps, offset: offsetFor(narrowQuery.matches) })
    .onStepEnter(({ index }) => {
      if (index !== current) activate(index, true);
    });
  window.addEventListener('resize', debounce(() => scroller.resize(), 200));

  narrowQuery.addEventListener('change', () => {
    built = build(svg, narrowQuery.matches ? 'narrow' : 'wide', factors);
    apply(current, false);
    // scrollama 3 exposes offset() at runtime (its typings lag behind).
    (scroller as unknown as { offset: (x: number) => void }).offset(offsetFor(narrowQuery.matches));
  });

  const bar = $('[data-scrolly-progress]');
  const stepsBox = $('.scrolly__steps', root);
  if (bar && stepsBox) {
    ScrollTrigger.create({
      trigger: stepsBox,
      start: 'top 55%',
      end: 'bottom 55%',
      onUpdate: (self) => {
        bar.style.transform = `scaleX(${self.progress.toFixed(4)})`;
      },
    });
  }
}