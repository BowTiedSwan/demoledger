/**
 * pnpm smoke:live: ONE real request to Workers AI (Free plan) with the seeded synthetic data,
 * exercising the tool call end to end. Prints answer, tool calls and the audit row.
 * Exits non-zero without credentials. Never part of `pnpm test`.
 */
import { createLiveHarness, hasLiveCredentials, MISSING_CREDS_MESSAGE } from '../src/orchestrator/live';

const QUESTION = 'Why did wallet WALLET-A-001 have failed transactions?';

async function main(): Promise<number> {
  if (!hasLiveCredentials()) {
    console.error(`smoke:live cannot run.\n${MISSING_CREDS_MESSAGE}`);
    return 1;
  }
  const logger = {
    debug() {},
    info: (o: Record<string, unknown>, msg?: string) =>
      msg === 'ask finished' && console.log('Usage:', JSON.stringify(o)),
    warn() {},
    error: (o: Record<string, unknown>, msg?: string) => console.error('error:', msg, JSON.stringify(o)),
    child: () => logger,
  } as Parameters<typeof createLiveHarness>[2];
  const harness = createLiveHarness(process.env, undefined, logger);
  try {
    console.log(
      `Model: ${harness.modelId}\nGuard: ${harness.deps.guard.provider}\nTimeouts: ${JSON.stringify(harness.deps.config.llm)}\nQuestion: ${QUESTION}\n`,
    );
    const r = await harness.ask(QUESTION, { tenantId: 'tenant_alpha', persist: true });
    console.log(`Answer (${r.elapsedMs} ms):\n${r.stream.text || '(empty)'}\n`);
    console.log('Tool calls:');
    for (const c of r.toolCalls) {
      console.log(
        `  step ${c.step} ${c.toolName} validated=${c.validated} rows=${c.rowCount} args=${JSON.stringify(c.rawArgs)}`,
      );
    }
    console.log('\nAudit row:', JSON.stringify(r.audit, null, 2));
    const errors = r.stream.dataParts.filter((p) => p.type === 'data-error');
    const problems: string[] = [];
    if (r.audit?.status !== 'ok') problems.push(`status=${r.audit?.status} (expected ok)`);
    if (r.toolCalls.length === 0) problems.push('the model made no tool call');
    if ((r.audit?.ungroundedIds ?? []).length > 0)
      problems.push(`ungrounded citations: ${r.audit?.ungroundedIds?.join(', ')}`);
    if (errors.length > 0) problems.push(`error part: ${JSON.stringify(errors[0])}`);
    if (problems.length > 0) {
      console.error(`\nsmoke:live FAILED: ${problems.join('; ')}`);
      return 1;
    }
    console.log('\nsmoke:live OK');
    return 0;
  } finally {
    await harness.close();
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`smoke:live FAILED: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
