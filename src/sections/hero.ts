import { animate } from 'animejs';
import { $, onResize, svgEl } from '../lib/dom';
import { data, factor, yearStarts } from '../lib/data';
import { signed } from '../lib/format';
import { reducedMotion } from '../lib/motion';

/**
 * Hero "barcode": every weekly MKT return as a bar, best and worst week in red.
 * Redrawn at device pixels on resize so bars stay crisp; swept in once.
 */
export function initHero(): void {
  const box = $('[data-hero-barcode]');
  const axis = $('[data-hero-axis]');
  if (!box || !axis) return;
  const mkt = factor('MKT');
  const points = mkt.ret
    .map((r, index) => ({ r, index }))
    .filter((p): p is { r: number; index: number } => p.r !== null);
  const first = points[0].index;
  const count = data.grid.length - first;
  const best = points.reduce((a, b) => (b.r > a.r ? b : a));
  const worst = points.reduce((a, b) => (b.r < a.r ? b : a));
  let swept = false;

  const draw = (width: number, height: number) => {
    if (width < 10 || height < 10) return;
    const step = width / count;
    const barW = step > 2 ? step * 0.62 : step * 0.92;
    const top = 18;
    const bottom = 18;
    const span = best.r - worst.r;
    const base = top + ((height - top - bottom) * best.r) / span;
    const k = (height - top - bottom) / span;
    let pos = '';
    let neg = '';
    for (const p of points) {
      if (p === best || p === worst) continue;
      const x = (p.index - first) * step;
      const h = Math.max(0.5, Math.abs(p.r) * k);
      const seg = `M${x.toFixed(2)} ${(p.r >= 0 ? base - h : base).toFixed(2)}h${barW.toFixed(2)}v${h.toFixed(2)}h${(-barW).toFixed(2)}Z`;
      if (p.r >= 0) pos += seg;
      else neg += seg;
    }
    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true', focusable: 'false' });
    const clipId = 'hero-sweep';
    const clip = svgEl('clipPath', { id: clipId }, svgEl('defs', {}, svg));
    const sweep = svgEl('rect', { x: -2, y: 0, width: swept || reducedMotion() ? width + 4 : 0, height }, clip);
    const g = svgEl('g', { 'clip-path': `url(#${clipId})` }, svg);
    svgEl('path', { class: 'bar-pos', d: pos }, g);
    svgEl('path', { class: 'bar-neg', d: neg }, g);
    const hotW = Math.max(barW, 2);
    for (const p of [best, worst]) {
      const x = (p.index - first) * step - (hotW - barW) / 2;
      const h = Math.abs(p.r) * k;
      svgEl('rect', { class: 'bar-hot', x, y: p.r >= 0 ? base - h : base, width: hotW, height: h }, g);
    }
    svgEl('line', { class: 'bar-base', x1: 0, x2: width, y1: base, y2: base }, g);

    // Direct labels for the extremes, placed beside their bar.
    const note = (p: typeof best, y: number, text: string) => {
      const x = (p.index - first) * step + hotW + 6;
      const anchorEnd = x > width - 150;
      svgEl('text', { class: 'bar-note', x: anchorEnd ? x - hotW - 12 : x, y, 'text-anchor': anchorEnd ? 'end' : 'start' }, g)
        .textContent = text;
    };
    note(best, top + 10, `Best week ${signed(best.r * 100, 1, '%')}`);
    note(worst, height - 4, `Worst week ${signed(worst.r * 100, 1, '%')}`);

    box.replaceChildren(svg);

    // Year ticks under the bars.
    const every = width < 560 ? 2 : 1;
    axis.replaceChildren(
      ...yearStarts()
        .filter((y) => y.index > first + 2 && y.year % every === 0)
        .map((y) => {
          const span = document.createElement('span');
          span.style.left = `${(((y.index - first) * step) / width) * 100}%`;
          span.textContent = String(y.year);
          return span;
        }),
    );

    if (!swept && !reducedMotion()) {
      swept = true;
      const state = { w: 0 };
      animate(state, {
        w: width + 4,
        duration: 1800,
        delay: 250,
        ease: 'outExpo',
        onUpdate: () => sweep.setAttribute('width', state.w.toFixed(1)),
      });
    }
    swept = true;
  };

  onResize(box, draw);
}