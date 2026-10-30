import type { AskErrorCode, AuditRequestStatus } from '@demoledger/shared';
import { APICallError } from 'ai';

export interface ClassifiedError {
  status: Extract<
    AuditRequestStatus,
    'rate_limited' | 'quota_exhausted' | 'timeout' | 'llm_error' | 'validation_error' | 'loop_limit'
  >;
  code: AskErrorCode;
  retryable: boolean;
  /** Short, secret-free description for ai_requests.error_detail. */
  detail: string;
}

const QUOTA_RE =
  /neurons?|daily (?:free )?(?:allocation|limit|quota)|quota|insufficient[_ ]quota|\b4006\b|used up/i;

function errorChain(err: unknown): unknown[] {
  const out: unknown[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur; i++) {
    out.push(cur);
    cur = (cur as { cause?: unknown }).cause ?? (cur as { lastError?: unknown }).lastError;
  }
  // RetryError carries `errors[]`; the last one is the final failure.
  const errs = (err as { errors?: unknown[] } | null)?.errors;
  if (Array.isArray(errs)) out.push(...errs);
  return out;
}

function isAbortLike(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/**
 * Map a provider/transport failure to an audit status + user-facing code (brief 7.5).
 * 429 -> rate_limited, unless the body says the daily Neuron allowance is gone -> quota_exhausted.
 */
export function classifyLlmError(err: unknown, opts: { requestTimedOut?: boolean } = {}): ClassifiedError {
  const chain = errorChain(err);
  const api = chain.find((e): e is APICallError => APICallError.isInstance(e));
  const text = chain
    .flatMap((e) => [
      (e as { message?: string } | null)?.message,
      (e as { responseBody?: string } | null)?.responseBody,
    ])
    .filter((s): s is string => typeof s === 'string')
    .join(' ');

  // With the tools cleared on the final step, a stray tool call makes the SDK throw: that is the step cap.
  if (
    chain.some((e) =>
      ['AI_ToolChoiceViolationError', 'AI_NoSuchToolError'].includes(
        (e as { name?: string } | null)?.name ?? '',
      ),
    )
  ) {
    return {
      status: 'loop_limit',
      code: 'loop_limit',
      retryable: false,
      detail: 'tool call requested on the final step',
    };
  }
  if (api?.statusCode === 429 || (api?.statusCode === 403 && QUOTA_RE.test(text))) {
    if (QUOTA_RE.test(text)) {
      return {
        status: 'quota_exhausted',
        code: 'quota_exhausted',
        retryable: false,
        detail: 'daily Neuron allowance exhausted',
      };
    }
    return {
      status: 'rate_limited',
      code: 'rate_limited',
      retryable: true,
      detail: 'HTTP 429 after retries',
    };
  }
  if (opts.requestTimedOut || api?.statusCode === 408 || api?.statusCode === 504 || chain.some(isAbortLike)) {
    return { status: 'timeout', code: 'timeout', retryable: true, detail: 'request or step timeout' };
  }
  if (api) {
    return {
      status: 'llm_error',
      code: 'llm_error',
      retryable: (api.statusCode ?? 500) >= 500,
      detail: `provider HTTP ${api.statusCode ?? 'error'}`,
    };
  }
  return {
    status: 'llm_error',
    code: 'llm_error',
    retryable: true,
    detail: (err instanceof Error ? err.name : 'unknown error').slice(0, 120),
  };
}
