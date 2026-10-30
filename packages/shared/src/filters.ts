import { z } from 'zod';
import { DAY_MS, MAX_RANGE_DAYS, resolveExplicitRange } from './dates';
import { direction, groupBy, metric, period, sort, transactionStatus } from './enums';
import { transactionId, walletId } from './ids';

export const MAX_LIMIT = 50;
export const DEFAULT_LIMIT = 20;
export const MAX_OFFSET = 10_000;

/** ISO date (2026-10-28) or ISO datetime with offset (2026-10-28T09:00:00Z). */
const isoBound = z.union([z.iso.date(), z.iso.datetime({ offset: true })], {
  error: 'must be an ISO date (YYYY-MM-DD) or an ISO datetime with offset (e.g. 2026-10-28T09:00:00Z)',
});

const amountMinor = z
  .number({ error: 'must be an integer amount in minor units (e.g. cents)' })
  .int({ error: 'must be an integer amount in minor units (e.g. cents)' })
  .min(1)
  .max(Number.MAX_SAFE_INTEGER);

interface FilterFields {
  period?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  min_amount_minor?: number | undefined;
  max_amount_minor?: number | undefined;
}

/**
 * Cross-field rules shared by tool args and REST queries:
 * period XOR from/to, from+to together, from <= to, range <= 90 days, min <= max.
 */
function checkFilters(v: FilterFields, ctx: z.RefinementCtx): void {
  const hasExplicit = v.from !== undefined || v.to !== undefined;
  if (v.period !== undefined && hasExplicit) {
    ctx.addIssue({
      code: 'custom',
      path: ['period'],
      message: "Use either 'period' or explicit 'from'/'to', not both.",
    });
  }
  if (hasExplicit && (v.from === undefined || v.to === undefined)) {
    ctx.addIssue({
      code: 'custom',
      path: [v.from === undefined ? 'from' : 'to'],
      message: "Explicit date ranges need both 'from' and 'to'.",
    });
  }
  if (v.from !== undefined && v.to !== undefined) {
    const r = resolveExplicitRange(v.from, v.to);
    if (Number.isNaN(r.from.getTime()) || Number.isNaN(r.to.getTime())) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: "'from'/'to' are not valid dates." });
    } else if (r.from.getTime() >= r.to.getTime()) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: "'from' must be on or before 'to'." });
    } else if (r.to.getTime() - r.from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: `Date range must be at most ${MAX_RANGE_DAYS} days.`,
      });
    }
  }
  if (
    v.min_amount_minor !== undefined &&
    v.max_amount_minor !== undefined &&
    v.min_amount_minor > v.max_amount_minor
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['min_amount_minor'],
      message: "'min_amount_minor' must be less than or equal to 'max_amount_minor'.",
    });
  }
}

/** Filter fields common to both tools (JSON values, as proposed by the model). */
const toolFilterShape = {
  wallet_id: walletId.optional(),
  status: transactionStatus.optional(),
  direction: direction.optional(),
  period: period.optional(),
  from: isoBound.optional(),
  to: isoBound.optional(),
  min_amount_minor: amountMinor.optional(),
  max_amount_minor: amountMinor.optional(),
};

/**
 * `search_transactions` tool input. Strict: any unknown key (e.g. `tenant_id`) is a
 * validation error. The tenant always comes from the server-side session closure.
 */
export const searchTransactionsArgs = z
  .strictObject({
    ...toolFilterShape,
    /** Look up specific transactions (e.g. ones cited in an earlier answer). Combines with other filters. */
    transaction_ids: z.array(transactionId).min(1).max(50).optional(),
    sort: sort.default('occurred_at_desc'),
    limit: z
      .number({ error: `limit must be an integer between 1 and ${MAX_LIMIT}` })
      .int()
      .min(1, { error: `limit must be between 1 and ${MAX_LIMIT}` })
      .max(MAX_LIMIT, { error: `limit must be between 1 and ${MAX_LIMIT}` })
      .default(DEFAULT_LIMIT),
  })
  .superRefine(checkFilters);
export type SearchTransactionsArgs = z.output<typeof searchTransactionsArgs>;
export type SearchTransactionsArgsInput = z.input<typeof searchTransactionsArgs>;

/** `aggregate_transactions` tool input. Sums are always split per currency. */
export const aggregateTransactionsArgs = z
  .strictObject({
    ...toolFilterShape,
    metric: metric,
    group_by: groupBy.default('none'),
  })
  .superRefine(checkFilters);
export type AggregateTransactionsArgs = z.output<typeof aggregateTransactionsArgs>;
export type AggregateTransactionsArgsInput = z.input<typeof aggregateTransactionsArgs>;

/* ------------------------------------------------------------------------- */
/* REST query strings (everything arrives as a string -> coerce)              */
/* ------------------------------------------------------------------------- */

const queryAmount = z.coerce
  .number({ error: 'must be an integer amount in minor units' })
  .int({ error: 'must be an integer amount in minor units' })
  .min(1)
  .max(Number.MAX_SAFE_INTEGER);

const queryFilterShape = {
  transaction_id: transactionId.optional(),
  wallet_id: walletId.optional(),
  status: transactionStatus.optional(),
  direction: direction.optional(),
  period: period.optional(),
  from: isoBound.optional(),
  to: isoBound.optional(),
  min_amount_minor: queryAmount.optional(),
  max_amount_minor: queryAmount.optional(),
};

/**
 * `GET /api/transactions` query. Strict: unknown params (e.g. `tenant_id`) -> 400.
 * Pagination is offset-based; ordering is deterministic (sort key, then transaction_id).
 */
export const listTransactionsQuery = z
  .strictObject({
    ...queryFilterShape,
    sort: sort.default('occurred_at_desc'),
    limit: z.coerce
      .number()
      .int()
      .min(1, { error: `limit must be between 1 and ${MAX_LIMIT}` })
      .max(MAX_LIMIT, { error: `limit must be between 1 and ${MAX_LIMIT}` })
      .default(DEFAULT_LIMIT),
    offset: z.coerce.number().int().min(0).max(MAX_OFFSET).default(0),
  })
  .superRefine(checkFilters);
export type ListTransactionsQuery = z.output<typeof listTransactionsQuery>;
export type ListTransactionsQueryInput = z.input<typeof listTransactionsQuery>;

/** `GET /api/transactions/aggregate` query. */
export const aggregateTransactionsQuery = z
  .strictObject({
    ...queryFilterShape,
    metric: metric,
    group_by: groupBy.default('none'),
  })
  .superRefine(checkFilters);
export type AggregateTransactionsQuery = z.output<typeof aggregateTransactionsQuery>;
export type AggregateTransactionsQueryInput = z.input<typeof aggregateTransactionsQuery>;

/**
 * Normalised filter the repository accepts (tool args and REST queries both map onto it).
 * Deliberately has no tenant field: the repository takes `tenantId` as its first parameter.
 */
export type TransactionFilter = {
  transaction_id?: string | undefined;
  /** From `search_transactions.transaction_ids` (D-24 follow-ups); always ANDed with tenant_id. */
  transaction_ids?: string[] | undefined;
  wallet_id?: string | undefined;
  status?: z.infer<typeof transactionStatus> | undefined;
  direction?: z.infer<typeof direction> | undefined;
  period?: z.infer<typeof period> | undefined;
  from?: string | undefined;
  to?: string | undefined;
  min_amount_minor?: number | undefined;
  max_amount_minor?: number | undefined;
};
