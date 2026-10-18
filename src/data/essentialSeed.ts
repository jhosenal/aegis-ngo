import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { Db } from './db.js';
import { upsertPlaces, type StoredPlace } from './repos/essentialPlaces.js';

/**
 * The hosted database is temporary, so the stored copy of essential services (OpenStreetMap, ODbL) ships inside the image as a gzip JSON seed
 * (content/places/essential-places.seed.json.gz, written by tools/export-essential-places.ts) and fills an EMPTY table on start. A table that already has rows is left alone.
 * Returns the number of rows loaded (0 when there is no seed or the table is not empty).
 */
export function loadEssentialSeedIfEmpty(db: Db, seedPath: string, nowIso: string): number {
  if (!existsSync(seedPath)) return 0;
  const have = (db.prepare('SELECT COUNT(*) AS n FROM essential_places').get() as { n: number }).n;
  if (have > 0) return 0;
  const rows = JSON.parse(gunzipSync(readFileSync(seedPath)).toString('utf8')) as { fetchedAt: string; places: StoredPlace[] };
  if (!Array.isArray(rows.places)) return 0;
  return upsertPlaces(db, rows.places, rows.fetchedAt || nowIso);
}
