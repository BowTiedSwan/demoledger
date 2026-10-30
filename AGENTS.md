# AGENTS.md

DemoLedger: a multi-tenant, read-only ledger assistant. A finance-ops user asks questions; the model answers by calling tenant-scoped tools, and every answer is checked and audited.
The security boundary is the backend: tenant from the session, one repository, DB role grants and Postgres RLS. The prompt and the guard are defense in depth.

## Commands (verified)

Node 24 and pnpm 10 only (`.nvmrc`, `engines`). If `node -v` is not 24, put Node 24 first on `PATH`.

```bash
pnpm install
cp .env.example .env            # then set BETTER_AUTH_SECRET: openssl rand -base64 32
pnpm db:up                      # postgres:17 on 127.0.0.1:5433 (demoledger + demoledger_test)
pnpm db:reset                   # drop schema, migrate, roles.sql, seed 100 transactions (dev DB)
pnpm dev                        # API :3001 + web :5173 (open http://localhost:5173)
pnpm repo-map --check && pnpm typecheck && pnpm lint && pnpm test   # the CI gate; tests need `pnpm db:up`
pnpm format                     # biome check --write
pnpm exec vitest run --project api apps/api/test/http.isolation.test.ts   # one file; projects: shared db api web evals
pnpm repo-map                   # regenerate REPO_MAP.md after adding, moving or renaming files
```

Tests reset and seed `demoledger_test` themselves (`packages/db/src/testing/global-setup.ts`) and blank the `CF_*` credentials, so the gate never touches the dev DB or a live model.

Live AI commands (`pnpm smoke:live`, `pnpm eval:llm`, the Clef column of `pnpm eval:guard`) need `CF_ACCOUNT_ID` / `CF_API_TOKEN` and spend Neurons from a shared 10,000/day allowance: run a full eval once per model change, never in a loop (D-27). Without credentials the app runs on the heuristic guard and `/api/ask` answers `llm_unconfigured`.

## Always

- Take the tenant only from `requireTenant` (`c.get('tenant')`). Repository functions take `tenantId` first, filter on `tenant_id`, and run inside `withTenant`, which sets the RLS context. Conversation queries use `withTenantUser`.
- Validate inputs with the strict zod schemas in `packages/shared`; unknown keys are errors.
- Keep money in integer minor units; sums are base-10 strings, one per currency. Format with `formatMinorUnits`.
- Inject the LLM, guard, clock and stores through `createApp(deps)`. Tests use `MockLanguageModelV4`; `createLlm` throws under test by design.
- Build model history only from server-stored answered pairs (ADR 0008); client-sent history never reaches the model.
- Run the gate yourself before you report a task done.

## Ask first (file a task in `docs/TASKS.md`)

- A contract change in `packages/shared/**` or `packages/db/src/schema/**`, or a grant / RLS change in `roles.sql`.
- A dependency in a package you do not own (ownership: `docs/PLAN.md`).
- Guard thresholds, `GUARD_FAIL_MODE`, step/retry/timeout caps, the CSP, or the default `LLM_MODEL` (ADR 0007).

## Never

- Execute SQL written by the model or built by string concatenation; use parameterized drizzle `sql` templates.
- Accept a tenant or organization ID from a body, query string, header or tool argument.
- Add a tool that writes, pays, refunds or transfers. The registry is exactly `TOOL_NAMES`: two data tools and one presentational tool (`present_visual`, no DB access).
- Connect the running API as the owner role. It uses `ledger_reader` and `ledger_app`, and refuses to boot if either is a superuser or has BYPASSRLS.
- Set `TRUST_PROXY_HEADERS=true` unless an ingress overwrites `X-Forwarded-For`; login throttling keys on that address.
- Render model output with remote images or external links; keep the hardening in `apps/web/src/components/ai-elements/message.tsx` and `apps/web/csp.ts`.
- Commit `.env` or credentials, or put real people, companies or financial data anywhere.
- Hand-edit `REPO_MAP.md` or files in `packages/db/src/migrations/`.

## Where things are

- `REPO_MAP.md`: generated module map, plus API routes, web routes, tools and tables with their grants and RLS. Read it before searching.
- `CONTEXT.md`: the domain vocabulary. Use its terms in code, tests and docs.
- `docs/adr/`: decisions not to reopen. `docs/DECISIONS.md`: dated judgement calls.
- `docs/ARCHITECTURE.md` and `docs/diagrams/`: request path, tenant-boundary layers and data model (SVG plus a Mermaid text twin each).
- `docs/README.md`: which doc owns which fact.
- Nested rules: `apps/api/AGENTS.md`, `apps/web/AGENTS.md`, `packages/db/AGENTS.md`.
