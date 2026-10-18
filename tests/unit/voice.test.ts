import { describe, expect, it } from 'vitest';
import { createGoogleTts, splitForTts, ttsFromEnv, MAX_REQUEST_BYTES } from '../../src/services/voice.js';

const ok = (text: string): Response => new Response(JSON.stringify({ audioContent: Buffer.from(text).toString('base64') }), { status: 200 });

describe('Google Cloud Text-to-Speech voice (AEG-NEWS-007)', () => {
  it('splits a long script at sentence ends so every request fits, and never loses text', () => {
    const sentence = 'This is a sentence of about forty bytes. ';
    const text = sentence.repeat(300).trim();
    const parts = splitForTts(text);
    expect(parts.length).toBeGreaterThan(2);
    for (const p of parts) expect(Buffer.byteLength(p)).toBeLessThanOrEqual(MAX_REQUEST_BYTES);
    expect(parts.join(' ')).toBe(text);
    expect(splitForTts('Short. Text.')).toEqual(['Short. Text.']);
    const oneHuge = 'word '.repeat(2000).trim();
    for (const p of splitForTts(oneHuge)) expect(Buffer.byteLength(p)).toBeLessThanOrEqual(MAX_REQUEST_BYTES);
  });
  it('calls Google with the key in a header (never in the URL), the chosen voice, MP3, and joins the pieces in order', async () => {
    const calls: { url: string; headers: Record<string, string>; body: { input: { text: string }; voice: { name: string; languageCode: string }; audioConfig: { audioEncoding: string } } }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => { const body = JSON.parse(String(init.body)); calls.push({ url, headers: init.headers as Record<string, string>, body }); return ok(`[${calls.length}]`); }) as unknown as typeof fetch;
    const tts = createGoogleTts({ apiKey: 'KEY-123', voice: 'en-GB-Standard-B', languageCode: 'en-GB', fetchImpl });
    const long = 'Alpha sentence here. '.repeat(400).trim();
    const audio = await tts.synthesize(long);
    expect(calls.length).toBeGreaterThan(1);
    expect(audio.toString()).toBe(calls.map((_c, i) => `[${i + 1}]`).join(''));
    for (const c of calls) {
      expect(c.url).toBe('https://texttospeech.googleapis.com/v1/text:synthesize');
      expect(c.url).not.toContain('KEY-123');
      expect(c.headers['X-Goog-Api-Key']).toBe('KEY-123');
      expect(c.body.voice).toEqual({ languageCode: 'en-GB', name: 'en-GB-Standard-B' });
      expect(c.body.audioConfig.audioEncoding).toBe('MP3');
    }
  });
  it('without a key it uses the service account token (Cloud Run) as a bearer header', async () => {
    let seen: Record<string, string> = {};
    const fetchImpl = (async (_u: string, init: RequestInit) => { seen = init.headers as Record<string, string>; return ok('x'); }) as unknown as typeof fetch;
    await createGoogleTts({ voice: 'v', languageCode: 'en-GB', fetchImpl, token: async () => 'TOKEN-1' }).synthesize('Hello.');
    expect(seen['authorization']).toBe('Bearer TOKEN-1');
    expect(seen['X-Goog-Api-Key']).toBeUndefined();
  });
  it('says plainly when Google refuses or returns nothing, without leaking the key', async () => {
    const refuse = (async () => new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'has not been used (KEY-123)' } }), { status: 403 })) as unknown as typeof fetch;
    const err = await createGoogleTts({ apiKey: 'KEY-123', voice: 'v', languageCode: 'en-GB', fetchImpl: refuse }).synthesize('Hello.').catch((e: Error) => e);
    expect(String((err as Error).message)).toBe('Google Text-to-Speech refused the request (HTTP 403 PERMISSION_DENIED)');
    const empty = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(createGoogleTts({ apiKey: 'k', voice: 'v', languageCode: 'en-GB', fetchImpl: empty }).synthesize('Hello.')).rejects.toThrow('returned no audio');
  });
  it('is off unless AEGIS_TTS_ENABLED=true, and defaults to a standard voice (4 USD per 1M characters after 4M free)', () => {
    expect(ttsFromEnv({})).toBeNull();
    expect(ttsFromEnv({ AEGIS_TTS_ENABLED: 'false' })).toBeNull();
    expect(ttsFromEnv({ AEGIS_TTS_ENABLED: 'true' })!.voice).toBe('en-GB-Standard-B');
    expect(ttsFromEnv({ AEGIS_TTS_ENABLED: 'true', AEGIS_TTS_VOICE: 'en-GB-Neural2-B' })!.voice).toBe('en-GB-Neural2-B');
  });
});
