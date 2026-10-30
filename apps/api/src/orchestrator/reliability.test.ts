import { APICallError } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { quotaAwareFetch } from '../llm';
import { handleAsk } from './index';
import { fakeReader, makeArgs, readStream, scriptedModel, txn } from './testing';

const apiError = (statusCode: number, responseBody = '') =>
  new APICallError({
    message: `HTTP ${statusCode}`,
    url: 'https://example.test/v1/chat/completions',
    requestBodyValues: {},
    statusCode,
    responseBody,
    isRetryable: statusCode === 429 || statusCode >= 500,
  });

async function run(
  steps: Parameters<typeof scriptedModel>[0],
  cfg: Parameters<typeof makeArgs>[0]['config'] = {},
) {
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  const { model, calls } = scriptedModel(steps);
  const { args, audit } = makeArgs({
    model,
    reader: fakeReader([txn(1)]),
    config: { requestTimeoutMs: 120_000, stepTimeoutMs: 60_000, ...cfg },
  });
  const pending = handleAsk(args).then(readStream);
  await vi.advanceTimersByTimeAsync(60_000);
  const stream = await pending;
  return { stream, audit, calls };
}

afterEach(() => vi.useRealTimers());

describe('reliability (R23, R24)', () => {
  it('429 then success within the retry budget', async () => {
    const { stream, audit, calls } = await run([{ error: apiError(429) }, { text: 'Recovered.' }]);
    expect(calls).toHaveLength(2);
    expect(stream.text).toBe('Recovered.');
    expect(audit.requests[0]?.status).toBe('ok');
  });

  it('persistent 429 -> rate_limited after bounded retries (1 + maxRetries calls)', async () => {
    const { stream, audit, calls } = await run([
      { error: apiError(429, '{"errors":[{"message":"Too many requests"}]}') },
    ]);
    expect(calls).toHaveLength(3);
    expect(audit.requests[0]).toMatchObject({ status: 'rate_limited', errorCode: 'rate_limited' });
    expect(stream.dataParts.find((p) => p.type === 'data-error')?.data).toMatchObject({
      code: 'rate_limited',
      retryable: true,
    });
  });

  it('daily Neuron allowance exhausted -> quota_exhausted, not retried forever', async () => {
    const body =
      '{"errors":[{"code":4006,"message":"you have used up your daily free allocation of 10,000 neurons"}]}';
    const { stream, audit } = await run([{ error: apiError(429, body) }]);
    expect(audit.requests[0]).toMatchObject({ status: 'quota_exhausted', errorCode: 'quota_exhausted' });
    expect(stream.dataParts.find((p) => p.type === 'data-error')?.data).toMatchObject({
      code: 'quota_exhausted',
      retryable: false,
    });
  });

  it('a non-retryable quota error (403) is not retried: exactly one model call', async () => {
    const body =
      '{"errors":[{"code":4006,"message":"you have used up your daily free allocation of 10,000 neurons"}]}';
    const { audit, calls } = await run([{ error: apiError(403, body) }]);
    expect(calls).toHaveLength(1);
    expect(audit.requests[0]).toMatchObject({ status: 'quota_exhausted', errorCode: 'quota_exhausted' });
  });

  it('quotaAwareFetch turns a quota 429 into a non-retryable 403 and leaves plain 429s alone', async () => {
    const quota = quotaAwareFetch(
      (async () => new Response('daily free allocation of neurons used up', { status: 429 })) as typeof fetch,
    );
    expect((await quota('https://x.test')).status).toBe(403);
    const plain = quotaAwareFetch((async () => new Response('slow down', { status: 429 })) as typeof fetch);
    expect((await plain('https://x.test')).status).toBe(429);
    const ok = quotaAwareFetch((async () => new Response('ok', { status: 200 })) as typeof fetch);
    expect((await ok('https://x.test')).status).toBe(200);
  });

  it('a client abort is audited as llm_error / client_aborted with no data-error part', async () => {
    vi.useRealTimers();
    const { model } = scriptedModel([{ hang: true }]);
    const { args, audit } = makeArgs({ model });
    const ac = new AbortController();
    args.signal = ac.signal;
    setTimeout(() => ac.abort(), 40);
    const stream = await readStream(await handleAsk(args));
    expect(audit.requests[0]).toMatchObject({ status: 'llm_error', errorCode: 'client_aborted' });
    expect(stream.dataParts.find((p) => p.type === 'data-error')).toBeUndefined();
  });

  it('provider 5xx (after retries) -> llm_error, and no provider text reaches the client', async () => {
    const { stream, audit } = await run([{ error: apiError(500, 'internal secret detail') }]);
    expect(audit.requests[0]).toMatchObject({ status: 'llm_error', errorCode: 'llm_error' });
    expect(JSON.stringify(stream.chunks)).not.toContain('secret detail');
  });

  it('a hung model call hits the request timeout -> timeout', async () => {
    vi.useRealTimers();
    const { model } = scriptedModel([{ hang: true }]);
    const { args, audit } = makeArgs({ model, config: { requestTimeoutMs: 80, stepTimeoutMs: 60 } });
    const stream = await readStream(await handleAsk(args));
    expect(audit.requests[0]).toMatchObject({ status: 'timeout', errorCode: 'timeout' });
    expect(stream.dataParts.find((p) => p.type === 'data-error')?.data).toMatchObject({ code: 'timeout' });
  });

  it('a step that keeps streaming is not killed even when it outlasts the step timeout (idle-based)', async () => {
    vi.useRealTimers();
    const { model } = scriptedModel([{ text: 'Slow but steady answer.', chunkDelayMs: 80 }]);
    // 4 chunks x 80 ms = 320 ms > 200 ms, but no gap between chunks reaches 200 ms.
    const { args, audit } = makeArgs({ model, config: { requestTimeoutMs: 5000, stepTimeoutMs: 200 } });
    const stream = await readStream(await handleAsk(args));
    expect(stream.text).toBe('Slow but steady answer.');
    expect(audit.requests[0]?.status).toBe('ok');
  });

  it('an empty model answer -> llm_error', async () => {
    const { audit } = await run([{ text: '' }]);
    expect(audit.requests[0]).toMatchObject({ status: 'llm_error' });
  });

  it('llm not configured -> llm_unconfigured data-error and an audit row; guard still runs', async () => {
    const { args, audit } = makeArgs({ model: null });
    const stream = await readStream(await handleAsk(args));
    expect(stream.dataParts.find((p) => p.type === 'data-error')?.data).toMatchObject({
      code: 'llm_unconfigured',
    });
    expect(audit.requests[0]).toMatchObject({
      status: 'llm_error',
      errorCode: 'llm_unconfigured',
      provider: null,
    });
  });

  it('an audit write failure does not break the response', async () => {
    const { model } = scriptedModel([{ text: 'fine' }]);
    const { args } = makeArgs({ model });
    args.overrides = {
      ...args.overrides,
      audit: {
        async record() {
          throw new Error('db down');
        },
      },
    };
    const stream = await readStream(await handleAsk(args));
    expect(stream.text).toBe('fine');
  });
});
