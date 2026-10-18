import { describe, expect, it } from 'vitest';
import { ReapiProvider } from '../../src/providers/reapi.js';
import { RequestPacer } from '../../src/providers/pacer.js';
import { ProviderError, type ModelRequest } from '../../src/types/domain.js';

const KEY = 'test-reapi-key-never-real-987654';
const BASE = 'https://reapi.ai/api/v1';
const request: ModelRequest = {
  attemptId: 'ATT-1', roleId: 'manager', model: 'gpt-6-luna', system: 'sys', user: 'hello',
  responseSchemaId: 'manager-proposal-v1', maxOutputTokens: 64, dataClass: 'public',
};

interface Seen { url: string; init: RequestInit }
function makeProvider(replies: Array<Response | Error>, options: { tokenParam?: 'max_tokens' } = {}): { provider: ReapiProvider; seen: Seen[] } {
  const seen: Seen[] = [];
  let index = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), init: init ?? {} });
    const next = replies[index];
    index += 1;
    if (next === undefined) throw new Error('no scripted reply');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  const pacer = new RequestPacer({ minIntervalMs: 0, dailyCap: 0, maxWaitMs: 1000, sleep: async () => undefined });
  return { provider: new ReapiProvider({ apiKey: KEY, baseUrl: BASE, fetchImpl, pacer, ...options }), seen };
}

