/*
 * Dynamic data fingerprint, large edition (factor panel).
 *
 * Ported from YUGOOD515/xjy, web/fingerprint/render.js (contourPoints and the
 * mountFingerprints draw loop). The surface, projection, band count, colour
 * stops and pointer handling of the large canvas are kept line for line, so it
 * moves exactly like the original. Changes: TypeScript types,
 * `canvas[data-factor]` instead of `canvas[data-coin]`, visualParameters() from
 * ./data.ts, the frame timing and pause switch live in ./clock.ts (shared by
 * the fingerprints of all factor panels and the hero), the draw loop runs only
 * while a fingerprint is in view. Two options serve the hero: `pointerArea`
 * lets a canvas that sits behind other content follow the pointer, and
 * `settle` lets it move only briefly instead of all the time. The original's small canvas variant is replaced by
 * the still marks in ./mark.ts; the NFT SVG edition and the WebGL sculpture
 * are not part of this port.
 */
import type { Factor } from '../lib/data';
import { onFrame, type Frame } from './clock';
import { clamp, visualParameters, type VisualParams } from './data';

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
  /** Pointer position across the canvas, −1 … 1 on each axis. */
  target: Pointer;
  /** The position the shape turns to: `target` itself, or easing towards it. */
  mouse: Pointer;
  /** With `settle`: own time, which runs at `speed` × the clock … */
  time: number;
  speed: number;
  /** … the clock time at the previous beat, and whether the frame drawn last was at rest. */
  clock: number;
  rested: boolean;
}

export interface MountOptions {
  /**
   * Follow a mouse or pen over this element instead of over the canvas, for a
   * canvas that sits behind other content. The position is still measured
   * from the canvas, but clamped to its edges and eased, so the shape turns
   * smoothly wherever the pointer enters.
   */
  pointerArea?: HTMLElement;
  /**
   * Move on its own only briefly: fast when mounted, slowing to a stop within
   * about four and a half seconds, and woken again by each pointer move.
   * Once at rest the canvas is not redrawn, so a fingerprint that is always
   * in view costs nothing while nobody interacts with it.
   */
  settle?: boolean;
}

/** Band count and points per band of the large fingerprint, as in the original. */
const BANDS = 83,
  STEPS = 112;
/** Share of the remaining distance an eased pointer covers per 50 ms beat. */
const EASE = 0.12;
/**
 * Settling: speed when mounted and after a pointer move (× the normal speed),
 * time constant of the slow-down in seconds, and the speed it rests below.
 */
const START = 4,
  WAKE = 0.6,
  SETTLE = 1,
  REST = 0.05;

/**
 * Animate every `canvas[data-factor]` inside `container` as a large,
 * pointer-driven fingerprint. `factorList` is also the population the
 * statistics are normalised over. A canvas gets `data-drawn` once its first
 * frame is on it, so CSS can fade it in then. Returns a cleanup function.
 */
export function mountFingerprints(
  container: ParentNode,
  factorList: readonly Factor[],
  { pointerArea, settle = false }: MountOptions = {},
): () => void {
  const items: Item[] = [...container.querySelectorAll<HTMLCanvasElement>('canvas[data-factor]')].flatMap(
    (canvas) => {
      const factor = factorList.find((f) => f.code === canvas.dataset.factor),
        ctx = canvas.getContext('2d');
      if (!factor || !ctx) return [];
      const item: Item = {
        canvas,
        ctx,
        p: visualParameters(factor, factorList),
        visible: false,
        target: { x: 0, y: 0 },
        mouse: { x: 0, y: 0 },
        time: 0,
        speed: START,
        clock: 0,
        rested: false,
      };
      return [item];
    },
  );
  let drawn = false;
  const points = new Float64Array(3 * (STEPS + 1));
  // The draw loop runs only while a fingerprint is in view.
  let stop: (() => void) | null = null;
  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const item = items.find((i) => i.canvas === e.target);
      if (item) {
        item.visible = e.isIntersecting;
        drawn = false;
      }
    }
    const inView = items.some((i) => i.visible);
    if (inView && !stop) stop = onFrame(draw);
    else if (!inView && stop) {
      stop();
      stop = null;
    }
  });
  const cleanups: (() => void)[] = [];
  for (const item of items) {
    observer.observe(item.canvas);
    const area = pointerArea ?? item.canvas;
    const move = (e: PointerEvent) => {
      // Behind other content a touch is a scroll, not a turn.
      if (pointerArea && e.pointerType === 'touch') return;
      const r = item.canvas.getBoundingClientRect(),
        x = ((e.clientX - r.left) / r.width) * 2 - 1,
        y = ((e.clientY - r.top) / r.height) * 2 - 1;
      item.target = pointerArea ? { x: clamp(x, -1, 1), y: clamp(y, -1, 1) } : { x, y };
      if (settle) item.speed = Math.max(item.speed, WAKE);
    };
    const reset = () => (item.target = { x: 0, y: 0 });
    area.addEventListener('pointermove', move);
    area.addEventListener('pointerleave', reset);
    cleanups.push(() => {
      area.removeEventListener('pointermove', move);
      area.removeEventListener('pointerleave', reset);
    });
  }
  function draw({ time, beat, still }: Frame) {
    if (!beat || (still && drawn)) return;
    for (const item of items) {
      if (!item.visible) continue;
      const { target } = item;
      item.mouse = pointerArea
        ? { x: item.mouse.x + (target.x - item.mouse.x) * EASE, y: item.mouse.y + (target.y - item.mouse.y) * EASE }
        : target;
      let now = time;
      if (settle) {
        // Exponential slow-down, integrated exactly so a long gap cannot make the shape jump.
        const dt = time - item.clock,
          decay = Math.exp(-dt / SETTLE);
        item.clock = time;
        item.time += item.speed * SETTLE * (1 - decay);
        item.speed = item.speed * decay < REST ? 0 : item.speed * decay;
        const atRest =
          !item.speed && Math.abs(target.x - item.mouse.x) + Math.abs(target.y - item.mouse.y) < 0.002;
        if (atRest && item.rested && drawn) continue;
        item.rested = atRest;
        now = item.time;
      }
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
        t = now * (0.3 + p.activity * 0.5);
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
      if (!canvas.hasAttribute('data-drawn')) canvas.setAttribute('data-drawn', '');
    }
    drawn = true;
  }
  const onResize = () => {
    drawn = false;
  };
  window.addEventListener('resize', onResize);
  return () => {
    stop?.();
    observer.disconnect();
    cleanups.forEach((f) => f());
    window.removeEventListener('resize', onResize);
  };
}
