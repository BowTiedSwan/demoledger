import type { Guard, GuardDecision } from '@demoledger/shared';

/** Always allows. For tests and `GUARD_PROVIDER=none` only. */
export class NoopGuard implements Guard {
  readonly provider = 'none' as const;
  readonly model = null;

  async check(): Promise<GuardDecision> {
    return { verdict: 'allow', provider: 'none', model: null, reasons: [], answers: null, latency_ms: 0 };
  }
}
