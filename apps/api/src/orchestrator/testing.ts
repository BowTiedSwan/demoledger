/**
 * Test helpers (no network): scripted mock language model, fake reader, deps builder and an
 * SSE reader. Imported by tests only.
 */
import type { AggregateResponse, SearchTransactionsResult, TransactionDTO } from '@demoledger/shared';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { createMemoryAudit } from '../audit';
import { createMemoryConversations } from '../conversations';
import { NoopGuard } from '../guard';
import type { AppDeps, Logger } from '../lib/deps';
import type { LedgerReader } from '../tools';
import type { HandleAskArgs } from './index';

export const NOW = new Date('2026-10-28T12:00:00Z');

export type ScriptStep =
  | { text: string; chunkDelayMs?: number; splitEvery?: number; finish?: 'length' }
  | { tools: { name: string; input?: unknown; raw?: string }[] }
  | { error: unknown }
  | { hang: true };

function splitText(text: string, n?: number): string[] {
  if (!n) return [text];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += n) out.push(text.slice(i, i + n));
  return out;
}

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

/** A model that plays `steps` in order (the last repeats) and records every call it receives. */
export function scriptedModel(steps: ScriptStep[]) {
  const calls: {
    tools: string[];
    toolChoice: unknown;
    maxOutputTokens: number | undefined;
    prompt: unknown;
  }[] = [];
  let i = 0;
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      calls.push({
        tools: (options.tools ?? []).map((t) => t.name),
        toolChoice: options.toolChoice,
        maxOutputTokens: options.maxOutputTokens,
        prompt: options.prompt,
      });
      const step = steps[Math.min(i++, steps.length - 1)] as ScriptStep;
      if ('error' in step) throw step.error;
      if ('hang' in step) {
        await new Promise((_, reject) => {
          options.abortSignal?.addEventListener('abort', () =>
            reject(options.abortSignal?.reason ?? new Error('aborted')),
          );
        });
      }
      const chunks: unknown[] = [];
      if ('text' in step) {
        chunks.push(
          { type: 'text-start', id: 't1' },
          ...splitText(step.text, step.splitEvery).map((delta) => ({ type: 'text-delta', id: 't1', delta })),
          { type: 'text-end', id: 't1' },
          { type: 'finish', finishReason: { unified: step.finish ?? 'stop', raw: undefined }, usage },
        );
      } else if ('tools' in step) {
        for (const [n, t] of step.tools.entries()) {
          chunks.push({
            type: 'tool-call',
            toolCallId: `call-${i}-${n}`,
            toolName: t.name,
            input: t.raw ?? JSON.stringify(t.input),
          });
        }
        chunks.push({ type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage });
      }
      const chunkDelayInMs = 'text' in step ? (step.chunkDelayMs ?? null) : null;
      return {
        stream: simulateReadableStream({ chunks: chunks as never[], initialDelayInMs: null, chunkDelayInMs }),
      };
    },
  });
  return { model, calls };
}

export function txn(n: number, over: Partial<TransactionDTO> = {}): TransactionDTO {
  return {
    transaction_id: `TXN-A-${String(n).padStart(4, '0')}`,
    wallet_id: 'WALLET-A-001',
    amount_minor: 12_500,
    currency: 'EUR',
    amount_display: '€125.00',
    direction: 'outgoing',
    status: 'failed',
    failure_reason: 'insufficient_funds',
    occurred_at: '2026-10-27T10:00:00.000Z',
    description: 'Supplier payout',
    ...over,
  };
}

export interface FakeReader extends LedgerReader {
  searchCalls: { tenantId: string; args: unknown }[];
  aggregateCalls: { tenantId: string; args: unknown }[];
}

export function fakeReader(
  rows: TransactionDTO[] = [],
  opts: { fail?: boolean; aggregate?: AggregateResponse } = {},
): FakeReader {
  const searchCalls: FakeReader['searchCalls'] = [];
  const aggregateCalls: FakeReader['aggregateCalls'] = [];
  return {
    searchCalls,
    aggregateCalls,
    async search(tenantId, args) {
      searchCalls.push({ tenantId, args });
      if (opts.fail) throw new Error('select * from transactions failed: connection reset');
      const res: Omit<SearchTransactionsResult, 'ok'> = {
        rows,
        returned: rows.length,
        total_matching: rows.length,
        truncated: false,
        applied_range: null,
      };
      return res;
    },
    async aggregate(tenantId, args) {
      aggregateCalls.push({ tenantId, args });
      if (opts.aggregate) return opts.aggregate;
      const res: AggregateResponse = {
        metric: 'count',
        group_by: 'none',
        groups: rows.length
          ? [{ key: 'all', currency: null, count: rows.length, sum_minor: null, sum_display: null }]
          : [],
        total_matching: rows.length,
        applied_range: null,
      };
      return res;
    },
  };
}

const silent: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return silent;
  },
};

export function makeArgs(over: {
  model?: MockLanguageModelV4 | null;
  question?: string;
  guard?: AppDeps['guard'];
  config?: Partial<AppDeps['config']['llm']> & { guard?: Partial<AppDeps['config']['guard']> };
  reader?: LedgerReader;
  tenantId?: string;
  conversationId?: string;
  userId?: string;
  conversations?: ReturnType<typeof createMemoryConversations>;
}) {
  const audit = createMemoryAudit();
  const conversations = over.conversations ?? createMemoryConversations();
  const reader = over.reader ?? fakeReader();
  const { guard: guardCfg, ...llmCfg } = over.config ?? {};
  const deps: AppDeps = {
    config: {
      port: 0,
      logLevel: 'error',
      trustedOrigins: [],
      llm: { requestTimeoutMs: 5000, stepTimeoutMs: 4000, maxRetries: 2, maxSteps: 5, ...llmCfg },
      guard: { failMode: 'open', timeoutMs: 1500, ...guardCfg },
      askRateLimitPerMinute: 10,
    },
    db: {} as AppDeps['db'],
    auth: {} as AppDeps['auth'],
    llm:
      over.model === null
        ? null
        : {
            model: over.model ?? scriptedModel([{ text: 'ok' }]).model,
            provider: 'mock',
            modelId: 'mock-model',
          },
    guard: over.guard ?? new NoopGuard(),
    now: () => NOW,
    logger: silent,
  };
  const args: HandleAskArgs = {
    deps,
    tenant: {
      userId: over.userId ?? 'user-alpha',
      tenantId: over.tenantId ?? 'tenant_alpha',
      email: 'a@x.test',
      name: 'A',
      role: 'member',
    },
    requestId: 'req-1',
    body: {
      conversationId: over.conversationId ?? '11111111-1111-4111-8111-111111111111',
      messages: [
        {
          id: 'm1',
          role: 'user',
          parts: [
            { type: 'text', text: over.question ?? 'How many failed transactions occurred yesterday?' },
          ],
        },
      ],
    },
    overrides: { reader, audit, conversations },
  };
  return { args, audit, reader, conversations };
}

export { type ParsedStream, parseUiStream as readStream } from './stream';
