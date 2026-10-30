# ADR 0006: The prompt-injection guard is defense in depth and fails open by default

Status: accepted

## Context
A guard model (Clef-flash) plus a deterministic heuristic screens questions before the LLM. Guards are probabilistic and can be unavailable (errors, the 2.5 s timeout `GUARD_TIMEOUT_MS`, free-tier quota).

## Decision
- The security boundary is backend tenant scoping plus the read-only DB role, not the guard. Even a fully injected model can only call two read-only, tenant-bound tools.
- Decision logic (`apps/api/src/guard/config.ts`, `GUARD_THRESHOLDS`): **block** if injection > 0.85, or `write_action` intent with confidence > 0.6, or the heuristic finds a write request; **flag** (allow, audited) if injection is 0.5–0.85; otherwise **allow**. Blocked requests get a fixed refusal and never reach the LLM.
- **Deviation from the brief's §7.4 table (finding F-14):** with `GUARD_PROVIDER=clef` the heuristic still runs, and **any** heuristic block category escalates to `block`, not only write verbs. Without this, enabling Clef would downgrade the heuristic's blocks on override phrases, tenant or role claims and SQL fragments to flags.
- The guard judges exactly the text the model receives: since D-17 that is only the latest user question. Earlier turns are display-only, which supersedes the per-turn screening of F-13.
- **On a guard error or timeout** (Clef unreachable, malformed, or slower than `GUARD_TIMEOUT_MS`, default **2500 ms**), the runner **falls back to the local heuristic** (finding F-23, T-221):
  - **A blocking heuristic hit** means `block`, whatever the fail mode.
  - **Otherwise** the verdict is `unavailable`, with the heuristic matches recorded in `guard_answers`. `GUARD_FAIL_MODE` then decides: `open` (the default) proceeds, `closed` refuses.
  - **"Fail open" therefore means** "Clef is unavailable, but the heuristic still applies". It never means "no guard". Both outcomes are audited.
- **Why (F-23):** before the fallback, a Clef timeout skipped the heuristic entirely, so production had no guard whenever Clef was slow. In the live run Clef ranged from 442 ms to over 1,500 ms and timed out at the old 1.5 s default on two of four questions. The default was raised to 2.5 s.
- `GUARD_PROVIDER` defaults to `clef` when Workers AI credentials are set and to `heuristic` otherwise. `none` is for tests.

## Consequences
- An outage of the guard model does not take the assistant down. An attacker who slows or breaks Clef still meets the heuristic, and beyond that only the normal read-only, tenant-scoped capability.
- The extra second of timeout budget adds latency only when Clef is slow; it is still small next to the LLM steps.
- `GUARD_FAIL_MODE=closed` is the incident kill switch (see `docs/ARCHITECTURE.md`, Incident response).
- The heuristic catches keyword attacks and write requests offline. Paraphrased attacks need the model guard. The eval on 43 labelled prompts shows heuristic detection 85.7% and Clef-flash alone 64.3%, both with 0% false blocks. Clef flags clear injections (0.5–0.85) rather than blocking them. See ADR 0007.
