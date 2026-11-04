import { createDb, createPool, type Database } from '@demoledger/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryConversations } from '../conversations';
import { HeuristicGuard } from '../guard';
import { handleAsk } from './index';
import { makeArgs, readStream, scriptedModel } from './testing';

/** End-to-end against the seeded test database: real ledger_reader repo + real ledger_app audit inserts. */
let readerPool: ReturnType<typeof createPool>;
let appPool: ReturnType<typeof createPool>;
let ownerPool: ReturnType<typeof createPool>;
let reader: Database;
let app: Database;

beforeAll(() => {
  readerPool = createPool(process.env.DATABASE_URL_READER as string);
  appPool = createPool(process.env.DATABASE_URL_APP as string);
  ownerPool = createPool(process.env.DATABASE_URL as string);
  reader = createDb(readerPool);
  app = createDb(appPool);
});
afterAll(async () => {
  await Promise.all([readerPool.end(), appPool.end(), ownerPool.end()]);
});

function dbArgs(over: Parameters<typeof makeArgs>[0], requestId: string) {
  const { args } = makeArgs(over);
  args.requestId = requestId;
  args.deps.db = { reader, app };
  args.deps.now = () => new Date('2026-10-28T12:00:00Z');
  // Real repo reader + real audit writer; conversations in memory (the fake user id has no user row).
  args.overrides = { conversations: createMemoryConversations() };
  return args;
}

const auditRows = async (requestId: string) => ({
  req: (await ownerPool.query('select * from ai_requests where request_id = $1', [requestId])).rows,
  calls: (
    await ownerPool.query('select * from ai_tool_calls where request_id = $1 order by step', [requestId])
  ).rows,
});

