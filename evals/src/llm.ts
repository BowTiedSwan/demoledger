/**
 * pnpm eval:llm: runs evals/questions.jsonl through the real orchestrator against Workers AI
 * for each model in LLM_EVAL_MODELS (comma list; default LLM_MODEL). Skips without credentials.
 * Needs the dev database seeded (pnpm db:up && pnpm db:reset). Uses the free 10,000 Neurons/day.
 */
import {
  createLiveHarness,
  hasLiveCredentials,
  MISSING_CREDS_MESSAGE,
} from '../../apps/api/src/orchestrator/live';
import { loadJsonl, pct, percentile } from './lib';

interface Question {
  id: string;
  question: string;
  expected_tool: string | null;
  expected_args: Record<string, unknown>;
  expects_citations: boolean;
  /** Two-turn case: this question is asked first, in the same conversation. */
  setup?: string;
  /** Argument names the first tool call must NOT carry over from the setup turn. */
  forbidden_args?: string[];
  /** Tool that must be called after the first one (visual questions: present_visual). */
  expected_then?: string;
  /** Argument names the first tool call must contain. */
  required_args?: string[];
}

const subset = (expected: Record<string, unknown>, actual: unknown): boolean =>
  typeof actual === 'object' &&
  actual !== null &&
  Object.entries(expected).every(([k, v]) => (actual as Record<string, unknown>)[k] === v);

/** Characters outside Latin/Common/Inherited scripts (CJK, Cyrillic, Arabic, ...), counted only. */
const ODD_CURRENCY = /(?![$€£¥])\p{Sc}/gu;
const NON_LATIN = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/gu;

async function evalModel(model: string, questions: Question[]): Promise<void> {
  const h = createLiveHarness(process.env, model);
  try {
    let toolOk = 0,
      toolTotal = 0,
      argsOk = 0,
      argsTotal = 0,
      validCalls = 0,
      allCalls = 0,
      grounded = 0,
      answered = 0,
      okStatus = 0,
      factOk = 0,
      timeouts = 0,
      truncated = 0,
      nonLatinChars = 0,
      nonLatinAnswers = 0,
      oddCurrency = 0,
      inTok = 0,
      outTok = 0;
    const lat: number[] = [];
    for (const q of questions) {
      const conversationId = crypto.randomUUID();
      if (q.setup) await h.ask(q.setup, { conversationId });
      const r = await h.ask(q.question, { conversationId });
      lat.push(r.elapsedMs);
      const first = r.toolCalls[0];
      if (q.expected_tool) {
        toolTotal++;
        const thenOk =
          !q.expected_then ||
          r.toolCalls.some((c, i) => i > 0 && c.toolName === q.expected_then && c.validated);
        if (!thenOk) console.log(`    expected ${q.expected_then} after ${q.expected_tool} in [${q.id}]`);
        if (first?.toolName === q.expected_tool && thenOk) toolOk++;
        argsTotal++;
        const raw = (first?.rawArgs ?? {}) as Record<string, unknown>;
        const carried = (q.forbidden_args ?? []).filter((k) => k in raw);
        const missing = (q.required_args ?? []).filter((k) => !(k in raw));
        if (carried.length > 0) console.log(`    carried-over filter(s) in [${q.id}]: ${carried.join(', ')}`);
        if (first && subset(q.expected_args, first.rawArgs) && carried.length === 0 && missing.length === 0)
          argsOk++;
      } else if (r.toolCalls.length === 0 || r.audit?.status === 'blocked') {
        toolOk++;
        toolTotal++;
      } else toolTotal++;
      allCalls += r.toolCalls.length;
      validCalls += r.toolCalls.filter((c) => c.validated).length;
      if (r.stream.text) {
        answered++;
        if ((r.audit?.ungroundedIds ?? []).length === 0) grounded++;
        if (!/mismatch/.test(r.audit?.errorDetail ?? '')) factOk++;
      }
      if (r.audit?.status === 'ok' || r.audit?.status === 'no_results') okStatus++;
      if (r.audit?.status === 'timeout') timeouts++;
      if (r.audit?.errorCode === 'truncated') truncated++;
      const odd = r.stream.text.match(NON_LATIN) ?? [];
      nonLatinChars += odd.length;
      if (odd.length > 0) {
        nonLatinAnswers++;
        console.log(`    non-Latin in [${q.id}]: ${[...new Set(odd)].join(' ')}`);
      }
      const cur = r.stream.text.match(ODD_CURRENCY) ?? [];
      oddCurrency += cur.length;
      if (cur.length > 0)
        console.log(`    unexpected currency symbol in [${q.id}]: ${[...new Set(cur)].join(' ')}`);
      inTok += r.audit?.inputTokens ?? 0;
      outTok += r.audit?.outputTokens ?? 0;
      console.log(
        `  [${q.id}] ${r.audit?.status} tool=${first?.toolName ?? '-'} steps=${r.audit?.stepCount} ${r.elapsedMs}ms${r.audit?.errorDetail ? ` [${r.audit.errorDetail}]` : ''}`,
      );
    }
    console.log(`\nModel ${model}  (reasoning effort: ${process.env.LLM_REASONING_EFFORT || 'default low'})`);
    console.log(`  tool-choice accuracy : ${pct(toolOk, toolTotal)}`);
    console.log(`  key-argument accuracy: ${pct(argsOk, argsTotal)}`);
    console.log(`  valid-args rate      : ${pct(validCalls, allCalls)}`);
    console.log(`  grounded-citation    : ${pct(grounded, answered)} of answered requests`);
    console.log(
      `  fact accuracy        : ${pct(factOk, answered)} of answered requests (no count/fact mismatch)`,
    );
    console.log(`  timeouts             : ${timeouts}`);
    console.log(`  truncated (length)   : ${truncated} answers cut off by the output cap`);
    console.log(
      `  non-Latin characters : ${nonLatinChars} in ${nonLatinAnswers} of ${answered} answers (counted, not filtered)`,
    );
    console.log(`  odd currency symbols : ${oddCurrency} (anything but $ € £ ¥)`);
    const ran = questions.length - 1; // q14 is blocked before the model
    console.log(
      `  tokens per question  : input ${Math.round(inTok / ran)}, output ${Math.round(outTok / ran)} (mean over ${ran} model requests; input ${inTok}, output ${outTok} total)`,
    );
    console.log(`  ok/no_results status : ${pct(okStatus, questions.length)}`);
    console.log(`  latency p50 / p95    : ${percentile(lat, 50)} ms / ${percentile(lat, 95)} ms`);
  } finally {
    await h.close();
  }
}

async function main(): Promise<void> {
  if (!hasLiveCredentials()) {
    console.log(`eval:llm SKIPPED. ${MISSING_CREDS_MESSAGE}`);
    return;
  }
  const questions = loadJsonl<Question>('questions.jsonl');
  const models = (process.env.LLM_EVAL_MODELS || process.env.LLM_MODEL || '@cf/zai-org/glm-4.7-flash')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const m of models) await evalModel(m, questions);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
