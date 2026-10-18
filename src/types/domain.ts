// CONTRACT FILE (owned by the engineer). Programmer: import these types; do NOT redefine or loosen them.
// Changing a type here requires an engineer-approved ADR. Adding a NEW type in your own module is fine.
import type { ShortfallOutput } from '../registry/formulations/resource-shortfall.js';

export const PRODUCT_ID = 'AEG';
export const SYSTEM_TENANT_ID = 'SYSTEM'; // audit chain for public evidence ingestion; not a real tenant row

export type Role = 'coordinator' | 'analyst' | 'viewer';
export interface Principal {
  userId: string; tenantId: string; productId: string; role: Role;
  /** Set for accounts created by Google sign-in (migration 002); absent for the synthetic demo users. */
  plan?: 'standard' | 'pro';
  isAdmin?: boolean;
}

// ---------- evidence ----------
export type SourceState = 'OK' | 'UNAVAILABLE' | 'MALFORMED';
export type IntakeFlag = 'SYNTHETIC' | 'COORD_INVALID' | 'INCOMPLETE';        // STORED at intake
export type DerivedFlag = 'STALE' | 'SUPERSEDED' | 'CONFLICTING';              // COMPUTED at read time, never stored
export type QualityFlag = IntakeFlag | DerivedFlag;

export interface IncidentPayload {            // normalized payload (canonical-JSON safe: integers/strings only)
  incidentKey: string; title: string; hazardType: string; alertLevel: string;
  regionId: string; latE6: number | null; lonE6: number | null;   // micro-degrees; null when COORD_INVALID
  affectedPeopleEstimate: number | null;
}
export interface EvidenceRecord {
  evidenceId: string; tenantScope: string | null; sourceId: string; sourceRecordId: string; revision: number;
  supersedesEvidenceId: string | null; sourceUrl: string | null; licenceRef: string;
  eventTime: string | null; publishedAt: string | null; fetchedAt: string; validUntil: string | null;
  regionId: string | null; rawArtifactHash: string; normalizedPayloadHash: string; adapterVersion: string;
  intakeFlags: IntakeFlag[]; payload: IncidentPayload; synthetic: boolean;
}
export interface EvidenceView extends EvidenceRecord { flags: QualityFlag[]; ageSeconds: number }
export interface SourceStatus { sourceId: string; state: SourceState; lastOkAt: string | null; lastAttemptAt: string; detail: string | null }

// ---------- cards ----------
export type CardKind = 'incident' | 'resource' | 'assessment' | 'evidence' | 'note';
export type CardState = 'draft' | 'validated' | 'reviewed' | 'superseded';
export type Epistemic = 'fact' | 'calculation' | 'estimate' | 'proposal' | 'unknown';
export interface CardField { key: string; label: string; value: string | number | null; unit: string | null; epistemic: Epistemic }
export interface CardWarning { code: string; message: string }
export interface CardSection { title: string; collapsedByDefault: boolean; fields: CardField[] }
export interface CardBody {
  kind: CardKind;
  status: 'ok' | 'awaiting-input' | 'invalid' | 'degraded';
  synthetic: boolean; syntheticLabel: string | null;       // MUST be set (non-null) whenever synthetic is true
  summary: string;
  fields: CardField[];
  sections: CardSection[];                                  // long evidence stays here, collapsed by default
  assumptions: string[]; warnings: CardWarning[]; missing: string[];
  result: ShortfallOutput | null;                           // only on assessment cards
}
export interface CardRevision {
  cardId: string; tenantId: string; kind: CardKind; revision: number; state: CardState; title: string;
  body: CardBody; evidenceIds: string[]; formulationRef: string | null; workflowRunId: string | null;
  createdAt: string; createdBy: string;
}
export type LinkRelation = 'input' | 'result' | 'evidence';
export interface CardLink { parentCardId: string; parentRevision: number; childCardId: string; childRevision: number; relation: LinkRelation }
export const MAX_CARD_DEPTH = 6;
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

// ---------- registry: routes, workflows ----------
export const ROUTE_ID_RE = /^I_aegis_[a-z]+_[a-z]+$/;
export interface RouteDef { routeId: string; title: string; allowedRoles: Role[]; modelProposable: boolean; sideEffects: 'none' | 'writes-card' }
export type StepState = 'pending' | 'running' | 'succeeded' | 'failed' | 'awaiting-input' | 'awaiting-approval';
export interface WorkflowDef { workflowId: string; version: string; allowedRoles: Role[]; stepIds: string[]; retryClass: 'replayable' | 'external-effect'; timeoutMs: number }
export type RunState = StepState;
export interface RunResult { runId: string; state: RunState; resultCardId: string | null; resultRevision: number | null; errorCode: string | null; replayed: boolean }

