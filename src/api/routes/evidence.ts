import type { FastifyInstance } from 'fastify';
import type { Clock } from '../../engine/clock.js';
import { AegisError } from '../../engine/errors.js';
import { getVisibleEvidence, listVisibleEvidence } from '../../data/repos/evidence.js';
import { toEvidenceViews } from '../../sources/evidenceView.js';
import { principalFrom } from '../auth.js';
import { isValidApiId } from '../errors.js';

type Db = import('better-sqlite3').Database;

export function registerEvidenceRoute(app: FastifyInstance, db: Db, clock: Clock): void {
  app.get('/api/evidence/:evidenceId', async (request) => {
    const params = request.params as { evidenceId?: unknown };
    if (!isValidApiId(params.evidenceId)) throw new AegisError('E_VALIDATION', 'Invalid evidence id');
    const user = principalFrom(request);
    const evidence = getVisibleEvidence(db, user.tenantId, params.evidenceId);
    if (!evidence) throw new AegisError('E_NOT_FOUND');
    const allVisible = listVisibleEvidence(db, user.tenantId);
    const view = toEvidenceViews(allVisible, [params.evidenceId], clock.now())[0];
    if (!view) throw new AegisError('E_INTERNAL', 'Visible evidence could not be rendered');
    return view;
  });
}
