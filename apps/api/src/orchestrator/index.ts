import {
  ASK_ERROR_MESSAGES,
  type AskDataParts,
  type AskErrorCode,
  type AskMessageMetadata,
  type AskRequest,
  type AskUITools,
  type AuditRequestStatus,
  type GuardDecision,
  latestQuestion,
  REQUEST_ID_HEADER,
  type ToolName,
} from '@demoledger/shared';
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
  type ModelMessage,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from 'ai';
import { type AuditRequestRecord, type AuditSink, createDbAudit } from '../audit';
import {
  ConversationNotFoundError,
  type ConversationStore,
  createDbConversations,
  type HistoryPair,
} from '../conversations';
import { GUARD_MESSAGES, runGuard } from '../guard';
import type { AppDeps, TenantContext } from '../lib/deps';
import { classifyLlmError } from '../llm/errors';
import {
  createRepoReader,
  type LedgerReader,
  ledgerTools,
  ToolCallRecorder,
  wrapPriorAnswer,
} from '../tools';
import { checkCountClaims, checkFacts, checkGrounding, checkSpeculation, normalizeDashes } from './grounding';
import { buildSystemPrompt, FINAL_STEP_NUDGE } from './prompt';

export { checkCountClaims, checkCounts, checkFacts, checkGrounding, checkSpeculation } from './grounding';
export { buildSystemPrompt } from './prompt';

export type AskUIMessage = UIMessage<AskMessageMetadata, AskDataParts, AskUITools>;

export interface HandleAskArgs {
  deps: AppDeps;
  /** From requireTenant (validated session + membership re-check). Never from the body. */
  tenant: TenantContext;
  requestId: string;
  body: AskRequest;
  /** Client disconnect signal (optional). */
  signal?: AbortSignal;
  /** Test seams; production uses the ledger_reader repo and the ledger_app audit writer. */
  overrides?: { reader?: LedgerReader; audit?: AuditSink; conversations?: ConversationStore };
}

/** Max consecutive-ish invalid tool calls before the loop is ended with `validation_error`. */
const MAX_VALIDATION_FAILURES = 2;

interface Outcome {
  status: AuditRequestStatus;
  errorCode?: AskErrorCode;
  /** ai_requests.error_code override (e.g. `client_aborted`, which is not a user-facing code). */
  auditErrorCode?: string;
  /** Do not send a data-error part (the client is gone). */
  silent?: boolean;
  detail?: string;
  retryable?: boolean;
}

/** `ASK_ERROR_CODES` entry for each failing audit status. */
const STATUS_TO_CODE: Partial<Record<AuditRequestStatus, AskErrorCode>> = {
  blocked: 'blocked',
  rate_limited: 'rate_limited',
  quota_exhausted: 'quota_exhausted',
  timeout: 'timeout',
  llm_error: 'llm_error',
  validation_error: 'validation_error',
  loop_limit: 'loop_limit',
};

/**
 * Model input (D-24): the last few answered pairs that THIS server stored for this user and
 * tenant, then the latest question. Client-sent history and assistant turns are never used.
 */
function historyMessages(history: readonly HistoryPair[], question: string): ModelMessage[] {
  const nonce = crypto.randomUUID().slice(0, 8);
  return [
    ...history.flatMap((p) => [
      { role: 'user' as const, content: p.question },
      // Stored answers can quote untrusted transaction text: replay them inside a delimited block.
      { role: 'assistant' as const, content: wrapPriorAnswer(p.answer, nonce) },
    ]),
    { role: 'user' as const, content: question },
  ];
}

/**
 * POST /api/ask orchestration. Returns a UI message stream response; all failures after the
 * response starts are reported as `data-error` parts, and every request writes exactly one
 * ai_requests row (blocked and failed requests included).
 */
