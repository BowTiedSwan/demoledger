import { schema } from '@demoledger/db';
import {
  aggregateTransactionsQuery,
  askRequest,
  type HealthResponse,
  listTransactionsQuery,
  type MeResponse,
  type TransactionFilter,
} from '@demoledger/shared';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import type { AppDeps, AppEnv } from './lib/deps';
import { envelope, fail } from './lib/errors';
import { validate } from './lib/validate';
import { csrfOrigin } from './middleware/csrf';
import { requestLogger } from './middleware/logging';
import { perUserRateLimit } from './middleware/rate-limit';
import { requestId } from './middleware/request-id';
import { requireTenant } from './middleware/require-tenant';
import { handleAsk } from './orchestrator';
import { aggregateTransactions, listTransactions } from './repo/transactions';

const ASK_BODY_LIMIT_BYTES = 64 * 1024;

/** Strip paging/sort/metric fields; the repository filter has no tenant field by construction. */
function toFilter(q: TransactionFilter): TransactionFilter {
  return {
    transaction_id: q.transaction_id,
    wallet_id: q.wallet_id,
    status: q.status,
    direction: q.direction,
    period: q.period,
    from: q.from,
    to: q.to,
    min_amount_minor: q.min_amount_minor,
    max_amount_minor: q.max_amount_minor,
  };
}

async function ping(db: AppDeps['db']['reader']): Promise<'ok' | 'error'> {
  try {
    await db.execute(sql`select 1`);
    return 'ok';
  } catch {
    return 'error';
  }
}

/**
 * Middleware order (every request):
 *   requestId -> secureHeaders -> requestLogger -> [route-scoped] requireTenant ->
 *   (ask only) rate limit -> body limit -> zod validation -> handler.
 * Routes stay chained so `AppType` is inferable for the typed `hc` client.
 */
export function createApp(deps: AppDeps) {
  const tenantGuard = requireTenant(deps);
  const askLimiter = perUserRateLimit(deps.config.askRateLimitPerMinute);

  const app = new Hono<AppEnv>()
    .basePath('/api')
    .use(requestId)
    .use(secureHeaders())
    .use(requestLogger(deps.logger))
    .use('/me', tenantGuard)
    .use('/transactions', tenantGuard)
    .use('/transactions/*', tenantGuard)
    .use('/ask', tenantGuard, csrfOrigin(deps.config.trustedOrigins), askLimiter)
    // The UI and seed use only sign-in/sign-out/get-session; org management is not exposed.
    .all('/auth/organization/*', (c) => fail(c, 404, 'not_found', 'Not found.'))
    .on(['GET', 'POST'], '/auth/*', (c) => deps.auth.handler(c.req.raw))
    .get('/health', async (c) => {
      const [reader, appDb] = await Promise.all([ping(deps.db.reader), ping(deps.db.app)]);
      const ok = reader === 'ok' && appDb === 'ok';
      const body: HealthResponse = {
        status: ok ? 'ok' : 'degraded',
        db: { reader, app: appDb },
        llm: {
          configured: deps.llm !== null,
          provider: deps.llm?.provider ?? 'workers-ai',
          model: deps.llm?.modelId ?? 'unconfigured',
        },
        guard: {
          provider: deps.guard.provider,
          model: deps.guard.model,
          fail_mode: deps.config.guard.failMode,
        },
        time: deps.now().toISOString(),
      };
      return c.json(body, ok ? 200 : 503);
    })
    .get('/me', async (c) => {
      const t = c.get('tenant');
      const [org] = await deps.db.app
        .select({
          id: schema.organization.id,
          name: schema.organization.name,
          slug: schema.organization.slug,
        })
        .from(schema.organization)
        .where(eq(schema.organization.id, t.tenantId))
        .limit(1);
      if (!org) return fail(c, 403, 'forbidden', 'Active organization not found.');
      const body: MeResponse = {
        user: { id: t.userId, email: t.email, name: t.name },
        organization: org,
        role: t.role,
      };
      return c.json(body, 200);
    })
    .get('/transactions', validate('query', listTransactionsQuery), async (c) => {
      const q = c.req.valid('query');
      const body = await listTransactions(
        c.get('tenant').tenantId,
        toFilter(q),
        { limit: q.limit, offset: q.offset, sort: q.sort },
        deps.now(),
        deps.db.reader,
      );
      return c.json(body, 200);
    })
    .get('/transactions/aggregate', validate('query', aggregateTransactionsQuery), async (c) => {
      const q = c.req.valid('query');
      const body = await aggregateTransactions(
        c.get('tenant').tenantId,
        toFilter(q),
        q.metric,
        q.group_by,
        deps.now(),
        deps.db.reader,
      );
      return c.json(body, 200);
    })
    .post(
      '/ask',
      bodyLimit({
        maxSize: ASK_BODY_LIMIT_BYTES,
        onError: (c) =>
          c.json(
            envelope(
              (c.var as { requestId?: string }).requestId ?? 'unknown',
              'payload_too_large',
              'Request body is too large.',
            ),
            413,
          ),
      }),
      validate('json', askRequest),
      async (c) => {
        const body = c.req.valid('json');
        return handleAsk({
          deps,
          tenant: c.get('tenant'),
          requestId: c.get('requestId'),
          body,
          signal: c.req.raw.signal,
        });
      },
    )
    .notFound((c) => fail(c, 404, 'not_found', 'Not found.'))
    .onError((err, c) => {
      if (err instanceof HTTPException) {
        if (err.status === 400) return fail(c, 400, 'validation_error', 'Invalid request.');
        if (err.status === 413) return fail(c, 413, 'payload_too_large', 'Request body is too large.');
        if (err.status === 401) return fail(c, 401, 'unauthorized', 'Sign in required.');
        if (err.status === 403) return fail(c, 403, 'forbidden', 'Forbidden.');
      }
      deps.logger.error(
        {
          requestId: c.get('requestId'),
          err: err instanceof Error ? err.message : String(err),
          cause: err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined,
        },
        'unhandled error',
      );
      return fail(c, 500, 'internal_error', 'Something went wrong. Please try again.');
    });

  return app;
}

export type AppType = ReturnType<typeof createApp>;
