import { type Database, schema } from '@demoledger/db';
import { ASK_HISTORY_ANSWER_MAX_CHARS, ASK_HISTORY_MAX_PAIRS } from '@demoledger/shared';
import { and, desc, eq } from 'drizzle-orm';

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

export function createDbConversations(db: Database): ConversationStore {
  return {
    async ensure({ conversationId, tenantId, userId }) {
      await db
        .insert(schema.aiConversations)
        .values({ id: conversationId, tenantId, userId })
        .onConflictDoNothing();
      const [row] = await db
        .select({ tenantId: schema.aiConversations.tenantId, userId: schema.aiConversations.userId })
        .from(schema.aiConversations)
        .where(eq(schema.aiConversations.id, conversationId))
        .limit(1);
      if (!row || row.tenantId !== tenantId || row.userId !== userId) throw new ConversationNotFoundError();
    },

    async loadHistory({ conversationId, tenantId, userId }) {
      const m = schema.aiMessages;
      // Both rows of a turn are written together; fetch twice the pair cap and re-pair by request.
      const rows = await db
        .select({ role: m.role, content: m.content, requestId: m.requestId, createdAt: m.createdAt })
        .from(m)
        .where(and(eq(m.conversationId, conversationId), eq(m.tenantId, tenantId), eq(m.userId, userId)))
        .orderBy(desc(m.createdAt))
        .limit(ASK_HISTORY_MAX_PAIRS * 2);
      return pairUp(rows.reverse());
    },

    async appendTurn({ conversationId, tenantId, userId }, { requestId, question, answer }) {
      const now = Date.now();
      await db.insert(schema.aiMessages).values([
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
    },
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
