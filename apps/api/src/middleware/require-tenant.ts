import { schema } from '@demoledger/db';
import { and, eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import type { AppDeps, AppEnv } from '../lib/deps';
import { fail } from '../lib/errors';

/**
 * The only place a tenant is established:
 *   session (cookie or Bearer) -> session.activeOrganizationId -> membership re-check in `member`
 *   -> c.set('tenant', { userId, tenantId, ... }).
 * Nothing downstream may read a tenant from the body, query string or model output.
 *   401 no/invalid session; 403 no active organization or not a member of it.
 */
export function requireTenant(deps: Pick<AppDeps, 'auth' | 'db'>) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const session = await deps.auth.getSession(c.req.raw.headers);
    if (!session) return fail(c, 401, 'unauthorized', 'Sign in required.');

    const orgId = session.activeOrganizationId;
    if (!orgId) return fail(c, 403, 'forbidden', 'No active organization.');

    const [membership] = await deps.db.app
      .select({ role: schema.member.role })
      .from(schema.member)
      .where(and(eq(schema.member.userId, session.user.id), eq(schema.member.organizationId, orgId)))
      .limit(1);
    if (!membership) return fail(c, 403, 'forbidden', 'You are not a member of the active organization.');

    c.set('tenant', {
      userId: session.user.id,
      tenantId: orgId,
      email: session.user.email,
      name: session.user.name,
      role: membership.role,
    });
    await next();
  });
}
