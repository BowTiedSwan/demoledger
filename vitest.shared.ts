/**
 * Test environment shared by every vitest project (architect-owned).
 *
 * Maps TEST_DATABASE_URL* onto DATABASE_URL* so all tests hit `demoledger_test`,
 * pins the seed anchor, and blanks provider credentials so no test can reach a
 * network LLM/guard endpoint. Values come from the root .env when present,
 * otherwise from the docker-compose defaults (CI).
 *
 * The map is also written into process.env at config-load time so globalSetup
 * files (which run in the main process) see the same values.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const ROOT = dirname(fileURLToPath(import.meta.url));
export const TEST_SEED_ANCHOR = '2026-10-28T00:00:00Z';

function fileEnv(): Record<string, string | undefined> {
  const path = join(ROOT, '.env');
  return existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};
}

export function testEnv(): Record<string, string> {
  const f = { ...fileEnv(), ...process.env };
  const ownerPw = f.POSTGRES_PASSWORD ?? 'demoledger_owner_dev_pw';
  const ownerUser = f.POSTGRES_USER ?? 'demoledger_owner';
  const readerPw = f.LEDGER_READER_PASSWORD ?? 'ledger_reader_dev_pw';
  const appPw = f.LEDGER_APP_PASSWORD ?? 'ledger_app_dev_pw';
  const base = 'localhost:5433/demoledger_test';
  const env: Record<string, string> = {
    NODE_ENV: 'test',
    POSTGRES_USER: ownerUser,
    POSTGRES_PASSWORD: ownerPw,
    LEDGER_READER_PASSWORD: readerPw,
    LEDGER_APP_PASSWORD: appPw,
    DATABASE_URL: f.TEST_DATABASE_URL ?? `postgres://${ownerUser}:${ownerPw}@${base}`,
    DATABASE_URL_READER: f.TEST_DATABASE_URL_READER ?? `postgres://ledger_reader:${readerPw}@${base}`,
    DATABASE_URL_APP: f.TEST_DATABASE_URL_APP ?? `postgres://ledger_app:${appPw}@${base}`,
    SEED_ANCHOR: TEST_SEED_ANCHOR,
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    BETTER_AUTH_URL: 'http://localhost:3001',
    BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:5173,http://localhost:3001',
    // Providers are always injected in tests; real ones must never be constructible.
    CF_ACCOUNT_ID: '',
    CF_API_TOKEN: '',
    GUARD_PROVIDER: 'none',
    LOG_LEVEL: 'error',
  };
  Object.assign(process.env, env);
  return env;
}
