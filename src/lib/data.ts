import raw from '../generated/site-data.json';

export type SourceKey = 'trading' | 'onchain';
export type TheoryKey = 'risk' | 'behavioral';
export type CategoryCode = 'GP' | 'PL' | 'PR' | 'SE';
export type Shape = 'square' | 'circle' | 'triangle' | 'diamond';

export interface FactorStats {
  n: number;
  mean: number;
  sd: number;
  t: number;
  sharpe: number;
  min: number;
  minDate: string;
  max: number;
  maxDate: string;
  navEnd: number;
  positiveShare: number;
}

export interface Factor {
  code: string;
  short: string;
  variant: string | null;
  name: string;
  fullName: string;
  source: SourceKey;
  theory: TheoryKey;
  paper: string;
  paperRole: string;
  masterId: string;
  signalId: string;
  formationStart: string;
  formationEnd: string;
  returnEnd: string;
  stats: FactorStats;
  /** Weekly return (decimal) for the week ending grid[i]; null = no observation. */
  ret: (number | null)[];
  /** Value of 1 unit invested at the start of the factor's coverage. */
  nav: (number | null)[];
}

export interface Paper {
  id: string;
  short: string;
  year: number;
  journal: string;
  title: string;
  doi: string;
  factors: { code: string; role: 'source' | 'extension' }[];
}

export interface MarketCategory {
  code: CategoryCode;
  name: string;
  shortLabel: string;
  shape: Shape;
  definition: string | null;
  definitionStatus: string;
  tokenCount: number;
  /** Market value, US$ billions. */
  mcap: number;
  aa: number[];
  /** Active-address index, first year = 100. */
  index: number[];
  countShare: number;
  valueShare: number;
}

export interface SiteData {
  release: { id: string; label: string; dataThrough: string; frequency: string };
  /** Week-ending dates (Sundays), ISO yyyy-mm-dd. */
  grid: string[];
  factors: Factor[];
  papers: Paper[];
  sources: Record<SourceKey, { label: string; detail: string }>;
  theories: Record<TheoryKey, { label: string; group: string; detail: string }>;
  downloads: Record<string, { file: string; size: number }>;
  market: {
    status: string;
    notice: string;
    years: number[];
    coverage: string;
    tokenCount: number;
    mcap: number;
    categories: MarketCategory[];
  };
}

export const data = raw as unknown as SiteData;

export const factorByCode = new Map(data.factors.map((f) => [f.code, f]));

export function factor(code: string): Factor {
  const f = factorByCode.get(code);
  if (!f) throw new Error(`Unknown factor ${code}`);
  return f;
}

/** Week-ending dates as UTC timestamps (ms). */
export const gridTime = data.grid.map((d) => Date.parse(`${d}T00:00:00Z`));

/** Index of the first grid date in each calendar year. */
export function yearStarts(): { year: number; index: number }[] {
  const out: { year: number; index: number }[] = [];
  let last = -1;
  data.grid.forEach((d, index) => {
    const year = Number(d.slice(0, 4));
    if (year !== last) {
      out.push({ year, index });
      last = year;
    }
  });
  return out;
}

export const CATEGORY_VAR: Record<CategoryCode, string> = {
  GP: '--m-gp',
  PL: '--m-pl',
  PR: '--m-pr',
  SE: '--m-se',
};