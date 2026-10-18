# AEG-TSK-006 — Workflow engine, route allowlist, idempotency

| Field | Value |
|---|---|
| Requirements | AEG-REQ-003, 011, AEG-TST-003, 011 |
| Depends on | TSK-002, TSK-003, TSK-004 |
| Owned paths | `src/registry/routes.ts`, `src/registry/workflows.ts`, `src/services/workflowEngine.ts`, `tests/integration/workflow.test.ts` |
| Read | ENG-002 sections 3 and 5, ENG-004 section 4, `src/types/domain.ts` |
| Gate | `npm run gate -- TSK-006` |

## Spec
```ts
// registry/routes.ts
export const ROUTES: readonly RouteDef[];   // exactly: I_aegis_help_show, I_aegis_incident_list, I_aegis_card_open, I_aegis_resource_assess, I_aegis_audit_verify, I_aegis_card_explain
export function getRoute(routeId: string): RouteDef;   // unknown -> AegisError('E_ROUTE_DENIED')
```
Route properties: `help_show` roles all, modelProposable true, sideEffects none. `incident_list` all, true, none. `card_open` all, true, none. `resource_assess` coordinator+analyst, true, writes-card. `audit_verify` coordinator, false, none. `card_explain` all, true, none.
```ts
// registry/workflows.ts
export const WORKFLOW_DEFS: readonly WorkflowDef[];   // AEG.W.RESOURCE-ASSESSMENT 1.0.0: roles coordinator+analyst, stepIds ['resolve','validate','compute','commit'], retryClass 'replayable', timeoutMs 5000
// services/workflowEngine.ts
export interface WorkflowContext { db: Db; clock: Clock; ids: IdGen; principal: Principal; hooks?: { afterCommit?: () => void } }
export interface Resolved { snapshot: Record<string, unknown>; }              // canonical-JSON-safe, everything that influences the result
export interface Commit { status: 'succeeded' | 'awaiting-input' | 'failed'; errorCode: string | null; resultHashPayload: unknown; write: (tx: Db, runId: string) => { cardId: string | null; revision: number | null } }
export interface WorkflowImpl<I> { def: WorkflowDef; parseInput(raw: unknown): I; resolve(ctx: WorkflowContext, input: I): Resolved; execute(ctx: WorkflowContext, resolved: Resolved): Commit }
export function registerWorkflow(impl: WorkflowImpl<any>): void;      // the ONLY place `any` is tolerated; keep it inside this signature
export function runWorkflow(ctx: WorkflowContext, workflowId: string, rawInput: unknown, opts: { idempotencyKey?: string }): RunResult
```
`runWorkflow` order: (1) workflow known and principal role allowed (`E_FORBIDDEN_ROLE`); (2) `parseInput`; (3) `resolve` read-only -> `snapshot`; `inputSnapshotHash = hashWithDomain('AEG-INPUT-v1', snapshot)`; (4) `key = opts.idempotencyKey ?? inputSnapshotHash`; (5) look up `(tenant, workflow, key)`: same hash -> return stored result with `replayed: true`; different hash -> `E_IDEMPOTENCY_CONFLICT`; (6) `execute` (pure, no writes); (7) one `.immediate()` transaction: insert run row (final state), step rows, call `commit.write` (card revisions and links), append audit event (`workflow.completed`, `workflow.awaiting_input` or `workflow.failed`; payloadHash over `{runId, status, errorCode}`, resultHash over `resultHashPayload`); a UNIQUE violation on the run key is caught, the transaction is rolled back, and the stored run is returned as a replay; (8) call `hooks.afterCommit?.()` after commit.
Design note: workflows in this slice are synchronous and atomic, so there is no half-finished run to resume. Steps are recorded at commit for traceability. Only `awaiting-input` runs carry state forward (a new run with new inputs creates a new revision). Do not build an outbox or background worker.

## Tests (register a trivial test workflow inside the test file)
Unknown workflow; role denied; unknown route -> `E_ROUTE_DENIED`; route table matches the property list exactly; replay (same key, same input) gives one run, one audit event; same key different input -> 409 code; no key: second identical request replays via snapshot hash; crash hook throwing after commit, then retry -> one run, `replayed: true`; two concurrent requests from two connections -> one run row; failed domain error -> run `failed`, no card, `workflow.failed` event; atomicity: a `write` that throws leaves no run row, no card, no audit event (rollback).
