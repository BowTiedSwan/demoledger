import { createMiddleware } from 'hono/factory';
import type { AppEnv, Logger } from '../lib/deps';

/** One structured JSON line per request: requestId, userId, tenantId, route, status, latency. */
export function requestLogger(logger: Logger) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const started = performance.now();
    try {
      await next();
    } finally {
      const tenant = c.get('tenant');
      logger.info(
        {
          requestId: c.get('requestId'),
          userId: tenant?.userId ?? null,
          tenantId: tenant?.tenantId ?? null,
          method: c.req.method,
          route: c.req.routePath,
          status: c.res.status,
          latency_ms: Math.round(performance.now() - started),
        },
        'request',
      );
    }
  });
}
