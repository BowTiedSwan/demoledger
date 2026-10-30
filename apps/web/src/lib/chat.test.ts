import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getChat, getConversationId, resetChat } from './chat';

const bodies: Record<string, unknown>[] = [];

beforeEach(() => {
  bodies.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({ error: { code: 'internal_error', message: 'x', requestId: 'r' } }),
        {
          status: 500,
        },
      );
    }),
  );
  resetChat();
});
afterEach(() => vi.unstubAllGlobals());

describe('conversation', () => {
  it('sends the conversationId in every /api/ask request body', async () => {
    const id = getConversationId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    await getChat().sendMessage({ text: 'first question' });
    await getChat().sendMessage({ text: 'second question' });
    expect(bodies).toHaveLength(2);
    expect(bodies.map((b) => b.conversationId)).toEqual([id, id]);
  });

  it('New conversation clears the messages and changes the conversationId', async () => {
    const before = getConversationId();
    const oldChat = getChat();
    await oldChat.sendMessage({ text: 'a question' });
    expect(oldChat.messages.length).toBeGreaterThan(0);

    resetChat();

    const after = getConversationId();
    expect(after).not.toBe(before);
    expect(getChat()).not.toBe(oldChat);
    expect(getChat().messages).toEqual([]);

    await getChat().sendMessage({ text: 'next' });
    expect(bodies.at(-1)?.conversationId).toBe(after);
  });
});
