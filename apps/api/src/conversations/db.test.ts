import { createDb, createPool, type Database } from '@demoledger/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConversationNotFoundError, createDbConversations } from './index';

/** Real ledger_app grants (SELECT + INSERT) against the seeded test database. */
let ownerPool: ReturnType<typeof createPool>;
let appPool: ReturnType<typeof createPool>;
let app: Database;
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
  await Promise.all([ownerPool.end(), appPool.end()]);
});

describe('createDbConversations (ledger_app pool)', () => {
  const store = () => createDbConversations(app);

  it('creates on first use, replays answered pairs oldest-first, caps at 3, and is idempotent', async () => {
    const id = crypto.randomUUID();
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
    const id = crypto.randomUUID();
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
    const id = crypto.randomUUID();
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
