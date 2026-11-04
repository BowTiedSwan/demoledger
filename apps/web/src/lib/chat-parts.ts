import type { AskDataParts, AskMessageMetadata, AskUITools, ToolName } from '@demoledger/shared';
import { TOOL_NAMES, walletLookup } from '@demoledger/shared';
import type { ChatStatus, UIMessage } from 'ai';
import { type DisplayedError, describeAskError } from './ask-errors';

export type ChatMessage = UIMessage<AskMessageMetadata, AskDataParts, AskUITools>;
export type ChatPart = ChatMessage['parts'][number];

/** Structural subset of a message, so the pure helpers are easy to test. */
export interface MessageLike {
  role: string;
  parts: readonly { type: string; text?: string; state?: string }[];
}

/** The suggested questions: the four from the brief verbatim and first, then the chart prompt. */
export const SUGGESTED_QUESTIONS = [
  'Why did wallet WALLET-A-001 have failed transactions?',
  'Show the largest completed outgoing transactions this week.',
  'How many failed transactions occurred yesterday?',
  'Summarize recent activity for WALLET-A-002.',
  'Show me a graph of outgoing transactions for the past week.',
] as const;

/** Assignment templates, bound only to wallets returned by the tenant-scoped API. */
export function suggestedQuestions(walletIds: readonly string[]): string[] {
  const wallets = [...new Set(walletIds)].sort();
  const replacements = new Map([
    ['WALLET-A-001', wallets.includes('WALLET-A-001') ? 'WALLET-A-001' : wallets[0]],
    ['WALLET-A-002', wallets.includes('WALLET-A-002') ? 'WALLET-A-002' : (wallets[1] ?? wallets[0])],
  ]);
  return SUGGESTED_QUESTIONS.flatMap((question) => {
    for (const [template, wallet] of replacements) {
      if (question.includes(template)) return wallet ? [question.replace(template, wallet)] : [];
    }
    return [question];
  });
}

/** A server-confirmed absence is shown even if the model's prose omits it. */
export function missingWalletIds(
  parts: readonly { type: string; state?: string; output?: unknown }[],
): string[] {
  const latest = new Map<string, boolean>();
  for (const part of parts) {
    if (
      (part.type !== 'tool-search_transactions' && part.type !== 'tool-aggregate_transactions') ||
      part.state !== 'output-available'
    )
      continue;
    const output = part.output as { ok?: boolean; wallet_lookup?: unknown } | undefined;
    if (output?.ok !== true) continue;
    const lookup = walletLookup.safeParse(output.wallet_lookup);
    if (lookup.success) latest.set(lookup.data.wallet_id, lookup.data.found);
  }
  return [...latest].filter(([, found]) => !found).map(([id]) => id);
}

/** Friendly tool titles: running (progressive) and finished. */
export const TOOL_TITLES: Record<ToolName, { running: string; done: string }> = {
  search_transactions: { running: 'Searching transactions', done: 'Searched transactions' },
  aggregate_transactions: { running: 'Aggregating transactions', done: 'Aggregated transactions' },
  present_visual: { running: 'Preparing visual', done: 'Prepared visual' },
};

export function isToolName(value: string): value is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(value);
}

/** `tool-search_transactions` -> `search_transactions`; null for non-tool parts. */
export function toolNameOfPart(part: { type: string }): ToolName | null {
  if (!part.type.startsWith('tool-')) return null;
  const name = part.type.slice('tool-'.length);
  return isToolName(name) ? name : null;
}

type ToolLikePart = { type: string; state?: string };

function isToolFinished(state: string | undefined): boolean {
  return state === 'output-available' || state === 'output-error' || state === 'output-denied';
}

/** Title of the most recent tool call that has not finished, for the Shimmer status line. */
export function runningToolLabel(parts: readonly ToolLikePart[]): string | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (!part) continue;
    const name = toolNameOfPart(part);
    if (name && !isToolFinished(part.state)) return TOOL_TITLES[name].running;
  }
  return null;
}

export function toolTitle(part: ToolLikePart): string {
  const name = toolNameOfPart(part);
  if (!name) return 'Tool';
  return isToolFinished(part.state) ? TOOL_TITLES[name].done : TOOL_TITLES[name].running;
}

/** Warning titles by `data-ungrounded.kind` (T-222). A missing or unknown kind gets the generic title. */
const UNGROUNDED_TITLES: Record<string, string> = {
  citation: 'Unverified citation',
  count: 'Number not verified',
  fact: "Doesn't match the record",
  speculation: 'Speculation',
  truncated: 'Answer cut off',
};
export const UNGROUNDED_FALLBACK_TITLE = 'Check this answer';

export function ungroundedTitle(kind: string | undefined | null): string {
  return (kind && UNGROUNDED_TITLES[kind]) || UNGROUNDED_FALLBACK_TITLE;
}

export interface MessageNotices {
  guard: AskDataParts['guard'] | null;
  /** Every warning part, in order, de-duplicated by kind + message. */
  ungrounded: AskDataParts['ungrounded'][];
  error: DisplayedError | null;
}

