import { describe, expect, it } from 'vitest';
import { GoogleProvider } from '../../src/providers/google.js';
import { RequestPacer } from '../../src/providers/pacer.js';
import { ProviderError, type ModelRequest } from '../../src/types/domain.js';

const KEY = 'test-key-never-real-1234567890';
const request: ModelRequest = {
  attemptId: 'ATT-1', roleId: 'manager', model: 'gemini-3.5-flash-lite', system: 'sys', user: 'hello',
  responseSchemaId: 'manager-proposal-v1', maxOutputTokens: 64, dataClass: 'public',
};

interface Seen { url: string; init: RequestInit }
function fakeFetch(replies: Array<Response | Error>): { fetchImpl: typeof fetch; seen: Seen[] } {
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
  return { fetchImpl, seen };
}

const ok = (extra: Record<string, unknown> = {}): Response => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ text: '{"routeId":null}' }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 5 },
  modelVersion: 'gemini-3.5-flash-lite',
  ...extra,
}), { status: 200 });
const status = (code: number, body: unknown = {}, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status: code, headers });

function makeProvider(replies: Array<Response | Error>, pacer?: RequestPacer): { provider: GoogleProvider; seen: Seen[] } {
  const { fetchImpl, seen } = fakeFetch(replies);
  const quick = pacer ?? new RequestPacer({ minIntervalMs: 0, dailyCap: 0, maxWaitMs: 1000, sleep: async () => undefined });
  return { provider: new GoogleProvider({ apiKey: KEY, fetchImpl, pacer: quick }), seen };
}

async function kindOf(promise: Promise<unknown>): Promise<{ kind: string; message: string; charged: boolean } | null> {
  try { await promise; return null; } catch (error: unknown) {
    if (error instanceof ProviderError) return { kind: error.kind, message: error.message, charged: error.possiblyCharged };
    throw error;
  }
}

