import type { VisualSpec } from '@demoledger/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { formatAxisValue, formatSeriesValue, groupSeriesByCurrency, plotValue } from '@/lib/chart-format';
import { wrapClass } from './registry';
import { VisualBlock } from './visual-block';

const specOf = (element: VisualSpec['elements'][string]): { id: string; spec: VisualSpec } => ({
  id: 'v1',
  spec: { root: 'r', elements: { r: element } },
});
const html = (data: unknown) => renderToStaticMarkup(<VisualBlock data={data} />);

const chartProps = {
  title: 'Outgoing per day',
  xKey: 'day',
  series: [
    { key: 'EUR_minor', label: 'Outgoing EUR', currency: 'EUR' as const },
    { key: 'USD_minor', label: 'Outgoing USD', currency: 'USD' as const },
  ],
  data: [
    { day: '2026-10-27', EUR_minor: 231650, USD_minor: 4550 },
    { day: '2026-10-28', EUR_minor: 100, USD_minor: null },
  ],
};

describe('catalog rendering', () => {
  it('renders a bar chart with a title, per-currency legends and exact values for screen readers', () => {
    const out = html(specOf({ type: 'BarChart', props: chartProps }));
    expect(out).toContain('Outgoing per day');
    expect(out).toContain('Outgoing EUR');
    expect(out).toContain('(USD)');
    expect(out).toContain('€2,316.50');
    expect(out).toContain('$45.50');
    expect(out).toContain('No data');
    expect(out).toContain('recharts-responsive-container');
  });

  it('renders a line chart', () => {
    const out = html(specOf({ type: 'LineChart', props: chartProps }));
    expect(out).toContain('Outgoing per day');
    expect(out).toContain('recharts-responsive-container');
  });

  it('renders a count chart without currency formatting', () => {
    const out = html(
      specOf({
        type: 'BarChart',
        props: {
          title: 'Failed per day',
          xKey: 'day',
          series: [{ key: 'n', label: 'Failed' }],
          data: [{ day: 'Mon', n: 1234 }],
        },
      }),
    );
    expect(out).toContain('1,234');
    expect(out).not.toContain('€');
  });

  it('renders a table', () => {
    const out = html(
      specOf({
        type: 'Table',
        props: {
          title: 'Largest',
          columns: [
            { key: 'id', label: 'Transaction' },
            { key: 'amount', label: 'Amount', align: 'right' },
          ],
          rows: [{ id: 'TXN-B-0039', amount: '€2,316.50' }],
        },
      }),
    );
    expect(out).toContain('Transaction');
    expect(out).toContain('TXN-B-0039');
    expect(out).toContain('€2,316.50');
  });

  it('renders null and empty table cells as a dash labelled Not applicable, not "No data"', () => {
    const out = html(
      specOf({
        type: 'Table',
        props: {
          title: 'Recent',
          columns: [
            { key: 'id', label: 'Transaction' },
            { key: 'reason', label: 'Failure reason' },
          ],
          rows: [
            { id: 'TXN-B-0001', reason: null },
            { id: 'TXN-B-0002', reason: '' },
            { id: 'TXN-B-0003', reason: 'Not recorded' },
          ],
        },
      }),
    );
    expect(out.match(/aria-label="Not applicable"/g)).toHaveLength(2);
    expect(out).toContain('—');
    expect(out).toContain('Not recorded');
    expect(out).not.toContain('No data');
  });

  it('keeps IDs, wallets, dates and amounts on one line; only description and reason columns may wrap', () => {
    const out = html(
      specOf({
        type: 'Table',
        props: {
          title: 'Recent',
          columns: [
            { key: 'transaction_id', label: 'Transaction' },
            { key: 'wallet_id', label: 'Wallet' },
            { key: 'occurred_at', label: 'Date' },
            { key: 'amount', label: 'Amount', align: 'right' },
            { key: 'failure_reason', label: 'Failure reason' },
            { key: 'description', label: 'Description' },
          ],
          rows: [
            {
              transaction_id: 'TXN-A-0055',
              wallet_id: 'WALLET-A-003',
              occurred_at: '2026-10-29',
              amount: '$455.00',
              failure_reason: 'Card declined',
              description: 'Supplier payout',
            },
          ],
        },
      }),
    );
    expect(wrapClass('transaction_id')).toBe('whitespace-nowrap');
    expect(wrapClass('wallet_id')).toBe('whitespace-nowrap');
    expect(wrapClass('amount')).toBe('whitespace-nowrap');
    expect(wrapClass('description')).toContain('whitespace-normal');
    expect(wrapClass('failure_reason')).toContain('whitespace-normal');
    expect(out.match(/whitespace-nowrap/g)?.length).toBeGreaterThanOrEqual(8); // 4 headers + 4 cells
    expect(out).toContain('scroll-edges');
    expect(out).toContain('tabular-nums');
  });

  it('renders a stat', () => {
    const out = html(
      specOf({ type: 'Stat', props: { label: 'Failed yesterday', value: '5', sublabel: 'Alpha' } }),
    );
    expect(out).toContain('Failed yesterday');
    expect(out).toContain('>5<');
    expect(out).toContain('Alpha');
  });

  it('renders an empty chart message', () => {
    const out = html(specOf({ type: 'BarChart', props: { ...chartProps, data: [] } }));
    expect(out).toContain('No data to chart.');
  });
});

