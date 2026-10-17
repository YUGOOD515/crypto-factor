/** Typographic minus (U+2212) instead of the ASCII hyphen. */
export const MINUS = '\u2212';

export function fixed(value: number, digits: number): string {
  const text = Math.abs(value).toFixed(digits);
  const isZero = Number(text) === 0;
  return (value < 0 && !isZero ? MINUS : '') + text;
}

export function signed(value: number, digits: number, suffix = ''): string {
  const text = Math.abs(value).toFixed(digits);
  if (Number(text) === 0) return text + suffix;
  return (value < 0 ? MINUS : '+') + text + suffix;
}

/** Fraction to percent: 0.584 → "58.4%". */
export function pct(fraction: number, digits = 1): string {
  return `${fixed(fraction * 100, digits)}%`;
}

/** US$ billions: 579.21 → "$579.2B". */
export function billions(value: number, digits = 1): string {
  return `$${value.toFixed(digits)}B`;
}

export function int(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

/** Value of 1 unit invested: two decimals below 10, one decimal below 100. */
export function navValue(value: number): string {
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2021-05-23" → "23 May 2021". */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** A formatter that reproduces the precision and suffix of an existing label ("−36.7%", "2.97"). */
export function formatLike(sample: string): (value: number) => string {
  const clean = sample.trim();
  const decimals = clean.match(/\.(\d+)/)?.[1].length ?? 0;
  const suffix = clean.match(/[%×]$/)?.[0] ?? '';
  return (value: number) => fixed(value, decimals) + suffix;
}