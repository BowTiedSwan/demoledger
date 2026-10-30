import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROLES_SQL = join(dirname(fileURLToPath(import.meta.url)), 'roles.sql');

/** Create/refresh the two app roles and apply the exact grants (owner connection). */
export async function applyRoles(
  pool: pg.Pool,
  passwords: { readerPassword: string; appPassword: string },
): Promise<void> {
  const lit = (s: string) => pg.escapeLiteral(s);
  const sql = readFileSync(ROLES_SQL, 'utf8')
    .replace('{{READER_PASSWORD}}', lit(passwords.readerPassword))
    .replace('{{APP_PASSWORD}}', lit(passwords.appPassword));
  await pool.query(sql);
}
