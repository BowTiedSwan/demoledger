import { createDb, createPool, type Database } from '@demoledger/db';
import { formatMinorUnits, type TransactionFilter } from '@demoledger/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aggregateTransactions, listTransactions } from '../src/repo/transactions';
import { withTenant } from '../src/repo/with-tenant';
import { seed, TEST_NOW } from './helpers';

const ALPHA = 'tenant_alpha';
const BETA = 'tenant_beta';
const all = seed();
const forTenant = (t: string) => all.filter((r) => r.tenantId === t);
const utc = (y: number, m: number, d: number, h = 0, min = 0, s = 0, ms = 0) =>
  Date.UTC(y, m - 1, d, h, min, s, ms);
const byIdAsc = (a: { transactionId: string }, b: { transactionId: string }) =>
  a.transactionId < b.transactionId ? -1 : 1;

let reader: Database;
let pool: ReturnType<typeof createPool>;
beforeAll(() => {
  pool = createPool(process.env.DATABASE_URL_READER as string);
  reader = createDb(pool);
});
afterAll(async () => {
  await pool.end();
});

const list = (t: string, f: TransactionFilter = {}, page = {}, now = TEST_NOW) =>
  listTransactions(t, f, { limit: 50, ...page }, now, reader);
const agg = (
  t: string,
  f: TransactionFilter,
  metric: 'count' | 'sum',
  groupBy: 'none' | 'status' | 'wallet' | 'direction' | 'currency' | 'day',
  now = TEST_NOW,
) => aggregateTransactions(t, f, metric, groupBy, now, reader);

describe('seed sanity (generator vs database)', () => {
  it('the test database holds exactly the generated rows', async () => {
    const a = await list(ALPHA, {}, { limit: 50, offset: 50 });
    const b = await list(BETA);
    expect(a.total_matching).toBe(forTenant(ALPHA).length);
    expect(b.total_matching).toBe(forTenant(BETA).length);
  });
});

describe('tenant isolation (repository)', () => {
  it('a tenant never sees the other tenant rows, unfiltered', async () => {
    for (const [tenant, other] of [
      [ALPHA, BETA],
      [BETA, ALPHA],
    ] as const) {
      const otherIds = new Set(forTenant(other).map((r) => r.transactionId));
      const seen: string[] = [];
      for (let offset = 0; ; offset += 50) {
        const page = await list(tenant, {}, { offset });
        seen.push(...page.items.map((i) => i.transaction_id));
        if (page.next_offset === null) break;
      }
      expect(seen).toHaveLength(forTenant(tenant).length);
      expect(seen.some((id) => otherIds.has(id))).toBe(false);
    }
  });

  it('wallet filter of the other tenant yields nothing', async () => {
    const r = await list(ALPHA, { wallet_id: 'WALLET-B-001' });
    expect(r.items).toEqual([]);
    expect(r.total_matching).toBe(0);
    const r2 = await list(BETA, { wallet_id: 'WALLET-A-001' });
    expect(r2.total_matching).toBe(0);
  });

  it('transaction_id filter of the other tenant yields nothing; own id works', async () => {
    const betaId = forTenant(BETA)[0]?.transactionId as string;
    const alphaId = forTenant(ALPHA)[0]?.transactionId as string;
    expect((await list(ALPHA, { transaction_id: betaId })).total_matching).toBe(0);
    const own = await list(ALPHA, { transaction_id: alphaId });
    expect(own.items.map((i) => i.transaction_id)).toEqual([alphaId]);
  });

  it('aggregates are tenant-scoped (count and sum, every grouping)', async () => {
    for (const groupBy of ['none', 'status', 'wallet', 'direction', 'currency', 'day'] as const) {
      for (const metric of ['count', 'sum'] as const) {
        const a = await agg(ALPHA, {}, metric, groupBy);
        expect(a.total_matching).toBe(forTenant(ALPHA).length);
        const b = await agg(BETA, {}, metric, groupBy);
        expect(b.total_matching).toBe(forTenant(BETA).length);
      }
    }
    const walletGroups = await agg(ALPHA, {}, 'count', 'wallet');
    expect(walletGroups.groups.every((g) => g.key.startsWith('WALLET-A-'))).toBe(true);
  });

  it('an injection-looking tenant value in a filter is only a parameter', async () => {
    const r = await list(ALPHA, { wallet_id: "WALLET-A-001' OR tenant_id='tenant_beta" });
    expect(r.total_matching).toBe(0);
  });

  it('an unknown tenant id sees nothing', async () => {
    expect((await list('tenant_gamma')).total_matching).toBe(0);
  });
});

