import { type Database, schema } from '@demoledger/db';
import { ASK_HISTORY_ANSWER_MAX_CHARS, ASK_HISTORY_MAX_PAIRS } from '@demoledger/shared';
import { and, desc, eq, sql } from 'drizzle-orm';

/**
 * Server-stored conversation history (D-24). The model never sees client-supplied history: it
 * sees the last few ANSWERED question/answer pairs that this server produced and stored for this
 * user in this tenant, plus the latest question.
 *
 * Runs on the `ledger_app` pool (SELECT + INSERT only on both tables).
 */

/** Thrown for an unknown conversation OR one owned by someone else: the two are indistinguishable. */
export class ConversationNotFoundError extends Error {
  constructor() {
    super('conversation not found');
    this.name = 'ConversationNotFoundError';
  }
}

export interface ConversationScope {
  conversationId: string;
  tenantId: string;
  userId: string;
}

export interface HistoryPair {
  question: string;
  answer: string;
}

export interface ConversationStore {
  /** Create the conversation on first use; reject (as "not found") one owned by another tenant/user. */
  ensure(scope: ConversationScope): Promise<void>;
  /** The last ASK_HISTORY_MAX_PAIRS answered pairs, oldest first; answers clipped. */
  loadHistory(scope: ConversationScope): Promise<HistoryPair[]>;
  /** Store one answered turn (question + final answer text). */
  appendTurn(
    scope: ConversationScope,
    turn: { requestId: string; question: string; answer: string },
  ): Promise<void>;
}

export function clipAnswer(text: string, max = ASK_HISTORY_ANSWER_MAX_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, max)} [...]`;
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Run `fn` in a transaction on the app pool whose first statement sets the row-level-security
 * context for ai_conversations / ai_messages (forced RLS requires BOTH settings):
 * `SELECT set_config('app.tenant_id', $t, true), set_config('app.user_id', $u, true)`.
 * Parameterised and transaction-local (`true`), so it cannot leak to the next user of a pooled
 * connection. The explicit tenant/user filters below stay: RLS is a second, independent layer.
 */
export async function withTenantUser<T>(
  db: Database,
  who: { tenantId: string; userId: string },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.tenant_id', ${who.tenantId}, true), set_config('app.user_id', ${who.userId}, true)`,
    );
    return fn(tx);
  });
}

export function createDbConversations(db: Database): ConversationStore {
  return {
    ensure: ({ conversationId, tenantId, userId }) =>
      withTenantUser(db, { tenantId, userId }, async (tx) => {
        await tx
          .insert(schema.aiConversations)
          .values({ id: conversationId, tenantId, userId })
          .onConflictDoNothing();
        const [row] = await tx
          .select({ id: schema.aiConversations.id })
          .from(schema.aiConversations)
          .where(
            and(
              eq(schema.aiConversations.id, conversationId),
              eq(schema.aiConversations.tenantId, tenantId),
              eq(schema.aiConversations.userId, userId),
            ),
          )
          .limit(1);
        // Under RLS another owner's row is invisible, so "not mine" and "unknown" look the same.
        if (!row) throw new ConversationNotFoundError();
      }),

    loadHistory: ({ conversationId, tenantId, userId }) =>
      withTenantUser(db, { tenantId, userId }, async (tx) => {
        const m = schema.aiMessages;
        // Both rows of a turn are written together; fetch twice the pair cap and re-pair by request.
        const rows = await tx
          .select({ role: m.role, content: m.content, requestId: m.requestId, createdAt: m.createdAt })
          .from(m)
          .where(and(eq(m.conversationId, conversationId), eq(m.tenantId, tenantId), eq(m.userId, userId)))
          .orderBy(desc(m.createdAt))
          .limit(ASK_HISTORY_MAX_PAIRS * 2);
        return pairUp(rows.reverse());
      }),

    appendTurn: ({ conversationId, tenantId, userId }, { requestId, question, answer }) =>
      withTenantUser(db, { tenantId, userId }, async (tx) => {
        const now = Date.now();
        await tx.insert(schema.aiMessages).values([
          {
            conversationId,
            tenantId,
            userId,
            role: 'user',
            content: question,
            requestId,
            createdAt: new Date(now),
          },
          // +1 ms: a deterministic order inside the turn.
          {
            conversationId,
            tenantId,
            userId,
            role: 'assistant',
            content: answer,
            requestId,
            createdAt: new Date(now + 1),
          },
        ]);
      }),
  };
}

function pairUp(rows: { role: string; content: string; requestId: string }[]): HistoryPair[] {
  const byRequest = new Map<string, { question?: string; answer?: string }>();
  for (const r of rows) {
    const e = byRequest.get(r.requestId) ?? {};
    if (r.role === 'user') e.question = r.content;
    else e.answer = r.content;
    byRequest.set(r.requestId, e);
  }
  return [...byRequest.values()]
    .filter((e): e is { question: string; answer: string } => !!e.question && !!e.answer)
    .slice(-ASK_HISTORY_MAX_PAIRS)
    .map((e) => ({ question: e.question, answer: clipAnswer(e.answer) }));
}

/** In-memory store for unit tests and the live scripts. Same ownership rules as the DB store. */
export function createMemoryConversations(): ConversationStore & {
  conversations: Map<string, { tenantId: string; userId: string }>;
  messages: { conversationId: string; role: 'user' | 'assistant'; content: string; requestId: string }[];
} {
  const conversations = new Map<string, { tenantId: string; userId: string }>();
  const messages: {
    conversationId: string;
    role: 'user' | 'assistant';
    content: string;
    requestId: string;
  }[] = [];
  return {
    conversations,
    messages,
    async ensure({ conversationId, tenantId, userId }) {
      const c = conversations.get(conversationId);
      if (!c) conversations.set(conversationId, { tenantId, userId });
      else if (c.tenantId !== tenantId || c.userId !== userId) throw new ConversationNotFoundError();
    },
    async loadHistory({ conversationId, tenantId, userId }) {
      const c = conversations.get(conversationId);
      if (!c || c.tenantId !== tenantId || c.userId !== userId) return [];
      return pairUp(messages.filter((m) => m.conversationId === conversationId));
    },
    async appendTurn({ conversationId }, { requestId, question, answer }) {
      messages.push({ conversationId, role: 'user', content: question, requestId });
      messages.push({ conversationId, role: 'assistant', content: answer, requestId });
    },
  };
}
