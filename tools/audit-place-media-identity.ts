import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PoliteWikiClient, titleMatches } from '../src/sources/wikiMedia.js';

const root = resolve(import.meta.dirname, '..');
const registry = JSON.parse(readFileSync(resolve(root, 'fixtures/environment-pins.json'), 'utf8')) as { pins: Array<{ pinId: string; name: string; country: string; region: string; lat: number; lng: number }> };
const catalogue = JSON.parse(readFileSync(resolve(root, 'content/places/place-media.json'), 'utf8')) as { entries: Record<string, any> };
const client = new PoliteWikiClient({ minGapMs: 1500 });
const records: Array<Record<string, unknown>> = [];
const pageOf = (json: unknown): Record<string, any> => Object.values(((json as { query?: { pages?: Record<string, unknown> } })?.query?.pages ?? {}))[0] as Record<string, any> ?? {};
for (const pin of registry.pins) {
  const entry = catalogue.entries[pin.pinId];
  if (entry?.status !== 'matched' || !entry.article) continue;
  const params = new URLSearchParams({ action: 'query', titles: entry.article.title, redirects: '1', prop: 'info|coordinates|extracts', inprop: 'url', exintro: '1', explaintext: '1', format: 'json', origin: '*' });
  // MediaWiki's extract option is `explaintext`; keep the final URL fully encoded.
  params.set('explaintext', '1');
  const reply = await client.getJson(`https://en.wikipedia.org/w/api.php?${params}`);
  const page = pageOf(reply.json);
  const coords = page.coordinates?.[0];
  records.push({
    pinId: pin.pinId, place: pin.name, status: reply.status, articleTitle: page.title ?? entry.article.title,
    articleUrl: page.fullurl ?? entry.article.url, pageId: page.pageid ?? null,
    coordinates: coords ? { lat: coords.lat, lng: coords.lon } : null,
    articleDistanceM: entry.article.distanceM,
    titleAgrees: titleMatches(pin.name, page.title ?? entry.article.title, { region: pin.region, country: pin.country }),
    intro: typeof page.extract === 'string' ? page.extract.slice(0, 700) : null,
    retrievedAt: new Date().toISOString(),
  });
  console.log(`${pin.pinId} ${page.title ?? entry.article.title} :: ${String(page.extract ?? '').replace(/\s+/g, ' ').slice(0, 120)}`);
}
writeFileSync(resolve(root, 'records/reviews/AEG-MEDIA-LUNA-001_2026-10-17_identity.json'), `${JSON.stringify({ retrievedAt: new Date().toISOString(), method: 'Wikipedia API extracts (exintro, plaintext), one request stream at 1500ms minimum gap', records }, null, 2)}\n`, 'utf8');
console.log(`saved ${records.length} article identity summaries`);
