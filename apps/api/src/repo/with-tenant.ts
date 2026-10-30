import type { Database } from '@demoledger/db';
import { sql } from 'drizzle-orm';

/** The transaction handle handed to `withTenant` callbacks (supports `.execute(sql...)`). */
export type TenantTx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Run `fn` inside a transaction whose first statement sets the Postgres row-level-security
 * tenant: `SELECT set_config('app.tenant_id', $1, true)` (transaction-local, parameterised).
 * Every repository query goes through this helper, so no query path can skip it. The explicit
 * `tenant_id = $1` filters stay: RLS is a second, independent layer, not a replacement.
 * Queries on one transaction run sequentially on a single connection.
 */
export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
