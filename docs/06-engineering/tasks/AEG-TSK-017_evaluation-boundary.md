# AEG-TSK-017 — Evaluation and learning boundary (COULD)

| Field | Value |
|---|---|
| Requirements | AEG-REQ-014, AEG-TST-014 |
| Depends on | TSK-012 |
| Owned paths | `src/services/evaluation.ts`, `tests/integration/evaluation.test.ts` |
| Read | ENG-004 section 7 |
| Gate | `npm run gate -- TSK-017` |

## Spec
```ts
export interface Criteria { minAccuracyGain: number; allowRegressions: boolean; allowWrongRoute: boolean }   // stored as JSON; gain expressed in basis points (integer) e.g. 3000 = 0.30
export function proposeCandidate(db: Db, p: { kind: 'route'; targetId: string; rationale: string; examples: unknown[]; criteria: Criteria }, ids: IdGen, nowIso: string): string;
export function evaluateCandidate(db: Db, candidateId: string, heldOut: { utterance: string; expected: string | 'none' }[], routerBaseline: (u: string) => string | 'none', routerCandidate: (u: string) => string | 'none'): { accuracyBaselineBp: number; accuracyCandidateBp: number; regressions: number; wrongRoutes: number; passed: boolean };   // writes metrics_json and sets state 'tested' or 'rejected'
export function promoteCandidate(db: Db, candidateId: string, reviewedBy: string, reason: string, nowIso: string): void;   // requires state 'tested' AND passed metrics AND non-empty reviewedBy, else throws AegisError('E_VALIDATION')
export function rollback(db: Db, targetId: string, toVersionLabel: string, by: string, reason: string, nowIso: string): void;
export function activeVersion(db: Db, targetId: string): string | null;
```
Nothing here changes behaviour by itself; a candidate has no effect until promoted. The candidate router for the test is an alias map wrapped around `parseLocalCommand`.

## Tests
Use ENG-004 section 7 exactly (baseline 5000 bp, candidate 10000 bp, passed). Failing candidates cannot be promoted; promotion without `reviewedBy` fails; promotion of an untested candidate fails; rollback restores the previous version label; `active_rules` keeps history (never deleted).
