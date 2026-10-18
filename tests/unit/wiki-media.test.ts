import { describe, expect, it } from 'vitest';
import { freeLicence, PoliteWikiClient, resolvePlaceMedia, significantTokens, titleMatches, WIKI_STANDARD_WIDTHS } from '../../src/sources/wikiMedia.js';

const NOW = '2026-10-16T09:00:00.000Z';
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('place to article matching (AEG-MEDIA-001)', () => {
  it('matches on the place name, not on distance, and accepts either side of "A / B"', () => {
    expect(titleMatches('Bentong', 'Bentong')).toBe(true);
    expect(titleMatches('Chinatown', 'Chinatown, Singapore', { country: 'SG' })).toBe(true);
    expect(titleMatches('Downtown Core / Raffles Place', 'Raffles Place')).toBe(true);
    expect(titleMatches('Johan Setia (Klang)', 'Klang (city)', { country: 'MY' })).toBe(false); // parenthetical context is not an alternate monitored place
    expect(titleMatches('Muar (Haze Monitoring Hub)', 'Muar (town)', { country: 'MY' })).toBe(true); // main place can match; role context cannot match by itself
    expect(titleMatches('Jerudong Slope & Landslide Zone', 'Jerudong')).toBe(true);   // generic words (slope, landslide, zone) do not count
    expect(titleMatches('Newton Circus', 'Newton MRT station')).toBe(false);            // nearest article, wrong place
    expect(titleMatches('Sentosa Island', 'Sentosa')).toBe(true);                       // generic word "island" does not count
    expect(titleMatches('Telok Blangah', 'Telok Blangah MRT station')).toBe(false);   // an article about a station is not about the area
    expect(titleMatches('Sembawang', 'Sembawang Library')).toBe(false);
    expect(titleMatches('Sembawang', 'Sembawang Hot Spring Park')).toBe(false);          // a park inside the area is not the area
    expect(titleMatches('Woodlands Checkpoint', 'Woodlands Train Checkpoint')).toBe(false);
    expect(titleMatches('Chinatown', 'Chinatown, Singapore', { region: 'Central', country: 'SG' })).toBe(true);
    expect(titleMatches('Bentong', 'Bentong, Pahang', { region: 'Pahang', country: 'MY' })).toBe(true);
    expect(titleMatches('Bentong', 'Bentong (federal constituency)', { region: 'Pahang', country: 'MY' })).toBe(false);
    expect(titleMatches('Cameron Highlands', 'Cameron Highlands, Scotland', { region: 'Pahang', country: 'MY' })).toBe(false);
    expect(titleMatches('Marina Bay Sands', 'Marina Bay Sands')).toBe(true);
    expect(titleMatches('Orchard Road', 'Orchard Road')).toBe(true);
    expect(titleMatches('Bukit Timah Road Canal', 'Bukit Timah Road', { country: 'SG' })).toBe(false);   // missing "canal": the article is about the road
    expect(titleMatches('Kota Kinabalu City', 'Kota Kinabalu', { country: 'MY' })).toBe(true);   // "city", "town", "coastal" are qualifiers, not the name
    expect(titleMatches('Lahad Datu Town', 'Lahad Datu', { country: 'MY' })).toBe(true);
    expect(titleMatches('Port Klang Coastal', 'Port Klang', { country: 'MY' })).toBe(true);
    expect(titleMatches('Slope Zone', 'Anything')).toBe(false);                        // nothing significant left to match
    expect(significantTokens('Pekan Bélait')).toEqual(['pekan', 'belait']);
  });
  it('accepts only free licences', () => {
    for (const ok of ['CC0', 'Public domain', 'PD-textlogo', 'CC BY 2.0', 'CC BY-SA 4.0', 'CC-BY-SA-3.0']) expect(freeLicence(ok), ok).toBe(true);
    for (const bad of ['CC BY-NC 4.0', 'CC BY-ND 2.0', 'Fair use', '', 'All rights reserved', 'GFDL']) expect(freeLicence(bad), bad).toBe(false);
  });
  it('asks only for Wikimedia standard thumbnail widths', () => {
    expect(WIKI_STANDARD_WIDTHS).toContain(250);
    expect(WIKI_STANDARD_WIDTHS).toContain(500);
  });
});

