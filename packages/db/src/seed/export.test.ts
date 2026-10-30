import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSeedCsv, SEED_CSV_PATH } from './export';

describe('seed-data/transactions.csv', () => {
  it('matches the generator at the fixed anchor (run `pnpm db:export-seed` if this fails)', () => {
    expect(readFileSync(SEED_CSV_PATH, 'utf8')).toBe(buildSeedCsv());
  });

  it('has 100 rows and quotes fields containing commas or quotes', () => {
    const csv = buildSeedCsv();
    expect(csv.trimEnd().split('\n')).toHaveLength(101);
    expect(csv).toMatch(/"€[\d,]+\.\d{2}"|"\$[\d,]+\.\d{2}"|"£[\d,]+\.\d{2}"/);
  });
});
