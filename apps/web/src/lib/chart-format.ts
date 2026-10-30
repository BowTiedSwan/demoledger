import { CURRENCY_EXPONENT, type Currency, formatMinorUnits } from '@demoledger/shared';

export interface SeriesLike {
  key: string;
  label: string;
  currency?: Currency | undefined;
}

/** Exact tooltip / table value: money from integer minor units, counts as plain numbers. */
export function formatSeriesValue(value: unknown, currency: Currency | undefined): string {
  if (value === null || value === undefined || value === '') return 'No data';
  if (typeof value === 'string' && !/^-?\d+$/.test(value)) return value;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (!currency) return new Intl.NumberFormat('en-US').format(n);
  return formatMinorUnits(Math.round(n), currency);
}

/** Short axis tick: "€2.3K". Display only; exact values are shown in tooltips and tables. */
export function formatAxisValue(value: number, currency: Currency | undefined): string {
  if (!currency) {
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  }
  const major = value / 10 ** CURRENCY_EXPONENT[currency];
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(major);
}

/** Series grouped by currency: amounts in different currencies are never plotted on one axis. */
export function groupSeriesByCurrency<T extends SeriesLike>(
  series: readonly T[],
): { currency: Currency | undefined; series: T[] }[] {
  const groups = new Map<string, { currency: Currency | undefined; series: T[] }>();
  for (const s of series) {
    const k = s.currency ?? '';
    const g = groups.get(k) ?? { currency: s.currency, series: [] };
    g.series.push(s);
    groups.set(k, g);
  }
  return [...groups.values()];
}

/** Numeric value for plotting; null/missing/non-numeric become 0 so a gap never breaks a bar. */
export function plotValue(row: Record<string, unknown>, key: string): number {
  const v = row[key];
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : 0;
  return Number.isFinite(n) ? n : 0;
}

export const SERIES_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
] as const;
export function seriesColor(i: number): string {
  return SERIES_COLORS[i % SERIES_COLORS.length] ?? SERIES_COLORS[0];
}
