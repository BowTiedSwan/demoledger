import { describe, expect, it } from 'vitest';
import {
  ASK_HISTORY_ANSWER_MAX_CHARS,
  ASK_HISTORY_MAX_PAIRS,
  aggregateTransactionsArgs,
  aggregateTransactionsQuery,
  askRequest,
  extractTransactionIds,
  formatMinorUnits,
  latestQuestion,
  listTransactionsQuery,
  resolveExplicitRange,
  resolvePeriod,
  searchTransactionsArgs,
} from './index';

const issues = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  r.success ? [] : (r.error?.issues ?? []).map((i) => `${i.path.join('.')}: ${i.message}`);

describe('searchTransactionsArgs', () => {
  it('applies defaults', () => {
    expect(searchTransactionsArgs.parse({})).toEqual({ sort: 'occurred_at_desc', limit: 20 });
  });

  it.each([
    [{ tenant_id: 'tenant_beta' }, 'Unrecognized key'],
    [{ limit: 51 }, 'limit must be between 1 and 50'],
    [{ limit: 0 }, 'limit must be between 1 and 50'],
    [{ wallet_id: 'WALLET-C-001' }, 'wallet_id must look like'],
    [{ status: 'refunded' }, 'Invalid option'],
    [{ period: 'today', from: '2026-10-01', to: '2026-10-02' }, "either 'period' or explicit"],
    [{ from: '2026-10-01' }, "need both 'from' and 'to'"],
    [{ from: '2026-10-10', to: '2026-10-01' }, "'from' must be on or before 'to'"],
    [{ from: '2026-01-01', to: '2026-06-01' }, 'at most 90 days'],
    [{ min_amount_minor: 500, max_amount_minor: 100 }, "'min_amount_minor' must be less than"],
    [{ min_amount_minor: 1.5 }, 'integer amount in minor units'],
    [{ wallet_id: { id: 'WALLET-A-001' } }, 'expected string'],
  ])('rejects %j', (input, message) => {
    const r = searchTransactionsArgs.safeParse(input);
    expect(r.success).toBe(false);
    expect(issues(r).join('\n')).toContain(message);
  });

  it('accepts transaction_ids (1-50 valid IDs), combined with other filters', () => {
    expect(
      searchTransactionsArgs.parse({ transaction_ids: ['TXN-B-0039', 'TXN-B-0041'], status: 'completed' }),
    ).toMatchObject({ transaction_ids: ['TXN-B-0039', 'TXN-B-0041'], status: 'completed' });
    const ids = Array.from({ length: 51 }, (_, i) => `TXN-A-${String(i + 1).padStart(4, '0')}`);
    expect(searchTransactionsArgs.safeParse({ transaction_ids: ids }).success).toBe(false);
    expect(searchTransactionsArgs.safeParse({ transaction_ids: [] }).success).toBe(false);
    expect(searchTransactionsArgs.safeParse({ transaction_ids: ['TXN-C-0001'] }).success).toBe(false);
    expect(
      searchTransactionsArgs.safeParse({ transaction_ids: ['TXN-A-0001'], tenant_id: 'tenant_beta' }).success,
    ).toBe(false);
  });

  it('accepts a 90-day inclusive range', () => {
    expect(searchTransactionsArgs.safeParse({ from: '2026-08-01', to: '2026-10-29' }).success).toBe(true);
  });
});

describe('aggregateTransactionsArgs', () => {
  it('accepts group_by=failure_reason (key "not_recorded" for null reasons)', () => {
    expect(aggregateTransactionsQuery.parse({ metric: 'count', group_by: 'failure_reason' }).group_by).toBe(
      'failure_reason',
    );
    expect(
      aggregateTransactionsArgs.parse({ metric: 'count', group_by: 'failure_reason', status: 'failed' })
        .group_by,
    ).toBe('failure_reason');
  });

  it('requires metric and defaults group_by', () => {
    expect(aggregateTransactionsArgs.safeParse({}).success).toBe(false);
    expect(aggregateTransactionsArgs.parse({ metric: 'count' })).toEqual({
      metric: 'count',
      group_by: 'none',
    });
  });
});

