import { z } from 'zod';
import type { GuardProviderName } from './enums';
import { guardProvider, guardVerdict } from './enums';

/**
 * Outcome of the prompt-injection guard, written to ai_requests.guard_* columns.
 * The guard is defense in depth; the security boundary is backend tenant scoping
 * plus the read-only DB role.
 */
export const guardDecision = z.object({
  verdict: guardVerdict,
  provider: guardProvider,
  model: z.string().nullable(),
  /** Machine-readable reasons, e.g. "write_verb:refund", "injection:0.91", "timeout". */
  reasons: z.array(z.string()),
  /** Raw provider answers (System One `answers`, heuristic matches) -> guard_answers jsonb. */
  answers: z.record(z.string(), z.unknown()).nullable(),
  latency_ms: z.number().int().nonnegative(),
});
export type GuardDecision = z.infer<typeof guardDecision>;

export interface GuardInput {
  /** The latest user question only (never tool output). */
  question: string;
  /** Aborted by the caller at GUARD_TIMEOUT_MS. */
  signal?: AbortSignal;
}

/**
 * Implemented by HeuristicGuard, SystemOneGuard (Clef-flash) and NoopGuard.
 * `check` may reject on transport/parse errors or abort; the caller (orchestrator guard
 * runner) applies the timeout and GUARD_FAIL_MODE and records verdict `unavailable`.
 */
export interface Guard {
  readonly provider: GuardProviderName;
  readonly model: string | null;
  check(input: GuardInput): Promise<GuardDecision>;
}
