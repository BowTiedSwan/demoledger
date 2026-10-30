import type { Guard, GuardDecision, GuardFailMode } from '@demoledger/shared';
import { heuristicVerdict, scanQuestion } from './heuristic';

export interface GuardRunResult {
  decision: GuardDecision;
  /** false = the request must not reach the LLM. */
  proceed: boolean;
}

/**
 * Runs a guard with a hard timeout and applies GUARD_FAIL_MODE. Never throws.
 * Errors, timeouts and malformed responses fall back to the local heuristic, which is
 * deterministic and instant: if it blocks, the request is blocked whatever the fail mode;
 * otherwise the verdict is `unavailable` (`open` proceeds, audited; `closed` refuses). So a slow
 * or failing model guard never leaves production with no guard at all.
 */
export async function runGuard(
  guard: Guard,
  question: string,
  opts: { timeoutMs: number; failMode: GuardFailMode },
): Promise<GuardRunResult> {
  const t0 = performance.now();
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(`guard timeout after ${opts.timeoutMs}ms`));
      ac.abort();
    }, opts.timeoutMs);
  });
  try {
    const decision = await Promise.race([guard.check({ question, signal: ac.signal }), timeout]);
    return { decision, proceed: decision.verdict !== 'block' };
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'unknown error';
    const matches = scanQuestion(question);
    const blocked = heuristicVerdict(matches) === 'block';
    const decision: GuardDecision = {
      verdict: blocked ? 'block' : 'unavailable',
      provider: guard.provider,
      model: guard.model,
      reasons: [
        timedOut ? 'timeout' : 'error',
        reason.slice(0, 200),
        ...(blocked
          ? [
              ...new Set(
                matches.filter((m) => m.category !== 'suspicious').map((m) => `heuristic:${m.category}`),
              ),
            ]
          : []),
      ],
      answers: { answers: null, heuristic: matches },
      latency_ms: Math.round(performance.now() - t0),
    };
    return { decision, proceed: !blocked && opts.failMode === 'open' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
