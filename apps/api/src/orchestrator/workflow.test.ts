import { DATA_TOOL_NAMES, PRESENTATIONAL_TOOL_NAMES, TOOL_NAMES } from '@demoledger/shared';
import { describe, expect, it } from 'vitest';
import { ledgerTools, ToolCallRecorder } from '../tools';
import { handleAsk } from './index';
import { fakeReader, makeArgs, readStream, scriptedModel, txn } from './testing';

const rows = [txn(1), txn(2, { failure_reason: null })];

/** The `value` text of every tool-result in the role:'tool' messages of a recorded model prompt. */
function toolMessageText(prompt: unknown): string {
  return (prompt as { role: string; content: { output?: { value?: string } }[] }[])
    .filter((m) => m.role === 'tool')
    .flatMap((m) => m.content.map((p) => p.output?.value ?? ''))
    .join('\n');
}

describe('mocked AI tool-call workflows (brief 9)', () => {
  it('(a) tool call -> result -> grounded answer citing returned IDs', async () => {
    const { model, calls } = scriptedModel([
      { tools: [{ name: 'search_transactions', input: { wallet_id: 'WALLET-A-001', status: 'failed' } }] },
      { text: 'Two failed: TXN-A-0001 (insufficient_funds) and TXN-A-0002 (reason not recorded).' },
    ]);
    const reader = fakeReader(rows);
    const { args, audit } = makeArgs({ model, reader });
    const res = await handleAsk(args);
    const s = await readStream(res);

    expect(res.headers.get('X-Request-Id')).toBe('req-1');
    expect(reader.searchCalls).toEqual([
      {
        tenantId: 'tenant_alpha',
        args: expect.objectContaining({ wallet_id: 'WALLET-A-001', status: 'failed', limit: 20 }),
      },
    ]);
    expect(s.text).toContain('TXN-A-0001');
    expect(s.sources.sort()).toEqual(['TXN-A-0001', 'TXN-A-0002']);
    expect(s.dataParts.find((p) => p.type === 'data-ungrounded')).toBeUndefined();
    // The model saw the tool result wrapped as untrusted data (on the role:'tool' message itself).
    expect(toolMessageText(calls[1]?.prompt)).toMatch(
      /^\[server facts\] returned=2 total_matching=2 truncated=false\n<untrusted_tool_data tool="search_transactions"/,
    );

    expect(audit.requests).toHaveLength(1);
    expect(audit.requests[0]).toMatchObject({
      status: 'ok',
      tenantId: 'tenant_alpha',
      userId: 'user-alpha',
      stepCount: 2,
      guardVerdict: 'allow',
      citedIds: ['TXN-A-0001', 'TXN-A-0002'],
      ungroundedIds: [],
    });
    expect(audit.toolCalls).toHaveLength(1);
    expect(audit.toolCalls[0]).toMatchObject({
      toolName: 'search_transactions',
      validated: true,
      rowCount: 2,
      returnedIds: ['TXN-A-0001', 'TXN-A-0002'],
      rawArgs: { wallet_id: 'WALLET-A-001', status: 'failed' },
    });
  });

  it('(b) injected tenant_id is rejected, audited with validated=false, and no query runs', async () => {
    const { model } = scriptedModel([
      { tools: [{ name: 'search_transactions', input: { tenant_id: 'tenant_beta', status: 'failed' } }] },
      { text: 'I could not run that lookup.' },
    ]);
    const reader = fakeReader(rows);
    const { args, audit } = makeArgs({ model, reader });
    const s = await readStream(await handleAsk(args));

    expect(reader.searchCalls).toHaveLength(0);
    expect(reader.aggregateCalls).toHaveLength(0);
    expect(audit.toolCalls).toHaveLength(1);
    expect(audit.toolCalls[0]).toMatchObject({
      validated: false,
      rawArgs: { tenant_id: 'tenant_beta', status: 'failed' },
      returnedIds: [],
    });
    expect(audit.toolCalls[0]?.validationError).toMatch(/tenant_id/);
    expect(s.sources).toEqual([]);
    expect(audit.requests[0]?.status).toBe('ok');
  });

  it('(c) a model that keeps calling tools stops at the step cap with loop_limit', async () => {
    const { model, calls } = scriptedModel([
      { tools: [{ name: 'search_transactions', input: { limit: 1 } }] },
    ]);
    const { args, audit } = makeArgs({ model, reader: fakeReader(rows) });
    const s = await readStream(await handleAsk(args));

    expect(calls).toHaveLength(5);
    // Final step: tools cleared and toolChoice none.
    expect(calls[4]?.tools).toEqual([]);
    expect(calls[3]?.tools).toEqual([...TOOL_NAMES]);
    expect(audit.requests[0]).toMatchObject({ status: 'loop_limit', errorCode: 'loop_limit', stepCount: 5 });
    expect(s.dataParts.find((p) => p.type === 'data-error')?.data).toMatchObject({ code: 'loop_limit' });
  });

  it('a model-counted number that matches no server count is flagged; a quoted total_matching is not', async () => {
    const run = async (answer: string) => {
      const { model } = scriptedModel([
        { tools: [{ name: 'search_transactions', input: { status: 'failed' } }] },
        { text: answer },
      ]);
      const { args, audit } = makeArgs({ model, reader: fakeReader(rows) });
      const s = await readStream(await handleAsk(args));
      return { part: s.dataParts.find((p) => p.type === 'data-ungrounded'), audit };
    };
    const bad = await run('Wallet WALLET-A-001 has 3 failed transactions: TXN-A-0001, TXN-A-0002.');
    expect(bad.part?.data).toMatchObject({ ids: [] });
    expect(bad.part?.data).toMatchObject({ kind: 'count', ids: [] });
    expect(JSON.stringify(bad.part)).toContain('The answer states 3 failed as a number of transactions');
    expect(JSON.stringify(bad.part)).toContain(
      'the lookups returned: 2 matching (search_transactions: status=failed)',
    );
    expect(JSON.stringify(bad.part)).not.toContain('No lookup counted'); // status=failed was looked up
    expect(bad.audit.requests[0]).toMatchObject({ status: 'ok', errorDetail: 'count_mismatch:3' });
    const good = await run('There are 2 failed transactions: TXN-A-0001, TXN-A-0002.');
    expect(good.part).toBeUndefined();
  });

  it('the model sees "not recorded" for a failed row without a reason; a contradicting answer is flagged and audited', async () => {
    const { model, calls } = scriptedModel([
      { tools: [{ name: 'search_transactions', input: { status: 'failed' } }] },
      {
        text: 'TXN-A-0001 has a reason that is not recorded (null). TXN-A-0002 failed with insufficient_funds.',
      },
    ]);
    const { args, audit } = makeArgs({ model, reader: fakeReader(rows) });
    const s = await readStream(await handleAsk(args));
    const seen = toolMessageText(calls[1]?.prompt);
    expect(seen).toContain('"failure_reason":"not recorded"');
    expect(seen).toContain('"failure_reason":"insufficient_funds"');
    // TXN-A-0001 has insufficient_funds; TXN-A-0002 has none: the answer swaps them.
    expect(JSON.stringify(s.dataParts.find((p) => p.type === 'data-ungrounded'))).toMatch(
      /failure reason does not match/,
    );
    expect(audit.requests[0]?.errorDetail).toMatch(/fact_mismatch:.*TXN-A-0001/);
    expect(audit.requests[0]?.status).toBe('ok');
  });

  it('speculation about failures raises a warning and an audit note, without blocking', async () => {
    const { model } = scriptedModel([
      { tools: [{ name: 'search_transactions', input: { status: 'failed' } }] },
      {
        text: 'TXN-A-0001 failed with insufficient_funds. TXN-A-0002 probably failed because of a bank outage.',
      },
    ]);
    const { args, audit } = makeArgs({ model, reader: fakeReader(rows) });
    const s = await readStream(await handleAsk(args));
    expect(JSON.stringify(s.dataParts.find((p) => p.type === 'data-ungrounded'))).toContain(
      'speculates beyond the recorded failure reasons',
    );
    expect(audit.requests[0]).toMatchObject({ status: 'ok', errorDetail: 'speculation:TXN-A-0002' });
  });

  it('IDs written with Unicode hyphens are still verified (a fabricated one is flagged)', async () => {
    const { model } = scriptedModel([
      { tools: [{ name: 'search_transactions', input: { status: 'failed' } }] },
      { text: 'TXN\u2011A\u20110001 failed, and so did TXN\u2011A\u20110999.' },
    ]);
    const { args, audit } = makeArgs({ model, reader: fakeReader(rows) });
    await readStream(await handleAsk(args));
    expect(audit.requests[0]).toMatchObject({
      citedIds: ['TXN-A-0001', 'TXN-A-0999'],
      ungroundedIds: ['TXN-A-0999'],
    });
  });

  it('an answer cut off by the output cap (finish_reason length) is audited as truncated and warned about', async () => {
    const { model, calls } = scriptedModel([
      { tools: [{ name: 'search_transactions', input: { status: 'failed' } }] },
      { text: 'TXN-A-0001 failed with insufficient_funds, and the next one is', finish: 'length' },
    ]);
    const { args, audit } = makeArgs({ model, reader: fakeReader(rows) });
    args.deps.config.llm.maxOutputTokens = 777;
    const s = await readStream(await handleAsk(args));
    expect(s.text).toContain('the next one is'); // already streamed, so flag it
    expect(JSON.stringify(s.dataParts.find((p) => p.type === 'data-ungrounded'))).toContain(
      'cut off before it finished',
    );
    expect(s.dataParts.find((p) => p.type === 'data-error')).toBeUndefined();
    expect(audit.requests[0]).toMatchObject({ status: 'llm_error', errorCode: 'truncated' });
    expect(audit.requests[0]?.errorDetail).toMatch(/finish_reason=length.*cap 777/);
    expect(calls[0]?.maxOutputTokens).toBe(777);
  });

  it('raw tool-call control tokens leaked as text are audited as malformed_output with an error banner', async () => {
    const { model } = scriptedModel([
      { tools: [{ name: 'search_transactions', input: {} }] },
      {
        text: 'Let\'s aggregate.<|end|><|start|>assistant to=functions aggregate_transactionscommentary json{ "metric": ',
      },
    ]);
    const { args, audit } = makeArgs({ model, reader: fakeReader(rows) });
    const s = await readStream(await handleAsk(args));
    expect(audit.requests[0]).toMatchObject({ status: 'llm_error', errorCode: 'malformed_output' });
    expect(s.dataParts.find((p) => p.type === 'data-error')?.data).toMatchObject({ code: 'llm_error' });
  });

  it('the count warning shows the server facts and says which status was never counted', async () => {
    const { model } = scriptedModel([
      { tools: [{ name: 'search_transactions', input: { status: 'failed' } }] },
      { text: 'All other 16 transactions were completed, and 7 completed transactions are in the ledger.' },
    ]);
    const { args } = makeArgs({ model, reader: fakeReader(rows) });
    const s = await readStream(await handleAsk(args));
    const part = JSON.stringify(s.dataParts.find((p) => p.type === 'data-ungrounded'));
    expect(part).toContain('"kind":"count"');
    expect(part).toContain('16, 7 completed as a number of transactions');
    expect(part).toContain('2 matching (search_transactions: status=failed)');
    expect(part).toContain('No lookup counted completed transactions.');
  });

  it('every warning kind is tagged and names the recorded values', async () => {
    const { model } = scriptedModel([
      { tools: [{ name: 'search_transactions', input: { status: 'failed' } }] },
      {
        text: 'TXN-A-0001 is not recorded. TXN-A-0002 probably failed because of insufficient_funds. See TXN-A-0999.',
      },
    ]);
    const { args } = makeArgs({ model, reader: fakeReader(rows) });
    const s = await readStream(await handleAsk(args));
    const byKind = Object.fromEntries(
      s.dataParts
        .filter((p) => p.type === 'data-ungrounded')
        .map((p) => [(p.data as { kind: string }).kind, p.data as { message: string; ids: string[] }]),
    );
    expect(Object.keys(byKind).sort()).toEqual(['citation', 'fact', 'speculation']);
    expect(byKind.citation?.ids).toEqual(['TXN-A-0999']);
    expect(byKind.fact?.message).toContain('TXN-A-0001: recorded reason is insufficient_funds');
    expect(byKind.fact?.message).toContain('TXN-A-0002: recorded reason is not recorded');
    expect(byKind.speculation?.message).toContain('TXN-A-0002');
  });

  it('(d) a fabricated transaction ID in the answer is flagged as ungrounded', async () => {
    const { model } = scriptedModel([
      { tools: [{ name: 'search_transactions', input: { status: 'failed' } }] },
      { text: 'See TXN-A-0001 and also TXN-A-0999 and TXN-B-0001.' },
    ]);
    const { args, audit } = makeArgs({ model, reader: fakeReader(rows) });
    const s = await readStream(await handleAsk(args));

    const part = s.dataParts.find((p) => p.type === 'data-ungrounded');
    expect(part?.data).toMatchObject({ ids: ['TXN-A-0999', 'TXN-B-0001'] });
    expect(audit.requests[0]).toMatchObject({
      status: 'ok',
      citedIds: ['TXN-A-0001', 'TXN-A-0999', 'TXN-B-0001'],
      ungroundedIds: ['TXN-A-0999', 'TXN-B-0001'],
    });
  });

  it('answers honestly when nothing matches (no_results)', async () => {
    const { model } = scriptedModel([
      {
        tools: [
          { name: 'aggregate_transactions', input: { metric: 'count', status: 'failed', period: 'today' } },
        ],
      },
      { text: 'No matching records for today.' },
    ]);
    const { args, audit } = makeArgs({ model, reader: fakeReader([]) });
    const s = await readStream(await handleAsk(args));
    expect(s.text).toContain('No matching records');
    expect(audit.requests[0]?.status).toBe('no_results');
    expect(audit.toolCalls[0]).toMatchObject({ toolName: 'aggregate_transactions', validated: true });
  });

  it('two invalid tool calls end the loop with validation_error', async () => {
    const { model } = scriptedModel([{ tools: [{ name: 'search_transactions', input: { limit: 500 } }] }]);
    const { args, audit } = makeArgs({ model });
    const s = await readStream(await handleAsk(args));
    expect(audit.toolCalls.filter((c) => !c.validated)).toHaveLength(2);
    expect(audit.requests[0]).toMatchObject({ status: 'validation_error', errorCode: 'validation_error' });
    expect(s.dataParts.find((p) => p.type === 'data-error')?.data).toMatchObject({
      code: 'validation_error',
    });
  });

  it('a failing query returns a generic tool error (no SQL leaks to the model)', async () => {
    const { model, calls } = scriptedModel([
      { tools: [{ name: 'search_transactions', input: {} }] },
      { text: 'I could not retrieve the data.' },
    ]);
    const { args, audit } = makeArgs({ model, reader: fakeReader([], { fail: true }) });
    await readStream(await handleAsk(args));
    expect(JSON.stringify(calls[1]?.prompt)).not.toContain('select * from');
    expect(audit.toolCalls[0]).toMatchObject({ validated: true, validationError: 'query_failed' });
  });

  it('an unknown tool name (create_refund) is audited validated=false and never executed', async () => {
    const { model } = scriptedModel([
      { tools: [{ name: 'create_refund', input: { transaction_id: 'TXN-A-0001' } }] },
      { text: 'I cannot refund; I can only look up transactions.' },
    ]);
    const reader = fakeReader(rows);
    const { args, audit } = makeArgs({ model, reader });
    await readStream(await handleAsk(args));
    expect(reader.searchCalls).toHaveLength(0);
    expect(audit.toolCalls).toHaveLength(1);
    expect(audit.toolCalls[0]).toMatchObject({
      toolName: 'create_refund',
      validated: false,
      rawArgs: { transaction_id: 'TXN-A-0001' },
    });
    expect(audit.toolCalls[0]?.validationError).toMatch(/NoSuchTool|create_refund/);
  });

  it('malformed JSON tool input is audited, counts toward the cap, and ends the loop with validation_error', async () => {
    const { model, calls } = scriptedModel([
      { tools: [{ name: 'search_transactions', raw: '{"status": "failed",' }] },
    ]);
    const { args, audit } = makeArgs({ model });
    const s = await readStream(await handleAsk(args));
    expect(calls.length).toBeLessThanOrEqual(3);
    expect(audit.toolCalls.length).toBeGreaterThanOrEqual(2);
    expect(audit.toolCalls.every((c) => !c.validated && c.toolName === 'search_transactions')).toBe(true);
    expect(audit.toolCalls[0]?.rawArgs).toBe('{"status": "failed",');
    expect(audit.requests[0]).toMatchObject({ status: 'validation_error' });
    expect(s.dataParts.find((p) => p.type === 'data-error')?.data).toMatchObject({
      code: 'validation_error',
    });
  });
});

