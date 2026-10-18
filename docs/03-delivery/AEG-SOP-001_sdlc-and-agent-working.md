# AEG-SOP-001 — SDLC and agent working procedure

| Control field | Value |
|---|---|
| Document ID | AEG-SOP-001 |
| Revision | 0.1 |
| Status | WORKING_BASELINE |
| Date | 2026-10-13 |
| Owner | Codex — PM / architecture |
| Approval | Package creation authorized; proposal details tracked in DEC-001 |
| Classification | Internal working document |

## Governance

Use OAG's evidence-driven lifecycle: PLAN -> BUILD -> TEST -> REVIEW -> DEPLOY/OPERATE.
This is a project-tailored procedure. Scores support review; missing mandatory evidence cannot be offset by a score.
Codex coordinates and audits, Claude implements, Gemini operates/verifies, user owns product direction and material release decisions. Sensory Loo is a confirmed team member; specific acceptance accountability remains to be assigned.
A model cannot impersonate a human approver. Codex's review of its own design is not fully independent; record that limitation and seek another reviewer for critical design claims.

## Gate evidence

| Gate | Required Aegis evidence | OAG reference artifact names |
|---|---|---|
| PLAN | Charter, requirements, architecture, decisions and traceability | architecture_decision.md; requirements_trace.md |
| BUILD | Buildable source, dependency lock, migrations, registry entries and provenance | sdlc_structure; build_output |
| TEST | Executed assertions, failure scenarios and schema validation | test_results; schemas_verified |
| REVIEW | Findings, resolutions, residual risks and permission/integrity review | gate_review; way_audit |
| DEPLOY | Exact artifact, durable storage evidence, rollback and release approval | deployment_artifact; merkle_audit; dna_commit |

OAG inspected wizard reference thresholds: PLAN 70, BUILD 75, TEST 80, REVIEW 80, DEPLOY 85. These are source observations, not automatic Aegis approval criteria.
An integration adapter can map stable Aegis documents/evidence to required OAG artifact names. Do not create duplicate uncontrolled copies just to match names.

## Work cycle

1. Read current handover and claim the work order/owned paths in LOG-001.
2. Identify relevant requirements and reference skill. Inspect current source state read-only.
3. Implement in Aegis; record adaptations and dependency origins in provenance.
4. Execute meaningful tests. Capture actual command, exit code, environment, artifact version and output.
5. Hand implementation evidence to Gemini for operational scenarios and Codex for audit.
6. Resolve findings, rerun affected checks, record remaining issues honestly.
7. Prepare a new integrity snapshot and reviewable release. Register with OAG only through the product's designated lifecycle route when configured/authorized.
8. Update handover with exact next task and blockers.

## Shared-agent discipline

One owner per changed path at a time; small work orders and clear status. Use isolated Git branches/worktrees if useful after repository initialization.
Do not assume external agents have received messages: this package is the handover channel until the user opens it in their sessions.
Use outcomes, reproducible evidence and requirement IDs. Do not report imagined tests as executed.
Keep required evidence immutable after release; corrected evidence is a new record with a supersedes reference.

## Known OAG integration cautions

Prior source inspection identified force/default-pass behaviors in the wizard and gate registration that accepts supplied roots. A recorded gate row alone does not prove a successful test or recomputed artifact.
Aegis must explicitly fail missing/unknown evidence, disallow force bypass for release, persist failures visibly and independently recompute claimed hashes.
OAG's core sealing skill contains version/ledger ordering details that must be reconciled with current canonical rules before actual core mutation. No core seal is required just to create this independent documentation package.

## Completion report

Report: work order; changed paths; requirement coverage; executed tests and evidence paths; measured cost/calls if any; findings; pending external/live checks; artifact/snapshot ID; next agent/action.


