import { z } from 'zod';
import { guardVerdict, toolName } from './enums';
import { validationIssue } from './errors';
import { transactionId, walletId } from './ids';
import { aggregateResponse, appliedRange, transactionDTO } from './transactions';
import { type PresentVisualResult, visualDataPart } from './visual';

/* ------------------------------------------------------------------------- */
/* POST /api/ask request body                                                 */
/* ------------------------------------------------------------------------- */

export const ASK_LIMITS = {
  maxMessages: 20,
  maxPartsPerMessage: 50,
  /** Latest user question. */
  maxQuestionChars: 2000,
  /** All text parts across the history. */
  maxTotalTextChars: 16_000,
} as const;

/**
 * Server-stored conversation history (D-24): at most this many earlier answered
 * question/answer pairs are replayed to the model, newest last.
 */
export const ASK_HISTORY_MAX_PAIRS = 3;
/** Each replayed stored answer is truncated to this many characters. */
export const ASK_HISTORY_ANSWER_MAX_CHARS = 2000;

/** Loose UI message part: only `type` is checked here; unknown part types are ignored by the server. */
const askUIPart = z.looseObject({ type: z.string().max(64) });

/**
 * A client-supplied AI SDK UIMessage. `system` messages are rejected.
 * Trust rule: the server uses ONLY `text` parts from this history. Tool, source and
 * data parts sent by the client are dropped — evidence comes solely from tool calls
 * executed in the current request.
 */
export const askUIMessage = z.object({
  id: z.string().max(128),
  role: z.enum(['user', 'assistant']),
  parts: z.array(askUIPart).max(ASK_LIMITS.maxPartsPerMessage),
  metadata: z.unknown().optional(),
});
export type AskUIMessageInput = z.infer<typeof askUIMessage>;

type PartLike = { type: string; [k: string]: unknown };

/** Concatenate the `text` parts of a message. */
export function textOfParts(parts: readonly PartLike[]): string {
  return parts
    .filter((p): p is PartLike & { text: string } => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join('\n');
}

/**
 * Body sent by `useChat`'s default HTTP transport: `{ id, messages, trigger, messageId }`.
 * Not strict, because the transport may add fields; extra fields are stripped.
 */
export const askRequest = z
  .object({
    /**
     * Client-generated conversation ID (UUID). The server loads that conversation's stored,
     * server-produced answered pairs for this user and tenant (D-24). The model still gets only
     * the LAST user message's text from the request body; earlier client-sent messages are ignored.
     */
    conversationId: z.string().uuid(),
    id: z.string().max(128).optional(),
    messages: z.array(askUIMessage).min(1).max(ASK_LIMITS.maxMessages),
    trigger: z.enum(['submit-message', 'regenerate-message']).optional(),
    messageId: z.string().max(128).optional(),
  })
  .superRefine((body, ctx) => {
    const last = body.messages.at(-1);
    if (last?.role !== 'user') {
      ctx.addIssue({
        code: 'custom',
        path: ['messages'],
        message: 'The last message must be from the user.',
      });
      return;
    }
    const question = textOfParts(last.parts).trim();
    if (question.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['messages'], message: 'The question is empty.' });
    } else if (question.length > ASK_LIMITS.maxQuestionChars) {
      ctx.addIssue({
        code: 'custom',
        path: ['messages'],
        message: `The question must be at most ${ASK_LIMITS.maxQuestionChars} characters.`,
      });
    }
    const total = body.messages.reduce((n, m) => n + textOfParts(m.parts).length, 0);
    if (total > ASK_LIMITS.maxTotalTextChars) {
      ctx.addIssue({
        code: 'custom',
        path: ['messages'],
        message: `The conversation is too long (max ${ASK_LIMITS.maxTotalTextChars} characters). Start a new chat.`,
      });
    }
  });
export type AskRequest = z.infer<typeof askRequest>;

/** The trimmed text of the latest user message (askRequest guarantees it exists). */
export function latestQuestion(body: AskRequest): string {
  const last = body.messages.at(-1);
  return last ? textOfParts(last.parts).trim() : '';
}

/* ------------------------------------------------------------------------- */
/* Stream: error codes, custom data parts, metadata                           */
/* ------------------------------------------------------------------------- */

/** Codes carried by `data-error` parts and ai_requests.error_code. */
export const ASK_ERROR_CODES = [
  'blocked',
  'rate_limited',
  'quota_exhausted',
  'timeout',
  'llm_error',
  'llm_unconfigured',
  'validation_error',
  'loop_limit',
  'internal_error',
] as const;
export const askErrorCode = z.enum(ASK_ERROR_CODES);
export type AskErrorCode = z.infer<typeof askErrorCode>;

