# AEG-ENG-003 — Operations and task flow

| Field | Value |
|---|---|
| Document ID | AEG-ENG-003 |
| Revision | 0.1 |
| Status | WORKING_BASELINE |
| Date | 2026-10-13 |
| Owner | Claude (engineer) |
| Approval | Authored under owner direction (AEG-ADR-001); not independently audited |
| Classification | Internal |

## 1. Cast and channel

The owner relays between sessions. Luna has repository and shell access. The engineer (Claude) reviews what the owner uploads. Because the engineer cannot see the programmer's disk, evidence must travel as files: the gate evidence file, the build log entry and the changed source.

## 2. Task state machine

`NOT_STARTED` -> `IN_PROGRESS` -> `GATE_PASS` -> `ACCEPTED` (engineer) or `REWORK` (back to IN_PROGRESS).
A card is never ACCEPTED on the programmer's word. The engineer replies in this form:

```
TSK-NNN: ACCEPTED | REWORK
Defects (REWORK only):
D1 <file>: <what is wrong> -> <exact expected behaviour>
D2 ...
Next card: TSK-MMM
```

## 3. Start-of-session prompt for the programmer (paste this)

```
You are the programmer for the Aegis NGO repository. Read LUNA.md first and obey every hard rule.
Then do task card docs/06-engineering/tasks/<CARD FILE NAME> and nothing else.
Follow its steps in order. Run `npm run gate -- <TSK-ID>`. Append to the build log. Commit. Send the completion report. Stop.
If any instruction is missing, contradictory or impossible, stop and report instead of guessing.
```

Keep one task per session. Small models degrade with long context: start a fresh session for each card.

## 4. Build log entry (append to `docs/06-engineering/AEG-LOG-002_build-log.md`)

```
### TSK-NNN <title> — <UTC timestamp>
- Files created/changed: <list>
- Decisions (if any, with reason):
- Gate result: PASS/FAIL, evidence file: records/evidence/<file>
- Deviations from the card: none | <list>
- Open problems: none | <list>
- Status words: implemented / fixture-tested / live-tested(no) / pending(<items>)
```

Create the file in TSK-000 with a one-line header if it does not exist.

## 5. Completion report (send to owner and engineer)

```
Task: TSK-NNN <title>
Result: GATE PASS | GATE FAIL (paste the last 15 lines printed by the gate)
Evidence file: records/evidence/...
Files created: ...   Files modified: ...
Tests added: <count> in <files>
Deviations: none | ...
Not done / pending: ...
Cost or provider calls made: none
Exact next card: TSK-MMM
```

## 6. Engineer acceptance checklist

1. Gate evidence is a real file produced by the runner (exit codes present, Git HEAD present).
2. Only owned paths changed; no golden/contract/baseline file modified; `npm run verify:docs` green.
3. Required tests exist with the exact expected values from the card or the vectors document, and none are skipped.
4. Layering and purity rules respected (spot check imports, clock and randomness use).
5. Tenant isolation, strict schemas, no string-built SQL, no HTML from data.
6. Honest wording in code, UI and report (no "live" for stubs, no "guaranteed").
7. Build log entry present.

## 7. Parallelism rules

Two sessions may run at the same time only when their owned paths are disjoint and neither depends on the other. Allowed pairs after the dependencies are met: TSK-004 with TSK-003; TSK-013 with TSK-011; TSK-019 with anything that does not touch `src/providers/google.ts`. Never run two sessions on the same card. Merge by sequential commits on the same branch; resolve conflicts by re-running both gates.

## 8. Stop conditions (programmer must stop and report)

A golden test fails; a dependency cannot be installed; a card contradicts a contract file; a required value is missing (model id, price, key, URL); the same failure twice; a change outside owned paths seems necessary; any instruction asks for a real network call, a real spend or a real credential.

## 9. Evidence rules

`records/evidence/` is written only by `tools/run-gate.mjs`. Evidence is never edited. A corrected result is a new gate run. Not-run is never reported as pass. Stub transcripts are labelled stub. Integrity checks (hashes) never stand in for correctness tests.

## 10. Phase gates

- Phase 1 (local slice, cards TSK-000 to TSK-018): everything works offline with stub providers.
- Phase 2 (cards TSK-019 to TSK-021) is BLOCKED until the owner supplies the item named in each card. The programmer never starts a phase 2 card on its own.
- Before any public demo or submission, Codex audits and the owner approves. Prepared, approved and deployed are separate states.
