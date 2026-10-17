/*
 * Dynamic data fingerprint, large edition (factor panel).
 *
 * Ported from YUGOOD515/xjy, web/fingerprint/render.js (contourPoints and the
 * mountFingerprints draw loop). The surface, projection, band count, colour
 * stops and pointer handling of the large canvas are kept line for line, so it
 * moves exactly like the original. Changes: TypeScript types,
 * `canvas[data-factor]` instead of `canvas[data-coin]`, visualParameters() from
 * ./data.ts, and the frame timing and pause switch now live in ./clock.ts so
 * that every fingerprint on the page shares one clock. The original's small
 * canvas variant is replaced by the marks in ./mark.ts; the NFT SVG edition
 * and the WebGL sculpture are not part of this port.
 */
import type { Factor } from '../lib/data';
import { onFrame } from './clock';
import { visualParameters, type VisualParams } from './data';

export { isMotionPaused, setMotionPaused } from './clock';

export type ContourPoint = [x: number, y: number, depth: number];
export interface Pointer {
  x: number;
  y: number;
}
const CENTRE: Pointer = { x: 0, y: 0 };

const COS_TILT_VIEW = Math.cos(0.4),
  SIN_TILT_VIEW = Math.sin(0.4);
const rings = new Map<number, Float64Array>();
/** cos a and sin a of the angles a = j / count · 2π (j = 0 … count), cached per count. */
function ring(count: number): Float64Array {
  let r = rings.get(count);
  if (!r) {
    r = new Float64Array(2 * (count + 1));
    for (let j = 0; j <= count; j++) {
      const a = (j / count) * Math.PI * 2;
      r[2 * j] = Math.cos(a);
      r[2 * j + 1] = Math.sin(a);
    }
    rings.set(count, r);
  }
  return r;
}

/**
 * The original contourPoints(), writing x, y, depth of the `count + 1` points
 * into `out` (length ≥ 3 × (count + 1)) instead of allocating an array per
 * point. The sines and cosines that do not change along a contour are taken
 * once per contour (and those of the angle once per count) instead of once per
 * point; every expression keeps the original's operands and order, so the
 * values are bit-identical.
 */
export function contourInto(
  out: Float64Array,
  p: VisualParams,
  latitude: number,
  time = 0,
  count = 100,
  mouse: Pointer = CENTRE,
): Float64Array {
  const phi = latitude * Math.PI;
  const tilt = -0.35 + mouse.y * 0.14,
    turn = 0.35 + mouse.x * 0.22 + time * 0.045;
  const sinPhi = Math.sin(phi),
    cosPhi = Math.cos(phi),
    cosTurn = Math.cos(turn),
    sinTurn = Math.sin(turn),
    cosTilt = Math.cos(tilt),
    sinTilt = Math.sin(tilt);
  const angles = ring(count);
  for (let j = 0; j <= count; j++) {
    const a = (j / count) * Math.PI * 2;
    const wave =
      Math.sin(a * 3 + phi * 4 + p.seed + time * 0.22) * p.roughness * 0.21 +
      Math.cos(a * 5 - phi * 3 + time * 0.14) * p.roughness * 0.07;
    const radius = sinPhi * (1 + wave);
    let x = radius * angles[2 * j],
      y = cosPhi * 1.12;
    const z = radius * angles[2 * j + 1];
    y += Math.sin(a * 2 + phi * 2 + time * 0.16) * sinPhi * p.roughness * 0.24;
    const xx = x * cosTurn + z * sinTurn,
      zz = -x * sinTurn + z * cosTurn;
    const yy = y * COS_TILT_VIEW - zz * SIN_TILT_VIEW,
      depth = y * SIN_TILT_VIEW + zz * COS_TILT_VIEW;
    x = xx * cosTilt - yy * sinTilt;
    y = xx * sinTilt + yy * cosTilt;
    const perspective = 3.8 / (3.8 - depth * 0.22);
    out[j * 3] = x * perspective;
    out[j * 3 + 1] = y * perspective;
    out[j * 3 + 2] = depth;
  }
  return out;
}

