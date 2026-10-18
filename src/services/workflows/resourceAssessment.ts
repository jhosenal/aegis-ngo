import { createHash } from 'node:crypto';
import { AegisError } from '../../engine/errors.js';
import { hashWithDomain } from '../../engine/canonical.js';
import { computeShortfall, ALGORITHM_HASH, FORMULATION_ID, FORMULATION_VERSION, type Quantity, type ShortfallInput, type ShortfallOutput } from '../../registry/formulations/resource-shortfall.js';
import { RunAssessmentBody, type RunAssessmentBodyT } from '../../types/api-schemas.js';
import type { CardBody, CardField, CardWarning, EvidenceRecord, EvidenceView, WorkflowDef } from '../../types/domain.js';
import { getCardRevision, createCardRevision } from '../../data/repos/cards.js';
import { addLink } from '../../data/repos/cards.js';
import { toEvidenceViews } from '../../sources/evidenceView.js';
import { registerWorkflow, type Commit, type Resolved, type WorkflowContext, type WorkflowImpl } from '../workflowEngine.js';

const WORKFLOW_ID = 'AEG.W.RESOURCE-ASSESSMENT';
const FORMULATION_REF = `${FORMULATION_ID}/${FORMULATION_VERSION}`;
const RESOURCE_ASSESSMENT_DEF: WorkflowDef = {
  workflowId: WORKFLOW_ID,
  version: '1.0.0',
  allowedRoles: ['coordinator', 'analyst'],
  stepIds: ['resolve', 'validate', 'compute', 'commit'],
  retryClass: 'replayable',
  timeoutMs: 5000,
};

interface ResourceRow {
  resource_id: string;
  available_units: number;
  reserve_units: number;
  as_of: string;
  synthetic: number;
  label: string;
}

interface EvidenceDbRow {
  evidence_id: string;
  tenant_scope: string | null;
  source_id: string;
  source_record_id: string;
  revision: number;
  supersedes_evidence_id: string | null;
  source_url: string | null;
  licence_ref: string;
  event_time: string | null;
  published_at: string | null;
  fetched_at: string;
  valid_until: string | null;
  region_id: string | null;
  raw_artifact_hash: string;
  normalized_payload_hash: string;
  adapter_version: string;
  quality_flags_json: string;
  payload_json: string;
  synthetic: number;
}

interface AssessmentSnapshot {
  tenantId: string;
  incidentCardId: string;
  incidentRevision: number;
  incidentTitle: string;
  incidentSynthetic: boolean;
  incidentSyntheticLabel: string | null;
  affectedPeopleEstimate: number | null;
  evidenceIds: string[];
  evidenceFingerprints: { evidenceId: string; normalizedPayloadHash: string; flags: string[]; sourceId: string }[];
  sourceStates: { sourceId: string; state: string | null }[];
  resource: {
    resourceId: string;
    availableUnits: number;
    reserveUnits: number;
    asOf: string;
    synthetic: boolean;
    label: string;
  } | null;
  quantities: ShortfallInput;
  warnings: CardWarning[];
  nowIso: string;
  formulationRef: string;
  algorithmHash: string;
}

interface AssessmentExecution {
  snapshot: AssessmentSnapshot;
  body: CardBody;
  assessmentCardId: string;
  state: 'validated' | 'draft';
  errorCode: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseEvidencePayload(json: string): EvidenceRecord['payload'] {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    throw new AegisError('E_INTERNAL', 'Stored evidence payload is invalid JSON');
  }
  if (!isRecord(value)
    || typeof value.incidentKey !== 'string'
    || typeof value.title !== 'string'
    || typeof value.hazardType !== 'string'
    || typeof value.alertLevel !== 'string'
    || typeof value.regionId !== 'string'
    || !(typeof value.latE6 === 'number' || value.latE6 === null)
    || !(typeof value.lonE6 === 'number' || value.lonE6 === null)
    || !(typeof value.affectedPeopleEstimate === 'number' || value.affectedPeopleEstimate === null)) {
    throw new AegisError('E_INTERNAL', 'Stored evidence payload is missing required fields');
  }
  return value as unknown as EvidenceRecord['payload'];
}

