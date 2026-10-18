# AEG-ADR-001 — Roles and worker model

| Field | Value |
|---|---|
| Status | accepted (owner direction in conversation 2026-10-13) |
| Requirement IDs | AEG-REQ-017, AEG-WO-001 |
| Supersedes | The development-role table in `AGENTS.md` (Claude = implementation) for the build phase only |
| Decision authority | Owner |

## Problem

`AGENTS.md` assigns implementation to Claude. The owner has decided to use a lower-cost coding model (Luna) for mass code generation, with Claude acting as engineer.

## Decision

| Role | Who | Responsibility |
|---|---|---|
| Owner | User | Product direction, release decisions, accounts, budgets, secrets |
| Engineer | Claude | Architecture, contracts, task cards, golden code, test vectors, review and acceptance of each task, rework instructions |
| Programmer | Luna | Implements one task card at a time, runs gates, reports honestly |
| Planner / auditor | Codex | Independent audit after build (unchanged from `AGENTS.md`) |
| Operator / verifier | Gemini | Runs operational scenarios from VVP-001 after an executable slice exists (unchanged) |

Development roles do not define runtime model identities (unchanged).

## Consequences

- A task is complete only after the engineer replies ACCEPTED. A passing gate is necessary, not sufficient.
- The programmer does not edit controlled documents. Build logging goes to `docs/06-engineering/AEG-LOG-002_build-log.md`. The engineer updates `HANDOVER.md` and prepares any new integrity snapshot.
- `npm run verify:docs` must stay green throughout the build. A failure means a baseline file was modified (drift) and must be reverted.
- Engineer review of the programmer is not an independent audit. Codex audit remains required before any assurance claim.
- No model may impersonate a human approver. Release approval stays with the owner.
