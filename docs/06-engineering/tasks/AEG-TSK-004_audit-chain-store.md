# AEG-TSK-004 — Audit chain store and verifier

| Field | Value |
|---|---|
| Requirements | AEG-REQ-012, AEG-TST-012, AEG-ADR-004 |
| Depends on | TSK-001, TSK-002 |
| Owned paths | `src/audit/chainStore.ts`, `tools/verify-audit.ts`, `tests/integration/audit.test.ts`, `tests/integration/helpers/append-worker.ts` |
| Read | ADR-004, `src/audit/chain-core.ts`, ENG-004 section 4 |
| Gate | `npm run gate -- TSK-004` |

## Spec
```ts
export interface NewAuditEvent { productId: string; tenantId: string; eventType: string; actorIdentity: string; actorRole: string; occurredAt: string; workflowId: string | null; workflowVersion: string | null; inputSnapshotHash: string | null; resultHash: string | null; versions: Record<string, string>; payloadHash: string | null; correlationKey: string | null }
export function appendEvent(db: Db, ev: NewAuditEvent, ids: IdGen): AuditEvent;   // MUST run inside a transaction: if !db.inTransaction, wrap in db.transaction(...).immediate()
export function loadChain(db: Db, scope: { productId: string; tenantId: string }): AuditEvent[];   // ORDER BY sequence
export interface AuditExport { format: 'aegis-audit-export/1'; scope: { productId: string; tenantId: string }; canonicalization: 'canonical-json-v1'; hashDomain: 'AEG-EVT-v1'; genesis: string; events: AuditEvent[]; head: Checkpoint | null }
export function exportChain(db: Db, scope: { productId: string; tenantId: string }): AuditExport;
export function verifyStored(db: Db, scope: { productId: string; tenantId: string }, checkpoint?: Checkpoint): ReturnType<typeof verifyChain>;
```
`appendEvent`: eventId = `ids.next('EVT')`; read the last row of the scope (`ORDER BY sequence DESC LIMIT 1`), sequence = last + 1 or 1, previousHash = last hash or `GENESIS_HASH`; build the body, `sealEvent`, insert `body_json = canonicalize(body)` and `hash`. `loadChain` rebuilds each event as `{...JSON.parse(body_json), hash}`.
`tools/verify-audit.ts`: `npm run verify:audit -- <export.json> [--checkpoint-seq N --checkpoint-hash H]`; imports `verifyChain`; prints `OK` or each error code and sequence; exit 0 or 1. It must not import the database layer.

## Tests (use ENG-004 section 4)
- 100 concurrent appends from two separate OS processes (helper script run with `node --import tsx`) on one file DB -> contiguous unique sequence, verifies.
- Tamper, delete, truncate (with and without checkpoint), cross-tenant scope, trigger rejection. For tamper tests drop the trigger inside the test connection first.
- Export file verified by the CLI as a child process (exit code 0), then a modified export (exit 1).
- "documented limit": a test named `full rewrite with matching checkpoint is not detectable (documented limit)` that asserts `ok === true` for a consistent forged chain.

## Do not
Call it a Merkle tree. Put business payloads into events.
