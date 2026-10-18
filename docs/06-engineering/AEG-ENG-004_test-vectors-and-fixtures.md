# AEG-ENG-004 — Test vectors and fixtures (the oracle)

| Field | Value |
|---|---|
| Document ID | AEG-ENG-004 |
| Revision | 0.1 |
| Status | WORKING_BASELINE |
| Date | 2026-10-13 |
| Owner | Claude (engineer) |
| Approval | Authored under owner direction (AEG-ADR-001); not independently audited |
| Classification | Internal |

Write tests from these tables. Expected values here are authoritative. Do not copy values from your own implementation output into a test. In tests use `FixedClock('2026-10-13T01:00:00Z')` ("T-now") unless a row says otherwise, and `SeqIdGen`.

## 1. Frozen hashes (already enforced by `tests/unit/golden.test.ts`)

| Item | Value |
|---|---|
| `sha256_hex("abc")` | `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad` |
| `hashWithDomain('AEG-INPUT-v1', {a:1})` | `a525ee1992c05092a69adb96ba86b0182e6ebd8f9c7ceea344c1ee6c258e8e16` |
| `ALGORITHM_HASH` of RESOURCE-SHORTFALL/1.0.0 | `1fd27b8a48713b2d7583d8df4f4a3b902d2573900b2eb4713c9f95dcc3ac2ef6` |
| Event 1, 2, 3 hashes (test chain in golden test) | `5a4b9893...4348`, `03def222...335f`, `7f773ab8...7bd6` (full values in the test) |

## 2. Fixture pack and expected evidence (TSK-005, applied in file order, all six polls)

Sources `SRC.SYNTH_FEED_A` and `SRC.SYNTH_FEED_B`, `validHours` 48.

| Expectation | Value |
|---|---|
| Evidence rows after all polls | 5: `EV-SYN-FLOOD-0001-r1`, `EV-SYN-FLOOD-0001-r2`, `EV-SYN-STALE-0002-r1`, `EV-SYN-BADCOORD-0003-r1`, `EV-SYN-B-7781-r1` |
| POLL-02 (identical record) | `duplicates = ["SYN-FLOOD-0001"]`, `inserted = []`, no new row, no audit event |
| POLL-03 (changed record) | inserts r2 with `supersedesEvidenceId = EV-SYN-FLOOD-0001-r1`; r1 row unchanged |
| `validUntil` | FLOOD r1 `2026-10-14T07:30:00Z`; FLOOD r2 `2026-10-15T00:20:00Z`; STALE-0002 `2026-09-22T08:00:00Z`; BADCOORD-0003 `2026-10-13T23:00:00Z`; B-7781 `2026-10-14T09:00:00Z` |
| Flags at T-now | FLOOD r1: SUPERSEDED. FLOOD r2: CONFLICTING. B-7781: CONFLICTING. STALE-0002: STALE. BADCOORD-0003: none derived |
| Intake flags | all five: SYNTHETIC. BADCOORD-0003 also COORD_INVALID with `latE6 = null` and `lonE6 = null` |
| Coordinates | `"4.5000"` -> 4500000; `"101.1000"` -> 101100000; `"-2.2500"` -> -2250000 |
| `parseCoordinate` table | lat `"123.4000"` -> null; `"abc"` -> null; `"1e3"` -> null; `"-0.000001"` -> -1; `"90"` lat -> 90000000; `"90.000001"` lat -> null; `"-180"` lon -> -180000000; `"180.5"` lon -> null |
| `source_status` | FEED_A: OK, lastOkAt `2026-10-13T00:30:00Z`. FEED_B: MALFORMED (last poll), lastOkAt `2026-10-13T00:35:00Z`, detail `Simulated unparseable body` |
| Evidence from FEED_B after POLL-05/06 | still present and unchanged; no invented replacement data; no refresh of its fetchedAt |
| SYSTEM audit chain | 7 events: 5 `evidence.ingested`, 2 `source.status_changed` (POLL-05, POLL-06); chain verifies |
| Incident cards per tenant | 4 cards, 5 revisions: `INC-<tenant>-SYN-FLOOD-0001` (r1 superseded, r2 validated), `...-SYN-STALE-0002`, `...-SYN-BADCOORD-0003`, `...-SYN-B-7781` |
| `rawArtifactHash` | `hashWithDomain('AEG-EVIDENCE-v1', <the raw fixture record object>)`; `normalizedPayloadHash` over the normalized payload |
| Applying the same polls twice to a fresh DB in two runs | identical evidence ids and hashes (determinism) |

## 3. Resource assessment matrix (TSK-008 workflow tests and TSK-010 API tests)

