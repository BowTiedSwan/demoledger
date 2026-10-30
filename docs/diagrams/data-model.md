# Data model, roles and RLS

Text twin of [`data-model.svg`](data-model.svg); change both together. Source of truth: `packages/db/src/schema/` and `packages/db/src/roles.sql` (the generated table in `REPO_MAP.md` lists grants and RLS per table).

```mermaid
erDiagram
    organization ||--o{ member : "has"
    user ||--o{ member : "has"
    user ||--o{ session : "has"
    organization ||--o{ transactions : "tenant_id"
    organization ||--o{ ai_conversations : "tenant_id"
    user ||--o{ ai_conversations : "user_id"
    ai_conversations ||--o{ ai_messages : "conversation_id"

    organization {
        text id PK "= tenant_id"
        text name
    }
    user {
        text id PK
        text email
    }
    member {
        text id PK
        text organization_id FK
        text user_id FK
        text role
    }
    session {
        text id PK
        text user_id FK
        text active_organization_id "no FK, re-checked per request"
    }
    transactions {
        text transaction_id PK
        text tenant_id FK
        bigint amount_minor
        text failure_reason "null = not recorded"
    }
    ai_conversations {
        uuid id PK "client UUID"
        text tenant_id FK
        text user_id FK
    }
    ai_messages {
        uuid id PK
        uuid conversation_id FK
        text tenant_id
        text user_id
    }
    ai_requests {
        uuid id PK
        text request_id
        text tenant_id
    }
    ai_tool_calls {
        uuid id PK
        text request_id
        jsonb raw_args
    }
```

| Table | Role access | RLS |
|---|---|---|
| `transactions` | `ledger_reader`: SELECT only | FORCE, on `app.tenant_id` |
| `ai_conversations`, `ai_messages` | `ledger_app`: SELECT, INSERT | FORCE, on `app.tenant_id` and `app.user_id` |
| `ai_requests`, `ai_tool_calls` | `ledger_app`: INSERT only (no FKs; rows join on `request_id`) | none |
| Better Auth tables (`organization`, `user`, `member`, `session`, …) | `ledger_app`: full DML | none |

The owner role runs migrations and the seed, and bypasses RLS. The API never connects as it, and refuses to boot if either pool is a superuser or has BYPASSRLS.
