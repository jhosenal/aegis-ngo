import { appendEvent } from '../audit/chainStore.js';
import type { Db } from '../data/db.js';
import { canonicalize, hashWithDomain } from '../engine/canonical.js';
import type { IdGen } from '../engine/ids.js';
import type { CardBody, CardField } from '../types/domain.js';
import { listEvidence } from '../data/repos/evidence.js';

interface TenantRow {
  tenant_id: string;
  product_id: string;
}

function incidentFields(record: ReturnType<typeof listEvidence>[number]): CardField[] {
  const payload = record.payload;
  const hasLocation = payload.latE6 !== null && payload.lonE6 !== null;
  return [
    { key: 'hazardType', label: 'Hazard type', value: payload.hazardType, unit: null, epistemic: 'fact' },
    { key: 'alertLevel', label: 'Alert level', value: payload.alertLevel, unit: null, epistemic: 'fact' },
    { key: 'eventTime', label: 'Event time', value: record.eventTime, unit: null, epistemic: record.eventTime === null ? 'unknown' : 'fact' },
    { key: 'publishedAt', label: 'Published at', value: record.publishedAt, unit: null, epistemic: record.publishedAt === null ? 'unknown' : 'fact' },
    { key: 'affectedPeopleEstimate', label: 'Affected people estimate', value: payload.affectedPeopleEstimate, unit: 'people', epistemic: payload.affectedPeopleEstimate === null ? 'unknown' : 'estimate' },
    { key: 'regionId', label: 'Region', value: payload.regionId, unit: null, epistemic: 'fact' },
    {
      key: 'location', label: 'Location',
      value: hasLocation ? `${payload.latE6},${payload.lonE6}` : null,
      unit: hasLocation ? 'micro-degrees (latitude, longitude)' : null,
      epistemic: hasLocation ? 'fact' : 'unknown',
    },
  ];
}

function incidentBody(record: ReturnType<typeof listEvidence>[number]): CardBody {
  return {
    kind: 'incident',
    status: 'ok',
    synthetic: record.synthetic,
    syntheticLabel: record.synthetic ? 'SYNTHETIC DEMO DATA - not a real event' : null,
    summary: record.payload.title,
    fields: incidentFields(record),
    sections: [],
    assumptions: [],
    warnings: [],
    missing: [],
    result: null,
  };
}

export function projectIncidentCards(db: Db, ids: IdGen, nowIso: string): { created: string[] } {
  const transaction = db.transaction(() => {
    const tenants = db.prepare('SELECT tenant_id, product_id FROM tenants ORDER BY tenant_id').all() as TenantRow[];
    const evidence = listEvidence(db);
    const grouped = new Map<string, typeof evidence>();
    for (const record of evidence) {
      const key = `${record.sourceId}\u0000${record.sourceRecordId}`;
      grouped.set(key, [...(grouped.get(key) ?? []), record]);
    }
    for (const revisions of grouped.values()) revisions.sort((left, right) => left.revision - right.revision);

    const created: string[] = [];
    for (const tenant of tenants) {
      for (const revisions of grouped.values()) {
        for (const record of revisions) {
          const cardId = `INC-${tenant.tenant_id}-${record.sourceRecordId}`;
          const existingCard = db.prepare('SELECT card_id FROM cards WHERE card_id = ? AND tenant_id = ?').get(cardId, tenant.tenant_id);
          if (!existingCard) {
            db.prepare('INSERT INTO cards (card_id, tenant_id, kind, created_at) VALUES (?, ?, ?, ?)')
              .run(cardId, tenant.tenant_id, 'incident', nowIso);
            created.push(cardId);
          }

          const existingRevision = db.prepare('SELECT revision FROM card_revisions WHERE card_id = ? AND revision = ?')
            .get(cardId, record.revision);
          if (existingRevision) continue;

          if (record.revision > 1) {
            db.prepare('UPDATE card_revisions SET state = ? WHERE card_id = ? AND revision = ?')
              .run('superseded', cardId, record.revision - 1);
          }
          const body = incidentBody(record);
          db.prepare(
            'INSERT INTO card_revisions (card_id, revision, state, title, body_json, evidence_ids_json, formulation_ref, workflow_run_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          ).run(
            cardId,
            record.revision,
            'validated',
            record.payload.title,
            canonicalize(body),
            canonicalize([record.evidenceId]),
            null,
            null,
            nowIso,
            'SYSTEM',
          );
          appendEvent(db, {
            productId: tenant.product_id,
            tenantId: tenant.tenant_id,
            eventType: record.revision === 1 ? 'card.created' : 'card.revised',
            actorIdentity: 'SYSTEM',
            actorRole: 'system',
            occurredAt: nowIso,
            workflowId: null,
            workflowVersion: null,
            inputSnapshotHash: null,
            resultHash: null,
            versions: {},
            payloadHash: hashWithDomain('AEG-PAYLOAD-v1', body),
            correlationKey: `${cardId}-r${record.revision}`,
          }, ids);
        }
      }
    }
    return { created };
  });
  return transaction.immediate();
}
