import type { Guard, GuardVerdict } from '@demoledger/shared';
import { loadJsonl, percentile } from './lib';

export interface GuardCase {
  id: string;
  category: 'benign' | 'injection' | 'cross_tenant' | 'write';
  text: string;
  expected: 'allow' | 'block';
}

export interface GuardCaseResult {
  case: GuardCase;
  verdict: GuardVerdict | 'error';
  /** What the request pipeline would do: only `block` (or closed-fail) stops the request. */
  blocked: boolean;
  latencyMs: number;
}

export interface GuardMetrics {
  total: number;
  accuracy: number;
  /** Benign prompts that were blocked / all benign prompts. */
  falseBlockRate: number;
  /** Malicious prompts that were blocked / all malicious prompts. */
  detectionRate: number;
  byCategory: Record<string, { total: number; correct: number }>;
  latencyP50: number;
  latencyP95: number;
  errors: number;
  misses: GuardCaseResult[];
}

export const loadGuardCases = (): GuardCase[] => loadJsonl<GuardCase>('guard.jsonl');

export async function runGuardCases(guard: Guard, cases: readonly GuardCase[]): Promise<GuardCaseResult[]> {
  const out: GuardCaseResult[] = [];
  for (const c of cases) {
    const t0 = performance.now();
    try {
      const d = await guard.check({ question: c.text, signal: AbortSignal.timeout(5000) });
      out.push({
        case: c,
        verdict: d.verdict,
        blocked: d.verdict === 'block',
        latencyMs: performance.now() - t0,
      });
    } catch {
      out.push({ case: c, verdict: 'error', blocked: false, latencyMs: performance.now() - t0 });
    }
  }
  return out;
}

export function guardMetrics(results: readonly GuardCaseResult[]): GuardMetrics {
  const benign = results.filter((r) => r.case.expected === 'allow');
  const malicious = results.filter((r) => r.case.expected === 'block');
  const correct = (r: GuardCaseResult) => (r.case.expected === 'block') === r.blocked;
  const byCategory: GuardMetrics['byCategory'] = {};
  for (const r of results) {
    const e = byCategory[r.case.category] ?? { total: 0, correct: 0 };
    byCategory[r.case.category] = e;
    e.total++;
    if (correct(r)) e.correct++;
  }
  const lat = results.map((r) => r.latencyMs);
  return {
    total: results.length,
    accuracy: results.filter(correct).length / Math.max(1, results.length),
    falseBlockRate: benign.filter((r) => r.blocked).length / Math.max(1, benign.length),
    detectionRate: malicious.filter((r) => r.blocked).length / Math.max(1, malicious.length),
    byCategory,
    latencyP50: percentile(lat, 50),
    latencyP95: percentile(lat, 95),
    errors: results.filter((r) => r.verdict === 'error').length,
    misses: results.filter((r) => !correct(r)),
  };
}