describe('invalid specs', () => {
  it('shows a soft callout, not a crash, for an unknown component', () => {
    const out = html({ id: 'v', spec: { root: 'r', elements: { r: { type: 'Script', props: {} } } } });
    expect(out).toContain('This visual could not be displayed.');
  });

  it('rejects a root that is not an element, extra props and non-objects', () => {
    expect(html({ id: 'v', spec: { root: 'x', elements: {} } })).toContain('could not be displayed');
    expect(
      html({
        id: 'v',
        spec: {
          root: 'r',
          elements: { r: { type: 'Stat', props: { label: 'a', value: 'b', onClick: 'alert(1)' } } },
        },
      }),
    ).toContain('could not be displayed');
    expect(html(null)).toContain('could not be displayed');
  });
});

describe('money formatting', () => {
  it('formats exact values from minor units per currency', () => {
    expect(formatSeriesValue(231650, 'EUR')).toBe('€2,316.50');
    expect(formatSeriesValue(5, 'USD')).toBe('$0.05');
    expect(formatSeriesValue(100, 'GBP')).toBe('£1.00');
    expect(formatSeriesValue(null, 'EUR')).toBe('No data');
    expect(formatSeriesValue(42, undefined)).toBe('42');
  });

  it('formats compact axis ticks from minor units', () => {
    expect(formatAxisValue(231650, 'EUR')).toBe('€2.3K');
    expect(formatAxisValue(1500, undefined)).toBe('1.5K');
  });

  it('groups series by currency and never mixes them', () => {
    const groups = groupSeriesByCurrency(chartProps.series);
    expect(groups.map((g) => g.currency)).toEqual(['EUR', 'USD']);
    expect(groups.every((g) => g.series.length === 1)).toBe(true);
  });

  it('plots missing or invalid values as 0', () => {
    expect(plotValue({ a: null }, 'a')).toBe(0);
    expect(plotValue({ a: 'x' }, 'a')).toBe(0);
    expect(plotValue({ a: 7 }, 'a')).toBe(7);
    expect(plotValue({}, 'a')).toBe(0);
  });
});

describe('hostile model-supplied text (F-29)', () => {
  const hostile = [
    '<img src="https://evil.example/x">',
    '![x](https://evil.example/a.png)',
    'https://evil.example/bare-link',
  ];

  const expectPlainText = (out: string, payload: string) => {
    expect(out).not.toMatch(/<img/i);
    expect(out).not.toMatch(/href=/i);
    expect(out).not.toMatch(/<a[\s>]/i);
    expect(out).not.toMatch(/<script/i);
    // The payload is still visible, as escaped text.
    const escaped = payload
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
    expect(out).toContain(escaped);
  };

  it.each(hostile)('chart title, series label and x values render as plain text: %s', (payload) => {
    const out = html(
      specOf({
        type: 'BarChart',
        props: {
          title: payload,
          xKey: 'day',
          series: [{ key: 'n', label: payload }],
          data: [{ day: payload, n: 3 }],
        },
      }),
    );
    expectPlainText(out, payload);
  });

  it.each(hostile)('table title, column label and cell render as plain text: %s', (payload) => {
    const out = html(
      specOf({
        type: 'Table',
        props: { title: payload, columns: [{ key: 'c', label: payload }], rows: [{ c: payload }] },
      }),
    );
    expectPlainText(out, payload);
  });

  it.each(hostile)('stat label, value and sublabel render as plain text: %s', (payload) => {
    const out = html(specOf({ type: 'Stat', props: { label: payload, value: payload, sublabel: payload } }));
    expectPlainText(out, payload);
  });
});
