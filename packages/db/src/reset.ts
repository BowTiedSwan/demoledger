import { createDb, createPool } from './client';
import { type DbEnv, loadDbEnv } from './env';
import { runMigrations } from './migrate';
import { applyRoles } from './roles';
import { seedDatabase } from './seed/seed';

const SAFE_DB_NAMES = /^demoledger(_test)?$/;

export interface ResetResult {
  database: string;
  transactions: number;
  users: number;
}

/** Drop everything, migrate, apply roles, seed. Target is the DATABASE_URL (owner) database. */
export async function resetDatabase(
  env: DbEnv,
  opts: { allowAnyDatabase?: boolean } = {},
): Promise<ResetResult> {
  const database = new URL(env.ownerUrl).pathname.replace(/^\//, '');
  if (!opts.allowAnyDatabase && !SAFE_DB_NAMES.test(database)) {
    throw new Error(`refusing to reset database "${database}" (allowed: demoledger, demoledger_test)`);
  }
  const pool = createPool(env.ownerUrl, { statementTimeoutMs: 120_000, max: 3 });
  try {
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await runMigrations(pool);
    await applyRoles(pool, env);
    const seeded = await seedDatabase(createDb(pool), { anchor: env.anchor, authSecret: env.authSecret });
    return { database, ...seeded };
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = loadDbEnv();
  const r = await resetDatabase(env, { allowAnyDatabase: process.env.ALLOW_RESET_ANY_DATABASE === '1' });
  console.log(
    `reset ${r.database}: ${r.transactions} transactions, ${r.users} users (anchor ${env.anchor.toISOString()})`,
  );
}
