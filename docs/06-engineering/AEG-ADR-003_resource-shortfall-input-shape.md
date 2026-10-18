# AEG-ADR-003 — Resource shortfall input shape

| Field | Value |
|---|---|
| Status | accepted |
| Requirement IDs | AEG-REQ-002, AEG-REQ-010 |
| Refines | AEG-CON-001, formulation AEG.F.RESOURCE-SHORTFALL/1.0.0 |

## Problem

CON-001 lists flat inputs (`demandUnits`, `availableUnits`, `reserveUnits`, `unitId`, `regionId`, `asOf`). With a single shared `unitId`, `regionId` and `asOf`, the required precondition "same units/region/time basis" cannot be violated, so test AEG-TST-010 (unit mismatch) cannot be exercised.

## Decision

The input is three quantities, each carrying its own basis: `{ demand, available, reserve }` where each is `{ units: integer | null, unitId, regionId, asOf }`. The calculation rejects any difference in `unitId`, `regionId` or `asOf` between them. Output fields match CON-001 and add the hashes. The algorithm text is frozen in `ALGORITHM_SPEC` and its SHA-256 is `1fd27b8a48713b2d7583d8df4f4a3b902d2573900b2eb4713c9f95dcc3ac2ef6`.

Other rules: integers from 0 to 1,000,000,000; null is rejected by the calculation and surfaced by the workflow as "awaiting input" (null is never coerced to zero); the calculation has no clock, network or model access.

## Consequences

- Version 1.0.0 is active and immutable. Any change to the algorithm creates 1.1.0 or 2.0.0 as a candidate with new tests.
- The reference implementation and its tests are in `src/registry/formulations/resource-shortfall.ts` (GOLDEN).
