import type { AggregateResponse, SearchTransactionsResult } from '@demoledger/shared';
import type { AuditToolCallRecord } from '../audit';

/**
 * Per-request collector shared by the tool factory and the orchestrator.
 * Holds the evidence set used by the grounding check (IDs actually returned by this
 * request's tool calls) and the rows later written to ai_tool_calls.
 */
export class ToolCallRecorder {
  readonly calls: AuditToolCallRecord[] = [];
  /** Every transaction_id returned to the model during this request. */
  readonly returnedIds = new Set<string>();
  /** Step number the next tool call belongs to (set from prepareStep). */
  currentStep = 0;
  /** Server-computed counts the model may legitimately quote (returned, total_matching, group counts). */
  readonly countFacts = new Set<number>();
  /** Rows returned by search calls: id -> status and failure_reason (for the fact check). */
  readonly rowFacts = new Map<string, { status: string; failure_reason: string | null }>();
  /** Human-readable server counts per lookup, for the count warning ("18 matching (search_transactions: status=failed)"). */
  readonly countNotes: string[] = [];
  /** Status/direction values some lookup filtered or grouped by (so a count of them is verifiable). */
  readonly countedQualifiers = new Set<string>();
  /** Latest successful aggregate / search results of this request (source for present_visual). */
  latestAggregate: AggregateResponse | undefined;
  latestSearch: Omit<SearchTransactionsResult, 'ok'> | undefined;
  /** Number of data-visual parts emitted (unique part ids). */
  visuals = 0;
  validationFailures = 0;
  successfulCalls = 0;
  /** true once any successful call matched at least one row. */
  matchedRows = false;

  constructor(readonly requestId: string) {}

  add(call: Omit<AuditToolCallRecord, 'requestId' | 'step'>): void {
    this.calls.push({ ...call, requestId: this.requestId, step: this.currentStep });
  }
}