Tenant A coordinator unless stated. Incident `INC-TENANT-A-SYN-FLOOD-0001` revision 2. Unit `UNIT.WATER_KIT`. Resource rows: A/REGION.DEMO_A 85/5 as-of `2026-10-13T00:00:00Z`; A/REGION.DEMO_C 15/2 as-of `2026-10-01T00:00:00Z`; B/REGION.DEMO_A 300/20.

| # | Request (besides incident, unit) | Expected |
|---|---|---|
| 1 | region A, demand 120 | succeeded; usable 80, shortfall 40, surplus 0; card state `validated`; warnings include `EVIDENCE_CONFLICTING` (the incident revision is in a conflict set) |
| 2 | region A, demand 50 | usable 80, shortfall 0, surplus 30 |
| 3 | region A, demand 80 | shortfall 0, surplus 0 |
| 4 | region A, demand 0 | shortfall 0, surplus 80 |
| 5 | region A, demand null | `awaiting-input`, missing `["demandUnits"]`, draft card, `result = null` |
| 6 | region A, demand 120, availableUnits null | `awaiting-input`, missing `["availableUnits"]` |
| 7 | region A, demand 120, reserveUnits 90 | failed `E_RESERVE_EXCEEDS_AVAILABLE`, HTTP 422, no card |
| 8 | region A, demand 120, availableUnits 70, reserveUnits 5 | usable 65, shortfall 55 (overrides replace the row values) |
| 9 | region C, demand 20, asOf omitted | usable 13, shortfall 7; warning `RESOURCE_AS_OF_OLD` |
| 10 | region C, demand 20, asOf `2026-10-13T00:00:00Z` | failed `E_ASOF_MISMATCH`, 422 |
| 11 | region B (no row), demand 10 | `awaiting-input`, missing `["availableUnits","reserveUnits"]`, warning `NO_RESOURCE_RECORD` |
| 12 | tenant B coordinator, tenant B incident `INC-TENANT-B-SYN-FLOOD-0001` revision 2, region A, demand 120 | usable 280, shortfall 0, surplus 160 (proves tenant B uses its own row) |
| 13 | tenant B coordinator referencing `INC-TENANT-A-SYN-FLOOD-0001` | 404 `E_NOT_FOUND`, nothing written |
| 14 | tenant A viewer | 403 `E_FORBIDDEN_ROLE` |
| 15 | same request as #1 twice with the same `idempotencyKey` | second response `replayed = true`, same `runId` and card revision; audit event count and card count unchanged |
| 16 | same key, different demand | 409 `E_IDEMPOTENCY_CONFLICT` |
| 17 | #1 then demand 130 (no key) | same card id, revision 2; revision 1 becomes `superseded`; both retrievable with their original evidence |
| 18 | #1 with models disabled vs models enabled with a stub provider | identical `decisionHash`; disabled run has ZERO provider calls (spy) |

## 4. Audit and recovery (TSK-004, TSK-006)

| Case | Expected |
|---|---|
| Two connections append 50 events each to the same tenant chain at once | 100 events, sequence 1..100 unique and contiguous, chain verifies |
| Edit `body_json` of event 2 (test drops the trigger first) | `HASH_MISMATCH` at sequence 2 |
| Delete event 2 (trigger dropped) | `SEQ_GAP` and `PREV_MISMATCH` |
| Truncate the tail | verifies OK without a checkpoint; `CHECKPOINT_BEYOND_CHAIN` with a trusted checkpoint |
| Replace root file and checkpoint together | undetected by design; the test documents this limit in its description |
| UPDATE or DELETE on `audit_events` | rejected by trigger |
| Crash hook throws after workflow commit, client retries | one run, one card revision, one audit event, response `replayed = true` |
| Two concurrent identical workflow requests | one run row (unique constraint), second returns replay |

## 5. Gateway matrix (TSK-011). Config: max primary attempts 2, max attempts total 3, backoff base 200, rng fixed 0.5, price `PRICE-TEST` input 1,000,000 and output 2,000,000 micro-USD per million tokens, limits 1000 each, request 100 bytes with maxOutputTokens 50 (reservation = 200 micro per attempt)