describe('tool registry (R22 read-only)', () => {
  const build = (reader = fakeReader()) =>
    ledgerTools({
      tenantId: 'tenant_alpha',
      requestId: 'r',
      writer: { write() {} },
      now: () => new Date(),
      reader,
      recorder: new ToolCallRecorder('r'),
    });

  it('contains the two read tools plus the one presentational tool, nothing else', () => {
    const tools = build();
    expect(Object.keys(tools).sort()).toEqual([...TOOL_NAMES].sort());
    expect(Object.keys(tools)).toHaveLength(3);
    expect([...DATA_TOOL_NAMES]).toEqual(['search_transactions', 'aggregate_transactions']);
    expect([...PRESENTATIONAL_TOOL_NAMES]).toEqual(['present_visual']);
  });

  it('present_visual has no DB/reader dependency: running it never touches the reader', async () => {
    const reader = fakeReader();
    const tools = build(reader);
    const exec = tools.present_visual.execute as unknown as (
      i: unknown,
      o: unknown,
    ) => Promise<{ ok: boolean }>;
    const res = await exec(
      { kind: 'bar', source: 'latest_aggregate', title: 'x' },
      { toolCallId: 'c', messages: [] },
    );
    expect(res.ok).toBe(false); // no source yet, so a structured error
    expect(reader.searchCalls).toHaveLength(0);
    expect(reader.aggregateCalls).toHaveLength(0);
  });
});
