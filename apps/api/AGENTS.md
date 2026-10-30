# apps/api: scoped rules

Hono on Node (`@hono/node-server`), Better Auth, AI SDK v7. The root `AGENTS.md` applies too.

- Every function in `src/repo/` takes `tenantId` first and puts `tenant_id = ${tenantId}` in every WHERE clause. REST routes and AI tools call the same functions, so there is one enforcement point. Do not add a second query path.
- Routes behind `requireTenant` read the tenant only from `c.get('tenant')`. `TransactionFilter` has no tenant field; keep it that way.
- Keep routes chained in `createApp` (`src/app.ts`), so `AppType` stays inferable for the web `hc` client. Response bodies use the types in `@demoledger/shared`.
- Nothing under `createApp` reads `process.env`. Config is parsed once in `src/lib/config.ts`; production wiring is in `src/index.ts` and `src/lib/ai-wiring.ts`.
- Use `deps.db.reader` for transactions and `deps.db.app` for auth and audit. Audit writers must not use `.returning()`: `ledger_app` has INSERT but no SELECT on `ai_requests` / `ai_tool_calls`.
- Tools (`src/tools/`) validate raw model args inside `execute` with the strict shared schemas. They return `ToolErrorResult` without querying, and audit `raw_args` verbatim. Tool output reaches the model only through the `<untrusted_tool_data>` wrapper (`src/tools/untrusted.ts`).
- AI SDK v7 names: `instructions`, `onStepEnd`, `onEnd`, `isStepCount`, `result.stream`, `createUIMessageStreamResponse`. Mock with `MockLanguageModelV4` from `ai/test`. `createLlm` throws under test by design.
- Conversation history is server-stored (ADR 0008, D-24). The model gets the last 3 stored answered pairs from `src/conversations/` plus the latest user question; client-sent history is never forwarded. Store a pair only for `ok`/`no_results`. The guard judges only the latest question.
- `/api/ask` always answers 200 with a UI message stream. Failures are `data-error` / `data-guard` parts and each one writes an audit row; do not short-circuit before `handleAsk`.
- The effective tool/query timeout is the pool's `statement_timeout` (`DB_STATEMENT_TIMEOUT_MS`). Model steps use idle timeouts (`firstChunkMs`/`chunkMs`); `LLM_REQUEST_TIMEOUT_MS` is the only wall-clock bound, so never add a wall-clock step cap.
- Cross-cutting HTTP tests live in `test/` and use `test/helpers.ts`; they run against `demoledger_test` with the shared seed, which is read-only.
