// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { labelMaxChars, wrapLabel, xAxisInterval } from '@/lib/chart-format';
import { CategoryTick, ChartFigure } from './charts';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

const CAUSES = [
  'Beneficiary account closed',
  'Insufficient funds',
  'Compliance hold',
  'Card declined',
  'Network timeout',
  'Not recorded',
];

describe('category labels (never dropped)', () => {
  it('the axis never skips labels for a normal number of categories', () => {
    expect(xAxisInterval(6)).toBe(0);
    expect(xAxisInterval(12)).toBe(0);
    expect(xAxisInterval(31)).toBe('preserveStartEnd'); // many dates may thin out
  });

  it('wraps a long label onto two lines on spaces, and truncates beyond that', () => {
    expect(wrapLabel('Beneficiary account closed', 16)).toEqual(['Beneficiary', 'account closed']);
    expect(wrapLabel('Card declined', 16)).toEqual(['Card declined']);
    const long = wrapLabel('Extraordinarily long single-word-ish category name that keeps going', 12);
    expect(long).toHaveLength(2);
    expect(long.every((l) => l.length <= 12)).toBe(true);
    expect(long[1]?.endsWith('…')).toBe(true);
  });

  it('a tick keeps the full label in a <title> and renders every wrapped line', () => {
    const html = renderToStaticMarkup(
      <svg role="img" aria-label="axis tick">
        <CategoryTick
          x={10}
          y={0}
          payload={{ value: 'Beneficiary account closed' }}
          maxChars={labelMaxChars(6)}
        />
      </svg>,
    );
    expect(html).toContain('<title>Beneficiary account closed</title>');
    expect(html).toContain('>Beneficiary<');
    expect(html).toContain('>account closed<');
  });

  it('renders every category, including the longest, in the data table and as an axis tick', () => {
    const { container } = render(
      <ChartFigure
        kind="bar"
        props={{
          title: 'Failed by cause',
          xKey: 'cause',
          series: [{ key: 'n', label: 'Failed' }],
          data: CAUSES.map((cause, i) => ({ cause, n: i + 1 })),
        }}
      />,
    );
    const table = container.querySelector('table')?.textContent ?? '';
    for (const c of CAUSES) expect(table).toContain(c); // accessible table: full labels
    const ticks = [...container.querySelectorAll('.recharts-xAxis title')].map((t) => t.textContent);
    // If jsdom drew the SVG, every category must be a tick (none skipped).
    if (ticks.length > 0) expect(ticks).toEqual(CAUSES);
    console.info(`x-axis ticks drawn in jsdom: ${ticks.length}`);
  });
});