describe('TSK-019 Google adapter (fake fetch only)', () => {
  it('AEG-TST-008 sends the key in a header, never in the URL, and asks for JSON for the manager schema', async () => {
    const { provider, seen } = makeProvider([ok()]);
    const result = await provider.call(request, new AbortController().signal);
    expect(result).toEqual({ text: '{"routeId":null}', reportedModel: 'gemini-3.5-flash-lite', usage: { inputTokens: 11, outputTokens: 5 } });
    expect(seen[0]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    expect(seen[0]?.url).not.toContain(KEY);
    expect((seen[0]?.init.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY);
    const sent = JSON.parse(String(seen[0]?.init.body)) as { generationConfig: Record<string, unknown>; systemInstruction: unknown };
    expect(sent.generationConfig).toEqual({ maxOutputTokens: 64, temperature: 0, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } });
    expect(sent.systemInstruction).toEqual({ parts: [{ text: 'sys' }] });
  });

  it('AEG-TST-008 plain-text schemas do not force a JSON mime type, and thought parts and thought tokens are handled', async () => {
    const { provider, seen } = makeProvider([ok({
      candidates: [{ content: { parts: [{ text: 'hidden', thought: true }, { text: 'Summary.' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 6 },
    })]);
    const result = await provider.call({ ...request, responseSchemaId: 'card-summary-v1' }, new AbortController().signal);
    expect(result.text).toBe('Summary.');
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 10 });
    expect(JSON.parse(String(seen[0]?.init.body)).generationConfig.responseMimeType).toBeUndefined();
  });

  it('AEG-TST-008 thinking effort is sent only for Gemini 3 models', async () => {
    const { provider, seen } = makeProvider([ok(), ok()]);
    await provider.call({ ...request, model: 'gemini-3.8-flash' }, new AbortController().signal);
    await provider.call({ ...request, model: 'gemini-2.0-legacy' }, new AbortController().signal);
    const configs = seen.map((item) => (JSON.parse(String(item.init.body)) as { generationConfig: Record<string, unknown> }).generationConfig);
    expect(configs[0]?.thinkingConfig).toEqual({ thinkingLevel: 'low' });
    expect(configs[1]?.thinkingConfig).toBeUndefined();
  });

  it('AEG-TST-008 missing usage metadata is reported as null usage, not invented', async () => {
    const { provider } = makeProvider([ok({ usageMetadata: undefined })]);
    expect((await provider.call(request, new AbortController().signal)).usage).toBeNull();
  });

  it('AEG-TST-008 maps HTTP statuses to provider error kinds', async () => {
    const cases: Array<[Response, string]> = [
      [status(400, { error: { status: 'INVALID_ARGUMENT' } }), 'BAD_REQUEST'],
      [status(400, { error: { message: 'API key not valid. Please pass a valid API key.', details: [{ reason: 'API_KEY_INVALID' }] } }), 'AUTH'],
      [status(401), 'AUTH'],
      [status(403), 'AUTH'],
      [status(404), 'BAD_REQUEST'],
      [status(408), 'TIMEOUT'],
      [status(429), 'TRANSIENT'],
      [status(500), 'TRANSIENT'],
      [status(503), 'TRANSIENT'],
      [status(504), 'TIMEOUT'],
    ];
    for (const [response, expected] of cases) {
      const { provider } = makeProvider([response]);
      const failure = await kindOf(provider.call(request, new AbortController().signal));
      expect(failure?.kind).toBe(expected);
      expect(failure?.message).not.toContain(KEY);
    }
  });

  it('AEG-TST-008 maps blocks, truncation, empty and non-JSON answers', async () => {
    const blocked = makeProvider([ok({ candidates: undefined, promptFeedback: { blockReason: 'SAFETY' } })]);
    expect((await kindOf(blocked.provider.call(request, new AbortController().signal)))?.kind).toBe('REFUSAL');
    const safety = makeProvider([ok({ candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] })]);
    expect((await kindOf(safety.provider.call(request, new AbortController().signal)))?.kind).toBe('REFUSAL');
    const cut = makeProvider([ok({ candidates: [{ content: { parts: [{ text: '{"rou' }] }, finishReason: 'MAX_TOKENS' }] })]);
    expect((await kindOf(cut.provider.call(request, new AbortController().signal)))?.kind).toBe('MALFORMED');
    const empty = makeProvider([ok({ candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] })]);
    expect((await kindOf(empty.provider.call(request, new AbortController().signal)))?.kind).toBe('MALFORMED');
    const junk = makeProvider([new Response('<html>oops</html>', { status: 200 })]);
    expect((await kindOf(junk.provider.call(request, new AbortController().signal)))?.kind).toBe('MALFORMED');
  });

  it('AEG-TST-008 a network failure is TRANSIENT and an abort is TIMEOUT that may have been charged', async () => {
    const down = makeProvider([new TypeError('fetch failed')]);
    const failure = await kindOf(down.provider.call(request, new AbortController().signal));
    expect(failure).toMatchObject({ kind: 'TRANSIENT', charged: false });
    const controller = new AbortController();
    const aborted = makeProvider([Object.assign(new Error('aborted'), { name: 'AbortError' })]);
    controller.abort();
    expect(await kindOf(aborted.provider.call(request, controller.signal))).toMatchObject({ kind: 'TIMEOUT', charged: true });
  });

  it('AEG-TST-008 after a 429 the next call makes no network request until the cool-down ends', async () => {
    let clock = 1_000_000;
    const pacer = new RequestPacer({ minIntervalMs: 0, dailyCap: 0, maxWaitMs: 1000, now: () => clock, sleep: async () => undefined });
    const { provider, seen } = makeProvider([status(429, { error: { details: [{ retryDelay: '34s' }] } }), ok()], pacer);
    expect((await kindOf(provider.call(request, new AbortController().signal)))?.kind).toBe('TRANSIENT');
    expect(seen).toHaveLength(1);
    expect((await kindOf(provider.call(request, new AbortController().signal)))?.message).toContain('cooling down');
    expect(seen).toHaveLength(1);
    clock += 35_000;
    await provider.call(request, new AbortController().signal);
    expect(seen).toHaveLength(2);
  });

  it('a 429 for one model cools down only that model: another model still goes through', async () => {
    let clock = 1_000_000;
    const pacer = new RequestPacer({ minIntervalMs: 0, dailyCap: 0, maxWaitMs: 1000, now: () => clock, sleep: async () => undefined });
    const { provider, seen } = makeProvider([status(429, { error: { details: [{ retryDelay: '34s' }] } }), ok()], pacer);
    expect((await kindOf(provider.call({ ...request, model: 'gemini-4-argon' }, new AbortController().signal)))?.kind).toBe('TRANSIENT');
    expect((await kindOf(provider.call({ ...request, model: 'gemini-4-argon' }, new AbortController().signal)))?.message).toContain('cooling down for gemini-4-argon');
    await provider.call({ ...request, model: 'gemini-3.8-flash' }, new AbortController().signal);
    expect(seen).toHaveLength(2);
  });

  it('AEG-TST-008 spaces request starts and stops at the local daily cap without a network call', async () => {
    const waits: number[] = [];
    let clock = 5_000_000;
    const pacer = new RequestPacer({
      minIntervalMs: 12_000, dailyCap: 2, maxWaitMs: 30_000, now: () => clock,
      sleep: async (ms) => { waits.push(ms); clock += ms; },
    });
    const { provider, seen } = makeProvider([ok(), ok(), ok()], pacer);
    await provider.call(request, new AbortController().signal);
    await provider.call(request, new AbortController().signal);
    expect(waits).toEqual([12_000]);
    expect((await kindOf(provider.call(request, new AbortController().signal)))?.message).toContain('daily request cap');
    expect(seen).toHaveLength(2);
  });

  it('AEG-TST-008 fails closed on a missing key or a host other than Google', () => {
    expect(() => new GoogleProvider({ apiKey: '' })).toThrow('not configured');
    expect(() => new GoogleProvider({ apiKey: KEY, baseUrl: 'https://evil.example.org' })).toThrow('only calls');
    expect(() => new GoogleProvider({ apiKey: KEY, baseUrl: 'http://generativelanguage.googleapis.com' })).toThrow('only calls');
  });
});