export async function handleAsk(args: HandleAskArgs): Promise<Response> {
  const conversations = args.overrides?.conversations ?? createDbConversations(args.deps.db.app);
  const scope = {
    conversationId: args.body.conversationId,
    tenantId: args.tenant.tenantId,
    userId: args.tenant.userId,
  };
  try {
    await conversations.ensure(scope);
  } catch (e) {
    if (!(e instanceof ConversationNotFoundError)) throw e;
    // Unknown or someone else's conversation: indistinguishable, no model call, nothing leaked.
    const audit = args.overrides?.audit ?? createDbAudit(args.deps.db.app);
    await audit
      .record(
        {
          requestId: args.requestId,
          userId: args.tenant.userId,
          tenantId: args.tenant.tenantId,
          question: latestQuestion(args.body),
          status: 'blocked',
          errorCode: 'conversation_not_found',
          stepCount: 0,
        },
        [],
      )
      .catch(() => {});
    return Response.json(
      { error: { code: 'not_found', message: 'Conversation not found.', requestId: args.requestId } },
      { status: 404, headers: { [REQUEST_ID_HEADER]: args.requestId } },
    );
  }
  const stream = createUIMessageStream<AskUIMessage>({
    execute: async ({ writer }) => {
      await runAsk(args, writer, conversations, scope);
    },
    onError: () => ASK_ERROR_MESSAGES.internal_error,
  });
  return createUIMessageStreamResponse({ stream, headers: { [REQUEST_ID_HEADER]: args.requestId } });
}

type Writer = Parameters<Parameters<typeof createUIMessageStream<AskUIMessage>>[0]['execute']>[0]['writer'];

