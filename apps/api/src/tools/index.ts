import {
  type AggregateTransactionsResult,
  aggregateTransactionsArgs,
  type PresentVisualResult,
  presentVisualArgs,
  type SearchTransactionsResult,
  searchTransactionsArgs,
  TOOL_NAMES,
  type ToolErrorResult,
  type ToolName,
  transactionSourceUrl,
  type ValidationIssue,
  type VisualDataPart,
} from '@demoledger/shared';
import { jsonSchema, tool } from 'ai';
import { z } from 'zod';
import type { LedgerReader } from './reader';
import type { ToolCallRecorder } from './recorder';
import { wrapUntrusted } from './untrusted';
import { buildVisualSpec } from './visual';

export { createRepoReader, type LedgerReader } from './reader';
export { ToolCallRecorder } from './recorder';
export { wrapPriorAnswer, wrapUntrusted } from './untrusted';

export interface SourceWriter {
  write(
    part:
      | { type: 'source-url'; sourceId: string; url: string; title: string }
      | { type: 'data-visual'; id: string; data: VisualDataPart },
  ): void;
}

export interface LedgerToolsOptions {
  /** From the validated session (closure). NEVER from tool arguments. */
  tenantId: string;
  requestId: string;
  writer: SourceWriter;
  now: () => Date;
  reader: LedgerReader;
  recorder: ToolCallRecorder;
}

