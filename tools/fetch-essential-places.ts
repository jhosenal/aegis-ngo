// Builds the stored copy of essential services (AEG-NEARBY-001): hospitals, clinics, pharmacies, police, fire stations, disaster offices and shelters in Singapore, Malaysia and Brunei,
// from OpenStreetMap through Overpass (ODbL, credit "(c) OpenStreetMap contributors"). The public servers are often at capacity, so this is slow, polite and RESUMABLE:
// tiles are fetched one at a time with retries across the mirrors, and finished tiles are remembered in data/essential-places-progress.json.
// Run: node --env-file-if-exists=.env node_modules/tsx/dist/cli.mjs tools/fetch-essential-places.ts [--category hospital]   (run it again to retry failed tiles)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb } from '../src/data/db.js';
import { migrate } from '../src/data/migrate.js';
import { upsertPlaces, countByCategory, type StoredPlace } from '../src/data/repos/essentialPlaces.js';
import { coverageOf } from '../src/domains/coverage.js';
import { CATEGORIES, OVERPASS_HOSTS, overpassBoxQuery, overpassUrl, parseAll, type NearbyCategory } from '../src/sources/overpass.js';
import { safeFetch } from '../src/sources/safeFetch.js';
import { dnsResolver } from '../src/services/liveIngest.js';

const arg = (n: string): string | undefined => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const only = arg('category') as NearbyCategory | undefined;
const progressFile = resolve('data/essential-places-progress.json');
const progress: Record<string, 'done' | 'failed'> = existsSync(progressFile) ? JSON.parse(readFileSync(progressFile, 'utf8')) as Record<string, 'done' | 'failed'> : {};
const db = openDb(resolve('data/aegis.db'));
migrate(db, resolve('migrations'), new Date().toISOString());

// Tiles of at most 2.5 x 2.5 degrees over the coverage boxes (Singapore, the peninsula, Borneo with Sabah, Sarawak and Brunei).
const BOXES: [number, number, number, number][] = [[1.15, 103.6, 1.48, 104.1], [0.8, 99.6, 7.4, 104.6], [0.8, 109.5, 7.4, 119.4]];
const tiles: [number, number, number, number][] = [];
for (const [s, w, n, e] of BOXES) for (let la = s; la < n - 1e-9; la += 2.5) for (let lo = w; lo < e - 1e-9; lo += 2.5) tiles.push([+la.toFixed(3), +lo.toFixed(3), +Math.min(la + 2.5, n).toFixed(3), +Math.min(lo + 2.5, e).toFixed(3)]);
const policy = { allowlist: [...OVERPASS_HOSTS], maxBytes: 40_000_000, timeoutMs: 150_000, maxRedirects: 1 };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function fetchTile(category: NearbyCategory, t: [number, number, number, number]): Promise<unknown> {
  let last = 'no server answered';
  for (let round = 0; round < 4; round += 1) {
    for (const host of OVERPASS_HOSTS) {
      try {
        const res = await safeFetch(overpassUrl(host), policy, { resolver: dnsResolver, fetchImpl: ((u: URL | string, init?: RequestInit) => fetch(u, { ...init, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'AEGIS-pilot/0.1 (disaster information; one-off build of a stored copy)' }, body: `data=${encodeURIComponent(overpassBoxQuery(category, ...t))}` })) as typeof fetch });
        if (res.status === 200) { const json = JSON.parse(res.text) as unknown; if (Array.isArray((json as { elements?: unknown }).elements)) return json; last = 'unexpected reply'; } else last = `HTTP ${res.status}`;
      } catch (error) { last = error instanceof Error ? error.message : 'error'; }
      await sleep(3000);
    }
    await sleep(15_000 * (round + 1));   // back off, as the server asks
  }
  throw new Error(last);
}

const started = Date.now(); let stored = 0;
for (const category of CATEGORIES) {
  if (only && category !== only) continue;
  for (const t of tiles) {
    const key = `${category}|${t.join(',')}`;
    if (progress[key] === 'done') continue;
    try {
      const raw = parseAll(await fetchTile(category, t));
      const kept: StoredPlace[] = raw.filter((p) => coverageOf(p.lat, p.lng) !== null).map((p) => ({ osmId: p.id, category, name: p.name, lat: p.lat, lng: p.lng, phone: p.phone, website: p.website, address: p.address, operator: p.operator }));
      stored += upsertPlaces(db, kept, new Date().toISOString());
      progress[key] = 'done';
      console.log(`${category} tile ${t.join(',')}: ${raw.length} in tile, ${kept.length} inside SG, MY or BN`);
    } catch (error) { progress[key] = 'failed'; console.log(`${category} tile ${t.join(',')}: FAILED ${(error as Error).message}`); }
    writeFileSync(progressFile, JSON.stringify(progress, null, 1));
    await sleep(2500);
  }
}
const failed = Object.values(progress).filter((v) => v === 'failed').length;
console.log(`done in ${Math.round((Date.now() - started) / 1000)} s; ${stored} rows written; failed tiles ${failed} (run again to retry them); stored per category:`, JSON.stringify(countByCategory(db)));