async function runAsk(
  args: HandleAskArgs,
  writer: Writer,
  conversations: ConversationStore,
  scope: { conversationId: string; tenantId: string; userId: string },
): Promise<void> {
  const { deps, tenant, requestId, body } = args;
  const startedAt = performance.now();
  const question = latestQuestion(body);
  const log = deps.logger.child({ requestId, tenantId: tenant.tenantId, userId: tenant.userId });
  const audit = args.overrides?.audit ?? createDbAudit(deps.db.app);
  const recorder = new ToolCallRecorder(requestId);
  const cfg = deps.config;

  let guardDecision: GuardDecision | null = null;
  let stepCount = 0;
  let inputTokens: number | null = null;
  let reasoningTokens = 0;
  let outputTokens: number | null = null;
  let cited: string[] = [];
  let ungrounded: string[] = [];
  let answerText = '';
  /** false when the answer raised a citation/count/fact/speculation warning: it is not stored as context. */
  let answerStorable = true;
  let finished = false;

  const baseMeta = (): AskMessageMetadata => ({
    requestId,
    ...(deps.llm ? { model: deps.llm.modelId } : {}),
  });

  const finish = async (outcome: Outcome): Promise<void> => {
    if (finished) return;
    finished = true;
    const latencyMs = Math.round(performance.now() - startedAt);
    const code = outcome.errorCode ?? STATUS_TO_CODE[outcome.status];
    if (code && outcome.status !== 'blocked' && !outcome.silent) {
      writer.write({
        type: 'data-error',
        data: {
          code,
          message: ASK_ERROR_MESSAGES[code],
          requestId,
          retryable:
            outcome.retryable ?? (code === 'rate_limited' || code === 'timeout' || code === 'llm_error'),
        },
      });
    }
    writer.write({
      type: 'finish',
      messageMetadata: { ...baseMeta(), stepCount, latencyMs },
    });
    const record: AuditRequestRecord = {
      requestId,
      userId: tenant.userId,
      tenantId: tenant.tenantId,
      question,
      provider: deps.llm?.provider ?? null,
      model: deps.llm?.modelId ?? null,
      status: outcome.status,
      errorCode: outcome.auditErrorCode ?? code ?? null,
      errorDetail: outcome.detail?.slice(0, 500) ?? null,
      stepCount,
      latencyMs,
      inputTokens,
      outputTokens,
      guardProvider: guardDecision?.provider ?? null,
      guardModel: guardDecision?.model ?? null,
      guardVerdict: guardDecision?.verdict ?? null,
      guardAnswers: guardDecision ? { reasons: guardDecision.reasons, answers: guardDecision.answers } : null,
      guardLatencyMs: guardDecision?.latency_ms ?? null,
      citedIds: cited,
      ungroundedIds: ungrounded,
    };
    try {
      await audit.record(record, recorder.calls);
    } catch (e) {
      log.error({ err: e instanceof Error ? e.message : String(e) }, 'audit write failed');
    }
    // Only successful, complete answers become conversation context.
    if (
      (outcome.status === 'ok' || outcome.status === 'no_results') &&
      answerStorable &&
      answerText.trim().length > 0
    ) {
      try {
        await conversations.appendTurn(scope, { requestId, question, answer: answerText });
      } catch (e) {
        log.error({ err: e instanceof Error ? e.message : String(e) }, 'conversation write failed');
      }
    }
    log.info(
      {
        status: outcome.status,
        stepCount,
        latencyMs,
        tools: recorder.calls.length,
        inputTokens,
        outputTokens,
        reasoningTokens,
      },
      'ask finished',
    );
  };

  try {
    writer.write({ type: 'start', messageMetadata: baseMeta() });

    /* 1. Guard (before any LLM call). Blocked requests never reach the model. */
    writer.write({
      type: 'data-status',
      transient: true,
      data: { phase: 'guard', label: 'Checking request' },
    });
    // The guard judges the question the model will actually see (the latest turn).
    const guarded = await runGuard(deps.guard, question, {
      timeoutMs: cfg.guard.timeoutMs,
      failMode: cfg.guard.failMode,
    });
    guardDecision = guarded.decision;
    if (!guarded.proceed) {
      const verdict = guarded.decision.verdict;
      writer.write({ type: 'data-guard', data: { verdict, message: GUARD_MESSAGES[verdict] } });
      await finish({
        status: 'blocked',
        errorCode: 'blocked',
        detail: guarded.decision.reasons.join(',').slice(0, 300),
        retryable: verdict === 'unavailable',
      });
      return;
    }

    /* 2. LLM availability. */
    if (!deps.llm) {
      await finish({
        status: 'llm_error',
        errorCode: 'llm_unconfigured',
        detail: 'CF_* credentials absent',
        retryable: false,
      });
      return;
    }

    /* 3. Tool loop. */
    const tools = ledgerTools({
      tenantId: tenant.tenantId,
      requestId,
      writer,
      now: deps.now,
      reader: args.overrides?.reader ?? createRepoReader(deps.db.reader),
      recorder,
    });
    const { maxSteps, maxRetries, requestTimeoutMs, stepTimeoutMs } = cfg.llm;
    const maxOutputTokens = cfg.llm.maxOutputTokens ?? 2048;
    const timeoutSignal = AbortSignal.timeout(requestTimeoutMs);
    const abortSignal = args.signal ? AbortSignal.any([timeoutSignal, args.signal]) : timeoutSignal;
    let history: HistoryPair[] = [];
    try {
      history = await conversations.loadHistory(scope);
    } catch (e) {
      log.warn({ err: e instanceof Error ? e.message : String(e) }, 'conversation history unavailable');
    }
    const instructions = buildSystemPrompt(deps.now());

    let streamError: unknown;
    let lastFinishReason: string | undefined;
    let text = '';

    const result = streamText({
      model: deps.llm.model,
      instructions,
      messages: historyMessages(history, question),
      tools,
      maxRetries,
      abortSignal,
      maxOutputTokens,
      // Tool queries are bounded by the pool's statement_timeout (DB_STATEMENT_TIMEOUT_MS), not by the signal.
      // Idle-based, not a wall-clock step cap: a step that keeps streaming is never killed.
      // firstChunkMs bounds the wait for the first output; chunkMs the gap between outputs.
      // The whole request is bounded by requestTimeoutMs (abortSignal above).
      timeout: { firstChunkMs: stepTimeoutMs, chunkMs: Math.min(stepTimeoutMs, 15_000) },
      stopWhen: [isStepCount(maxSteps), () => recorder.validationFailures >= MAX_VALIDATION_FAILURES],
      prepareStep: ({ stepNumber }) => {
        recorder.currentStep = stepNumber;
        writer.write({
          type: 'data-status',
          transient: true,
          data: { phase: 'thinking', label: 'Thinking' },
        });
        if (stepNumber >= maxSteps - 1) {
          // Clear the tools and nudge (small models ignore toolChoice 'none'; a stray call then becomes an invalid, audited call).
          return {
            activeTools: [],
            toolChoice: 'none',
            instructions: `${instructions}\n\n${FINAL_STEP_NUDGE}`,
          };
        }
        return undefined;
      },
      onToolExecutionStart: (e) => {
        const name = e.toolCall.toolName as ToolName;
        writer.write({
          type: 'data-status',
          transient: true,
          data: {
            phase: 'tool',
            tool: name,
            label:
              name === 'search_transactions'
                ? 'Searching transactions'
                : name === 'aggregate_transactions'
                  ? 'Aggregating transactions'
                  : 'Preparing the chart',
          },
        });
      },
      onStepEnd: (step) => {
        stepCount++;
        lastFinishReason = step.finishReason;
        // The SDK answers unknown-tool and malformed-input calls with a tool-error and never
        // calls execute, so audit them here and count them toward the validation cap.
        for (const call of step.toolCalls) {
          const c = call as { invalid?: boolean; toolName: string; input: unknown; error?: unknown };
          if (!c.invalid) continue;
          recorder.validationFailures++;
          const err = c.error as { name?: string; message?: string } | undefined;
          recorder.add({
            toolName: String(c.toolName).slice(0, 100),
            rawArgs: (c.input ?? null) as never,
            validated: false,
            validationError:
              `${err?.name ?? 'InvalidToolCall'}: ${err?.message ?? 'invalid tool call'}`.slice(0, 1000),
            rowCount: null,
            returnedIds: [],
            latencyMs: null,
          });
        }
        inputTokens = (inputTokens ?? 0) + (step.usage.inputTokens ?? 0);
        outputTokens = (outputTokens ?? 0) + (step.usage.outputTokens ?? 0);
        reasoningTokens += step.usage.outputTokenDetails?.reasoningTokens ?? 0;
      },
      onError: ({ error }) => {
        streamError ??= error;
      },
    });

    const ui = toUIMessageStream({
      stream: result.stream,
      tools,
      sendStart: false,
      sendFinish: false,
      sendReasoning: false,
      onError: () => ASK_ERROR_MESSAGES.llm_error,
    });
    try {
      for await (const chunk of ui) {
        if (chunk.type === 'abort') {
          // Step/request timeouts and client disconnects surface as an abort chunk.
          const reason = String((chunk as { reason?: unknown }).reason ?? 'aborted');
          streamError ??= Object.assign(new Error(reason), {
            name: /timeout/i.test(reason) ? 'TimeoutError' : 'AbortError',
          });
          continue;
        }
        if (chunk.type === 'error') {
          streamError ??= new Error('stream error chunk');
          continue; // never forward raw provider error text to the client
        }
        if (chunk.type === 'text-delta') text += chunk.delta;
        writer.write(chunk as never);
      }
    } catch (e) {
      streamError ??= e;
    }

    /* 4. Map the outcome. */
    if (streamError !== undefined || (abortSignal.aborted && text.length === 0)) {
      const c = classifyLlmError(streamError, { requestTimedOut: timeoutSignal.aborted });
      const clientAborted = args.signal?.aborted && !timeoutSignal.aborted;
      await finish({
        status: clientAborted ? 'llm_error' : c.status,
        errorCode: clientAborted ? 'llm_error' : c.code,
        ...(clientAborted ? { auditErrorCode: 'client_aborted', silent: true } : {}),
        detail: clientAborted ? 'client aborted the request' : c.detail,
        retryable: c.retryable,
      });
      return;
    }

    const checked = normalizeDashes(text);
    ({ cited, ungrounded } = ((g) => ({ cited: g.cited, ungrounded: g.ungrounded }))(
      checkGrounding(checked, recorder.returnedIds),
    ));
    // gpt-oss sometimes leaks its raw tool-call markup (<|start|>assistant to=functions ...) as text.
    if (/<\|[a-z_]+\|>/.test(text)) {
      await finish({
        status: 'llm_error',
        errorCode: 'llm_error',
        auditErrorCode: 'malformed_output',
        detail: 'model emitted raw tool-call control tokens as text',
        retryable: true,
      });
      return;
    }
    // The model stopped because it hit the output cap: the visible answer is incomplete.
    const truncated = lastFinishReason === 'length' && text.trim().length > 0;
    const countClaims = recorder.successfulCalls > 0 ? checkCountClaims(checked, recorder.countFacts) : [];
    const badCounts = [...new Set(countClaims.map((c) => c.n))];
    const badFacts = recorder.successfulCalls > 0 ? checkFacts(checked, recorder.rowFacts) : [];
    const speculation = recorder.successfulCalls > 0 ? checkSpeculation(checked, recorder.rowFacts) : [];

    // One warning part per kind, each carrying the server facts needed to verify it.
    type Warning = {
      kind: 'citation' | 'count' | 'fact' | 'speculation' | 'truncated';
      ids: string[];
      message: string;
    };
    const warnings: Warning[] = [];
    if (ungrounded.length > 0) {
      warnings.push({
        kind: 'citation',
        ids: ungrounded,
        message: `The answer mentions ${ungrounded.join(', ')}, which the lookups did not return. Treat these citations as unverified.`,
      });
    }
    if (countClaims.length > 0) {
      const stated = countClaims.map((c) => (c.qualifier ? `${c.n} ${c.qualifier}` : String(c.n)));
      const uncounted = [
        ...new Set(countClaims.map((c) => c.qualifier).filter((q): q is string => !!q)),
      ].filter((q) => !recorder.countedQualifiers.has(q));
      warnings.push({
        kind: 'count',
        ids: [],
        message:
          `The answer states ${stated.join(', ')} as a number of transactions, but the lookups returned: ${recorder.countNotes.join('; ')}.` +
          (uncounted.length > 0 ? ` No lookup counted ${uncounted.join(' or ')} transactions.` : ''),
      });
    }
    if (badFacts.length > 0) {
      const detail = badFacts.map((f) => {
        if (f.startsWith('reason:')) {
          const reason = f.slice('reason:'.length);
          const ids = [...recorder.rowFacts].filter(([, r]) => r.failure_reason === reason).map(([id]) => id);
          return `${reason} is recorded for ${ids.join(', ') || 'returned rows'}`;
        }
        const r = recorder.rowFacts.get(f);
        return `${f}: recorded reason is ${r?.failure_reason ?? 'not recorded'}`;
      });
      warnings.push({
        kind: 'fact',
        ids: [],
        message: `A stated failure reason does not match the record (${detail.join('; ')}).`,
      });
    }
    if (speculation.length > 0) {
      const named = speculation.filter((x) => x !== 'general');
      warnings.push({
        kind: 'speculation',
        ids: [],
        message: `This answer speculates beyond the recorded failure reasons${named.length > 0 ? ` (see ${named.join(', ')})` : ''}.`,
      });
    }
    if (truncated)
      warnings.push({ kind: 'truncated', ids: [], message: 'This answer was cut off before it finished.' });
    for (const w of warnings) writer.write({ type: 'data-ungrounded', data: w });
    answerStorable = !warnings.some((w) => w.kind !== 'truncated');

    if (text.trim().length === 0) {
      if (lastFinishReason === 'tool-calls') {
        const validation = recorder.validationFailures >= MAX_VALIDATION_FAILURES && stepCount < maxSteps;
        await finish({
          status: validation ? 'validation_error' : 'loop_limit',
          detail: validation ? 'repeated invalid tool arguments' : `no final answer after ${stepCount} steps`,
        });
      } else {
        await finish({ status: 'llm_error', detail: 'model returned an empty answer', retryable: true });
      }
      return;
    }

    if (truncated) {
      await finish({
        status: 'llm_error',
        errorCode: 'llm_error',
        auditErrorCode: 'truncated',
        silent: true,
        detail: `finish_reason=length after ${outputTokens ?? '?'} output tokens (cap ${maxOutputTokens})`,
        retryable: true,
      });
      return;
    }
    answerText = text;
    const noResults = recorder.successfulCalls > 0 && !recorder.matchedRows;
    const mismatchDetail = [
      badCounts.length > 0 ? `count_mismatch:${badCounts.join(',')}` : '',
      badFacts.length > 0 ? `fact_mismatch:${badFacts.join(',')}` : '',
      speculation.length > 0 ? `speculation:${speculation.join(',')}` : '',
    ]
      .filter(Boolean)
      .join(';');
    await finish({
      status: noResults ? 'no_results' : 'ok',
      ...(mismatchDetail ? { detail: mismatchDetail } : {}),
    });
  } catch (e) {
    log.error({ err: e instanceof Error ? e.message : String(e) }, 'ask failed unexpectedly');
    await finish({
      status: 'llm_error',
      errorCode: 'internal_error',
      detail: e instanceof Error ? e.name : 'unknown',
      retryable: true,
    });
  }
}
