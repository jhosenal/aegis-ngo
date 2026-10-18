import { AegisError } from '../engine/errors.js';
import { getCardRevision } from '../data/repos/cards.js';
import type { Principal, CardRevision } from '../types/domain.js';
import { MAX_ATTACHMENTS_PER_MESSAGE } from '../types/domain.js';

type Db = import('better-sqlite3').Database;

export function resolveAttachments(
  db: Db,
  principal: Principal,
  refs: { cardId: string; revision: number }[],
): CardRevision[] {
  if (refs.length > MAX_ATTACHMENTS_PER_MESSAGE) throw new AegisError('E_VALIDATION', 'Too many card attachments');
  return refs.map((ref) => {
    const card = getCardRevision(db, principal.tenantId, ref.cardId, ref.revision);
    if (!card) throw new AegisError('E_NOT_FOUND');
    return card;
  });
}
