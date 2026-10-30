import { z } from 'zod';

export const TRANSACTION_STATUSES = ['completed', 'pending', 'failed'] as const;
export const transactionStatus = z.enum(TRANSACTION_STATUSES);
export type TransactionStatus = z.infer<typeof transactionStatus>;

export const DIRECTIONS = ['incoming', 'outgoing'] as const;
export const direction = z.enum(DIRECTIONS);
export type Direction = z.infer<typeof direction>;

/** Currencies present in the seed. Extend together with CURRENCY_EXPONENT in money.ts. */
export const CURRENCIES = ['EUR', 'USD', 'GBP'] as const;
export const currency = z.enum(CURRENCIES);
export type Currency = z.infer<typeof currency>;

export const SORTS = ['occurred_at_desc', 'amount_desc', 'amount_asc'] as const;
export const sort = z.enum(SORTS);
export type Sort = z.infer<typeof sort>;

/** Relative periods, all resolved on the server in UTC (see dates.ts). */
export const PERIODS = ['today', 'yesterday', 'this_week', 'last_7_days', 'last_30_days'] as const;
export const period = z.enum(PERIODS);
export type Period = z.infer<typeof period>;

export const GROUP_BYS = ['none', 'status', 'wallet', 'direction', 'currency', 'day'] as const;
export const groupBy = z.enum(GROUP_BYS);
export type GroupBy = z.infer<typeof groupBy>;

export const METRICS = ['count', 'sum'] as const;
export const metric = z.enum(METRICS);
export type Metric = z.infer<typeof metric>;

/** `ai_requests.status`. Exactly one per /api/ask request. */
export const AUDIT_REQUEST_STATUSES = [
  'ok',
  'blocked',
  'rate_limited',
  'quota_exhausted',
  'timeout',
  'llm_error',
  'validation_error',
  'no_results',
  'loop_limit',
] as const;
export const auditRequestStatus = z.enum(AUDIT_REQUEST_STATUSES);
export type AuditRequestStatus = z.infer<typeof auditRequestStatus>;

/** `ai_requests.guard_verdict`. `unavailable` = guard errored/timed out (see GUARD_FAIL_MODE). */
export const GUARD_VERDICTS = ['allow', 'flag', 'block', 'unavailable'] as const;
export const guardVerdict = z.enum(GUARD_VERDICTS);
export type GuardVerdict = z.infer<typeof guardVerdict>;

export const GUARD_PROVIDERS = ['clef', 'heuristic', 'none'] as const;
export const guardProvider = z.enum(GUARD_PROVIDERS);
export type GuardProviderName = z.infer<typeof guardProvider>;

export const GUARD_FAIL_MODES = ['open', 'closed'] as const;
export const guardFailMode = z.enum(GUARD_FAIL_MODES);
export type GuardFailMode = z.infer<typeof guardFailMode>;

/** Read-only data tools: the only tools that query the database (tenant-scoped, ledger_reader). */
export const DATA_TOOL_NAMES = ['search_transactions', 'aggregate_transactions'] as const;
export type DataToolName = (typeof DATA_TOOL_NAMES)[number];
/**
 * Presentational tools: no DB access; they only re-shape this request's earlier tool results
 * into a server-built view (D-26, ADR 0009).
 */
export const PRESENTATIONAL_TOOL_NAMES = ['present_visual'] as const;
export type PresentationalToolName = (typeof PRESENTATIONAL_TOOL_NAMES)[number];
/** Every tool the model can call. The registry must contain exactly these. */
export const TOOL_NAMES = [...DATA_TOOL_NAMES, ...PRESENTATIONAL_TOOL_NAMES] as const;
export const toolName = z.enum(TOOL_NAMES);
export type ToolName = z.infer<typeof toolName>;
