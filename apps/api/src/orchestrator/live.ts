/**
 * Harness for the manual scripts (smoke:live, eval:llm). Builds real deps from process.env:
 * Workers AI model, configured guard, ledger_reader/ledger_app pools. Never imported by tests
 * or by the server. Reads env only here, in script code.
 */
import { createDb, createPool } from '@demoledger/db';
import { AUDIT_REQUEST_STATUSES } from '@demoledger/shared';
import { type AuditRequestRecord, type AuditSink, createDbAudit, createMemoryAudit } from '../audit';
import { createMemoryConversations } from '../conversations';
import { createGuard } from '../guard';
import { loadConfig } from '../lib/config';
import type { AppDeps } from '../lib/deps';
import { createLlm } from '../llm';
import { handleAsk } from './index';
import { type ParsedStream, parseUiStream } from './stream';

export interface LiveEnv {
  CF_ACCOUNT_ID?: string | undefined;
  CF_API_TOKEN?: string | undefined;
  [k: string]: string | undefined;
}

export function hasLiveCredentials(env: LiveEnv = process.env): boolean {
  return Boolean(env.CF_API_TOKEN && (env.CF_ACCOUNT_ID || env.LLM_BASE_URL));
}

export const MISSING_CREDS_MESSAGE =
  'Workers AI credentials are missing. Set CF_ACCOUNT_ID and CF_API_TOKEN (token with "Workers AI: Read") in .env. ' +
  'The Free plan is enough; no billing is needed.';

export interface LiveHarness {
  deps: AppDeps;
  modelId: string;
  /** Rows written for the requests run through this harness. */
  audit: ReturnType<typeof createMemoryAudit>;
  ask(
    question: string,
    opts?: { tenantId?: string; persist?: boolean; conversationId?: string },
  ): Promise<{
    stream: ParsedStream;
    audit: AuditRequestRecord | undefined;
    toolCalls: ReturnType<typeof createMemoryAudit>['toolCalls'];
    elapsedMs: number;
  }>;
  close(): Promise<void>;
}

export function createLiveHarness(
  env: LiveEnv = process.env,
  modelOverride?: string,
  logger?: AppDeps['logger'],
): LiveHarness {
  const llm = createLlm({
    accountId: env.CF_ACCOUNT_ID,
    apiToken: env.CF_API_TOKEN,
    model: modelOverride ?? env.LLM_MODEL,
    baseUrl: env.LLM_BASE_URL || undefined,
    reasoningEffort: loadConfig(env).env.LLM_REASONING_EFFORT,
  });
  if (!llm) throw new Error(MISSING_CREDS_MESSAGE);
  if (!env.DATABASE_URL_READER || !env.DATABASE_URL_APP) {
    throw new Error(
      'DATABASE_URL_READER and DATABASE_URL_APP are required (copy .env.example to .env, run pnpm db:up && pnpm db:reset).',
    );
  }
  const readerPool = createPool(env.DATABASE_URL_READER, { max: 2 });
  const appPool = createPool(env.DATABASE_URL_APP, { max: 2 });
  const noop = () => {};
  const silent = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => silent,
  } as AppDeps['logger'];
  // Same config parsing as the API (defaults, timeouts, retries, guard mode), so numbers are representative.
  const { app: appConfig } = loadConfig(env);
  const deps: AppDeps = {
    config: { ...appConfig, askRateLimitPerMinute: 1000, logLevel: 'error' },
    db: { reader: createDb(readerPool), app: createDb(appPool) },
    auth: {} as AppDeps['auth'],
    llm,
    guard: createGuard({
      provider: (env.GUARD_PROVIDER || undefined) as 'clef' | 'heuristic' | 'none' | undefined,
      model: env.GUARD_MODEL || undefined,
      baseUrl: env.GUARD_BASE_URL || undefined,
      accountId: env.CF_ACCOUNT_ID,
      apiToken: env.CF_API_TOKEN,
    }),
    now: () => new Date(),
    logger: logger ?? silent,
  };
  const audit = createMemoryAudit();
  // Live scripts use in-memory conversations: their pseudo user is not a row in the user table.
  const conversations = createMemoryConversations();
  const dbAudit = createDbAudit(deps.db.app);

  return {
    deps,
    modelId: llm.modelId,
    audit,
    async ask(question, opts = {}) {
      const before = audit.requests.length;
      const callsBefore = audit.toolCalls.length;
      const sink: AuditSink = {
        async record(r, c) {
          await audit.record(r, c);
          if (opts.persist) await dbAudit.record(r, c);
        },
      };
      const t0 = performance.now();
      const res = await handleAsk({
        deps,
        tenant: {
          userId: 'live-script',
          tenantId: opts.tenantId ?? 'tenant_alpha',
          email: 'live@script.test',
          name: 'Live script',
          role: 'member',
        },
        requestId: `live-${crypto.randomUUID().slice(0, 8)}`,
        body: {
          conversationId: opts.conversationId ?? crypto.randomUUID(),
          messages: [{ id: 'q1', role: 'user', parts: [{ type: 'text', text: question }] }],
        },
        overrides: { audit: sink, conversations },
      });
      const stream = await parseUiStream(res);
      return {
        stream,
        audit: audit.requests[before],
        toolCalls: audit.toolCalls.slice(callsBefore),
        elapsedMs: Math.round(performance.now() - t0),
      };
    },
    async close() {
      await Promise.all([readerPool.end(), appPool.end()]);
    },
  };
}

export const KNOWN_STATUSES: readonly string[] = AUDIT_REQUEST_STATUSES;
