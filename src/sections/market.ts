import { animate as anime, utils as animeUtils } from 'animejs';
import Matter from 'matter-js';
import { interpolate } from 'flubber';
import { easeCubicInOut, easeCubicOut, interpolateNumber, line as d3line, max, scaleLinear, select } from 'd3';
import { $, clamp, cssVar, debounce, onResize } from '../lib/dom';
import { CATEGORY_VAR, data, type CategoryCode, type MarketCategory, type Shape } from '../lib/data';
import { announce } from '../lib/feedback';
import { billions, fixed, int, pct } from '../lib/format';
import { reducedMotion } from '../lib/motion';
import { initSeg } from '../lib/seg';

/**
 * 06 Market overview (loaded on demand): Matter.js token drop, a flubber
 * bar ↔ ring morph for shares, and a D3 active-address index chart.
 */
export function initMarket(): void {
  const cats = data.market.categories;
  const colors = Object.fromEntries(cats.map((c) => [c.code, cssVar(CATEGORY_VAR[c.code]) || '#ccc'])) as Record<
    CategoryCode,
    string
  >;
  initCover();
  initPhysics(cats, colors);
  initShare(cats, colors);
  initActivity(cats, colors);
}

/* ───────────────────────────── Part II cover: square slides, circle grows, triangle drops */

function initCover(): void {
  const svg = $<SVGSVGElement>('.part__shapes');
  if (!svg) return;
  // The shapes wait hidden (styles/market.css) until this chunk has set them
  // up, as the cover is on screen the moment the Market tab opens.
  const ready = () => svg.classList.add('is-ready');
  const [square, circle, triangle] = Array.from(svg.children) as SVGElement[];
  if (reducedMotion() || !square || !circle || !triangle) {
    ready();
    return;
  }
  animeUtils.set(square, { translateX: -140, rotate: -90, opacity: 0 });
  animeUtils.set(circle, { scale: 0 });
  animeUtils.set(triangle, { translateY: -150, opacity: 0 });
  ready();
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      anime(square, { translateX: 0, rotate: 0, opacity: 1, duration: 900, ease: 'outExpo' });
      anime(circle, { scale: 1, duration: 800, delay: 180, ease: 'outBack(1.7)' });
      anime(triangle, { translateY: 0, opacity: 1, duration: 1100, delay: 360, ease: 'outBounce' });
    },
    { threshold: 0.4 },
  );
  io.observe(svg);
}

/* ───────────────────────────── 6.1 token drop */

interface Token {
  body: Matter.Body;
  cat: CategoryCode;
  shape: Shape;
  r: number;
}

