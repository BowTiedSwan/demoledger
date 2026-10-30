import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema> & { $client: pg.Pool };

export interface PoolOptions {
  /** Applied as Postgres `statement_timeout` on every connection. */
  statementTimeoutMs?: number;
  max?: number;
  /** Max wait to acquire a connection from the pool before failing (default 5000). */
  connectionTimeoutMs?: number;
  applicationName?: string;
  /** Called when an idle client errors (e.g. Postgres restart). Defaults to a JSON line on stderr. */
  onError?: (err: Error) => void;
}

/** One pool per role (owner / ledger_reader / ledger_app). */
export function createPool(connectionString: string, opts: PoolOptions = {}): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max: opts.max ?? 5,
    connectionTimeoutMillis: opts.connectionTimeoutMs ?? 5000,
    statement_timeout: opts.statementTimeoutMs ?? 5000,
    application_name: opts.applicationName ?? 'demoledger',
  });
  // Without a listener, an idle-client error is an unhandled 'error' event and crashes the process.
  // pg discards the broken client; the next query opens a fresh connection.
  pool.on(
    'error',
    opts.onError ??
      ((err) =>
        console.error(
          JSON.stringify({
            level: 'error',
            msg: 'db idle client error',
            app: opts.applicationName,
            error: err.message,
          }),
        )),
  );
  return pool;
}

export function createDb(pool: pg.Pool): Database {
  return drizzle({ client: pool, schema });
}
