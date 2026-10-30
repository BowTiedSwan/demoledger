# /api/ask request path

Text twin of [`ask-request-path.svg`](ask-request-path.svg); change both together. Code: `apps/api/src/app.ts` (middleware order), `apps/api/src/orchestrator/index.ts` (`handleAsk`).

```mermaid
sequenceDiagram
    participant B as Browser
    participant A as API middleware
    participant H as handleAsk
    participant P as Postgres (RLS)
    participant M as Model (Workers AI)

    B->>A: POST /api/ask (cookie or bearer)
    Note over A: requestId · no-store · secureHeaders · log<br/>requireTenant: session, then member re-check<br/>CSRF origin (cookie only) · rate limit · body limit · zod askRequest
    A->>H: handleAsk(tenant from c.get('tenant'))
    Note over H: ensure conversation (foreign id = 404)<br/>guard: block = fixed refusal, no model call<br/>load the last 3 stored answered pairs (withTenantUser)
    loop up to LLM_MAX_STEPS = 5, the last step has no tools
        H->>M: model step (streamText)
        M-->>H: tool call
        H->>P: ledgerTools → repo → withTenant SQL (strict args, tenant from closure)
        P-->>H: rows (RLS: app.tenant_id)
        M-->>H: answer text
    end
    Note over H: checks: grounding · counts · facts · speculation (warnings only)
    H->>B: UI message stream: text, tool parts, data-visual, warnings
    H-)P: audit (ai_requests, ai_tool_calls), store the pair in ai_messages if ok or no_results
```

The stream starts with the first token, so text reaches the browser while the loop runs; audit and conversation writes happen when the stream ends. `present_visual` is a tool call inside the loop with no SQL: it re-shapes this request's recorded results (ADR 0009).
