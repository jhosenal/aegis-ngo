import type { FastifyInstance } from 'fastify';
import { AegisError } from '../../engine/errors.js';
import type { Clock } from '../../engine/clock.js';
import { getCardRevision, getChildren, listCardRevisions, listCards } from '../../data/repos/cards.js';
import { listVisibleEvidence } from '../../data/repos/evidence.js';
import { toEvidenceViews } from '../../sources/evidenceView.js';
import { withCountry } from '../../services/incidentCountry.js';
import { withIncidentPeriod } from '../../services/incidentPeriod.js';
import type { CardKind } from '../../types/domain.js';
import { isValidApiId } from '../errors.js';
import { principalFrom } from '../auth.js';

type Db = import('better-sqlite3').Database;

const cardKinds = new Set<CardKind>(['incident', 'resource', 'assessment', 'evidence', 'note']);

function cardKind(value: unknown): CardKind | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && cardKinds.has(value as CardKind)) return value as CardKind;
  throw new AegisError('E_VALIDATION', 'Invalid card kind');
}

export function registerCardRoutes(app: FastifyInstance, db: Db, clock: Clock): void {
  app.get('/api/cards', async (request) => {
    const query = request.query as { kind?: unknown };
    const user = principalFrom(request);
    const summaries = listCards(db, user.tenantId, cardKind(query.kind));
    return {
      cards: summaries.map((summary) => {
        const card = getCardRevision(db, user.tenantId, summary.cardId, summary.revision);
        if (!card) throw new AegisError('E_INTERNAL', 'Listed card revision could not be read');
        return {
          cardId: summary.cardId,
          kind: summary.kind,
          latestRevision: summary.revision,
          title: summary.title,
          state: summary.state,
          updatedAt: summary.createdAt,
          synthetic: card.body.synthetic,
        };
      }),
    };
  });

  app.get('/api/cards/:cardId', async (request) => {
    const params = request.params as { cardId?: unknown };
    if (!isValidApiId(params.cardId)) throw new AegisError('E_VALIDATION', 'Invalid card id');
    const query = request.query as { revision?: unknown };
    let revision: number | undefined;
    if (query.revision !== undefined) {
      const rawRevision = typeof query.revision === 'string' ? Number(query.revision) : query.revision;
      if (typeof rawRevision !== 'number' || !Number.isInteger(rawRevision) || rawRevision < 1) {
        throw new AegisError('E_VALIDATION', 'Invalid card revision');
      }
      revision = rawRevision;
    }

    const user = principalFrom(request);
    const card = getCardRevision(db, user.tenantId, params.cardId, revision);
    if (!card) throw new AegisError('E_NOT_FOUND');
    const allVisibleEvidence = listVisibleEvidence(db, user.tenantId);
    // incidentPeriod is derived here from the cited evidence's freshness; nothing is stored or re-hashed.
    const views = toEvidenceViews(allVisibleEvidence, null, clock.now());
    return {
      card: withCountry(withIncidentPeriod(card, views)),
      revisions: listCardRevisions(db, user.tenantId, params.cardId),
      evidence: views.filter((view) => card.evidenceIds.includes(view.evidenceId)),
      children: getChildren(db, user.tenantId, card.cardId, card.revision),
    };
  });
}
