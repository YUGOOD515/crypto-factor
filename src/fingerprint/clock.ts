/*
 * One clock for every fingerprint on the page, so that all copies of a factor
 * (panel, catalog list, download table, overview and papers maps) move in
 * step. The timing is the draw loop of YUGOOD515/xjy web/fingerprint/render.js:
 * the time advances at most every 50 ms, by at most 100 ms, and stands still
 * while the animation is paused or the reader prefers reduced motion.
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
  /** Seconds of motion so far, shared by every fingerprint. */
  time: number;
  /** The original's 50 ms beat. Canvases that only show motion redraw on beats. */
  beat: boolean;
  /** Beats so far: lets canvases that need fewer redraws keep to every n-th beat, in phase. */
  beats: number;
  /** Paused or reduced motion: the time does not advance. */
  still: boolean;
}

type Draw = (frame: Frame) => void;
const draws = new Set<Draw>();
let raf = 0,
  last = 0,
  time = 0,
  beats = 0;

function loop(stamp: number) {
  raf = requestAnimationFrame(loop);
  if (document.hidden) return;
  const beat = stamp - last >= 50;
  const still = paused || reduced();
  if (beat) {
    const delta = Math.min(stamp - last, 100);
    last = stamp;
    beats++;
    if (!still) time += delta / 1000;
  }
  const frame: Frame = { time, beat, beats, still };
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
