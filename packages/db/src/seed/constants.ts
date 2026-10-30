import type { Currency, TenantId } from '@demoledger/shared';

/** Fixed anchor used by every test run (matches vitest.shared.ts). */
export const SEED_TEST_ANCHOR = '2026-10-28T00:00:00Z';

export interface SeedTenant {
  id: TenantId;
  name: string;
  slug: string;
}

/** Fictional organizations. `id` is the tenant id used in `transactions.tenant_id`. */
export const SEED_TENANTS: readonly SeedTenant[] = [
  { id: 'tenant_alpha', name: 'Alpha Payments (fictional)', slug: 'alpha-payments' },
  { id: 'tenant_beta', name: 'Beta Wallets (fictional)', slug: 'beta-wallets' },
];

export interface SeedWallet {
  walletId: string;
  tenantId: TenantId;
  currency: Currency;
}

export const SEED_WALLETS: readonly SeedWallet[] = [
  { walletId: 'WALLET-A-001', tenantId: 'tenant_alpha', currency: 'EUR' },
  { walletId: 'WALLET-A-002', tenantId: 'tenant_alpha', currency: 'EUR' },
  { walletId: 'WALLET-A-003', tenantId: 'tenant_alpha', currency: 'USD' },
  { walletId: 'WALLET-A-004', tenantId: 'tenant_alpha', currency: 'GBP' },
  { walletId: 'WALLET-B-001', tenantId: 'tenant_beta', currency: 'EUR' },
  { walletId: 'WALLET-B-002', tenantId: 'tenant_beta', currency: 'EUR' },
  { walletId: 'WALLET-B-003', tenantId: 'tenant_beta', currency: 'USD' },
];

export interface SeedUser {
  name: string;
  email: string;
  /** Test-only credential, documented in the README. */
  password: string;
  tenantId: TenantId;
  role: 'member';
}

export const SEED_USERS: readonly SeedUser[] = [
  {
    name: 'Alpha Ops',
    email: 'ops.alpha@demoledger.test',
    password: 'AlphaLedger#2026',
    tenantId: 'tenant_alpha',
    role: 'member',
  },
  {
    name: 'Beta Ops',
    email: 'ops.beta@demoledger.test',
    password: 'BetaLedger#2026',
    tenantId: 'tenant_beta',
    role: 'member',
  },
];

/** Expected totals, asserted by the generator tests. */
export const SEED_COUNTS = { alpha: 56, beta: 44, total: 100, failed: 16 } as const;
