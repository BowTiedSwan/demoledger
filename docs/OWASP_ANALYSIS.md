# OWASP security analysis

**Assessment date:** 2026-10-30  
**Baseline:** commit `596b3508c0bf37bc241f35be40efedd2a1a3f29c`, **plus the existing uncommitted working-tree changes** described below.  
**Framework:** OWASP Top 10:2025, supplemented by OWASP API Security Top 10:2023 and LLM Top 10:2025 where relevant.  
**Disposition:** findings only; no application, dependency, database-policy, or configuration fixes applied by this review.

## Executive summary

The application has substantial controls against its primary threat: a user or injected model output crossing tenant boundaries. Tenant identity is resolved from a validated session and rechecked membership; REST and AI tools share parameterized repositories; tool inputs reject tenant overrides; database grants constrain writes; model output has hardened rendering.

Eight findings remain: **one High, six Medium, and one Low**. These are contextual risk ratings, not eight demonstrated remote exploits. Deployment prerequisites and validation status are stated individually.

The highest-impact configuration finding is PostgreSQL published on all host interfaces with a public default superuser password. Two authentication behaviors were reproduced locally: caller-controlled forwarding headers select fresh login-throttle buckets, and unsigned bearer tokens survive auth-secret rotation. The working-tree RLS changes also currently break the real conversation store, causing valid assistant requests to return 500.

| ID | Severity | Finding | Evidence status |
|---|---|---|---|
| OWASP-01 | High, conditional | Published PostgreSQL port and public default owner credential | Confirmed configuration; external reachability not tested |
| OWASP-02 | Medium | Login throttling trusts caller-controlled forwarding headers | Reproduced with production auth settings, in process |
| OWASP-03 | Medium | Auth-secret rotation does not revoke unsigned bearer sessions | Reproduced against the isolated test database |
| OWASP-04 | Medium | Resource controls do not cover the complete API surface | Static review plus a bounded oversized-auth-body probe |
| OWASP-05 | Medium | Security-event auditing has coverage and delivery gaps | Confirmed control flow; no disk-failure simulation |
| OWASP-06 | Medium | Working-tree conversation RLS lacks matching session context | Three existing tests fail; valid `/api/ask` returns 500 |
| OWASP-07 | Low | Sensitive REST responses lack an explicit no-store policy | Reproduced on three authenticated endpoints |
| OWASP-08 | Medium, conditional | Vulnerable transitive esbuild version remains in the lockfile | Registry advisory confirmed; vulnerable serve feature not shown reachable |

## Scope, method, and limitations

Reviewed the Hono API, Better Auth configuration and relevant installed-library behavior, tenant middleware, transaction repositories, database grants/RLS, conversation storage, audit pipeline, AI tool execution, guard/error paths, shared validation schemas, React rendering, SPA CSP, Compose, package manifests/lockfile, CI, and existing security tests. Reviewed the eval fixtures and documented guard limitations through their tests and architecture documentation; no new live-model evaluation was performed.

Validation consisted of source tracing, the existing typecheck/lint/test gate, full and production-filtered `pnpm audit --json`, and small in-process probes. The installed Better Auth version inspected was **1.7.14**. Dependency inspection matters here: defaults cannot safely be inferred just from the app's short auth configuration.

At the start of review, these files already differed from HEAD:

- `apps/api/src/repo/transactions.ts`
- `apps/api/test/repo.transactions.test.ts`
- `docs/TASKS.md`
- `packages/db/src/roles.sql`
- `packages/db/src/roles.test.ts`
- Untracked `apps/api/src/repo/with-tenant.ts`

These changes were preserved and included in the assessment. **OWASP-06 is specifically a finding in this uncommitted snapshot, not a claim about clean HEAD.** Line references refer to the reviewed snapshot. `docs/ARCHITECTURE.md:72` still says RLS is unimplemented, so source and executed tests take precedence over that statement.

Tests reset/seed **`demoledger_test`**, as the repository's normal test setup requires. Additional DB-backed probes used only that database and created test sessions. No development database reset, production probing, destructive attack, sustained load test, real provider call, or application remediation was performed. The private `.env` was not printed or incorporated into the report; the existing test environment loader supplies test configuration internally. The tracked env-file check returned only `.env.example`. This was not a full Git-history secret scan.

