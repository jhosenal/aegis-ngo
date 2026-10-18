import { AegisError } from '../../engine/errors.js';
import type { Db } from '../db.js';
import type { Principal } from '../../types/domain.js';

export function cardExists(db: Db, principal: Principal, cardId: string): boolean {
  return db.prepare('SELECT 1 AS present FROM cards WHERE card_id = ? AND tenant_id = ?')
    .get(cardId, principal.tenantId) !== undefined;
}

export function pinCard(db: Db, principal: Principal, cardId: string, nowIso: string): void {
  const card = db.prepare('SELECT 1 AS present FROM cards WHERE card_id = ? AND tenant_id = ?')
    .get(cardId, principal.tenantId);
  if (!card) throw new AegisError('E_NOT_FOUND');
  db.prepare('INSERT OR IGNORE INTO pins (tenant_id, user_id, card_id, pinned_at) VALUES (?, ?, ?, ?)')
    .run(principal.tenantId, principal.userId, cardId, nowIso);
}

export function unpinCard(db: Db, principal: Principal, cardId: string): void {
  db.prepare(
    'DELETE FROM pins WHERE tenant_id = ? AND user_id = ? AND card_id = ? AND EXISTS (SELECT 1 FROM cards WHERE cards.card_id = pins.card_id AND cards.tenant_id = ?)',
  ).run(principal.tenantId, principal.userId, cardId, principal.tenantId);
}

export function listPins(db: Db, principal: Principal): { cardId: string; pinnedAt: string }[] {
  const rows = db.prepare(
    'SELECT p.card_id, p.pinned_at FROM pins p JOIN cards c ON c.card_id = p.card_id WHERE p.tenant_id = ? AND p.user_id = ? AND c.tenant_id = ? ORDER BY p.pinned_at, p.card_id',
  ).all(principal.tenantId, principal.userId, principal.tenantId) as Array<{ card_id: string; pinned_at: string }>;
  return rows.map((row) => ({ cardId: row.card_id, pinnedAt: row.pinned_at }));
}
