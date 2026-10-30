# ADR 0003: httpOnly cookie for the browser, bearer token for programmatic clients

Status: accepted

## Context
The browser UI and scripted clients (curl demo, evals, graders) both need authenticated access. Tokens in browser JavaScript are an XSS liability.

## Decision
Better Auth runs inside the API (email/password, organization plugin, bearer plugin):
- **Browser:** an httpOnly session cookie, same origin through the Vite `/api` proxy, so no CORS. The SPA never sees or stores a token.
- **Programmatic:** `POST /api/auth/sign-in/email` returns the token in the `set-auth-token` response header; clients send it back as `Authorization: Bearer …`.

Both resolve to the same session, and `requireTenant` treats them identically (`apps/api/test/http.isolation.test.ts` runs every isolation case in both modes).

Cookie-authenticated `POST /api/ask` must carry a trusted `Origin` (`apps/api/src/middleware/csrf.ts`, finding F-07). Requests with a bearer token are exempt, because a browser cannot attach that header cross-site without a CORS preflight, and the API never grants one.

## Consequences
- Self-service sign-up and organization creation are disabled; users and tenants are seeded.
- Better Auth's `/api/auth/organization/*` endpoints are not exposed (404). The UI does not need them, and a refused `set-active` would otherwise clear the user's own active organization (finding F-06).
- Bearer tokens are session tokens; after sign-out the token is rejected with 401 (checked by the reviewer with curl).
