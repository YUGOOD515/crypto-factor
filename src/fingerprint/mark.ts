/*
 * Fingerprint marks: the small fingerprints that stand in for factor icons in
 * the catalog list, the download table and the overview and papers maps.
 *
 * Scaled down to an icon, the 83 bands of the large fingerprint fall less than
 * a pixel apart and merge into a blur. A mark is drawn like a mipmapped
 * texture instead, with a band count chosen from its size on screen:
 *
 *   body   dense bands about 1.1 px apart at 30 % opacity: keeps the shape and
 *          its average colour;
 *   lines  as many bands as fit about 3 px apart, at full opacity: keeps the
 *          contour texture legible at any size.
 *
 * Surface, colours and clock are those of the large fingerprint (./render.ts,
 * ./clock.ts), so a mark is the same fingerprint with fewer lines and moves in
 * step with every other copy of its factor.
 */
import type { Factor } from '../lib/data';
import { onFrame } from './clock';
import { clamp, visualParameters, type VisualParams } from './data';
import { contourInto } from './render';

/** Radius of the surface as a share of the mark's box (the original thumbnail's). */
export const MARK_SCALE = 0.37;
/** The surface spans y = −1.12 … 1.12, so its height is 2.24 radii. */
const SPAN = 2.24;
const BODY = { pitch: 1.1, alpha: 0.3, width: 1.05, min: 12, max: 72 };
const LINES = { pitch: 3, min: 3, max: 40 };
/**
 * Marks redraw on every fourth beat (200 ms). Scaled down to an icon the
 * surface moves slowly: the lines of a 44 px mark travel about a third of a
 * pixel a second (one at most), so a redraw shifts them by a tenth of a pixel
 * or so and more frequent ones would not show.
 */
const MARK_BEATS = 4;

export interface MarkDetail {
  radius: number;
  bodyBands: number;
  bodySteps: number;
  bands: number;
  steps: number;
  lineWidth: number;
}

/** Level of detail for a mark whose box is `box` CSS pixels wide. */
export function markDetail(box: number): MarkDetail {
  const radius = box * MARK_SCALE,
    span = SPAN * radius;
  const bands = Math.round(clamp(span / LINES.pitch, LINES.min, LINES.max));
  return {
    radius,
    bodyBands: Math.round(clamp(span / BODY.pitch, BODY.min, BODY.max)),
    bodySteps: Math.round(clamp(radius * 3, 24, 72)),
    bands,
    steps: Math.round(clamp(radius * 4.5, 32, 112)),
    lineWidth: clamp((span / bands) * 0.4, 1, 1.4),
  };
}

// Gradients are built in the mark's unit space (centre 0, radius 1), so one
// set per factor and band count serves every size and position on a canvas.
type GradientCache = WeakMap<VisualParams, Map<number, CanvasGradient[]>>;
const gradients = new WeakMap<CanvasRenderingContext2D, GradientCache>();
function gradientsFor(ctx: CanvasRenderingContext2D, p: VisualParams, bands: number): CanvasGradient[] {
  let byParams = gradients.get(ctx);
  if (!byParams) gradients.set(ctx, (byParams = new WeakMap()));
  let byBands = byParams.get(p);
  if (!byBands) byParams.set(p, (byBands = new Map()));
  let list = byBands.get(bands);
  if (!list) {
    list = [];
    for (let i = 0; i < bands; i++) {
      // Same hue wave and colour stops as the large fingerprint.
      const latitude = i / bands;
      const hue = p.hue + Math.sin(latitude * Math.PI * 2 + p.mood * 2) * 66;
      const gradient = ctx.createLinearGradient(-1, -1, 1, 1);
      gradient.addColorStop(0, `hsla(${hue - 38},65%,48%,.82)`);
      gradient.addColorStop(0.46, `hsla(${hue + 55},60%,${48 + p.mood * 8}%,.92)`);
      gradient.addColorStop(1, `hsla(${hue + 130},65%,44%,.78)`);
      list.push(gradient);
    }
    byBands.set(bands, list);
  }
  return list;
}

let scratch = new Float64Array(3 * 113);
function strokeBands(
  ctx: CanvasRenderingContext2D,
  p: VisualParams,
  bands: number,
  steps: number,
  time: number,
  alpha: number,
  width: number,
) {
  if (scratch.length < 3 * (steps + 1)) scratch = new Float64Array(3 * (steps + 1));
  const strokes = gradientsFor(ctx, p, bands);
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  for (let i = 1; i < bands; i++) {
    contourInto(scratch, p, i / bands, time, steps);
    ctx.strokeStyle = strokes[i];
    ctx.beginPath();
    ctx.moveTo(scratch[0], scratch[1]);
    for (let j = 1; j <= steps; j++) ctx.lineTo(scratch[j * 3], scratch[j * 3 + 1]);
    ctx.stroke();
  }
}

export interface MarkOptions {
  /** Opacity of the whole mark. */
  alpha?: number;
  /**
   * Box size that sets the band counts, when it differs from the drawn size:
   * a mark that is growing or shrinking keeps the counts of its target size
   * instead of stepping through every count on the way.
   */
  detail?: number;
}

