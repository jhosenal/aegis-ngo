import type { Db } from '../db.js';
import type { PsiReading } from '../../sources/psi.js';

interface Row { source_id: string; observed_at: string; updated_at: string | null; fetched_at: string; payload_json: string }
export interface StoredPsi { reading: PsiReading; fetchedAt: string }

/** One row per published reading; a reading already stored is left alone (returns false). */
export function insertPsi(db: Db, sourceId: string, reading: PsiReading, fetchedAt: string): boolean {
  const r = db.prepare('INSERT OR IGNORE INTO air_readings (source_id, observed_at, updated_at, fetched_at, payload_json) VALUES (?, ?, ?, ?, ?)')
    .run(sourceId, reading.observedAt, reading.updatedAt, fetchedAt, JSON.stringify(reading));
  return r.changes === 1;
}

/** The newest reading fetched at or before `fetchedBy`, so a bulletin is rebuilt from what was known at its capture time. */
export function latestPsiFetchedBy(db: Db, sourceId: string, fetchedBy: string): StoredPsi | null {
  const row = db.prepare('SELECT * FROM air_readings WHERE source_id = ? AND fetched_at <= ? ORDER BY observed_at DESC LIMIT 1').get(sourceId, fetchedBy) as Row | undefined;
  return row ? { reading: JSON.parse(row.payload_json) as PsiReading, fetchedAt: row.fetched_at } : null;
}
