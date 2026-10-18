import type { Db } from '../db.js';
import type { Bulletin } from '../../services/broadcast/script.js';

interface Row { bulletin_id: string; slot_id: string; language: string; capture_at: string; air_at: string; generated_at: string; fact_sheet_hash: string; schedule_version: string; body_json: string }

export function findBulletin(db: Db, slotId: string, captureAt: string, language: string): Bulletin | null {
  const row = db.prepare('SELECT * FROM broadcast_bulletins WHERE slot_id = ? AND capture_at = ? AND language = ?').get(slotId, captureAt, language) as Row | undefined;
  return row ? (JSON.parse(row.body_json) as Bulletin) : null;
}

/** Stores a bulletin once per slot capture and language; a second insert of the same capture is ignored (idempotent regeneration). */
export function insertBulletin(db: Db, b: Bulletin): boolean {
  const r = db.prepare(`INSERT OR IGNORE INTO broadcast_bulletins (bulletin_id, slot_id, language, capture_at, air_at, generated_at, fact_sheet_hash, schedule_version, body_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(b.bulletinId, b.slotId, b.language, b.captureAt, b.airAt, b.generatedAt, b.factSheetHash, b.scheduleVersion, JSON.stringify(b));
  return r.changes === 1;
}

export function latestBulletin(db: Db, language: string): Bulletin | null {
  const row = db.prepare("SELECT * FROM broadcast_bulletins WHERE language = ? AND slot_id <> 'drill' ORDER BY capture_at DESC LIMIT 1").get(language) as Row | undefined;
  return row ? (JSON.parse(row.body_json) as Bulletin) : null;
}

export function listBulletins(db: Db, language: string, limit = 8, includeDrills = false): { bulletinId: string; slotId: string; captureAt: string; airAt: string; generatedAt: string; factSheetHash: string }[] {
  return (db.prepare(`SELECT * FROM broadcast_bulletins WHERE language = ? ${includeDrills ? '' : "AND slot_id <> 'drill'"} ORDER BY capture_at DESC LIMIT ?`).all(language, limit) as Row[])
    .map((r) => ({ bulletinId: r.bulletin_id, slotId: r.slot_id, captureAt: r.capture_at, airAt: r.air_at, generatedAt: r.generated_at, factSheetHash: r.fact_sheet_hash }));
}

export interface Review { bulletinId: string; decision: 'APPROVED' | 'HELD'; decidedBy: string; decidedAt: string; note: string | null }

export function getBulletin(db: Db, bulletinId: string): Bulletin | null {
  const row = db.prepare('SELECT * FROM broadcast_bulletins WHERE bulletin_id = ?').get(bulletinId) as Row | undefined;
  return row ? (JSON.parse(row.body_json) as Bulletin) : null;
}

/** Records (or replaces) the screening decision for a stored bulletin. */
export function setReview(db: Db, r: Review): void {
  db.prepare(`INSERT INTO broadcast_reviews (bulletin_id, decision, decided_by, decided_at, note) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(bulletin_id) DO UPDATE SET decision = excluded.decision, decided_by = excluded.decided_by, decided_at = excluded.decided_at, note = excluded.note`)
    .run(r.bulletinId, r.decision, r.decidedBy, r.decidedAt, r.note);
}

export function getReview(db: Db, bulletinId: string): Review | null {
  const r = db.prepare('SELECT * FROM broadcast_reviews WHERE bulletin_id = ?').get(bulletinId) as { bulletin_id: string; decision: 'APPROVED' | 'HELD'; decided_by: string; decided_at: string; note: string | null } | undefined;
  return r ? { bulletinId: r.bulletin_id, decision: r.decision, decidedBy: r.decided_by, decidedAt: r.decided_at, note: r.note } : null;
}

/** The newest bulletin an administrator approved (what the public page shows when approval is required). */
export function latestApprovedBulletin(db: Db, language: string): Bulletin | null {
  const row = db.prepare(`SELECT b.* FROM broadcast_bulletins b JOIN broadcast_reviews r ON r.bulletin_id = b.bulletin_id
    WHERE b.language = ? AND b.slot_id <> 'drill' AND r.decision = 'APPROVED' ORDER BY b.capture_at DESC LIMIT 1`).get(language) as Row | undefined;
  return row ? (JSON.parse(row.body_json) as Bulletin) : null;
}

export interface ReviewLogEntry { seq: number; bulletinId: string; action: 'APPROVE' | 'HOLD' | 'WITHDRAW'; by: string; at: string; note: string | null }

export function logReview(db: Db, e: Omit<ReviewLogEntry, 'seq'>): void {
  db.prepare('INSERT INTO broadcast_review_log (bulletin_id, action, by_user, at, note) VALUES (?, ?, ?, ?, ?)').run(e.bulletinId, e.action, e.by, e.at, e.note);
}

export function reviewLog(db: Db, bulletinId: string): ReviewLogEntry[] {
  return (db.prepare('SELECT * FROM broadcast_review_log WHERE bulletin_id = ? ORDER BY seq').all(bulletinId) as { seq: number; bulletin_id: string; action: ReviewLogEntry['action']; by_user: string; at: string; note: string | null }[])
    .map((r) => ({ seq: r.seq, bulletinId: r.bulletin_id, action: r.action, by: r.by_user, at: r.at, note: r.note }));
}

export interface EditLogEntry { seq: number; segmentId: string; before: string; after: string; by: string; at: string; note: string | null }
/** Stores a reworded bulletin (same id). Translations and voice made from the old words are cleared; the edit log keeps the history. */
export function replaceBulletinBody(db: Db, b: Bulletin): void {
  db.prepare('UPDATE broadcast_bulletins SET body_json = ? WHERE bulletin_id = ?').run(JSON.stringify(b), b.bulletinId);
  db.prepare('DELETE FROM bulletin_translation WHERE bulletin_id = ?').run(b.bulletinId);
  db.prepare('DELETE FROM bulletin_voice_ml WHERE bulletin_id = ?').run(b.bulletinId);
  db.prepare('DELETE FROM bulletin_voice WHERE bulletin_id = ?').run(b.bulletinId);
}
export function logEdit(db: Db, e: { bulletinId: string; segmentId: string; before: string; after: string; by: string; at: string; note: string | null }): void {
  db.prepare('INSERT INTO bulletin_edit_log (bulletin_id, segment_id, before_text, after_text, by_user, at, note) VALUES (?, ?, ?, ?, ?, ?, ?)').run(e.bulletinId, e.segmentId, e.before, e.after, e.by, e.at, e.note);
}
export function editLog(db: Db, bulletinId: string): EditLogEntry[] {
  return (db.prepare('SELECT * FROM bulletin_edit_log WHERE bulletin_id = ? ORDER BY seq').all(bulletinId) as { seq: number; segment_id: string; before_text: string; after_text: string; by_user: string; at: string; note: string | null }[])
    .map((r) => ({ seq: r.seq, segmentId: r.segment_id, before: r.before_text, after: r.after_text, by: r.by_user, at: r.at, note: r.note }));
}
