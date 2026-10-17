/*
 * Dynamic data fingerprint.
 *
 * Ported from YUGOOD515/xjy, web/fingerprint/render.js (contourPoints,
 * mountFingerprints and the shared pause switch). The surface, projection,
 * band counts, colour stops, frame throttle and pointer handling are kept
 * line for line so the motion looks the same as the original; the changes are
 * TypeScript types, `canvas[data-factor]` instead of `canvas[data-coin]`, and
 * visualParameters() from ./data.ts, which maps factor statistics instead of
 * coin market data. The NFT SVG edition and the WebGL sculpture of the
 * original are not part of this port.
 */
import type { Factor } from '../lib/data';
import { visualParameters, type VisualParams } from './data';

let paused = false;
export function setMotionPaused(value: boolean): void {
  paused = value;
}
export function isMotionPaused(): boolean {
  return paused;
}
const reduced = (): boolean =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export type ContourPoint = [x: number, y: number, depth: number];
export interface Pointer {
  x: number;
  y: number;
}

export function contourPoints(
  p: VisualParams,
  latitude: number,
  time = 0,
  count = 100,
  mouse: Pointer = { x: 0, y: 0 },
): ContourPoint[] {
  const points: ContourPoint[] = [],
    phi = latitude * Math.PI;
  const tilt = -0.35 + mouse.y * 0.14,
    turn = 0.35 + mouse.x * 0.22 + time * 0.045;
  for (let j = 0; j <= count; j++) {
    const a = (j / count) * Math.PI * 2;
    const wave =
      Math.sin(a * 3 + phi * 4 + p.seed + time * 0.22) * p.roughness * 0.21 +
      Math.cos(a * 5 - phi * 3 + time * 0.14) * p.roughness * 0.07;
    const radius = Math.sin(phi) * (1 + wave);
    let x = radius * Math.cos(a),
      y = Math.cos(phi) * 1.12;
    const z = radius * Math.sin(a);
    y += Math.sin(a * 2 + phi * 2 + time * 0.16) * Math.sin(phi) * p.roughness * 0.24;
    const xx = x * Math.cos(turn) + z * Math.sin(turn),
      zz = -x * Math.sin(turn) + z * Math.cos(turn);
    const yy = y * Math.cos(0.4) - zz * Math.sin(0.4),
      depth = y * Math.sin(0.4) + zz * Math.cos(0.4);
    x = xx * Math.cos(tilt) - yy * Math.sin(tilt);
    y = xx * Math.sin(tilt) + yy * Math.cos(tilt);
    const perspective = 3.8 / (3.8 - depth * 0.22);
    points.push([x * perspective, y * perspective, depth]);
  }
  return points;
}

interface Item {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  p: VisualParams;
  small: boolean;
  visible: boolean;
  mouse: Pointer;
}

/**
 * Animate every `canvas[data-factor]` inside `container`. Canvases marked
 * `data-size="small"` get the light thumbnail variant; the others follow the
 * pointer. `factorList` is also the population the statistics are normalised
 * over. Returns a cleanup function.
 */
export function mountFingerprints(container: ParentNode, factorList: readonly Factor[]): () => void {
  const items: Item[] = [...container.querySelectorAll<HTMLCanvasElement>('canvas[data-factor]')].flatMap(
    (canvas) => {
      const factor = factorList.find((f) => f.code === canvas.dataset.factor),
        ctx = canvas.getContext('2d');
      if (!factor || !ctx) return [];
      return [
        {
          canvas,
          ctx,
          p: visualParameters(factor, factorList),
          small: canvas.dataset.size === 'small',
          visible: true,
          mouse: { x: 0, y: 0 },
        },
      ];
    },
  );
  let raf = 0,
    last = 0,
    time = 0,
    drawn = false;
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
    if (!item.small) {
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
  }
  function draw(stamp: number) {
    raf = requestAnimationFrame(draw);
    if (document.hidden || stamp - last < 50) return;
    const delta = Math.min(stamp - last, 100);
    last = stamp;
    if (!paused && !reduced()) time += delta / 1000;
    if ((paused || reduced()) && drawn) return;
    for (const item of items) {
      if (!item.visible) continue;
      const { canvas, ctx, p, small, mouse } = item,
        r = canvas.getBoundingClientRect(),
        dpr = Math.min(devicePixelRatio || 1, small ? 1.5 : 2);
      if (!r.width || !r.height) continue;
      if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) {
        canvas.width = Math.round(r.width * dpr);
        canvas.height = Math.round(r.height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, r.width, r.height);
      const size = Math.min(r.width, r.height) * (small ? 0.37 : 0.345),
        cx = r.width / 2,
        cy = r.height / 2;
      const bands = small ? 30 : 83,
        steps = small ? 54 : 112;
      ctx.lineWidth = small ? 1.05 : 1.4;
      for (let i = 1; i < bands; i++) {
        const latitude = i / bands,
          points = contourPoints(p, latitude, time * (0.3 + p.activity * 0.5), steps, mouse);
        const hue = p.hue + Math.sin(latitude * Math.PI * 2 + p.mood * 2) * 66;
        const gradient = ctx.createLinearGradient(cx - size, cy - size, cx + size, cy + size);
        gradient.addColorStop(0, `hsla(${hue - 38},65%,48%,.82)`);
        gradient.addColorStop(0.46, `hsla(${hue + 55},60%,${48 + p.mood * 8}%,.92)`);
        gradient.addColorStop(1, `hsla(${hue + 130},65%,44%,.78)`);
        ctx.strokeStyle = gradient;
        ctx.beginPath();
        points.forEach(([x, y], j) =>
          j ? ctx.lineTo(cx + x * size, cy + y * size) : ctx.moveTo(cx + x * size, cy + y * size),
        );
        ctx.stroke();
      }
    }
    drawn = true;
  }
  raf = requestAnimationFrame(draw);
  const onResize = () => {
    drawn = false;
  };
  window.addEventListener('resize', onResize);
  return () => {
    cancelAnimationFrame(raf);
    observer.disconnect();
    cleanups.forEach((f) => f());
    window.removeEventListener('resize', onResize);
  };
}
