import type { Guard } from '@demoledger/shared';
import { createGuard } from '../guard';
import { createLlm } from '../llm';
import type { ParsedEnv } from './config';
import type { LlmDeps } from './deps';

/** Production wiring of ai-builder's factories. Never called from tests (they inject mocks). */
export function createAiDeps(env: ParsedEnv): { llm: LlmDeps | null; guard: Guard } {
  const llm = createLlm({
    accountId: env.CF_ACCOUNT_ID,
    apiToken: env.CF_API_TOKEN,
    model: env.LLM_MODEL,
    baseUrl: env.LLM_BASE_URL,
    reasoningEffort: env.LLM_REASONING_EFFORT,
  });
  const guard = createGuard({
    provider: env.GUARD_PROVIDER,
    model: env.GUARD_MODEL,
    baseUrl: env.GUARD_BASE_URL,
    accountId: env.CF_ACCOUNT_ID,
    apiToken: env.CF_API_TOKEN,
    failMode: env.GUARD_FAIL_MODE,
    timeoutMs: env.GUARD_TIMEOUT_MS,
  });
  return { llm, guard };
}