function parseIntakeFlags(json: string): EvidenceRecord['intakeFlags'] {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    throw new AegisError('E_INTERNAL', 'Stored evidence flags are invalid JSON');
  }
  if (!Array.isArray(value)
    || !value.every((flag) => flag === 'SYNTHETIC' || flag === 'COORD_INVALID' || flag === 'INCOMPLETE')) {
    throw new AegisError('E_INTERNAL', 'Stored evidence flags are invalid');
  }
  return value as EvidenceRecord['intakeFlags'];
}

function evidenceFromRow(row: EvidenceDbRow): EvidenceRecord {
  return {
    evidenceId: row.evidence_id,
    tenantScope: row.tenant_scope,
    sourceId: row.source_id,
    sourceRecordId: row.source_record_id,
    revision: row.revision,
    supersedesEvidenceId: row.supersedes_evidence_id,
    sourceUrl: row.source_url,
    licenceRef: row.licence_ref,
    eventTime: row.event_time,
    publishedAt: row.published_at,
    fetchedAt: row.fetched_at,
    validUntil: row.valid_until,
    regionId: row.region_id,
    rawArtifactHash: row.raw_artifact_hash,
    normalizedPayloadHash: row.normalized_payload_hash,
    adapterVersion: row.adapter_version,
    intakeFlags: parseIntakeFlags(row.quality_flags_json),
    payload: parseEvidencePayload(row.payload_json),
    synthetic: row.synthetic === 1,
  };
}

function loadVisibleEvidence(ctx: WorkflowContext): EvidenceRecord[] {
  const rows = ctx.db.prepare(
    'SELECT * FROM evidence WHERE tenant_scope IS NULL OR tenant_scope = ? ORDER BY source_id, source_record_id, revision',
  ).all(ctx.principal.tenantId) as EvidenceDbRow[];
  return rows.map(evidenceFromRow);
}

function sourceStates(ctx: WorkflowContext, views: EvidenceView[]): { sourceId: string; state: string | null }[] {
  const sourceIds = [...new Set(views.map((view) => view.sourceId))].sort();
  const find = ctx.db.prepare('SELECT state FROM source_status WHERE source_id = ?');
  return sourceIds.map((sourceId) => {
    const row = find.get(sourceId) as { state: string } | undefined;
    return { sourceId, state: row?.state ?? null };
  });
}

function warningsFor(views: EvidenceView[], states: { sourceId: string; state: string | null }[], row: ResourceRow | undefined, nowIso: string): CardWarning[] {
  const codes = new Set<string>();
  for (const view of views) {
    if (view.flags.includes('STALE')) codes.add('EVIDENCE_STALE');
    if (view.flags.includes('CONFLICTING')) codes.add('EVIDENCE_CONFLICTING');
    if (view.flags.includes('COORD_INVALID')) codes.add('EVIDENCE_COORD_INVALID');
  }
  if (states.some((source) => source.state !== 'OK')) codes.add('SOURCE_UNAVAILABLE');
  if (row && Date.parse(nowIso) - Date.parse(row.as_of) > 24 * 60 * 60 * 1000) codes.add('RESOURCE_AS_OF_OLD');

  const messages: Record<string, string> = {
    EVIDENCE_STALE: 'Incident evidence is stale.',
    EVIDENCE_CONFLICTING: 'Incident evidence conflicts with another source.',
    EVIDENCE_COORD_INVALID: 'Incident evidence has invalid coordinates.',
    SOURCE_UNAVAILABLE: 'An incident evidence source is currently unavailable.',
    RESOURCE_AS_OF_OLD: 'Resource data is more than 24 hours old.',
    NO_RESOURCE_RECORD: 'No resource record exists for this region and unit.',
  };
  return [...codes].map((code) => ({ code, message: messages[code]! }));
}

