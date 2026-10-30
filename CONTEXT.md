# CONTEXT: ubiquitous language

DemoLedger answers finance-operations questions about one tenant's wallet transactions, read-only. Each term below has one meaning in code, tests and docs. The `code` name after a term is the identifier to search for.

## Tenancy

**Tenant**:
One customer organization whose data is isolated from every other. Seeded as `tenant_alpha` and `tenant_beta`; in code `tenantId`, always taken from the validated session.
_Avoid_: customer, account, client, org ID from input

**Organization**:
The auth record that *is* the tenant: `organization.id` is the tenant ID. Use "tenant" for isolation, "organization" for the auth record.
_Avoid_: company, workspace

**Member**:
A user's membership in one organization. No membership means no tenant context (403); it is re-checked on every request.
_Avoid_: role assignment, seat

**Tenant context**:
The tenant and user that `requireTenant` establishes for one request (`c.get('tenant')`): session, then active organization, then membership re-check.
_Avoid_: current org, scope

**RLS context**:
The transaction-local Postgres settings `app.tenant_id` (and `app.user_id` for conversations) that row-level security filters on, set by `withTenant` / `withTenantUser`. Unset means zero rows.
_Avoid_: session variable, DB session

## Ledger

**Wallet**:
A tenant's single-currency account, such as `WALLET-A-001` (EUR).
_Avoid_: account, balance

**Transaction**:
One ledger movement, such as `TXN-A-0001`. The assistant reads transactions and never creates or changes them.
_Avoid_: payment, transfer (those are write requests)

**Minor units**:
An integer amount in the currency's smallest unit (`amount_minor`). Sums are base-10 strings, always one per currency; never floats, never added across currencies.
_Avoid_: cents, decimal amount

**Direction**:
`incoming` (money into the wallet) or `outgoing` (money out).
_Avoid_: credit / debit, in / out

**Status**:
`completed`, `pending` or `failed`.
_Avoid_: state, outcome

**Failure reason**:
Why a `failed` transaction failed (`failure_reason`). `null` means **not recorded**: the assistant says so and never guesses.
_Avoid_: error, cause, unknown

**Period**:
A relative UTC date window resolved on the server: `today`, `yesterday`, `this_week` (ISO week from Monday), `last_7_days`, `last_30_days`. Ranges are half-open.
_Avoid_: date range (that is `from` / `to`), local day

**Seed anchor**:
The instant the 100 seed transactions are offset from (`SEED_ANCHOR`; default the start of today, UTC; tests pin `2026-10-28T00:00:00Z`).

## Assistant

**Data tool**:
A tool the model may call that reads transactions for the tenant bound in its closure: `search_transactions`, `aggregate_transactions`.
_Avoid_: function, plugin, action

**Presentational tool**:
A tool with no database access that re-shapes this request's earlier tool results: `present_visual`.

**Tool args**:
The JSON the model proposes for a tool. Strict schemas: an unknown key (such as `tenant_id`) is a validation error, audited, and no query runs.

**Server facts**:
The trusted `[server facts]` line with each tool result (`returned`, `total_matching`, `truncated`), outside the untrusted block. The model quotes counts from it and never counts rows itself.
_Avoid_: metadata, summary

**Untrusted data block**:
The `<untrusted_tool_data …>` wrapper around tool output sent to the model; its content is data, never instructions. Stored prior answers get the same treatment (`<untrusted_prior_answer>`).

**Visual**:
A bar chart, line chart, table or stat that the model *chooses* with `present_visual`; the server binds it to this request's SQL results. The model never authors the numbers.
_Avoid_: chart JSON, generated UI

**Visual spec**:
The json-render document for a visual, validated against the shared `visualSpec` and rendered only from the fixed catalog (BarChart, LineChart, Table, Stat). Streamed as a `data-visual` part.

**Conversation**:
A chat thread with a client-generated UUID, owned by one user and tenant. The server stores its answered question/answer pairs and replays the last 3; client-sent history is never trusted. "New conversation" starts a fresh one.
_Avoid_: session, chat history (the browser's copy)

**Step**:
One model call in the tool loop, at most `LLM_MAX_STEPS` (5); the last step has no tools.
_Avoid_: turn (a turn is one user question)

## Safety and evidence

**Guard**:
The prompt-injection and write-intent check that runs before the model: `heuristic`, `clef` or `none` (tests only). Defense in depth, never the security boundary.
_Avoid_: filter, firewall, moderation

**Guard verdict**:
`allow`, `flag` (allowed, marked in the audit), `block` (fixed refusal, the model is never called) or `unavailable` (guard error or timeout; `GUARD_FAIL_MODE` decides).

**Fail open / fail closed**:
What an `unavailable` verdict does: `open` (default) proceeds, `closed` refuses.

**Grounded citation**:
A transaction ID in the answer that this request's tool calls returned. Any other `TXN-…` ID is **ungrounded**: audited in `ungrounded_ids` and shown as an "unverified citation" warning.
_Avoid_: hallucinated ID (say ungrounded)

**Answer checks**:
The four deterministic checks after an answer: citation grounding, counts, facts (failure reasons) and speculation. They raise warnings and never edit the answer.
_Avoid_: validation, guardrails

**Audit**:
The append-only record of every `/api/ask`: one `ai_requests` row and one `ai_tool_calls` row per proposed tool call.
_Avoid_: log (logs are the JSON request lines)

**Request ID**:
A server-generated UUID per request, returned in `X-Request-Id` and stored in logs, audit rows and error envelopes.

## Platform

**Neuron**:
The Workers AI usage unit. The free allowance is 10,000 per day; when it is spent, requests end as `quota_exhausted` until 00:00 UTC. About 43 per question on the default model.
_Avoid_: credit, token (tokens are what the model counts)

**Reader role / app role**:
The two database roles the API uses: `ledger_reader` (SELECT on `transactions` only) and `ledger_app` (auth tables, append-only audit, conversations). The owner role runs only migrations and the seed.
_Avoid_: admin, service account
