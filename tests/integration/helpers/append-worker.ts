import { openDb } from '../../../src/data/db.js';
import { appendEvent } from '../../../src/audit/chainStore.js';
import { RandomIdGen } from '../../../src/engine/ids.js';

const [databasePath, tenantId, countText] = process.argv.slice(2);
const count = Number(countText);
if (!databasePath || !tenantId || !Number.isSafeInteger(count) || count < 1) {
  throw new Error('Expected database path, tenant id, and positive event count');
}

const db = openDb(databasePath);
try {
  const ids = new RandomIdGen();
  for (let index = 0; index < count; index += 1) {
    appendEvent(db, {
      productId: 'AEG',
      tenantId,
      eventType: 'test.append',
      actorIdentity: 'synthetic-worker',
      actorRole: 'system',
      occurredAt: '2026-10-13T01:00:00Z',
      workflowId: null,
      workflowVersion: null,
      inputSnapshotHash: null,
      resultHash: null,
      versions: {},
      payloadHash: null,
      correlationKey: null,
    }, ids);
  }
} finally {
  db.close();
}
