import { select, type Selection } from 'd3';
import { $, $$, onResize } from '../lib/dom';
import { data, factorByCode } from '../lib/data';
import { mountMarkLayer, type LayerMark } from '../fingerprint/mark';
import { focusTarget, scrollToTarget } from '../lib/scroll';
import { go } from '../lib/tabs';

/**
 * 04 Papers: an orthogonal paper → factor map (D3). Hover or focus on a paper,
 * a factor or a paper card highlights the same links everywhere. Factors are
 * drawn as fingerprint marks (on a canvas under the SVG) with their category
 * glyph as a badge.
 */

interface Link {
  paper: string;
  code: string;
  role: 'source' | 'extension';
  d: string;
}

const MIN_WIDTH = 720;
/** Fingerprint mark box and badge size, in px. */
const MARK = 32;
const BADGE = 9;
const HALO = 2.5;
const DIM = 0.16; // keep in sync with `.paper-map .is-dim` in styles/sections.css

export function initPapers(): void {
  const box = $('[data-paper-map]');
  if (!box) return;
  const cards = $$('.paper[data-paper]');
  const chips = $$('.chip[data-factor-link]');
  let hot: { paper?: string; code?: string } = {};
  let links: Link[] = [];
  let root: Selection<SVGSVGElement, unknown, null, undefined> | null = null;
  // The canvas stays when the SVG is redrawn.
  const keep = [...box.children];
  const prints = box.querySelector<HTMLCanvasElement>('[data-paper-map-prints]');
  let marks: LayerMark[] = [];
  const dimmed = new Set<string>();
  const layer = prints
    ? mountMarkLayer(
        prints,
        () => root?.node() ?? null,
        () => marks.map((m) => ({ ...m, alpha: dimmed.has(m.code) ? DIM : 1 })),
        data.factors,
      )
    : null;

  const paint = () => {
    const active = Boolean(hot.paper || hot.code);
    const isHot = (l: Link) => (hot.paper ? l.paper === hot.paper : hot.code ? l.code === hot.code : false);
    const hotPapers = new Set(links.filter(isHot).map((l) => l.paper));
    const hotCodes = new Set(links.filter(isHot).map((l) => l.code));
    if (root) {
      root.selectAll<SVGPathElement, Link>('.pm-link').classed('is-hot', isHot).classed('is-dim', (l) => active && !isHot(l));
      root.selectAll<SVGCircleElement, Link>('.pm-dot').classed('is-hot', isHot).classed('is-dim', (l) => active && !isHot(l));
      root
        .selectAll<SVGGElement, string>('.pm-node')
        .classed('is-hot', (id) => hotPapers.has(id))
        .classed('is-dim', (id) => active && !hotPapers.has(id));
      root
        .selectAll<SVGGElement, string>('.pm-factor')
        .classed('is-hot', (code) => hotCodes.has(code))
        .classed('is-dim', (code) => active && !hotCodes.has(code));
      root.selectAll('.pm-ext-label').classed('is-dim', active && !hotCodes.has('MOM3w'));
    }
    dimmed.clear();
    if (active) for (const f of data.factors) if (!hotCodes.has(f.code)) dimmed.add(f.code);
    layer?.invalidate();
    for (const card of cards) card.classList.toggle('is-hot', hotPapers.has(card.dataset.paper ?? ''));
    for (const chip of chips) {
      const paper = chip.closest<HTMLElement>('.paper')?.dataset.paper ?? '';
      chip.classList.toggle('is-hot', hotPapers.has(paper) && hotCodes.has(chip.dataset.factorLink ?? ''));
    }
  };
  const setHot = (next: { paper?: string; code?: string }) => {
    hot = next;
    paint();
  };

  for (const card of cards) {
    const id = card.dataset.paper ?? '';
    card.addEventListener('pointerenter', () => setHot({ paper: id }));
    card.addEventListener('pointerleave', () => setHot({}));
    card.addEventListener('focusin', () => setHot({ paper: id }));
    card.addEventListener('focusout', (event) => {
      if (!card.contains(event.relatedTarget as Node)) setHot({});
    });
  }

  const render = (width: number) => {
    box.hidden = width < MIN_WIDTH;
    if (width < MIN_WIDTH) {
      box.replaceChildren(...keep);
      root = null;
      marks = [];
      return;
    }
    const H = 480;
    const papers = data.papers;
    const factors = data.factors;
    const gap = 24;
    const boxW = (width - gap * (papers.length - 1)) / papers.length;
    const boxY = 30;
    const boxH = 118;
    const colW = width / factors.length;
    const fy = 372;
    const glyph = MARK;
    const factorTop = fy - glyph / 2 - 10;
    const compact = colW < 150;
    const px = (i: number) => i * (boxW + gap) + boxW / 2;
    const fx = (code: string) => (factors.findIndex((f) => f.code === code) + 0.5) * colW;

    // Choose a lane (bus height) for each paper that minimises crossings.
    const spans = papers.map((p, i) => {
      const xsOf = p.factors.map((f) => fx(f.code));
      return { i, x: px(i), lo: Math.min(px(i), ...xsOf), hi: Math.max(px(i), ...xsOf), drops: xsOf };
    });
    const laneY = (lane: number) => boxY + boxH + 40 + lane * 34;
    let best: number[] = [];
    let bestScore = Infinity;
    for (const perm of permutations(papers.map((_, i) => i))) {
      let score = 0;
      for (const a of spans) {
        for (const b of spans) {
          if (a === b) continue;
          const ya = laneY(perm[a.i]);
          const yb = laneY(perm[b.i]);
          if (yb < ya && a.x > b.lo && a.x < b.hi) score++; // a's riser crosses b's bus
          if (yb > ya) score += a.drops.filter((x) => x > b.lo && x < b.hi).length; // a's drops cross b's bus
        }
      }
      if (score < bestScore) {
        bestScore = score;
        best = perm;
      }
    }

    links = papers.flatMap((p, i) =>
      p.factors.map((f) => {
        const y = laneY(best[i]);
        return {
          paper: p.id,
          code: f.code,
          role: f.role,
          d: `M${px(i)},${boxY + boxH}V${y}H${fx(f.code)}V${factorTop}`,
        };
      }),
    );

    box.replaceChildren(...keep);
    marks = factors.map((f) => ({ code: f.code, x: fx(f.code), y: fy, size: MARK }));
    const svg = select(box)
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${H}`)
      .attr('role', 'group')
      .attr('aria-label', 'Map of source papers and the factors built from them');
    root = svg;

    svg.append('text').attr('class', 'pm-col-label').attr('x', 0).attr('y', 12).text('Paper');
    svg.append('text').attr('class', 'pm-col-label').attr('x', 0).attr('y', factorTop - 14).text('Factor');

    svg
      .append('g')
      .selectAll('path')
      .data(links)
      .join('path')
      .attr('class', (l) => `pm-link${l.role === 'extension' ? ' pm-link--ext' : ''}`)
      .attr('d', (l) => l.d);

    svg
      .append('g')
      .selectAll('circle')
      .data(links)
      .join('circle')
      .attr('class', 'pm-dot')
      .attr('r', 3.5)
      .attr('cx', (l) => fx(l.code))
      .attr('cy', factorTop);

    const ext = links.find((l) => l.role === 'extension');
    if (ext) {
      svg
        .append('text')
        .attr('class', 'pm-ext-label')
        .attr('x', fx(ext.code) + 8)
        .attr('y', factorTop - 8)
        .text('extension');
    }

    // Paper boxes.
    const nodes = svg
      .append('g')
      .selectAll<SVGGElement, string>('g')
      .data(papers.map((p) => p.id))
      .join('g')
      .attr('class', 'pm-node')
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('transform', (_id, i) => `translate(${i * (boxW + gap)},${boxY})`)
      .attr('aria-label', (id) => {
        const p = papers.find((x) => x.id === id);
        return p ? `${p.short} (${p.year}), ${p.journal}: ${p.factors.map((f) => f.code).join(', ')}. Show the paper.` : id;
      });
    nodes.append('rect').attr('width', boxW).attr('height', boxH);
    nodes.each(function (id) {
      const p = papers.find((x) => x.id === id);
      if (!p) return;
      const g = select(this);
      g.append('text').attr('class', 'pm-year').attr('x', 16).attr('y', 28).text(String(p.year));
      const title = g.append('text').attr('class', 'pm-title').attr('x', 16).attr('y', 54);
      const lines = wrap(title.node() as SVGTextElement, p.short, boxW - 32, 2);
      g.append('text')
        .attr('class', 'pm-sub')
        .attr('x', 16)
        .attr('y', 54 + lines * 19 + 6)
        .text(p.journal);
    });

    // Factor nodes.
    const fnodes = svg
      .append('g')
      .selectAll<SVGGElement, string>('g')
      .data(factors.map((f) => f.code))
      .join('g')
      .attr('class', 'pm-factor')
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('transform', (code) => `translate(${fx(code)},${fy})`)
      .attr('aria-label', (code) => `${code}, ${factorByCode.get(code)?.name ?? ''}. Open in the factor catalog.`);
    fnodes
      .append('rect')
      .attr('class', 'pm-hit')
      .attr('x', -colW / 2 + 4)
      .attr('y', -glyph / 2 - 8)
      .attr('width', colW - 8)
      .attr('height', 92);
    fnodes.each(function (code) {
      const f = factorByCode.get(code);
      if (!f) return;
      const g = select(this);
      // Category badge in the bottom-right corner of the mark, on a halo
      // that clears the fingerprint lines behind it.
      const outline = f.theory === 'behavioral' ? ' is-outline' : '';
      const round = f.source === 'onchain';
      const at = glyph / 2 - BADGE;
      g.append('rect')
        .attr('class', 'pm-halo')
        .attr('x', at - HALO)
        .attr('y', at - HALO)
        .attr('width', BADGE + HALO * 2)
        .attr('height', BADGE + HALO * 2)
        .attr('rx', round ? BADGE / 2 + HALO : 0);
      g.append('rect')
        .attr('class', `pm-glyph${outline}`)
        .attr('x', at)
        .attr('y', at)
        .attr('width', BADGE)
        .attr('height', BADGE)
        .attr('rx', round ? BADGE / 2 : 0);
      const label = compact && f.variant ? f.short : f.code;
      g.append('text').attr('class', 'pm-code').attr('y', glyph / 2 + 24).attr('text-anchor', 'middle').text(label);
      const name = compact ? (f.variant ?? '') : f.name;
      g.append('text').attr('class', 'pm-name').attr('y', glyph / 2 + 42).attr('text-anchor', 'middle').text(name);
    });

    nodes
      .on('pointerenter focus', (_e, id) => setHot({ paper: id }))
      .on('pointerleave blur', () => setHot({}))
      .on('click', (_e, id) => openPaper(id))
      .on('keydown', (e: KeyboardEvent, id) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openPaper(id);
        }
      });
    fnodes
      .on('pointerenter focus', (_e, code) => setHot({ code }))
      .on('pointerleave blur', () => setHot({}))
      .on('click', (_e, code) => openFactor(code))
      .on('keydown', (e: KeyboardEvent, code) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openFactor(code);
        }
      });
    paint();
    layer?.invalidate();
  };

  const openPaper = (id: string) => {
    const card = cards.find((c) => c.dataset.paper === id);
    if (card) scrollToTarget(card, () => focusTarget(card));
  };
  // A factor opens in the Factors tab, selected there and with its tab focused.
  const openFactor = (code: string) => {
    go('factors', {
      prepare: () => document.dispatchEvent(new CustomEvent('cf:factor', { detail: code })),
      focus: document.getElementById(`tab-${code}`),
    });
  };
  for (const chip of chips) {
    chip.addEventListener('click', (event) => {
      event.preventDefault();
      openFactor(chip.dataset.factorLink ?? '');
    });
  }

  let lastWidth = -1;
  const run = (width: number) => {
    // Hidden with its tab: keep the last layout for when it comes back.
    if (width < 10 || width === lastWidth) return;
    lastWidth = width;
    render(width);
  };
  onResize(box.parentElement ?? box, () => run(box.parentElement?.clientWidth ?? box.clientWidth));
  document.fonts?.ready.then(() => {
    lastWidth = -1;
    run(box.parentElement?.clientWidth ?? box.clientWidth);
  });
}

/** Word-wrap SVG text into tspans; returns the number of lines used. */
function wrap(text: SVGTextElement, content: string, maxWidth: number, maxLines: number): number {
  const words = content.split(/\s+/);
  const x = text.getAttribute('x') ?? '0';
  let line: string[] = [];
  let lines = 1;
  let tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
  tspan.setAttribute('x', x);
  text.append(tspan);
  for (const word of words) {
    line.push(word);
    tspan.textContent = line.join(' ');
    if (tspan.getComputedTextLength() > maxWidth && line.length > 1 && lines < maxLines) {
      line.pop();
      tspan.textContent = line.join(' ');
      line = [word];
      lines++;
      tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      tspan.setAttribute('x', x);
      tspan.setAttribute('dy', '19');
      tspan.textContent = word;
      text.append(tspan);
    }
  }
  return lines;
}

function* permutations(items: number[]): Generator<number[]> {
  if (items.length <= 1) {
    yield items;
    return;
  }
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) yield [items[i], ...p];
  }
}