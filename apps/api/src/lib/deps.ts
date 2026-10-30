import type { Database } from '@demoledger/db';
import type { Guard, GuardFailMode } from '@demoledger/shared';
import type { LanguageModel } from 'ai';

/**
 * Everything createApp() needs, injected so tests can pass mocks
 * (MockLanguageModelV4 from 'ai/test', NoopGuard, a fixed clock, test DB pools).
 * Production wiring lives in src/index.ts. Nothing in here reads process.env.
 */
export interface AppDeps {
  config: AppConfig;
  db: {
    /** ledger_reader pool: SELECT on transactions only. Repo + tools. */
    reader: Database;
    /** ledger_app pool: Better Auth tables + INSERT on audit tables. */
    app: Database;
  };
  /** Better Auth instance (api-builder narrows this to the concrete `Auth` type). */
  auth: AuthLike;
  /** `null` when CF_* creds are absent -> /api/ask answers `llm_unconfigured`. */
  llm: LlmDeps | null;
  guard: Guard;
  /** Injected clock; every "today/yesterday/this week" resolution uses it. */
  now: () => Date;
  logger: Logger;
}

export interface LlmDeps {
  model: LanguageModel;
  /** e.g. "workers-ai" or "mock" — recorded in ai_requests.provider. */
  provider: string;
  /** e.g. "@cf/zai-org/glm-4.7-flash" — recorded in ai_requests.model. */
  modelId: string;
}

/** Parsed, validated env (api-builder implements loadConfig(env) in lib/config.ts). */
export interface AppConfig {
  port: number;
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  trustedOrigins: string[];
  llm: {
    requestTimeoutMs: number;
    stepTimeoutMs: number;
    maxRetries: number;
    maxSteps: number;
    /** `max_tokens` per model step; includes reasoning tokens. Default 2048 when absent. */
    maxOutputTokens?: number;
  };
  guard: { failMode: GuardFailMode; timeoutMs: number };
  askRateLimitPerMinute: number;
  /** Trust client-supplied X-Forwarded-For & co. Only behind an ingress that overwrites them. */
  trustProxyHeaders?: boolean | undefined;
}

/** Result of resolving a cookie or `Authorization: Bearer` session. */
export interface SessionInfo {
  user: { id: string; email: string; name: string };
  /** `session.activeOrganizationId` — a CLAIM until requireTenant re-checks membership. */
  activeOrganizationId: string | null;
}

export interface AuthLike {
  handler(request: Request): Promise<Response>;
  /** Resolve the session from request headers (cookie or Bearer). `null` = unauthenticated. */
  getSession(headers: Headers): Promise<SessionInfo | null>;
}

export interface Logger {
  debug(obj: Record<string, unknown>, msg?: string): void;
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
  child(bindings: Record<string, unknown>): Logger;
}

/** Set by requireTenant from the validated session + a membership re-check. Never from input. */
export interface TenantContext {
  userId: string;
  tenantId: string;
  email: string;
  name: string;
  /** Role in the active organization (from the membership re-check). */
  role: string;
}

export type AppEnv = {
  Variables: {
    requestId: string;
    /** Only valid on routes behind requireTenant. */
    tenant: TenantContext;
  };
};