/** Draw one mark centred on (cx, cy) in a `box` × `box` CSS-pixel square. */
export function drawMark(
  ctx: CanvasRenderingContext2D,
  p: VisualParams,
  cx: number,
  cy: number,
  box: number,
  time: number,
  { alpha = 1, detail = box }: MarkOptions = {},
): void {
  if (!(box > 0) || !(alpha > 0)) return;
  const d = markDetail(box),
    lod = detail === box ? d : markDetail(detail);
  const t = time * (0.3 + p.activity * 0.5);
  const lineWidth = clamp(((SPAN * d.radius) / lod.bands) * 0.4, 1, 1.4);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(d.radius, d.radius);
  strokeBands(ctx, p, lod.bodyBands, d.bodySteps, t, BODY.alpha * alpha, BODY.width / d.radius);
  strokeBands(ctx, p, lod.bands, d.steps, t, alpha, lineWidth / d.radius);
  ctx.restore();
}

const dprFor = () => Math.min(devicePixelRatio || 1, 2);
function fit(canvas: HTMLCanvasElement, width: number, height: number, dpr: number) {
  const w = Math.round(width * dpr),
    h = Math.round(height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

/**
 * Animate every `canvas[data-mark]` inside `root` (one mark per canvas, sized
 * by CSS). Returns a cleanup function.
 */
export function mountMarks(root: ParentNode, factorList: readonly Factor[]): () => void {
  const items = [...root.querySelectorAll<HTMLCanvasElement>('canvas[data-mark]')].flatMap((canvas) => {
    const factor = factorList.find((f) => f.code === canvas.dataset.mark),
      ctx = canvas.getContext('2d');
    if (!factor || !ctx) return [];
    return [{ canvas, ctx, p: visualParameters(factor, factorList), visible: false, drawn: false }];
  });
  if (!items.length) return () => {};
  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const item = items.find((i) => i.canvas === e.target);
      if (item) {
        item.visible = e.isIntersecting;
        item.drawn = false;
      }
    }
  });
  items.forEach((item) => observer.observe(item.canvas));
  const stop = onFrame(({ time, beat, beats, still }) => {
    if (!beat) return;
    const advance = !still && beats % MARK_BEATS === 0;
    for (const item of items) {
      if (!item.visible || (item.drawn && !advance)) continue;
      const { canvas, ctx, p } = item,
        r = canvas.getBoundingClientRect(),
        dpr = dprFor();
      if (!r.width || !r.height) continue;
      fit(canvas, r.width, r.height, dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, r.width, r.height);
      drawMark(ctx, p, r.width / 2, r.height / 2, Math.min(r.width, r.height), time);
      item.drawn = true;
    }
  });
  const onResize = () => items.forEach((item) => (item.drawn = false));
  window.addEventListener('resize', onResize);
  return () => {
    stop();
    observer.disconnect();
    window.removeEventListener('resize', onResize);
  };
}

/** A mark placed in the user space of an SVG drawing. */
export interface LayerMark {
  code: string;
  x: number;
  y: number;
  /** Box size in SVG user units. */
  size: number;
  /** Box size that sets the band counts (see MarkOptions.detail). */
  detail?: number;
  alpha?: number;
}

export interface MarkLayer {
  /** Redraw on the next frame, also while the motion is paused. */
  invalidate(): void;
  /** Redraw on every animation frame for the next `ms` milliseconds (while the drawing moves). */
  wake(ms: number): void;
  destroy(): void;
}

/**
 * Marks for an SVG drawing, painted on one canvas laid over (or under) the
 * SVG. `marks()` returns the positions in the SVG's user space each frame, so
 * the marks follow the drawing's own transitions.
 */
export function mountMarkLayer(
  canvas: HTMLCanvasElement,
  svg: () => SVGSVGElement | null,
  marks: () => Iterable<LayerMark>,
  factorList: readonly Factor[],
): MarkLayer {
  const ctx = canvas.getContext('2d');
  const params = new Map(factorList.map((f) => [f.code, visualParameters(f, factorList)]));
  let visible = false,
    dirty = true,
    awakeUntil = 0;
  const observer = new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1].isIntersecting;
    dirty = true;
  });
  observer.observe(canvas);
  const stop = onFrame(({ time, beat, beats, still }) => {
    if (!ctx || !visible) return;
    // Every frame while the drawing moves, otherwise as the marks above.
    const awake = performance.now() < awakeUntil;
    if (!awake && !(beat && (dirty || (!still && beats % MARK_BEATS === 0)))) return;
    const r = canvas.getBoundingClientRect(),
      m = svg()?.getScreenCTM();
    if (!m || !r.width || !r.height) return;
    const dpr = dprFor(),
      k = Math.hypot(m.a, m.b);
    fit(canvas, r.width, r.height, dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    for (const mark of marks()) {
      const p = params.get(mark.code);
      if (!p) continue;
      const x = m.a * mark.x + m.c * mark.y + m.e - r.left,
        y = m.b * mark.x + m.d * mark.y + m.f - r.top;
      drawMark(ctx, p, x, y, mark.size * k, time, {
        alpha: mark.alpha ?? 1,
        detail: (mark.detail ?? mark.size) * k,
      });
    }
    dirty = false;
  });
  const onResize = () => (dirty = true);
  window.addEventListener('resize', onResize);
  return {
    invalidate: () => (dirty = true),
    wake: (ms) => (awakeUntil = Math.max(awakeUntil, performance.now() + ms)),
    destroy: () => {
      stop();
      observer.disconnect();
      window.removeEventListener('resize', onResize);
    },
  };
}