No deployed reverse proxy, firewall, TLS termination, backups, secret manager, alerting service, or production database was available for review. Those controls may mitigate conditional findings. Browser exploitation, account takeover, database exfiltration, and service exhaustion were not attempted. A passing test or clean advisory result would not establish absence of vulnerabilities.

## Findings

### OWASP-01 — Published PostgreSQL port with a public default owner credential

**Severity:** High when the published port is reachable by an untrusted client and defaults remain in use.  
**Mapping:** A02:2025 Security Misconfiguration; A07:2025 Authentication Failures; CWE-1392 / CWE-668.

**Evidence**

- `docker-compose.yml:5-11` uses `postgres:17`, supplies public defaults for `POSTGRES_USER`/`POSTGRES_PASSWORD`, and publishes `5433:5432` without a loopback host address.
- The official Postgres image initializes the named `POSTGRES_USER` as a superuser. `packages/db/src/roles.sql:57` also explicitly documents that the Compose owner is a superuser and bypasses RLS.
- `packages/db/src/env.ts:32-33` similarly falls back to public development passwords for the two application roles.

**Attack prerequisites and impact**

On a host whose Docker-published port is externally reachable, an attacker can try the publicly documented default owner credential. Successful access bypasses the application's tenant checks, read-only roles, RLS, and append-only audit restrictions, allowing reads and changes across tenants. This is a database exposure, not a flaw in repository predicates. A host firewall or changed password can block this scenario; neither the live password nor external reachability was tested.

**Validation:** Static confirmation of the published bind and default credential. No network login or password guessing against the running development database.

**Recommended follow-up:** Bind local development Postgres to loopback; use a private database network in deployment; require unique managed credentials rather than development fallbacks outside local/test use. Verify reachability from outside the host and check role privileges during deployment acceptance.

### OWASP-02 — Login throttling can be bypassed with forwarding-header changes

**Severity:** Medium.  
**Mapping:** A07:2025 Authentication Failures; API2:2023 Broken Authentication; CWE-307 / CWE-807.

**Evidence**

- `apps/api/src/auth/index.ts:26-49` does not configure trusted proxy/IP handling or an account-based login limiter.
- `apps/api/src/index.ts:29` passes the incoming request to the app without an application-level normalization of client IP headers.
- In installed Better Auth 1.7.14, `@better-auth/core/dist/utils/ip.mjs:174-218` defaults to `x-forwarded-for` and accepts a single syntactically valid address when no trusted proxies are configured.
- `better-auth/dist/api/rate-limiter/index.mjs:237-253,292-318` keys throttling by that resolved IP plus path; the sign-in rule is three requests per ten seconds.

**Reproduction result**

An isolated auth instance used `NODE_ENV=production`, the repository's `createAuth`, and an unused DB URL. Invalid-email inputs failed schema validation before requiring a DB connection:

| Request | Caller-supplied `X-Forwarded-For` | HTTP status |
|---|---|---|
| 1 | `192.0.2.1` | 400 |
| 2 | `192.0.2.1` | 400 |
| 3 | `192.0.2.1` | 400 |
| 4 | `192.0.2.1` | 429 |
| 5 | `192.0.2.2` | 400 |

The fifth request bypasses the exhausted bucket. The addresses are documentation-only values; no requests were sent to those addresses. This proves limiter-key manipulation, not successful credential guessing.

**Attack prerequisites and impact**

An unauthenticated client that can reach the API directly, or whose header is preserved unchanged by a proxy, can continually obtain fresh buckets. This undermines brute-force and credential-stuffing resistance and allows additional password-verification work. A properly configured ingress that overwrites the header and prevents direct API access can mitigate the issue.

Also, `better-auth/dist/context/create-context.mjs:170-175` enables the built-in limiter only in production by default. The app's `start` script (`apps/api/package.json:10`) does not itself set `NODE_ENV`, so deployments must explicitly supply it. The `/api/ask` per-user limiter does not protect sign-in.

**Recommended follow-up:** Establish and test a trusted client-IP boundary at ingress and API deployment; restrict direct access; add account-aware throttling and shared rate-limit state as appropriate. Acceptance tests should verify that spoofing forwarding headers cannot reset a login bucket.

### OWASP-03 — Unsigned bearer sessions survive auth-secret rotation

**Severity:** Medium.  
**Mapping:** A07:2025 Authentication Failures; CWE-613.

**Evidence**

