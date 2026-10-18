import { describe, expect, it } from 'vitest';
import { safeFetch, type FetchPolicy, type Resolver } from '../../src/sources/safeFetch.js';

const policy: FetchPolicy = { allowlist: ['feed.example.org'], maxBytes: 32, timeoutMs: 100, maxRedirects: 2 };
const publicResolver: Resolver = { resolve: async () => ['93.184.216.34'] };

function fetchReturning(response: Response): typeof fetch {
  return (async () => response) as typeof fetch;
}

describe('safeFetch', () => {
  it('AEG-TST-015 accepts an allowlisted HTTPS host with public addresses', async () => {
    const result = await safeFetch('https://feed.example.org/data', policy, {
      resolver: publicResolver,
      fetchImpl: fetchReturning(new Response('fixture feed', { status: 200 })),
    });
    expect(result).toEqual({ status: 200, text: 'fixture feed' });
  });

  it('AEG-TST-015 rejects HTTP and non-allowlisted hosts before fetching', async () => {
    const fetchImpl = fetchReturning(new Response('unused'));
    await expect(safeFetch('http://feed.example.org/data', policy, { resolver: publicResolver, fetchImpl }))
      .rejects.toThrow('Only HTTPS');
    await expect(safeFetch('https://other.example.org/data', policy, { resolver: publicResolver, fetchImpl }))
      .rejects.toThrow('not allowlisted');
  });

  it.each(['127.0.0.1', '10.0.0.5', '169.254.169.254', '::1', 'fc00::1', 'fe80::1', '0.0.0.0'])(
    'AEG-TST-015 rejects private or local resolver address %s', async (address) => {
      await expect(safeFetch('https://feed.example.org/data', policy, {
        resolver: { resolve: async () => [address] }, fetchImpl: fetchReturning(new Response('unused')),
      })).rejects.toThrow('non-public');
    },
  );

  it('AEG-TST-015 rejects a DNS answer set containing one private address', async () => {
    await expect(safeFetch('https://feed.example.org/data', policy, {
      resolver: { resolve: async () => ['93.184.216.34', '192.168.1.5'] },
      fetchImpl: fetchReturning(new Response('unused')),
    })).rejects.toThrow('non-public');
  });

  it('AEG-TST-015 revalidates redirected hosts and enforces the redirect limit', async () => {
    let calls = 0;
    const redirectFetch = (async () => {
      calls += 1;
      return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } });
    }) as typeof fetch;
    await expect(safeFetch('https://feed.example.org/start', policy, { resolver: publicResolver, fetchImpl: redirectFetch }))
      .rejects.toThrow('not allowlisted');
    expect(calls).toBe(1);

    const loopFetch = (async () => new Response(null, { status: 302, headers: { location: '/again' } })) as typeof fetch;
    await expect(safeFetch('https://feed.example.org/start', { ...policy, maxRedirects: 0 }, {
      resolver: publicResolver, fetchImpl: loopFetch,
    })).rejects.toThrow('Too many redirects');
  });

  it('AEG-TST-015 rejects response bodies larger than the byte limit', async () => {
    await expect(safeFetch('https://feed.example.org/data', { ...policy, maxBytes: 3 }, {
      resolver: publicResolver, fetchImpl: fetchReturning(new Response('four')),
    })).rejects.toThrow('maximum size');
  });

  it('AEG-TST-015 aborts a response that exceeds the timeout', async () => {
    const neverResponds = (async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })) as typeof fetch;
    await expect(safeFetch('https://feed.example.org/data', { ...policy, timeoutMs: 5 }, {
      resolver: publicResolver, fetchImpl: neverResponds,
    })).rejects.toThrow('timed out');
  });

  it('AEG-TST-015 rejects XML external entity declarations', async () => {
    const xml = '<!DOCTYPE feed [<!ENTITY x SYSTEM "file:///secret">]><feed>&x;</feed>';
    await expect(safeFetch('https://feed.example.org/data', { ...policy, maxBytes: 1024 }, {
      resolver: publicResolver, fetchImpl: fetchReturning(new Response(xml)),
    })).rejects.toThrow('external entities');
  });
});
