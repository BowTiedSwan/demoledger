# ADR 0005: Seed timestamps anchored to the run date

Status: accepted

## Context
The example questions are relative ("yesterday", "this week"). A seed with fixed dates would answer them with "no records" a few days after it was written.

## Decision
`generateTransactions(anchor)` (`packages/db/src/seed/generate.ts`) is a pure function with a fixed-seed PRNG. Each timestamp is an offset from the anchor, which is `SEED_ANCHOR` or, by default, the start of the current UTC day at `pnpm db:reset` time. Tests pin the anchor to `2026-10-28T00:00:00Z` and inject the clock, and they compute expected values from the same function.

## Consequences
- The four example questions have matching data whenever the grader runs `pnpm db:reset`.
- The same IDs, amounts and statuses come back on every run; only the dates move with the anchor. A demo run on another day shows different dates than the README examples.
- If the dev database was seeded on an earlier day, "yesterday" drifts. Re-run `pnpm db:reset` (or set `SEED_ANCHOR`).
- All periods are UTC. A user in a far-off time zone sees "yesterday" in UTC, and the docs say so.