describe('listTransactionsQuery', () => {
  it('coerces query strings and rejects unknown params', () => {
    expect(
      listTransactionsQuery.parse({ limit: '10', min_amount_minor: '100', transaction_id: 'TXN-A-0001' }),
    ).toEqual({
      transaction_id: 'TXN-A-0001',
      min_amount_minor: 100,
      sort: 'occurred_at_desc',
      limit: 10,
      offset: 0,
    });
    expect(listTransactionsQuery.safeParse({ tenant_id: 'tenant_beta' }).success).toBe(false);
    expect(listTransactionsQuery.safeParse({ limit: '500' }).success).toBe(false);
  });
});

describe('dates (UTC)', () => {
  const now = new Date('2026-10-28T10:00:00Z'); // a Wednesday
  it('resolves periods as half-open UTC ranges', () => {
    expect(resolvePeriod('yesterday', now)).toEqual({
      from: new Date('2026-10-27T00:00:00Z'),
      to: new Date('2026-10-28T00:00:00Z'),
    });
    expect(resolvePeriod('this_week', now)).toEqual({
      from: new Date('2026-10-26T00:00:00Z'),
      to: new Date('2026-11-02T00:00:00Z'),
    });
    expect(resolvePeriod('last_7_days', now).from).toEqual(new Date('2026-10-22T00:00:00Z'));
  });
  it('treats a date-only `to` as inclusive of that day', () => {
    expect(resolveExplicitRange('2026-10-01', '2026-10-01')).toEqual({
      from: new Date('2026-10-01T00:00:00Z'),
      to: new Date('2026-10-02T00:00:00Z'),
    });
  });
});

describe('money', () => {
  it('formats minor units without floating point', () => {
    expect(formatMinorUnits(123456, 'EUR')).toBe('€1,234.56');
    expect(formatMinorUnits('99999999999999999999', 'USD')).toBe('$999,999,999,999,999,999.99');
    expect(formatMinorUnits(5n, 'GBP')).toBe('£0.05');
  });
});

describe('ask contracts', () => {
  const CONV = '3f2b8c1e-4d5a-4b6c-9e7f-0a1b2c3d4e5f';
  const user = (text: string) => ({ id: 'm1', role: 'user' as const, parts: [{ type: 'text', text }] });
  it('accepts the useChat body and extracts the latest question', () => {
    const body = askRequest.parse({
      conversationId: CONV,
      id: 'c1',
      messages: [user('  How many failed yesterday? ')],
      trigger: 'submit-message',
    });
    expect(body.conversationId).toBe(CONV);
    expect(latestQuestion(body)).toBe('How many failed yesterday?');
  });
  it('requires a UUID conversationId (D-24)', () => {
    expect(askRequest.safeParse({ messages: [user('hi')] }).success).toBe(false);
    expect(askRequest.safeParse({ conversationId: 'not-a-uuid', messages: [user('hi')] }).success).toBe(
      false,
    );
  });
  it('rejects system messages, empty and oversized questions', () => {
    const ask = (messages: unknown[]) => askRequest.safeParse({ conversationId: CONV, messages }).success;
    expect(ask([{ id: 's', role: 'system', parts: [] }])).toBe(false);
    expect(ask([user('   ')])).toBe(false);
    expect(ask([user('x'.repeat(2001))])).toBe(false);
  });
  it('uses only the last user message as the question', () => {
    const body = askRequest.parse({
      conversationId: CONV,
      messages: [
        user('earlier question'),
        { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'x' }] },
        user('which wallets?'),
      ],
    });
    expect(latestQuestion(body)).toBe('which wallets?');
  });
  it('exposes the history limits', () => {
    expect(ASK_HISTORY_MAX_PAIRS).toBe(3);
    expect(ASK_HISTORY_ANSWER_MAX_CHARS).toBe(2000);
  });
  it('extracts distinct cited transaction IDs', () => {
    expect(extractTransactionIds('TXN-A-0001, TXN-A-0001 and TXN-B-0042; not TXN-C-0001')).toEqual([
      'TXN-A-0001',
      'TXN-B-0042',
    ]);
  });
});

