import type { GuardVerdict } from '@demoledger/shared';

/** All guard thresholds in one place (brief 7.4). */
export const GUARD_THRESHOLDS = {
  /** Injection probability above this blocks. */
  injectionBlock: 0.85,
  /** Injection probability from this value up to `injectionBlock` flags (allow, but audited). */
  injectionFlag: 0.5,
  /** `write_action` intent with confidence above this blocks. */
  writeIntentBlock: 0.6,
} as const;

export type GuardThresholds = typeof GUARD_THRESHOLDS;

/** Fixed refusal copy; blocked requests never reach the LLM. */
export const GUARD_MESSAGES: Readonly<Record<GuardVerdict, string>> = {
  allow: '',
  flag: '',
  block:
    'This request was blocked by the safety check. The assistant can only look up and summarise transactions for your organization; it cannot change data, move money or follow instructions embedded in a request.',
  unavailable: 'The safety check is unavailable, so this request was not processed. Try again shortly.',
};
