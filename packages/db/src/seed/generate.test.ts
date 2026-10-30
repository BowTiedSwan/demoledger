import { DAY_MS, resolvePeriod, startOfUtcDay } from '@demoledger/shared';
import { describe, expect, it } from 'vitest';
import { SEED_COUNTS, SEED_TEST_ANCHOR, SEED_WALLETS } from './constants';
import { generateTransactions } from './generate';

const anchor = new Date(SEED_TEST_ANCHOR);
const NOW = new Date('2026-10-28T12:00:00Z');
const all = generateTransactions(anchor);
const alpha = all.filter((t) => t.tenantId === 'tenant_alpha');
const beta = all.filter((t) => t.tenantId === 'tenant_beta');
const inRange = (t: { occurredAt: Date }, r: { from: Date; to: Date }) =>
  t.occurredAt >= r.from && t.occurredAt < r.to;

describe('generateTransactions', () => {
  it('is deterministic', () => {
    expect(generateTransactions(anchor)).toEqual(generateTransactions(new Date(SEED_TEST_ANCHOR)));
  });

  it('produces 56 alpha + 44 beta with unique, correctly formatted ids', () => {
    expect(alpha).toHaveLength(SEED_COUNTS.alpha);
    expect(beta).toHaveLength(SEED_COUNTS.beta);
    expect(new Set(all.map((t) => t.transactionId)).size).toBe(100);
    expect(alpha.every((t) => /^TXN-A-\d{4}$/.test(t.transactionId))).toBe(true);
    expect(beta.every((t) => /^TXN-B-\d{4}$/.test(t.transactionId))).toBe(true);
  });

  it('uses only the documented wallets with their currencies, tenant-consistent', () => {
    for (const t of all) {
      const w = SEED_WALLETS.find((x) => x.walletId === t.walletId);
      expect(w, t.walletId).toBeDefined();
      expect(w?.tenantId).toBe(t.tenantId);
      expect(w?.currency).toBe(t.currency);
    }
  });

  it('stores positive integer minor units', () => {
    for (const t of all) {
      expect(Number.isInteger(t.amountMinor)).toBe(true);
      expect(t.amountMinor).toBeGreaterThan(0);
    }
  });

  it('has the status mix: 70 completed, 14 pending, 16 failed (>=6 failed per tenant)', () => {
    const count = (xs: typeof all, s: string) => xs.filter((t) => t.status === s).length;
    expect(count(all, 'completed')).toBe(70);
    expect(count(all, 'pending')).toBe(14);
    expect(count(all, 'failed')).toBe(SEED_COUNTS.failed);
    expect(count(alpha, 'failed')).toBeGreaterThanOrEqual(6);
    expect(count(beta, 'failed')).toBeGreaterThanOrEqual(6);
  });

  it('only failed rows carry a failure_reason', () => {
    expect(all.filter((t) => t.status !== 'failed').every((t) => t.failureReason === null)).toBe(true);
  });

  it('WALLET-A-001 has >=4 failed: >=3 with a reason and >=1 without', () => {
    const f = alpha.filter((t) => t.walletId === 'WALLET-A-001' && t.status === 'failed');
    expect(f.length).toBeGreaterThanOrEqual(4);
    expect(f.filter((t) => t.failureReason !== null).length).toBeGreaterThanOrEqual(3);
    expect(f.filter((t) => t.failureReason === null).length).toBeGreaterThanOrEqual(1);
  });

  it('has >=3 alpha and >=2 beta failed transactions yesterday (UTC)', () => {
    const y = resolvePeriod('yesterday', NOW);
    const failedYesterday = (xs: typeof all) =>
      xs.filter((t) => t.status === 'failed' && inRange(t, y)).length;
    expect(failedYesterday(alpha)).toBeGreaterThanOrEqual(3);
    expect(failedYesterday(beta)).toBeGreaterThanOrEqual(2);
  });

  it('has >=6 completed outgoing alpha rows this ISO week, two sharing the largest amount', () => {
    const w = resolvePeriod('this_week', NOW);
    const rows = alpha.filter((t) => t.status === 'completed' && t.direction === 'outgoing' && inRange(t, w));
    expect(rows.length).toBeGreaterThanOrEqual(6);
    const max = Math.max(...rows.map((t) => t.amountMinor));
    expect(rows.filter((t) => t.amountMinor === max).length).toBeGreaterThanOrEqual(2);
  });

  it('WALLET-A-002 has >=10 transactions in the last 14 days, mixed statuses and directions', () => {
    const from = new Date(anchor.getTime() - 14 * DAY_MS);
    const rows = alpha.filter((t) => t.walletId === 'WALLET-A-002' && t.occurredAt >= from);
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(new Set(rows.map((t) => t.status)).size).toBeGreaterThanOrEqual(2);
    expect(new Set(rows.map((t) => t.direction)).size).toBe(2);
  });

  it('has >=3 repeated-amount groups, at least one spanning both tenants', () => {
    const byAmount = new Map<number, Set<string>>();
    const counts = new Map<number, number>();
    for (const t of all) {
      counts.set(t.amountMinor, (counts.get(t.amountMinor) ?? 0) + 1);
      byAmount.set(t.amountMinor, (byAmount.get(t.amountMinor) ?? new Set()).add(t.tenantId));
    }
    const repeated = [...counts].filter(([, n]) => n >= 2).map(([a]) => a);
    expect(repeated.length).toBeGreaterThanOrEqual(3);
    expect(repeated.some((a) => byAmount.get(a)?.size === 2)).toBe(true);
  });

  it('spans the last 45 days and never exceeds 3h after the anchor', () => {
    const times = all.map((t) => t.occurredAt.getTime());
    expect(Math.min(...times)).toBeGreaterThanOrEqual(anchor.getTime() - 45 * DAY_MS);
    expect(Math.max(...times)).toBeLessThanOrEqual(anchor.getTime() + 3 * 3_600_000);
    expect(anchor.getTime() - Math.min(...times)).toBeGreaterThan(30 * DAY_MS);
  });

  it('contains one indirect prompt-injection fixture per tenant', () => {
    const inj = (xs: typeof all) =>
      xs.filter((t) => /ignore (all )?(previous|prior) instructions/i.test(t.description));
    expect(inj(alpha)).toHaveLength(1);
    expect(inj(beta)).toHaveLength(1);
  });

  it('keeps the distribution rules for other UTC-midnight anchors (Monday and Sunday)', () => {
    for (const iso of ['2026-10-26T00:00:00Z', '2026-11-01T00:00:00Z']) {
      const a = new Date(iso);
      const now = new Date(a.getTime() + 12 * 3_600_000);
      const rows = generateTransactions(a);
      const al = rows.filter((t) => t.tenantId === 'tenant_alpha');
      const w = resolvePeriod('this_week', now);
      expect(
        al.filter((t) => t.status === 'completed' && t.direction === 'outgoing' && inRange(t, w)).length,
      ).toBeGreaterThanOrEqual(6);
      const y = resolvePeriod('yesterday', now);
      expect(al.filter((t) => t.status === 'failed' && inRange(t, y)).length).toBeGreaterThanOrEqual(3);
      expect(startOfUtcDay(a).getTime()).toBe(a.getTime());
    }
  });
});
