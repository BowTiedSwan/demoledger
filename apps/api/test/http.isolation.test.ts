import { schema } from '@demoledger/db';
import type {
  AggregateResponse,
  ErrorEnvelope,
  MeResponse,
  TransactionListResponse,
} from '@demoledger/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearerAuth,
  type Credentials,
  cookieAuth,
  makeContext,
  seed,
  sessionTokenOf,
  signIn,
  type TestApp,
} from './helpers';

const ctx = makeContext();
const app: TestApp = ctx.app;
const all = seed();
const ids = (tenant: string) => new Set(all.filter((r) => r.tenantId === tenant).map((r) => r.transactionId));
const alphaIds = ids('tenant_alpha');
const betaIds = ids('tenant_beta');

let alpha: Credentials;
let beta: Credentials;
beforeAll(async () => {
  alpha = await signIn(app, 'alpha');
  beta = await signIn(app, 'beta');
});
afterAll(() => ctx.close());

const modes = [
  ['cookie', cookieAuth],
  ['bearer', bearerAuth],
] as const;

const get = (path: string, init: { headers: Record<string, string> }) => app.request(path, init);

describe.each(modes)('HTTP tenant isolation via %s', (_name, authInit) => {
  it('GET /api/me reports the active organization', async () => {
    const res = await get('/api/me', authInit(alpha));
    expect(res.status).toBe(200);
    const me = (await res.json()) as MeResponse;
    expect(me.user.email).toBe('ops.alpha@demoledger.test');
    expect(me.organization.id).toBe('tenant_alpha');
  });

  it('lists only the caller tenant rows (paged through everything)', async () => {
    for (const [creds, own, other] of [
      [alpha, alphaIds, betaIds],
      [beta, betaIds, alphaIds],
    ] as const) {
      const seen: string[] = [];
      let offset = 0;
      for (;;) {
        const res = await get(`/api/transactions?limit=50&offset=${offset}`, authInit(creds));
        expect(res.status).toBe(200);
        const page = (await res.json()) as TransactionListResponse;
        seen.push(...page.items.map((i) => i.transaction_id));
        expect(JSON.stringify(page)).not.toContain('tenant_id');
        if (page.next_offset === null) break;
        offset = page.next_offset;
      }
      expect(new Set(seen)).toEqual(own);
      expect(seen.some((id) => other.has(id))).toBe(false);
    }
  });

  it('wallet filter for the other tenant wallet returns nothing', async () => {
    const res = await get('/api/transactions?wallet_id=WALLET-B-001', authInit(alpha));
    expect(res.status).toBe(200);
    expect(((await res.json()) as TransactionListResponse).total_matching).toBe(0);
    const own = await get('/api/transactions?wallet_id=WALLET-A-001&status=failed', authInit(alpha));
    const body = (await own.json()) as TransactionListResponse;
    expect(body.total_matching).toBeGreaterThanOrEqual(4);
  });

  it('transaction_id filter: other tenant id returns nothing, own id returns the row', async () => {
    const betaId = [...betaIds][0] as string;
    const alphaId = [...alphaIds][0] as string;
    const cross = (await (
      await get(`/api/transactions?transaction_id=${betaId}`, authInit(alpha))
    ).json()) as TransactionListResponse;
    expect(cross.items).toEqual([]);
    const own = (await (
      await get(`/api/transactions?transaction_id=${alphaId}`, authInit(alpha))
    ).json()) as TransactionListResponse;
    expect(own.items.map((i) => i.transaction_id)).toEqual([alphaId]);
  });

  it('aggregates are scoped to the caller', async () => {
    const a = (await (
      await get('/api/transactions/aggregate?metric=count', authInit(alpha))
    ).json()) as AggregateResponse;
    const b = (await (
      await get('/api/transactions/aggregate?metric=count', authInit(beta))
    ).json()) as AggregateResponse;
    expect(a.total_matching).toBe(alphaIds.size);
    expect(b.total_matching).toBe(betaIds.size);
    const walletsA = (await (
      await get('/api/transactions/aggregate?metric=sum&group_by=wallet', authInit(alpha))
    ).json()) as AggregateResponse;
    expect(walletsA.groups.every((g) => g.key.startsWith('WALLET-A-'))).toBe(true);
    const cross = (await (
      await get('/api/transactions/aggregate?metric=count&wallet_id=WALLET-B-002', authInit(alpha))
    ).json()) as AggregateResponse;
    expect(cross.total_matching).toBe(0);
  });

  it.each([
    '/api/transactions?tenant_id=tenant_beta',
    '/api/transactions?tenantId=tenant_beta',
    '/api/transactions/aggregate?metric=count&tenant_id=tenant_beta',
  ])('unknown query param is rejected: %s', async (path) => {
    const res = await get(path, authInit(alpha));
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error.code).toBe('validation_error');
    expect(body.error.requestId).toBe(res.headers.get('x-request-id'));
  });

  it('a tenant header or body cannot override the session tenant', async () => {
    const init = authInit(alpha);
    const res = await get('/api/transactions?limit=50', {
      headers: { ...init.headers, 'x-tenant-id': 'tenant_beta' },
    });
    const body = (await res.json()) as TransactionListResponse;
    expect(body.items.every((i) => alphaIds.has(i.transaction_id))).toBe(true);
  });
});

