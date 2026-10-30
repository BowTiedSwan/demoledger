# ADR 0007: Cloudflare Workers AI on the Free plan; model choice and guard model

Status: accepted. Revised 2026-10-30. The default model is now `@cf/google/gemma-4-26b-a4b-it` (D-23, approved by the user). Gemma passed live UI verification on 2026-10-30.

## Context
R4 requires an external LLM API with a genuinely free tier and no billing. The model must:
- support native function calling (R5);
- follow the grounding rules;
- answer in plain English for finance-ops users;
- fit enough questions per day into the free Neuron allowance.

## Decision
- **Provider:** Workers AI through its OpenAI-compatible endpoint (`https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/ai/v1`), with AI SDK v7 and `@ai-sdk/openai-compatible` (`apps/api/src/llm/`). The token needs only "Workers AI: Read".
- **Default model `@cf/google/gemma-4-26b-a4b-it`** (`LLM_MODEL`, `DEFAULT_LLM_MODEL` in `apps/api/src/llm/index.ts`), with an output cap of `LLM_MAX_OUTPUT_TOKENS` (2048).
- **Fallback:** `@cf/openai/gpt-oss-120b`.
- **No output filtering and no automatic retries.**
  - The prompt rule "Answer in English." stays; the text stream is not edited (D-21).
  - Malformed output becomes an error, not a retry (D-22). If a model's malformed-output rate goes above about 5%, change the model.
- **Guard model:** `@cf/cloudflare/clef-flash`, through a System One REST adapter (`apps/api/src/guard/system-one.ts`). The base URL and model are configurable.

## Model history (all 2026-10-30)

1. **`@cf/zai-org/glm-4.7-flash`: initial default.** It has function calling and a 131k context, and costs 5,500 / 36,400 Neurons per 1M input / output tokens. In live use it miscounted rows in prose (F-12). Its hidden reasoning tripped a wall-clock step timeout (F-16).
2. **Thinking off / on (D-18).**

   | Run | Tool choice | Key args | Valid args | Grounded | Fact acc. | p50 / p95 |
   |---|---|---|---|---|---|---|
   | First eval (provider default, reasoning on) | 92.9% | 92.3% | 100% | 92.9% | n/a | 6.55 / 18.98 s |
   | Thinking off | 92.9% | 84.6% | 100% | 92.3% | 92.3% | 4.0 / 11.0 s |
   | Thinking on (became the default) | 100% | 100% | 100% | 92.3% | 92.3% | 7.9 / 32.2 s |

   With thinking off, one live answer contradicted its own evidence (F-19).
3. **`@cf/openai/gpt-oss-120b` (D-21, user decision).** GLM drifted into Chinese mid-answer ("…for a赔付 supplier payout…", F-20) and later emitted stray "₹" before timestamps.
   - A Latin-script output filter (D-19) was built, and the user overruled it: deleting text hides a model problem.
   - The model was switched instead. gpt-oss-120b needed two compatibility fixes (F-21):
     - checks that normalise Unicode-hyphen IDs;
     - `sanitizeMessages` for `content: null` and a replayed `reasoning_content`.
