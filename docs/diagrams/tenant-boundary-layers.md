# Tenant boundary: six layers

Text twin of [`tenant-boundary-layers.svg`](tenant-boundary-layers.svg); change both together. Decisions: ADR 0004 (roles), ADR 0010 (RLS).

```mermaid
flowchart TD
    L1["L1 Session<br/>requireTenant: tenant = active organization, never from input"]
    L2["L2 Membership re-check<br/>member row every request, foreign or deleted org = 403"]
    L3["L3 Closure-scoped tools<br/>ledgerTools(tenantId), strict args reject tenant_id"]
    L4["L4 Repository WHERE<br/>tenant_id = $1 in every query, shared by REST and tools"]
    L5["L5 DB role grants<br/>ledger_reader SELECT transactions only, boot refuses superuser / BYPASSRLS"]
    L6["L6 Row-level security (FORCE)<br/>tenant_id = app.tenant_id via withTenant, unset = 0 rows"]
    L1 --> L2 --> L3 --> L4 --> L5 --> L6
```

| Layer | If this layer has a bug |
|---|---|
| L1, L2 | The wrong tenant is chosen, and L3–L6 cannot detect it. These layers decide which tenant; the HTTP isolation tests cover them. |
| L3 | A tool that skips the closure still hits L4, which binds the tenant. |
| L4 | A query that omits the WHERE clause is still filtered by L6. |
| L5 | Grant drift fails `roles.test.ts` in CI; no write path exists to misuse. |
| L6 | The owner role bypasses RLS; it runs only migrations and the seed. |

Residual risk: a cross-tenant read needs a bug in the app layers (L3–L4) **and** in the database layers (L5–L6). The audit and Better Auth tables have no RLS (ADR 0010).
