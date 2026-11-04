// @vitest-environment jsdom
import { WALLET_NOT_FOUND_TITLE } from '@demoledger/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@/lib/chat-parts';
import { ChatMessageView } from './chat-message';

const assistant = (parts: ChatMessage['parts']): ChatMessage => ({ id: 'a1', role: 'assistant', parts });
const renderProgress = (
  parts: ChatMessage['parts'],
  props: { pendingLabel?: string | null; waitingLabel?: string | null },
) =>
  renderToStaticMarkup(
    <ChatMessageView message={assistant(parts)} streaming onRetry={() => {}} {...props} />,
  );

describe('initial orb versus step pending row', () => {
  it('with no parts the orb renders and the pending row does not', () => {
    const html = renderProgress([], { waitingLabel: 'Thinking' });
    expect(html).toContain('data-testid="waiting-orb"');
    expect(html).toContain('Thinking');
    expect(html).not.toContain('data-testid="pending-step"');
  });

  it('after a completed tool part the pending row renders and the orb does not', () => {
    const html = renderProgress(
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

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/transactions">{children}</a>,
}));
vi.mock('@/components/ai-elements/message', () => ({
  Message: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageResponse: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));
afterEach(cleanup);

describe('wallet lookup notice', () => {
  it.each([false, true])('shows a deterministic notice only when wallet found=%s is false', (found) => {
    const message: ChatMessage = {
      id: 'response',
      role: 'assistant',
      parts: [
        {
          type: 'tool-aggregate_transactions',
          toolCallId: 'lookup',
          state: 'output-available',
          input: { wallet_id: 'WALLET-A-001', status: 'failed', metric: 'count' },
          output: {
            ok: true,
            metric: 'count',
            group_by: 'none',
            groups: [],
            total_matching: 0,
            applied_range: null,
            wallet_lookup: { wallet_id: 'WALLET-A-001', found },
          },
        },
        { type: 'text', text: 'No failed transactions were found.' },
      ],
    };
    render(<ChatMessageView message={message} streaming={false} onRetry={() => {}} />);
    if (found) expect(screen.queryByText(WALLET_NOT_FOUND_TITLE)).toBeNull();
    else {
      expect(screen.getByText(WALLET_NOT_FOUND_TITLE)).toBeTruthy();
      expect(screen.getByRole('link', { name: 'View your transactions' }).getAttribute('href')).toBe(
        '/transactions',
      );
    }
  });
});
