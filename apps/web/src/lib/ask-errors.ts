import {
  type ApiErrorCode,
  ASK_ERROR_CODES,
  ASK_ERROR_MESSAGES,
  type AskErrorCode,
  errorEnvelope,
} from '@demoledger/shared';
import { StreamTruncatedError } from './stream-guard';

export interface DisplayedError {
  code: AskErrorCode | 'unauthorized' | 'unreachable' | 'interrupted';
  /** Friendly, user-facing copy. */
  message: string;
  retryable: boolean;
  requestId?: string | undefined;
}

const RETRYABLE: ReadonlySet<AskErrorCode> = new Set([
  'rate_limited',
  'timeout',
  'llm_error',
  'internal_error',
]);

/** DemoLedger's own per-user limiter (HTTP 429), distinct from the AI provider's rate limit. */
export const USER_RATE_LIMIT_MESSAGE = 'You are asking too quickly. Wait a moment, then try again.';

/** The API is down, restarting, or the network dropped: no JSON error envelope came back. */
export const UNREACHABLE_MESSAGE = "Can't reach the server right now. Try again in a moment.";
/** The stream ended without a finish part: the server dropped mid-answer. */
export const INTERRUPTED_MESSAGE = 'The answer was interrupted before it finished. Try again.';

export const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Sign in again to continue.';

export function isAskErrorCode(value: string): value is AskErrorCode {
  return (ASK_ERROR_CODES as readonly string[]).includes(value);
}

/** Copy for a `data-error` part. The shared map is the single source of the wording. */
export function askErrorCopy(code: AskErrorCode): string {
  return ASK_ERROR_MESSAGES[code];
}

export function describeAskError(code: AskErrorCode, requestId?: string): DisplayedError {
  return { code, message: askErrorCopy(code), retryable: RETRYABLE.has(code), requestId };
}

/** REST error-envelope codes that have an assistant equivalent. */
const API_TO_ASK: Partial<Record<ApiErrorCode, AskErrorCode>> = {
  rate_limited: 'rate_limited',
  llm_unconfigured: 'llm_unconfigured',
  validation_error: 'validation_error',
  payload_too_large: 'validation_error',
  service_unavailable: 'internal_error',
  internal_error: 'internal_error',
};

/**
 * Map a transport-level failure from `useChat` (HTTP error before any stream part arrived) to
 * display copy. The AI SDK puts the response body text in `error.message`, which for our API is the
 * JSON error envelope. Anything unparseable becomes `internal_error` copy; raw text is never shown.
 */
export function describeTransportError(error: Error | undefined): DisplayedError | null {
  if (!error) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(error.message);
  } catch {
    parsed = undefined;
  }
  const envelope = errorEnvelope.safeParse(parsed);
  if (envelope.success) {
    const { code, requestId } = envelope.data.error;
    if (code === 'unauthorized' || code === 'forbidden') {
      return { code: 'unauthorized', message: SESSION_EXPIRED_MESSAGE, retryable: false, requestId };
    }
    if (code === 'rate_limited') {
      return { code: 'rate_limited', message: USER_RATE_LIMIT_MESSAGE, retryable: true, requestId };
    }
    return describeAskError(API_TO_ASK[code] ?? 'internal_error', requestId);
  }
  if (error instanceof StreamTruncatedError) {
    return { code: 'interrupted', message: INTERRUPTED_MESSAGE, retryable: true };
  }
  // No error envelope: the fetch rejected (network error, TypeError "Failed to fetch"), or a proxy
  // 502/503/504 / plain-text body came back instead of our API. Genuine API 500s always carry an
  // envelope with a requestId and are handled above, so they keep the internal_error copy.
  return { code: 'unreachable', message: UNREACHABLE_MESSAGE, retryable: true };
}