function initPhysics(cats: MarketCategory[], colors: Record<CategoryCode, string>): void {
  const box = $('[data-physics]');
  const bins = $('[data-bins]');
  const replay = $<HTMLButtonElement>('[data-replay]');
  if (!box || !bins) return;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  box.append(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const counters = new Map(cats.map((c) => [c.code, $(`.bin[data-cat="${c.code}"] [data-count]`, bins)]));
  const ruleDark = cssVar('--line', box) || '#383838';
  const { Bodies, Body, Composite, Engine } = Matter;

  let W = 0;
  let H = 0;
  let ranges: [number, number][] = [];
  let dividers: number[] = [];
  let tokens: Token[] = [];
  let engine: Matter.Engine | null = null;
  let queue: MarketCategory[] = [];
  let counts = new Map<CategoryCode, number>();
  let frame = 0;
  let frames = 0;
  let doneAt = -1;
  let radius = 5;
  let visible = false;
  let running = false;
  let started = false;

  const measure = () => {
    W = box.clientWidth;
    H = box.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const outer = box.getBoundingClientRect();
    ranges = cats.map((c) => {
      const r = $(`.bin[data-cat="${c.code}"]`, bins)?.getBoundingClientRect();
      return r ? [r.left - outer.left, r.right - outer.left] : [0, W];
    });
    dividers = ranges.slice(1).map((r, i) => (ranges[i][1] + r[0]) / 2);
    // Size shapes so the largest pile settles at roughly 60% of the height
    // (the packed pile is denser than the nominal disc area suggests).
    radius = 9;
    cats.forEach((c, i) => {
      const width = ranges[i][1] - ranges[i][0];
      const fit = Math.sqrt((width * H * 0.6 * 1.2) / (c.tokenCount * Math.PI));
      radius = Math.min(radius, fit);
    });
    radius = clamp(radius, 2, 9);
  };

  const setCount = (code: CategoryCode, n: number) => {
    const el = counters.get(code);
    if (el) el.textContent = int(n);
  };

  const draw = () => {
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = ruleDark;
    ctx.lineWidth = 1;
    for (const x of dividers) {
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, H * 0.18);
      ctx.lineTo(Math.round(x) + 0.5, H);
      ctx.stroke();
    }
    for (const c of cats) {
      ctx.fillStyle = colors[c.code];
      ctx.beginPath();
      for (const t of tokens) {
        if (t.cat !== c.code) continue;
        if (t.shape === 'circle') {
          ctx.moveTo(t.body.position.x + t.r, t.body.position.y);
          ctx.arc(t.body.position.x, t.body.position.y, t.r, 0, Math.PI * 2);
        } else {
          const v = t.body.vertices;
          ctx.moveTo(v[0].x, v[0].y);
          for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
          ctx.closePath();
        }
      }
      ctx.fill();
    }
  };

  const makeBody = (shape: Shape, x: number, y: number, r: number): Matter.Body => {
    const opts: Matter.IChamferableBodyDefinition = {
      restitution: 0.05,
      friction: 0.3,
      frictionStatic: 0.7,
      frictionAir: 0.012,
      density: 0.002,
      slop: 0.03,
    };
    let body: Matter.Body;
    if (shape === 'circle') body = Bodies.circle(x, y, r, opts, 12);
    else if (shape === 'square') body = Bodies.rectangle(x, y, r * 1.75, r * 1.75, opts);
    else if (shape === 'triangle') {
      body = Bodies.polygon(x, y, 3, r * 1.5, opts);
      Body.rotate(body, Math.PI / 2);
    } else {
      body = Bodies.polygon(x, y, 4, r * 1.25, opts);
      Body.rotate(body, Math.PI / 4);
    }
    // Keep squares, triangles and diamonds upright so their shapes stay legible.
    if (shape !== 'circle') Body.setInertia(body, Infinity);
    return body;
  };

  /** Interleave categories so every bin fills at the same pace. */
  const buildQueue = (): MarketCategory[] =>
    cats
      .flatMap((c) => Array.from({ length: c.tokenCount }, (_, k) => ({ c, key: (k + Math.random() * 0.8) / c.tokenCount })))
      .sort((a, b) => a.key - b.key)
      .map((item) => item.c);

  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };

  const finish = () => {
    running = false;
    stop();
    for (const c of cats) setCount(c.code, c.tokenCount);
    draw();
  };

  const tick = () => {
    frame = 0;
    if (!engine || !running) return;
    const perFrame = Math.max(3, Math.round(W / 160));
    for (let k = 0; k < perFrame && queue.length; k++) {
      const c = queue.shift();
      if (!c) break;
      const i = cats.indexOf(c);
      const [lo, hi] = ranges[i];
      const pad = radius * 1.6;
      const x = lo + pad + Math.random() * Math.max(1, hi - lo - pad * 2);
      const y = -radius * 2 - Math.random() * radius * 6 - k * radius * 2.2;
      const body = makeBody(c.shape, x, y, radius);
      Body.setVelocity(body, { x: 0, y: 2 });
      Composite.add(engine.world, body);
      tokens.push({ body, cat: c.code, shape: c.shape, r: radius });
      const n = (counts.get(c.code) ?? 0) + 1;
      counts.set(c.code, n);
      setCount(c.code, n);
    }
    if (!queue.length && doneAt < 0) doneAt = frames;
    Engine.update(engine, 1000 / 60);
    draw();
    frames++;
    const settled = doneAt >= 0 && (frames - doneAt > 420 || tokens.every((t) => t.body.isSleeping));
    if (settled) {
      finish();
      return;
    }
    if (visible) frame = requestAnimationFrame(tick);
  };

  const layoutStatic = () => {
    // Reduced motion: stack the shapes in tidy columns, no physics.
    measure();
    tokens = [];
    const cell = radius * 2 + 1.5;
    cats.forEach((c, i) => {
      const [lo, hi] = ranges[i];
      const cols = Math.max(1, Math.floor((hi - lo) / cell));
      for (let k = 0; k < c.tokenCount; k++) {
        const x = lo + ((k % cols) + 0.5) * cell;
        const y = H - (Math.floor(k / cols) + 0.5) * cell;
        tokens.push({ body: makeBody(c.shape, x, y, radius), cat: c.code, shape: c.shape, r: radius });
      }
    });
    draw();
  };

  const start = () => {
    started = true;
    stop();
    if (reducedMotion()) {
      layoutStatic();
      return;
    }
    measure();
    engine = Engine.create({ enableSleeping: true, positionIterations: 8, velocityIterations: 6 });
    engine.gravity.y = 1;
    const wallOpts = { isStatic: true, friction: 0.4 };
    const walls = [
      Bodies.rectangle(W / 2, H + 50, W * 2, 100, wallOpts),
      Bodies.rectangle(-50, H / 2 - H, 100, H * 4, wallOpts),
      Bodies.rectangle(W + 50, H / 2 - H, 100, H * 4, wallOpts),
      ...dividers.map((x) => Bodies.rectangle(x, H / 2 - H, Math.max(2, ranges[1][0] - ranges[0][1]), H * 4, wallOpts)),
    ];
    Composite.add(engine.world, walls);
    tokens = [];
    queue = buildQueue();
    counts = new Map();
    for (const c of cats) setCount(c.code, 0);
    frames = 0;
    doneAt = -1;
    running = true;
    if (visible) frame = requestAnimationFrame(tick);
  };

  const io = new IntersectionObserver(
    (entries) => {
      visible = entries.some((e) => e.isIntersecting);
      if (visible && !started) start();
      else if (visible && running && !frame) frame = requestAnimationFrame(tick);
      else if (!visible) stop();
    },
    { threshold: 0.3 },
  );
  io.observe(box);

  if (reducedMotion() && replay) replay.hidden = true;
  replay?.addEventListener('click', () => {
    start();
    announce('Dropping the tokens again');
  });

  let lastWidth = box.clientWidth;
  onResize(
    box,
    debounce((width: number) => {
      // Zero while the tab is hidden: not a reason to drop the tokens again.
      if (!started || width < 10 || Math.abs(width - lastWidth) < 2) return;
      lastWidth = width;
      start();
    }, 250),
  );
}

