# AEG-TSK-008 — Resource assessment workflow

| Field | Value |
|---|---|
| Requirements | AEG-REQ-004, 005, 010, AEG-TST-004, 010 |
| Depends on | TSK-005, TSK-006, TSK-007 |
| Owned paths | `src/services/workflows/resourceAssessment.ts`, `tests/integration/assessment.test.ts` |
| Read | ENG-002 sections 4 and 5, ENG-004 section 3, `src/registry/formulations/resource-shortfall.ts`, `src/types/api-schemas.ts` |
| Gate | `npm run gate -- TSK-008` |

## Spec
Implement `WorkflowImpl<RunAssessmentBodyT>` for `AEG.W.RESOURCE-ASSESSMENT/1.0.0` and register it from an exported `registerResourceAssessment()` function.
- `parseInput`: `RunAssessmentBody.parse`.
- `resolve`: load the incident card revision (`getCardRevision`, own tenant, must be kind `incident`, else `E_NOT_FOUND`); load its evidence rows and compute views with `toEvidenceViews(all, ids, ctx.clock.now())`; load the tenant `resources` row; apply the ENG-002 section 5 algorithm exactly. `snapshot` contains: resolved quantities, incident card id and revision, evidence ids with `normalizedPayloadHash`, the resource row values and id, formulation ref `AEG.F.RESOURCE-SHORTFALL/1.0.0`, `algorithmHash`.
- `execute`: collect warnings (codes in ENG-002), if any quantity is null -> status `awaiting-input` (no calculation); else `computeShortfall` inside try/catch; an `AegisError` -> status `failed` with its code. Build the `CardBody` exactly as ENG-002 section 5 (fields with epistemic tags: unit, region, as-of = fact; demand, available, reserve = fact or unknown; usable, shortfall, surplus = calculation; affected people from the incident = estimate). `write` creates the assessment card revision (state `validated`, or `draft` when awaiting input; id rule from ENG-002), adds links (`input` to the incident revision), sets `formulationRef`, `evidenceIds`, `workflowRunId`, `createdBy = principal.userId`.
- `decisionHash` must be produced by the workflow result (export a helper `decisionHashOf(body)`) so API and chat return the same value.
- No provider or gateway import anywhere in this file.

## Tests
Implement all 18 rows of ENG-004 section 3 using `seedAll` into an in-memory test DB with `FixedClock('2026-10-13T01:00:00Z')` and `SeqIdGen`. Row 18 uses a spy provider object passed nowhere: assert that the workflow module has no import of `providers/` by reading its source text in the test.
