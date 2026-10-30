import { guardFailMode, guardProvider } from '@demoledger/shared';
import { z } from 'zod';
import type { AppConfig } from './deps';

const int = (def: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z.coerce.number().int().min(min).max(max).default(def);

/** Public placeholder from .env.example: must never run as a real secret. */
export const PLACEHOLDER_AUTH_SECRET = 'replace-with-32-plus-random-characters';
/** Empty string in .env means "unset". */
const optStr = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

const envSchema = z.object({
  API_PORT: int(3001, 1, 65_535),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL_READER: z.string().min(1, 'DATABASE_URL_READER is required'),
  DATABASE_URL_APP: z.string().min(1, 'DATABASE_URL_APP is required'),
  DB_STATEMENT_TIMEOUT_MS: int(5000, 100, 60_000),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters')
    .refine((v) => v !== PLACEHOLDER_AUTH_SECRET, {
      message:
        'BETTER_AUTH_SECRET is still the .env.example placeholder; generate one with: openssl rand -base64 32',
    }),
  BETTER_AUTH_URL: z.string().min(1).default('http://localhost:3001'),
  BETTER_AUTH_TRUSTED_ORIGINS: z.string().default('http://localhost:5173,http://localhost:3001'),
  CF_ACCOUNT_ID: optStr,
  CF_API_TOKEN: optStr,
  LLM_MODEL: z.string().default('@cf/google/gemma-4-26b-a4b-it'),
  LLM_BASE_URL: optStr,
  LLM_REQUEST_TIMEOUT_MS: int(45_000, 1000, 120_000),
  LLM_STEP_TIMEOUT_MS: int(15_000, 1000, 60_000),
  LLM_MAX_RETRIES: int(2, 0, 5),
  LLM_MAX_STEPS: int(5, 1, 10),
  /** Output token cap per model step (reasoning tokens count too). */
  LLM_MAX_OUTPUT_TOKENS: int(2048, 64, 8192),
  /** Reasoning effort, mapped per model family in createLlm (GLM: low = thinking off; gpt-oss: reasoning_effort). */
  LLM_REASONING_EFFORT: z.enum(['low', 'medium', 'high']).default('low'),
  GUARD_PROVIDER: optStr.pipe(guardProvider.optional()),
  GUARD_MODEL: z.string().default('@cf/cloudflare/clef-flash'),
  GUARD_BASE_URL: optStr,
  GUARD_FAIL_MODE: guardFailMode.default('open'),
  GUARD_TIMEOUT_MS: int(2500, 50, 10_000),
  TRUST_PROXY_HEADERS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  ASK_RATE_LIMIT_PER_MINUTE: int(10, 1, 600),
});

export type ParsedEnv = z.output<typeof envSchema>;

export interface LoadedConfig {
  /** Shape consumed by createApp(). */
  app: AppConfig;
  /** Everything else (DB URLs, secrets, provider credentials) for index.ts wiring. */
  env: ParsedEnv;
}

/** Validate the process environment once at boot. Throws a readable error on bad config. */
export function loadConfig(env: Record<string, string | undefined>): LoadedConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  return {
    env: e,
    app: {
      port: e.API_PORT,
      logLevel: e.LOG_LEVEL,
      trustedOrigins: e.BETTER_AUTH_TRUSTED_ORIGINS.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      llm: {
        requestTimeoutMs: e.LLM_REQUEST_TIMEOUT_MS,
        stepTimeoutMs: e.LLM_STEP_TIMEOUT_MS,
        maxRetries: e.LLM_MAX_RETRIES,
        maxSteps: e.LLM_MAX_STEPS,
        maxOutputTokens: e.LLM_MAX_OUTPUT_TOKENS,
      },
      guard: { failMode: e.GUARD_FAIL_MODE, timeoutMs: e.GUARD_TIMEOUT_MS },
      askRateLimitPerMinute: e.ASK_RATE_LIMIT_PER_MINUTE,
      trustProxyHeaders: e.TRUST_PROXY_HEADERS,
    },
  };
}