- `apps/api/src/auth/index.ts:34` enables `bearer()` without `requireSignature`.
- Installed `better-auth/dist/plugins/bearer/index.mjs:31-47` accepts a token without a dot and signs it server-side with the current secret before session lookup, unless `requireSignature` is enabled.
- `packages/db/src/schema/auth.ts:19-35` stores the session token; rotating the signing secret does not delete the session row.
- `docs/ARCHITECTURE.md:65,182` says secret rotation invalidates sessions. Line 182 also advises deleting session rows to revoke bearer tokens; that deletion is essential for the unsigned-token path, not optional cleanup.

**Reproduction result**

Signed in to a seeded test account, constructed a second auth instance against the same **test** DB with a different secret, and checked both forms of the same session:

```text
secretRotated=true tokenKind=signed   authenticated=false
secretRotated=true tokenKind=unsigned authenticated=true
```

The unsigned form was the token portion before the signature separator, using the repository's `sessionTokenOf` helper. Token values were not printed.

**Attack prerequisites and impact**

An attacker who already possesses a valid session token can preserve access through an auth-secret rotation by presenting its unsigned form, until expiry or explicit session revocation. This is not an initial authentication bypass and does not mean guessed tokens are accepted. It invalidates the documented assumption that rotating the secret alone terminates all sessions.

**Recommended follow-up:** Make the revocation procedure explicit and test it end-to-end. Require signed bearer tokens if compatible with intended clients, and/or revoke server-side sessions during incident-driven rotation. A rotation acceptance test should exercise both the full signed token and its raw session-token portion.

### OWASP-04 — Resource limits do not cover the complete API surface

**Severity:** Medium; exhaustion at scale was not demonstrated.  
**Mapping:** A06:2025 Insecure Design; API4:2023 Unrestricted Resource Consumption; LLM10:2025 Unbounded Consumption; CWE-400 / CWE-770.

**Evidence**

- `apps/api/src/app.ts:67-75,113-150`: only `/api/ask` receives the application rate limiter and 64 KiB body limit. Auth requests are forwarded to Better Auth; transaction routes and the public DB-backed health route have no application request-rate limit.
- `apps/api/src/middleware/require-tenant.ts:16-26`: session lookup and membership queries occur before the `/ask` limiter. Even rejected over-limit requests can reach the authentication DB.
- `apps/api/src/middleware/rate-limit.ts:9-25`: fixed-window, per-user, per-process state. No shared global/tenant budget or concurrent-request allowance is implemented.
- `packages/db/src/client.ts:18-24`: pools cap active connections at five by default and set a statement timeout, but do not set a connection acquisition timeout. A statement timeout does not bound time queued waiting for a pool connection.
- `packages/shared/src/filters.ts:77-85,130-140` makes dates optional. `apps/api/src/repo/transactions.ts:188-198` can aggregate all history and has no group-result cap. The 50-row list limit does not cap aggregate cardinality.
- `apps/api/src/conversations/index.ts:50-54` creates conversation records before the model/guard result; stored history and audit tables have no repository-managed retention/quota mechanism.

**Bounded probe**

A **1,048,629-byte** JSON body sent to an isolated production-configured auth handler returned **400 `INVALID_EMAIL`**, rather than 413. This confirms that the app's 64 KiB `/ask` limit does not protect auth parsing. It does not establish that arbitrarily large bodies will be accepted by every deployment or dependency version.

**Attack prerequisites and impact**

Unauthenticated clients can consume health/auth resources; authenticated clients can repeatedly issue ledger queries or accumulate conversations/audit rows. Multiple API instances multiply the in-memory ask allowance. Expensive calls and queued DB work can delay other tenants; a user can also exhaust a shared free AI quota. Existing body, token, step, retry, query, and per-user limits reduce individual-request impact but do not establish service-wide fairness.

**Recommended follow-up:** Define ingress body/request limits for all exposed routes, trusted-IP and authenticated-user throttles, shared per-tenant/provider budgets, bounded concurrency and queue wait, aggregate cardinality limits, and retention rules. Validate under representative data volume and multiple instances. Changes to existing caps require the repository's normal approval process.

### OWASP-05 — Security-event audit coverage and delivery are incomplete

**Severity:** Medium.  
**Mapping:** A09:2025 Security Logging and Alerting Failures; A10:2025 Mishandling of Exceptional Conditions; CWE-778.

**Evidence**