function missingQuantities(input: ShortfallInput): string[] {
  const missing: string[] = [];
  if (input.demand.units === null) missing.push('demandUnits');
  if (input.available.units === null) missing.push('availableUnits');
  if (input.reserve.units === null) missing.push('reserveUnits');
  return missing;
}

function field(key: string, label: string, value: string | number | null, unit: string | null, epistemic: CardField['epistemic']): CardField {
  return { key, label, value, unit, epistemic };
}

function assessmentCardId(tenantId: string, incidentCardId: string, regionId: string, unitId: string): string {
  const digest = createHash('sha256').update(`${tenantId}|${incidentCardId}|${regionId}|${unitId}`, 'utf8').digest('hex');
  return `ASM-${digest.slice(0, 12)}`;
}

function decisionPayload(body: CardBody): { result: ShortfallOutput | null; missing: string[]; status: CardBody['status']; warningCodes: string[] } {
  return {
    result: body.result,
    missing: body.missing,
    status: body.status,
    warningCodes: body.warnings.map((warning) => warning.code),
  };
}

export function decisionHashOf(body: CardBody): string {
  return hashWithDomain('AEG-RESULT-v1', decisionPayload(body));
}

function makeBody(snapshot: AssessmentSnapshot, result: ShortfallOutput | null, missing: string[]): CardBody {
  const { demand, available, reserve } = snapshot.quantities;
  const isSynthetic = snapshot.incidentSynthetic || snapshot.resource?.synthetic === true;
  const syntheticLabel = snapshot.resource?.synthetic
    ? snapshot.resource.label
    : snapshot.incidentSyntheticLabel;
  const status = result === null ? 'awaiting-input' : 'ok';
  const assumptions = [
    'Arithmetic assessment only; it does not show that supplies can be transported or allocated.',
    'Demand, available and reserve share one unit, region and as-of time.',
  ];
  if (snapshot.resource?.synthetic) assumptions.push('Resource figures are SYNTHETIC DEMO DATA, not a real stock record.');

  const affected = snapshot.affectedPeopleEstimate;
  const fields: CardField[] = [
    field('unitId', 'Unit', demand.unitId, null, 'fact'),
    field('regionId', 'Region', demand.regionId, null, 'fact'),
    field('asOf', 'As of', demand.asOf, null, 'fact'),
    field('demandUnits', 'Demand', demand.units, demand.unitId, demand.units === null ? 'unknown' : 'fact'),
    field('availableUnits', 'Available', available.units, available.unitId, available.units === null ? 'unknown' : 'fact'),
    field('reserveUnits', 'Reserve', reserve.units, reserve.unitId, reserve.units === null ? 'unknown' : 'fact'),
    field('usableUnits', 'Usable', result?.usableUnits ?? null, demand.unitId, 'calculation'),
    field('shortfallUnits', 'Shortfall', result?.shortfallUnits ?? null, demand.unitId, 'calculation'),
    field('surplusUnits', 'Surplus', result?.surplusUnits ?? null, demand.unitId, 'calculation'),
    field('affectedPeopleEstimate', 'Affected people estimate', affected, 'people', affected === null ? 'unknown' : 'estimate'),
  ];
  let summary: string;
  if (result === null) {
    summary = `Awaiting input: ${missing.join(', ')}`;
  } else if (result.shortfallUnits > 0) {
    summary = `Shortfall ${result.shortfallUnits} ${result.unitId} (demand ${result.demandUnits}, usable ${result.usableUnits})`;
  } else {
    summary = `No shortfall; surplus ${result.surplusUnits} ${result.unitId} (demand ${result.demandUnits}, usable ${result.usableUnits})`;
  }
  return {
    kind: 'assessment',
    status,
    synthetic: isSynthetic,
    syntheticLabel: isSynthetic ? syntheticLabel ?? 'SYNTHETIC DEMO DATA' : null,
    summary,
    fields,
    sections: [],
    assumptions,
    warnings: snapshot.warnings,
    missing,
    result,
  };
}

