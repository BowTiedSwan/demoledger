/**
 * Vitest globalSetup: reset + seed `demoledger_test` once per run.
 * Listed by several projects (db, api): memoised per process, and a session-level advisory
 * lock held for the whole run serialises concurrent `pnpm test` invocations on the same database.
 * Seed rows are read-only for tests. Env comes from vitest.shared.ts (TEST_DATABASE_URL* mapped).
 */
import pg from 'pg';
import { loadDbEnv } from '../env';
import { resetDatabase } from '../reset';

const LOCK_KEY = 7_265_001; // arbitrary, app-specific
// Vitest may evaluate this file once per project in separate module instances, so the memo lives
// on globalThis; otherwise the second instance would wait on the lock the first one holds.
const MEMO = Symbol.for('demoledger.db.globalSetup');
const g = globalThis as { [MEMO]?: Promise<() => Promise<void>> };

async function start(): Promise<() => Promise<void>> {
  const env = loadDbEnv();
  const database = new URL(env.ownerUrl).pathname.replace(/^\//, '');
  if (database !== 'demoledger_test') {
    throw new Error(`global-setup refuses to reset "${database}"; tests must use demoledger_test`);
  }
  const lock = new pg.Client({ connectionString: env.ownerUrl });
  await lock.connect();
  await lock.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
  try {
    await resetDatabase(env);
  } catch (e) {
    await lock.end();
    throw e;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await lock.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    await lock.end().catch(() => {});
  };
}

export default async function setup(): Promise<() => Promise<void>> {
  g[MEMO] ??= start();
  return await g[MEMO];
}
