import type { ErrorEnvelope } from '@demoledger/shared';
import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import type { ZodType } from 'zod';

/** zValidator that answers 400 with the standard error envelope (`validation_error`). */
export function validate<Target extends keyof ValidationTargets, Schema extends ZodType>(
  target: Target,
  schema: Schema,
) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      // Set by the request-id middleware in app.ts (hook context is not AppEnv-typed).
      const requestId = (c.var as { requestId?: string }).requestId ?? 'unknown';
      const body: ErrorEnvelope = {
        error: {
          code: 'validation_error',
          message: 'Invalid request parameters.',
          requestId,
          issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      };
      return c.json(body, 400);
    }
  });
}