function buildExecution(ctx: WorkflowContext, snapshot: AssessmentSnapshot): AssessmentExecution {
  const missing = missingQuantities(snapshot.quantities);
  if (missing.length > 0) {
    return {
      snapshot,
      body: makeBody(snapshot, null, missing),
      assessmentCardId: assessmentCardId(snapshot.tenantId, snapshot.incidentCardId,
        snapshot.quantities.demand.regionId, snapshot.quantities.demand.unitId),
      state: 'draft',
      errorCode: null,
    };
  }

  try {
    const result = computeShortfall(snapshot.quantities);
    return {
      snapshot,
      body: makeBody(snapshot, result, []),
      assessmentCardId: assessmentCardId(snapshot.tenantId, snapshot.incidentCardId,
        snapshot.quantities.demand.regionId, snapshot.quantities.demand.unitId),
      state: 'validated',
      errorCode: null,
    };
  } catch (error: unknown) {
    if (!(error instanceof AegisError)) throw error;
    return {
      snapshot,
      body: makeBody(snapshot, null, []),
      assessmentCardId: assessmentCardId(snapshot.tenantId, snapshot.incidentCardId,
        snapshot.quantities.demand.regionId, snapshot.quantities.demand.unitId),
      state: 'validated',
      errorCode: error.code,
    };
  }
}

