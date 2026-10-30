import { CURRENCIES, DIRECTIONS, TRANSACTION_STATUSES } from '@demoledger/shared';
import { sql } from 'drizzle-orm';
import { bigint, char, check, index, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { organization } from './auth';

export const directionEnum = pgEnum('direction', DIRECTIONS);
export const transactionStatusEnum = pgEnum('transaction_status', TRANSACTION_STATUSES);

export const transactions = pgTable(
  'transactions',
  {
    transactionId: text('transaction_id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => organization.id),
    walletId: text('wallet_id').notNull(),
    /** Integer minor units. bigint mode 'number' (safe: seed amounts are small; repo asserts safe integers). */
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    direction: directionEnum('direction').notNull(),
    status: transactionStatusEnum('status').notNull(),
    failureReason: text('failure_reason'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    description: text('description').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('transactions_amount_positive', sql`${t.amountMinor} > 0`),
    check(
      'transactions_currency_supported',
      sql`${t.currency} in (${sql.join(
        CURRENCIES.map((c) => sql`${sql.raw(`'${c}'`)}`),
        sql`, `,
      )})`,
    ),
    index('transactions_tenant_occurred_idx').on(t.tenantId, t.occurredAt.desc()),
    index('transactions_tenant_wallet_occurred_idx').on(t.tenantId, t.walletId, t.occurredAt.desc()),
    index('transactions_tenant_status_occurred_idx').on(t.tenantId, t.status, t.occurredAt.desc()),
  ],
);

export type TransactionRow = typeof transactions.$inferSelect;
export type NewTransactionRow = typeof transactions.$inferInsert;
