# AEG-TSK-003 — Lexicon and formulation registry

| Field | Value |
|---|---|
| Requirements | AEG-REQ-002, AEG-CON-001, AEG-TST-002 |
| Depends on | TSK-001, TSK-002 |
| Owned paths | `src/registry/lexicon.ts`, `src/registry/formulations.ts`, `tests/unit/lexicon.test.ts`, `tests/integration/registry.test.ts` |
| Read | CON-001 (`docs/02-architecture/`), `src/registry/formulations/resource-shortfall.ts` |
| Gate | `npm run gate -- TSK-003` |

## Spec
```ts
export interface LexiconEntry { termId: string; namespace: 'AEG.T'; preferredLabel: string; definition: string; aliases: string[]; typeOrUnit: string; domain: string; provenance: string; version: string; owner: string; lifecycle: 'candidate' | 'active' | 'deprecated'; projectDefined: boolean }
export const LEXICON: readonly LexiconEntry[];
export type TermResolution = { kind: 'exact'; entry: LexiconEntry } | { kind: 'ambiguous'; candidates: LexiconEntry[] } | { kind: 'none' };
export function resolveTerm(text: string): TermResolution;      // case-insensitive, trims, matches preferredLabel, termId or alias
// formulations.ts
export interface FormulationDef { formulationId: string; semanticVersion: string; title: string; units: string[]; assumptions: string[]; preconditions: string[]; algorithmHash: string; roundingPolicy: string; examples: unknown[]; invalidCases: unknown[]; owner: string; status: 'candidate' | 'tested' | 'active' | 'deprecated'; effectiveFrom: string }
export function seedFormulations(db: Db, nowIso: string): void;                 // inserts RESOURCE-SHORTFALL 1.0.0 as active if absent; idempotent
export function getActiveFormulation(db: Db, id: string, version?: string): FormulationDef;
```
Lexicon terms (all `projectDefined: true`, lifecycle `active`, version `1.0.0`, owner `Owner`, provenance `AEG-CON-001`): `AEG.T.DEMAND_UNITS`, `AEG.T.AVAILABLE_UNITS`, `AEG.T.RESERVE_UNITS`, `AEG.T.USABLE_UNITS`, `AEG.T.SHORTFALL_UNITS`, `AEG.T.SURPLUS_UNITS`, `AEG.T.INCIDENT`, `AEG.T.EVIDENCE`, `AEG.T.AS_OF`. Write short plain definitions (one sentence each; no invented sources). Aliases: demand units -> `demand`, `need`; available -> `available`, `stock`; reserve -> `reserve`, `stock`; shortfall -> `gap`, `shortfall`; surplus -> `surplus`. (`stock` is deliberately ambiguous.)
`seedFormulations` stores `spec_json` as canonical JSON of the definition, `algorithm_hash` from `ALGORITHM_HASH`, `effective_from` = `nowIso`. `getActiveFormulation`: unknown id or version -> `E_FORMULATION_UNKNOWN`; exists but state not `active` -> `E_FORMULATION_NOT_ACTIVE`; no version given -> the single active version.

## Tests
- "resolveTerm exact, alias and ambiguous": `need` -> DEMAND_UNITS; `stock` -> ambiguous with exactly 2 candidates; `zzz` -> none; case and surrounding spaces ignored.
- "every lexicon entry is complete" (no empty field; termIds unique; no alias collides except `stock`).
- "seed is idempotent and stores the golden hash" (hash equals `1fd27b8a...2ef6`).
- "unknown version refused" (`getActiveFormulation(db, 'AEG.F.RESOURCE-SHORTFALL', '9.9.9')` -> `E_FORMULATION_UNKNOWN`).
- "candidate is not executable" (insert a candidate row through SQL in the test; `E_FORMULATION_NOT_ACTIVE`).
- "active version cannot be rewritten" (SQL update of `algorithm_hash` throws).

## Do not
Invent terms beyond the list. Do not duplicate the algorithm.
