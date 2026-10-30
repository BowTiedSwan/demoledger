import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeTransportError, INTERRUPTED_MESSAGE, UNREACHABLE_MESSAGE } from './ask-errors';
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

describe('server drops mid-answer (T-294)', () => {
  const stream = (body: string) =>
    new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });

  it('a stream that ends without a finish part puts the chat in error with the interrupted copy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => stream('data: {"type":"start","messageId":"m1"}\n\ndata: {"type":"start-step"}\n\n')),
    );
    resetChat();
    const chat = getChat();
    await chat.sendMessage({ text: 'a question' });
    expect(chat.status).toBe('error');
    expect(describeTransportError(chat.error)?.message).toBe(INTERRUPTED_MESSAGE);
  });

  it('a complete stream is not an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        stream('data: {"type":"start","messageId":"m1"}\n\ndata: {"type":"finish"}\n\ndata: [DONE]\n\n'),
      ),
    );
    resetChat();
    const chat = getChat();
    await chat.sendMessage({ text: 'a question' });
    expect(chat.status).toBe('ready');
    expect(chat.error).toBeUndefined();
  });

  it('a fetch rejection gives the unreachable copy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    resetChat();
    const chat = getChat();
    await chat.sendMessage({ text: 'a question' });
    expect(chat.status).toBe('error');
    expect(describeTransportError(chat.error)?.message).toBe(UNREACHABLE_MESSAGE);
  });
});
