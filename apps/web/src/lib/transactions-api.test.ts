import { describe, expect, it } from 'vitest';
import { transactionsSearch } from './search-schemas';
import { PAGE_SIZE, toListQuery } from './transactions-api';

describe('toListQuery', () => {
  it('always sends a page size and omits empty filters', () => {
    expect(toListQuery({})).toEqual({ limit: String(PAGE_SIZE) });
  });

  it('maps UI filters to REST params', () => {
    expect(
      toListQuery({
        id: 'TXN-A-0001',
        wallet: 'WALLET-A-001',
        status: 'failed',
        direction: 'outgoing',
        period: 'yesterday',
        offset: 40,
      }),
    ).toEqual({
      limit: String(PAGE_SIZE),
      transaction_id: 'TXN-A-0001',
      wallet_id: 'WALLET-A-001',
      status: 'failed',
      direction: 'outgoing',
      period: 'yesterday',
      offset: '40',
    });
  });

  it('never sends a tenant parameter', () => {
    expect(Object.keys(toListQuery({ wallet: 'WALLET-A-001' }))).not.toContain('tenant_id');
  });
});

describe('transactionsSearch', () => {
  it('drops invalid values instead of failing', () => {
    expect(transactionsSearch.parse({ status: 'bogus', id: 'not-an-id', offset: '-3' })).toEqual({});
  });

  it('keeps valid values', () => {
    expect(transactionsSearch.parse({ id: 'TXN-B-0007', status: 'failed', offset: '20' })).toEqual({
      id: 'TXN-B-0007',
      status: 'failed',
      offset: 20,
    });
  });
});
