import type { ErrorEnvelope } from '@demoledger/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearerAuth,
  type Credentials,
  cookieAuth,
  makeContext,
  ORIGIN,
  sessionTokenOf,
  signIn,
} from './helpers';

const ctx = makeContext();
const app = ctx.app;
let alpha: Credentials;
beforeAll(async () => {
  alpha = await signIn(app, 'alpha');
});
afterAll(() => ctx.close());

describe('OWASP-07: no-store on API responses', () => {
  const paths = ['/api/me', '/api/transactions', '/api/transactions/aggregate?metric=count'];
  it.each(paths)('authenticated %s', async (path) => {
    const res = await app.request(path, bearerAuth(alpha));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('vary')).toMatch(/Cookie/);
    expect(res.headers.get('vary')).toMatch(/Authorization/);
  });
  it('401 and 404 error envelopes too', async () => {
    for (const [path, status] of [
      ['/api/me', 401],
      ['/api/nope', 404],
    ] as const) {
      const res = await app.request(path);
      expect(res.status).toBe(status);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });
});

describe('OWASP-03: bearer tokens must be signed', () => {
  it('the set-auth-token value is the signed form and works', async () => {
    expect(alpha.token).toContain('.');
    expect((await app.request('/api/me', bearerAuth(alpha))).status).toBe(200);
  });
  it('the raw unsigned session token is rejected (bearer)', async () => {
    const raw = sessionTokenOf(alpha);
    expect(raw).not.toContain('.');
    const res = await app.request('/api/me', { headers: { authorization: `Bearer ${raw}` } });
    expect(res.status).toBe(401);
  });
  it('cookie auth still works', async () => {
    expect((await app.request('/api/me', cookieAuth(alpha))).status).toBe(200);
  });
});

describe('OWASP-04 (auth body limit)', () => {
  it('a 1 MB auth body gets 413', async () => {
    const res = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email: 'a@b.test', password: 'x'.repeat(1024 * 1024) }),
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as ErrorEnvelope).error.code).toBe('payload_too_large');
  });
});

describe('OWASP-02: spoofed forwarding headers cannot reset the login limiter', () => {
  const attempt = (app: ReturnType<typeof makeContext>['app'], xff: string) =>
    app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': xff },
      body: JSON.stringify({ email: 'not-an-email', password: 'whatever-whatever' }),
    });

  it('default (TRUST_PROXY_HEADERS=false): rotating X-Forwarded-For still hits 429', async () => {
    const c = makeContext({}, undefined, { authRateLimit: true });
    try {
      const statuses: number[] = [];
      for (const ip of ['192.0.2.1', '192.0.2.1', '192.0.2.1', '192.0.2.1', '192.0.2.2', '192.0.2.3']) {
        statuses.push((await attempt(c.app, ip)).status);
      }
      expect(statuses.slice(0, 3)).not.toContain(429);
      expect(statuses.slice(3)).toEqual([429, 429, 429]);
    } finally {
      await c.close();
    }
  });

  it('TRUST_PROXY_HEADERS=true honours the header (documented ingress-only mode)', async () => {
    const c = makeContext({ trustProxyHeaders: true }, undefined, { authRateLimit: true });
    try {
      for (const ip of ['192.0.2.1', '192.0.2.1', '192.0.2.1']) await attempt(c.app, ip);
      expect((await attempt(c.app, '192.0.2.1')).status).toBe(429);
      expect((await attempt(c.app, '192.0.2.9')).status).not.toBe(429);
    } finally {
      await c.close();
    }
  });
});

describe('F-31: no-store also on raw-Response routes', () => {
  const noStore = (res: Response) => {
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('vary')).toMatch(/Cookie/);
    expect(res.headers.get('vary')).toMatch(/Authorization/);
  };

  it('Better Auth sign-in (returns set-auth-token)', async () => {
    const res = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email: 'ops.beta@demoledger.test', password: 'BetaLedger#2026' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-auth-token')).toBeTruthy();
    noStore(res);
  });

  it('Better Auth list-sessions and get-session', async () => {
    for (const path of ['/api/auth/list-sessions', '/api/auth/get-session']) {
      const res = await app.request(path, bearerAuth(alpha));
      expect(res.status).toBe(200);
      noStore(res);
    }
  });

  it('/api/ask stream: no-store overrides the SDK no-cache and the stream still delivers', async () => {
    const res = await app.request('/api/ask', {
      method: 'POST',
      headers: { ...bearerAuth(alpha).headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        conversationId: crypto.randomUUID(),
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'How many failed yesterday?' }] }],
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/event-stream/);
    noStore(res);
    const text = await res.text();
    expect(text).toContain('data:');
  });

  it('error envelope (validation 400)', async () => {
    const res = await app.request('/api/transactions?limit=999', bearerAuth(alpha));
    expect(res.status).toBe(400);
    noStore(res);
  });
});