function toJsonSchema(schema: z.ZodType) {
  const { $schema: _omit, ...rest } = z.toJSONSchema(schema, {
    io: 'input',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  return rest;
}

/**
 * The SDK is given a schema that advertises the real argument shape to the model but accepts
 * ANY value: validation happens inside `execute` with the strict shared zod schemas, so the
 * exact model-proposed args are audited (raw_args) and a bad call returns a structured error
 * result without running a query.
 */
function passthroughInput(schema: z.ZodType) {
  return jsonSchema<Record<string, unknown>>(toJsonSchema(schema) as Parameters<typeof jsonSchema>[0], {
    validate: (value) => ({ success: true, value: value as Record<string, unknown> }),
  });
}

function issuesOf(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

function validationError(issues: ValidationIssue[]): ToolErrorResult {
  return {
    ok: false,
    error: {
      code: 'validation_error',
      message:
        'The arguments were rejected and no lookup was run. Fix the listed issues and call the tool again. Do not pass tenant or organization identifiers.',
      issues,
    },
  };
}

const COMMON_DOC =
  'Filters: wallet_id (e.g. WALLET-A-001), status (completed|pending|failed), direction (incoming|outgoing), ' +
  'EITHER period (today|yesterday|this_week|last_7_days|last_30_days; UTC) OR from+to (ISO dates, max 90 days), ' +
  'min_amount_minor/max_amount_minor (integer minor units, e.g. cents). The organization is fixed by the server.';

/**
 * Builds the per-request tool registry: exactly `TOOL_NAMES`, both read-only.
 * The tenant is captured in this closure and used for every query.
 */
export function ledgerTools(opts: LedgerToolsOptions) {
  const { tenantId, reader, recorder, writer } = opts;
  const nonce = crypto.randomUUID().slice(0, 8);

  const emitSources = (ids: readonly string[]) => {
    for (const id of ids) {
      if (recorder.returnedIds.has(id)) continue;
      recorder.returnedIds.add(id);
      writer.write({ type: 'source-url', sourceId: id, url: transactionSourceUrl(id), title: id });
    }
  };

  const search_transactions = tool({
    description: `Search this organization's ledger transactions. Returns rows plus returned, total_matching and truncated (limit 1-50, default 20). To look up specific transactions, for example ones an earlier answer cited, pass transaction_ids (1-50 IDs like TXN-A-0001). ${COMMON_DOC} sort: occurred_at_desc|amount_desc|amount_asc.`,
    inputSchema: passthroughInput(searchTransactionsArgs),
    execute: async (rawInput): Promise<SearchTransactionsResult | ToolErrorResult> => {
      const t0 = performance.now();
      const parsed = searchTransactionsArgs.safeParse(rawInput);
      if (!parsed.success) {
        const issues = issuesOf(parsed.error);
        recorder.validationFailures++;
        recorder.add({
          toolName: 'search_transactions',
          rawArgs: rawInput as never,
          validated: false,
          validationError: issues
            .map((i) => `${i.path || '(root)'}: ${i.message}`)
            .join('; ')
            .slice(0, 1000),
          rowCount: null,
          returnedIds: [],
          latencyMs: Math.round(performance.now() - t0),
        });
        return validationError(issues);
      }
      try {
        const res = await reader.search(tenantId, parsed.data, opts.now());
        const ids = res.rows.map((r) => r.transaction_id);
        emitSources(ids);
        for (const r of res.rows) {
          recorder.rowFacts.set(r.transaction_id, { status: r.status, failure_reason: r.failure_reason });
        }
        recorder.successfulCalls++;
        recorder.latestSearch = res;
        recorder.countFacts.add(res.returned).add(res.total_matching);
        recorder.countNotes.push(
          `${res.total_matching} matching (search_transactions${describeFilters(parsed.data)})`,
        );
        noteQualifiers(recorder.countedQualifiers, parsed.data);
        if (res.total_matching > 0) recorder.matchedRows = true;
        recorder.add({
          toolName: 'search_transactions',
          rawArgs: rawInput as never,
          validated: true,
          validationError: null,
          rowCount: res.returned,
          returnedIds: ids,
          latencyMs: Math.round(performance.now() - t0),
        });
        return { ok: true, ...res };
      } catch {
        recorder.add({
          toolName: 'search_transactions',
          rawArgs: rawInput as never,
          validated: true,
          validationError: 'query_failed',
          rowCount: null,
          returnedIds: [],
          latencyMs: Math.round(performance.now() - t0),
        });
        return toolFailure();
      }
    },
    toModelOutput: ({ output }) => ({
      type: 'text',
      value: wrapUntrusted('search_transactions', modelView(output), nonce, serverFacts(output)),
    }),
  });

  const aggregate_transactions = tool({
    description: `Count or sum this organization's transactions, optionally grouped. Counts and sums are computed in SQL; never compute them yourself. Sums are always split per currency. metric: count|sum; group_by: none|status|wallet|direction|currency|day|failure_reason (answers "by cause", "by reason", "why did they fail"; a missing reason is the group not_recorded). ${COMMON_DOC}`,
    inputSchema: passthroughInput(aggregateTransactionsArgs),
    execute: async (rawInput): Promise<AggregateTransactionsResult | ToolErrorResult> => {
      const t0 = performance.now();
      const parsed = aggregateTransactionsArgs.safeParse(rawInput);
      if (!parsed.success) {
        const issues = issuesOf(parsed.error);
        recorder.validationFailures++;
        recorder.add({
          toolName: 'aggregate_transactions',
          rawArgs: rawInput as never,
          validated: false,
          validationError: issues
            .map((i) => `${i.path || '(root)'}: ${i.message}`)
            .join('; ')
            .slice(0, 1000),
          rowCount: null,
          returnedIds: [],
          latencyMs: Math.round(performance.now() - t0),
        });
        return validationError(issues);
      }
      try {
        const res = await reader.aggregate(tenantId, parsed.data, opts.now());
        recorder.successfulCalls++;
        recorder.latestAggregate = res;
        recorder.countFacts.add(res.total_matching);
        for (const g of res.groups) recorder.countFacts.add(g.count);
        recorder.countNotes.push(
          `${res.total_matching} matching (aggregate_transactions${describeFilters(parsed.data)})` +
            (parsed.data.group_by !== 'none' && res.groups.length > 0
              ? `, by ${parsed.data.group_by}: ${res.groups.map((g) => `${g.key}=${g.count}`).join(', ')}`
              : ''),
        );
        noteQualifiers(recorder.countedQualifiers, parsed.data);
        if (parsed.data.group_by === 'status' || parsed.data.group_by === 'direction') {
          for (const g of res.groups) recorder.countedQualifiers.add(g.key);
        }
        if (res.total_matching > 0) recorder.matchedRows = true;
        recorder.add({
          toolName: 'aggregate_transactions',
          rawArgs: rawInput as never,
          validated: true,
          validationError: null,
          rowCount: res.groups.length,
          returnedIds: [],
          latencyMs: Math.round(performance.now() - t0),
        });
        return { ok: true, ...res };
      } catch {
        recorder.add({
          toolName: 'aggregate_transactions',
          rawArgs: rawInput as never,
          validated: true,
          validationError: 'query_failed',
          rowCount: null,
          returnedIds: [],
          latencyMs: Math.round(performance.now() - t0),
        });
        return toolFailure();
      }
    },
    toModelOutput: ({ output }) => ({
      type: 'text',
      value: wrapUntrusted('aggregate_transactions', output, nonce, serverFacts(output)),
    }),
  });

  /**
   * Presentational tool (D-26): no reader, no DB. It re-shapes the latest result recorded in THIS
   * request into a VisualSpec and streams it as a `data-visual` part; the model only picks the
   * view (kind/source/title) and never authors numbers.
   */
  const present_visual = tool({
    description:
      'Show a chart or table for the user from the LATEST result of this request. Call aggregate_transactions (group_by day for a time series) or search_transactions first, then call this with kind (bar|line|table|stat), source (latest_aggregate|latest_search) and a short title. The server binds the data; you cannot pass numbers. Afterwards write 1-2 sentences using only server facts.',
    inputSchema: passthroughInput(presentVisualArgs),
    execute: async (rawInput): Promise<PresentVisualResult | ToolErrorResult> => {
      const t0 = performance.now();
      const done = (validated: boolean, validationError: string | null, rowCount: number | null) =>
        recorder.add({
          toolName: 'present_visual',
          rawArgs: rawInput as never,
          validated,
          validationError,
          rowCount,
          returnedIds: [],
          latencyMs: Math.round(performance.now() - t0),
        });
      const parsed = presentVisualArgs.safeParse(rawInput);
      if (!parsed.success) {
        const issues = issuesOf(parsed.error);
        recorder.validationFailures++;
        done(
          false,
          issues
            .map((i) => `${i.path || '(root)'}: ${i.message}`)
            .join('; ')
            .slice(0, 1000),
          null,
        );
        return validationError(issues);
      }
      const built = buildVisualSpec(parsed.data, {
        aggregate: recorder.latestAggregate,
        search: recorder.latestSearch,
      });
      if (!built.ok) {
        done(true, `no_visual: ${built.message}`.slice(0, 1000), 0);
        return { ok: false, error: { code: 'tool_error', message: built.message, issues: [] } };
      }
      const id = `visual-${opts.requestId}-${++recorder.visuals}`;
      writer.write({ type: 'data-visual', id, data: { id, spec: built.spec } });
      done(true, null, built.points);
      return { ok: true, id, kind: parsed.data.kind, summary: built.summary };
    },
    // The model must never see the visual id (it echoed it as a stray "[visual-...]" placeholder):
    // the id lives only on the data-visual part and the client-facing tool output.
    toModelOutput: ({ output }) => ({
      type: 'json',
      value: output.ok
        ? { shown: true, kind: output.kind, summary: output.summary }
        : { shown: false, error: output.error.message },
    }),
  });

  const tools = { search_transactions, aggregate_transactions, present_visual } satisfies Record<
    ToolName,
    unknown
  >;
  return tools;
}

/**
 * What the model reads: a failed row without a recorded reason says so in words instead of
 * `null`, which small models misread. The UI and the audit keep the raw value.
 */
export function modelView(output: unknown): unknown {
  const o = output as { ok?: boolean; rows?: Record<string, unknown>[] };
  if (o.ok !== true || !Array.isArray(o.rows)) return output;
  return {
    ...o,
    rows: o.rows.map((r) =>
      r.status === 'failed' && r.failure_reason === null ? { ...r, failure_reason: 'not recorded' } : r,
    ),
  };
}

function describeFilters(args: Record<string, unknown>): string {
  const keys = ['wallet_id', 'status', 'direction', 'period', 'from', 'to'] as const;
  const parts = keys.filter((k) => args[k] !== undefined).map((k) => `${k}=${String(args[k])}`);
  if (Array.isArray(args.transaction_ids)) parts.push(`transaction_ids=${args.transaction_ids.length} ids`);
  return parts.length > 0 ? `: ${parts.join(', ')}` : '';
}

function noteQualifiers(
  into: Set<string>,
  args: { status?: string | undefined; direction?: string | undefined },
): void {
  if (args.status) into.add(args.status);
  if (args.direction) into.add(args.direction);
}

/** Trusted one-line summary placed outside the untrusted block. Numbers and booleans only. */
function serverFacts(output: unknown): string {
  const o = output as Record<string, unknown>;
  if (o.ok !== true) return 'ok=false';
  const parts: string[] = [];
  if (typeof o.returned === 'number') parts.push(`returned=${o.returned}`);
  if (typeof o.total_matching === 'number') parts.push(`total_matching=${o.total_matching}`);
  if (typeof o.truncated === 'boolean') parts.push(`truncated=${o.truncated}`);
  if (Array.isArray(o.groups)) parts.push(`groups=${o.groups.length}`);
  return parts.join(' ');
}

function toolFailure(): ToolErrorResult {
  return {
    ok: false,
    error: {
      code: 'tool_error',
      message: 'The lookup failed. Tell the user the data could not be retrieved; do not guess.',
      issues: [],
    },
  };
}

export type LedgerTools = ReturnType<typeof ledgerTools>;
/** Names of the registered tools; tests assert this equals TOOL_NAMES. */
export const REGISTERED_TOOL_NAMES: readonly string[] = TOOL_NAMES;
