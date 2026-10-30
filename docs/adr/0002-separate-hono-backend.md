# ADR 0002: Separate Hono backend and a Vite SPA

Status: accepted

## Context
We need a Node + TypeScript API (R1) and a React UI (R3). A full-stack framework would merge the two; a separate backend keeps the security boundary explicit.

## Decision
`apps/api` is Hono on Node (`@hono/node-server`). `apps/web` is a Vite + React 19 SPA with no SSR. `createApp(deps)` takes every dependency (DB pools, auth, LLM, guard, clock, logger), and `AppType` is exported for the typed `hc` client.

## Consequences
- The tenant boundary lives in one server process, and tests exercise it over HTTP with injected providers (`apps/api/test/`).
- The web app has no server code, so nothing in the browser bundle can reach the database or provider keys.
- There are two dev processes (`pnpm dev` runs both). Production needs one domain, with the SPA as static files and `/api` routed to the API (see `docs/ARCHITECTURE.md`, Deployment).
