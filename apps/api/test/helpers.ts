import { createDb, createPool } from '@demoledger/db';
import type { Guard } from '@demoledger/shared';
import { SEED_USERS } from '../../../packages/db/src/seed/constants';
import { generateTransactions } from '../../../packages/db/src/seed/generate';
import { createApp } from '../src/app';
import { createAuth } from '../src/auth';
import { loadConfig } from '../src/lib/config';
import type { AppConfig, AppDeps, Logger } from '../src/lib/deps';

export const TEST_ANCHOR = new Date('2026-10-28T00:00:00Z');
/** Wednesday 12:00 UTC. ISO week = Mon 2026-10-26 .. Sun 2026-11-01. */
export const TEST_NOW = new Date('2026-10-28T12:00:00Z');
export const ORIGIN = 'http://localhost:5173';

export const seed = () => generateTransactions(TEST_ANCHOR);

const silent: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return silent;
  },
};

export const noopGuard: Guard = {
  provider: 'none',
  model: null,
  check: async () => ({
    verdict: 'allow',
    provider: 'none',
    model: null,
    reasons: [],
    answers: null,
    latency_ms: 0,
  }),
};

export function makeContext(
  overrides: Partial<AppConfig> = {},
  now: () => Date = () => TEST_NOW,
  opts: { authRateLimit?: boolean } = {},
) {
  const { app: config, env } = loadConfig(process.env);
  const readerPool = createPool(env.DATABASE_URL_READER, { applicationName: 'test-reader' });
  const appPool = createPool(env.DATABASE_URL_APP, { applicationName: 'test-app' });
  const db = { reader: createDb(readerPool), app: createDb(appPool) };
  const { authLike } = createAuth({
    db: db.app,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: config.trustedOrigins,
    rateLimitEnabled: opts.authRateLimit,
  });
  const deps: AppDeps = {
    config: { ...config, ...overrides },
    db,
    auth: authLike,
    llm: null,
    guard: noopGuard,
    now,
    logger: silent,
  };
  return {
    deps,
    app: createApp(deps),
    close: async () => {
      await Promise.all([readerPool.end(), appPool.end()]);
    },
  };
}

export type TestApp = ReturnType<typeof makeContext>['app'];

export interface Credentials {
  /** `Cookie` header value for browser-style requests. */
  cookie: string;
  /** Bearer token from the `set-auth-token` header. */
  token: string;
}

export const cookieAuth = (c: Credentials) => ({ headers: { cookie: c.cookie } });
export const bearerAuth = (c: Credentials) => ({ headers: { authorization: `Bearer ${c.token}` } });

export async function signIn(app: TestApp, who: 'alpha' | 'beta'): Promise<Credentials> {
  const user = SEED_USERS.find((u) => u.tenantId === `tenant_${who}`);
  if (!user) throw new Error(`no seed user for ${who}`);
  const res = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  if (res.status !== 200) throw new Error(`sign-in failed for ${who}: ${res.status} ${await res.text()}`);
  const token = res.headers.get('set-auth-token');
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  if (!token || !cookie) throw new Error('sign-in did not return a token and a session cookie');
  return { cookie, token };
}

/** Session row token = the part of the signed token before the first dot. */
export const sessionTokenOf = (c: Credentials) => decodeURIComponent(c.token).split('.')[0] as string;