describe('generative UI contracts (D-26)', () => {
  it('separates data tools from the presentational tool', async () => {
    const { DATA_TOOL_NAMES, PRESENTATIONAL_TOOL_NAMES, TOOL_NAMES } = await import('./index');
    expect(DATA_TOOL_NAMES).toEqual(['search_transactions', 'aggregate_transactions']);
    expect(PRESENTATIONAL_TOOL_NAMES).toEqual(['present_visual']);
    expect(TOOL_NAMES).toEqual(['search_transactions', 'aggregate_transactions', 'present_visual']);
  });

  it('presentVisualArgs is strict and carries no data', async () => {
    const { presentVisualArgs } = await import('./index');
    expect(
      presentVisualArgs.parse({ kind: 'bar', source: 'latest_aggregate', title: 'Outgoing per day' }),
    ).toEqual({ kind: 'bar', source: 'latest_aggregate', title: 'Outgoing per day' });
    expect(presentVisualArgs.safeParse({ kind: 'pie', source: 'latest_search', title: 'x' }).success).toBe(
      false,
    );
    expect(presentVisualArgs.safeParse({ kind: 'bar', source: 'latest_search', title: '' }).success).toBe(
      false,
    );
    expect(
      presentVisualArgs.safeParse({ kind: 'bar', source: 'latest_search', title: 'x'.repeat(81) }).success,
    ).toBe(false);
    expect(
      presentVisualArgs.safeParse({ kind: 'bar', source: 'latest_search', title: 'x', data: [{ v: 1 }] })
        .success,
    ).toBe(false);
    expect(
      presentVisualArgs.safeParse({
        kind: 'bar',
        source: 'latest_search',
        title: 'x',
        tenant_id: 'tenant_beta',
      }).success,
    ).toBe(false);
  });

  it('visualSpec mirrors the json-render flat spec for our catalog only', async () => {
    const { visualSpec, askDataPartSchemas } = await import('./index');
    const spec = {
      root: 'chart',
      elements: {
        chart: {
          type: 'BarChart',
          props: {
            title: 'Outgoing, last 7 days',
            xKey: 'day',
            series: [{ key: 'EUR_sum_minor', label: 'EUR', currency: 'EUR' }],
            data: [{ day: '2026-10-27', EUR_sum_minor: 231650, EUR_sum_display: '€2,316.50' }],
          },
        },
      },
    };
    expect(visualSpec.safeParse(spec).success).toBe(true);
    expect(askDataPartSchemas.visual.safeParse({ id: 'v1', spec }).success).toBe(true);
    // root must exist; unknown components, actions and bindings are rejected
    expect(visualSpec.safeParse({ ...spec, root: 'missing' }).success).toBe(false);
    expect(visualSpec.safeParse({ root: 'x', elements: { x: { type: 'Script', props: {} } } }).success).toBe(
      false,
    );
    expect(
      visualSpec.safeParse({
        root: 'chart',
        elements: { chart: { ...spec.elements.chart, on: { press: { action: 'refund' } } } },
      }).success,
    ).toBe(false);
    expect(visualSpec.safeParse({ ...spec, state: { a: 1 } }).success).toBe(false);
    expect(
      visualSpec.safeParse({
        root: 's',
        elements: { s: { type: 'Stat', props: { label: 'Failed yesterday', value: '4' } } },
      }).success,
    ).toBe(true);
  });
});