4. **`@cf/google/gemma-4-26b-a4b-it` (D-23, user, on the lead's recommendation).** gpt-oss-120b failed live after a good eval:
   - **truncated answers:** Q2 and Q4 were cut mid-sentence and recorded as `ok` (F-22). Fixed by `LLM_MAX_OUTPUT_TOKENS` plus truncation detection.
   - **markup leaks:** raw harmony reasoning and tool-call markup leaked as the answer text in 2 of about 8 live UI requests (~25%). Example, request `fa148bc3-394e-47c0-8e98-8d6af6ea8204`, Q4 "Summarize recent activity for WALLET-A-002.":
     ```text
     analysis: need recent activity: maybe last 7 days?… <|end|><|start|>assistantcommentary to=functions.search_transactions {" wallet_id":" WALLET-A-000? wait correct ID…
     ```
     The `malformed_output` detection caught both leaks and showed the error banner.

   Gemma had the best eval scores and costs less than half as much, so it became the default.

## Model comparison (T-219, 2026-10-30)
Setup: 14 questions, reasoning effort low, the English rule, no output filter, one run per model. Raw output is in `evals/results/`.

| Model | Tool choice | Key args | Valid args | Grounded | Fact acc. | p50 / p95 | Tokens in / out per question | ≈ Neurons / question | ≈ questions / day (free) |
|---|---|---|---|---|---|---|---|---|---|
| `@cf/google/gemma-4-26b-a4b-it` (**default**) | 100% | 100% | 100% | 92.3% | 100% | 4.9 / 20.1 s | 3,447 / 415 | ~43 | ~235 |
| `@cf/openai/gpt-oss-120b` (fallback) | 92.9% | 92.3% | 100% | 92.3% | 100% | 4.4 / 10.8 s | 2,724 / 227 | ~102 | ~98 |
| `@cf/zai-org/glm-4.7-flash` (initial, thinking off) | 85.7% | 84.6% | 94.7% | 92.3% | 100% | 5.9 / 22.2 s | 7,283 / 199 | ~47 | ~210 |
| `@cf/openai/gpt-oss-20b` (rejected) | 50.0% | 38.5% | 75.0% | 100% (5 answers) | 100% | 1.7 / 4.0 s | 2,498 / 108 | ~48 | ~205 |

**Cost columns.**
- **Neurons per question:** tokens in × the in-rate, plus tokens out × the out-rate, using Cloudflare's published Neurons per 1M tokens (in / out):
  - gemma-4-26b: 9,091 / 27,273
  - gpt-oss-120b: 31,818 / 68,182
  - glm-4.7-flash: 5,500 / 36,400
  - gpt-oss-20b: 18,182 / 27,273
- **Questions per day:** 10,000 free Neurons ÷ Neurons per question. The guard adds 1–2 Neurons per question, which this figure leaves out.

**Gemma checks:**
- It produced 0 non-Latin characters in its answers.
- Its Free-plan availability was confirmed live: HTTP 200 on a chat completion with a tool definition.

**Rejected models:**
- `@cf/openai/gpt-oss-20b`: empty answers on 6 of 14 questions, plus one `validation_error`.
- `@cf/zai-org/glm-5.3`, `glm-5.3-flash` and `glm-5.2`: they need Workers Paid (the pricing page lists them as requiring a paid billing method). GLM 5.3 would cost about 950 Neurons per question.
- glm-4.7-flash: language drift (F-20, then "₹") and the lowest tool choice of the viable models.
- gpt-oss-120b: kept as the fallback, but its live markup leaks and truncation rule it out as the default.

**Live UI verification of Gemma (2026-10-30).** The lead ran the four example questions in one chat as alpha. All four were `ok` with 0 ungrounded IDs:
- Q1 gave all 5 failure reasons correctly, including "not recorded" for TXN-A-0054.
- Q2 put the €4,800 tie first.
- Q3 answered "4 failed transactions yesterday" from the aggregate.
- Q4 summarised 18 transactions using aggregate counts.

Latency was 4.7–14.5 s. There was no truncation, no markup leak, no non-Latin text and no warning. Details are in `EVALS.md`.

**Caveat:** these are single runs; 92.3% against 100% is one question.

Reproduce:

```bash
LLM_EVAL_MODELS=@cf/google/gemma-4-26b-a4b-it,@cf/openai/gpt-oss-120b,@cf/zai-org/glm-4.7-flash pnpm eval:llm
```

## Guard and endpoint evidence (live, 2026-10-30)
- **Guard eval** (43 prompts):
  - heuristic: 90.7% accuracy;
  - Clef-flash alone: 76.7%; it flags clear injections at 0.5–0.85 rather than blocking them;
  - production combination: 90.7% after the decision-table change (ADR 0006, D-14);
  - 0% false blocks throughout.
- **Clef-flash System One schema, verified live:**
  - Request: `{ model: "clef-flash", state, questions }`.
  - Response: `answers` (a `noul` probability; `choice` with `choice` / `probabilities` / `confidence`) and `usage`. A `{ result, success }` envelope is also tolerated.
  - `out_of_scope` gets a description string instead of `null`.
- **Timeouts and retries (F-16):**
  - The AI SDK retries 429/5xx with about 2 s, then 4 s, of back-off; this is not configurable in v7.0.157.
  - Steps use idle timeouts (`LLM_STEP_TIMEOUT_MS` = 15 s to the first chunk). `LLM_REQUEST_TIMEOUT_MS` (45 s) is the only wall-clock bound.

## Consequences
- **Cost:** Gemma uses about **43 Neurons per question**, so the free 10,000 Neurons/day covers about **235 questions**; gpt-oss-120b would cover about 98. One 14-question eval run uses about 600 Neurons on Gemma. The cap is hard: running out gives `quota_exhausted`, never a charge.
- **Latency trade-off:** Gemma's tail is slower (p95 20.1 s against 10.8 s on gpt-oss-120b). It stays inside the 45 s request budget, and the idle step timeouts never cut off a slow but streaming answer.
- **Switching back is configuration:** `LLM_MODEL=@cf/openai/gpt-oss-120b` restores the fallback; nothing else changes. `LLM_REASONING_EFFORT` only affects model families that support it (gpt-oss; GLM's thinking toggle). It **has no effect on Gemma**.
- **Every model gets the same safety net:**
  - answer checks for IDs, counts, failure-reason facts and speculation;
  - truncation detection (`truncated`);
  - malformed-output detection (`malformed_output`).
- **Guard latency:** 358 ms at the median and 900 ms in the smoke run, with live peaks above 1.5 s (F-23). `GUARD_TIMEOUT_MS` is now 2.5 s, and a timeout falls back to the heuristic (ADR 0006). Watch the `unavailable` rate.
