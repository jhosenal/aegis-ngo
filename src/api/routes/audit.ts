import type { FastifyInstance } from 'fastify';
import { appendEvent, exportChain, verifyStored } from '../../audit/chainStore.js';
import { hashWithDomain } from '../../engine/canonical.js';
import { AegisError } from '../../engine/errors.js';
import type { IdGen } from '../../engine/ids.js';
import type { Clock } from '../../engine/clock.js';
import type { Principal } from '../../types/domain.js';
import { principalFrom } from '../auth.js';

type Db = import('better-sqlite3').Database;
interface AuditDeps { db: Db; clock: Clock; ids: IdGen }

function coordinator(principal: Principal): void {
  if (principal.role !== 'coordinator') throw new AegisError('E_FORBIDDEN_ROLE');
}

export function registerAuditRoutes(app: FastifyInstance, deps: AuditDeps): void {
  app.get('/api/audit/verify', async (request) => {
    const principal = principalFrom(request);
    coordinator(principal);
    return verifyStored(deps.db, { productId: 'AEG', tenantId: principal.tenantId });
  });

  app.get('/api/audit/export', async (request) => {
    const principal = principalFrom(request);
    coordinator(principal);
    const scope = { productId: 'AEG', tenantId: principal.tenantId };
    const exported = exportChain(deps.db, scope);
    appendEvent(deps.db, {
      productId: scope.productId,
      tenantId: scope.tenantId,
      eventType: 'audit.exported',
      actorIdentity: principal.userId,
      actorRole: principal.role,
      occurredAt: deps.clock.now(),
      workflowId: null,
      workflowVersion: null,
      inputSnapshotHash: null,
      resultHash: null,
      versions: {},
      payloadHash: hashWithDomain('AEG-PAYLOAD-v1', { eventCount: exported.events.length }),
      correlationKey: null,
    }, deps.ids);
    return exported;
  });
}
