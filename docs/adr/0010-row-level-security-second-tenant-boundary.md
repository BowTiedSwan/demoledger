# ADR 0010: Row-level security as a second tenant boundary

Status: accepted, 2026-10-30 (D-28, user request). It extends ADR 0004 (two DB roles). The conversation-store integration (T-252, OWASP-06) has landed.

## Context
Tenant isolation rested on application code (ADR 0004):
- every repository query binds `tenant_id = $1`;
- the read-only role limits damage.

Both layers depend on the code being correct. One query that forgets its WHERE clause would return every tenant's rows. The brief named Postgres row-level security as the stretch goal and the next production step.

## Decision
- **Policies live in `packages/db/src/roles.sql`**, not in drizzle migrations: drizzle's `pgPolicy` cannot express `FORCE`, and the policies name roles that `roles.sql` creates after migrating.
  - `transactions`: `ENABLE` + `FORCE ROW LEVEL SECURITY`. Policy `tenant_isolation` FOR SELECT TO `ledger_reader` USING `tenant_id = current_setting('app.tenant_id', true)`.
  - `ai_conversations` / `ai_messages`: `ENABLE` + `FORCE`. Policies for SELECT and INSERT TO `ledger_app` require `tenant_id = app.tenant_id AND user_id = app.user_id`; INSERT is enforced with `WITH CHECK`.
- **Fail closed:** an unset or empty `app.tenant_id` / `app.user_id` matches no rows.
- **Transaction-local context:**
  - The repository runs every query inside `withTenant(db, tenantId, fn)` (`apps/api/src/repo/with-tenant.ts`). That opens a transaction and executes `SELECT set_config('app.tenant_id', $1, true)`, parameterised and local to the transaction, so a pooled connection never carries the setting into the next query.
  - The conversation store sets `app.tenant_id` and `app.user_id` the same way. `withTenantUser` in `apps/api/src/conversations/index.ts` wraps `ensure`, `loadHistory` and `appendTurn` in one transaction (T-252).
- **Both layers stay.** The explicit `tenant_id = $1` filters remain, giving two independent layers:
  1. the application's WHERE clauses;
  2. the DB role plus RLS.

  A bug in either one alone does not leak data.
- **No RLS, by design:**
  - **Audit tables** (`ai_requests`, `ai_tool_calls`): `ledger_app` has INSERT only and no SELECT, so there is nothing to filter. Investigation runs as the owner.
  - **Better Auth tables:** Better Auth must read sessions and members across tenants to resolve who the caller is. Isolation there is enforced by `requireTenant` re-checking membership.
- **The owner role bypasses RLS** (superuser and table owner) for migrations, `roles.sql` and the seed. The running API never connects as the owner.

## Evidence
- `packages/db/src/roles.test.ts`, "transactions row-level security (ledger_reader)":
  - "returns no rows without app.tenant_id (fail closed), also when empty";
  - "with tenant_alpha sees only alpha; asking for beta returns 0";
  - "transaction-local setting does not leak to the next query on a reused connection".
- `packages/db/src/roles.test.ts`, "conversation history (ledger_app) › row-level security":
  - "hides another tenant/user rows and returns nothing without context";
  - "rejects inserts for another tenant or another user (WITH CHECK)".
- **External review.** `OWASP_ANALYSIS.md` (OWASP-06) found the conversation policies enabled before the conversation store set `app.user_id`. Valid `/api/ask` requests failed with 500, which means the store failed closed, as designed. The fix is T-252.

## Consequences
- **A tenant leak needs two independent bugs:** one in the application WHERE clause, and one in the policy or the session context.
- **Every repository and conversation query costs a short transaction** plus one `set_config`. That is negligible at this scale.
- **New tenant tables need RLS.** A new tenant-scoped table needs an RLS policy in `roles.sql` and a fail-closed test. Code that queries those tables must run inside `withTenant`, or the conversation helper. The rules are in `apps/api/AGENTS.md` and `packages/db/AGENTS.md`.
- **Production:** keep the app roles non-owner and without `BYPASSRLS`, and verify `current_user` at deploy time (OWASP_RESPONSE, deployment check 2).
