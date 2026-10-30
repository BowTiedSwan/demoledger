/**
 * Transaction repository — the single enforcement point for tenant isolation.
 *
 * Rules (do not break):
 *  - `tenantId` is ALWAYS the first parameter and ALWAYS becomes `tenant_id = $n`.
 *  - It comes from the validated session (REST) or the tool factory closure (AI); never from
 *    request input or model output. The filter types below have no tenant field.
 *  - Queries are parameterised (drizzle `sql` template); nothing is string-built from input.
 *  - Callers pass the `ledger_reader` Database (SELECT on transactions only).
 *  - Money: bigint -> number only after a safe-integer assert; sums stay base-10 strings,
 *    always split per currency.
 *
 * Ordering is deterministic: sort key, then `transaction_id` ASC as tie-break.
 */
import type { Database } from '@demoledger/db';
import {
  type AggregateGroup,
  type AggregateResponse,
  type AppliedRange,
  CURRENCIES,
  type Currency,
  DEFAULT_LIMIT,
  formatMinorUnits,
  type GroupBy,
  MAX_LIMIT,
  type Metric,
  resolveDateFilter,
  type Sort,
  type TransactionDTO,
  type TransactionFilter,
  type TransactionListResponse,
} from '@demoledger/shared';
import { type SQL, sql } from 'drizzle-orm';
import { toSafeNumber } from '../lib/safe-int';
import { withTenant } from './with-tenant';

export interface ListPage {
  limit?: number;
  offset?: number;
  sort?: Sort;
}

interface TxRow extends Record<string, unknown> {
  transaction_id: string;
  wallet_id: string;
  amount_minor: string;
  currency: string;
  direction: TransactionDTO['direction'];
  status: TransactionDTO['status'];
  failure_reason: string | null;
  occurred_at: Date;
  description: string;
}

function asCurrency(value: string): Currency {
  const c = value.trim();
  if (!(CURRENCIES as readonly string[]).includes(c))
    throw new Error(`unsupported currency in database: ${c}`);
  return c as Currency;
}

function toRange(filter: TransactionFilter, now: Date) {
  return resolveDateFilter(filter, now);
}

function appliedRange(range: ReturnType<typeof toRange>): AppliedRange {
  return range ? { from: range.from.toISOString(), to: range.to.toISOString() } : null;
}

/** WHERE clause. `tenant_id = $1` is unconditionally the first predicate. */
function whereClause(tenantId: string, filter: TransactionFilter, range: ReturnType<typeof toRange>): SQL {
  const conds: SQL[] = [sql`tenant_id = ${tenantId}`];
  if (filter.transaction_id !== undefined) conds.push(sql`transaction_id = ${filter.transaction_id}`);
  if (filter.transaction_ids !== undefined) {
    // One bound parameter per ID inside ARRAY[...]; drizzle would expand a bare JS array into a tuple.
    const ids = filter.transaction_ids.map((id) => sql`${id}`);
    conds.push(sql`transaction_id = ANY(ARRAY[${sql.join(ids, sql`, `)}]::text[])`);
  }
  if (filter.wallet_id !== undefined) conds.push(sql`wallet_id = ${filter.wallet_id}`);
  if (filter.status !== undefined) conds.push(sql`status = ${filter.status}`);
  if (filter.direction !== undefined) conds.push(sql`direction = ${filter.direction}`);
  if (filter.min_amount_minor !== undefined) conds.push(sql`amount_minor >= ${filter.min_amount_minor}`);
  if (filter.max_amount_minor !== undefined) conds.push(sql`amount_minor <= ${filter.max_amount_minor}`);
  if (range) {
    conds.push(sql`occurred_at >= ${range.from.toISOString()}::timestamptz`);
    conds.push(sql`occurred_at < ${range.to.toISOString()}::timestamptz`);
  }
  return sql.join(conds, sql` AND `);
}

// NB: qualify amount_minor — a bare name in ORDER BY resolves to the SELECT alias (text), not the bigint column.
const ORDER_BY: Record<Sort, SQL> = {
  occurred_at_desc: sql`occurred_at DESC, transaction_id ASC`,
  amount_desc: sql`transactions.amount_minor DESC, transaction_id ASC`,
  amount_asc: sql`transactions.amount_minor ASC, transaction_id ASC`,
};

