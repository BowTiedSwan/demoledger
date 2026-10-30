import type { AppType } from '@demoledger/api/app';
import { hc } from 'hono/client';

/** Typed REST client. Same-origin (Vite proxy), cookies included. */
export const api = hc<AppType>('/', { init: { credentials: 'include' } }).api;