/** The original contourPoints(): one [x, y, depth] per point. */
export function contourPoints(
  p: VisualParams,
  latitude: number,
  time = 0,
  count = 100,
  mouse: Pointer = { x: 0, y: 0 },
): ContourPoint[] {
  const buf = contourInto(new Float64Array((count + 1) * 3), p, latitude, time, count, mouse);
  const points: ContourPoint[] = [];
  for (let j = 0; j <= count; j++) points.push([buf[j * 3], buf[j * 3 + 1], buf[j * 3 + 2]]);
  return points;
}

interface Item {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  p: VisualParams;
  visible: boolean;
  mouse: Pointer;
}

/** Band count and points per band of the large fingerprint, as in the original. */
const BANDS = 83,
  STEPS = 112;

/**
 * Animate every `canvas[data-factor]` inside `container` as a large,
 * pointer-driven fingerprint. `factorList` is also the population the
 * statistics are normalised over. Returns a cleanup function.
 */
export function mountFingerprints(container: ParentNode, factorList: readonly Factor[]): () => void {
  const items: Item[] = [...container.querySelectorAll<HTMLCanvasElement>('canvas[data-factor]')].flatMap(
    (canvas) => {
      const factor = factorList.find((f) => f.code === canvas.dataset.factor),
        ctx = canvas.getContext('2d');
      if (!factor || !ctx) return [];
      return [{ canvas, ctx, p: visualParameters(factor, factorList), visible: true, mouse: { x: 0, y: 0 } }];
    },
  );
  let drawn = false;
  const points = new Float64Array(3 * (STEPS + 1));
  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const item = items.find((i) => i.canvas === e.target);
      if (item) {
        item.visible = e.isIntersecting;
        drawn = false;
      }
    }
  });
  const cleanups: (() => void)[] = [];
  for (const item of items) {
    observer.observe(item.canvas);
    const move = (e: PointerEvent) => {
      const r = item.canvas.getBoundingClientRect();
      item.mouse = {
        x: ((e.clientX - r.left) / r.width) * 2 - 1,
        y: ((e.clientY - r.top) / r.height) * 2 - 1,
      };
    };
    const reset = () => (item.mouse = { x: 0, y: 0 });
    item.canvas.addEventListener('pointermove', move);
    item.canvas.addEventListener('pointerleave', reset);
    cleanups.push(() => {
      item.canvas.removeEventListener('pointermove', move);
      item.canvas.removeEventListener('pointerleave', reset);
    });
  }
  const stop = onFrame(({ time, beat, still }) => {
    if (!beat || (still && drawn)) return;
    for (const item of items) {
      if (!item.visible) continue;
      const { canvas, ctx, p, mouse } = item,
        r = canvas.getBoundingClientRect(),
        dpr = Math.min(devicePixelRatio || 1, 2);
      if (!r.width || !r.height) continue;
      if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) {
        canvas.width = Math.round(r.width * dpr);
        canvas.height = Math.round(r.height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, r.width, r.height);
      const size = Math.min(r.width, r.height) * 0.345,
        cx = r.width / 2,
        cy = r.height / 2;
      const bands = BANDS,
        steps = STEPS,
        t = time * (0.3 + p.activity * 0.5);
      ctx.lineWidth = 1.4;
      for (let i = 1; i < bands; i++) {
        const latitude = i / bands;
        contourInto(points, p, latitude, t, steps, mouse);
        const hue = p.hue + Math.sin(latitude * Math.PI * 2 + p.mood * 2) * 66;
        const gradient = ctx.createLinearGradient(cx - size, cy - size, cx + size, cy + size);
        gradient.addColorStop(0, `hsla(${hue - 38},65%,48%,.82)`);
        gradient.addColorStop(0.46, `hsla(${hue + 55},60%,${48 + p.mood * 8}%,.92)`);
        gradient.addColorStop(1, `hsla(${hue + 130},65%,44%,.78)`);
        ctx.strokeStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(cx + points[0] * size, cy + points[1] * size);
        for (let j = 1; j <= steps; j++) ctx.lineTo(cx + points[j * 3] * size, cy + points[j * 3 + 1] * size);
        ctx.stroke();
      }
    }
    drawn = true;
  });
  const onResize = () => {
    drawn = false;
  };
  window.addEventListener('resize', onResize);
  return () => {
    stop();
    observer.disconnect();
    cleanups.forEach((f) => f());
    window.removeEventListener('resize', onResize);
  };
}
