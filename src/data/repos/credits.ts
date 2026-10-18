import type { Db } from '../db.js';

export type CreditReason = 'STARTER' | 'STUB_PURCHASE' | 'PIN_LOOKUP';

export function creditBalance(db: Db, userId: string): number {
  return (db.prepare('SELECT COALESCE(SUM(delta), 0) AS b FROM credit_ledger WHERE user_id = ?').get(userId) as { b: number }).b;
}

export function addCredit(db: Db, e: { userId: string; delta: number; reason: CreditReason; ref?: string | null; at: string }): void {
  db.prepare('INSERT OR IGNORE INTO credit_ledger (user_id, delta, reason, ref, at) VALUES (?, ?, ?, ?, ?)').run(e.userId, e.delta, e.reason, e.ref ?? null, e.at);
}

/** Credits bought (stub) by this user on this UTC day, to cap the demo purchases. */
export function purchasedOn(db: Db, userId: string, day: string): number {
  return (db.prepare("SELECT COALESCE(SUM(delta), 0) AS b FROM credit_ledger WHERE user_id = ? AND reason = 'STUB_PURCHASE' AND substr(at, 1, 10) = ?").get(userId, day) as { b: number }).b;
}

export interface Bookmark { bookmarkId: string; name: string; lat: number; lng: number; createdAt: string }
export function listBookmarks(db: Db, userId: string): Bookmark[] {
  return (db.prepare('SELECT * FROM user_bookmarks WHERE user_id = ? ORDER BY created_at, bookmark_id').all(userId) as { bookmark_id: string; name: string; lat: number; lng: number; created_at: string }[])
    .map((r) => ({ bookmarkId: r.bookmark_id, name: r.name, lat: r.lat, lng: r.lng, createdAt: r.created_at }));
}
export function addBookmark(db: Db, userId: string, b: Bookmark): void {
  db.prepare('INSERT INTO user_bookmarks (bookmark_id, user_id, name, lat, lng, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(b.bookmarkId, userId, b.name, b.lat, b.lng, b.createdAt);
}
export function deleteBookmark(db: Db, userId: string, bookmarkId: string): boolean {
  return db.prepare('DELETE FROM user_bookmarks WHERE user_id = ? AND bookmark_id = ?').run(userId, bookmarkId).changes === 1;
}
