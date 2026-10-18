# AEG-TSK-018 — Traceability and closeout

| Field | Value |
|---|---|
| Requirements | AEG-REQ-017 |
| Depends on | all MUST and SHOULD cards that were accepted |
| Owned paths | `tools/trace.ts`, `tools/trace-map.json`, `records/traceability/AEG-TRC-001_trace-report.md`, `tests/unit/trace.test.ts` |
| Read | `docs/04-assurance/` requirement and test registers |
| Gate | `npm run gate -- TSK-018` |

## Spec
`trace-map.json` maps each requirement id (AEG-REQ-001 to 018) to `{ implementation: string[], tests: string[], gateTasks: string[] }` using only files and gate ids that exist; a requirement with no accepted gate is `pending`, never `covered`. `tools/trace.ts` reads the map and the newest evidence file per gate (parse the `Result` line), then writes the report with one row per requirement: files, tests, latest gate result, status word (`fixture-tested` when a PASS evidence exists and no live evidence exists, `pending` otherwise). It must also print the honest limitations list: stubs are not live; synthetic data; ephemeral demo storage; hash chain is not a Merkle proof; screenshots are not an accessibility audit.
Tests: a missing evidence file -> `pending`; a FAIL evidence -> `pending`; a PASS -> `fixture-tested`; unknown file in the map -> the tool exits 1.
After the gate passes, write a final build-log entry listing which requirements are `fixture-tested` and which are `pending`. Do not edit `HANDOVER.md` (the engineer does).
