import { ASK_ERROR_MESSAGES } from '@demoledger/shared';
import { describe, expect, it } from 'vitest';
import {
  hasVisibleContent,
  isWaitingForFirstToken,
  messageNotices,
  missingWalletIds,
  PENDING_ANALYSING,
  pendingStepLabel,
  progressIndicator,
  runningToolLabel,
  SUGGESTED_QUESTIONS,
  sourceLinks,
  suggestedQuestions,
  summarizeToolOutput,
  toolNameOfPart,
  toolTitle,
  ungroundedTitle,
  waitingStatusLine,
} from './chat-parts';

describe('suggested questions', () => {
  it('uses only returned wallets for Beta, with no Alpha template IDs', () => {
    const questions = suggestedQuestions(['WALLET-B-002', 'WALLET-B-001']);
    expect(questions[0]).toBe('Why did wallet WALLET-B-001 have failed transactions?');
    expect(questions[3]).toBe('Summarize recent activity for WALLET-B-002.');
    expect(questions.join(' ')).not.toContain('WALLET-A-');
    expect(suggestedQuestions(['WALLET-A-002', 'WALLET-A-001'])).toEqual(SUGGESTED_QUESTIONS);
  });

  it('omits wallet-specific questions without verified wallets and supports a single wallet', () => {
    expect(suggestedQuestions([])).toHaveLength(3);
    expect(suggestedQuestions([]).join(' ')).not.toContain('WALLET-');
    expect(suggestedQuestions(['WALLET-B-003'])[3]).toBe('Summarize recent activity for WALLET-B-003.');
  });

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

describe('wallet-not-found notices', () => {
  it('uses completed server lookups, deduplicates wallets and distinguishes zero matches from absence', () => {
    const result = (found: boolean) => ({
      type: 'tool-aggregate_transactions',
      state: 'output-available',
      output: { ok: true, total_matching: 0, wallet_lookup: { wallet_id: 'WALLET-A-001', found } },
    });
    expect(missingWalletIds([result(false), result(false)])).toEqual(['WALLET-A-001']);
    expect(missingWalletIds([result(true)])).toEqual([]);
    expect(missingWalletIds([result(false), result(true)])).toEqual([]);
    expect(missingWalletIds([{ ...result(false), state: 'input-available' }])).toEqual([]);
    expect(missingWalletIds([{ type: 'text', output: result(false).output }])).toEqual([]);
    expect(missingWalletIds([{ ...result(false), output: { ok: false } }])).toEqual([]);
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

describe('pendingStepLabel (continuous progress, T-295)', () => {
  const msg = (...parts: { type: string; text?: string; state?: string }[]) => ({ role: 'assistant', parts });
  const done = { type: 'tool-search_transactions', state: 'output-available' };

  it('has no pending row before the message has any content (the orb covers that phase)', () => {
    expect(pendingStepLabel('submitted', undefined)).toBeNull();
    expect(pendingStepLabel('streaming', { role: 'user', parts: [] })).toBeNull();
    expect(pendingStepLabel('streaming', msg({ type: 'step-start' }))).toBeNull();
  });

  it('shows after a completed tool part while streaming (the gap that used to look stalled)', () => {
    expect(pendingStepLabel('streaming', msg({ type: 'step-start' }, done))).toBe(PENDING_ANALYSING);
    expect(pendingStepLabel('streaming', msg(done, { type: 'step-start' }))).toBe(PENDING_ANALYSING);
    expect(pendingStepLabel('streaming', msg(done, { type: 'data-visual' }))).toBe(PENDING_ANALYSING);
  });

  it('is gone once text streams, while a tool is running, and when the stream ends or errors', () => {
    expect(pendingStepLabel('streaming', msg(done, { type: 'text', text: 'The' }))).toBeNull();
    expect(
      pendingStepLabel(
        'streaming',
        msg(done, { type: 'tool-aggregate_transactions', state: 'input-available' }),
      ),
    ).toBeNull();
    expect(
      pendingStepLabel('streaming', msg({ type: 'tool-search_transactions', state: 'input-streaming' })),
    ).toBeNull();
    expect(pendingStepLabel('ready', msg(done))).toBeNull();
    expect(pendingStepLabel('error', msg(done))).toBeNull();
  });

  it('ignores empty text parts', () => {
    expect(pendingStepLabel('streaming', msg(done, { type: 'text', text: '' }))).toBe(PENDING_ANALYSING);
  });
});

describe('progressIndicator: orb first, then step rows, never both', () => {
  const done = { type: 'tool-search_transactions', state: 'output-available' };
  const asst = (...parts: { type: string; text?: string; state?: string }[]) => ({
    role: 'assistant',
    parts,
  });

  it('shows the ThinkingOrb with the transient status line when there are no parts yet', () => {
    expect(progressIndicator('submitted', undefined, null)).toEqual({ kind: 'orb', label: 'Thinking' });
    expect(progressIndicator('streaming', asst(), 'Checking request')).toEqual({
      kind: 'orb',
      label: 'Checking request',
    });
    expect(progressIndicator('streaming', asst({ type: 'step-start' }), null)?.kind).toBe('orb');
  });

  it('after a completed tool part it is the pending row, not the orb', () => {
    expect(progressIndicator('streaming', asst({ type: 'step-start' }, done), null)).toEqual({
      kind: 'pending',
      label: PENDING_ANALYSING,
    });
  });

  it('is nothing while a tool runs, while text streams, and when the request is not in flight', () => {
    expect(
      progressIndicator(
        'streaming',
        asst({ type: 'tool-search_transactions', state: 'input-available' }),
        null,
      ),
    ).toBeNull();
    expect(progressIndicator('streaming', asst(done, { type: 'text', text: 'The' }), null)).toBeNull();
    expect(progressIndicator('ready', asst(), null)).toBeNull();
  });
});
