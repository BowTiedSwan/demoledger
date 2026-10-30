# ADR 0001: Native tool calling inside the API, no MCP server

Status: accepted

## Context
The LLM must look up transactions through a constrained backend tool (R5, R16). An MCP server is one way to expose tools; native function calling through the AI SDK is another.

## Decision
The two tools (`search_transactions`, `aggregate_transactions`) are AI SDK tools built per request by `ledgerTools({ tenantId, requestId, … })` in `apps/api/src/tools/`, and `streamText` calls them through the provider's native function calling, inside the API process. There is no MCP server.

## Consequences
- The tenant is bound in a closure from the validated session. No transport, server or extra auth hop could carry a tenant claim.
- One process makes the whole path testable with `MockLanguageModelV4`, against the real test database.
- Validation, auditing and the untrusted-data wrapper sit in one place (`execute` + `toModelOutput`).
- Other agents cannot reuse the tools today. An MCP adapter could later wrap the same repository functions, with tenant identity taken from the MCP client's own authenticated session, never from tool arguments. That is listed as future work in `docs/ARCHITECTURE.md`.
