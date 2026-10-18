import { appendEvent } from '../audit/chainStore.js';
import { AegisError } from '../engine/errors.js';
import { hashWithDomain } from '../engine/canonical.js';
import type { Clock } from '../engine/clock.js';
import type { IdGen } from '../engine/ids.js';
import type { Principal, RunResult, RunState, WorkflowDef } from '../types/domain.js';
import { WORKFLOW_DEFS } from '../registry/workflows.js';

type Db = import('better-sqlite3').Database;

export interface WorkflowContext {
  db: Db;
  clock: Clock;
  ids: IdGen;
  principal: Principal;
  hooks?: { afterCommit?: () => void };
}

export interface Resolved { snapshot: Record<string, unknown> }

export interface Commit {
  status: 'succeeded' | 'awaiting-input' | 'failed';
  errorCode: string | null;
  resultHashPayload: unknown;
  versions?: Record<string, string>;
  write: (tx: Db, runId: string) => { cardId: string | null; revision: number | null };
}

export interface WorkflowImpl<I> {
  def: WorkflowDef;
  parseInput(raw: unknown): I;
  resolve(ctx: WorkflowContext, input: I): Resolved;
  execute(ctx: WorkflowContext, resolved: Resolved): Commit;
}

interface StoredRun {
  run_id: string;
  state: RunState;
  result_card_id: string | null;
  result_revision: number | null;
  error_code: string | null;
  input_snapshot_hash: string;
}

const implementations = new Map<string, WorkflowImpl<unknown>>();
const definitions = new Map(WORKFLOW_DEFS.map((definition) => [definition.workflowId, definition]));

export function registerWorkflow<I>(impl: WorkflowImpl<I>): void {
  if (implementations.has(impl.def.workflowId)) throw new AegisError('E_INTERNAL', `Workflow already registered: ${impl.def.workflowId}`);
  implementations.set(impl.def.workflowId, impl as unknown as WorkflowImpl<unknown>);
}

function storedResult(row: StoredRun, replayed: boolean): RunResult {
  return {
    runId: row.run_id,
    state: row.state,
    resultCardId: row.result_card_id,
    resultRevision: row.result_revision,
    errorCode: row.error_code,
    replayed,
  };
}

function findRun(db: Db, tenantId: string, workflowId: string, key: string): StoredRun | undefined {
  return db.prepare(
    'SELECT run_id, state, result_card_id, result_revision, error_code, input_snapshot_hash FROM workflow_runs WHERE tenant_id = ? AND workflow_id = ? AND idempotency_key = ?',
  ).get(tenantId, workflowId, key) as StoredRun | undefined;
}

function isWorkflowKeyConflict(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === 'SQLITE_CONSTRAINT_UNIQUE'
    && typeof candidate.message === 'string'
    && candidate.message.includes('workflow_runs.tenant_id, workflow_runs.workflow_id, workflow_runs.idempotency_key');
}

function stateFor(status: Commit['status']): RunState {
  if (status === 'awaiting-input') return 'awaiting-input';
  return status;
}

function eventTypeFor(status: Commit['status']): string {
  if (status === 'awaiting-input') return 'workflow.awaiting_input';
  if (status === 'failed') return 'workflow.failed';
  return 'workflow.completed';
}

function failedCommit(errorCode: string): Commit {
  return { status: 'failed', errorCode, resultHashPayload: { errorCode }, write: () => ({ cardId: null, revision: null }) };
}

export function runWorkflow(
  ctx: WorkflowContext,
  workflowId: string,
  rawInput: unknown,
  opts: { idempotencyKey?: string },
): RunResult {
  const definition = definitions.get(workflowId);
  const implementation = implementations.get(workflowId);
  if (!definition || !implementation) throw new AegisError('E_NOT_FOUND', 'Workflow not found');
  if (!definition.allowedRoles.includes(ctx.principal.role)) throw new AegisError('E_FORBIDDEN_ROLE');

  const input = implementation.parseInput(rawInput);
  const resolved = implementation.resolve(ctx, input);
  const inputSnapshotHash = hashWithDomain('AEG-INPUT-v1', resolved.snapshot);
  const idempotencyKey = opts.idempotencyKey ?? inputSnapshotHash;
  const existing = findRun(ctx.db, ctx.principal.tenantId, workflowId, idempotencyKey);
  if (existing) {
    if (existing.input_snapshot_hash !== inputSnapshotHash) throw new AegisError('E_IDEMPOTENCY_CONFLICT');
    return storedResult(existing, true);
  }

  let commit: Commit;
  try {
    commit = implementation.execute(ctx, resolved);
  } catch (error: unknown) {
    if (error instanceof AegisError) commit = failedCommit(error.code);
    else throw error;
  }

  const runId = ctx.ids.next('RUN');
  const runState = stateFor(commit.status);
  const now = ctx.clock.now();
  let result: RunResult;
  const apply = ctx.db.transaction(() => {
    ctx.db.prepare(
      'INSERT INTO workflow_runs (run_id, tenant_id, workflow_id, workflow_version, idempotency_key, input_snapshot_hash, state, result_card_id, result_revision, error_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(runId, ctx.principal.tenantId, workflowId, definition.version, idempotencyKey, inputSnapshotHash, runState,
      null, null, commit.errorCode, now, now);

    const terminalStepState: RunState = runState;
    const stepIds = definition.stepIds;
    stepIds.forEach((stepId, index) => {
      const finalStep = index === stepIds.length - 1;
      const stepState = finalStep ? terminalStepState : 'succeeded';
      ctx.db.prepare(
        'INSERT INTO workflow_steps (run_id, step_index, step_id, state, started_at, finished_at, error_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(runId, index, stepId, stepState, now, now, finalStep ? commit.errorCode : null);
    });

    const written = commit.write(ctx.db, runId);
    ctx.db.prepare('UPDATE workflow_runs SET result_card_id = ?, result_revision = ? WHERE run_id = ?')
      .run(written.cardId, written.revision, runId);

    appendEvent(ctx.db, {
      productId: ctx.principal.productId,
      tenantId: ctx.principal.tenantId,
      eventType: eventTypeFor(commit.status),
      actorIdentity: ctx.principal.userId,
      actorRole: ctx.principal.role,
      occurredAt: now,
      workflowId,
      workflowVersion: definition.version,
      inputSnapshotHash,
      resultHash: hashWithDomain('AEG-RESULT-v1', commit.resultHashPayload),
      versions: commit.versions ?? {},
      payloadHash: hashWithDomain('AEG-PAYLOAD-v1', { runId, status: runState, errorCode: commit.errorCode }),
      correlationKey: idempotencyKey,
    }, ctx.ids);
    result = {
      runId,
      state: runState,
      resultCardId: written.cardId,
      resultRevision: written.revision,
      errorCode: commit.errorCode,
      replayed: false,
    };
  });

  try {
    apply.immediate();
  } catch (error: unknown) {
    if (!isWorkflowKeyConflict(error)) throw error;
    const raced = findRun(ctx.db, ctx.principal.tenantId, workflowId, idempotencyKey);
    if (!raced) throw error;
    if (raced.input_snapshot_hash !== inputSnapshotHash) throw new AegisError('E_IDEMPOTENCY_CONFLICT');
    return storedResult(raced, true);
  }

  ctx.hooks?.afterCommit?.();
  return result!;
}
