import type { FastifyInstance } from 'fastify';
import { AegisError } from '../../engine/errors.js';
import { getCardRevision } from '../../data/repos/cards.js';
import { decisionHashOf } from '../../services/workflows/resourceAssessment.js';
import { runWorkflow } from '../../services/workflowEngine.js';
import { principalFrom } from '../auth.js';
import type { AppDeps } from '../server.js';
import { RunAssessmentBody } from '../../types/api-schemas.js';

const WORKFLOW_ID = 'AEG.W.RESOURCE-ASSESSMENT';

export function registerWorkflowRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post('/api/workflows/resource-assessment', async (request) => {
    const principal = principalFrom(request);
    const input = RunAssessmentBody.parse(request.body);
    const run = runWorkflow({
      db: deps.db,
      clock: deps.clock,
      ids: deps.ids,
      principal,
      hooks: deps.hooks,
    }, WORKFLOW_ID, input, { idempotencyKey: input.idempotencyKey });
    if (run.state === 'failed') {
      throw new AegisError(run.errorCode ?? 'E_INTERNAL', undefined, { runId: run.runId });
    }
    const card = run.resultCardId && run.resultRevision !== null
      ? getCardRevision(deps.db, principal.tenantId, run.resultCardId, run.resultRevision)
      : null;
    if (run.resultCardId !== null && card === null) {
      throw new AegisError('E_INTERNAL', 'Workflow result card could not be read');
    }
    return { run, card, decisionHash: card ? decisionHashOf(card.body) : null };
  });
}
