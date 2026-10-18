import { describe, expect, it } from 'vitest';
import { fingerprint, readValue, swapPair, testGoogle, testReapi } from '../../tools/keys.js';

const env = [
  '# Local secrets', 'AEGIS_REAPI_API_KEY=rrr-one', 'AEGIS_REAPI_API_KEY_2=rrr-two', '# Google', 'AEGIS_GOOGLE_API_KEY=ggg-one', 'AEGIS_GOOGLE_API_KEY_2=ggg-two',
  'AEGIS_GOOGLE_MODEL=gemini-3.8-flash', 'AEGIS_PROVIDER_MODE=stub', '',
].join('\n');

describe('key pair swap', () => {
  it('swaps only the two named values and keeps every other byte, including comments and order', () => {
    const swapped = swapPair(env, 'AEGIS_GOOGLE_API_KEY', 'AEGIS_GOOGLE_API_KEY_2');
    expect(readValue(swapped, 'AEGIS_GOOGLE_API_KEY')).toBe('ggg-two');
    expect(readValue(swapped, 'AEGIS_GOOGLE_API_KEY_2')).toBe('ggg-one');
    expect(readValue(swapped, 'AEGIS_REAPI_API_KEY')).toBe('rrr-one');
    expect(swapped.split('\n').filter((line) => !line.startsWith('AEGIS_GOOGLE_API_KEY'))).toEqual(env.split('\n').filter((line) => !line.startsWith('AEGIS_GOOGLE_API_KEY')));
    expect(swapPair(swapped, 'AEGIS_GOOGLE_API_KEY', 'AEGIS_GOOGLE_API_KEY_2')).toBe(env);   // swapping twice restores the file
  });

  it('keeps CRLF line endings', () => {
    const crlf = env.replace(/\n/g, '\r\n');
    const swapped = swapPair(crlf, 'AEGIS_REAPI_API_KEY', 'AEGIS_REAPI_API_KEY_2');
    expect(swapped.includes('\r\n')).toBe(true);
    expect(swapped.replace(/\r\n/g, '\n').includes('\r')).toBe(false);
    expect(readValue(swapped, 'AEGIS_REAPI_API_KEY')).toBe('rrr-two');
  });

  it('refuses to swap when a key is missing or both keys are the same', () => {
    expect(() => swapPair('AEGIS_GOOGLE_API_KEY=a\n', 'AEGIS_GOOGLE_API_KEY', 'AEGIS_GOOGLE_API_KEY_2')).toThrow('must be set');
    expect(() => swapPair('AEGIS_GOOGLE_API_KEY=a\nAEGIS_GOOGLE_API_KEY_2=a\n', 'AEGIS_GOOGLE_API_KEY', 'AEGIS_GOOGLE_API_KEY_2')).toThrow('same key');
  });

  it('a commented-out line is never read or swapped', () => {
    const text = '# AEGIS_GOOGLE_API_KEY=old\nAEGIS_GOOGLE_API_KEY=a\nAEGIS_GOOGLE_API_KEY_2=b\n';
    const swapped = swapPair(text, 'AEGIS_GOOGLE_API_KEY', 'AEGIS_GOOGLE_API_KEY_2');
    expect(swapped.split('\n')[0]).toBe('# AEGIS_GOOGLE_API_KEY=old');
    expect(readValue(swapped, 'AEGIS_GOOGLE_API_KEY')).toBe('b');
  });

  it('a fingerprint identifies a key without revealing it', () => {
    expect(fingerprint('ggg-one')).toMatch(/^[0-9a-f]{8}$/);
    expect(fingerprint(' ggg-one ')).toBe(fingerprint('ggg-one'));
    expect(fingerprint('ggg-one')).not.toBe(fingerprint('ggg-two'));
    expect(fingerprint('ggg-one')).not.toContain('ggg');
  });
});

describe('key tests (fake fetch only)', () => {
  it('Google test sends the key in a header and reports only the status', async () => {
    let seen: { url: string; header: string } | null = null;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(url), header: (init?.headers as Record<string, string>)['x-goog-api-key'] as string };
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const result = await testGoogle('secret-key', fetchImpl);
    expect(result).toEqual({ ok: true, detail: 'HTTP 200 (model list, no cost)' });
    expect((seen as unknown as { url: string }).url).not.toContain('secret-key');
    expect((seen as unknown as { header: string }).header).toBe('secret-key');
    expect((await testGoogle('k', (async () => new Response('{}', { status: 400 })) as typeof fetch)).ok).toBe(false);
    expect((await testGoogle('k', (async () => { throw new Error('boom secret-key'); }) as typeof fetch)).detail).toBe('network error');
  });

  it('reAPI test refuses any host other than reapi.ai and never puts the key in a URL', async () => {
    let called = 0;
    const fetchImpl = (async (url: string | URL | Request) => { called += 1; expect(String(url)).not.toContain('secret-key'); return new Response('{}', { status: 200 }); }) as typeof fetch;
    expect((await testReapi('secret-key', 'https://evil.example.org/api/v1', 'gpt-6-luna', fetchImpl)).ok).toBe(false);
    expect((await testReapi('secret-key', 'http://reapi.ai/api/v1', 'gpt-6-luna', fetchImpl)).ok).toBe(false);
    expect(called).toBe(0);
    expect(await testReapi('secret-key', 'https://reapi.ai/api/v1', 'gpt-6-luna', fetchImpl)).toEqual({ ok: true, detail: 'HTTP 200 (one tiny call)' });
    expect((await testReapi('k', 'https://reapi.ai/api/v1', 'gpt-6-luna', (async () => new Response('{}', { status: 401 })) as typeof fetch)).ok).toBe(false);
  });
});
