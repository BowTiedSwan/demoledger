import { generateText } from 'ai';
import { describe, expect, it } from 'vitest';
import { buildLlm, reasoningBodyFields, sanitizeMessages } from './index';

describe('reasoningBodyFields (per model family)', () => {
  it('gpt-oss gets reasoning_effort', () => {
    expect(reasoningBodyFields('@cf/openai/gpt-oss-120b', 'low')).toEqual({ reasoning_effort: 'low' });
    expect(reasoningBodyFields('@cf/openai/gpt-oss-20b', 'high')).toEqual({ reasoning_effort: 'high' });
  });
  it('GLM: low = thinking off, medium/high = on', () => {
    expect(reasoningBodyFields('@cf/zai-org/glm-4.7-flash', 'low')).toEqual({
      chat_template_kwargs: { enable_thinking: false },
    });
    expect(reasoningBodyFields('@cf/zai-org/glm-4.7-flash', 'medium')).toEqual({
      chat_template_kwargs: { enable_thinking: true },
    });
  });
  it('other models get nothing', () => {
    expect(reasoningBodyFields('@cf/google/gemma-4-26b-a4b-it', 'low')).toEqual({});
  });
});

/** Offline wire check: what the installed @ai-sdk/openai-compatible really sends. */
describe('request body that reaches Workers AI', () => {
  async function bodyFor(model: string, reasoningEffort: 'low' | 'medium' | 'high') {
    let sent: Record<string, unknown> = {};
    const fake = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          id: 'x',
          created: 1,
          model,
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'hi' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    const llm = buildLlm({ accountId: 'acct', apiToken: 't', model, reasoningEffort }, fake);
    await generateText({ model: (llm as NonNullable<typeof llm>).model, prompt: 'hello' });
    return sent;
  }

  it('gpt-oss-120b sends reasoning_effort=low by default and no GLM switch', async () => {
    const b = await bodyFor('@cf/openai/gpt-oss-120b', 'low');
    expect(b.reasoning_effort).toBe('low');
    expect(b.chat_template_kwargs).toBeUndefined();
    expect(b.model).toBe('@cf/openai/gpt-oss-120b');
  });
  it('glm sends chat_template_kwargs and no reasoning_effort', async () => {
    const b = await bodyFor('@cf/zai-org/glm-4.7-flash', 'low');
    expect(b.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(b.reasoning_effort).toBeUndefined();
  });
});

describe('sanitizeMessages (Workers AI rejects null content and replayed reasoning)', () => {
  it('turns null assistant content into an empty string and drops reasoning_content', () => {
    const out = sanitizeMessages([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: null, reasoning_content: 'thinking...', tool_calls: [{ id: '1' }] },
      { role: 'tool', tool_call_id: '1', content: 'r' },
    ]) as Record<string, unknown>[];
    expect(out[1]).toEqual({ role: 'assistant', content: '', tool_calls: [{ id: '1' }] });
    expect(out[0]).toEqual({ role: 'user', content: 'q' });
    expect(out[2]).toEqual({ role: 'tool', tool_call_id: '1', content: 'r' });
  });
});
