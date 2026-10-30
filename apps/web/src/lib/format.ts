import { type Currency, formatMinorUnits, type TransactionDTO } from '@demoledger/shared';

/** Shown for a failed row whose failure reason was not recorded. Never guess a reason. */
export const NOT_RECORDED = 'Not recorded';

/**
 * Format integer minor units as a currency string using Intl.NumberFormat.
 * Delegates to the shared helper, which never goes through floating point.
 */
export function formatAmount(amountMinor: number | bigint | string, currency: Currency): string {
  return formatMinorUnits(amountMinor, currency);
}

/** Signed amount for the ledger table: "+€12.00" for incoming, "-€12.00" for outgoing. */
export function formatSignedAmount(
  tx: Pick<TransactionDTO, 'amount_minor' | 'currency' | 'direction'>,
): string {
  const sign = tx.direction === 'incoming' ? '+' : '-';
  return `${sign}${formatAmount(tx.amount_minor, tx.currency)}`;
}

/** "2026-10-28 14:03 UTC". Deterministic: always UTC, independent of the viewer's locale. */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** "insufficient_funds" -> "Insufficient funds". */
export function humanizeReason(reason: string): string {
  const spaced = reason.replaceAll('_', ' ').trim();
  return spaced.length === 0 ? spaced : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Failure reason cell: only failed rows have one. A failed row with a null/blank reason shows
 * "Not recorded". Non-failed rows show nothing (null).
 */
export function failureReasonText(tx: Pick<TransactionDTO, 'status' | 'failure_reason'>): string | null {
  if (tx.status !== 'failed') return null;
  const reason = tx.failure_reason?.trim();
  return reason ? humanizeReason(reason) : NOT_RECORDED;
}

export function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
