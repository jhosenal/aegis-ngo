# AEG-VVP-001 — Verification and acceptance plan

| Control field | Value |
|---|---|
| Document ID | AEG-VVP-001 |
| Revision | 0.1 |
| Status | WORKING_BASELINE |
| Date | 2026-10-13 |
| Owner | Codex — PM / architecture |
| Approval | Package creation authorized; proposal details tracked in DEC-001 |
| Classification | Internal working document |

Status: all product tests NOT RUN. The documentation verifier is separate from these product tests.

| Test | Procedure and expected result | Mode |
|---|---|---|
| AEG-TST-001 | Two independent product/tenant identities; attempts to read/write the other's cards/audit fail | Integration |
| AEG-TST-002 | Unknown formula version, missing unit, invalid number and null input rejected; valid version replay matches | Unit |
| AEG-TST-003 | Model proposes unknown/escalated route; engine denies without effect | Integration |
| AEG-TST-004 | Execute same registered task with providers disabled and enabled; decision payload equals, disabled run makes zero calls | Integration |
| AEG-TST-005 | Stale, conflicting, updated and incomplete evidence keep distinct visible states and original hashes | Integration/browser |
| AEG-TST-006 | Pin two revisions, attach one, reopen result; exact attached revision retained after edits | Browser |
| AEG-TST-007 | 1920x1080 and 390x844, resize, keyboard and mobile dock overflow; controls remain usable | Browser |
| AEG-TST-008 | Inject Google 429/503/timeout/bad JSON/auth error, reAPI failure and policy refusal; configured bounded outcomes observed | Integration |
| AEG-TST-009 | Two calls each larger than half remaining budget race; at most one reserves; retry/backup included; timeout liability retained | Concurrency |
| AEG-TST-010 | Independently verify 120/85/5 -> 80 usable, 40 shortfall; zero demand, surplus, negative, reserve>stock and unit mismatch | Unit |
| AEG-TST-011 | Crash after commit/before response and after uncertain external effect; retry preserves one result/action and reconciles uncertainty | Recovery |
| AEG-TST-012 | Alter payload/file, remove/reorder event or replace root without valid checkpoint; verifier detects affected trust failures | Integrity |
| AEG-TST-013 | Modified ownerId/card reference/session and injected feed instructions cannot cross access boundaries | Security |
| AEG-TST-014 | Candidate evaluated against held-out cases; failed promotion blocked, prior version restorable | Evaluation |
| AEG-TST-015 | Feed unavailable/malformed/duplicated/redirects to private address; no invented facts or forbidden fetch | Integration |
| AEG-TST-016 | Hosted redeploy and concurrent writes retain committed data/audit without split histories | Cloud; pending storage choice |
| AEG-TST-017 | Every release requirement links to implementation and executed evidence; missing evidence blocks release | Review |
| AEG-TST-018 | Bounded real primary/backup calls show actual model response validation, usage and uncertain billing handling | Live; pending account/budget |

## Evidence record

Use AEG-EVD-NNN records with requirement/test IDs, timestamp, actor, environment, commit/artifact hash, command, exit code, fixture/input hash, expected/actual result and attached logs/screenshots.
Separate stub tests, live calls and manual observations. Capture failures, not just successes.
Measure local route coverage, call count, cost basis, p50/p95 latency for a defined corpus and response-validation rejection rate. Do not assert performance targets from an unmeasured example.
Never use an LLM assertion as the sole oracle for deterministic math, permissions or hash verification.

## Review criteria

Any unresolved wrong calculation, permission bypass, cross-product leakage, duplicate side effect or budget overspend is release-blocking for the affected functionality.
A warning about missing live/cloud tests may be acceptable for a clearly labelled local prototype; it is not acceptable as evidence of a production-ready deployment.


