import type { TransactionDTO } from '@demoledger/shared';
import { describe, expect, it } from 'vitest';
import {
  failureReasonText,
  formatAmount,
  formatSignedAmount,
  formatTimestamp,
  humanizeReason,
  NOT_RECORDED,
} from './format';

const base: TransactionDTO = {
  transaction_id: 'TXN-A-0001',
  wallet_id: 'WALLET-A-001',
  amount_minor: 123456,
  currency: 'EUR',
  amount_display: '€1,234.56',
  direction: 'outgoing',
  status: 'completed',
  failure_reason: null,
  occurred_at: '2026-10-27T14:03:00.000Z',
  description: 'Supplier payout',
};

describe('formatAmount', () => {
  it('formats integer minor units with the currency exponent', () => {
    expect(formatAmount(123456, 'EUR')).toBe('€1,234.56');
    expect(formatAmount(5, 'USD')).toBe('$0.05');
    expect(formatAmount(100, 'GBP')).toBe('£1.00');
  });

  it('is exact for values beyond float precision (bigint strings)', () => {
    expect(formatAmount('9007199254740993', 'USD')).toBe('$90,071,992,547,409.93');
  });
});

describe('formatSignedAmount', () => {
  it('prefixes incoming with + and outgoing with -', () => {
    expect(formatSignedAmount({ ...base, direction: 'incoming' })).toBe('+€1,234.56');
    expect(formatSignedAmount({ ...base, direction: 'outgoing' })).toBe('-€1,234.56');
  });
});

describe('formatTimestamp', () => {
  it('renders UTC deterministically', () => {
    expect(formatTimestamp('2026-10-27T14:03:00.000Z')).toBe('2026-10-27 14:03 UTC');
    expect(formatTimestamp('2026-01-02T03:04:59Z')).toBe('2026-01-02 03:04 UTC');
  });

  it('returns the input when it is not a date', () => {
    expect(formatTimestamp('nope')).toBe('nope');
  });
});

describe('failureReasonText', () => {
  it('shows "Not recorded" for a failed row without a reason', () => {
    expect(failureReasonText({ status: 'failed', failure_reason: null })).toBe(NOT_RECORDED);
    expect(failureReasonText({ status: 'failed', failure_reason: '  ' })).toBe('Not recorded');
  });

  it('humanizes a recorded reason', () => {
    expect(failureReasonText({ status: 'failed', failure_reason: 'insufficient_funds' })).toBe(
      'Insufficient funds',
    );
  });

  it('shows nothing for rows that did not fail', () => {
    expect(failureReasonText({ status: 'completed', failure_reason: null })).toBeNull();
    expect(failureReasonText({ status: 'pending', failure_reason: null })).toBeNull();
  });

  it('humanizeReason handles empty input', () => {
    expect(humanizeReason('')).toBe('');
  });
});