/** Pull the persistent data parts (guard / ungrounded / error) out of an assistant message. */
export function messageNotices(parts: readonly { type: string; data?: unknown }[]): MessageNotices {
  const seen = new Set<string>();
  const notices: MessageNotices = { guard: null, ungrounded: [], error: null };
  for (const part of parts) {
    if (part.type === 'data-guard') notices.guard = part.data as AskDataParts['guard'];
    else if (part.type === 'data-ungrounded') {
      const data = part.data as AskDataParts['ungrounded'];
      const key = `${data.kind ?? ''}\u0000${data.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        notices.ungrounded.push(data);
      }
    } else if (part.type === 'data-error') {
      const data = part.data as AskDataParts['error'];
      // Wording comes from the shared map so the UI and server never drift apart.
      notices.error = { ...describeAskError(data.code, data.requestId), retryable: data.retryable };
    }
  }
  return notices;
}

/** Transaction source links, deduplicated by transaction ID, in first-seen order. */
export function sourceLinks(
  parts: readonly { type: string; sourceId?: string; url?: string; title?: string }[],
): { id: string; url: string }[] {
  const seen = new Set<string>();
  const out: { id: string; url: string }[] = [];
  for (const part of parts) {
    if (part.type !== 'source-url' || !part.sourceId || !part.url) continue;
    if (seen.has(part.sourceId)) continue;
    seen.add(part.sourceId);
    out.push({ id: part.sourceId, url: part.url });
  }
  return out;
}

/** True once any visible content (text, tool, or notice) has streamed into the assistant message. */
export function hasVisibleContent(parts: readonly { type: string; text?: string }[]): boolean {
  return parts.some((p) => {
    if (p.type === 'text') return (p.text ?? '').trim().length > 0;
    return p.type.startsWith('tool-') || p.type === 'data-guard' || p.type === 'data-error';
  });
}

/**
 * Waiting for the first token: the request was sent (submitted) or the stream opened but the
 * assistant message has no visible content yet. Tool activity counts as content, because the Tool
 * card then carries the progress.
 */
export function isWaitingForFirstToken(status: ChatStatus, last: MessageLike | undefined): boolean {
  if (status === 'submitted') return true;
  if (status !== 'streaming') return false;
  if (last?.role !== 'assistant') return true;
  return !hasVisibleContent(last.parts);
}

/** Status line for the Shimmer while waiting: the transient status label wins, else the running tool. */
export function waitingStatusLine(transientLabel: string | null, last: MessageLike | undefined): string {
  if (transientLabel) return transientLabel;
  if (last?.role === 'assistant') {
    const running = runningToolLabel(last.parts);
    if (running) return running;
  }
  return 'Thinking';
}

/** One plain-text line summarising a tool result for the Tool card header area. */
export function summarizeToolOutput(output: unknown): string | null {
  if (typeof output !== 'object' || output === null) return null;
  const o = output as Record<string, unknown>;
  if (o.ok === false) {
    const err = o.error as { message?: string } | undefined;
    return `The lookup was rejected: ${err?.message ?? 'invalid arguments'}`;
  }
  if (typeof o.summary === 'string' && typeof o.kind === 'string') return o.summary;
  if (Array.isArray(o.rows)) {
    const returned = Number(o.returned ?? o.rows.length);
    const total = Number(o.total_matching ?? returned);
    const base = `${returned} of ${total} matching transaction${total === 1 ? '' : 's'} returned`;
    return o.truncated === true ? `${base} (truncated)` : base;
  }
  if (Array.isArray(o.groups)) {
    const total = Number(o.total_matching ?? 0);
    return `${total} matching transaction${total === 1 ? '' : 's'} in ${o.groups.length} group${o.groups.length === 1 ? '' : 's'}`;
  }
  return null;
}

export const PENDING_ANALYSING = 'Analysing the results…';

/**
 * Continuous-progress row (T-295): between steps. While a request is in flight and the in-progress
 * assistant message is NOT streaming text or running a tool, but HAS content (a finished tool or visual),
 * it reads "Analysing the results…". Before any content the ThinkingOrb shows instead (see progressIndicator). Null when text is streaming,
 * a tool is running (its own row shows the spinner), or the request is not in flight.
 */
export function pendingStepLabel(status: ChatStatus, last: MessageLike | undefined): string | null {
  if (status !== 'submitted' && status !== 'streaming') return null;
  if (last?.role !== 'assistant') return null; // before any part: the ThinkingOrb shows instead
  const meaningful = last.parts.filter(
    (p) => p.type !== 'step-start' && !(p.type === 'text' && !(p.text ?? '').trim()),
  );
  const tail = meaningful.at(-1);
  if (!tail) return null;
  if (tail.type === 'text') return null;
  if (toolNameOfPart(tail) && !isToolFinished(tail.state)) return null;
  return PENDING_ANALYSING;
}

export type ProgressIndicator = { kind: 'orb'; label: string } | { kind: 'pending'; label: string } | null;

/**
 * Which "still working" indicator to show. Before the assistant message has any visible content: the
 * ThinkingOrb with a Shimmer status line (the transient status label wins). After content arrives:
 * the T-295 pending row between steps. Never both.
 */
export function progressIndicator(
  status: ChatStatus,
  last: MessageLike | undefined,
  transientLabel: string | null,
): ProgressIndicator {
  if (isWaitingForFirstToken(status, last))
    return { kind: 'orb', label: waitingStatusLine(transientLabel, last) };
  const pending = pendingStepLabel(status, last);
  return pending ? { kind: 'pending', label: pending } : null;
}