/** Default user-facing copy. The server sends it in `data-error.message`; the UI may reuse it. */
export const ASK_ERROR_MESSAGES: Readonly<Record<AskErrorCode, string>> = {
  blocked: 'This request was blocked. The assistant can only look up and summarise transactions.',
  rate_limited: 'The AI provider is rate limiting requests. Wait a moment and try again.',
  quota_exhausted: 'The free daily AI allowance is used up. Try again after 00:00 UTC.',
  timeout: 'The assistant took too long to answer. Try a narrower question.',
  llm_error: 'The AI provider returned an error. Try again.',
  llm_unconfigured:
    'The AI provider is not configured on this server (missing CF_ACCOUNT_ID / CF_API_TOKEN).',
  validation_error: 'The assistant could not build a valid lookup for this question. Try rephrasing it.',
  loop_limit: 'The assistant reached its step limit before finishing. Try a more specific question.',
  internal_error: 'Something went wrong on the server. Try again.',
};

/** Data part payload schemas, keyed by name (part type = `data-<name>`). */
export const askDataPartSchemas = {
  /** Guard refused the question; it never reached the LLM. Persistent part. */
  guard: z.object({
    verdict: guardVerdict,
    message: z.string(),
  }),
  /**
   * A warning about the answer's content. Persistent. `kind` says what was checked (optional for
   * backward compatibility; absent = `citation`). `ids` are the unverified citations (only for
   * `citation`; empty otherwise).
   */
  ungrounded: z.object({
    ids: z.array(transactionId),
    message: z.string(),
    kind: z.enum(['citation', 'count', 'fact', 'speculation', 'truncated']).optional(),
  }),
  /** Terminal error for this request. Persistent. */
  error: z.object({
    code: askErrorCode,
    message: z.string(),
    requestId: z.string(),
    retryable: z.boolean(),
  }),
  /** Progress line for the Shimmer status. Sent with `transient: true` (only via onData). */
  /** Server-built json-render spec for `present_visual` (D-26). Persistent. */
  visual: visualDataPart,
  status: z.object({
    phase: z.enum(['guard', 'thinking', 'tool', 'answering']),
    label: z.string(),
    tool: toolName.optional(),
  }),
};

/** Use as the DATA_PARTS generic: `UIMessage<AskMessageMetadata, AskDataParts, AskUITools>`. */
export type AskDataParts = {
  [K in keyof typeof askDataPartSchemas]: z.infer<(typeof askDataPartSchemas)[K]>;
};

/** Message metadata attached to the assistant message (start/finish chunks). */
export const askMessageMetadata = z.object({
  requestId: z.string(),
  model: z.string().optional(),
  stepCount: z.number().int().nonnegative().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
});
export type AskMessageMetadata = z.infer<typeof askMessageMetadata>;

/* ------------------------------------------------------------------------- */
/* Tool results (what the model receives; also rendered by the Tool UI)       */
/* ------------------------------------------------------------------------- */

/** Returned (not thrown) for invalid args so the model can correct once. No query runs. */
export const toolErrorResult = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.enum(['validation_error', 'tool_error']),
    message: z.string(),
    issues: z.array(validationIssue),
  }),
});
export type ToolErrorResult = z.infer<typeof toolErrorResult>;

/** Presence in this tenant's ledger, checked without the query's other filters. */
export const walletLookup = z.strictObject({ wallet_id: walletId, found: z.boolean() });
export type WalletLookup = z.infer<typeof walletLookup>;
export const WALLET_NOT_FOUND_TITLE = "Wallet not found in your organization's ledger";
export const WALLET_NOT_FOUND_MESSAGE =
  'No ledger records exist for this wallet in your organization. Check the wallet ID in Transactions and try again.';

export const searchTransactionsResult = z.object({
  ok: z.literal(true),
  rows: z.array(transactionDTO),
  returned: z.number().int().nonnegative(),
  total_matching: z.number().int().nonnegative(),
  truncated: z.boolean(),
  applied_range: appliedRange,
  wallet_lookup: walletLookup.optional(),
});
export type SearchTransactionsResult = z.infer<typeof searchTransactionsResult>;

export const aggregateTransactionsResult = aggregateResponse.extend({
  ok: z.literal(true),
  wallet_lookup: walletLookup.optional(),
});
export type AggregateTransactionsResult = z.infer<typeof aggregateTransactionsResult>;

/**
 * Use as the TOOLS generic of UIMessage. `input` is the raw model-proposed args
 * (may be invalid — validation happens inside the tool and is audited).
 */
export type AskUITools = {
  search_transactions: {
    input: Record<string, unknown>;
    output: SearchTransactionsResult | ToolErrorResult;
  };
  aggregate_transactions: {
    input: Record<string, unknown>;
    output: AggregateTransactionsResult | ToolErrorResult;
  };
  present_visual: {
    input: Record<string, unknown>;
    output: PresentVisualResult | ToolErrorResult;
  };
};

/**
 * Each returned transaction ID is streamed once per request as a `source-url` part:
 * `{ type: 'source-url', sourceId: <transaction_id>, url: transactionSourceUrl(id), title: <transaction_id> }`.
 */
export function transactionSourceUrl(id: string): string {
  return `/transactions?id=${encodeURIComponent(id)}`;
}