describe('session -> tenant resolution edge cases', () => {
  it('cookie and bearer resolve the same tenant for the same session', async () => {
    const c = (await (await get('/api/me', cookieAuth(beta))).json()) as MeResponse;
    const b = (await (await get('/api/me', bearerAuth(beta))).json()) as MeResponse;
    expect(c.organization.id).toBe('tenant_beta');
    expect(b.organization.id).toBe('tenant_beta');
  });

  it.each(['/api/me', '/api/transactions', '/api/transactions/aggregate?metric=count'])(
    'no credentials -> 401 envelope: %s',
    async (path) => {
      const res = await app.request(path);
      expect(res.status).toBe(401);
      const body = (await res.json()) as ErrorEnvelope;
      expect(body.error.code).toBe('unauthorized');
      expect(body.error.requestId).toBeTruthy();
    },
  );

  it('POST /api/ask without credentials -> 401', async () => {
    const res = await app.request('/api/ask', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
  });

  it('garbage and tampered bearer tokens -> 401', async () => {
    for (const token of ['garbage', `${alpha.token}x`, `${alpha.token.split('.')[0]}.AAAA`]) {
      const res = await app.request('/api/transactions', { headers: { authorization: `Bearer ${token}` } });
      expect(res.status).toBe(401);
    }
  });

  it('active organization switched to a non-member organization -> 403 (cookie and bearer)', async () => {
    const fresh = await signIn(app, 'alpha');
    const token = sessionTokenOf(fresh);
    await ctx.deps.db.app
      .update(schema.session)
      .set({ activeOrganizationId: 'tenant_beta' })
      .where(eq(schema.session.token, token));
    for (const authInit of [cookieAuth, bearerAuth]) {
      for (const path of ['/api/transactions', '/api/transactions/aggregate?metric=count', '/api/me']) {
        const res = await get(path, authInit(fresh));
        expect(res.status).toBe(403);
        expect(((await res.json()) as ErrorEnvelope).error.code).toBe('forbidden');
      }
    }
    // the untouched alpha session keeps working
    expect((await get('/api/transactions', bearerAuth(alpha))).status).toBe(200);
  });

  it('a session without an active organization -> 403', async () => {
    const fresh = await signIn(app, 'beta');
    await ctx.deps.db.app
      .update(schema.session)
      .set({ activeOrganizationId: null })
      .where(eq(schema.session.token, sessionTokenOf(fresh)));
    const res = await get('/api/transactions', bearerAuth(fresh));
    expect(res.status).toBe(403);
  });

  it('a non-existent active organization -> 403', async () => {
    const fresh = await signIn(app, 'beta');
    await ctx.deps.db.app
      .update(schema.session)
      .set({ activeOrganizationId: 'tenant_does_not_exist' })
      .where(eq(schema.session.token, sessionTokenOf(fresh)));
    expect((await get('/api/transactions', bearerAuth(fresh))).status).toBe(403);
  });

  it('wrong password does not issue a token', async () => {
    const res = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
      body: JSON.stringify({ email: 'ops.alpha@demoledger.test', password: 'nope-nope-nope' }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('set-auth-token')).toBeNull();
  });

  it('self-service sign-up is disabled', async () => {
    const res = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
      body: JSON.stringify({ email: 'x@demoledger.test', password: 'Sup3rSecret#2026', name: 'x' }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.get('set-auth-token')).toBeNull();
  });
});
