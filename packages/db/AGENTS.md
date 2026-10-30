# packages/db: scoped rules

Drizzle ORM + drizzle-kit on PostgreSQL 17, `pg` pools. The root `AGENTS.md` applies too.

- Change the schema in `src/schema/`, then run `pnpm --filter @demoledger/db db:generate`. Never hand-edit files in `src/migrations/`; schema changes need architect approval in `docs/TASKS.md`.
- Every new tenant-scoped table needs an RLS policy (`ENABLE` + `FORCE`, keyed on `current_setting('app.tenant_id', true)`) in `src/roles.sql`, plus a fail-closed test in `src/roles.test.ts`. Repository code queries it only inside `withTenant` (ADR 0010).
- `src/roles.sql` is the privilege model: `ledger_reader` has SELECT on `transactions` only; `ledger_app` has the Better Auth tables, INSERT-only on `ai_requests` / `ai_tool_calls`, and SELECT + INSERT on `ai_conversations` / `ai_messages`; PUBLIC has no CONNECT/TEMP. `REPO_MAP.md` renders the current grants and RLS per table. Every grant change needs a matching assertion in `src/roles.test.ts`, which must assert the DB error.
- The seed is the pure, deterministic `generateTransactions(anchor)` (`src/seed/generate.ts`). Tests compute expected values from it, so a change to it must keep every rule in `src/seed/generate.test.ts` green, including the injection fixtures `TXN-A-0036` / `TXN-B-0037`.
- The anchor is `SEED_ANCHOR`, or the start of the current UTC day; tests pin `2026-10-28T00:00:00Z`.
- `pnpm db:reset` drops the `public` schema and refuses any database other than `demoledger` / `demoledger_test`. The target comes from `DATABASE_URL` (owner role).
- Seed users are created through Better Auth `signUpEmail` (`src/seed/auth.ts`), so the password hashing matches the API. Credentials are test-only and live in `src/seed/constants.ts`.
- `src/testing/global-setup.ts` resets `demoledger_test` once per vitest run under an advisory lock; tests must not delete or modify seed rows.
