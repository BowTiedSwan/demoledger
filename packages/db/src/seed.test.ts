import { verifyPassword } from 'better-auth/crypto';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb, createPool } from './client';
import * as schema from './schema';
import { SEED_TEST_ANCHOR, SEED_USERS } from './seed/constants';
import { generateTransactions } from './seed/generate';

const ownerPool = createPool(process.env.DATABASE_URL as string, { max: 2 });
const db = createDb(ownerPool);
afterAll(() => ownerPool.end());

describe('seeded test database', () => {
  it('stores exactly what the generator produces for the pinned anchor', async () => {
    const rows = await db.select().from(schema.transactions);
    const gen = generateTransactions(new Date(SEED_TEST_ANCHOR));
    expect(rows).toHaveLength(gen.length);
    const byId = new Map(rows.map((r) => [r.transactionId, r]));
    for (const g of gen) {
      const r = byId.get(g.transactionId);
      expect(r?.tenantId).toBe(g.tenantId);
      expect(r?.amountMinor).toBe(g.amountMinor);
      expect(r?.occurredAt.getTime()).toBe(g.occurredAt.getTime());
      expect(r?.failureReason).toBe(g.failureReason);
    }
  });

  it('has tenant_alpha / tenant_beta organizations that transactions reference', async () => {
    const orgs = await db.select().from(schema.organization);
    expect(orgs.map((o) => o.id).sort()).toEqual(['tenant_alpha', 'tenant_beta']);
    const r = await db.execute(
      sql`select tenant_id, count(*)::int as n from transactions group by 1 order by 1`,
    );
    expect(r.rows).toEqual([
      { tenant_id: 'tenant_alpha', n: 56 },
      { tenant_id: 'tenant_beta', n: 44 },
    ]);
  });

  it('rejects non-positive amounts and unknown tenants', async () => {
    await expect(
      ownerPool.query(
        `insert into transactions (transaction_id, tenant_id, wallet_id, amount_minor, currency, direction, status, occurred_at, description)
         values ('TXN-A-9998','tenant_alpha','WALLET-A-001',0,'EUR','incoming','completed',now(),'x')`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      ownerPool.query(
        `insert into transactions (transaction_id, tenant_id, wallet_id, amount_minor, currency, direction, status, occurred_at, description)
         values ('TXN-A-9997','tenant_gamma','WALLET-A-001',5,'EUR','incoming','completed',now(),'x')`,
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('has memberships and users whose passwords verify through Better Auth', async () => {
    const members = await db.select().from(schema.member);
    expect(members).toHaveLength(SEED_USERS.length);
    const accounts = await db.select().from(schema.account);
    const users = await db.select().from(schema.user);
    for (const u of SEED_USERS) {
      const user = users.find((x) => x.email === u.email);
      expect(user).toBeDefined();
      const acct = accounts.find((a) => a.userId === user?.id && a.providerId === 'credential');
      expect(acct?.password).toBeTruthy();
      expect(await verifyPassword({ hash: acct?.password as string, password: u.password })).toBe(true);
      expect(await verifyPassword({ hash: acct?.password as string, password: 'wrong' })).toBe(false);
      expect(members.find((x) => x.userId === user?.id)?.organizationId).toBe(u.tenantId);
    }
  });
});
