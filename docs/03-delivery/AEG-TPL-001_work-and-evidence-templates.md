# AEG-TPL-001 — Work and evidence templates

| Control field | Value |
|---|---|
| Document ID | AEG-TPL-001 |
| Revision | 0.1 |
| Status | WORKING_BASELINE |
| Date | 2026-10-13 |
| Owner | Codex — PM |
| Approval | Templates for the authorized handover |
| Classification | Internal |

Use stable IDs, fill actual values, and remove unused optional fields. An empty template is not evidence.

## Architecture decision record

Filename: AEG-ADR-NNN_<decision-title>.md
Fields: ID; date; author; status (proposed/accepted/superseded); requirement IDs; problem; considered options; chosen design and reason; consequences; verification needed; supersedes; decision authority.
Record ordinary implementation decisions without stopping for approval. Escalate decisions that change user intent, external commitments or release authority.

## Executed verification record

Filename: AEG-EVD-NNN_<test-title>.md
Fields: ID; test/requirement IDs; actor; timestamp; environment; exact source/build hash; input/fixture hash; command/steps; expected behavior; observed behavior; exit code; result (pass/fail/blocked/not-run); evidence paths; limitations.
Never mark not-run as pass. Redact secrets while retaining enough information to reproduce the finding.

## Audit finding

Filename: AEG-FND-NNN_<finding-title>.md
Fields: affected requirement and artifact; severity; reproduction; observed/expected behavior; impact; proposed remedy; owner; resolution evidence; reviewer disposition.
A resolved finding points to a new tested artifact. It does not rewrite the old evidence.

## Release record

Filename: AEG-REL-NNN_<release-title>.md
Fields: artifact/version; included requirements; executed evidence; unresolved findings; manifest/root; trusted checkpoint/signature; target; migrations; recovery/rollback procedure; approving actor and authorization; actual deployment result.
Prepared, approved and deployed are separate states.

## Agent completion handover

Work order and role:
Completed behavior:
Changed files and source provenance:
Commands actually run:
Results and evidence:
Costs/provider attempts:
Outstanding risks and decisions:
Current artifact/manifest:
Next agent and exact next action:

