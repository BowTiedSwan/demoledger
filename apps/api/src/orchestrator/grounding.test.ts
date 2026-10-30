import { describe, expect, it } from 'vitest';
import {
  checkCountClaims,
  checkCounts,
  checkFacts,
  checkGrounding,
  checkSpeculation,
  type RowFact,
} from './grounding';

describe('checkCounts', () => {
  const facts = new Set([5, 12]);
  it('accepts numbers that are server counts', () => {
    expect(checkCounts('There are 5 failed transactions and 12 matching records.', facts)).toEqual([]);
  });
  it('flags other numbers used as transaction counts', () => {
    expect(checkCounts('Wallet has 3 failed transactions.', facts)).toEqual([3]);
    expect(checkCounts('3 transactions failed, 7 pending payments', facts)).toEqual([3, 7]);
  });
  it('ignores dates, amounts and IDs', () => {
    expect(checkCounts('On 2026-10-28 TXN-A-0001 moved 125 EUR', facts)).toEqual([]);
  });
});

describe('checkGrounding', () => {
  it('splits cited and ungrounded IDs', () => {
    expect(checkGrounding('TXN-A-0001 TXN-B-0002', new Set(['TXN-A-0001']))).toEqual({
      cited: ['TXN-A-0001', 'TXN-B-0002'],
      ungrounded: ['TXN-B-0002'],
    });
  });
});

describe('checkFacts (failure-reason claims vs returned rows)', () => {
  const rows = new Map<string, RowFact>([
    ['TXN-A-0052', { status: 'failed', failure_reason: 'insufficient_funds' }],
    ['TXN-A-0030', { status: 'failed', failure_reason: 'insufficient_funds' }],
    ['TXN-A-0053', { status: 'failed', failure_reason: 'beneficiary_account_closed' }],
    ['TXN-A-0047', { status: 'failed', failure_reason: 'compliance_hold' }],
    ['TXN-A-0054', { status: 'failed', failure_reason: null }],
  ]);

  // The answer observed in the live UI run (F-19): reasons present in the data were reported as missing.
  const LIVE_BAD_ANSWER = `WALLET-A-001 has 5 failed transactions. Only one of them has a recorded failure reason.
1. TXN-A-0052 (EUR 1,840.00): not recorded (null)
2. TXN-A-0030 (EUR 310.00): not recorded (null)
3. TXN-A-0053 (EUR 562.50): beneficiary_account_closed
4. TXN-A-0047 (EUR 720.00): compliance_hold
5. TXN-A-0054 (EUR 999.00): no reason on file
In summary, the two insufficient_funds failures do not appear in the transaction records.`;

  it('flags the live bad answer: reasons reported as missing, and a reason claimed absent', () => {
    expect(checkFacts(LIVE_BAD_ANSWER, rows).sort()).toEqual([
      'TXN-A-0030',
      'TXN-A-0052',
      'reason:insufficient_funds',
    ]);
  });

  it('accepts a correct answer, including a genuinely null reason', () => {
    const ok = `5 failed transactions.
- TXN-A-0052: insufficient_funds
- TXN-A-0030: insufficient_funds
- TXN-A-0053: beneficiary_account_closed
- TXN-A-0047: compliance_hold
- TXN-A-0054: the failure reason is not recorded.`;
    expect(checkFacts(ok, rows)).toEqual([]);
  });

  it('flags a different reason stated for a cited row', () => {
    expect(checkFacts('TXN-A-0047 failed because of insufficient_funds.', rows)).toEqual(['TXN-A-0047']);
  });

  it('does not flag a mixed segment where one cited row really has no reason', () => {
    expect(
      checkFacts('TXN-A-0054 has no reason recorded, unlike TXN-A-0047 (compliance_hold).', rows),
    ).toEqual([]);
  });
});

describe('checkSpeculation', () => {
  const rows = new Map<string, RowFact>([
    ['TXN-A-0052', { status: 'failed', failure_reason: 'insufficient_funds' }],
    ['TXN-A-0054', { status: 'failed', failure_reason: null }],
  ]);
  it('flags a hedge next to a failed ID or the word failed', () => {
    expect(checkSpeculation('TXN-A-0052 might have failed for several causes.', rows)).toEqual([
      'TXN-A-0052',
    ]);
    expect(checkSpeculation('The payouts probably failed because of a bank outage.', rows)).toEqual([
      'general',
    ]);
  });
  it('does not fire on plain statements or hedges unrelated to failures', () => {
    expect(checkSpeculation('TXN-A-0054 failed; the reason is not recorded.', rows)).toEqual([]);
    expect(checkSpeculation('This appears to be the largest transfer this week.', rows)).toEqual([]);
  });
});

describe('checkCountClaims', () => {
  it('keeps the status/direction word attached to the number', () => {
    expect(
      checkCountClaims('3 completed transactions and 9 outgoing payments, 4 transactions', new Set([5])),
    ).toEqual([{ n: 3, qualifier: 'completed' }, { n: 9, qualifier: 'outgoing' }, { n: 4 }]);
  });
});