- `apps/api/src/app.ts:67-73,136-159`: authentication, membership, origin, rate, body-size, and schema failures return before `handleAsk` and therefore before its audit sink. In particular, application-level ask 429s are absent from `ai_requests`.
- `apps/api/src/orchestrator/index.ts:114-132`: audit failure for a foreign/unknown conversation is swallowed with `.catch(() => {})`.
- `apps/api/src/orchestrator/index.ts:180-227`: a finish part is written before audit persistence; a failed audit transaction produces an error log but the response is not recalled and no durable retry is scheduled.
- `apps/api/src/audit/index.ts:20-24`: request and tool rows are persisted together at completion. A process failure during inference can lose the complete audit record for the request.
- `apps/api/src/middleware/logging.ts:11-20`: HTTP logs retain status, timing, and a server-generated request ID, but use the matched route pattern. Auth calls go through `/api/auth/*` without `requireTenant`, so these entries have null user/tenant identifiers and no distinct login/logout/change-password event field.

**Impact and qualification**

Abuse or audit-storage failures can leave gaps in the durable trail, particularly for blocked HTTP requests and unfinished inference. The monitoring guidance in `docs/ARCHITECTURE.md:78-89` cannot be implemented solely from `ai_requests` for every application-level rate-limit event. There **are** structured HTTP logs, and most audit-write failures are logged; this finding does not claim all evidence disappears or that the attacker can edit existing audit rows. No external log shipping, alerts, or durable retry service was verified.

**Recommended follow-up:** Define which security events must be durable, include normalized auth outcomes and HTTP-layer refusals without storing credentials, record request admission/completion or use a durable delivery strategy, and alert on audit-write failures. Test both ordinary refusal paths and audit-store failure behavior. Keep the existing append-only grants.

### OWASP-06 — Conversation RLS is enabled without matching connection context

**Severity:** Medium; an assistant-release blocker in the reviewed working tree.  
**Mapping:** A02:2025 Security Misconfiguration; A10:2025 Mishandling of Exceptional Conditions.

**Evidence**

- Existing uncommitted `packages/db/src/roles.sql:69-85` enables and forces RLS on `ai_conversations` and `ai_messages`. Policies require both `app.tenant_id` and `app.user_id`.
- `apps/api/src/conversations/index.ts:48-98` issues inserts/selects directly on `db`, without setting either transaction-local variable.
- The new `apps/api/src/repo/with-tenant.ts:14-22` sets only `app.tenant_id` and is used for ledger queries, not conversation storage.
- `apps/api/src/orchestrator/index.ts:113-116` rethrows the resulting database exception before the stream begins; `apps/api/src/app.ts:163-178` converts it to a generic 500.

**Reproduction result**

The normal gate produced **409 passing tests and three failures**, all in `apps/api/src/conversations/db.test.ts`. Each failure was PostgreSQL SQLSTATE **42501**, `new row violates row-level security policy for table "ai_conversations"`.

A subsequent request using a valid seeded test session, fresh conversation UUID, trusted origin, and valid question returned:

```text
POST /api/ask → 500
error.code = internal_error
```

No LLM was configured or called by that probe. The failure occurs at conversation initialization.

**Impact and qualification**

Applying the current roles script prevents the assistant from initializing conversations, and history/appends also lack required context. This is an availability/integration failure in a security control, **not a tenant-isolation bypass**: the database fails closed. A database where those new policies have not been applied may still work, which makes deployment order relevant.

**Recommended follow-up:** Complete conversation-store integration with tenant and user context on the same transaction/connection as each protected operation. Preserve fail-closed RLS and ownership semantics. Re-run the failing DB tests and a full HTTP assistant path as `ledger_app`; separately verify no pooled-connection context leakage. No fix was made in this assessment.

### OWASP-07 — Sensitive REST responses omit explicit cache restrictions

**Severity:** Low.  
**Mapping:** A04:2025 Cryptographic Failures (sensitive-data exposure); CWE-525.

**Evidence and reproduction**

Authenticated cookie requests against the test app returned:

| Endpoint | Status | `Cache-Control` | `Vary` |
|---|---|---|---|
| `/api/me` | 200 | absent | absent |
| `/api/transactions?limit=1` | 200 | absent | absent |
| `/api/transactions/aggregate?metric=count` | 200 | absent | absent |

These responses are created in `apps/api/src/app.ts:94-134`. `secureHeaders()` does not establish a sensitive-response caching policy.

