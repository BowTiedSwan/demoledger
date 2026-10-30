# CONTEXT: glossary

Terms used in code, tests and docs, with one meaning each.

| Term | Meaning |
|---|---|
| **Tenant** | One customer organization whose data must stay isolated. Seeded as `tenant_alpha` and `tenant_beta`. In code, `tenantId` always comes from the validated session; it never comes from input. |
| **Organization** | Better Auth's organization record. Organization = tenant (`organization.id` is the tenant ID; `transactions.tenant_id` is a foreign key to it). |
| **Active organization** | `session.activeOrganizationId`, set on sign-in to the user's membership. `requireTenant` re-checks membership on every request. |
| **Member** | A row in `member` linking a user to an organization. No membership means 403. |
| **Wallet** | A tenant's account holding a single currency, for example `WALLET-A-001` (EUR). IDs match `^WALLET-[AB]-\d{3}$`. |
| **Transaction** | One ledger movement, `TXN-A-0001` style (`^TXN-[AB]-\d{4}$`). The assistant reads transactions and never creates or changes them. |
| **Minor units** | Integer amount in the currency's smallest unit (cents, pence): `amount_minor`. Stored as `bigint`, serialized as a safe integer, and sums are base-10 strings. Never floats. |
| **Amount display** | A server-formatted string from minor units and the currency exponent, for example `€1,234.56` (`formatMinorUnits`). |
| **Direction** | `incoming` (money into the wallet) or `outgoing` (money out). |
| **Status** | `completed`, `pending` or `failed`. |
| **Failure reason** | `failure_reason`, only meaningful for `failed`. `null` means "not recorded"; the assistant says so and never guesses. |
| **Period** | A relative date window resolved on the server in UTC: `today`, `yesterday`, `this_week` (ISO week, Monday start), `last_7_days`, `last_30_days`. Ranges are half-open `[from, to)`. |
| **Seed anchor** | The instant the 100 seed transactions are offset from (`SEED_ANCHOR`, default start of the current UTC day; tests pin `2026-10-28T00:00:00Z`). |
| **Tool** | A function the LLM may call. There are two read-only **data tools**, `search_transactions` and `aggregate_transactions`, with the tenant bound in the factory closure. There is one **presentational tool**, `present_visual`, which has no DB access. |
| **Visual (generative UI)** | A chart, table or stat the model *chooses* via `present_visual`. The server binds it to this request's SQL results and streams it as a `data-visual` json-render spec; the web renders it from a fixed catalog. The model never authors the numbers (ADR 0009). |
| **Tool args** | The JSON the model proposes. They are validated against strict zod schemas: an unknown key (for example `tenant_id`) is a validation error, audited with `validated = false`, and no query runs. |
| **Untrusted data block** | `<untrusted_tool_data …>` wrapper around tool output sent to the model; its content is data, never instructions. |
| **Guard** | The prompt-injection / write-intent check that runs before the LLM: `heuristic`, `clef` (Clef-flash System One) or `none` (tests). Defense in depth only. |
| **Guard verdict** | `allow`, `flag` (allowed but marked in the audit), `block` (fixed refusal; the LLM is never called) or `unavailable` (guard error or timeout; `GUARD_FAIL_MODE` decides). |
| **Fail open / fail closed** | `GUARD_FAIL_MODE=open` proceeds when the guard is unavailable (default); `closed` refuses. |
| **Grounded citation** | A transaction ID in the answer that this request's tool calls returned. Any other `TXN-…` ID is **ungrounded**: it is recorded in `ai_requests.ungrounded_ids` and shown as an "unverified citation" warning. |
| **Conversation** | A chat thread identified by a client-generated UUID (`conversationId`) and owned by one user and tenant. The server stores its answered question/answer pairs (`ai_conversations`, `ai_messages`) and replays the last 3 to the model; client-sent history is never trusted. "New conversation" starts a new one. |
| **Step** | One model call in the tool loop. Capped at `LLM_MAX_STEPS` (default 5); the last step has no tools. |
| **Audit** | The append-only `ai_requests` table (one row per `/api/ask`) and `ai_tool_calls` table (one row per proposed tool call). |
| **Request ID** | A per-request UUID, returned in `X-Request-Id`, logged, and stored in the audit rows and error envelopes. |
| **Neurons** | The Workers AI billing unit. The Free plan includes 10,000 per day; when it is used up the request status is `quota_exhausted`. |
