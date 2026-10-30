/** Minimal pool surface (pg.Pool satisfies it) so tests can inject fakes. */
export interface Queryable {
  query(text: string): Promise<{ rows: Record<string, unknown>[] }>;
}

const ROLE_SQL =
  'select current_user as name, rolsuper, rolbypassrls from pg_roles where rolname = current_user';

async function inspect(pool: Queryable, expected: string): Promise<string | null> {
  const { rows } = await pool.query(ROLE_SQL);
  const r = rows[0];
  if (!r) return `${expected} pool: could not read the connected role`;
  if (r.name !== expected)
    return `${expected} pool is connected as "${String(r.name)}", expected "${expected}"`;
  if (r.rolsuper !== false) return `${expected} must not be a superuser`;
  if (r.rolbypassrls !== false)
    return `${expected} must not have BYPASSRLS (it would skip row-level security)`;
  return null;
}

/**
 * Boot-time least-privilege check. The tenant boundary relies on the reader pool being
 * `ledger_reader` (SELECT only, subject to RLS) and the app pool being `ledger_app`; a
 * superuser/BYPASSRLS/owner connection would silently defeat that. Throws with a clear message.
 */
export async function assertDbRoles(pools: { reader: Queryable; app: Queryable }): Promise<void> {
  const problems = (
    await Promise.all([inspect(pools.reader, 'ledger_reader'), inspect(pools.app, 'ledger_app')])
  ).filter((p): p is string => p !== null);
  if (problems.length > 0) {
    throw new Error(
      `Refusing to start: database roles are not least-privilege.\n  - ${problems.join('\n  - ')}\n` +
        'Check DATABASE_URL_READER / DATABASE_URL_APP (never the owner URL) and run `pnpm db:reset`.',
    );
  }
}