**Attack prerequisites and impact**

Browsers and intermediaries are not explicitly told to avoid storing tenant data. A cookie-authenticated response is not protected by the HTTP rules specific to an `Authorization` request header. Exposure depends on browser cache behavior or intermediary caching policy; no actual cache hit or cross-user cache replay was demonstrated. Missing `Vary` alone is not proof a compliant shared cache will reuse a response.

**Recommended follow-up:** Set an explicit `Cache-Control: no-store` policy on sensitive API responses and verify the deployed proxy/CDN does not override it. Test cache headers for identity, transaction, aggregate, and error responses; validate cache behavior through the actual ingress.

### OWASP-08 — Known vulnerable esbuild version remains transitively installed

**Severity:** Medium, conditional; registry severity **moderate**, CVSS **5.3**.  
**Mapping:** A03:2025 Software Supply Chain Failures; CWE-346.

**Evidence**

Both `pnpm audit --json` and `pnpm audit --prod --json` reported **GHSA-67mh-4wv8-2f99** for **esbuild 0.18.20**. The reported vulnerable range is `<=0.24.2`; patched versions are `>=0.25.0`.

Reported paths:

```text
Full workspace:
packages/db → drizzle-kit → @esbuild-kit/esm-loader
  → @esbuild-kit/core-utils → esbuild@0.18.20

Production-filtered graph:
apps/api → better-auth → drizzle-kit → @esbuild-kit/esm-loader
  → @esbuild-kit/core-utils → esbuild@0.18.20
```

The package versions are resolved in `pnpm-lock.yaml`. Direct declarations include `packages/db/package.json:21-23` and `apps/api/package.json:25`. Although drizzle-kit is directly declared as a DB development dependency, **the production-filtered audit still reports a path through Better Auth**; it is inaccurate to dismiss this solely as a devDependency.

**Attack prerequisites and impact**

The advisory concerns esbuild's **serve** feature setting permissive CORS, allowing an attacker-controlled website to read files from that server. A vulnerable server must actually be started and a victim must visit malicious content. The reviewed Hono/Vite commands were not shown to start this transitive esbuild serve feature. Therefore this is a confirmed vulnerable-component finding, not a demonstrated production data-exfiltration path.

**Recommended follow-up:** Resolve the transitive version through compatible upstream updates or a tested override, then audit both full and production graphs again. Verify actual runtime/build reachability and ensure no vulnerable serve instance is exposed. No dependency or lockfile was changed.

## OWASP Top 10:2025 coverage

| Category | Assessment |
|---|---|
| **A01 — Broken Access Control** | Session membership is rechecked; both data tools close over server-selected tenant identity; strict query/tool schemas reject overrides; REST/repository isolation tests pass. Transaction RLS is present in the dirty snapshot. No cross-tenant read was reproduced. Conversation RLS integration failure is OWASP-06. RLS based on an app-set variable is defense against omitted predicates, not protection from a fully compromised API process that can choose those variables. |
| **A02 — Security Misconfiguration** | OWASP-01 and OWASP-06. Additional deployment verification: TLS, cookie security, SPA response headers, and runtime DB role assertions. |
| **A03 — Software Supply Chain Failures** | OWASP-08. CI uses a frozen lockfile and read-only GitHub permissions. Actions use version tags rather than commit SHAs; no dependency-audit job is present in the checked workflow. These are hardening observations, not evidence of compromised builds. |
| **A04 — Cryptographic Failures** | OWASP-07. Password hashing is delegated to Better Auth; session tokens use its signing mechanism. The app rejects its public placeholder auth secret. HTTPS and DB TLS depend on deployment/URL configuration and were not verified. |
| **A05 — Injection** | Transaction values are bound through Drizzle SQL parameters; sort/group expressions are fixed maps. Role-password substitution uses `pg.escapeLiteral`. No LLM-generated SQL execution path was found. React/Streamdown sanitization and visual-schema restrictions reduce output injection. No SQLi or XSS was reproduced. |
| **A06 — Insecure Design** | OWASP-04. Read-only ledger tools and separation of data selection from visualization are strong design choices. Cross-tenant workload fairness and storage retention remain incomplete. |
| **A07 — Authentication Failures** | OWASP-02 and OWASP-03. Anonymous access, bad passwords, tampered tokens, disabled sign-up, and invalid active organizations have existing test coverage. No MFA/SSO is implemented; documented as a production prerequisite rather than counted as a demo vulnerability. |
| **A08 — Software or Data Integrity Failures** | Client-provided history is excluded from model input; only server-stored answered turns are replayed. Tools revalidate model input. Visuals bind server-returned data rather than model-authored numbers. No unsafe deserialization or model-controlled executable action was found in reviewed paths. Artifact provenance remains deployment-dependent. |
| **A09 — Security Logging and Alerting Failures** | OWASP-05. Positive controls: server-generated request IDs, structured logs, INSERT-only audit grants, and recorded invalid tool proposals. Alert implementation was not available to verify. |
| **A10 — Mishandling of Exceptional Conditions** | OWASP-05 and OWASP-06. User-facing exception text is generally generic; provider errors are classified; guard failures fall back to heuristics. The fail-open guard setting is an explicit accepted ADR and is not treated as an access-control bypass. |

