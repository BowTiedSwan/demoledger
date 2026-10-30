import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../lib/deps';
import { fail } from '../lib/errors';

/**
 * Origin check for state-changing requests that may be cookie-authenticated.
 * Requests carrying `Authorization: Bearer` (curl, programmatic clients) are exempt: a browser
 * cannot attach that header cross-site without a CORS preflight, which we never grant.
 * Otherwise the `Origin` header must be one of the trusted origins.
 */
export function csrfOrigin(trustedOrigins: readonly string[]) {
  const allowed = new Set(trustedOrigins);
  return createMiddleware<AppEnv>(async (c, next) => {
    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
    if (c.req.header('authorization')?.toLowerCase().startsWith('bearer ')) return next();
    const origin = c.req.header('origin');
    if (!origin || !allowed.has(origin)) return fail(c, 403, 'forbidden', 'Untrusted request origin.');
    return next();
  });
}
