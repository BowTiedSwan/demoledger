# AGENTS.md

DemoLedger: a multi-tenant ledger assistant. A finance-ops user asks questions in natural language, and the LLM answers by calling two read-only tools that are scoped to the user's tenant.
The security boundary is the backend tenant scoping plus the read-only DB role, not the prompt.

## Commands (verified)

Node 24 and pnpm 10 only (`.nvmrc`, `engines`). If `node -v` is not 24, put Node 24 first on `PATH`.

```bash
pnpm install
cp .env.example .env            # then set BETTER_AUTH_SECRET: openssl rand -base64 32
pnpm db:up                      # postgres:17 on localhost:5433 (demoledger + demoledger_test)
pnpm db:reset                   # drop schema, migrate, roles.sql, seed 100 transactions (dev DB)
pnpm dev                        # API :3001 + web :5173 (open http://localhost:5173)
pnpm typecheck && pnpm lint && pnpm test   # the gate; tests need `pnpm db:up` first
pnpm format                     # biome check --write
pnpm exec vitest run --project api apps/api/test/http.isolation.test.ts   # one file; projects: shared db api web evals
pnpm repo-map                   # regenerate REPO_MAP.md (`--check` fails on drift)
pnpm eval:guard                 # offline heuristic guard eval; Clef column needs CF_* creds
pnpm smoke:live                 # one real Workers AI request; exits 1 without CF_* creds
```

Tests reset and seed `demoledger_test` themselves (`packages/db/src/testing/global-setup.ts`); never point tests at `demoledger`.

## Always

- Take the tenant only from the validated session (`requireTenant` → `c.get('tenant')`). Every repository function takes `tenantId` as its first parameter and filters on `tenant_id`.
- Validate inputs with the zod schemas in `packages/shared`. Tool args and REST queries are strict, so unknown keys are errors.
- Keep money in integer minor units. Sums are base-10 strings and always split per currency. Format with `formatMinorUnits`.
- Inject the LLM, the guard and the clock (`createApp(deps)`). Tests use `MockLanguageModelV4` and never construct a real provider.
- Run `pnpm typecheck && pnpm lint && pnpm test` before you report a task done; add or update tests next to the code.
- Regenerate `REPO_MAP.md` with `pnpm repo-map` after adding, moving or renaming files.

## Ask first (file a task in `docs/TASKS.md`)

- Changing a contract in `packages/shared/**` or `packages/db/src/schema/**` (architect approves).
- Adding a dependency to a package you do not own (ownership table in `docs/PLAN.md`).
- Changing guard thresholds, `GUARD_FAIL_MODE` defaults, step/retry/timeout caps, or the CSP.

## Never

- Execute SQL written by the LLM, or build SQL by string concatenation. Use parameterized drizzle `sql` templates only.
- Accept a tenant or organization ID from a request body, query string, header or tool argument.
- Add a tool that writes, pays, refunds, transfers or changes balances. The registry holds exactly two read-only data tools (`search_transactions`, `aggregate_transactions`) and one presentational tool with no DB access (`present_visual`).
- Use the owner DB role in the running API. The API uses `ledger_reader` (transactions) and `ledger_app` (auth + append-only audit).
- Render model output with remote images or external links (exfiltration channel); keep the Streamdown hardening in `apps/web/src/components/ai-elements/message.tsx`.
- Commit `.env`, tokens or keys; put real people, companies or financial data anywhere; call a Workers AI model that needs the paid plan.
- Hand-edit `REPO_MAP.md` or generated migrations.

## Where things are

- `docs/README.md`: index of the docs and what each one owns.
- `docs/ARCHITECTURE.md`: request path, security model and production notes. `docs/adr/`: decisions; do not reopen them.
- `CONTEXT.md`: glossary (tenant, minor units, guard verdict, grounded citation…).
- `REPO_MAP.md`: generated file and export map.
- Nested rules: `apps/api/AGENTS.md`, `apps/web/AGENTS.md`, `packages/db/AGENTS.md`.