describe('filters', () => {
  it('wallet', async () => {
    const exp = forTenant(ALPHA).filter((r) => r.walletId === 'WALLET-A-001');
    const r = await list(ALPHA, { wallet_id: 'WALLET-A-001' });
    expect(r.total_matching).toBe(exp.length);
    expect(r.items.every((i) => i.wallet_id === 'WALLET-A-001')).toBe(true);
  });

  it('status failed incl. failure_reason null rows', async () => {
    const exp = forTenant(ALPHA).filter((r) => r.walletId === 'WALLET-A-001' && r.status === 'failed');
    const r = await list(ALPHA, { wallet_id: 'WALLET-A-001', status: 'failed' });
    expect(r.items.map((i) => i.transaction_id).sort()).toEqual(exp.map((e) => e.transactionId).sort());
    expect(r.items.some((i) => i.failure_reason === null)).toBe(true);
    expect(r.items.some((i) => i.failure_reason !== null)).toBe(true);
  });

  it('direction + status combined', async () => {
    const exp = forTenant(ALPHA).filter((r) => r.direction === 'outgoing' && r.status === 'completed');
    const r = await list(ALPHA, { direction: 'outgoing', status: 'completed' });
    expect(r.total_matching).toBe(exp.length);
  });

  it('min/max amount are inclusive', async () => {
    const lo = 20_000;
    const hi = 80_000;
    const exp = forTenant(BETA).filter((r) => r.amountMinor >= lo && r.amountMinor <= hi);
    const r = await list(BETA, { min_amount_minor: lo, max_amount_minor: hi });
    expect(r.total_matching).toBe(exp.length);
    expect(r.items.every((i) => i.amount_minor >= lo && i.amount_minor <= hi)).toBe(true);
    const exact = forTenant(BETA)[0]?.amountMinor as number;
    const same = await list(BETA, { min_amount_minor: exact, max_amount_minor: exact });
    expect(same.total_matching).toBe(forTenant(BETA).filter((r) => r.amountMinor === exact).length);
  });

  it('explicit from/to: date-only `to` covers the whole UTC day, `from` inclusive', async () => {
    const from = utc(2026, 10, 20);
    const to = utc(2026, 10, 22) + 86_400_000; // end of 22nd (exclusive)
    const exp = forTenant(ALPHA).filter((r) => r.occurredAt.getTime() >= from && r.occurredAt.getTime() < to);
    const r = await list(ALPHA, { from: '2026-10-20', to: '2026-10-22' });
    expect(r.total_matching).toBe(exp.length);
    expect(r.applied_range).toEqual({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
  });

  it('combined filters narrow monotonically', async () => {
    const a = await list(ALPHA, { status: 'failed' });
    const b = await list(ALPHA, { status: 'failed', wallet_id: 'WALLET-A-001' });
    const c = await list(ALPHA, { status: 'failed', wallet_id: 'WALLET-A-001', period: 'last_30_days' });
    expect(a.total_matching).toBeGreaterThanOrEqual(b.total_matching);
    expect(b.total_matching).toBeGreaterThanOrEqual(c.total_matching);
    expect(c.total_matching).toBeGreaterThan(0);
  });

  it('no matches => empty page, not truncated, no next_offset', async () => {
    const r = await list(ALPHA, { wallet_id: 'WALLET-A-004', min_amount_minor: Number.MAX_SAFE_INTEGER });
    expect(r).toMatchObject({
      items: [],
      returned: 0,
      total_matching: 0,
      truncated: false,
      next_offset: null,
    });
  });
});

describe('UTC period boundaries (clock injected)', () => {
  const idsOf = (rows: { transactionId: string }[]) => rows.map((r) => r.transactionId).sort();

  it('yesterday = [Oct 27 00:00Z, Oct 28 00:00Z) at 2026-10-28T12:00Z', async () => {
    const from = utc(2026, 10, 27);
    const to = utc(2026, 10, 28);
    for (const tenant of [ALPHA, BETA]) {
      const exp = forTenant(tenant).filter(
        (r) => r.occurredAt.getTime() >= from && r.occurredAt.getTime() < to,
      );
      const r = await list(tenant, { period: 'yesterday' });
      expect(r.items.map((i) => i.transaction_id).sort()).toEqual(idsOf(exp));
      expect(r.applied_range).toEqual({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
    }
  });

  it('failed yesterday: >=3 alpha and >=2 beta (seed rule), counted by SQL', async () => {
    const a = await agg(ALPHA, { period: 'yesterday', status: 'failed' }, 'count', 'none');
    const b = await agg(BETA, { period: 'yesterday', status: 'failed' }, 'count', 'none');
    const from = utc(2026, 10, 27);
    const to = utc(2026, 10, 28);
    const expA = forTenant(ALPHA).filter(
      (r) => r.status === 'failed' && r.occurredAt.getTime() >= from && r.occurredAt.getTime() < to,
    ).length;
    const expB = forTenant(BETA).filter(
      (r) => r.status === 'failed' && r.occurredAt.getTime() >= from && r.occurredAt.getTime() < to,
    ).length;
    expect(a.groups[0]?.count).toBe(expA);
    expect(b.groups[0]?.count).toBe(expB);
    expect(expA).toBeGreaterThanOrEqual(3);
    expect(expB).toBeGreaterThanOrEqual(2);
  });

  it('the day flips exactly at 00:00:00.000Z', async () => {
    const justBefore = new Date(utc(2026, 10, 27, 23, 59, 59, 999));
    const atMidnight = new Date(utc(2026, 10, 28));
    const expAt = (d: Date) => {
      const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      return forTenant(ALPHA).filter(
        (r) => r.occurredAt.getTime() >= today - 86_400_000 && r.occurredAt.getTime() < today,
      ).length;
    };
    expect((await list(ALPHA, { period: 'yesterday' }, {}, justBefore)).total_matching).toBe(
      expAt(justBefore),
    );
    expect((await list(ALPHA, { period: 'yesterday' }, {}, atMidnight)).total_matching).toBe(
      expAt(atMidnight),
    );
    expect((await list(ALPHA, { period: 'yesterday' }, {}, justBefore)).applied_range?.from).toBe(
      new Date(utc(2026, 10, 26)).toISOString(),
    );
    expect((await list(ALPHA, { period: 'yesterday' }, {}, atMidnight)).applied_range?.from).toBe(
      new Date(utc(2026, 10, 27)).toISOString(),
    );
  });

  it('this_week = ISO week Monday 2026-10-26 00:00Z up to the next Monday', async () => {
    const from = utc(2026, 10, 26);
    const to = utc(2026, 11, 2);
    const exp = forTenant(ALPHA).filter(
      (r) =>
        r.status === 'completed' &&
        r.direction === 'outgoing' &&
        r.occurredAt.getTime() >= from &&
        r.occurredAt.getTime() < to,
    );
    expect(exp.length).toBeGreaterThanOrEqual(6);
    const r = await list(ALPHA, { period: 'this_week', status: 'completed', direction: 'outgoing' });
    expect(r.total_matching).toBe(exp.length);
    expect(r.applied_range).toEqual({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
  });

  it('this_week on a Sunday still starts the previous Monday; Monday 00:00 starts a new week', async () => {
    const sunday = new Date(utc(2026, 11, 1, 23, 59, 59));
    const monday = new Date(utc(2026, 11, 2));
    expect((await list(ALPHA, { period: 'this_week' }, {}, sunday)).applied_range?.from).toBe(
      new Date(utc(2026, 10, 26)).toISOString(),
    );
    expect((await list(ALPHA, { period: 'this_week' }, {}, monday)).applied_range?.from).toBe(
      new Date(utc(2026, 11, 2)).toISOString(),
    );
  });

  it('today / last_7_days / last_30_days match independent windows', async () => {
    const today = utc(2026, 10, 28);
    const windows = {
      today: [today, today + 86_400_000],
      last_7_days: [today - 6 * 86_400_000, today + 86_400_000],
      last_30_days: [today - 29 * 86_400_000, today + 86_400_000],
    } as const;
    for (const [period, [from, to]] of Object.entries(windows) as [
      keyof typeof windows,
      readonly [number, number],
    ][]) {
      const exp = forTenant(ALPHA).filter(
        (r) => r.occurredAt.getTime() >= from && r.occurredAt.getTime() < to,
      );
      expect((await list(ALPHA, { period })).total_matching).toBe(exp.length);
    }
  });
});

describe('limit cap, truncated, pagination, ordering', () => {
  it('limit above 50 is clamped to 50 and reports truncation', async () => {
    const r = await listTransactions(ALPHA, {}, { limit: 1000 }, TEST_NOW, reader);
    expect(r.returned).toBe(50);
    expect(r.total_matching).toBe(forTenant(ALPHA).length);
    expect(r.truncated).toBe(true);
    expect(r.next_offset).toBe(50);
  });

  it('the last page is not truncated', async () => {
    const r = await list(ALPHA, {}, { offset: 50 });
    expect(r.returned).toBe(forTenant(ALPHA).length - 50);
    expect(r.truncated).toBe(false);
    expect(r.next_offset).toBeNull();
  });

  it('small limit marks truncated; exact fit does not', async () => {
    const exp = forTenant(BETA).filter((r) => r.walletId === 'WALLET-B-003').length;
    const small = await list(BETA, { wallet_id: 'WALLET-B-003' }, { limit: 2 });
    expect(small.returned).toBe(2);
    expect(small.truncated).toBe(exp > 2);
    const exact = await list(BETA, { wallet_id: 'WALLET-B-003' }, { limit: exp });
    expect(exact.truncated).toBe(false);
  });

  it('default order is occurred_at desc; paging has no duplicates or gaps', async () => {
    const p1 = await list(ALPHA, {}, { limit: 20, offset: 0 });
    const p2 = await list(ALPHA, {}, { limit: 20, offset: 20 });
    const p3 = await list(ALPHA, {}, { limit: 20, offset: 40 });
    const ids = [...p1.items, ...p2.items, ...p3.items].map((i) => i.transaction_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(forTenant(ALPHA).length);
    const times = [...p1.items, ...p2.items, ...p3.items].map((i) => i.occurred_at);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('largest completed outgoing this week: repeated-amount ties are deterministic (id asc)', async () => {
    const from = utc(2026, 10, 26);
    const to = utc(2026, 11, 2);
    const exp = forTenant(ALPHA)
      .filter(
        (r) =>
          r.status === 'completed' &&
          r.direction === 'outgoing' &&
          r.occurredAt.getTime() >= from &&
          r.occurredAt.getTime() < to,
      )
      .sort((a, b) => b.amountMinor - a.amountMinor || byIdAsc(a, b));
    const amounts = exp.map((e) => e.amountMinor);
    expect(new Set(amounts).size).toBeLessThan(amounts.length); // seed guarantees a tie
    const r = await list(
      ALPHA,
      { period: 'this_week', status: 'completed', direction: 'outgoing' },
      { sort: 'amount_desc' },
    );
    expect(r.items.map((i) => i.transaction_id)).toEqual(exp.map((e) => e.transactionId));
    const asc = await list(
      ALPHA,
      { period: 'this_week', status: 'completed', direction: 'outgoing' },
      { sort: 'amount_asc' },
    );
    const expAsc = [...exp].sort((a, b) => a.amountMinor - b.amountMinor || byIdAsc(a, b));
    expect(asc.items.map((i) => i.transaction_id)).toEqual(expAsc.map((e) => e.transactionId));
  });

  it('repeated amounts that span both tenants are still tenant-scoped', async () => {
    const counts = new Map<number, Set<string>>();
    for (const r of all) counts.set(r.amountMinor, (counts.get(r.amountMinor) ?? new Set()).add(r.tenantId));
    const shared = [...counts.entries()].find(([, t]) => t.size === 2);
    expect(shared).toBeDefined();
    const amount = (shared as [number, Set<string>])[0];
    for (const tenant of [ALPHA, BETA]) {
      const r = await list(tenant, { min_amount_minor: amount, max_amount_minor: amount });
      expect(r.total_matching).toBe(forTenant(tenant).filter((x) => x.amountMinor === amount).length);
      expect(r.total_matching).toBeGreaterThan(0);
    }
  });
});

describe('aggregation', () => {
  it('count by status matches the generator', async () => {
    const r = await agg(ALPHA, {}, 'count', 'status');
    const exp = new Map<string, number>();
    for (const x of forTenant(ALPHA)) exp.set(x.status, (exp.get(x.status) ?? 0) + 1);
    expect(Object.fromEntries(r.groups.map((g) => [g.key, g.count]))).toEqual(Object.fromEntries(exp));
    expect(r.groups.every((g) => g.currency === null && g.sum_minor === null)).toBe(true);
    expect(r.groups.map((g) => g.key)).toEqual([...r.groups.map((g) => g.key)].sort());
  });

  it('sum is split per currency and never added across currencies', async () => {
    const r = await agg(ALPHA, { status: 'completed' }, 'sum', 'none');
    const exp = new Map<string, { n: number; sum: bigint }>();
    for (const x of forTenant(ALPHA).filter((t) => t.status === 'completed')) {
      const e = exp.get(x.currency) ?? { n: 0, sum: 0n };
      e.n += 1;
      e.sum += BigInt(x.amountMinor);
      exp.set(x.currency, e);
    }
    expect(exp.size).toBeGreaterThan(1); // alpha has EUR, USD and GBP
    expect(r.groups.map((g) => g.currency)).toEqual([...exp.keys()].sort());
    for (const g of r.groups) {
      const e = exp.get(g.currency as string);
      expect(g.key).toBe('all');
      expect(g.count).toBe(e?.n);
      expect(g.sum_minor).toBe(String(e?.sum));
      expect(g.sum_display).toBe(formatMinorUnits(e?.sum as bigint, g.currency as 'EUR'));
    }
    expect(r.total_matching).toBe(forTenant(ALPHA).filter((t) => t.status === 'completed').length);
  });

  it('sum grouped by wallet: one bucket per (wallet, currency)', async () => {
    const r = await agg(ALPHA, { direction: 'outgoing' }, 'sum', 'wallet');
    const exp = new Map<string, bigint>();
    for (const x of forTenant(ALPHA).filter((t) => t.direction === 'outgoing'))
      exp.set(
        `${x.walletId}|${x.currency}`,
        (exp.get(`${x.walletId}|${x.currency}`) ?? 0n) + BigInt(x.amountMinor),
      );
    expect(Object.fromEntries(r.groups.map((g) => [`${g.key}|${g.currency}`, g.sum_minor]))).toEqual(
      Object.fromEntries([...exp].map(([k, v]) => [k, String(v)])),
    );
  });

  it('group_by day uses UTC calendar days', async () => {
    const r = await agg(ALPHA, {}, 'count', 'day');
    const exp = new Map<string, number>();
    for (const x of forTenant(ALPHA)) {
      const day = x.occurredAt.toISOString().slice(0, 10);
      exp.set(day, (exp.get(day) ?? 0) + 1);
    }
    expect(Object.fromEntries(r.groups.map((g) => [g.key, g.count]))).toEqual(Object.fromEntries(exp));
  });

  it('group_by currency / direction', async () => {
    const byCur = await agg(BETA, {}, 'sum', 'currency');
    expect(byCur.groups.every((g) => g.key === g.currency)).toBe(true);
    const byDir = await agg(BETA, {}, 'count', 'direction');
    expect(byDir.groups.reduce((n, g) => n + g.count, 0)).toBe(forTenant(BETA).length);
  });

  it('empty count answers an explicit zero; empty sum has no buckets', async () => {
    const c = await agg(ALPHA, { wallet_id: 'WALLET-B-001' }, 'count', 'none');
    expect(c.groups).toEqual([{ key: 'all', currency: null, count: 0, sum_minor: null, sum_display: null }]);
    expect(c.total_matching).toBe(0);
    const s = await agg(ALPHA, { wallet_id: 'WALLET-B-001' }, 'sum', 'none');
    expect(s.groups).toEqual([]);
  });
});

describe('read-only reader pool', () => {
  it('the repository connection cannot write', async () => {
    await expect(pool.query("delete from transactions where tenant_id = 'tenant_gamma'")).rejects.toThrow(
      /permission denied/i,
    );
  });
});

describe('transactionIds filter (ANY, tenant-scoped)', () => {
  const alphaIds = forTenant(ALPHA)
    .slice(0, 3)
    .map((r) => r.transactionId);
  const betaIds = forTenant(BETA)
    .slice(0, 2)
    .map((r) => r.transactionId);

  it("alpha passing beta's IDs gets 0 rows (list and aggregate)", async () => {
    const r = await list(ALPHA, { transaction_ids: betaIds });
    expect(r.items).toEqual([]);
    expect(r.total_matching).toBe(0);
    const a = await agg(ALPHA, { transaction_ids: betaIds }, 'count', 'none');
    expect(a.total_matching).toBe(0);
  });

  it('mixed alpha and beta IDs return only the alpha rows', async () => {
    const mixed = [...betaIds, ...alphaIds];
    const r = await list(ALPHA, { transaction_ids: mixed });
    expect(r.items.map((i) => i.transaction_id).sort()).toEqual([...alphaIds].sort());
    const a = await agg(ALPHA, { transaction_ids: mixed }, 'sum', 'none');
    expect(a.total_matching).toBe(alphaIds.length);
    const b = await list(BETA, { transaction_ids: mixed });
    expect(b.items.map((i) => i.transaction_id).sort()).toEqual([...betaIds].sort());
  });

  it('combines with other filters and handles empty / hostile values', async () => {
    const sample = forTenant(ALPHA).slice(0, 20);
    const ids = sample.map((r) => r.transactionId);
    const exp = sample.filter((r) => r.status === 'failed' || r.status === 'completed');
    const r = await list(ALPHA, { transaction_ids: ids, status: 'failed' });
    expect(r.items.map((i) => i.transaction_id).sort()).toEqual(
      sample
        .filter((x) => x.status === 'failed')
        .map((x) => x.transactionId)
        .sort(),
    );
    expect(exp.length).toBeGreaterThan(0);
    const w = await list(ALPHA, { transaction_ids: ids, wallet_id: 'WALLET-B-001' });
    expect(w.total_matching).toBe(0);
    expect((await list(ALPHA, { transaction_ids: [] })).total_matching).toBe(0);
    expect((await list(ALPHA, { transaction_ids: ["x'); DROP TABLE transactions;--"] })).total_matching).toBe(
      0,
    );
    expect((await list(ALPHA, {})).total_matching).toBe(forTenant(ALPHA).length);
  });
});

describe('row-level security backstop (withTenant)', () => {
  const countAll = (tx: { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: { n: string }[] }> }) =>
    tx.execute(sql`SELECT count(*)::text AS n FROM transactions`).then((r) => Number(r.rows[0]?.n));

  it('a deliberately unscoped query inside withTenant sees only the current tenant', async () => {
    expect(await withTenant(reader, ALPHA, countAll)).toBe(forTenant(ALPHA).length);
    expect(await withTenant(reader, BETA, countAll)).toBe(forTenant(BETA).length);
    expect(await withTenant(reader, 'tenant_gamma', countAll)).toBe(0);
  });

  it('the same unscoped query outside the helper returns 0 (policy fails closed)', async () => {
    const r = await pool.query('SELECT count(*)::int AS n FROM transactions');
    expect(r.rows[0].n).toBe(0);
  });

  it('the tenant setting is transaction-local and does not leak to the pooled connection', async () => {
    await withTenant(reader, ALPHA, countAll);
    const r = await pool.query("SELECT current_setting('app.tenant_id', true) AS t");
    expect(r.rows[0].t === null || r.rows[0].t === '').toBe(true);
  });

  it('a hostile tenant value is only a parameter', async () => {
    expect(await withTenant(reader, "tenant_alpha' OR '1'='1", countAll)).toBe(0);
  });
});
