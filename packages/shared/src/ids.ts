import { z } from 'zod';

/** Tenants are Better Auth organizations with fixed seed IDs. */
export const TENANT_IDS = ['tenant_alpha', 'tenant_beta'] as const;
export type TenantId = (typeof TENANT_IDS)[number];

/** `WALLET-A-001` (alpha) / `WALLET-B-001` (beta). */
export const WALLET_ID_REGEX = /^WALLET-[AB]-\d{3}$/;
/** `TXN-A-0001` (alpha) / `TXN-B-0001` (beta). */
export const TRANSACTION_ID_REGEX = /^TXN-[AB]-\d{4}$/;
/** Global variant used by the grounding check to extract cited IDs from answer text. */
export const TRANSACTION_ID_GLOBAL_REGEX = /TXN-[AB]-\d{4}/g;

export const walletId = z
  .string()
  .regex(WALLET_ID_REGEX, { error: 'wallet_id must look like WALLET-A-001 (WALLET-<A|B>-<3 digits>)' });

export const transactionId = z
  .string()
  .regex(TRANSACTION_ID_REGEX, { error: 'transaction_id must look like TXN-A-0001 (TXN-<A|B>-<4 digits>)' });

/** Extract the distinct transaction IDs mentioned in free text, in first-seen order. */
export function extractTransactionIds(text: string): string[] {
  return [...new Set(text.match(TRANSACTION_ID_GLOBAL_REGEX) ?? [])];
}
