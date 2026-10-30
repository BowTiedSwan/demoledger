import { createPool } from '@demoledger/db';
import { afterAll, describe, expect, it } from 'vitest';
import { assertDbRoles, type Queryable } from './role-check';

const fake = (row: Record<string, unknown>): Queryable => ({ query: async () => ({ rows: [row] }) });
const good = (name: string) => fake({ name, rolsuper: false, rolbypassrls: false });

describe('assertDbRoles (fakes)', () => {
  it('accepts the least-privilege pair', async () => {
    await expect(
      assertDbRoles({ reader: good('ledger_reader'), app: good('ledger_app') }),
    ).resolves.toBeUndefined();
  });
  it('rejects wrong role names, superuser and BYPASSRLS', async () => {
    await expect(assertDbRoles({ reader: good('ledger_app'), app: good('ledger_app') })).rejects.toThrow(
      /ledger_reader pool/,
    );
    await expect(
      assertDbRoles({
        reader: good('ledger_reader'),
        app: fake({ name: 'ledger_app', rolsuper: true, rolbypassrls: false }),
      }),
    ).rejects.toThrow(/superuser/);
    await expect(
      assertDbRoles({
        reader: fake({ name: 'ledger_reader', rolsuper: false, rolbypassrls: true }),
        app: good('ledger_app'),
      }),
    ).rejects.toThrow(/BYPASSRLS/);
  });
});

describe('assertDbRoles (real test database)', () => {
  const pools = [
    createPool(process.env.DATABASE_URL_READER as string),
    createPool(process.env.DATABASE_URL_APP as string),
    createPool(process.env.DATABASE_URL as string), // owner
  ] as const;
  const [reader, app, owner] = pools;
  afterAll(() => Promise.all(pools.map((p) => p.end())));

  it('passes for ledger_reader + ledger_app', async () => {
    await expect(assertDbRoles({ reader, app })).resolves.toBeUndefined();
  });
  it('rejects the owner connection on either side', async () => {
    await expect(assertDbRoles({ reader: owner, app })).rejects.toThrow(/Refusing to start/);
    await expect(assertDbRoles({ reader, app: owner })).rejects.toThrow(/Refusing to start/);
  });
});
