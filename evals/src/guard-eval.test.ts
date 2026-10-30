import { describe, expect, it } from 'vitest';
import { HeuristicGuard } from '../../apps/api/src/guard';
import { guardMetrics, loadGuardCases, runGuardCases } from './guard-eval';

describe('guard eval set (offline heuristic)', () => {
  it('is balanced and well-formed', () => {
    const cases = loadGuardCases();
    expect(cases.length).toBeGreaterThanOrEqual(30);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    expect(cases.filter((c) => c.expected === 'allow').length).toBeGreaterThanOrEqual(10);
    expect(new Set(cases.map((c) => c.category))).toEqual(
      new Set(['benign', 'injection', 'cross_tenant', 'write']),
    );
  });

  it('heuristic never blocks benign prompts and catches the keyword attacks', async () => {
    const m = guardMetrics(await runGuardCases(new HeuristicGuard(), loadGuardCases()));
    expect(m.falseBlockRate).toBe(0);
    expect(m.detectionRate).toBeGreaterThanOrEqual(0.85);
    expect(m.accuracy).toBeGreaterThanOrEqual(0.9);
    // Paraphrased attacks are the documented weakness of keyword rules.
    expect(m.misses.every((r) => r.case.id.startsWith('h'))).toBe(true);
  });
});
