# AEG-ENG-001 — Code structure and conventions

| Field | Value |
|---|---|
| Document ID | AEG-ENG-001 |
| Revision | 0.1 |
| Status | WORKING_BASELINE |
| Date | 2026-10-13 |
| Owner | Claude (engineer) |
| Approval | Authored under owner direction (AEG-ADR-001); not independently audited |
| Classification | Internal |

## 1. Repository layout (final target)

Files marked G are GOLDEN or CONTRACT: they ship complete and must not be edited. Files marked `TSK-NNN` are created by that task card. Do not create files that are not in this table without engineer approval.

```
Aegis/
  package.json  tsconfig.json  vitest.config.ts  .env.example     (shipped, G)
  playwright.config.ts                                            TSK-015
  migrations/001_init.sql                                         G
  fixtures/*.json                                                 G (synthetic data)
  src/
    types/domain.ts  types/api-schemas.ts                         G (contracts)
    engine/errors.ts  engine/canonical.ts                         G
    engine/clock.ts  engine/ids.ts                                TSK-001
    services/workflowEngine.ts                                    TSK-006
    services/cardService.ts                                       TSK-007
    services/incidentCards.ts                                     TSK-005 (projection of evidence -> incident cards)
    services/evaluation.ts                                        TSK-017
    services/seed.ts  services/seed-cli.ts                        TSK-005
    services/workflows/resourceAssessment.ts                      TSK-008
    config/config.ts                                              TSK-001
    data/db.ts  data/migrate.ts  data/migrate-cli.ts              TSK-002
    data/repos/evidence.ts                                        TSK-005
    data/repos/cards.ts  data/repos/pins.ts                       TSK-007
    registry/lexicon.ts  registry/formulations.ts                 TSK-003
    registry/formulations/resource-shortfall.ts                   G
    registry/routes.ts  registry/workflows.ts                     TSK-006 (route allowlist and workflow definitions only; no logic)
    sources/normalize.ts  sources/fixtureAdapter.ts               TSK-005
    sources/evidenceView.ts                                       TSK-005
    sources/safeFetch.ts                                          TSK-016
    audit/chain-core.ts                                           G
    audit/chainStore.ts                                           TSK-004
    providers/budget-ledger.ts                                    G
    providers/stubs.ts  providers/gateway.ts  providers/circuit.ts  providers/pricing.ts   TSK-011
    providers/google.ts                                           TSK-019 (phase 2, blocked)
    roles/manager.ts  roles/validate.ts                           TSK-012
    chat/router.ts  chat/chatService.ts                           TSK-012
    api/server.ts  api/auth.ts  api/errors.ts  api/main.ts        TSK-009
    api/routes/*.ts                                               TSK-009 (reads) / TSK-010 (writes) / TSK-012 (chat)
  ui/                                                             TSK-013..015 (see AEG-ENG-006)
  tests/unit/  tests/integration/  tests/browser/
  tools/verify-handover.mjs                                       (pre-existing, G)
  tools/run-gate.mjs  tools/gates.json                            G
  tools/verify-audit.ts                                           TSK-004
  tools/trace.ts  tools/trace-map.json                            TSK-018
  records/evidence/                                               written ONLY by tools/run-gate.mjs
  records/screenshots/                                            TSK-015
  docs/06-engineering/                                            engineer-owned (except the build log)
```

## 2. Layering (import direction is one way)

`types` <- `engine` <- `registry` <- `data` <- `audit` <- `sources` <- `providers` <- `services` <- `roles` <- `chat` <- `api`. A lower layer never imports from a higher one. `ui/` imports nothing from `src/` except `src/types/domain.ts` as `import type` only.

Purity rules:
- `src/engine/canonical.ts`, `src/registry/formulations/*`, `src/audit/chain-core.ts`: no I/O, no clock, no randomness.
- SQL appears only in `src/data/**`, `src/audit/chainStore.ts`, `src/providers/budget-ledger.ts`, `src/providers/gateway.ts` (model_calls rows) and `src/services/**` (commit transactions). The API layer never contains SQL.
- Models are reachable only through `src/providers/gateway.ts`. No other module imports a provider.

Transaction rules:
- Any operation that changes more than one table runs inside one `db.transaction(...)`.
- The workflow commit (run row, steps, card revision, links, audit event) is ONE transaction started with `.immediate()`.
- Audit sequence and previous hash are read and written inside that same transaction.

## 3. Conventions

- Naming: files `camelCase.ts` except golden files (kebab). Types `PascalCase`. Constants `UPPER_SNAKE`. Registered identifiers keep their exact form: formulations `AEG.F.<NAME>`, workflows `AEG.W.<NAME>`, terms `AEG.T.<NAME>`, routes `I_aegis_<domain>_<verb>`.
- Errors: throw `AegisError(code, message, details?)`. Codes come from `ERROR_STATUS` in `src/types/domain.ts`. Add a new code only by asking the engineer.
- No default exports in `src/`. No `any`. Prefer `unknown` plus zod parsing at every boundary (HTTP body, file, JSON column, model output).
- JSON columns are written with `canonicalize()` and read with `JSON.parse` followed by a zod or type-guard check.
- SQL: prepared statements with `?` only. Table and column names are literals in code.
- IDs: generated only through `IdGen.next(prefix)`. Timestamps only through `Clock.now()`.
- Tests: Vitest, one `describe` per module, test names include the requirement or test id (for example `AEG-TST-010`). Use fixtures from `fixtures/`; never hard-code a second copy of fixture data.
- Comments explain why, not what. No commented-out code.

## 4. Dependency whitelist

Runtime: `fastify`, `@fastify/static`, `better-sqlite3`, `zod`, `react`, `react-dom`.
Development: `typescript`, `tsx`, `vitest`, `@types/node`, `@types/better-sqlite3`, `vite`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom`, `@playwright/test`.
Anything else (including a Google or reAPI SDK, an ORM, a UI kit, lodash, axios, dotenv) needs written engineer approval. Use built-in `fetch`. Load `.env` with a tiny local parser only if the card says so.

## 5. Security checklist (applies to every card)

1. Tenant from `Principal` only. Cross-tenant lookups return `E_NOT_FOUND`, never "forbidden".
2. Request bodies are `.strict()` zod schemas. Unknown keys are rejected.
3. Output to the UI is data (blocks and fields). No HTML from models or feeds.
4. Secrets only in environment variables; never logged; never in responses.
5. Model and feed text never changes permissions, routes, budgets or tenant.
6. Logs must not contain request bodies of tenant-private data.

## 6. Language and claims

Use plain public terms in UI and user-facing text: "calculation", "workflow", "audit chain". Do not use internal metaphors (liquid memory, PABX, morphism, Darwinian, DNA) in UI text. Never write "guaranteed", "zero hallucination", "certified" or "Merkle proof" anywhere in code, UI or docs.