function toDto(r: TxRow): TransactionDTO {
  const currency = asCurrency(r.currency);
  const amount = toSafeNumber(r.amount_minor, 'amount_minor');
  return {
    transaction_id: r.transaction_id,
    wallet_id: r.wallet_id,
    amount_minor: amount,
    currency,
    amount_display: formatMinorUnits(amount, currency),
    direction: r.direction,
    status: r.status,
    failure_reason: r.failure_reason,
    occurred_at: new Date(r.occurred_at).toISOString(),
    description: r.description,
  };
}

/**
 * List transactions for one tenant.
 * @param db   the `ledger_reader` Database (deps.db.reader)
 * @param now  injected clock (deps.now()) used to resolve period filters in UTC
 */
export async function listTransactions(
  tenantId: string,
  filter: TransactionFilter,
  page: ListPage,
  now: Date,
  db: Database,
): Promise<TransactionListResponse> {
  const limit = Math.min(Math.max(Math.trunc(page.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
  const offset = Math.max(Math.trunc(page.offset ?? 0), 0);
  const range = toRange(filter, now);
  const where = whereClause(tenantId, filter, range);

  const { rows, count } = await withTenant(db, tenantId, async (tx) => ({
    rows: await tx.execute<TxRow>(sql`
      SELECT transaction_id, wallet_id, amount_minor::text AS amount_minor, currency, direction,
             status, failure_reason, occurred_at, description
      FROM transactions
      WHERE ${where}
      ORDER BY ${ORDER_BY[page.sort ?? 'occurred_at_desc']}
      LIMIT ${limit} OFFSET ${offset}`),
    count: await tx.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM transactions WHERE ${where}`),
  }));

  const items = rows.rows.map(toDto);
  const total = toSafeNumber(count.rows[0]?.n ?? '0', 'count');
  const end = offset + items.length;
  return {
    items,
    returned: items.length,
    total_matching: total,
    truncated: total > end,
    next_offset: total > end ? end : null,
    applied_range: appliedRange(range),
  };
}

const GROUP_KEY: Record<GroupBy, SQL> = {
  none: sql`'all'::text`,
  status: sql`status::text`,
  wallet: sql`wallet_id`,
  direction: sql`direction::text`,
  currency: sql`currency::text`,
  // Rows without a recorded reason (and non-failed rows) bucket under the key `not_recorded`.
  failure_reason: sql`COALESCE(failure_reason, 'not_recorded')`,
  day: sql`to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
};

interface AggRow extends Record<string, unknown> {
  key: string;
  currency: string;
  n: string;
  sum_minor: string;
}

/**
 * Count or sum for one tenant. Sums are NEVER added across currencies: with metric=sum each
 * bucket is one (group key, currency) pair. Groups are ordered by key, then currency.
 */
export async function aggregateTransactions(
  tenantId: string,
  filter: TransactionFilter,
  metric: Metric,
  groupBy: GroupBy,
  now: Date,
  db: Database,
): Promise<AggregateResponse> {
  const range = toRange(filter, now);
  const where = whereClause(tenantId, filter, range);
  const key = GROUP_KEY[groupBy];

  const res = await withTenant(db, tenantId, (tx) =>
    metric === 'count'
      ? tx.execute<AggRow>(sql`
          SELECT ${key} AS key, count(*)::text AS n
          FROM transactions WHERE ${where}
          GROUP BY 1 ORDER BY 1`)
      : tx.execute<AggRow>(sql`
          SELECT ${key} AS key, currency::text AS currency, count(*)::text AS n, sum(amount_minor)::text AS sum_minor
          FROM transactions WHERE ${where}
          GROUP BY 1, 2 ORDER BY 1, 2`),
  );

  const groups: AggregateGroup[] = res.rows.map((r) => {
    const count = toSafeNumber(r.n, 'count');
    if (metric === 'count') return { key: r.key, currency: null, count, sum_minor: null, sum_display: null };
    const currency = asCurrency(r.currency);
    return {
      key: r.key,
      currency,
      count,
      sum_minor: r.sum_minor,
      sum_display: formatMinorUnits(r.sum_minor, currency),
    };
  });

  // An ungrouped count over zero rows still answers "0" explicitly.
  if (metric === 'count' && groupBy === 'none' && groups.length === 0) {
    groups.push({ key: 'all', currency: null, count: 0, sum_minor: null, sum_display: null });
  }

  return {
    metric,
    group_by: groupBy,
    groups,
    total_matching: groups.reduce((n, g) => n + g.count, 0),
    applied_range: appliedRange(range),
  };
}