## AI-specific observations

- **Prompt injection (LLM01):** the guard is defense in depth, not an authorization boundary. Untrusted tool text and stored answers are delimited; no prompt technique guarantees immunity. The enforced blast radius is the caller's read-only ledger access. Existing guard/eval results are not a guarantee against new prompts.
- **Sensitive information disclosure (LLM02):** prompts, selected transaction descriptions/results, and short stored history are sent to configured external model services. This is intentional functionality. Real-data use needs a provider/data-retention decision. `LLM_BASE_URL` and `GUARD_BASE_URL` are trusted server configuration, not user/model arguments; they are not a demonstrated user-triggered SSRF path.
- **Improper output handling (LLM05):** Streamdown sanitizes markup, removes images, and permits only same-origin path links (`apps/web/src/components/ai-elements/message.tsx:39-76`). Visual blocks validate the fixed catalog (`packages/shared/src/visual.ts:25-100`; `apps/web/src/components/visual/visual-block.tsx:5-19`). Sources are built from IDs, not model-supplied destinations.
- **Excessive agency (LLM06):** there are two read-only data tools and one presentation-only tool. No payment/write/SQL/shell/network-fetch tool is registered.
- **Misinformation (LLM09):** output is streamed before deterministic grounding/fact checks finish (`apps/api/src/orchestrator/index.ts:395-419,438-514`). Warnings do not retract earlier text. Flagged answers are excluded from reusable history, and the interface warns the user, but these checks are not a pre-release accuracy guarantee. This is a documented design limitation, not a newly demonstrated exploit.
- **Consumption (LLM10):** per-request steps, tokens, retries, and timeouts exist; shared budget/fairness gaps are covered by OWASP-04. Live quota exhaustion was not induced during this assessment.

## Additional deployment checks, not counted as confirmed vulnerabilities

1. **SPA framing protection:** `apps/web/csp.ts:10-41` emits a meta CSP without `frame-ancestors`; meta delivery cannot enforce that directive. Hono's response headers protect API responses, not independently served SPA HTML. Verify production HTML receives `frame-ancestors` and/or `X-Frame-Options`. No browser clickjacking demonstration was performed.
2. **HTTPS and secrets:** `apps/api/src/lib/config.ts:19-30,34,45` permits nonempty URL strings without enforcing production HTTPS or a particular DB role. Verify secure cookies, trusted origins, DB transport security, and actual `current_user`/role attributes at deployment. No owner-role runtime connection was observed in the intended configuration.
3. **Public demo accounts:** passwords are intentionally included in the login UI and seed (`apps/web/src/routes/login.tsx:10-14`; `packages/db/src/seed/constants.ts:43-58`). This is appropriate only for fictional, expendable demo data. An externally accessible demo also exposes shared AI quota and mutable auth-account endpoints to those users.
4. **Auth endpoint surface:** `apps/api/src/app.ts:71-73` blocks organization routes but forwards all other auth GET/POST paths. Installed Better Auth includes authenticated profile/password/session-management endpoints in addition to sign-in/out/get-session. They were not found to allow arbitrary-user modification, but the exposed set should match the intended shared-demo behavior. No password/profile mutation was attempted.
5. **Residual client state:** chat lives in module memory and is reset by this tab's sign-in/out handlers. Cross-tab account changes and already-rendered pages after server-side revocation were not browser-tested; include them in session-lifecycle QA.
6. **Audit/conversation privacy:** full question text, raw proposed arguments, and completed answers are stored. Retention, backups, and operator access should be documented before real-data use. Storage growth is also part of OWASP-04.

