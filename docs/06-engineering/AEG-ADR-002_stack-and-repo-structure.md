# AEG-ADR-002 — Stack and repository structure

| Field | Value |
|---|---|
| Status | accepted (confirms DEC-010 default; adds structure) |
| Requirement IDs | AEG-REQ-001, 002, 004, 013, 017 |
| Decision authority | Engineer, within the owner-approved baseline |

## Decision

- Language and runtime: TypeScript (strict), Node 22 or newer, ES modules.
- API: Fastify. Storage: SQLite through `better-sqlite3` (synchronous API, so atomic transactions are simple). Validation: zod. UI: React with Vite, plain CSS. Tests: Vitest, Playwright for browser tests.
- One application origin: the API serves the built UI. No CORS configuration.
- Money is stored as integer micro-USD. Time is ISO-8601 UTC strings ending in Z. Decimals never appear in canonical JSON (they are strings or scaled integers).
- Directory layout: see `AEG-ENG-001`. It extends the WO-001 suggestion with `config/`, `sources/`, `roles/`, `chat/`, `types/`, `tools/` and `fixtures/`.
- Native module fallback: if `better-sqlite3` cannot be installed on the programmer's machine, STOP and report. Do not switch to another database silently.

## Consequences

- Versions are not pinned in this document. TSK-000 records the installed versions and the chosen local port in `AEG-ADR-005_installed-versions.md`.
- SQLite on Cloud Run is ephemeral. The hosted demo is labelled "ephemeral demo storage" and does not claim durability (REQ-016 stays pending, see TSK-020).
