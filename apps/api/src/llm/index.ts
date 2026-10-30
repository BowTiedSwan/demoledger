import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LlmDeps } from '../lib/deps';

export { type ClassifiedError, classifyLlmError } from './errors';

const QUOTA_BODY = /neurons?|daily (?:free )?(?:allocation|limit|quota)|\b4006\b|used up/i;

/**
 * The AI SDK retries every 429 (about 6 s of back-off). A spent daily Neuron allowance will not
 * recover within a request, so surface it as a non-retryable 403 (classified `quota_exhausted`).
 */
export function quotaAwareFetch(base: typeof fetch = fetch): typeof fetch {
  return (async (input, init) => {
    const res = await base(input, init);
    if (res.status !== 429) return res;
    const body = await res.text();
    if (!QUOTA_BODY.test(body)) return new Response(body, { status: 429, headers: res.headers });
    return new Response(body, { status: 403, headers: res.headers });
  }) as typeof fetch;
}

export const DEFAULT_LLM_MODEL = '@cf/google/gemma-4-26b-a4b-it';

export type ReasoningEffort = 'low' | 'medium' | 'high';

/**
 * Workers AI's chat schema for non-GLM models rejects an assistant tool-call message with
 * `content: null` ("'string' not in 'null'") and replayed `reasoning_content`, which the SDK adds
 * from the previous step's reasoning. Normalise both before sending.
 */
export function sanitizeMessages(messages: unknown): unknown {
  if (!Array.isArray(messages)) return messages;
  return messages.map((m) => {
    if (m?.role !== 'assistant') return m;
    const { reasoning_content: _drop, reasoning: _drop2, ...rest } = m as Record<string, unknown>;
    return { ...rest, content: rest.content ?? '' };
  });
}

/** Extra request-body fields that set the reasoning level for this model family. */
export function reasoningBodyFields(modelId: string, effort: ReasoningEffort): Record<string, unknown> {
  if (/gpt-oss/i.test(modelId)) return { reasoning_effort: effort };
  if (/glm/i.test(modelId)) return { chat_template_kwargs: { enable_thinking: effort !== 'low' } };
  return {};
}

export interface LlmConfig {
  accountId?: string | undefined;
  apiToken?: string | undefined;
  model?: string | undefined;
  /** Override of the OpenAI-compatible base URL. */
  baseUrl?: string | undefined;
  /**
   * Reasoning effort, mapped per model family (default `low`):
   * - gpt-oss: sent as `reasoning_effort` (low | medium | high).
   * - GLM (glm-*): `chat_template_kwargs.enable_thinking`; low = off, medium/high = on.
   * - other models: nothing is sent.
   */
  reasoningEffort?: ReasoningEffort | undefined;
}

export function workersAiBaseUrl(accountId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`;
}

/**
 * Workers AI (Free plan) through its OpenAI-compatible endpoint.
 * Returns `null` when credentials are absent so /api/ask can answer `llm_unconfigured`.
 *
 * Never constructible under tests: every test injects a mock model, and this guard makes an
 * accidental real provider fail fast instead of reaching the network.
 */
export function createLlm(config: LlmConfig): LlmDeps | null {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    throw new Error('createLlm() must not be called under test: inject a mock model (ai/test) instead.');
  }
  return buildLlm(config, quotaAwareFetch());
}

/** Provider construction with an injectable fetch (tests assert the request body offline). */
export function buildLlm(config: LlmConfig, fetchImpl: typeof fetch): LlmDeps | null {
  if (!config.apiToken || (!config.accountId && !config.baseUrl)) return null;
  const modelId = config.model || DEFAULT_LLM_MODEL;
  const provider = createOpenAICompatible({
    name: 'workers-ai',
    baseURL: config.baseUrl ?? workersAiBaseUrl(config.accountId as string),
    apiKey: config.apiToken,
    includeUsage: true,
    fetch: fetchImpl,
    transformRequestBody: (args: Record<string, unknown>) => ({
      ...args,
      ...(/glm/i.test(modelId) ? {} : { messages: sanitizeMessages(args.messages) }),
      ...reasoningBodyFields(modelId, config.reasoningEffort ?? 'low'),
    }),
  });
  return { model: provider.chatModel(modelId), provider: 'workers-ai', modelId };
}