describe('AI tools against the real database', () => {
  it.each(['search_transactions', 'aggregate_transactions'] as const)(
    '%s distinguishes foreign/missing wallets from an empty filtered result for Beta',
    async (name) => {
      for (const [walletId, found] of [
        ['WALLET-A-001', false],
        ['WALLET-B-999', false],
        ['WALLET-B-001', true],
      ] as const) {
        const input = {
          wallet_id: walletId,
          status: 'failed',
          from: '2030-01-01',
          to: '2030-01-01',
          ...(name === 'aggregate_transactions' ? { metric: 'count', group_by: 'failure_reason' } : {}),
        };
        const { model, calls: modelCalls } = scriptedModel([
          { tools: [{ name, input }] },
          { text: 'Check the wallet and filters.' },
        ]);
        const requestId = `wallet-check-${name}-${walletId}`;
        const s = await readStream(await handleAsk(dbArgs({ model, tenantId: 'tenant_beta' }, requestId)));
        const result = s.chunks.find((c) => c.type === 'tool-output-available')?.output;
        expect(result).toMatchObject({
          ok: true,
          total_matching: 0,
          wallet_lookup: { wallet_id: walletId, found },
        });
        expect(s.sources).toEqual([]);
        expect(JSON.stringify(modelCalls[1]?.prompt)).toContain(`wallet_found=${found}`);
        const { req, calls } = await auditRows(requestId);
        expect(req[0]).toMatchObject({ status: 'no_results', tenant_id: 'tenant_beta' });
        expect(req[0].error_detail).toBe(found ? null : `wallet_not_found:${walletId}`);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ validated: true, raw_args: input, returned_ids: [] });
      }
    },
  );

  it('alpha tool calls only ever return alpha rows, and the audit rows land in Postgres', async () => {
    const { model } = scriptedModel([
      { tools: [{ name: 'search_transactions', input: { status: 'failed', limit: 50 } }] },
      { tools: [{ name: 'aggregate_transactions', input: { metric: 'count', group_by: 'status' } }] },
      { text: 'Done.' },
    ]);
    const args = dbArgs({ model }, 'db-req-alpha');
    const s = await readStream(await handleAsk(args));

    expect(s.sources.length).toBeGreaterThan(0);
    expect(s.sources.every((id) => id.startsWith('TXN-A-'))).toBe(true);
    const { req, calls } = await auditRows('db-req-alpha');
    expect(req).toHaveLength(1);
    expect(req[0]).toMatchObject({ status: 'ok', tenant_id: 'tenant_alpha', step_count: 3 });
    expect(calls.map((c) => c.tool_name)).toEqual(['search_transactions', 'aggregate_transactions']);
    expect(calls[0].validated).toBe(true);
    expect(calls[0].returned_ids.every((id: string) => id.startsWith('TXN-A-'))).toBe(true);
  });

  it('alpha asking for a beta wallet gets zero rows (tenant comes from the closure, not the model)', async () => {
    const { model } = scriptedModel([
      { tools: [{ name: 'search_transactions', input: { wallet_id: 'WALLET-B-001' } }] },
      { text: 'No matching records.' },
    ]);
    const args = dbArgs({ model }, 'db-req-xtenant');
    const s = await readStream(await handleAsk(args));
    expect(s.sources).toEqual([]);
    const { req, calls } = await auditRows('db-req-xtenant');
    expect(req[0].status).toBe('no_results');
    expect(calls[0]).toMatchObject({ validated: true, row_count: 0 });
  });

  it('an injected tenant_id is rejected: validated=false row in Postgres, no data returned', async () => {
    const { model } = scriptedModel([
      { tools: [{ name: 'search_transactions', input: { tenant_id: 'tenant_beta' } }] },
      { text: 'Could not look that up.' },
    ]);
    const args = dbArgs({ model }, 'db-req-inject');
    const s = await readStream(await handleAsk(args));
    expect(s.sources).toEqual([]);
    const { calls } = await auditRows('db-req-inject');
    expect(calls[0]).toMatchObject({ validated: false });
    expect(calls[0].raw_args).toEqual({ tenant_id: 'tenant_beta' });
  });

  it('a blocked request writes one request row and zero tool-call rows', async () => {
    const { model, calls: modelCalls } = scriptedModel([{ text: 'never' }]);
    const args = dbArgs(
      { model, guard: new HeuristicGuard(), question: 'Refund TXN-A-0001' },
      'db-req-blocked',
    );
    await readStream(await handleAsk(args));
    expect(modelCalls).toHaveLength(0);
    const { req, calls } = await auditRows('db-req-blocked');
    expect(req).toHaveLength(1);
    expect(req[0]).toMatchObject({ status: 'blocked', guard_verdict: 'block', guard_provider: 'heuristic' });
    expect(calls).toHaveLength(0);
  });

  it('indirect injection: the seeded malicious descriptions reach the model only inside the untrusted block', async () => {
    const { model, calls } = scriptedModel([
      { tools: [{ name: 'search_transactions', input: { limit: 50 } }] },
      { text: 'ok' },
    ]);
    const args = dbArgs({ model }, 'db-req-indirect');
    await readStream(await handleAsk(args));
    const toolMsg = (
      (calls[1] as { prompt: unknown }).prompt as {
        role: string;
        content: { output?: { value?: string } }[];
      }[]
    )
      .filter((m) => m.role === 'tool')
      .flatMap((m) => m.content.map((p) => p.output?.value ?? ''))
      .join('\n');
    const at = toolMsg.toLowerCase().indexOf('ignore previous instructions');
    expect(at).toBeGreaterThan(-1);
    expect(toolMsg.lastIndexOf('<untrusted_tool_data ', at)).toBeGreaterThan(-1);
    expect(toolMsg.indexOf('</untrusted_tool_data', at)).toBeGreaterThan(at);
    const prompt = JSON.stringify(calls[1]?.prompt);
    expect(prompt).not.toContain('TXN-B-');
  });

  it('createLlm refuses to run under test', async () => {
    const { createLlm } = await import('../llm');
    expect(() => createLlm({ accountId: 'a', apiToken: 't' })).toThrow(/under test/);
  });
});
