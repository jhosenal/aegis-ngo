import { createHash } from 'node:crypto';
import type { Db } from '../db.js';

interface Row { source_id: string; fetched_at: string; payload_hash: string; payload_json: string }
export interface StoredSnapshot<T> { fetchedAt: string; payload: T }

const hashOf = (payload: unknown): string => createHash('sha256').update(JSON.stringify(payload)).digest('hex');

/** Stores a snapshot only when its content differs from the latest one for that source. Returns true when a row was written. */
export function putSnapshotIfChanged(db: Db, sourceId: string, fetchedAt: string, payload: unknown): boolean {
  const latest = db.prepare('SELECT payload_hash FROM official_snapshots WHERE source_id = ? ORDER BY fetched_at DESC LIMIT 1').get(sourceId) as { payload_hash: string } | undefined;
  const hash = hashOf(payload);
  if (latest?.payload_hash === hash) return false;
  db.prepare('INSERT OR IGNORE INTO official_snapshots (source_id, fetched_at, payload_hash, payload_json) VALUES (?, ?, ?, ?)').run(sourceId, fetchedAt, hash, JSON.stringify(payload));
  return true;
}

/** The newest stored snapshot fetched at or before `fetchedBy`. */
export function latestSnapshotFetchedBy<T>(db: Db, sourceId: string, fetchedBy: string): StoredSnapshot<T> | null {
  const row = db.prepare('SELECT * FROM official_snapshots WHERE source_id = ? AND fetched_at <= ? ORDER BY fetched_at DESC LIMIT 1').get(sourceId, fetchedBy) as Row | undefined;
  return row ? { fetchedAt: row.fetched_at, payload: JSON.parse(row.payload_json) as T } : null;
}
