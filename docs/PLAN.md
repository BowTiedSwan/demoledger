# DemoLedger build plan

Multi-tenant ledger assistant: a finance-ops user asks questions; the LLM calls two read-only, tenant-scoped tools; answers cite transaction IDs from tool results only. The build brief (`docs/BUILD_BRIEF.md`) is authoritative; this page is the map.

## Module map

```
apps/web (Vite+React SPA :5173) ──/api proxy──▶ apps/api (Hono on Node :3001)
  hc<AppType> REST + useChat(/api/ask)            ├─ auth/        Better Auth (email+password, organization, bearer)
                                                  ├─ middleware/  request-id, logging, requireTenant
                                                  ├─ routes/      /api/{auth/*, me, health, transactions, transactions/aggregate, ask}
                                                  ├─ repo/        transactions.ts — every fn takes tenantId first  (ledger_reader pool)
                                                  ├─ guard/       Heuristic | SystemOne(Clef-flash) | Noop
                                                  ├─ tools/       ledgerTools({tenantId, requestId, writer}) → search/aggregate → repo
                                                  ├─ orchestrator/ streamText loop, prepareStep, grounding check, error mapping
                                                  ├─ llm/         Workers AI via @ai-sdk/openai-compatible
                                                  └─ audit/       ai_requests / ai_tool_calls inserts (ledger_app pool)
packages/shared  zod contracts + pure helpers (no Node deps)  ◀── imported by api, web, evals, db tests
packages/db      Drizzle schema, migrations, roles.sql, deterministic seed, pools
evals            guard.jsonl / questions.jsonl + runners (manual; use free Neurons)
Postgres 17 (docker compose, host :5433): demoledger (dev) + demoledger_test (tests)
```

## Contracts (`packages/shared/src`, architect-owned)

| File | Exports |
|---|---|
| `enums.ts` | statuses, directions, currencies, sort, period, group_by, metric, audit request status, guard verdict/provider/fail mode, `TOOL_NAMES` |
| `ids.ts` | wallet / transaction ID regexes + schemas, `extractTransactionIds` |
| `filters.ts` | `searchTransactionsArgs`, `aggregateTransactionsArgs` (tool args, strict), `listTransactionsQuery`, `aggregateTransactionsQuery` (REST, coerced, strict), `TransactionFilter`, limits |
| `dates.ts` | UTC period semantics: `resolvePeriod`, `resolveExplicitRange`, `resolveDateFilter` (half-open ranges) |
| `money.ts` | `CURRENCY_EXPONENT`, `formatMinorUnits` (bigint-safe) |
| `transactions.ts` | `TransactionDTO` (no tenant_id), `TransactionListResponse`, `AggregateGroup`, `AggregateResponse` |
| `errors.ts` | `ErrorEnvelope`, `API_ERROR_CODES`, `REQUEST_ID_HEADER` |
| `api.ts` | `MeResponse`, `HealthResponse` |
| `ask.ts` | `askRequest` + limits, `latestQuestion`, `ASK_ERROR_CODES/MESSAGES`, `askDataPartSchemas` / `AskDataParts`, `AskMessageMetadata`, tool result schemas, `AskUITools`, `transactionSourceUrl` |
| `guard.ts` | `GuardDecision`, `Guard` interface |

Key decisions: sums are `sum_minor` base-10 strings (bigint-safe), always split per currency; amounts are integer `amount_minor` numbers; list pagination is offset-based; REST queries reject unknown params (`?tenant_id=` → 400); client-sent tool/data parts in `/api/ask` history are ignored.

## TypeScript / module setup

`tsconfig.base.json`: `module: ESNext`, `moduleResolution: Bundler`, `noEmit`, `allowImportingTsExtensions`, `verbatimModuleSyntax`, strict + `noUncheckedIndexedAccess`. Internal packages ship source (`main`/`types` → `src/index.ts`); nothing is compiled. Vite (web), vitest (tests) and tsx (api, db scripts, evals) all resolve extensionless TS imports, so Bundler resolution fits all three. Each package runs `tsc -p` for typecheck only. TypeScript 7.0.2.

## Env vars and ports

See `.env.example` (single source; every var commented). Groups: Postgres owner + role passwords; `DATABASE_URL{,_READER,_APP}` and `TEST_DATABASE_URL*`; `API_PORT`, `LOG_LEVEL`; `BETTER_AUTH_SECRET/URL/TRUSTED_ORIGINS`; `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `LLM_MODEL`, `LLM_BASE_URL`, `LLM_*_TIMEOUT_MS`, `LLM_MAX_RETRIES`, `LLM_MAX_STEPS`; `GUARD_PROVIDER/MODEL/BASE_URL/FAIL_MODE/TIMEOUT_MS`; `ASK_RATE_LIMIT_PER_MINUTE`; `SEED_ANCHOR`. Scripts load the root `.env` with `tsx --env-file-if-exists`. Tests: `vitest.shared.ts` maps `TEST_DATABASE_URL*` → `DATABASE_URL*`, pins `SEED_ANCHOR=2026-10-28T00:00:00Z`, blanks `CF_*`.

Ports: API 3001, web 5173, Postgres 5433 (host) → 5432.

## File ownership

| Owner | Paths |
|---|---|
| architect | root config (`package.json`, `pnpm-workspace.yaml`, `tsconfig*.json`, `biome.json`, `vitest.config.ts`, `vitest.shared.ts`, `.env.example`, `.gitignore`, `.nvmrc`, `.github/**`), `docker-compose.yml`, `docker/**`, `packages/shared/**`, `docs/**`, `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, `scripts/repo-map.ts` |
| db-builder | `packages/db/**` |
| api-builder | `apps/api/src/{app.ts,index.ts,auth,middleware,routes,repo,lib}/**`, `apps/api/test/**`, `apps/api/{package.json,tsconfig.json,vitest.config.ts}` |
| ai-builder | `apps/api/src/{llm,tools,orchestrator,guard,audit}/**`, `apps/api/scripts/smoke-live.ts`, `evals/**` |
| web-builder | `apps/web/**` |
| reviewer | `docs/review-log.md` only |

Dependency additions to another owner's `package.json` go through that owner (ask in TASKS.md). Contract changes: file a task to architect.

## Phase gates

0. Architect: `pnpm install && pnpm typecheck && pnpm lint && pnpm test` green; `docker compose config` valid. **Done.**
1. Builders in parallel (TASKS.md T-101..T-104). Each done when own tests pass and `pnpm typecheck && pnpm lint` stay green.
2. Reviewer audits (`docs/review-log.md`), files fix tasks; builders fix; reviewer re-verifies.
3. Architect: README, ARCHITECTURE, REQUIREMENTS, ADRs, AGENTS.md hierarchy, REPO_MAP.

Final gate: `pnpm db:up && pnpm db:reset && pnpm typecheck && pnpm lint && pnpm test` from a clean clone, no LLM network access.
