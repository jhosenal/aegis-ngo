import type { FastifyInstance } from 'fastify';
import { getCardRevision, listCards } from '../../data/repos/cards.js';
import { listSourceStatuses } from '../../data/repos/evidence.js';
import { principalFrom } from '../auth.js';

type Db = import('better-sqlite3').Database;

export function registerIncidentRoute(app: FastifyInstance, db: Db): void {
  app.get('/api/incidents', async (request) => {
    const user = principalFrom(request);
    const summaries = listCards(db, user.tenantId, 'incident');
    const incidents = summaries.map((summary) => {
      const card = getCardRevision(db, user.tenantId, summary.cardId, summary.revision);
      if (!card) return null;
      return {
        cardId: card.cardId,
        latestRevision: card.revision,
        title: card.title,
        state: card.state,
        summary: card.body.summary,
        updatedAt: card.createdAt,
        synthetic: card.body.synthetic,
      };
    }).filter((incident) => incident !== null);
    return { incidents, sourceStatus: listSourceStatuses(db) };
  });
}
