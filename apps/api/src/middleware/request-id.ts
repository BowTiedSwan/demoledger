import { REQUEST_ID_HEADER } from '@demoledger/shared';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../lib/deps';

/** Always generate server-side: never trust a client-supplied request ID. */
export const requestId = createMiddleware<AppEnv>(async (c, next) => {
  const id = crypto.randomUUID();
  c.set('requestId', id);
  c.header(REQUEST_ID_HEADER, id);
  await next();
});
