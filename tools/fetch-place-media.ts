// Builds content/places/place-media.json: for each of the 125 monitored places, the matching Wikipedia article link and, when its lead image is
// freely licensed, the Commons thumbnail URLs (250 and 500 px), creator, licence and credit line. Resumable: a place with a final status is kept;
// rate-limited or errored places are retried on the next run. Polite: calls are spaced and a 429 backs off (see src/sources/wikiMedia.ts).
// Run: node node_modules/tsx/dist/cli.mjs tools/fetch-place-media.ts [--limit N] [--pin my-34] [--gap 1200] [--retry-all]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPinRegistry } from '../src/sources/pinRegistry.js';
import { PoliteWikiClient, resolvePlaceMedia, titleMatches, type PlaceMedia } from '../src/sources/wikiMedia.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'content/places/place-media.json');
const arg = (name: string): string | undefined => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const FINAL = new Set(['matched', 'no_image', 'no_free_image', 'name_mismatch', 'no_article']);

const previous: Record<string, PlaceMedia> = existsSync(out) ? (JSON.parse(readFileSync(out, 'utf8')) as { entries: Record<string, PlaceMedia> }).entries : {};
const registry = loadPinRegistry();
let pins = registry.pins;
if (arg('pin')) pins = pins.filter((p) => p.pinId === arg('pin'));
const limit = Number(arg('limit') ?? 0);
const retry = new Set((arg('retry') ?? '').split(',').filter(Boolean));   // e.g. --retry name_mismatch,no_article
const todo = pins.filter((p) => process.argv.includes('--retry-all') || !previous[p.pinId] || !FINAL.has(previous[p.pinId]!.status) || retry.has(previous[p.pinId]!.status));
const batch = limit > 0 ? todo.slice(0, limit) : todo;
// --recheck: re-judge every stored match with the CURRENT matcher, with no network call (used after the matching rules are tightened).
if (process.argv.includes('--recheck')) {
  let changed = 0;
  for (const pin of registry.pins) {
    const e = previous[pin.pinId];
    if (!e?.article || !(e.status === 'matched' || e.status === 'no_image' || e.status === 'no_free_image')) continue;
    if (!titleMatches(pin.name, e.article.title, { region: pin.region, country: pin.country })) {
      previous[pin.pinId] = { ...e, status: 'name_mismatch', article: null, image: null, note: `rechecked: the article "${e.article.title}" does not agree with the place name` };
      changed += 1;
      console.log(`recheck ${pin.pinId} ${pin.name} -> name_mismatch (was ${e.article.title})`);
    }
  }
  const counts: Record<string, number> = {};
  for (const e of Object.values(previous)) counts[e.status] = (counts[e.status] ?? 0) + 1;
  const file = JSON.parse(readFileSync(out, 'utf8')) as Record<string, unknown>;
  writeFileSync(out, `${JSON.stringify({ ...file, updatedAt: new Date().toISOString(), counts, entries: previous }, null, 1)}\n`, 'utf8');
  console.log(`rechecked, ${changed} changed`);
  process.exit(0);
}
const client = new PoliteWikiClient({ minGapMs: Number(arg('gap') ?? 1200) });
const entries = { ...previous };
const write = (): void => {
  mkdirSync(dirname(out), { recursive: true });
  const counts: Record<string, number> = {};
  for (const e of Object.values(entries)) counts[e.status] = (counts[e.status] ?? 0) + 1;
  writeFileSync(out, `${JSON.stringify({
    schemaVersion: 1, registryId: registry.registryId, tool: 'tools/fetch-place-media.ts', updatedAt: new Date().toISOString(), counts,
    rules: 'Image and link come from the English Wikipedia article whose title agrees with the place name. Only CC0, public domain, CC BY and CC BY-SA images are accepted; a thumbnail is verified to load. Never narrated; shown with its credit line. A place with no match or no free image shows no photo, never a guess.',
    entries,
  }, null, 1)}\n`, 'utf8');
};
console.log(`places ${pins.length}, to do ${todo.length}, this run ${batch.length}`);
let n = 0;
for (const pin of batch) {
  const r = await resolvePlaceMedia(pin, client, new Date().toISOString());
  entries[pin.pinId] = r;
  n += 1;
  console.log(`${String(n).padStart(3)} ${pin.pinId} ${pin.name} -> ${r.status}${r.article ? ` [${r.article.title}]` : ''}${r.image ? ` ${r.image.licence}` : ''}${r.note ? ` (${r.note})` : ''}`);
  write();
}
write();
