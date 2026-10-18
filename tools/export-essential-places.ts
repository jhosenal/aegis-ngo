// Writes the stored copy of essential services (table essential_places, OpenStreetMap, ODbL) to content/places/essential-places.seed.json.gz so the hosted image starts with it.
// Run after tools/fetch-essential-places.ts has finished (run it again to refresh the seed): node --env-file-if-exists=.env node_modules/tsx/dist/cli.mjs tools/export-essential-places.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { openDb } from '../src/data/db.js';
import type { StoredPlace } from '../src/data/repos/essentialPlaces.js';

const db = openDb(resolve('data/aegis.db'));
const rows = db.prepare('SELECT osm_id, category, name, lat, lng, phone, website, address, operator, fetched_at FROM essential_places ORDER BY category, osm_id').all() as
  { osm_id: string; category: StoredPlace['category']; name: string; lat: number; lng: number; phone: string | null; website: string | null; address: string | null; operator: string | null; fetched_at: string }[];
const places: StoredPlace[] = rows.map((r) => ({ osmId: r.osm_id, category: r.category, name: r.name, lat: r.lat, lng: r.lng, phone: r.phone, website: r.website, address: r.address, operator: r.operator }));
const fetchedAt = rows.map((r) => r.fetched_at).sort().at(-1) ?? new Date().toISOString();
const out = resolve('content/places/essential-places.seed.json.gz');
mkdirSync(resolve('content/places'), { recursive: true });
writeFileSync(out, gzipSync(Buffer.from(JSON.stringify({ source: '© OpenStreetMap contributors (ODbL), via Overpass', fetchedAt, places }))));
const counts = places.reduce<Record<string, number>>((m, p) => ({ ...m, [p.category]: (m[p.category] ?? 0) + 1 }), {});
console.log(`wrote ${places.length} places (${JSON.stringify(counts)}) to ${out}`);