/* ───────────────────────────── 6.2 share bars ↔ ring */

type Metric = 'value' | 'count';
type Form = 'bar' | 'ring';

function initShare(cats: MarketCategory[], colors: Record<CategoryCode, string>): void {
  const box = $('[data-share-chart]');
  const metricSeg = $('[data-seg="metric"]');
  const formSeg = $('[data-seg="form"]');
  const legend = $<HTMLTableElement>('.mlegend');
  if (!box) return;
  let metric: Metric = 'value';
  let form: Form = 'bar';
  let W = 0;
  let H = 0;
  let shown = false;

  box.setAttribute('role', 'img');
  const svg = select(box).append('svg').attr('aria-hidden', 'true');
  const tracks = svg.append('g');
  const shapes = svg.append('g');
  const labels = svg.append('g');
  const center = svg.append('g').attr('opacity', 0);
  const centerValue = center.append('text').attr('class', 'sh-center').attr('text-anchor', 'middle');
  const centerSub = center.append('text').attr('class', 'sh-center-sub').attr('text-anchor', 'middle');

  const share = (c: MarketCategory, m: Metric = metric) => (m === 'value' ? c.valueShare : c.countShare);
  const layout = () => {
    const labelW = W < 480 ? 88 : 128;
    const maxLen = Math.max(40, W - labelW - 72);
    const rowH = H / cats.length;
    const thick = Math.min(36, rowH * 0.46);
    const R = Math.max(40, Math.min(W, H) / 2 - 6);
    return { labelW, maxLen, rowH, thick, R, r: R * 0.6, cx: W / 2, cy: H / 2 };
  };

  const barPath = (i: number, s: number) => {
    const g = layout();
    const y = i * g.rowH + (g.rowH - g.thick) / 2;
    const len = Math.max(3, s * g.maxLen);
    return `M${g.labelW},${y.toFixed(2)}H${(g.labelW + len).toFixed(2)}V${(y + g.thick).toFixed(2)}H${g.labelW}Z`;
  };

  const ringPath = (i: number) => {
    const g = layout();
    let a = -Math.PI / 2;
    for (let k = 0; k < i; k++) a += share(cats[k]) * Math.PI * 2;
    const sweep = share(cats[i]) * Math.PI * 2;
    const pad = sweep > 0.05 ? 0.012 : 0;
    const a0 = a + pad / 2;
    const a1 = a + Math.max(sweep - pad / 2, pad / 2 + 0.004);
    const steps = Math.max(4, Math.ceil(((a1 - a0) * g.R) / 4));
    const pts: string[] = [];
    for (let k = 0; k <= steps; k++) {
      const t = a0 + ((a1 - a0) * k) / steps;
      pts.push(`${(g.cx + g.R * Math.cos(t)).toFixed(2)},${(g.cy + g.R * Math.sin(t)).toFixed(2)}`);
    }
    for (let k = steps; k >= 0; k--) {
      const t = a0 + ((a1 - a0) * k) / steps;
      pts.push(`${(g.cx + g.r * Math.cos(t)).toFixed(2)},${(g.cy + g.r * Math.sin(t)).toFixed(2)}`);
    }
    return `M${pts.join('L')}Z`;
  };

  const target = (i: number) => (form === 'bar' ? barPath(i, share(cats[i])) : ringPath(i));

  const describe = () => {
    const parts = cats.map((c) => `${c.shortLabel} ${pct(share(c))}`).join(', ');
    box.setAttribute(
      'aria-label',
      `${form === 'bar' ? 'Bar chart' : 'Ring chart'} of the share of ${metric === 'value' ? 'market value' : 'tokens'} by category: ${parts}.`,
    );
    if (legend) legend.dataset.metric = metric;
  };

  const render = (animated: boolean) => {
    const g = layout();
    const d = animated && !reducedMotion() ? 750 : 0;
    svg.attr('viewBox', `0 0 ${W} ${H}`);

    tracks
      .selectAll('rect')
      .data(cats)
      .join('rect')
      .attr('class', 'sh-track')
      .attr('x', g.labelW)
      .attr('y', (_c, i) => i * g.rowH + (g.rowH - g.thick) / 2)
      .attr('width', g.maxLen)
      .attr('height', g.thick)
      .transition()
      .duration(d * 0.6)
      .attr('opacity', form === 'bar' ? 1 : 0);

    const paths = shapes
      .selectAll<SVGPathElement, MarketCategory>('path')
      .data(cats)
      .join((enter) => enter.append('path').attr('d', (_c, i) => target(i)))
      .attr('fill', (c) => colors[c.code]);
    if (d) {
      paths
        .transition()
        .duration(d)
        .ease(easeCubicInOut)
        .attrTween('d', function (_c, i) {
          return interpolate(this.getAttribute('d') ?? target(i), target(i), { maxSegmentLength: 6 });
        });
    } else {
      paths.interrupt().attr('d', (_c, i) => target(i));
    }

    const rows = labels
      .selectAll<SVGGElement, MarketCategory>('g')
      .data(cats)
      .join((enter) => {
        const row = enter.append('g');
        row.append('text').attr('class', 'sh-label').attr('x', 0);
        row.append('text').attr('class', 'sh-value');
        return row;
      });
    rows
      .select('.sh-label')
      .attr('y', (_c, i) => i * g.rowH + g.rowH / 2 + 5)
      .text((c) => c.shortLabel);
    rows
      .select<SVGTextElement>('.sh-value')
      .attr('y', (_c, i) => i * g.rowH + g.rowH / 2 + 5)
      .transition()
      .duration(d)
      .ease(easeCubicInOut)
      .attr('x', (c) => g.labelW + Math.max(3, share(c) * g.maxLen) + 10)
      .tween('text', function (c) {
        const from = Number(this.dataset.v ?? share(c));
        const to = share(c);
        this.dataset.v = String(to);
        const f = interpolateNumber(from, to);
        return (t: number) => {
          this.textContent = pct(f(t));
        };
      });
    labels
      .transition()
      .duration(d * 0.5)
      .delay(form === 'bar' ? d * 0.5 : 0)
      .attr('opacity', form === 'bar' ? 1 : 0);

    centerValue.attr('x', g.cx).attr('y', g.cy + 8).text(metric === 'value' ? billions(data.market.mcap) : int(data.market.tokenCount));
    centerSub
      .attr('x', g.cx)
      .attr('y', g.cy + 30)
      .text(metric === 'value' ? 'Market value' : 'Tokens');
    center
      .transition()
      .duration(d * 0.5)
      .delay(form === 'ring' ? d * 0.5 : 0)
      .attr('opacity', form === 'ring' ? 1 : 0);
    describe();
  };

  if (metricSeg) {
    initSeg(metricSeg, (value) => {
      metric = value === 'count' ? 'count' : 'value';
      render(true);
    });
  }
  if (formSeg) {
    initSeg(formSeg, (value) => {
      form = value === 'ring' ? 'ring' : 'bar';
      render(true);
    });
  }

  onResize(box, (width, height) => {
    W = width;
    H = height;
    if (W < 10 || H < 10) return;
    if (!shown) {
      shown = true;
      // Grow the bars from zero the first time.
      shapes
        .selectAll<SVGPathElement, MarketCategory>('path')
        .data(cats)
        .join('path')
        .attr('fill', (c) => colors[c.code])
        .attr('d', (_c, i) => barPath(i, 0));
      render(true);
      return;
    }
    render(false);
  });
}

