import { ASK_ERROR_MESSAGES } from '@demoledger/shared';
import { describe, expect, it } from 'vitest';
import {
  hasVisibleContent,
  isWaitingForFirstToken,
  messageNotices,
  runningToolLabel,
  SUGGESTED_QUESTIONS,
  sourceLinks,
  summarizeToolOutput,
  toolNameOfPart,
  toolTitle,
  ungroundedTitle,
  waitingStatusLine,
} from './chat-parts';

describe('suggested questions', () => {
  it('are verbatim from the brief', () => {
    expect(SUGGESTED_QUESTIONS).toEqual([
      'Why did wallet WALLET-A-001 have failed transactions?',
      'Show the largest completed outgoing transactions this week.',
      'How many failed transactions occurred yesterday?',
      'Summarize recent activity for WALLET-A-002.',
      'Show me a graph of outgoing transactions for the past week.',
    ]);
  });
});

describe('tool parts', () => {
  it('recognises only the two known tools', () => {
    expect(toolNameOfPart({ type: 'tool-search_transactions' })).toBe('search_transactions');
    expect(toolNameOfPart({ type: 'tool-aggregate_transactions' })).toBe('aggregate_transactions');
    expect(toolNameOfPart({ type: 'tool-delete_everything' })).toBeNull();
    expect(toolNameOfPart({ type: 'text' })).toBeNull();
  });

  it('uses friendly titles for running and finished states', () => {
    expect(toolTitle({ type: 'tool-search_transactions', state: 'input-available' })).toBe(
      'Searching transactions',
    );
    expect(toolTitle({ type: 'tool-aggregate_transactions', state: 'input-streaming' })).toBe(
      'Aggregating transactions',
    );
    expect(toolTitle({ type: 'tool-search_transactions', state: 'output-available' })).toBe(
      'Searched transactions',
    );
  });

  it('derives the status line from the latest running tool', () => {
    const parts = [
      { type: 'tool-search_transactions', state: 'output-available' },
      { type: 'tool-aggregate_transactions', state: 'input-available' },
    ];
    expect(runningToolLabel(parts)).toBe('Aggregating transactions');
    expect(runningToolLabel([{ type: 'tool-search_transactions', state: 'output-available' }])).toBeNull();
  });
});

describe('waiting state', () => {
  it('waits while submitted, and while streaming with no visible content', () => {
    expect(isWaitingForFirstToken('submitted', undefined)).toBe(true);
    expect(isWaitingForFirstToken('streaming', { role: 'assistant', parts: [{ type: 'step-start' }] })).toBe(
      true,
    );
    expect(isWaitingForFirstToken('streaming', { role: 'user', parts: [] })).toBe(true);
  });

  it('stops waiting once text or a tool call is visible', () => {
    expect(
      isWaitingForFirstToken('streaming', { role: 'assistant', parts: [{ type: 'text', text: 'Hi' }] }),
    ).toBe(false);
    expect(
      isWaitingForFirstToken('streaming', {
        role: 'assistant',
        parts: [{ type: 'tool-search_transactions', state: 'input-available' }],
      }),
    ).toBe(false);
    expect(isWaitingForFirstToken('ready', undefined)).toBe(false);
  });

  it('ignores whitespace-only text', () => {
    expect(hasVisibleContent([{ type: 'text', text: '  ' }])).toBe(false);
  });

  it('prefers the transient status label, then the running tool, then a default', () => {
    expect(waitingStatusLine('Checking the request', undefined)).toBe('Checking the request');
    expect(waitingStatusLine(null, undefined)).toBe('Thinking');
  });
});

