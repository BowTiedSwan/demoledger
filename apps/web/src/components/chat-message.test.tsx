import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/lib/chat-parts';
import { ChatMessageView } from './chat-message';

const assistant = (parts: ChatMessage['parts']): ChatMessage => ({ id: 'a1', role: 'assistant', parts });
const render = (
  parts: ChatMessage['parts'],
  props: { pendingLabel?: string | null; waitingLabel?: string | null },
) =>
  renderToStaticMarkup(
    <ChatMessageView message={assistant(parts)} streaming onRetry={() => {}} {...props} />,
  );

describe('initial orb versus step pending row', () => {
  it('with no parts the orb renders and the pending row does not', () => {
    const html = render([], { waitingLabel: 'Thinking' });
    expect(html).toContain('data-testid="waiting-orb"');
    expect(html).toContain('Thinking');
    expect(html).not.toContain('data-testid="pending-step"');
  });

  it('after a completed tool part the pending row renders and the orb does not', () => {
    const html = render(
      [
        {
          type: 'tool-search_transactions',
          toolCallId: 'c1',
          state: 'output-available',
          input: {},
          output: {
            ok: true,
            rows: [],
            returned: 0,
            total_matching: 0,
            truncated: false,
            applied_range: null,
          },
        },
      ],
      { pendingLabel: 'Analysing the results…' },
    );
    expect(html).toContain('data-testid="pending-step"');
    expect(html).toContain('Analysing the results…');
    expect(html).not.toContain('data-testid="waiting-orb"');
  });
});