// ---------- chat ----------
export type ProviderNoticeCode = 'GOOGLE_UNAVAILABLE_BACKUP_USED' | 'MODELS_UNAVAILABLE' | 'MODELS_DISABLED' | 'BUDGET_EXHAUSTED' | 'REFUSED' | 'CANCELLED';
export type ChatBlock =
  | { type: 'text'; text: string }
  | { type: 'cardRef'; cardId: string; revision: number }
  /** The map should zoom to this incident and open its card (the chat asked to show it). Coordinates are degrees. */
  | { type: 'mapFocus'; cardId: string; revision: number; lat: number; lng: number; hazard: string; title: string; alertLevel?: string | null; country?: string | null; eventTime?: string | null; why?: string }
  /** Essential services found near a point (hospital, clinic, pharmacy, police, fire station, disaster centre, shelter); the map draws them and lists them. Source and credit travel with it. */
  | { type: 'places'; category: string; label: string; centre: { lat: number; lng: number }; centreName: string; radiusM: number; credit: string; advice: string; places: { id: string; name: string; lat: number; lng: number; distanceM: number; phone: string | null; website: string | null; address: string | null; osmUrl: string }[] }
  | { type: 'table'; columns: string[]; rows: string[][] }
  | { type: 'notice'; level: 'info' | 'warning' | 'error'; code: string; text: string };
export interface ChatReply {
  messageId: string;
  /** The helper thread this message belongs to (new threads are created on their first message). */
  conversationId?: string;
  route: { routeId: string | null; source: 'local' | 'model' | 'clarify' | 'denied' };
  blocks: ChatBlock[];
  providerNotice: ProviderNoticeCode | null;
  attachedRevisions: { cardId: string; revision: number }[];   // EXACT revisions used for this request
  mode: 'auto' | 'normal' | 'pro' | 'expert' | 'gemini-3.5-flash-lite' | 'gemini-3.8-flash' | 'gemini-4-argon';   // the mode (or Gemini model id) the user asked for
  escalatedTo: 'Pro' | 'Expert' | null;                       // set when Auto stepped up because a cheaper answer failed its checks
}

// ---------- providers ----------
export type DataClass = 'public' | 'tenant_private';
export type ProviderErrorKind = 'TRANSIENT' | 'TIMEOUT' | 'AUTH' | 'REFUSAL' | 'MALFORMED' | 'BAD_REQUEST';
export interface ModelRequest { attemptId: string; roleId: RuntimeRole; model: string; system: string; user: string; responseSchemaId: string; maxOutputTokens: number; dataClass: DataClass }
export interface ModelUsage { inputTokens: number; outputTokens: number }
export interface ModelResponse { text: string; reportedModel: string | null; usage: ModelUsage | null }
export interface ModelProvider { readonly id: 'google' | 'reapi' | 'stub-google' | 'stub-reapi'; readonly isStub: boolean; call(req: ModelRequest, signal: AbortSignal): Promise<ModelResponse> }
export class ProviderError extends Error {
  constructor(public readonly kind: ProviderErrorKind, message?: string, public readonly possiblyCharged = false) { super(message ?? kind); this.name = 'ProviderError'; }
}
export type RuntimeRole = 'manager' | 'specialist' | 'reviewer' | 'advisor' | 'coordinator' | 'helper';
export interface RoleBinding {
  roleId: RuntimeRole; bindingVersion: string; primaryModel: string; backupModel: string | null;
  allowedDataClasses: DataClass[]; maxInputChars: number; maxOutputTokens: number;
  totalDeadlineMs: number; maxAttemptsTotal: number; maxCostPerTaskMicro: number; priceSnapshotId: string | null;
}
export type GatewayStatus = 'OK' | 'DEGRADED' | 'REFUSED' | 'CANCELLED';
export interface AttemptRecord { attemptId: string; provider: string; outcome: string; retryReason: string | null; costBasis: 'measured' | 'estimated' | 'unknown' | 'none' }
export interface GatewayOutcome { status: GatewayStatus; text: string | null; notice: ProviderNoticeCode | null; attempts: AttemptRecord[] }

// ---------- errors -> HTTP ----------
export const ERROR_STATUS: Record<string, number> = {
  E_VALIDATION: 400, E_JSON_PARSE: 400,
  E_AUTH_REQUIRED: 401, E_AUTH_EXPIRED: 401, E_FORBIDDEN_ROLE: 403, E_ROUTE_DENIED: 403, E_MODE_UNAVAILABLE: 403,
  E_NOT_FOUND: 404, E_DEMO_AUTH_DISABLED: 404,                 // cross-tenant access ALSO returns E_NOT_FOUND (never reveal existence)
  E_IDEMPOTENCY_CONFLICT: 409, E_INSUFFICIENT_CREDITS: 402,
  E_INPUT_MISSING: 422, E_INPUT_NULL: 422, E_INPUT_NOT_NONNEG_INT: 422, E_UNIT_MISSING: 422, E_REGION_MISSING: 422,
  E_ASOF_INVALID: 422, E_UNIT_MISMATCH: 422, E_REGION_MISMATCH: 422, E_ASOF_MISMATCH: 422, E_RESERVE_EXCEEDS_AVAILABLE: 422,
  E_FORMULATION_UNKNOWN: 422, E_FORMULATION_NOT_ACTIVE: 422, E_CARD_CYCLE: 422, E_CARD_DEPTH: 422,
  E_INTERNAL: 500,
};
