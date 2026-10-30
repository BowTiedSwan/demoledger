import type { Period } from './enums';

/**
 * Date semantics shared by validation (filters.ts), the repository, the tools and tests.
 * Everything is UTC. A resolved range is half-open: occurred_at >= from AND occurred_at < to.
 *
 * - today:        [start of today, start of tomorrow)
 * - yesterday:    [start of yesterday, start of today)
 * - this_week:    ISO week, Monday 00:00 UTC to the next Monday 00:00 UTC
 * - last_7_days:  7 calendar days including today
 * - last_30_days: 30 calendar days including today
 * - explicit from/to: `from` inclusive; `to` inclusive. A date-only `to` (YYYY-MM-DD)
 *   covers that whole UTC day. Datetimes must carry an offset (Z or +hh:mm).
 */
export const DAY_MS = 86_400_000;
export const MAX_RANGE_DAYS = 90;

export interface ResolvedRange {
  from: Date;
  to: Date;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function resolvePeriod(p: Period, now: Date): ResolvedRange {
  const today = startOfUtcDay(now).getTime();
  switch (p) {
    case 'today':
      return { from: new Date(today), to: new Date(today + DAY_MS) };
    case 'yesterday':
      return { from: new Date(today - DAY_MS), to: new Date(today) };
    case 'this_week': {
      const isoDay = (new Date(today).getUTCDay() + 6) % 7; // Monday = 0
      const monday = today - isoDay * DAY_MS;
      return { from: new Date(monday), to: new Date(monday + 7 * DAY_MS) };
    }
    case 'last_7_days':
      return { from: new Date(today - 6 * DAY_MS), to: new Date(today + DAY_MS) };
    case 'last_30_days':
      return { from: new Date(today - 29 * DAY_MS), to: new Date(today + DAY_MS) };
  }
}

/** Resolve explicit ISO bounds (already shape-validated) into a half-open UTC range. */
export function resolveExplicitRange(from: string, to: string): ResolvedRange {
  const fromDate = new Date(DATE_ONLY.test(from) ? `${from}T00:00:00Z` : from);
  const toDate = DATE_ONLY.test(to)
    ? new Date(new Date(`${to}T00:00:00Z`).getTime() + DAY_MS)
    : new Date(new Date(to).getTime() + 1); // inclusive datetime -> exclusive bound
  return { from: fromDate, to: toDate };
}

/** Resolve whichever date filter is present. `null` = no date filter. */
export function resolveDateFilter(
  f: { period?: Period | undefined; from?: string | undefined; to?: string | undefined },
  now: Date,
): ResolvedRange | null {
  if (f.period) return resolvePeriod(f.period, now);
  if (f.from && f.to) return resolveExplicitRange(f.from, f.to);
  return null;
}
