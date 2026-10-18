# AEG-REQ-001 — Requirements and acceptance

| Control field | Value |
|---|---|
| Document ID | AEG-REQ-001 |
| Revision | 0.1 |
| Status | WORKING_BASELINE |
| Date | 2026-10-13 |
| Owner | Codex — PM / architecture |
| Approval | Package creation authorized; proposal details tracked in DEC-001 |
| Classification | Internal working document |

All requirements below are unimplemented at handover. Mapped tests are in VVP-001; no row is a recorded pass.

| Requirement | Required behavior | Acceptance / test |
|---|---|---|
| AEG-REQ-001 | Independent product identity, storage and audit namespace | Cross-product access rejected; AEG-TST-001 |
| AEG-REQ-002 | Registered, versioned formulations with input/output types, units, assumptions and lexicon | Invalid or unknown versions refused; AEG-TST-002 |
| AEG-REQ-003 | Registered workflow composition and permission-checked route delegation | Arbitrary route/tool execution rejected; AEG-TST-003 |
| AEG-REQ-004 | Routine structured workflow executes without model calls | Provider adapters disabled; same decision payload; AEG-TST-004 |
| AEG-REQ-005 | Evidence retains source identity, timestamps, original hash and transformation version | Conflicting/stale/missing data visibly distinguished; AEG-TST-005 |
| AEG-REQ-006 | Nested cards retain traceable input/result relationships | Reopen parent/child; separate pinned and attached context; AEG-TST-006 |
| AEG-REQ-007 | Desktop 2:1 workspace/chat and mobile card dock | Browser tests at 1920x1080 and 390x844; keyboard/touch usable; AEG-TST-007 |
| AEG-REQ-008 | Bounded role calls; Google primary and reAPI backup | Fault-injection matrix, no permission expansion; AEG-TST-008 |
| AEG-REQ-009 | Atomic budget reservations across calls, retries and provider switching | Parallel calls cannot double-spend remaining budget; AEG-TST-009 |
| AEG-REQ-010 | Resource arithmetic is pure code with unit/region/time checks | 120 demand, 85 stock, 5 reserve -> 40 shortfall; invalid inputs fail; AEG-TST-010 |
| AEG-REQ-011 | Durable idempotent workflow state and recoverable effects | Crash/retry creates no duplicate committed action; AEG-TST-011 |
| AEG-REQ-012 | Own append-only integrity evidence and independently verifiable snapshot | Tampering/deletion/reorder detectable against trusted checkpoint; AEG-TST-012 |
| AEG-REQ-013 | Server-side tenant and role authorization | Caller cannot change owner or escalate route through a card/model; AEG-TST-013 |
| AEG-REQ-014 | Measured improvements are evaluated before promotion | Candidate cannot overwrite active rules; rollback works; AEG-TST-014 |
| AEG-REQ-015 | Data-source failure produces explicit degraded state | No invented replacement data; recovery/dedup tested; AEG-TST-015 |
| AEG-REQ-016 | Durable cloud persistence precedes production claim | Redeploy/restart/concurrent-writer tests on selected storage; AEG-TST-016 |
| AEG-REQ-017 | Requirements, implementation, tests, audit and artifact are traceable | SDLC evidence references exact build/snapshot; AEG-TST-017 |
| AEG-REQ-018 | Live provider use is observable and bounded | Record actual provider attempts, tokens/cost status and outcome; AEG-TST-018 |

Priority: REQ-001 through 013, 015 and 017 support the local slice. REQ-014 begins with a candidate registry/evaluation contract, not automatic learning. REQ-016 and live portions of 018 are later deployment/provider gates.

Functional acceptance does not establish field suitability. Humanitarian operational policies must be reviewed with an authorized organization before real-world action.


