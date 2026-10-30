import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { createDb, createPool } from './client';

export const MIGRATIONS_FOLDER = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Apply generated migrations as the owner role. */
export async function runMigrations(pool: pg.Pool): Promise<void> {
  await migrate(createDb(pool), { migrationsFolder: MIGRATIONS_FOLDER });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const pool = createPool(url, { statementTimeoutMs: 60_000, max: 1 });
  try {
    await runMigrations(pool);
    console.log('migrations applied');
  } finally {
    await pool.end();
  }
}
