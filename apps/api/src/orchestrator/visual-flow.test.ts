import { type AggregateResponse, visualDataPart } from '@demoledger/shared';
import { describe, expect, it } from 'vitest';
import { handleAsk } from './index';
import { fakeReader, makeArgs, readStream, scriptedModel, txn } from './testing';

const dayAgg = (over: Partial<AggregateResponse> = {}): AggregateResponse => ({
  metric: 'sum',
  group_by: 'day',
  groups: [
    { key: '2026-10-26', currency: 'EUR', count: 2, sum_minor: '480000', sum_display: '€4,800.00' },
    { key: '2026-10-27', currency: 'EUR', count: 1, sum_minor: '150000', sum_display: '€1,500.00' },
    { key: '2026-10-27', currency: 'USD', count: 1, sum_minor: '215000', sum_display: '$2,150.00' },
  ],
  total_matching: 4,
  applied_range: null,
  ...over,
});

const visuals = (dataParts: Record<string, unknown>[]) => dataParts.filter((p) => p.type === 'data-visual');
const aggCall = {
  name: 'aggregate_transactions',
  input: { metric: 'sum', group_by: 'day', direction: 'outgoing', period: 'last_7_days' },
};

describe('present_visual (D-26)', () => {
  it('aggregate then present_visual emits a valid data-visual whose data equals the SQL result, one series per currency', async () => {
    const { model, calls } = scriptedModel([
      { tools: [aggCall] },
      {
        tools: [
          {
            name: 'present_visual',
            input: { kind: 'line', source: 'latest_aggregate', title: 'Outgoing, last 7 days' },
          },
        ],
      },
      { text: 'Outgoing totals over the period are shown; 4 transactions matched.' },
    ]);
    const reader = fakeReader([], { aggregate: dayAgg() });
    const { args, audit } = makeArgs({ model, reader });
    const s = await readStream(await handleAsk(args));

    const parts = visuals(s.dataParts);
    expect(parts).toHaveLength(1);
    const part = visualDataPart.parse(parts[0]?.data); // valid per the shared contract
    const el = part.spec.elements[part.spec.root];
    expect(el?.type).toBe('LineChart');
    if (el?.type !== 'LineChart') throw new Error('unreachable');
    expect(el.props.xKey).toBe('key');
    expect(el.props.series).toEqual([
      { key: 'sum_EUR', label: 'Total EUR', currency: 'EUR' },
      { key: 'sum_USD', label: 'Total USD', currency: 'USD' },
    ]);
    expect(el.props.data).toEqual([
      { key: '2026-10-26', sum_EUR: 480000, sum_EUR_display: '€4,800.00' },
      {
        key: '2026-10-27',
        sum_EUR: 150000,
        sum_EUR_display: '€1,500.00',
        sum_USD: 215000,
        sum_USD_display: '$2,150.00',
      },
    ]);
    // The model got only a short confirmation, never the bound numbers again.
    const toolMsgs = (calls[2] as { prompt: { role: string; content: unknown }[] }).prompt.filter(
      (m) => m.role === 'tool',
    );
    const visualResult = JSON.stringify(toolMsgs.at(-1)?.content);
    expect(visualResult).toContain('Line chart shown');
    expect(visualResult).not.toMatch(/visual-/); // no id or reference-like token reaches the model
    expect(visualResult).toContain('"shown":true');
    expect(visualResult).not.toMatch(/215000|480000|4,800/); // the bound numbers are not repeated to the model
    expect(audit.toolCalls.map((c) => [c.toolName, c.validated])).toEqual([
      ['aggregate_transactions', true],
      ['present_visual', true],
    ]);
    expect(audit.requests[0]?.status).toBe('ok');
    expect(audit.requests[0]?.ungroundedIds).toEqual([]);
  });

  it('a single-currency count chart has one series', async () => {
    const agg = dayAgg({
      metric: 'count',
      groups: [
        { key: '2026-10-26', currency: null, count: 3, sum_minor: null, sum_display: null },
        { key: '2026-10-27', currency: null, count: 5, sum_minor: null, sum_display: null },
      ],
      total_matching: 8,
    });
    const { model } = scriptedModel([
      { tools: [{ name: 'aggregate_transactions', input: { metric: 'count', group_by: 'day' } }] },
      {
        tools: [
          { name: 'present_visual', input: { kind: 'bar', source: 'latest_aggregate', title: 'Per day' } },
        ],
      },
      { text: 'Done: 8 matching transactions.' },
    ]);
    const { args } = makeArgs({ model, reader: fakeReader([], { aggregate: agg }) });
    const s = await readStream(await handleAsk(args));
    const part = visualDataPart.parse(visuals(s.dataParts)[0]?.data);
    const el = part.spec.elements[part.spec.root];
    expect(el?.type).toBe('BarChart');
    expect(el && 'series' in el.props ? el.props.series : []).toEqual([
      { key: 'count', label: 'Transactions' },
    ]);
    expect(el && 'data' in el.props ? el.props.data : []).toEqual([
      { key: '2026-10-26', count: 3 },
      { key: '2026-10-27', count: 5 },
    ]);
  });

  it('aggregate by failure_reason then present_visual gives a bar chart with readable labels, raw keys and the SQL counts', async () => {
    const agg = dayAgg({
      metric: 'count',
      group_by: 'failure_reason',
      groups: [
        { key: 'insufficient_funds', currency: null, count: 3, sum_minor: null, sum_display: null },
        { key: 'beneficiary_account_closed', currency: null, count: 1, sum_minor: null, sum_display: null },
        { key: 'not_recorded', currency: null, count: 1, sum_minor: null, sum_display: null },
      ],
      total_matching: 5,
    });
    const { model } = scriptedModel([
      {
        tools: [
          {
            name: 'aggregate_transactions',
            input: { metric: 'count', group_by: 'failure_reason', status: 'failed', period: 'last_30_days' },
          },
        ],
      },
      {
        tools: [
          {
            name: 'present_visual',
            input: { kind: 'bar', source: 'latest_aggregate', title: 'Failed by cause' },
          },
        ],
      },
      { text: 'There are 5 failed transactions in total.' },
    ]);
    const { args, audit } = makeArgs({ model, reader: fakeReader([], { aggregate: agg }) });
    const s = await readStream(await handleAsk(args));
    const part = visualDataPart.parse(visuals(s.dataParts)[0]?.data);
    const el = part.spec.elements[part.spec.root];
    expect(el?.type).toBe('BarChart');
    if (el?.type !== 'BarChart') throw new Error('unreachable');
    expect(el.props.xKey).toBe('label');
    expect(el.props.series).toEqual([{ key: 'count', label: 'Transactions' }]);
    expect(el.props.data).toEqual([
      { key: 'insufficient_funds', label: 'Insufficient funds', count: 3 },
      { key: 'beneficiary_account_closed', label: 'Beneficiary account closed', count: 1 },
      { key: 'not_recorded', label: 'Not recorded', count: 1 },
    ]);
    expect(audit.requests[0]).toMatchObject({ status: 'ok' });
  });

  it('a table from a search binds the returned rows', async () => {
    const { model } = scriptedModel([
      { tools: [{ name: 'search_transactions', input: { status: 'failed' } }] },
      {
        tools: [
          { name: 'present_visual', input: { kind: 'table', source: 'latest_search', title: 'Failed' } },
        ],
      },
      { text: 'The table lists them.' },
    ]);
    const { args } = makeArgs({ model, reader: fakeReader([txn(1), txn(2, { failure_reason: null })]) });
    const s = await readStream(await handleAsk(args));
    const part = visualDataPart.parse(visuals(s.dataParts)[0]?.data);
    const el = part.spec.elements[part.spec.root];
    expect(el?.type).toBe('Table');
    const rows = el && 'rows' in el.props ? el.props.rows : [];
    expect(rows.map((r) => r.transaction_id)).toEqual(['TXN-A-0001', 'TXN-A-0002']);
    expect(rows.map((r) => r.failure_reason)).toEqual(['insufficient_funds', 'not recorded']);
  });

  it('without a source it returns a structured error and emits no part', async () => {
    const { model, calls } = scriptedModel([
      {
        tools: [
          {
            name: 'present_visual',
            input: { kind: 'bar', source: 'latest_aggregate', title: 'Nothing yet' },
          },
        ],
      },
      { text: 'I need data first.' },
    ]);
    const { args, audit } = makeArgs({ model });
    const s = await readStream(await handleAsk(args));
    expect(visuals(s.dataParts)).toHaveLength(0);
    expect(JSON.stringify((calls[1] as { prompt: unknown }).prompt)).toContain(
      'Call aggregate_transactions first',
    );
    expect(audit.toolCalls[0]).toMatchObject({ toolName: 'present_visual', validated: true });
    expect(audit.toolCalls[0]?.validationError).toMatch(/^no_visual:/);
  });

  it('invalid args are audited validated=false, raw args kept verbatim, and no part is emitted', async () => {
    const bad = {
      kind: 'pie',
      source: 'latest_aggregate',
      title: 'x',
      data: [1, 2, 3],
      tenant_id: 'tenant_beta',
    };
    const { model } = scriptedModel([{ tools: [{ name: 'present_visual', input: bad }] }]);
    const { args, audit } = makeArgs({ model });
    const s = await readStream(await handleAsk(args));
    expect(visuals(s.dataParts)).toHaveLength(0);
    expect(audit.toolCalls[0]).toMatchObject({ toolName: 'present_visual', validated: false, rawArgs: bad });
    expect(audit.toolCalls.every((c) => !c.validated)).toBe(true);
    expect(audit.requests[0]?.status).toBe('validation_error');
  });

  it('charts from a search, or a sum chart with a count aggregate, are refused with guidance', async () => {
    const { model, calls } = scriptedModel([
      { tools: [{ name: 'search_transactions', input: {} }] },
      { tools: [{ name: 'present_visual', input: { kind: 'bar', source: 'latest_search', title: 'x' } }] },
      { text: 'ok' },
    ]);
    const { args } = makeArgs({ model, reader: fakeReader([txn(1)]) });
    const s = await readStream(await handleAsk(args));
    expect(visuals(s.dataParts)).toHaveLength(0);
    expect(JSON.stringify((calls[2] as { prompt: unknown }).prompt)).toContain('Charts need grouped totals');
  });
});
