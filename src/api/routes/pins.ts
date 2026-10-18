import type { FastifyInstance } from 'fastify';
import type { Clock } from '../../engine/clock.js';
import { AegisError } from '../../engine/errors.js';
import { cardExists, listPins, pinCard, unpinCard } from '../../data/repos/pins.js';
import { principalFrom } from '../auth.js';
import { isValidApiId } from '../errors.js';

type Db = import('better-sqlite3').Database;

export function registerPinRoutes(app: FastifyInstance, db: Db, clock: Clock): void {
  app.get('/api/pins', async (request) => ({ pins: listPins(db, principalFrom(request)) }));

  app.put('/api/pins/:cardId', async (request) => {
    const params = request.params as { cardId?: unknown };
    if (!isValidApiId(params.cardId)) throw new AegisError('E_VALIDATION', 'Invalid card id');
    const user = principalFrom(request);
    pinCard(db, user, params.cardId, clock.now());
    return { pins: listPins(db, user) };
  });

  app.delete('/api/pins/:cardId', async (request) => {
    const params = request.params as { cardId?: unknown };
    if (!isValidApiId(params.cardId)) throw new AegisError('E_VALIDATION', 'Invalid card id');
    const user = principalFrom(request);
    if (!cardExists(db, user, params.cardId)) throw new AegisError('E_NOT_FOUND');
    unpinCard(db, user, params.cardId);
    return { pins: listPins(db, user) };
  });
}
