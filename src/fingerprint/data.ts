import { data, type Factor, type SourceKey } from '../lib/data';

/**
 * Inputs of the contour renderer (see ./render.ts). The renderer itself is a
 * straight port of YUGOOD515/xjy web/fingerprint/render.js; only the mapping
 * from data to these five numbers is new.
 */
export interface VisualParams {
  /** Base hue in degrees; the renderer fans out roughly −100° … +200° around it. */
  hue: number;
  /** 0 … 1. Shifts the hue wave along the latitude bands and lifts the mid-tone. */
  mood: number;
  /** 0.08 … 0.85. Amplitude of the surface waves. */
  roughness: number;
  /** 0.1 … 1. Speed of the motion: time × (0.3 + activity × 0.5). */
  activity: number;
  /** Phase of the main wave, in radians. */
  seed: number;
}

/** Same helper as the original data.js. */
export const clamp = (n: number, min = 0, max = 1): number => Math.max(min, Math.min(max, n));

/**
 * One hue family per data source. 215 and 32 are the hues the original gives
 * its two flagship assets (ETH and BTC): about 180° apart, so the trading and
 * on-chain palettes never share a dominant colour.
 */
export const SOURCE_HUE: Record<SourceKey, number> = { trading: 215, onchain: 32 };

/**
 * Output ranges. These are the bounds the original clamps each parameter to,
 * so the renderer is driven over exactly the span it was tuned for. The
 * lowest of the eight factors maps to the lower bound, the highest to the
 * upper bound and everything else linearly in between.
 */
export const RANGES = {
  mood: [0, 1],
  roughness: [0.08, 0.85],
  activity: [0.1, 1],
} as const satisfies Record<string, readonly [number, number]>;

/** The original's neutral values for a missing input. */
const NEUTRAL = { mood: 0.5, roughness: 0.25, activity: 0.25 };

/** Min–max scale `value` against `values` into [lo, hi]. */
function scale(
  value: number,
  values: readonly number[],
  [lo, hi]: readonly [number, number],
  fallback: number,
): number {
  const finite = values.filter(Number.isFinite);
  if (!Number.isFinite(value) || !finite.length) return fallback;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (!(max > min)) return (lo + hi) / 2;
  return clamp(lo + ((value - min) / (max - min)) * (hi - lo), lo, hi);
}

/**
 * Rewrite of the original visualParameters(coin, sentiment) for factors.
 *
 *   hue       data source (trading / on-chain), see SOURCE_HUE
 *   mood      annualized Sharpe ratio
 *   roughness standard deviation of weekly returns
 *   activity  |t|-statistic of the mean weekly return
 *   seed      factor ID
 *
 * Instead of the original's hard-coded divisors (sentiment / 100,
 * amplitude / 15, log10(volume) / 12) every statistic is min–max normalised
 * across `all` (by default the eight published factors).
 *
 * The seed is the factor ID's position in the sorted list of IDs, spread
 * evenly over one full period (2π). The original's character-code sum / 100
 * would give MKT, SMB and MOM almost the same phase (2.36, 2.26, 2.33).
 */
export function visualParameters(f: Factor, all: readonly Factor[] = data.factors): VisualParams {
  const pool = all.some((x) => x.code === f.code) ? all : [...all, f];
  const ids = pool.map((x) => x.code).sort();
  const pick = (stat: (x: Factor) => number) => pool.map(stat);
  const sharpe = (x: Factor) => x.stats.sharpe;
  const sd = (x: Factor) => x.stats.sd;
  const absT = (x: Factor) => Math.abs(x.stats.t);
  return {
    hue: SOURCE_HUE[f.source] ?? SOURCE_HUE.trading,
    mood: scale(sharpe(f), pick(sharpe), RANGES.mood, NEUTRAL.mood),
    roughness: scale(sd(f), pick(sd), RANGES.roughness, NEUTRAL.roughness),
    activity: scale(absT(f), pick(absT), RANGES.activity, NEUTRAL.activity),
    seed: (ids.indexOf(f.code) / ids.length) * Math.PI * 2,
  };
}
