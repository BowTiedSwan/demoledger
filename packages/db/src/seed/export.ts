/**
 * Writes the readable snapshot `packages/db/seed-data/transactions.csv` from the generator at the
 * fixed reference anchor. The seed itself stays generated (dates move with the run date).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatMinorUnits } from '@demoledger/shared';
import { SEED_TEST_ANCHOR } from './constants';
import { generateTransactions } from './generate';

export const SEED_CSV_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../seed-data/transactions.csv',
);

const HEADER = [
  'transaction_id',
  'tenant_id',
  'wallet_id',
  'amount_minor',
  'currency',
  'amount_display',
  'direction',
  'status',
  'failure_reason',
  'occurred_at',
  'description',
] as const;

function field(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** CSV text (LF line endings, trailing newline) for the snapshot at the fixed anchor. */
export function buildSeedCsv(anchor: Date = new Date(SEED_TEST_ANCHOR)): string {
  const rows = generateTransactions(anchor).sort(
    (a, b) => a.tenantId.localeCompare(b.tenantId) || a.transactionId.localeCompare(b.transactionId),
  );
  const lines = [HEADER.join(',')];
  for (const t of rows) {
    lines.push(
      [
        t.transactionId,
        t.tenantId,
        t.walletId,
        t.amountMinor,
        t.currency,
        formatMinorUnits(t.amountMinor, t.currency),
        t.direction,
        t.status,
        t.failureReason ?? '',
        t.occurredAt.toISOString(),
        t.description,
      ]
        .map(field)
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(dirname(SEED_CSV_PATH), { recursive: true });
  const csv = buildSeedCsv();
  writeFileSync(SEED_CSV_PATH, csv);
  console.log(`wrote ${SEED_CSV_PATH} (${csv.trimEnd().split('\n').length - 1} rows)`);
}
