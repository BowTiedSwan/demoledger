import { describe, expect, it } from 'vitest';
import { ensureFinish, StreamTruncatedError } from './stream-guard';

const sse = (chunks: string[], init: ResponseInit = {}) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch));
        c.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' }, ...init },
  );

const FINISH = 'data: {"type":"finish","messageMetadata":{"requestId":"r"}}\n\ndata: [DONE]\n\n';

describe('ensureFinish', () => {
  it('passes a complete stream through unchanged', async () => {
    const out = ensureFinish(sse(['data: {"type":"start"}\n\n', 'data: {"type":"text-delta"}\n\n', FINISH]));
    const text = await out.text();
    expect(text).toContain('"type":"finish"');
  });

  it('errors a stream that closes without a finish part', async () => {
    const out = ensureFinish(sse(['data: {"type":"start"}\n\n', 'data: {"type":"finish-step"}\n\n']));
    await expect(out.text()).rejects.toBeInstanceOf(StreamTruncatedError);
  });

  it('finds a finish part split across chunks', async () => {
    const out = ensureFinish(sse(['data: {"type":"fin', 'ish","x":1}\n\n']));
    await expect(out.text()).resolves.toContain('finish');
  });

  it('does not touch error responses or non-stream bodies', async () => {
    const err = new Response('{"error":{}}', {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
    expect(ensureFinish(err)).toBe(err);
    const json = new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    expect(ensureFinish(json)).toBe(json);
  });
});
