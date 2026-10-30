import { type Database, schema } from '@demoledger/db';

export type AuditRequestRecord = schema.NewAiRequest;
export type AuditToolCallRecord = schema.NewAiToolCall;

/**
 * Append-only audit sink. One call per /api/ask request: the request row plus the tool-call
 * rows collected while it ran. Implementations must never UPDATE or DELETE.
 */
export interface AuditSink {
  record(request: AuditRequestRecord, toolCalls: readonly AuditToolCallRecord[]): Promise<void>;
}

/**
 * Inserts through the `ledger_app` pool (INSERT-only grant: no SELECT, so no RETURNING).
 * Tool rows and the request row go in one transaction.
 */
export function createDbAudit(db: Database): AuditSink {
  return {
    async record(request, toolCalls) {
      await db.transaction(async (tx) => {
        await tx.insert(schema.aiRequests).values(request);
        if (toolCalls.length > 0) await tx.insert(schema.aiToolCalls).values([...toolCalls]);
      });
    },
  };
}

/** In-memory sink for unit tests. */
export function createMemoryAudit(): AuditSink & {
  requests: AuditRequestRecord[];
  toolCalls: AuditToolCallRecord[];
} {
  const requests: AuditRequestRecord[] = [];
  const toolCalls: AuditToolCallRecord[] = [];
  return {
    requests,
    toolCalls,
    async record(request, calls) {
      requests.push(request);
      toolCalls.push(...calls);
    },
  };
}