describe('messageNotices', () => {
  it('extracts guard, ungrounded and error data parts, with error copy from the shared map', () => {
    const notices = messageNotices([
      { type: 'text' },
      { type: 'data-guard', data: { verdict: 'block', message: 'Blocked.' } },
      { type: 'data-ungrounded', data: { ids: ['TXN-A-9999'], message: 'Not found in results.' } },
      {
        type: 'data-error',
        data: { code: 'timeout', message: 'server text', requestId: 'r1', retryable: true },
      },
    ]);
    expect(notices.guard?.verdict).toBe('block');
    expect(notices.ungrounded.map((w) => w.ids)).toEqual([['TXN-A-9999']]);
    expect(notices.error?.message).toBe(ASK_ERROR_MESSAGES.timeout);
    expect(notices.error?.requestId).toBe('r1');
    expect(notices.error?.retryable).toBe(true);
  });

  it('returns nulls when nothing is present', () => {
    expect(messageNotices([{ type: 'text' }])).toEqual({ guard: null, ungrounded: [], error: null });
  });
});

describe('messageNotices with several warnings', () => {
  it('keeps every warning part, de-duplicated by kind and message', () => {
    const count = { ids: [], kind: 'count', message: 'The count was not verified.' };
    const fact = { ids: ['TXN-A-0001'], kind: 'fact', message: 'The amount differs from the record.' };
    const { ungrounded } = messageNotices([
      { type: 'data-ungrounded', data: count },
      { type: 'data-ungrounded', data: fact },
      { type: 'data-ungrounded', data: count },
    ]);
    expect(ungrounded).toEqual([count, fact]);
    expect(ungrounded.map((w) => ungroundedTitle(w.kind))).toEqual([
      'Number not verified',
      "Doesn't match the record",
    ]);
  });

  it('keeps same-message warnings of different kinds', () => {
    const { ungrounded } = messageNotices([
      { type: 'data-ungrounded', data: { ids: [], kind: 'count', message: 'm' } },
      { type: 'data-ungrounded', data: { ids: [], kind: 'fact', message: 'm' } },
    ]);
    expect(ungrounded).toHaveLength(2);
  });
});

describe('ungroundedTitle', () => {
  it('maps each kind to its title', () => {
    expect(ungroundedTitle('citation')).toBe('Unverified citation');
    expect(ungroundedTitle('count')).toBe('Number not verified');
    expect(ungroundedTitle('fact')).toBe("Doesn't match the record");
    expect(ungroundedTitle('speculation')).toBe('Speculation');
    expect(ungroundedTitle('truncated')).toBe('Answer cut off');
  });

  it('falls back when the kind is missing or unknown', () => {
    expect(ungroundedTitle(undefined)).toBe('Check this answer');
    expect(ungroundedTitle(null)).toBe('Check this answer');
    expect(ungroundedTitle('other')).toBe('Check this answer');
  });
});

describe('sourceLinks', () => {
  it('deduplicates by transaction ID, preserving order', () => {
    const links = sourceLinks([
      { type: 'source-url', sourceId: 'TXN-A-0002', url: '/transactions?id=TXN-A-0002' },
      { type: 'source-url', sourceId: 'TXN-A-0001', url: '/transactions?id=TXN-A-0001' },
      { type: 'source-url', sourceId: 'TXN-A-0002', url: '/transactions?id=TXN-A-0002' },
      { type: 'text' },
    ]);
    expect(links.map((l) => l.id)).toEqual(['TXN-A-0002', 'TXN-A-0001']);
  });
});

describe('summarizeToolOutput', () => {
  it('summarises search results including truncation', () => {
    expect(
      summarizeToolOutput({ ok: true, rows: [{}, {}], returned: 2, total_matching: 9, truncated: true }),
    ).toBe('2 of 9 matching transactions returned (truncated)');
    expect(
      summarizeToolOutput({ ok: true, rows: [{}], returned: 1, total_matching: 1, truncated: false }),
    ).toBe('1 of 1 matching transaction returned');
  });

  it('summarises aggregates and rejections', () => {
    expect(summarizeToolOutput({ ok: true, groups: [{}, {}], total_matching: 16 })).toBe(
      '16 matching transactions in 2 groups',
    );
    expect(summarizeToolOutput({ ok: false, error: { message: 'limit too big' } })).toBe(
      'The lookup was rejected: limit too big',
    );
    expect(summarizeToolOutput('x')).toBeNull();
  });
});
