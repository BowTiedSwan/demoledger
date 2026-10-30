# Seed data snapshot

`transactions.csv` is **generated**: do not edit it by hand. Regenerate with `pnpm db:export-seed`.
A test fails if it drifts from the generator.

- It is a readable snapshot of the 100 fictional seed transactions at the fixed reference anchor
  `2026-10-28T00:00:00Z`.
- The database seed is generated at run time. `pnpm db:reset` seeds the same 100 rows (same IDs,
  amounts, currencies, statuses, failure reasons and descriptions) with timestamps shifted so
  "yesterday" and "this week" have data relative to the day you run it.
- `amount_minor` is an integer in minor units (cents); `amount_display` is for reading only.
- Some descriptions deliberately contain instructions aimed at the model: they are prompt-injection
  test fixtures and are treated as untrusted data.

## Seed users and organizations (fictional, test-only)

| Organization (ID) | Email | Role |
|---|---|---|
| Alpha Payments, fictional (`tenant_alpha`) | `ops.alpha@demoledger.test` | member |
| Beta Wallets, fictional (`tenant_beta`) | `ops.beta@demoledger.test` | member |

The passwords are the fictional test-only ones documented in the main README.
