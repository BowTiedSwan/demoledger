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

/** Categories at or below this count always show every label; beyond it the axis may skip (e.g. many dates). */
export const MAX_ALL_LABELS = 12;

/** `0` = never drop a tick label; `'preserveStartEnd'` lets recharts thin out dense axes. */
export function xAxisInterval(categoryCount: number): 0 | 'preserveStartEnd' {
  return categoryCount <= MAX_ALL_LABELS ? 0 : 'preserveStartEnd';
}

/** Characters per tick line, from how many categories share the width. */
export function labelMaxChars(categoryCount: number): number {
  if (categoryCount <= 4) return 22;
  if (categoryCount <= 6) return 16;
  if (categoryCount <= 8) return 12;
  return 9;
}

/**
 * Split a category label into at most two lines on spaces; anything that still does not fit is
 * truncated with an ellipsis. The full text stays in the tooltip, the tick `<title>` and the data table.
 */
export function wrapLabel(label: string, maxChars: number): string[] {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars || current === '') current = next;
    else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  const clip = (s: string) => (s.length > maxChars ? `${s.slice(0, Math.max(1, maxChars - 1))}…` : s);
  if (lines.length <= 2) return lines.map(clip);
  const rest = lines.slice(1).join(' ');
  return [clip(lines[0] as string), clip(rest)];
}
