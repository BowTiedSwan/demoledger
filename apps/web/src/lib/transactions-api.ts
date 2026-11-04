import {
  aggregateResponse,
  type Direction,
  PERIODS,
  type Period,
  TRANSACTION_STATUSES,
  type TransactionListResponse,
  type TransactionStatus,
  transactionListResponse,
} from '@demoledger/shared';
import { api } from './api';

export const PAGE_SIZE = 10;

/** All wallets with ledger records, never inferred from a tenant name or a seed prefix. */
export async function listWalletIds(): Promise<string[]> {
  const res = await api.transactions.aggregate.$get({ query: { metric: 'count', group_by: 'wallet' } });
  if (!res.ok) throw new Error('Could not load wallet suggestions.');
  return aggregateResponse.parse(await res.json()).groups.map((group) => group.key);
}

export interface TransactionFilters {
  id?: string | undefined;
  wallet?: string | undefined;
  status?: TransactionStatus | undefined;
  direction?: Direction | undefined;
  period?: Period | undefined;
  offset?: number | undefined;
}

export class AuthError extends Error {
  constructor() {
    super('unauthorized');
  }
}

/** Build the REST query for `GET /api/transactions`. Empty filters are omitted. */
export function toListQuery(f: TransactionFilters): Record<string, string> {
  const q: Record<string, string> = { limit: String(PAGE_SIZE) };
  if (f.id) q.transaction_id = f.id;
  if (f.wallet) q.wallet_id = f.wallet;
  if (f.status) q.status = f.status;
  if (f.direction) q.direction = f.direction;
  if (f.period) q.period = f.period;
  if (f.offset) q.offset = String(f.offset);
  return q;
}

export async function listTransactions(f: TransactionFilters): Promise<TransactionListResponse> {
  const res = await api.transactions.$get({ query: toListQuery(f) });
  const status: number = res.status;
  if (res.ok) return transactionListResponse.parse(await res.json());
  if (status === 401 || status === 403) throw new AuthError();
  // Validation / server errors: the envelope message is safe to show.
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  throw new Error(body?.error?.message ?? 'Could not load transactions. Try again.');
}

export const PERIOD_LABELS: Record<Period, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  this_week: 'This week',
  last_7_days: 'Last 7 days',
  last_30_days: 'Last 30 days',
};
export const PERIOD_OPTIONS = PERIODS;
export const STATUS_OPTIONS = TRANSACTION_STATUSES;
