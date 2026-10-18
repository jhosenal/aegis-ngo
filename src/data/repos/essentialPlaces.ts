import type { Db } from '../db.js';
import { distanceMetres, type NearbyCategory, type NearbyPlace } from '../../sources/overpass.js';

export interface StoredPlace { osmId: string; category: NearbyCategory; name: string; lat: number; lng: number; phone: string | null; website: string | null; address: string | null; operator: string | null }

export function upsertPlaces(db: Db, places: StoredPlace[], fetchedAt: string): number {
  const stmt = db.prepare(`INSERT INTO essential_places (osm_id, category, name, lat, lng, phone, website, address, operator, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(osm_id, category) DO UPDATE SET name = excluded.name, lat = excluded.lat, lng = excluded.lng, phone = excluded.phone, website = excluded.website, address = excluded.address, operator = excluded.operator, fetched_at = excluded.fetched_at`);
  return db.transaction(() => places.reduce((n, p) => n + stmt.run(p.osmId, p.category, p.name, p.lat, p.lng, p.phone, p.website, p.address, p.operator, fetchedAt).changes, 0))();
}

export function countByCategory(db: Db): Record<string, number> {
  const rows = db.prepare('SELECT category, COUNT(*) AS n FROM essential_places GROUP BY category').all() as { category: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.category, r.n]));
}

/**
 * There is no gazetteer, so a named area ("Jinjang") is found from the stored places themselves: every place whose name or address contains the words gives a point, and the
 * centre is the middle of the tightest group (matches within 4 km of the median). Null when nothing stored mentions the name.
 */
export function locateByName(db: Db, text: string): { lat: number; lng: number } | null {
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  if (words.length === 0) return null;
  const where = words.map(() => '(lower(name) LIKE ? OR lower(address) LIKE ?)').join(' AND ');
  const params = words.flatMap((w) => [`%${w}%`, `%${w}%`]);
  const rows = db.prepare(`SELECT lat, lng FROM essential_places WHERE ${where} LIMIT 400`).all(...params) as { lat: number; lng: number }[];
  if (rows.length === 0) return null;
  const median = (v: number[]): number => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };
  const mid = { lat: median(rows.map((r) => r.lat)), lng: median(rows.map((r) => r.lng)) };
  const near = rows.filter((r) => distanceMetres(mid.lat, mid.lng, r.lat, r.lng) <= 4000);
  const use = near.length > 0 ? near : rows;
  return { lat: use.reduce((a, r) => a + r.lat, 0) / use.length, lng: use.reduce((a, r) => a + r.lng, 0) / use.length };
}

/** The nearest stored places within `radiusM` of a point (bounding box first, then exact distance). */
export function searchNear(db: Db, category: NearbyCategory, lat: number, lng: number, radiusM: number, max: number): NearbyPlace[] {
  const dLat = radiusM / 111_320; const dLng = radiusM / (111_320 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  const rows = db.prepare('SELECT * FROM essential_places WHERE category = ? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?').all(category, lat - dLat, lat + dLat, lng - dLng, lng + dLng) as
    { osm_id: string; name: string; lat: number; lng: number; phone: string | null; website: string | null; address: string | null; operator: string | null }[];
  return rows.map((r) => ({ id: r.osm_id, name: r.name, lat: r.lat, lng: r.lng, distanceM: Math.round(distanceMetres(lat, lng, r.lat, r.lng)), phone: r.phone, website: r.website, address: r.address, operator: r.operator, osmUrl: `https://www.openstreetmap.org/${r.osm_id}` }))
    .filter((p) => p.distanceM <= radiusM).sort((a, b) => a.distanceM - b.distanceM).slice(0, max);
}
