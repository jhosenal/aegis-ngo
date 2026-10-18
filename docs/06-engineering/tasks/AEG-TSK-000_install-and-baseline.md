# AEG-TSK-000 — Install and baseline

| Field | Value |
|---|---|
| Requirements | AEG-REQ-017 (reproducibility) |
| Depends on | none |
| Owned paths | `package-lock.json`, `docs/06-engineering/AEG-ADR-005_installed-versions.md`, `docs/06-engineering/AEG-LOG-002_build-log.md`, `records/evidence/` (runner only) |
| Read | `LUNA.md`, ENG-001 |
| Gate | `npm run gate -- TSK-000` |

## Goal
Make the shipped starter files install, typecheck and pass their 21 golden tests on your machine, and record the environment.

## Steps
1. Confirm `node --version` is 22 or newer. If not, STOP and report.
2. Run `git init` if there is no repository, then `git add -A` and commit `baseline before TSK-000`.
3. Run `npm install better-sqlite3 fastify @fastify/static zod`.
4. Run `npm install -D typescript tsx vitest @types/node @types/better-sqlite3`.
5. Run `npm run verify:docs`. It must pass. If it fails, STOP: it means a baseline file differs from the manifest.
6. Run `npm run typecheck` and `npm run test:unit`. All 21 tests must pass.
7. Do NOT edit `.gitignore` (it is in the baseline manifest and already ignores `node_modules/`, `dist/`, `data/`, `.env`, `*.db`). Nothing else needs ignoring.
8. Check port 8787 is free (PowerShell: `Get-NetTCPConnection -LocalPort 8787 -ErrorAction SilentlyContinue`). If busy, use the next free port from 8788 and note it. Never stop another process.
9. Create `docs/06-engineering/AEG-ADR-005_installed-versions.md` with a table of exact installed versions from `npm ls --depth=0`, Node version, OS, the chosen port. Create `docs/06-engineering/AEG-LOG-002_build-log.md` with a one-line header.
10. Run `npm run gate -- TSK-000`.

## Do not
Modify any shipped file. Do not try to fix a failing golden test: STOP and report.

## Done when
Gate prints PASS; the ADR-005 and build log files exist; commit made.
