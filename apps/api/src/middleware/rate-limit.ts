import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../lib/deps';
import { fail } from '../lib/errors';

/**
 * Per-user fixed-window limiter (in-memory; single process). Must run after requireTenant.
 * Production would use a shared store (documented in ARCHITECTURE).
 */
export function perUserRateLimit(perMinute: number, now: () => number = Date.now) {
  const windows = new Map<string, { start: number; count: number }>();
  return createMiddleware<AppEnv>(async (c, next) => {
    const userId = c.get('tenant').userId;
    const t = now();
    const w = windows.get(userId);
    if (!w || t - w.start >= 60_000) {
      windows.set(userId, { start: t, count: 1 });
      // opportunistic cleanup
      if (windows.size > 10_000) for (const [k, v] of windows) if (t - v.start >= 60_000) windows.delete(k);
    } else if (w.count >= perMinute) {
      c.header('Retry-After', String(Math.max(1, Math.ceil((w.start + 60_000 - t) / 1000))));
      return fail(c, 429, 'rate_limited', 'Too many questions. Please wait a moment and try again.');
    } else {
      w.count += 1;
    }
    await next();
  });
}