/* ───────────────────────────── 6.3 active-address index */

function markerPath(shape: Shape, s: number): string {
  switch (shape) {
    case 'square':
      return `M${-s},${-s}h${2 * s}v${2 * s}h${-2 * s}Z`;
    case 'circle':
      return `M${s},0A${s},${s} 0 1,1 ${-s},0A${s},${s} 0 1,1 ${s},0Z`;
    case 'triangle':
      return `M0,${-1.25 * s}L${1.2 * s},${0.85 * s}H${-1.2 * s}Z`;
    default:
      return `M0,${-1.35 * s}L${1.35 * s},0L0,${1.35 * s}L${-1.35 * s},0Z`;
  }
}

function initActivity(cats: MarketCategory[], colors: Record<CategoryCode, string>): void {
  const box = $('[data-activity-chart]');
  if (!box) return;
  const years = data.market.years;
  const first = years[0];
  box.tabIndex = 0;
  box.setAttribute('role', 'group');
  box.setAttribute(
    'aria-label',
    `Active-address index by category, ${first} = 100, ${first} to ${years[years.length - 1]}. Use the left and right arrow keys to read each year.`,
  );
  const tip = document.createElement('div');
  tip.className = 'ac-tip';
  tip.setAttribute('aria-hidden', 'true');
  box.append(tip);
  const svg = select(box).insert('svg', ':first-child').attr('aria-hidden', 'true');
  let index: number | null = null;
  let drawn = false;
  let geometry: { x: (year: number) => number; y: (v: number) => number; top: number; bottom: number; right: number } | null = null;

  const show = (i: number | null, speak = false) => {
    index = i;
    const rule = svg.select('.ac-rule');
    svg.selectAll<SVGPathElement, { c: MarketCategory; i: number }>('.ac-marker').attr('transform', function () {
      return this.dataset.base ?? '';
    });
    if (i === null || !geometry) {
      tip.classList.remove('is-on');
      rule.attr('opacity', 0);
      return;
    }
    const g = geometry;
    const year = years[i];
    const x = g.x(year);
    rule.attr('x1', x).attr('x2', x).attr('opacity', 1);
    svg
      .selectAll<SVGPathElement, { c: MarketCategory; i: number }>('.ac-marker')
      .filter((m) => m.i === i)
      .attr('transform', function () {
        return `${this.dataset.base ?? ''} scale(1.5)`;
      });
    const rows = [...cats].sort((a, b) => b.index[i] - a.index[i]);
    tip.innerHTML =
      `<p>${year}</p>` +
      rows
        .map(
          (c) =>
            `<p><span><svg width="10" height="10" viewBox="-6 -6 12 12" aria-hidden="true"><path d="${markerPath(c.shape, 4.2)}" fill="${colors[c.code] === '#edebe6' ? '#8a8780' : colors[c.code]}"/></svg> ${c.shortLabel}</span><b>${fixed(c.index[i], 1)}</b></p>`,
        )
        .join('');
    tip.classList.add('is-on');
    const tipW = tip.offsetWidth || 170;
    const left = x + 18 + tipW > g.right ? x - 18 - tipW : x + 18;
    tip.style.transform = `translate(${Math.max(0, left)}px, ${g.top}px)`;
    if (speak) announce(`${year}: ${rows.map((c) => `${c.shortLabel} ${fixed(c.index[i], 1)}`).join(', ')}`);
  };

  const render = (width: number, height: number) => {
    if (width < 10 || height < 10) return;
    const narrow = width < 560;
    svg.attr('viewBox', `0 0 ${width} ${height}`).selectAll('*').remove();
    // Reserve exactly the room the direct end labels need (names vary in length).
    const measure = (cls: string, text: string) => {
      const t = svg.append('text').attr('class', cls).attr('x', -9999).attr('y', -9999).text(text);
      const w = (t.node() as SVGTextElement | null)?.getComputedTextLength() ?? 0;
      t.remove();
      return w;
    };
    const lastIdx = years.length - 1;
    const labelW = max(cats.flatMap((c) => [
      measure('ac-end', c.shortLabel),
      measure('ac-end-sub', `${fixed(c.index[lastIdx], 0)} · ${(c.index[lastIdx] / 100).toFixed(1)}×`),
    ])) ?? 0;
    const m = { top: 18, right: Math.max(narrow ? 86 : 150, Math.ceil(labelW) + 22), bottom: 34, left: 44 };
    const x = scaleLinear().domain([first, years[years.length - 1]]).range([m.left, width - m.right]);
    const top = (max(cats.flatMap((c) => c.index)) ?? 100) * 1.06;
    const y = scaleLinear().domain([0, top]).nice().range([height - m.bottom, m.top]);
    geometry = { x, y, top: m.top, bottom: height - m.bottom, right: width - 8 };

    const grid = svg.append('g').attr('class', 'ac-grid');
    const axis = svg.append('g').attr('class', 'ac-axis');
    for (const t of y.ticks(narrow ? 4 : 6)) {
      grid.append('line').attr('x1', m.left).attr('x2', width - m.right).attr('y1', y(t)).attr('y2', y(t));
      axis
        .append('text')
        .attr('x', m.left - 10)
        .attr('y', y(t) + 4)
        .attr('text-anchor', 'end')
        .text(int(t));
    }
    years.forEach((yr, i) => {
      if (narrow && i % 2 === 1 && i !== years.length - 1) return;
      axis
        .append('text')
        .attr('x', x(yr))
        .attr('y', height - m.bottom + 22)
        .attr('text-anchor', 'middle')
        .text(String(yr));
    });
    svg.append('line').attr('class', 'ac-base').attr('x1', m.left).attr('x2', width - m.right).attr('y1', y(100)).attr('y2', y(100));
    // the base level gets its own emphasised tick instead of an in-plot label,
    // which would collide with the lines that all start there
    axis
      .append('text')
      .attr('class', 'ac-base-label')
      .attr('x', m.left - 10)
      .attr('y', y(100) + 4)
      .attr('text-anchor', 'end')
      .text('100');
    svg.append('line').attr('class', 'ac-rule').attr('y1', m.top).attr('y2', height - m.bottom).attr('opacity', 0);

    const path = d3line<number>()
      .x((_v, i) => x(years[i]))
      .y((v) => y(v));
    const lines = svg
      .append('g')
      .selectAll('path')
      .data(cats)
      .join('path')
      .attr('class', 'ac-line')
      .attr('stroke', (c) => colors[c.code])
      .attr('d', (c) => path(c.index) ?? '');

    const marks = svg
      .append('g')
      .selectAll('g')
      .data(cats)
      .join('g')
      .selectAll<SVGPathElement, { c: MarketCategory; i: number }>('path')
      .data((c) => c.index.map((_v, i) => ({ c, i })))
      .join('path')
      .attr('class', 'ac-marker')
      .attr('d', (p) => markerPath(p.c.shape, narrow ? 3.5 : 4.5))
      .attr('fill', (p) => colors[p.c.code])
      .style('stroke', 'var(--bg)')
      .attr('stroke-width', 1.5)
      .attr('data-base', (p) => `translate(${x(years[p.i])},${y(p.c.index[p.i])})`)
      .attr('transform', (p) => `translate(${x(years[p.i])},${y(p.c.index[p.i])})`);

    // Direct end labels with simple collision avoidance.
    const last = years.length - 1;
    const gap = 34;
    const ends = cats
      .map((c) => ({ c, y0: y(c.index[last]), y: y(c.index[last]) }))
      .sort((a, b) => a.y0 - b.y0);
    for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + gap);
    const overflow = ends[ends.length - 1].y - (height - m.bottom);
    if (overflow > 0) for (const e of ends) e.y -= overflow;
    for (let i = ends.length - 2; i >= 0; i--) ends[i].y = Math.min(ends[i].y, ends[i + 1].y - gap);
    const lx = width - m.right + 14;
    const endG = svg.append('g');
    for (const e of ends) {
      if (Math.abs(e.y - e.y0) > 3) {
        endG
          .append('path')
          .attr('d', `M${x(years[last]) + 8},${e.y0}L${lx - 4},${e.y - 4}`)
          .attr('stroke', colors[e.c.code])
          .attr('stroke-width', 1)
          .attr('fill', 'none');
      }
      endG.append('text').attr('class', 'ac-end').attr('x', lx).attr('y', e.y).attr('fill', colors[e.c.code]).text(e.c.shortLabel);
      endG
        .append('text')
        .attr('class', 'ac-end-sub')
        .attr('x', lx)
        .attr('y', e.y + 16)
        .text(`${fixed(e.c.index[last], 0)} · ${(e.c.index[last] / 100).toFixed(1)}×`);
    }

    // Pointer overlay.
    svg
      .append('rect')
      .attr('x', m.left)
      .attr('y', m.top)
      .attr('width', Math.max(0, width - m.left - m.right))
      .attr('height', Math.max(0, height - m.top - m.bottom))
      .attr('fill', 'transparent')
      .on('pointermove pointerdown', (event: PointerEvent) => {
        const [px] = [event.offsetX];
        const i = clamp(Math.round(x.invert(px) - first), 0, years.length - 1);
        if (i !== index) show(i);
      })
      .on('pointerleave', () => {
        if (document.activeElement !== box) show(null);
      });

    if (!drawn && !reducedMotion()) {
      drawn = true;
      lines.each(function (_c, i) {
        const el = this as SVGPathElement;
        const len = el.getTotalLength();
        select(el)
          .attr('stroke-dasharray', `${len} ${len}`)
          .attr('stroke-dashoffset', len)
          .transition()
          .delay(i * 160)
          .duration(1400)
          .ease(easeCubicOut)
          .attr('stroke-dashoffset', 0)
          .on('end', () => el.removeAttribute('stroke-dasharray'));
      });
      marks
        .attr('opacity', 0)
        .transition()
        .delay((p) => cats.indexOf(p.c) * 160 + p.i * 180)
        .duration(300)
        .attr('opacity', 1);
      endG.attr('opacity', 0).transition().delay(1300).duration(500).attr('opacity', 1);
    }
    drawn = true;
    if (index !== null) show(index);
  };

  box.addEventListener('keydown', (event) => {
    const n = years.length;
    let next: number | null = index;
    if (event.key === 'ArrowRight') next = index === null ? 0 : Math.min(n - 1, index + 1);
    else if (event.key === 'ArrowLeft') next = index === null ? n - 1 : Math.max(0, index - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = n - 1;
    else if (event.key === 'Escape') next = null;
    else return;
    event.preventDefault();
    show(next, next !== null);
  });
  box.addEventListener('blur', () => show(null));

  // Draw when the chart scrolls into view so the line animation is seen.
  let size: [number, number] = [0, 0];
  let seen = false;
  onResize(box, (w, h) => {
    if (w < 10 || h < 10) return; // hidden with its tab
    size = [w, h];
    if (seen) render(w, h);
  });
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting) || seen) return;
      seen = true;
      io.disconnect();
      render(size[0] || box.clientWidth, size[1] || box.clientHeight);
    },
    { threshold: 0.35 },
  );
  io.observe(box);
}