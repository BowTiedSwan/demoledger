import type { Database } from '@demoledger/db';
import type {
  AggregateResponse,
  AggregateTransactionsArgs,
  SearchTransactionsArgs,
  SearchTransactionsResult,
} from '@demoledger/shared';
import { aggregateTransactions, listTransactions } from '../repo/transactions';

/**
 * Read port used by the tools. The tenant is a parameter supplied by the factory closure,
 * never by the model. The default adapter calls the same repo functions as the REST routes.
 */
export interface LedgerReader {
  search(
    tenantId: string,
    args: SearchTransactionsArgs,
    now: Date,
  ): Promise<Omit<SearchTransactionsResult, 'ok'>>;
  aggregate(tenantId: string, args: AggregateTransactionsArgs, now: Date): Promise<AggregateResponse>;
}

/** `db` must be the `ledger_reader` pool (SELECT on transactions only). */
export function createRepoReader(db: Database): LedgerReader {
  return {
    async search(tenantId, args, now) {
      const { limit, sort, ...filter } = args;
      const res = await listTransactions(tenantId, filter, { limit, sort, offset: 0 }, now, db);
      return {
        rows: res.items,
        returned: res.returned,
        total_matching: res.total_matching,
        truncated: res.truncated,
        applied_range: res.applied_range,
      };
    },
    async aggregate(tenantId, args, now) {
      const { metric, group_by, ...filter } = args;
      return aggregateTransactions(tenantId, filter, metric, group_by, now, db);
    },
  };
}
