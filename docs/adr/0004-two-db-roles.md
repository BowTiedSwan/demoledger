# ADR 0004: Two least-privilege database roles and two pools

Status: accepted

## Context
Tenant scoping in queries is the primary control. A second, independent control should make the read-only promise (R22) hold even if application code is wrong.

## Decision
`packages/db/src/roles.sql` creates two roles, and the API holds one pool per role:
- `ledger_reader`: SELECT on `transactions` only. It is used by the repository, the REST transaction routes and the AI tools.
- `ledger_app`: DML on the Better Auth tables, and INSERT only on `ai_requests` / `ai_tool_calls`. It has no SELECT, UPDATE or DELETE on the audit tables, and no access to `transactions`.
- The owner role runs migrations, roles and the seed only. PUBLIC `CONNECT`/`TEMP` is revoked on both databases.

Each pool sets `statement_timeout` (`DB_STATEMENT_TIMEOUT_MS`, default 5 s).

## Consequences
- An injected write through the tool path fails at the database (`packages/db/src/roles.test.ts` asserts the errors), and audit rows cannot be altered by the app.
- Audit writers cannot use `INSERT … RETURNING`. Investigation queries run as the owner role.
- Row-level security on `transactions` is **not** implemented. It is the next production step: set `app.tenant_id` per transaction with `set_config(…, true)` and add a policy, so a missing `WHERE tenant_id` would also fail closed.
