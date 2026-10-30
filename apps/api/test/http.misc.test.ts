import type { ErrorEnvelope, HealthResponse, TransactionListResponse } from '@demoledger/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearerAuth, type Credentials, makeContext, signIn, TEST_NOW } from './helpers';

const ctx = makeContext({ askRateLimitPerMinute: 3 });
const app = ctx.app;
let alpha: Credentials;
beforeAll(async () => {
  alpha = await signIn(app, 'alpha');
});
afterAll(() => ctx.close());

describe('health and error envelope', () => {
  it('GET /api/health is public, reports db and providers, no secrets', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as HealthResponse;
    expect(body.status).toBe('ok');
    expect(body.db).toEqual({ reader: 'ok', app: 'ok' });
    expect(body.llm.configured).toBe(false);
    expect(body.time).toBe(TEST_NOW.toISOString());
    expect(JSON.stringify(body)).not.toMatch(/secret|password|token/i);
  });

  it('every response carries a fresh X-Request-Id; client-supplied IDs are ignored', async () => {
    const res = await app.request('/api/health', { headers: { 'x-request-id': 'attacker-chosen' } });
    const id = res.headers.get('x-request-id');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('unknown route -> 404 envelope', async () => {
    const res = await app.request('/api/nope');
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorEnvelope).error.code).toBe('not_found');
  });
});

describe('REST validation (shared schemas)', () => {
  const bad = [
    'limit=51',
    'limit=0',
    'limit=abc',
    'wallet_id=WALLET-X-1',
    'status=exploded',
    'period=last_year',
    'from=2026-10-01&to=2026-01-01',
    'from=2026-01-01&to=2026-12-31',
    'period=today&from=2026-10-01&to=2026-10-02',
    'min_amount_minor=10&max_amount_minor=5',
    'sort=random',
    'offset=-1',
  ];
  it.each(bad)('rejects %s with a validation envelope', async (qs) => {
    const res = await app.request(`/api/transactions?${qs}`, bearerAuth(alpha));
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error.code).toBe('validation_error');
    expect(body.error.issues?.length).toBeGreaterThan(0);
  });

  it('aggregate requires a metric', async () => {
    const res = await app.request('/api/transactions/aggregate', bearerAuth(alpha));
    expect(res.status).toBe(400);
  });

  it('period "yesterday" uses the injected clock and reports applied_range', async () => {
    const res = await app.request('/api/transactions?period=yesterday&limit=50', bearerAuth(alpha));
    const body = (await res.json()) as TransactionListResponse;
    expect(body.applied_range).toEqual({ from: '2026-10-27T00:00:00.000Z', to: '2026-10-28T00:00:00.000Z' });
  });

  it('amount_display and amount_minor are consistent', async () => {
    const res = await app.request('/api/transactions?limit=5', bearerAuth(alpha));
    const body = (await res.json()) as TransactionListResponse;
    for (const t of body.items) {
      expect(Number.isSafeInteger(t.amount_minor)).toBe(true);
      expect(t.amount_display).toMatch(/[\d,]+\.\d{2}$/);
    }
  });
});

describe('POST /api/ask (route-level concerns only)', () => {
  const post = (body: string, init = bearerAuth(alpha)) =>
    app.request('/api/ask', {
      method: 'POST',
      body,
      headers: { ...init.headers, 'content-type': 'application/json' },
    });

  it('malformed JSON and invalid bodies -> 400 envelope', async () => {
    expect((await post('{not json')).status).toBe(400);
    const res = await post(JSON.stringify({ messages: [] }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorEnvelope).error.code).toBe('validation_error');
  });

  it('oversized body -> 413', async () => {
    const res = await post(JSON.stringify({ messages: [], pad: 'x'.repeat(70_000) }));
    expect(res.status).toBe(413);
    expect(((await res.json()) as ErrorEnvelope).error.code).toBe('payload_too_large');
  });

  it('per-user rate limit -> 429 with Retry-After (limit 3/min)', async () => {
    const limited = await signIn(app, 'beta'); // separate user bucket
    const auth = bearerAuth(limited);
    const statuses: number[] = [];
    let last: Response = new Response();
    for (let i = 0; i < 5; i++) {
      last = await post(JSON.stringify({ messages: [] }), auth);
      statuses.push(last.status);
    }
    expect(statuses).toEqual([400, 400, 400, 429, 429]);
    expect(((await last.json()) as ErrorEnvelope).error.code).toBe('rate_limited');
    expect(Number(last.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('CSRF origin check on POST /api/ask', () => {
  const body = JSON.stringify({ messages: [] }); // fails validation (400) once past the origin check
  const post = (headers: Record<string, string>) =>
    app.request('/api/ask', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', ...headers },
    });

  it('cookie + untrusted Origin -> 403; cookie + missing Origin -> 403', async () => {
    const c = await signIn(app, 'alpha');
    expect((await post({ cookie: c.cookie, origin: 'https://evil.example' })).status).toBe(403);
    expect((await post({ cookie: c.cookie })).status).toBe(403);
  });

  it('cookie + trusted Origin passes the check', async () => {
    const c = await signIn(app, 'alpha');
    expect([400, 429]).toContain((await post({ cookie: c.cookie, origin: 'http://localhost:5173' })).status);
  });

  it('bearer without Origin keeps working (curl)', async () => {
    const c = await signIn(app, 'alpha');
    expect([400, 429]).toContain((await post({ authorization: `Bearer ${c.token}` })).status);
  });
});

describe('organization endpoints are not exposed', () => {
  it('blocks set-active and friends even for a valid session', async () => {
    const c = await signIn(app, 'alpha');
    for (const path of ['set-active', 'create', 'list']) {
      const res = await app.request(`/api/auth/organization/${path}`, {
        method: 'POST',
        body: '{"organizationId":"tenant_beta"}',
        headers: { ...bearerAuth(c).headers, 'content-type': 'application/json' },
      });
      expect(res.status).toBe(404);
    }
    expect((await app.request('/api/me', bearerAuth(c))).status).toBe(200);
  });
});