describe('polite client: a 429 is a throttle, never "missing"', () => {
  it('retries with backoff and then succeeds', async () => {
    const waits: number[] = []; let n = 0;
    const client = new PoliteWikiClient({ minGapMs: 0, sleep: async (ms) => { waits.push(ms); }, fetchImpl: (async () => (++n <= 2 ? new Response('', { status: 429 }) : json({ ok: true }))) as typeof fetch });
    expect(await client.getJson('https://x')).toMatchObject({ status: 200 });
    expect(waits).toEqual([5000, 10000]);
  });
  it('honours Retry-After and reports a persistent throttle as 429', async () => {
    const waits: number[] = [];
    const client = new PoliteWikiClient({ minGapMs: 0, maxRetries: 1, sleep: async (ms) => { waits.push(ms); }, fetchImpl: (async () => new Response('', { status: 429, headers: { 'retry-after': '7' } })) as typeof fetch });
    expect((await client.getJson('https://x')).status).toBe(429);
    expect(waits).toEqual([7000]);
  });
});

describe('resolvePlaceMedia', () => {
  const pin = { pinId: 'my-34', name: 'Bentong', lat: 3.5222, lng: 101.909 };
  const checkedThumbs: string[] = [];
  const route = (over: Partial<Record<string, () => Response>> = {}) => (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (init?.method === 'HEAD') { checkedThumbs.push(u); return (over['head'] ?? (() => new Response('', { status: 200, headers: { 'content-type': 'image/jpeg' } })))(); }
    if (u.includes('list=geosearch')) return (over['geo'] ?? (() => json({ query: { geosearch: [{ title: 'Bentong', dist: 1050 }, { title: 'Ketari', dist: 2611 }] } })))();
    if (u.includes('list=search')) return json({ query: { search: [] } });
    if (u.includes('titles=')) {
      const requested = new URL(u).searchParams.get('titles');
      if (requested === 'Hulu Yam') return json({ query: { pages: { '-1': { title: 'Hulu Yam', missing: '' } } } });
      if (requested === 'Cameron Highlands') return json({ query: { pages: { '1213900': { title: 'Cameron Highlands', fullurl: 'https://en.wikipedia.org/wiki/Cameron_Highlands', coordinates: [{ lat: 4.5, lon: 101.5 }], pageimage: 'Tea_fields_(Will_Ellis).jpg' } } } });
    }
    if (u.includes('prop=pageimages')) return (over['pi'] ?? (() => json({ query: { pages: { 1: { pageimage: 'Bentong_2.jpg' } } } })))();
    if (u.includes('prop=imageinfo')) return (over['info'] ?? (() => json({ query: { pages: { 2: { imageinfo: [{
      thumburl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e7/Bentong_2.jpg/500px-Bentong_2.jpg', thumbwidth: 500, thumbheight: 281, width: 4013, height: 2257,
      descriptionurl: 'https://commons.wikimedia.org/wiki/File:Bentong_2.jpg', extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: '<a href="x">Slleong</a>' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' } } }] } } } })))();
    return new Response('', { status: 404 });
  }) as typeof fetch;
  const client = (over?: Partial<Record<string, () => Response>>) => new PoliteWikiClient({ minGapMs: 0, sleep: async () => undefined, maxRetries: 0, fetchImpl: route(over) });

  it('returns the article link, a verified 500 px thumbnail, a derived 250 px one, and a credit line', async () => {
    checkedThumbs.length = 0;
    const r = await resolvePlaceMedia(pin, client(), NOW);
    expect(r.status).toBe('matched');
    expect(r.article).toMatchObject({ title: 'Bentong', url: 'https://en.wikipedia.org/wiki/Bentong', distanceM: 1050 });
    expect(r.image).toMatchObject({ width500: 500, height500: 281, creator: 'Slleong', licence: 'CC BY-SA 4.0', credit: 'Photo: Slleong, CC BY-SA 4.0, via Wikimedia Commons', thumbVerifiedAt: NOW });
    expect(r.image!.thumb250).toContain('/250px-Bentong_2.jpg');
    expect(checkedThumbs.some((url) => url.includes('/250px-'))).toBe(true);
    expect(checkedThumbs.some((url) => url.includes('/500px-'))).toBe(true);
  });
  it('keeps the Wikipedia link but shows no photo when the licence is not free', async () => {
    const r = await resolvePlaceMedia(pin, client({ info: () => json({ query: { pages: { 2: { imageinfo: [{ thumburl: 'https://t/500px-a.jpg', extmetadata: { LicenseShortName: { value: 'CC BY-NC 4.0' } } }] } } } }) }), NOW);
    expect(r.status).toBe('no_free_image');
    expect(r.image).toBeNull();
    expect(r.article?.url).toContain('wikipedia.org/wiki/Bentong');
  });
  it('rejects a nearby article whose title does not agree with the place name', async () => {
    const r = await resolvePlaceMedia({ ...pin, name: 'Hulu Yam' }, client(), NOW);
    expect(r.status).toBe('name_mismatch');
    expect(r.article).toBeNull();
  });
  it('finds Cameron Highlands by exact title after unrelated nearby hits and keeps its real distance', async () => {
    const cameron = { pinId: 'my-35', name: 'Cameron Highlands', region: 'Pahang', country: 'MY', lat: 4.4721, lng: 101.3758 };
    const r = await resolvePlaceMedia(cameron, client({ geo: () => json({ query: { geosearch: [{ title: 'Tanah Rata', dist: 2600 }, { title: 'Brinchang', dist: 4100 }, { title: 'Mount Batu Brinchang', dist: 4900 }] } }) }), NOW);
    expect(r.status).toBe('matched');
    expect(r.article).toMatchObject({ title: 'Cameron Highlands', url: 'https://en.wikipedia.org/wiki/Cameron_Highlands' });
    expect(r.article!.distanceM).toBeGreaterThan(0);
    expect(r.image?.thumbVerifiedAt).toBe(NOW);
  });
  it('says no_image when the article has no lead image, and records a throttle as rate_limited, not as missing', async () => {
    expect((await resolvePlaceMedia(pin, client({ pi: () => json({ query: { pages: { 1: {} } } }) }), NOW)).status).toBe('no_image');
    expect((await resolvePlaceMedia(pin, client({ geo: () => new Response('', { status: 429 }) }), NOW)).status).toBe('rate_limited');
    expect((await resolvePlaceMedia(pin, client({ info: () => new Response('', { status: 429 }) }), NOW)).status).toBe('rate_limited');
  });
  it('uses the original when it is no wider than 500 px (there is no 500 px thumbnail)', async () => {
    const small = await resolvePlaceMedia(pin, client({ info: () => json({ query: { pages: { 2: { imageinfo: [{ url: 'https://upload.wikimedia.org/a/ab/Small.jpg', thumburl: 'https://upload.wikimedia.org/a/ab/Small.jpg', width: 420, height: 300, thumbwidth: 420, thumbheight: 300, extmetadata: { LicenseShortName: { value: 'CC0' } } }] } } } }) }), NOW);
    expect(small.status).toBe('matched');
    expect(small.image).toMatchObject({ thumb500: 'https://upload.wikimedia.org/a/ab/Small.jpg', thumb250: 'https://upload.wikimedia.org/a/ab/Small.jpg' });
  });
  it('drops the image when the thumbnail does not load, and notes an unverified one when throttled', async () => {
    const broken = await resolvePlaceMedia(pin, client({ head: () => new Response('', { status: 404 }) }), NOW);
    expect(broken.status).toBe('error');
    expect(broken.image).toBeNull();
    const unknown = await resolvePlaceMedia(pin, client({ head: () => new Response('', { status: 429 }) }), NOW);
    expect(unknown.status).toBe('matched');
    expect(unknown.image?.thumbVerifiedAt).toBeNull();
  });
});
