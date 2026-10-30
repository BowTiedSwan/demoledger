import { ASK_ERROR_CODES, ASK_ERROR_MESSAGES } from '@demoledger/shared';
import { describe, expect, it } from 'vitest';
import {
  askErrorCopy,
  describeAskError,
  describeTransportError,
  isAskErrorCode,
  SESSION_EXPIRED_MESSAGE,
  USER_RATE_LIMIT_MESSAGE,
} from './ask-errors';

describe('askErrorCopy', () => {
  it('uses the shared copy for every code', () => {
    for (const code of ASK_ERROR_CODES) {
      expect(askErrorCopy(code)).toBe(ASK_ERROR_MESSAGES[code]);
      expect(describeAskError(code).message).toBe(ASK_ERROR_MESSAGES[code]);
    }
  });

  it('marks only transient failures as retryable', () => {
    expect(describeAskError('rate_limited').retryable).toBe(true);
    expect(describeAskError('timeout').retryable).toBe(true);
    expect(describeAskError('blocked').retryable).toBe(false);
    expect(describeAskError('quota_exhausted').retryable).toBe(false);
    expect(describeAskError('llm_unconfigured').retryable).toBe(false);
  });

  it('recognises codes', () => {
    expect(isAskErrorCode('loop_limit')).toBe(true);
    expect(isAskErrorCode('nope')).toBe(false);
  });
});

describe('describeTransportError', () => {
  const envelope = (code: string, requestId = 'req-1') =>
    new Error(JSON.stringify({ error: { code, message: 'server text', requestId } }));

  it('returns null without an error', () => {
    expect(describeTransportError(undefined)).toBeNull();
  });

  it('gives the API per-user 429 its own copy, distinct from the provider rate limit', () => {
    const d = describeTransportError(envelope('rate_limited'));
    expect(d?.message).toBe(USER_RATE_LIMIT_MESSAGE);
    expect(d?.message).not.toBe(ASK_ERROR_MESSAGES.rate_limited);
    expect(d?.requestId).toBe('req-1');
  });

  it('maps an unconfigured LLM', () => {
    expect(describeTransportError(envelope('llm_unconfigured'))?.message).toBe(
      ASK_ERROR_MESSAGES.llm_unconfigured,
    );
  });

  it('maps unauthorized to the session-expired copy', () => {
    const d = describeTransportError(envelope('unauthorized'));
    expect(d?.code).toBe('unauthorized');
    expect(d?.message).toBe(SESSION_EXPIRED_MESSAGE);
  });

  it('never shows raw text for unparseable errors', () => {
    const d = describeTransportError(new TypeError('Failed to fetch'));
    expect(d?.code).toBe('internal_error');
    expect(d?.message).toBe(ASK_ERROR_MESSAGES.internal_error);
  });
});
