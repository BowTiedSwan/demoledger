import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PendingStep, STEP_ROW_CLASS, Tool } from './tool';

const tool = (state: Parameters<typeof Tool>[0]['state'], output?: unknown) =>
  renderToStaticMarkup(<Tool title="Searching transactions" state={state} input={{}} output={output} />);

describe('Tool row states', () => {
  it.each(['input-streaming', 'input-available'] as const)(
    '%s shows a spinner and "…", not a check',
    (state) => {
      const html = tool(state);
      expect(html).toContain('lucide-loader-circle');
      expect(html).toContain('animate-spin');
      expect(html).toContain('motion-reduce:animate-none');
      expect(html).not.toContain('lucide-check');
      expect(html).toContain('Searching transactions…');
      expect(html).toContain('Running');
    },
  );

  it('output-available switches to a check with no spinner', () => {
    const html = tool('output-available', {
      ok: true,
      rows: [],
      returned: 0,
      total_matching: 0,
      truncated: false,
    });
    expect(html).toContain('lucide-check');
    expect(html).not.toContain('lucide-loader-circle');
    expect(html).not.toContain('…');
  });
});

describe('PendingStep', () => {
  it('uses the same row class as a tool row, so replacing one with the other does not shift layout', () => {
    expect(renderToStaticMarkup(<PendingStep label="Thinking…" />)).toContain(STEP_ROW_CLASS);
    expect(tool('input-available')).toContain('min-h-11');
    expect(STEP_ROW_CLASS).toContain('min-h-11');
  });

  it('shows a spinner and a shimmer label, with a motion-reduce fallback', () => {
    const html = renderToStaticMarkup(<PendingStep label="Analysing the results…" />);
    expect(html).toContain('lucide-loader-circle');
    expect(html).toContain('motion-reduce:animate-none');
    expect(html).toContain('shimmer');
    expect(html).toContain('Analysing the results…');
  });
});
