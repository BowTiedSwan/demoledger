import { createDb, createPool, type Database, schema } from '@demoledger/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConversationNotFoundError, createDbConversations, withTenantUser } from './index';

/** Real ledger_app grants (SELECT + INSERT) against the seeded test database. */
let ownerPool: ReturnType<typeof createPool>;
let appPool: ReturnType<typeof createPool>;
let app: Database;
const created: string[] = [];
const newId = () => {
  const id = crypto.randomUUID();
  created.push(id);
  return id;
};
let alpha: { userId: string; tenantId: string };
let beta: { userId: string; tenantId: string };

beforeAll(async () => {
  ownerPool = createPool(process.env.DATABASE_URL as string);
  appPool = createPool(process.env.DATABASE_URL_APP as string);
  app = createDb(appPool);
  const q = async (email: string, tenantId: string) => {
    const r = await ownerPool.query('select id from "user" where email = $1', [email]);
    return { userId: r.rows[0].id as string, tenantId };
  };
  alpha = await q('ops.alpha@demoledger.test', 'tenant_alpha');
  beta = await q('ops.beta@demoledger.test', 'tenant_beta');
});
afterAll(async () => {
  // Leave the shared test database as found: other suites assert exact (empty) conversation sets.
  if (created.length > 0) {
    await ownerPool.query('delete from ai_messages where conversation_id = any($1::uuid[])', [created]);
    await ownerPool.query('delete from ai_conversations where id = any($1::uuid[])', [created]);
  }
  await Promise.all([ownerPool.end(), appPool.end()]);
});

describe('createDbConversations (ledger_app pool)', () => {
  const store = () => createDbConversations(app);

  it('creates on first use, replays answered pairs oldest-first, caps at 3, and is idempotent', async () => {
    const id = newId();
    const s = { conversationId: id, ...beta };
    await store().ensure(s);
    await store().ensure(s); // second call: no error
    for (let i = 1; i <= 5; i++) {
      await store().appendTurn(s, { requestId: `${id}-${i}`, question: `Q${i}`, answer: `A${i}` });
    }
    const h = await store().loadHistory(s);
    expect(h).toEqual([
      { question: 'Q3', answer: 'A3' },
      { question: 'Q4', answer: 'A4' },
      { question: 'Q5', answer: 'A5' },
    ]);
  });

  it("another tenant's or user's conversation id is 'not found' and its history is empty for them", async () => {
    const id = newId();
    const s = { conversationId: id, ...alpha };
    await store().ensure(s);
    await store().appendTurn(s, { requestId: `${id}-1`, question: 'alpha secret', answer: 'alpha answer' });
    await expect(store().ensure({ conversationId: id, ...beta })).rejects.toBeInstanceOf(
      ConversationNotFoundError,
    );
    expect(await store().loadHistory({ conversationId: id, ...beta })).toEqual([]);
    expect(await store().loadHistory(s)).toHaveLength(1);
  });

  it('ledger_app cannot UPDATE or DELETE stored messages', async () => {
    const id = newId();
    const s = { conversationId: id, ...alpha };
    await store().ensure(s);
    await store().appendTurn(s, { requestId: `${id}-1`, question: 'q', answer: 'a' });
    await expect(
      appPool.query("update ai_messages set content = 'x' where conversation_id = $1", [id]),
    ).rejects.toThrow(/permission denied/);
    await expect(appPool.query('delete from ai_messages where conversation_id = $1', [id])).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('row-level security on ai_conversations / ai_messages (D-28)', () => {
  const store = () => createDbConversations(app);

  it('an unscoped read through the app pool, outside the helper, sees 0 rows', async () => {
    const id = newId();
    const s = { conversationId: id, ...alpha };
    await store().ensure(s);
    await store().appendTurn(s, { requestId: `${id}-1`, question: 'q', answer: 'a' });
    expect((await appPool.query('select count(*)::int as n from ai_messages')).rows[0].n).toBe(0);
    expect((await appPool.query('select count(*)::int as n from ai_conversations')).rows[0].n).toBe(0);
    // The rows exist (owner bypasses RLS) and are visible inside the helper.
    expect(
      (await ownerPool.query('select count(*)::int as n from ai_messages where conversation_id = $1', [id]))
        .rows[0].n,
    ).toBe(2);
    expect(await store().loadHistory(s)).toHaveLength(1);
  });

  it('inserting a row for a different user or tenant than the scoped one is an RLS violation', async () => {
    const id = newId();
    await store().ensure({ conversationId: id, ...alpha });
    const forged = (over: { tenantId?: string; userId?: string }) =>
      withTenantUser(app, alpha, (tx) =>
        tx.insert(schema.aiMessages).values({
          conversationId: id,
          tenantId: over.tenantId ?? alpha.tenantId,
          userId: over.userId ?? alpha.userId,
          role: 'user',
          content: 'forged',
          requestId: 'x',
        }),
      );
    await expect(forged({ userId: beta.userId })).rejects.toThrow(
      /row-level security|violates|Failed query/i,
    );
    await expect(forged({ tenantId: beta.tenantId })).rejects.toThrow(
      /row-level security|violates|Failed query/i,
    );
  });

  it('the context does not leak across pooled connections (max: 1)', async () => {
    const single = createPool(process.env.DATABASE_URL_APP as string, { max: 1 });
    try {
      const db = createDb(single);
      const id = newId();
      const s = { conversationId: id, ...beta };
      await createDbConversations(db).ensure(s);
      await createDbConversations(db).appendTurn(s, { requestId: `${id}-1`, question: 'q', answer: 'a' });
      // Same (only) connection, right after the scoped transaction: the settings are gone again.
      const ctx = await single.query(
        "select current_setting('app.tenant_id', true) as t, current_setting('app.user_id', true) as u",
      );
      expect([null, '']).toContain(ctx.rows[0].t);
      expect([null, '']).toContain(ctx.rows[0].u);
      expect((await single.query('select count(*)::int as n from ai_messages')).rows[0].n).toBe(0);
    } finally {
      await single.end();
    }
  });
});
