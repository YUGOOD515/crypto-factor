/*
 * The clock and pause switch of the large fingerprints: the factor panels
 * share one, so a single button pauses them all. The timing is the draw loop
 * of YUGOOD515/xjy web/fingerprint/render.js: the time advances at most every
 * 50 ms, by at most 100 ms, and stands still while the animation is paused or
 * the reader prefers reduced motion. The loop runs only while someone draws.
 */

let paused = false;
export function setMotionPaused(value: boolean): void {
  paused = value;
}
export function isMotionPaused(): boolean {
  return paused;
}
let reducedQuery: MediaQueryList | undefined;
export const reduced = (): boolean => {
  if (typeof matchMedia === 'undefined') return false;
  reducedQuery ??= matchMedia('(prefers-reduced-motion: reduce)');
  return reducedQuery.matches;
};

export interface Frame {
  /** Seconds of motion so far. */
  time: number;
  /** The original's 50 ms beat: the fingerprints redraw on beats only. */
  beat: boolean;
  /** Paused or reduced motion: the time does not advance. */
  still: boolean;
}

type Draw = (frame: Frame) => void;
const draws = new Set<Draw>();
let raf = 0,
  last = 0,
  time = 0;

function loop(stamp: number) {
  raf = requestAnimationFrame(loop);
  if (document.hidden) return;
  const beat = stamp - last >= 50;
  const still = paused || reduced();
  if (beat) {
    const delta = Math.min(stamp - last, 100);
    last = stamp;
    if (!still) time += delta / 1000;
  }
  const frame: Frame = { time, beat, still };
  for (const draw of draws) draw(frame);
}

/** Call `draw` on every animation frame. Returns an unsubscribe function. */
export function onFrame(draw: Draw): () => void {
  draws.add(draw);
  if (!raf) raf = requestAnimationFrame(loop);
  return () => {
    draws.delete(draw);
    if (!draws.size && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
}
