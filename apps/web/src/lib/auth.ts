import { createAuthClient } from 'better-auth/react';

/**
 * Better Auth client. Same-origin (Vite proxies /api), the session lives in an httpOnly cookie,
 * so no token is ever read or stored in JavaScript.
 */
export const authClient = createAuthClient({ baseURL: window.location.origin });