const ok = (extra: Record<string, unknown> = {}): Response => new Response(JSON.stringify({
  choices: [{ message: { content: '{"routeId":null}' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 12, completion_tokens: 6 },
  model: 'gpt-6-luna',
  ...extra,
}), { status: 200 });

async function kindOf(promise: Promise<unknown>): Promise<{ kind: string; message: string; charged: boolean } | null> {
  try { await promise; return null; } catch (error: unknown) {
    if (error instanceof ProviderError) return { kind: error.kind, message: error.message, charged: error.possiblyCharged };
    throw error;
  }
}

describe('TSK-021 reAPI adapter (fake fetch only)', () => {
  it('AEG-TST-008 posts an OpenAI-compatible chat request with a bearer header', async () => {
    const { provider, seen } = makeProvider([ok()]);
    const result = await provider.call(request, new AbortController().signal);
    expect(result).toEqual({ text: '{"routeId":null}', reportedModel: 'gpt-6-luna', usage: { inputTokens: 12, outputTokens: 6 } });
    expect(seen[0]?.url).toBe('https://reapi.ai/api/v1/chat/completions');
    expect(seen[0]?.url).not.toContain(KEY);
    expect((seen[0]?.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    const sent = JSON.parse(String(seen[0]?.init.body)) as Record<string, unknown>;
    expect(sent).toMatchObject({
      model: 'gpt-6-luna', max_completion_tokens: 64, reasoning_effort: 'low', response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hello\n\n(Respond with a single json object.)' }],
    });
  });

  it('AEG-TST-008 adds no json hint when the prompt already says json, or when JSON mode is off', async () => {
    const { provider, seen } = makeProvider([ok(), ok()]);
    await provider.call({ ...request, user: 'return json please' }, new AbortController().signal);
    await provider.call({ ...request, responseSchemaId: 'card-summary-v1' }, new AbortController().signal);
    const users = seen.map((item) => (JSON.parse(String(item.init.body)) as { messages: Array<{ content: string }> }).messages[1]?.content);
    expect(users).toEqual(['return json please', 'hello']);
  });

  it('AEG-TST-008 each seat model gets its own request shape from its profile', async () => {
    const { provider, seen } = makeProvider([ok(), ok(), ok()]);
    await provider.call({ ...request, model: 'deepseek-v4.1-flash' }, new AbortController().signal);
    await provider.call({ ...request, model: 'claude-opus-5-5' }, new AbortController().signal);
    await provider.call({ ...request, model: 'gpt-6-sol' }, new AbortController().signal);
    const bodies = seen.map((item) => JSON.parse(String(item.init.body)) as Record<string, unknown>);
    expect(bodies[0]).toMatchObject({ model: 'deepseek-v4.1-flash', max_tokens: 64, reasoning_effort: 'low' });
    expect(bodies[0]?.response_format).toBeUndefined();
    expect(bodies[0]?.max_completion_tokens).toBeUndefined();
    expect(bodies[1]).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 64 });
    expect(bodies[1]?.response_format).toBeUndefined();
    expect(bodies[2]).toMatchObject({ model: 'gpt-6-sol', max_completion_tokens: 64, response_format: { type: 'json_object' } });
  });

  it('AEG-TST-008 an unknown model gets the safe default: option token field, no JSON mode, no reasoning effort', async () => {
    const { provider, seen } = makeProvider([ok(), ok()], { tokenParam: 'max_tokens' });
    await provider.call({ ...request, model: 'brand-new-model' }, new AbortController().signal);
    const plain = makeProvider([ok()]);
    await plain.provider.call({ ...request, model: 'brand-new-model' }, new AbortController().signal);
    const sent = JSON.parse(String(seen[0]?.init.body)) as Record<string, unknown>;
    expect(sent.max_tokens).toBe(64);
    expect(sent.response_format).toBeUndefined();
    expect(sent.reasoning_effort).toBeUndefined();
    expect(JSON.parse(String(plain.seen[0]?.init.body)).max_completion_tokens).toBe(64);
  });

  it('AEG-TST-008 maps statuses and bad bodies to provider error kinds without leaking the key', async () => {
    const cases: Array<[Response, string]> = [
      [new Response('{}', { status: 400 }), 'BAD_REQUEST'],
      [new Response('{}', { status: 401 }), 'AUTH'],
      [new Response('{}', { status: 403 }), 'AUTH'],
      [new Response('{}', { status: 408 }), 'TIMEOUT'],
      [new Response('{}', { status: 429, headers: { 'retry-after': '2' } }), 'TRANSIENT'],
      [new Response('{}', { status: 503 }), 'TRANSIENT'],
      [ok({ choices: [{ message: { content: 'x' }, finish_reason: 'content_filter' }] }), 'REFUSAL'],
      [ok({ choices: [{ message: { content: '{"a' }, finish_reason: 'length' }] }), 'MALFORMED'],
      [ok({ choices: [] }), 'MALFORMED'],
      [new Response('not json', { status: 200 }), 'MALFORMED'],
    ];
    for (const [response, expected] of cases) {
      const { provider } = makeProvider([response]);
      const failure = await kindOf(provider.call(request, new AbortController().signal));
      expect(failure?.kind).toBe(expected);
      expect(failure?.message).not.toContain(KEY);
    }
  });

  it('AEG-TST-008 missing usage is null, and content parts arrays are joined', async () => {
    const { provider } = makeProvider([ok({ usage: undefined, choices: [{ message: { content: [{ text: 'a' }, { text: 'b' }] }, finish_reason: 'stop' }] })]);
    const result = await provider.call(request, new AbortController().signal);
    expect(result.text).toBe('ab');
    expect(result.usage).toBeNull();
  });

  it('AEG-TST-008 a network failure is TRANSIENT and an abort is TIMEOUT that may have been charged', async () => {
    const down = makeProvider([new TypeError('fetch failed')]);
    expect(await kindOf(down.provider.call(request, new AbortController().signal))).toMatchObject({ kind: 'TRANSIENT', charged: false });
    const controller = new AbortController();
    controller.abort();
    const aborted = makeProvider([Object.assign(new Error('aborted'), { name: 'AbortError' })]);
    expect(await kindOf(aborted.provider.call(request, controller.signal))).toMatchObject({ kind: 'TIMEOUT', charged: true });
  });

  it('AEG-TST-008 fails closed on a missing key or any host other than reapi.ai', () => {
    const base = { apiKey: KEY, baseUrl: BASE };
    expect(() => new ReapiProvider({ ...base, apiKey: '' })).toThrow('not configured');
    expect(() => new ReapiProvider({ ...base, baseUrl: 'https://evil.example.org/api/v1' })).toThrow('only calls');
    expect(() => new ReapiProvider({ ...base, baseUrl: 'http://reapi.ai/api/v1' })).toThrow('only calls');
    expect(() => new ReapiProvider({ ...base, baseUrl: 'https://reapi.ai:8443/api/v1' })).toThrow('only calls');
    expect(() => new ReapiProvider({ ...base, baseUrl: 'not a url' })).toThrow('not a URL');
  });
});
