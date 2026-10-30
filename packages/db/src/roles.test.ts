import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from './client';

const owner = createPool(process.env.DATABASE_URL as string, { max: 1 });
const reader = createPool(process.env.DATABASE_URL_READER as string, { max: 1 });
const app = createPool(process.env.DATABASE_URL_APP as string, { max: 1 });

async function pgCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as pg.DatabaseError).code;
  }
}
const DENIED = '42501'; // insufficient_privilege

afterAll(async () => {
  await Promise.all([owner.end(), reader.end(), app.end()]);
});

describe('ledger_reader', () => {
  it('can SELECT transactions', async () => {
    const r = await reader.query('select count(*)::int as n from transactions');
    expect(r.rows[0].n).toBe(100);
  });

  it('cannot INSERT, UPDATE or DELETE transactions', async () => {
    expect(
      await pgCode(
        reader.query(
          `insert into transactions (transaction_id, tenant_id, wallet_id, amount_minor, currency, direction, status, occurred_at, description)
           values ('TXN-A-9999','tenant_alpha','WALLET-A-001',1,'EUR','incoming','completed',now(),'x')`,
        ),
      ),
    ).toBe(DENIED);
    expect(await pgCode(reader.query(`update transactions set amount_minor = 1`))).toBe(DENIED);
    expect(await pgCode(reader.query(`delete from transactions`))).toBe(DENIED);
  });

  it('cannot read auth or audit tables', async () => {
    for (const t of [
      '"user"',
      'session',
      'account',
      'organization',
      'member',
      'ai_requests',
      'ai_tool_calls',
    ]) {
      expect(await pgCode(reader.query(`select 1 from ${t} limit 1`)), t).toBe(DENIED);
    }
  });

  it('cannot create temp tables', async () => {
    expect(await pgCode(reader.query('create temp table nope_tmp (id int)'))).toBe(DENIED);
  });

  it('cannot create objects', async () => {
    expect(await pgCode(reader.query('create table nope (id int)'))).toBe(DENIED);
  });
});

describe('ledger_app', () => {
  it('cannot create temp tables', async () => {
    expect(await pgCode(app.query('create temp table nope_tmp (id int)'))).toBe(DENIED);
  });

  it('cannot touch transactions at all', async () => {
    expect(await pgCode(app.query('select 1 from transactions limit 1'))).toBe(DENIED);
    expect(await pgCode(app.query('delete from transactions'))).toBe(DENIED);
  });

  it('can read and write Better Auth tables', async () => {
    const r = await app.query('select count(*)::int as n from "user"');
    expect(r.rows[0].n).toBe(2);
    await app.query(
      `insert into verification (id, identifier, value, expires_at) values ('v1','roles-test','x', now())`,
    );
    await app.query(`update verification set value = 'y' where id = 'v1'`);
    await app.query(`delete from verification where id = 'v1'`);
  });

  describe('audit tables are append-only', () => {
    const reqId = `roles-test-${Date.now()}`;
    beforeAll(async () => {
      await app.query(
        `insert into ai_requests (request_id, user_id, tenant_id, question, status) values ($1,'u','tenant_alpha','q','ok')`,
        [reqId],
      );
      await app.query(
        `insert into ai_tool_calls (request_id, step, tool_name, raw_args, validated) values ($1,0,'search_transactions','{}',true)`,
        [reqId],
      );
    });

    it('allows INSERT (without RETURNING)', async () => {
      const r = await owner.query('select count(*)::int as n from ai_requests where request_id = $1', [
        reqId,
      ]);
      expect(r.rows[0].n).toBe(1);
    });

    it.each(['ai_requests', 'ai_tool_calls'])(
      'denies UPDATE, DELETE, TRUNCATE and SELECT on %s',
      async (t) => {
        expect(await pgCode(app.query(`update ${t} set request_id = 'x'`))).toBe(DENIED);
        expect(await pgCode(app.query(`delete from ${t}`))).toBe(DENIED);
        expect(await pgCode(app.query(`truncate ${t}`))).toBe(DENIED);
        expect(await pgCode(app.query(`select 1 from ${t} limit 1`))).toBe(DENIED);
      },
    );

    it('rejects out-of-enum statuses at the database', async () => {
      expect(
        await pgCode(
          app.query(
            `insert into ai_requests (request_id,user_id,tenant_id,question,status) values ('r','u','t','q','bogus')`,
          ),
        ),
      ).toBe('22P02');
    });
  });
});

describe('conversation history (ledger_app)', () => {
  const convId = crypto.randomUUID();
  it('ledger_reader cannot select', async () => {
    for (const t of ['ai_conversations', 'ai_messages']) {
      expect(await pgCode(reader.query(`select 1 from ${t} limit 1`)), t).toBe(DENIED);
    }
  });

  it('can insert and select; cannot update or delete', async () => {
    const u = await owner.query(`select id from "user" limit 1`);
    await app.query(`insert into ai_conversations (id, tenant_id, user_id) values ($1,'tenant_alpha',$2)`, [
      convId,
      u.rows[0].id,
    ]);
    await app.query(
      `insert into ai_messages (conversation_id, tenant_id, user_id, role, content, request_id) values ($1,'tenant_alpha',$2,'user','hi','r1')`,
      [convId, u.rows[0].id],
    );
    const r = await app.query('select content from ai_messages where conversation_id = $1', [convId]);
    expect(r.rows).toEqual([{ content: 'hi' }]);
    for (const t of ['ai_conversations', 'ai_messages']) {
      expect(await pgCode(app.query(`update ${t} set tenant_id = 'x'`))).toBe(DENIED);
      expect(await pgCode(app.query(`delete from ${t}`))).toBe(DENIED);
    }
  });
});
