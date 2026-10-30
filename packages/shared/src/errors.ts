import { z } from 'zod';

/** `error.code` values of the REST error envelope. */
export const API_ERROR_CODES = [
  'unauthorized', // no/invalid session or bearer token
  'forbidden', // no active organization, or not a member of it
  'validation_error', // bad query/body (details in `issues`)
  'not_found',
  'rate_limited', // our own per-user limiter (Retry-After header set)
  'payload_too_large',
  'llm_unconfigured', // CF_* credentials absent
  'service_unavailable', // DB down etc.
  'internal_error',
] as const;
export const apiErrorCode = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof apiErrorCode>;

export const validationIssue = z.object({
  path: z.string(), // dotted path, '' for object-level
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof validationIssue>;

/** Every non-2xx JSON response: `{ error: { code, message, requestId } }`. */
export const errorEnvelope = z.object({
  error: z.object({
    code: apiErrorCode,
    /** Safe, user-facing message. Never contains stack traces, SQL or secrets. */
    message: z.string(),
    /** Same value as the `X-Request-Id` response header. */
    requestId: z.string(),
    issues: z.array(validationIssue).optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelope>;

/** Response header carrying the per-request ID. */
export const REQUEST_ID_HEADER = 'X-Request-Id';
