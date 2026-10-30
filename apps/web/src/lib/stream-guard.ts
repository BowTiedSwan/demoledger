/** Thrown into the chat stream when /api/ask ends without a `finish` part (server dropped mid-answer). */
export class StreamTruncatedError extends Error {
  constructor() {
    super('The answer stream ended before it finished.');
    this.name = 'StreamTruncatedError';
  }
}

const FINISH = /"type":\s*"finish"\s*[,}]/;
const TAIL = 40;

/**
 * Wrap an SSE response so a clean close WITHOUT a `finish` chunk becomes an error instead of a
 * silent stop. The AI SDK then reports it through `error` / `onError` like any other stream failure.
 * A user abort cancels the reader, which never reaches `flush`, so stop is not reported as an error.
 */
export function ensureFinish(response: Response): Response {
  if (!response.ok || !response.body) return response;
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('text/event-stream')) return response;

  const decoder = new TextDecoder();
  let tail = '';
  let sawFinish = false;
  const guarded = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (!sawFinish) {
          const text = tail + decoder.decode(chunk, { stream: true });
          sawFinish = FINISH.test(text);
          tail = text.slice(-TAIL);
        }
        controller.enqueue(chunk);
      },
      flush(controller) {
        if (!sawFinish) controller.error(new StreamTruncatedError());
      },
    }),
  );
  return new Response(guarded, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/** `fetch` for the chat transport: same as fetch, plus the finish guard. */
export async function guardedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return ensureFinish(await fetch(input, init));
}