const resourceAssessment: WorkflowImpl<RunAssessmentBodyT> = {
  def: RESOURCE_ASSESSMENT_DEF,
  parseInput(raw: unknown): RunAssessmentBodyT {
    return RunAssessmentBody.parse(raw);
  },
  resolve(ctx: WorkflowContext, request: RunAssessmentBodyT): Resolved {
    const incident = getCardRevision(ctx.db, ctx.principal.tenantId, request.incidentCardId, request.incidentRevision);
    if (!incident || incident.kind !== 'incident') throw new AegisError('E_NOT_FOUND');
    const nowIso = ctx.clock.now();
    const allVisibleEvidence = loadVisibleEvidence(ctx);
    const views = toEvidenceViews(allVisibleEvidence, incident.evidenceIds, nowIso);
    const sourceStatusRows = sourceStates(ctx, views);
    const row = ctx.db.prepare(
      'SELECT resource_id, available_units, reserve_units, as_of, synthetic, label FROM resources WHERE tenant_id = ? AND region_id = ? AND unit_id = ?',
    ).get(ctx.principal.tenantId, request.regionId, request.unitId) as ResourceRow | undefined;
    const asOf = request.asOf ?? row?.as_of ?? nowIso;
    const demand: Quantity = { units: request.demandUnits ?? null, unitId: request.unitId, regionId: request.regionId, asOf };
    const resolveStored = (requested: number | null | undefined, value: number | undefined): Quantity['units'] => {
      if (typeof requested === 'number') return requested;
      if (requested === null) return null;
      return value ?? null;
    };
    const available: Quantity = {
      units: resolveStored(request.availableUnits, row?.available_units),
      unitId: request.unitId,
      regionId: request.regionId,
      asOf: request.availableUnits === undefined && row ? row.as_of : asOf,
    };
    const reserve: Quantity = {
      units: resolveStored(request.reserveUnits, row?.reserve_units),
      unitId: request.unitId,
      regionId: request.regionId,
      asOf: request.reserveUnits === undefined && row ? row.as_of : asOf,
    };
    const warnings = warningsFor(views, sourceStatusRows, row, nowIso);
    if (!row && (request.availableUnits === undefined || request.reserveUnits === undefined)
      && !warnings.some((warning) => warning.code === 'NO_RESOURCE_RECORD')) {
      warnings.push({ code: 'NO_RESOURCE_RECORD', message: 'No resource record exists for this region and unit.' });
    }
    const incidentEvidence = views.map((view) => ({
      evidenceId: view.evidenceId,
      normalizedPayloadHash: view.normalizedPayloadHash,
      flags: [...view.flags],
      sourceId: view.sourceId,
    }));
    const affectedValue = incident.body.fields.find((item) => item.key === 'affectedPeopleEstimate')?.value;
    const snapshot: AssessmentSnapshot = {
      tenantId: ctx.principal.tenantId,
      incidentCardId: incident.cardId,
      incidentRevision: incident.revision,
      incidentTitle: incident.title,
      incidentSynthetic: incident.body.synthetic,
      incidentSyntheticLabel: incident.body.syntheticLabel,
      affectedPeopleEstimate: typeof affectedValue === 'number' ? affectedValue : null,
      evidenceIds: [...incident.evidenceIds],
      evidenceFingerprints: incidentEvidence,
      sourceStates: sourceStatusRows,
      resource: row ? {
        resourceId: row.resource_id,
        availableUnits: row.available_units,
        reserveUnits: row.reserve_units,
        asOf: row.as_of,
        synthetic: row.synthetic === 1,
        label: row.label,
      } : null,
      quantities: { demand, available, reserve },
      warnings,
      nowIso,
      formulationRef: FORMULATION_REF,
      algorithmHash: ALGORITHM_HASH,
    };
    return { snapshot: snapshot as unknown as Record<string, unknown> };
  },
  execute(ctx: WorkflowContext, resolved: Resolved): Commit {
    const snapshot = resolved.snapshot as unknown as AssessmentSnapshot;
    const execution = buildExecution(ctx, snapshot);
    if (execution.errorCode !== null) {
      return {
        status: 'failed',
        errorCode: execution.errorCode,
        versions: { formulation: 'AEG.F.RESOURCE-SHORTFALL/1.0.0', workflow: 'AEG.W.RESOURCE-ASSESSMENT/1.0.0' },
        resultHashPayload: {
          result: null,
          missing: [],
          status: 'failed',
          warningCodes: execution.snapshot.warnings.map((warning) => warning.code),
        },
        write: () => ({ cardId: null, revision: null }),
      };
    }
    const resultHashPayload = decisionPayload(execution.body);
    return {
      status: execution.state === 'draft' ? 'awaiting-input' : 'succeeded',
      errorCode: null,
      versions: { formulation: 'AEG.F.RESOURCE-SHORTFALL/1.0.0', workflow: 'AEG.W.RESOURCE-ASSESSMENT/1.0.0' },
      resultHashPayload,
      write(tx, runId) {
        const cardRow = tx.prepare('SELECT tenant_id FROM cards WHERE card_id = ?').get(execution.assessmentCardId) as { tenant_id: string } | undefined;
        if (cardRow && cardRow.tenant_id !== ctx.principal.tenantId) throw new AegisError('E_NOT_FOUND');
        if (!cardRow) {
          tx.prepare('INSERT INTO cards (card_id, tenant_id, kind, created_at) VALUES (?, ?, ?, ?)')
            .run(execution.assessmentCardId, ctx.principal.tenantId, 'assessment', ctx.clock.now());
        }
        const revision = createCardRevision(tx, {
          tenantId: ctx.principal.tenantId,
          cardId: execution.assessmentCardId,
          kind: 'assessment',
          title: `Resource assessment: ${snapshot.quantities.demand.unitId} in ${snapshot.quantities.demand.regionId}`,
          body: execution.body,
          evidenceIds: snapshot.evidenceIds,
          formulationRef: snapshot.formulationRef,
          workflowRunId: runId,
          createdBy: ctx.principal.userId,
          state: execution.state,
        }, ctx.ids, ctx.clock.now());
        addLink(tx, ctx.principal.tenantId, {
          parentCardId: execution.assessmentCardId,
          parentRevision: revision.revision,
          childCardId: snapshot.incidentCardId,
          childRevision: snapshot.incidentRevision,
          relation: 'input',
        });
        return { cardId: revision.cardId, revision: revision.revision };
      },
    };
  },
};

export function registerResourceAssessment(): void {
  registerWorkflow(resourceAssessment);
}
