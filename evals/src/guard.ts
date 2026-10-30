/** pnpm eval:guard: heuristic (offline) vs Clef-flash (skipped without credentials). */
import { createGuard } from '../../apps/api/src/guard';
import { type GuardMetrics, guardMetrics, loadGuardCases, runGuardCases } from './guard-eval';
import { pct } from './lib';

function print(name: string, m: GuardMetrics): void {
  console.log(`\n== ${name} ==`);
  console.log(
    `cases: ${m.total}   accuracy: ${pct(m.accuracy * m.total, m.total)}   false-block rate: ${pct(m.falseBlockRate * 100, 100)}   detection rate: ${pct(m.detectionRate * 100, 100)}`,
  );
  console.log(
    `latency p50 ${m.latencyP50.toFixed(2)} ms   p95 ${m.latencyP95.toFixed(2)} ms   errors ${m.errors}`,
  );
  for (const [cat, v] of Object.entries(m.byCategory))
    console.log(`  ${cat.padEnd(13)} ${v.correct}/${v.total}`);
  for (const r of m.misses)
    console.log(
      `  MISS [${r.case.id}] expected ${r.case.expected}, got ${r.verdict}: ${r.case.text.slice(0, 70)}`,
    );
}

async function main(): Promise<void> {
  const cases = loadGuardCases();
  print(
    'heuristic (offline)',
    guardMetrics(await runGuardCases(createGuard({ provider: 'heuristic' }), cases)),
  );

  const { CF_ACCOUNT_ID, CF_API_TOKEN, GUARD_MODEL, GUARD_BASE_URL } = process.env;
  if (!CF_API_TOKEN || (!CF_ACCOUNT_ID && !GUARD_BASE_URL)) {
    console.log(
      '\n== clef-flash ==\nSKIPPED: set CF_ACCOUNT_ID and CF_API_TOKEN to compare against Clef-flash (uses free Neurons).',
    );
    return;
  }
  const base = {
    provider: 'clef' as const,
    accountId: CF_ACCOUNT_ID,
    apiToken: CF_API_TOKEN,
    model: GUARD_MODEL || undefined,
    baseUrl: GUARD_BASE_URL || undefined,
  };
  const clefOnly = createGuard({ ...base, heuristic: false });
  print(`clef alone (${clefOnly.model}, no heuristic)`, guardMetrics(await runGuardCases(clefOnly, cases)));
  const production = createGuard({ ...base, heuristic: true });
  print('clef+heuristic (production)', guardMetrics(await runGuardCases(production, cases)));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
