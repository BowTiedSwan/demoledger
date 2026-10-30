import { z } from 'zod';
import { currency, direction, groupBy, metric, transactionStatus } from './enums';
import { transactionId, walletId } from './ids';

/**
 * One transaction as returned to clients and to the model.
 * `tenant_id` is intentionally omitted: it is implied by the session and never needed
 * by a client, so it cannot leak or be echoed back as an "argument".
 */
export const transactionDTO = z.object({
  transaction_id: transactionId,
  wallet_id: walletId,
  /** Integer minor units; asserted <= Number.MAX_SAFE_INTEGER before serialisation. */
  amount_minor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: currency,
  /** Server-formatted from minor units (formatMinorUnits), e.g. "€1,234.56". */
  amount_display: z.string(),
  direction: direction,
  status: transactionStatus,
  /** Only meaningful for failed rows. `null` = not recorded (say so; never guess). */
  failure_reason: z.string().nullable(),
  /** ISO 8601 UTC, e.g. "2026-10-27T14:03:00.000Z". */
  occurred_at: z.iso.datetime(),
  /** Untrusted free text (may contain prompt-injection fixtures). */
  description: z.string(),
});
export type TransactionDTO = z.infer<typeof transactionDTO>;

/** Half-open UTC window actually applied, so answers can state concrete dates. */
export const appliedRange = z.object({ from: z.iso.datetime(), to: z.iso.datetime() }).nullable();
export type AppliedRange = z.infer<typeof appliedRange>;

/** `GET /api/transactions` 200 body. */
export const transactionListResponse = z.object({
  items: z.array(transactionDTO),
  /** items.length */
  returned: z.number().int().nonnegative(),
  /** Rows matching the filters, ignoring limit/offset. */
  total_matching: z.number().int().nonnegative(),
  /** true when total_matching > offset + returned. */
  truncated: z.boolean(),
  /** Offset for the next page, or null when there is none. */
  next_offset: z.number().int().nonnegative().nullable(),
  applied_range: appliedRange,
});
export type TransactionListResponse = z.infer<typeof transactionListResponse>;

/**
 * One aggregate bucket.
 * - metric=count: one bucket per group key; `currency`, `sum_minor`, `sum_display` are null.
 * - metric=sum:   one bucket per (group key, currency) — amounts are NEVER added across
 *                 currencies; `count` is the row count of that bucket.
 * `key` is the group value (status/wallet_id/direction/currency/YYYY-MM-DD), or "all" for group_by=none.
 */
export const aggregateGroup = z.object({
  key: z.string(),
  currency: currency.nullable(),
  count: z.number().int().nonnegative(),
  /** Base-10 integer string (Postgres bigint sum); parse with BigInt, never parseFloat. */
  sum_minor: z.string().regex(/^\d+$/).nullable(),
  sum_display: z.string().nullable(),
});
export type AggregateGroup = z.infer<typeof aggregateGroup>;

/** `GET /api/transactions/aggregate` 200 body. Groups ordered by key, then currency. */
export const aggregateResponse = z.object({
  metric: metric,
  group_by: groupBy,
  groups: z.array(aggregateGroup),
  /** Total rows matching the filters (across all groups). */
  total_matching: z.number().int().nonnegative(),
  applied_range: appliedRange,
});
export type AggregateResponse = z.infer<typeof aggregateResponse>;
