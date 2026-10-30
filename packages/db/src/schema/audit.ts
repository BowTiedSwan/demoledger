import { AUDIT_REQUEST_STATUSES, GUARD_VERDICTS } from '@demoledger/shared';
import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organization, user } from './auth';

export const auditRequestStatusEnum = pgEnum('audit_request_status', AUDIT_REQUEST_STATUSES);
export const guardVerdictEnum = pgEnum('guard_verdict', GUARD_VERDICTS);

/**
 * Append-only: `ledger_app` has INSERT only (no SELECT/UPDATE/DELETE). No foreign keys, so rows
 * can be written in any order (tool-call rows are written per step, the request row at the end).
 */
export const aiRequests = pgTable(
  'ai_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: text('request_id').notNull(),
    userId: text('user_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    question: text('question').notNull(),
    provider: text('provider'),
    model: text('model'),
    status: auditRequestStatusEnum('status').notNull(),
    errorCode: text('error_code'),
    errorDetail: text('error_detail'),
    stepCount: integer('step_count').notNull().default(0),
    latencyMs: integer('latency_ms'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    guardProvider: text('guard_provider'),
    guardModel: text('guard_model'),
    guardVerdict: guardVerdictEnum('guard_verdict'),
    guardAnswers: jsonb('guard_answers'),
    guardLatencyMs: integer('guard_latency_ms'),
    citedIds: text('cited_ids').array().notNull().default(sql`'{}'::text[]`),
    ungroundedIds: text('ungrounded_ids').array().notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ai_requests_request_id_idx').on(t.requestId),
    index('ai_requests_tenant_created_idx').on(t.tenantId, t.createdAt),
  ],
);

export const aiToolCalls = pgTable(
  'ai_tool_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: text('request_id').notNull(),
    step: integer('step').notNull(),
    toolName: text('tool_name').notNull(),
    /** Exactly what the model proposed, before validation. */
    rawArgs: jsonb('raw_args'),
    validated: boolean('validated').notNull(),
    validationError: text('validation_error'),
    rowCount: integer('row_count'),
    returnedIds: text('returned_ids').array().notNull().default(sql`'{}'::text[]`),
    latencyMs: integer('latency_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_tool_calls_request_id_idx').on(t.requestId)],
);

export type NewAiRequest = typeof aiRequests.$inferInsert;
export type NewAiToolCall = typeof aiToolCalls.$inferInsert;

export const conversationRoleEnum = pgEnum('conversation_role', ['user', 'assistant']);

/** Server-stored conversation history. `ledger_app`: SELECT + INSERT only (no UPDATE/DELETE). */
export const aiConversations = pgTable('ai_conversations', {
  /** Client-generated uuid. */
  id: uuid('id').primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => organization.id),
  userId: text('user_id')
    .notNull()
    .references(() => user.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const aiMessages = pgTable(
  'ai_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => aiConversations.id),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    role: conversationRoleEnum('role').notNull(),
    content: text('content').notNull(),
    requestId: text('request_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_messages_conversation_created_idx').on(t.conversationId, t.createdAt)],
);

export type NewAiConversation = typeof aiConversations.$inferInsert;
export type NewAiMessage = typeof aiMessages.$inferInsert;