## Validation record

Environment: **Node 24.22.2**, **pnpm 10.32.1**. The initial shell default was Node 22; checks used `/opt/homebrew/opt/node@24/bin` first on `PATH`.

| Check | Result |
|---|---|
| `pnpm typecheck` | Passed across all workspace projects |
| `pnpm lint` | Passed; no fixes applied |
| `pnpm test` | **409 passed / 3 failed**, 29 passing files / 1 failing file; OWASP-06 |
| `pnpm audit --json` | One moderate advisory, zero reported high/critical advisories |
| `pnpm audit --prod --json` | Same advisory, with a production-filtered path through Better Auth |
| Production auth limiter probe | Same forwarded IP: 400, 400, 400, 429; changed forwarded IP: 400 |
| Auth-secret rotation probe | Old signed bearer rejected; raw session token accepted |
| Oversized auth request probe | 1,048,629 bytes parsed to email-validation failure, HTTP 400 |
| Sensitive REST header probe | Three 200 responses without `Cache-Control`/`Vary` |
| Valid assistant request using DB-backed conversation store | HTTP 500 before model invocation |
| `pnpm repo-map` / `pnpm repo-map --check` | Generated documentation map refreshed; drift check passed |
| `git diff --check` | Passed |

The database was already available locally; the test harness reset only `demoledger_test`. The suite uses injected/mock providers and blanks provider credentials. In-process auth limiter/body probes used an unused DB URL and invalid email input, so they did not authenticate users or require a database connection. Registry advisory lookups contacted the package registry. No exploit against a running production service was performed.

### Reproduction guidance

These steps describe validation, not fixes. Use the isolated test setup and its test-only credentials; do not run against production.

- **Conversation RLS:** run `pnpm exec vitest run --project api apps/api/src/conversations/db.test.ts` against the reviewed snapshot. The standard global setup applies current roles. Expect the three 42501 failures described above. The full gate is `pnpm typecheck && pnpm lint && pnpm test`.
- **Login limiter:** construct `createAuth` in a fresh process with `NODE_ENV=production`, a dummy secret/base URL, and an unused DB connection. POST invalid-email JSON four times to `/api/auth/sign-in/email` with one `X-Forwarded-For`, then once with another. Observe `[400, 400, 400, 429, 400]` within ten seconds. Use the configured trusted Origin.
- **Secret rotation:** use `testEnv()` and `makeContext()` from the existing test helpers, assert the DB URLs end in `/demoledger_test`, and sign in with `signIn`. Construct `createAuth` against the same `deps.db.app` with a different secret. Call `authLike.getSession` first with the signed token and then with `sessionTokenOf(credentials)`. Observe null then a session; do not print credentials.
- **Cache headers:** use the test app with `cookieAuth` and inspect only status and headers for the three endpoints listed in OWASP-07.
- **Dependency advisory:** run both audit commands in the validation table and review the package paths, not just the severity totals.

## Suggested remediation order

1. **Before exposing the stack:** resolve OWASP-01; verify ingress ownership of forwarding headers for OWASP-02.
2. **Before deploying the current RLS work:** resolve OWASP-06 and obtain a passing DB-backed assistant path.
3. **Before relying on incident response:** resolve OWASP-03 and OWASP-05, including an explicit session-revocation drill.
4. **Before multi-instance or real-data use:** address OWASP-04 and OWASP-07, verify deployment hardening, and define retention/provider policies.
5. **Dependency maintenance:** resolve OWASP-08 with compatible updates and validate actual runtime/build exposure.

All recommendations are proposals only. This review does not approve contract, schema, threshold, timeout, or CSP changes under the repository's governance rules.

## References

- [OWASP Top 10:2025](https://owasp.org/Top10/2025/); category names checked against the [official source index](https://github.com/OWASP/Top10/blob/master/2025/docs/en/index.md).
- [OWASP API Security Top 10:2023](https://owasp.org/API-Security/editions/2023/en/0x11-t10/).
- [OWASP Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/).
- [esbuild advisory GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99).
- Repository security model and accepted tradeoffs: [ARCHITECTURE.md](ARCHITECTURE.md), [ADR 0006](adr/0006-guard-fails-open.md), and the applicable `AGENTS.md` files. Installed dependency source is version-specific evidence; its package-relative paths above avoid machine-specific pnpm paths.
