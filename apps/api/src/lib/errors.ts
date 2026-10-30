import type { ApiErrorCode, ErrorEnvelope } from '@demoledger/shared';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppEnv } from './deps';

export function envelope(requestId: string, code: ApiErrorCode, message: string): ErrorEnvelope {
  return { error: { code, message, requestId } };
}

export function fail(c: Context<AppEnv>, status: ContentfulStatusCode, code: ApiErrorCode, message: string) {
  return c.json(envelope(c.get('requestId') ?? 'unknown', code, message), status);
}
