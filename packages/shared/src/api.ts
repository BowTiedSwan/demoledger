import { z } from 'zod';
import { guardFailMode, guardProvider } from './enums';

/** `GET /api/me` 200 body: the session user and their active organization (= tenant). */
export const meResponse = z.object({
  user: z.object({ id: z.string(), email: z.email(), name: z.string() }),
  organization: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
  role: z.string(),
});
export type MeResponse = z.infer<typeof meResponse>;

const componentStatus = z.enum(['ok', 'error']);

/** `GET /api/health` body (200 when status=ok, 503 when degraded). No secrets. */
export const healthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  db: z.object({ reader: componentStatus, app: componentStatus }),
  llm: z.object({
    configured: z.boolean(),
    provider: z.string(), // e.g. "workers-ai"
    model: z.string(),
  }),
  guard: z.object({
    provider: guardProvider,
    model: z.string().nullable(),
    fail_mode: guardFailMode,
  }),
  time: z.iso.datetime(),
});
export type HealthResponse = z.infer<typeof healthResponse>;
