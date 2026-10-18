# AEG-TSK-010 — API write routes, audit and budget endpoints

| Field | Value |
|---|---|
| Requirements | AEG-REQ-004, 006, 009, 012, AEG-TST-004, 011, 012 |
| Depends on | TSK-009 |
| Owned paths | `src/api/routes/workflows.ts`, `audit.ts`, `budget.ts`, `tests/integration/api-workflow.test.ts` |
| Read | ENG-002 sections 2, 3, 5, ENG-004 sections 3 and 4 |
| Gate | `npm run gate -- TSK-010` |

## Spec
- `POST /api/workflows/resource-assessment`: roles coordinator and analyst; body `RunAssessmentBody`; `registerResourceAssessment()` is called once in `createApp`; calls `runWorkflow` with the principal and `deps.hooks`; response `{ run, card, decisionHash }`; HTTP 200 for `succeeded`, `awaiting-input` and replays; domain failures surface through the error handler with `details.runId`.
- `GET /api/audit/verify` (coordinator): `verifyStored` for the caller's own `(AEG, tenantId)` chain.
- `GET /api/audit/export` (coordinator): `exportChain` for the caller's tenant; append an `audit.exported` event (payload hash over `{eventCount}`) AFTER building the export so the exported head is the pre-export head.
- `GET /api/budget` (coordinator): `{ limits, committedMicro, modelsEnabled, providerMode }` using the `BudgetLedger` totals; if the ledger table is absent create it by instantiating `BudgetLedger`.
- Pin routes already exist from TSK-009; verify they never call any provider.

## Tests
All 18 matrix rows of ENG-004 section 3 again through HTTP (same expected values, plus status codes); crash hook (`afterCommit` throws once) then client retry returns `replayed: true` with one audit event; `GET /api/audit/verify` returns `ok: true` after several runs; export verified by `verifyChain` imported in the test; viewer gets 403 on workflows, audit, budget; tenant B export contains no tenant A event; budget endpoint shows zero committed and `modelsEnabled: false` by default.
