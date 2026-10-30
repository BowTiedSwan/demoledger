import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';
import { toSafeNumber } from './safe-int';

describe('toSafeNumber', () => {
  it('passes safe integers and bigint strings', () => {
    expect(toSafeNumber('12345')).toBe(12345);
    expect(toSafeNumber(9n)).toBe(9);
  });
  it('rejects values beyond MAX_SAFE_INTEGER instead of silently rounding', () => {
    expect(() => toSafeNumber('9007199254740993')).toThrow(RangeError);
    expect(() => toSafeNumber(2n ** 70n)).toThrow(RangeError);
  });
});

describe('loadConfig', () => {
  const base = {
    DATABASE_URL_READER: 'postgres://r@localhost/x',
    DATABASE_URL_APP: 'postgres://a@localhost/x',
    BETTER_AUTH_SECRET: 'x'.repeat(32),
  };
  it('applies defaults and parses lists', () => {
    const { app } = loadConfig({ ...base, BETTER_AUTH_TRUSTED_ORIGINS: 'http://a.test, http://b.test' });
    expect(app.port).toBe(3001);
    expect(app.trustedOrigins).toEqual(['http://a.test', 'http://b.test']);
    expect(app.llm.maxSteps).toBe(5);
    expect(app.guard).toEqual({ failMode: 'open', timeoutMs: 2500 });
  });
  it('treats empty strings as unset and rejects weak secrets', () => {
    expect(loadConfig({ ...base, GUARD_PROVIDER: '', CF_ACCOUNT_ID: '' }).env.GUARD_PROVIDER).toBeUndefined();
    expect(() => loadConfig({ ...base, BETTER_AUTH_SECRET: 'short' })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => loadConfig({ ...base, GUARD_FAIL_MODE: 'maybe' })).toThrow(/GUARD_FAIL_MODE/);
  });
  it('rejects the .env.example secret placeholder and unbounded LLM/rate settings', () => {
    expect(() =>
      loadConfig({ ...base, BETTER_AUTH_SECRET: 'replace-with-32-plus-random-characters' }),
    ).toThrow(/placeholder/);
    for (const bad of [
      { LLM_MAX_STEPS: '500' },
      { LLM_MAX_RETRIES: '50' },
      { LLM_REQUEST_TIMEOUT_MS: '999999999' },
      { LLM_STEP_TIMEOUT_MS: '999999999' },
      { ASK_RATE_LIMIT_PER_MINUTE: '100000' },
    ]) {
      expect(() => loadConfig({ ...base, ...bad })).toThrow(/Invalid environment/);
    }
    expect(loadConfig({ ...base, LLM_MAX_STEPS: '10', LLM_MAX_RETRIES: '5' }).app.llm.maxSteps).toBe(10);
  });
});

describe('TRUST_PROXY_HEADERS', () => {
  const base = {
    DATABASE_URL_READER: 'postgres://r@localhost/x',
    DATABASE_URL_APP: 'postgres://a@localhost/x',
    BETTER_AUTH_SECRET: 'x'.repeat(32),
  };
  it('defaults to false and only accepts true/false', () => {
    expect(loadConfig(base).app.trustProxyHeaders).toBe(false);
    expect(loadConfig({ ...base, TRUST_PROXY_HEADERS: 'true' }).app.trustProxyHeaders).toBe(true);
    expect(() => loadConfig({ ...base, TRUST_PROXY_HEADERS: 'yes' })).toThrow(/TRUST_PROXY_HEADERS/);
  });
});