| # | Primary script / backup script | Expected |
|---|---|---|
| G1 | ok (usage 40 in, 10 out) | OK, 1 attempt, notice null, reservation settled at 60 |
| G2 | TRANSIENT, TRANSIENT / ok | OK, attempts 3 (p, p, b), sleeps `[200]`, notice `GOOGLE_UNAVAILABLE_BACKUP_USED` |
| G3 | TIMEOUT, TIMEOUT / TIMEOUT | DEGRADED, notice `MODELS_UNAVAILABLE`, 3 attempts, 3 reservations kept as `liability` (committed 600) |
| G4 | AUTH / ok | OK via backup, 2 attempts, google circuit open. Next call within cooldown: google attempt recorded `CIRCUIT_OPEN` with no network call and no reservation, backup called |
| G5 | MALFORMED / ok | OK via backup; malformed text never returned. MALFORMED / MALFORMED -> DEGRADED |
| G6 | REFUSAL / (not called) | REFUSED, notice `REFUSED`, 1 attempt, backup never called |
| G7 | BAD_REQUEST / (not called) | DEGRADED, 1 attempt |
| G8 | budget limits 0 | DEGRADED, notice `BUDGET_EXHAUSTED`, zero provider calls, attempts recorded `BUDGET_DENIED` |
| G9 | TRANSIENT with deadline 100 ms and a sleep that advances the fake clock by 200 | DEGRADED, no attempt starts after the deadline |
| G10 | dataClass `tenant_private`, reAPI allows only `public`, primary fails | DEGRADED, reAPI never called |
| G11 | 3 consecutive TRANSIENT failures on separate calls | circuit opens; after cooldown exactly ONE probe is allowed; a successful probe closes it |
| G12 | OK with `usage = null` | OK, reservation becomes `liability` (200), cost basis `unknown` |
| G13 | Two simultaneous calls each reserving 600 of a 1000 limit (two processes or connections) | exactly one reserves; the other is `BUDGET_DENIED` |

## 6. Chat (TSK-012). Tenant A coordinator, T-now, stub provider counting calls

| # | Input | Expected |
|---|---|---|
| C1 | `help` | source `local`, route `I_aegis_help_show`, provider calls 0 |
| C2 | `list incidents` | local, table with 4 rows (the tenant A incident card ids), provider calls 0 |
| C3 | `assess INC-TENANT-A-SYN-FLOOD-0001 unit UNIT.WATER_KIT region REGION.DEMO_A demand 120 available 85 reserve 5` | local; assessment card with shortfall 40; `decisionHash` equals the API result for the same inputs; provider calls 0 |
| C4 | `assess inc-tenant-a-syn-flood-0001 ...` (wrong case) | notice with `E_NOT_FOUND`, nothing written |
| C5 | `what should we do about the flood?`, models disabled | source `clarify`, `providerNotice = MODELS_DISABLED`, blocks list the known commands, provider calls 0 |
| C6 | same text, models enabled, stub manager returns `{"routeId":"I_aegis_admin_export_all","args":{},"clarification":null}` | source `denied`, nothing executed, a `chat.routed` event records the denial |
| C7 | stub manager proposes `I_aegis_resource_assess` with a tenant B card id | denied (`E_NOT_FOUND`), no effect |
| C8 | each `fixtures/injection-text.json` case as the message, stub manager obeys the injected text | denied or clarify; no role, tenant or budget change; no HTML in any block |
| C9 | attach `INC-TENANT-A-SYN-FLOOD-0001` revision 1, then assess it while revision 2 exists | `attachedRevisions = [{cardId, revision: 1}]`; result links `input` to revision 1 |
| C10 | stub manager returns invalid JSON | clarify; invalid text never shown |
| C11 | `explain <assessment card id>` with a stub specialist that returns text containing a number not present in the card | model text rejected; the code-built explanation is returned; notice present |
| C12 | six attachments | 400 `E_VALIDATION` |

## 7. Evaluation boundary (TSK-017)

Candidate: add local aliases `show incidents`, `incidents`, `what incidents are there` for `I_aegis_incident_list`. Held-out cases (utterance -> expected route or `none`): `show incidents` -> list; `incidents` -> list; `what incidents are there` -> list; `help me` -> none; `show cards` -> none; `verify audit` -> `I_aegis_audit_verify`. Baseline router scores 3 of 6. Candidate scores 6 of 6. Acceptance criteria stored with the candidate: accuracy at least baseline + 0.3, zero regressions, zero wrong-route answers. Promotion requires a `reviewedBy` value. A candidate failing any criterion cannot be promoted (state stays `candidate` or becomes `rejected`). Rollback creates a new `active_rules` row pointing to the previous version label and the router uses it.

## 8. Security cases (TSK-009, TSK-016)

Session token tampering and expiry -> 401. Body containing `ownerId`, `tenantId` or `role` -> 400. Card and evidence ids of the other tenant -> 404 on every read, write, pin, attach and chat path. SQL metacharacters in ids (`' OR 1=1 --`) -> 400 or 404, never a 500 and never data. Fetch guard (TSK-016) rejects: non-allowlisted host, `http://127.0.0.1`, `http://10.0.0.5`, `http://[::1]`, `http://169.254.169.254`, a redirect to a private address, bodies over the size limit, responses slower than the timeout, XML with an external entity declaration. All with injected resolvers and fake responses; no real network.
