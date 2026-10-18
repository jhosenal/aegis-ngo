# AEG-ADR-006 — Composition numeric policy, rounding and lifecycle storage

| Field | Value |
|---|---|
| Document ID | AEG-ADR-006 |
| Revision | 0.3 (revised under A0005: R1 to R7 and the lifecycle integration conditions) |
| Status | PROPOSED — revised draft; requests Astra's review of the lifecycle adapter before any integration |
| Date | 2026-10-13 |
| Author | Claude Sonnet 5.5, engineer |
| Requirement IDs | AEG-REQ-002, AEG-REQ-010, AEG-REQ-017 |
| Refines | AEG-CON-001, AEG-ADR-003, AEG-ADR-004; implements the design of A0002 through AEG-CON-003 rev 0.3 |
| Frozen and untouched | `AEG.F.RESOURCE-SHORTFALL/1.0.0`, `src/registry/formulations/resource-shortfall.ts`, canonical JSON v1, historical hash domains |
| Evidence | proofs of concept in `research/engineer/` (see `results.txt` for the count, versions and exit code); they are isolated and not wired into the application. Measured budgets: `bench-results.json`. |

Revision 0.1 contained two errors that A0004 found and that are corrected here: it rounded every demand up and every supply down (D1), and it claimed that lifecycle metadata could live in `spec_json` through the whole life of a formulation (D2). Both claims are withdrawn.

## Problem

A0002 asks for composed formulations over exact arithmetic, a defined rounding policy, safe unit conversion, and a richer lifecycle (candidate, evidence-reviewed, implementation-tested, approved-for-specific-use, active, deprecated). The existing system has four registry states enforced by a database CHECK, a trigger that makes an active row's definition immutable, a frozen shortfall function that accepts integers from 0 to 1,000,000,000, and canonical JSON v1, which serializes safe integers and strings but understands no number semantics.

## Decision 1 — Numeric representation and typed encoding (D4)

1. **Exact arithmetic only in the common core.** Integers and rationals over `BigInt`. Never `Number`, `parseFloat` or a binary float to reduce, compare or multiply. A formulation that needs exp, log, trig or pow is an empirical model and stays held; if ever activated it needs a pinned runtime, a stated tolerance and a threshold-boundary policy, and it hashes rounded canonical values.
2. **A nonnegative rational field is the string `n/d`** with `n >= 0`, `d > 0`, `gcd(n, d) = 1`. Zero is exactly `0/1`. A whole value is `n/1` in a rational-typed field. Rejected: denominator zero, a leading plus, leading zeros, whitespace, an exponent, a decimal point, negative zero, and any non-reduced form (`2/4`).
3. **A signed rational is a separate declared type** (`-n/d`, with `-0/1` rejected). Positive-only numerators would wrongly exclude zero rates, so the unsigned type admits zero and the signed type exists only where a field can be negative.
4. **An integer field has exactly one encoding: a safe JSON integer.** `5`, `"5"` and `"5/1"` are three different spellings and an integer field accepts only the first; a rational field accepts only the string form.
5. **External adapters may normalize equivalent spellings** (`2/4`, `0.4`, `3`) with a strict normalizer; the canonical internal record accepts only normalized values.
6. **Bounds before arithmetic, one rule at every entry point.** At most 40 digits per component of a value that enters from outside: a fraction counts the digits of the numerator and the denominator separately, a decimal counts its integer and fractional digits TOGETHER; all are counted raw (leading zeros included) before any BigInt conversion. The same limit applies to the strict internal parser, the external normalizer and the decision-table interval parser. Reduced results up to 120 digits per component may be persisted and replayed, through a **distinct persisted-result validator** with the same strict grammar and its own 120-digit limit (the 40-digit parser cannot read them, by design). The raw temporary before reduction is bounded at 240 digits (twice the result bound), so multiplying two result-sized operands is allowed only if the reduced result fits. An **operation budget** (a meter) refuses further work with `BUDGET_EXCEEDED` and never rounds or clips. Measured budgets are in the table under Decision 6; they are proposals for the implementation card, not derived scientific limits.
7. **Composition envelope and hash domain.** Canonical JSON v1 stays unchanged and is reused. It does not reduce fractions, so normalization happens before hashing, and the serializer alone is not claimed to make an identity. A new additive hash domain `AEG-COMP-v1` covers a **composition envelope**: schema version, numeric policy id, units, the graph id, and for every node its `nodeId`, formulation id, version, definition hash and implementation hash, plus the typed edges. No historical domain (`AEG-EVT-v1`, `AEG-INPUT-v1`, `AEG-RESULT-v1`, `AEG-PAYLOAD-v1`, `AEG-EVIDENCE-v1`) changes.

## Decision 2 — Rounding (replaces the blanket rule; D1)

1. **Exactness through composition.** Quantities stay exact rationals from node to node. Nothing is rounded because a node ended.
2. **Ceiling is for genuinely indivisible requirements at a declared boundary:** the number of facilities, the number of containers or packs, at the specifically declared final allocation or packing step, rounded once after aggregation.
3. **Deductions first, exactly.** Reserve, unusable and other-allocation deductions are computed exactly before any permitted rounding. Rounding individual subtractions separately gives a different, wrong answer (vector below).
4. **At the frozen adapter** a quantity is converted to exact registered integer subunits, or the adapter reports `NOT_REPRESENTABLE` or `OUT_OF_RANGE`. There is no unrecorded ceiling or floor.
5. **A conservative envelope is a separate, labelled policy output.** Under an organizational policy that is selected separately, a planning envelope (demand rounded up, supply rounded down at a stated scale) may be returned **beside** the exact values. It carries `policyId`, version, the original values, the rounded values, the scale, the reason and the rounding deltas. It never overwrites observed stock and is never called the exact gap.
6. **Why the blanket rule was wrong.** With exact demand and supply both 2/5 L the exact gap is zero. Ceiling of demand and floor of supply to whole litres gives 1 L, a gap that does not exist. For nonnegative D and S at the same scale, `max(0, ceil(D) - floor(S)) >= max(0, D - S)`, which is the only claim the envelope can make; it does not prove the policy safe for every formula or decision.

Proof-of-concept results (`research/engineer/rational.test.ts`, all passing):

| Vector | Result |
|---|---|
| D = S = 2/5 L | exact gap `0/1`; exact mL conversion 400 and 400; the real frozen function returns shortfall 0 |
| separate whole-litre rounding of the same | envelope 1; shown to be at least the exact gap and labelled, not the gap |
| D = 6/5, S = 11/10 | exact gap `1/10`; in 100 mL subunits 12 − 11 = 1 |
| 2/5 + 2/5 + 1/5 | 1 before packing; any partition of the same total gives the same result; ceiling per part would give 3, once after aggregation gives 1 |
| 1/3 L to mL | exact value `1000/3` but not a whole number: `NOT_REPRESENTABLE`, not rounded |
| above 1,000,000,000 after conversion | `OUT_OF_RANGE`, never clipped |
| 2.5 L on hand, 0.3 L protected, 0.3 L reserved elsewhere | exact usable `19/10`, floored once to 1 L at the boundary; rounding each term separately gives 0 |

## Decision 3 — Unit conversion and dimensions (corrected)

1. **Exact conversion and representability are different checks.** Multiplying a rational by a smaller-unit factor is arithmetically exact but does not always give an integer: one third of a litre is `1000/3` millilitres. A conversion to integer subunits succeeds only when the exact result is a whole number.
2. **Converting to a larger unit** is the same check in the other direction.
3. **Dimension is not a label.** Units carry dimension vectors (length, mass, time, count). Litres and m³ are volume and convert; m² is area; kg/m² is areal mass; Pa is pressure. A formula is checked by carrying dimensions through it. A flow summed with a stock, an area added to an areal mass, or a mass load added to a pressure is a registration error (`research/engineer/units-and-tables.test.ts`).
4. The frozen shortfall function receives only integers in 0..1,000,000,000 with identical unit, region and as-of on all three quantities, as ADR-003 requires.

## Decision 4 — Lifecycle storage and enforcement (revised; D2)

**What was wrong.** The trigger `formulation_active_immutable` blocks any change to `spec_json`, the algorithm hash, the version or the id when the old state is `active`. A transition that writes `state = 'deprecated'` and a new `spec_json.lifecycle` in one update is therefore rejected; a state-only update is allowed and correctly stops execution but leaves any embedded stage saying `active`. The registry reader also expects the stored definition's status to equal the row state. Reproduced against the real migrations in `lifecycle.test.ts`. The trigger protects an active row, not the row for its whole life: after deprecation the spec can be edited, so deprecating, editing and reactivating must be refused by the lifecycle layer, not left to the trigger.

**Design.** Definitions stay immutable. Lifecycle is a separate, append-only record.

1. **Registry unchanged.** `formulation_registry` keeps its four states, its CHECK and its trigger. Approved definitions are never edited.
2. **New additive tables (a migration to be proposed and reviewed; rehearsed on disposable databases in `migration.test.ts`):**
   - `formulation_lifecycle_events`: append-only (update and delete triggers abort), one row per transition, hash-chained (`AEG-LIFE-v1`), with the action, from and to stage, the approved use, the scope, approver, time, expiry, **definition hash, dependency hash and implementation hash**, an evidence reference, and the previous and own event hash.
   - `formulation_lifecycle_legacy`: the rows that were already active when lifecycle events were adopted (the existing shortfall formulation), recorded with their definition hash so they keep running for the existing planning use and cannot be used for `OPERATIONAL`.
3. **One authoritative effective stage:** the `to_stage` of the latest event; for a legacy row adopted from the allowlist (item 10), `active` for exactly the reviewed use and scope; for a row with no event and no adoption record, `candidate`, whatever the registry row or `spec_json` claims.
4. **Registry state follows the stage by a state-only update** in the same transaction (stage to state: candidate and evidence-reviewed to `candidate`; implementation-tested, approved-for-specific-use, suspended and revoked to `tested`; active to `active`; deprecated to `deprecated`). The existing trigger allows this and the existing reader refuses anything not `active`.
5. **Approvals are bound to hashes.** Each stage records the definition, dependency and implementation hashes it applies to. An advance whose hashes differ from the previous stage's is `STALE_APPROVAL`. Changing a candidate's inputs invalidates the earlier evidence.
6. **Transitions are transactional and validated:** one stage forward at a time for promotion; `approved-for-specific-use` needs a named use, a scope and an expiry; `active` needs an unexpired approval for a named use.
7. **Stopping is immediate and revocation is final.** Suspension, revocation and deprecation are allowed from any non-terminal stage in one step, with the evidence preserved. **Suspension keeps the stage it came from** (`prior_stage`) and reinstatement returns only to that stage, so suspending before first activation can never manufacture an active state. **Revocation and deprecation are terminal**: a revoked or deprecated version cannot be suspended, reinstated or re-approved, and a new version is required. This closes the sequence active, revoke, suspend, reinstate (finding R1). Reinstatement after suspension needs unchanged hashes and an unexpired approval.
8. **Checked on every execution, through one guard:** `authorizeExecution` verifies the whole event chain first (and compares its head with a trusted external checkpoint, so truncation is detected), then re-checks the stage, the registry state, the three hashes (the current dependency and implementation hashes come from **trusted code**, never from the caller), expiry against the **trusted clock**, the approved use against the requested use, and the **full scope**: tenant, purpose, resource, jurisdiction, validity domain and action. Corruption or truncation fails closed: every authorization and every transition is refused. The cost of the full walk is measured (Decision 6); an incremental, checkpointed verification is required before integration.
9. **Reconciliation** reports any disagreement between registry state, lifecycle record, definition hash and chain. It is a diagnostic; it is not the mandatory safeguard, which is item 8.
10. **Legacy adoption is an explicit, reviewed, immutable, one-time allowlist** (finding R2). `adoptLegacy` takes a reviewed constant of exact ids, versions, definition, implementation and dependency hashes, use and scope. A row that is not listed, whose definition differs from the reviewed hash, that is not active, or that already has lifecycle events, is refused. The adoption table and a seal record are immutable (update and delete triggers), adoption can run once, and later rows can never be adopted. A legacy row keeps only the authority the allowlist states; there is no implicit universal PLANNING grant.
11. **Trust and runtime validation.** Callers cannot pass the clock or the hashes. A `Trust` object supplies the clock, the resolved bindings, an authenticated-writer check (a free-text approver name proves nothing) and the optional chain checkpoint. Every input is validated at runtime (strict schemas for actions, uses, scopes, identifiers, hashes), and instants must be canonical UTC `YYYY-MM-DDTHH:MM:SSZ` compared as numbers, never as strings. Authenticated event writers and where the checkpoint is stored (outside the database) are implementation decisions for the card.
12. **Check-then-act.** `guardedRun` performs the authorization and the consequential work in one immediate transaction, so a stop committed before the work blocks it; an optional fence refuses a run whose lifecycle revision changed since planning. The revision that authorized each run is recorded in an append-only run table, one row per member for a composition.
13. **Adapter over the real registry reader (the frozen definition is never edited).** The real reader requires the stored definition status to equal the row state. Policy: a lifecycle-managed formulation is registered with the stored status `candidate` and that definition is never edited. After promotion the real reader fails closed (`E_INTERNAL`, safe but unusable), so the adapter `getAuthorizedFormulation` is the only path: it runs the full guard, validates the stored definition against its row and the definition-time status policy, and returns a copy carrying the effective state. A legacy row is still read with the real reader, untouched. In production the adapter needs an additive export of the definition parser or to live beside it; the proof of concept validates the same fields. Demonstrated with real-shaped definitions, the real seeder and the real reader in `lifecycle.test.ts` (promotion, suspension, legacy read, reinstatement).
14. **Migration rehearsal** (`migration.test.ts`, disposable in-memory databases, real migrations): the upgrade adds only the four lifecycle tables and leaves every registry byte unchanged; applying it twice changes nothing; an upgrade that fails part-way leaves the database exactly as it was; replay rebuilds the lifecycle, the chain and the authorization from the registry definitions plus the ordered events, and a state-only resync reproduces the registry states; rollback is clean only while no lifecycle record exists and is refused afterwards (fix forward), because the lifecycle has by then changed registry states.

Demonstrated in `research/engineer/lifecycle.test.ts` (14 tests, real migrations and real trigger, in-memory database only): metadata-only activation refused (a `spec_json` that claims active, and a bare state update); skipped stages refused; state and spec mismatch and stale approvals refused; expiry, dependency and implementation changes refused at execution; immediate suspend, reinstate, revoke and deprecate; the deprecate, edit, reactivate workaround refused; the event table append-only and a tampered chain detected; legacy rows adopted for PLANNING only.

**What stays unproven:** this is a proof of concept on an in-memory database. The migration, the reader change and the lifecycle adapter are implementation work for a reviewed card, and Astra reviews the adapter's consistency before integration.

## Decision 5 — Allowed use is a ceiling, intersected with scope (D3)

`DEMO < PLANNING < OPERATIONAL` is a maximum-use ceiling, never above any required dependency's approval or the composition's own. Effective permission is the **intersection** of tenant, resource, purpose, jurisdiction, model validity domain, time or expiry and action permissions across the declared transitive dependency set plus the composition. An empty intersection, a missing or revoked approval, or an expired one gives no authorized execution for that use. The composition has its own grant **bound to the exact composition identity**, and the identity covers the nodes, the typed edges, the external bindings, the **predeclared exclusion policy** and the **resolved dependency closure** (nested dependencies from the trusted registry, with their definition hashes), so excluding a dependency or changing a nested one changes the identity and invalidates the grant (finding R3). An exclusion may not remove a dependency that feeds an executing node. One guard (`authorizeComposition`) checks the composition grant, every member of the closure through the lifecycle guard with the full scope, and the trusted definitions, and records every member's revision atomically with the run. A restrictive dependency cannot be dropped after its output is seen; an unused optional branch must be excluded by the graph's validated dependency policy beforehand. An `OPERATIONAL` label grants no dispatch, clinical or spending authority; actions are authorized separately. Public data is not automatically approved for operational use, and a high provenance grade does not stand in for permission. Tested in `composition.test.ts`.

## Decision 6 — Measured budgets (proposals for the implementation card)

Measured once on the engineer's Windows 11 machine, Node 22.19 (`research/engineer/bench.ts`, `bench-results.json`). They are single runs, not a statistical study, and are given so the limits are proposed from evidence.

| Resource | Measured | Proposed limit and overflow behavior |
|---|---|---|
| Event-chain verification (full walk, every authorization) | 100 events 1 ms; 1,000 events 20 ms; 4,000 events 75 ms | Full walk allowed up to 2,000 events. Beyond that, incremental verification from a trusted checkpoint is required before integration. Overflow: refuse (fail closed), never skip. |
| Event writes (each re-verifies the chain) | 1,000 events 8 s in total, 4,000 events 144 s in total: quadratic | The write path must verify only the new tail against the last verified head, with periodic full verification. Today's quadratic behavior is a finding, not an acceptable design. |
| Exact rational operations per millisecond | 10 digits: add 246, mul 526; 40 digits: add 122, mul 260; 120 digits: add 49, mul 39 | Operation budget 100,000 per composition run (about 0.4 s at 40 digits, about 2.5 s at 120 digits). Overflow: `BUDGET_EXCEEDED`, no result. |
| Graph validation | 1,000 nodes 5 ms; 5,000 nodes 24 ms | At most 1,000 nodes, 4,000 edges and depth 64 per composition by default; larger only with a reviewed budget. Overflow: registration error. |
| Decision-table partition enumeration | about 270 cells per millisecond: 194,481 cells 0.6 s; 707,281 cells 2.6 s | At most 1,000,000 cells for an exhaustive proof. Overflow: `NOT_PROVEN` with a retained, reproducible 10,000-cell sample labelled as tested coverage. |

Nothing is rounded or clipped to fit a budget.

## Alternatives considered

| Option | Why not chosen |
|---|---|
| Round every demand up and every supply down | Invents gaps (2/5 vs 2/5 gives 1); replaced by exactness plus a labelled envelope |
| Put the whole lifecycle in `spec_json` | Blocked by the trigger on active rows; metadata is not an enforced lifecycle |
| Extend the registry enum and CHECK | Edits a frozen contract; the event table achieves the lifecycle without it |
| Binary floats with a tolerance | Not identical across engines; hides rounding; fails canonical JSON v1 |
| Strict one-step-forward only | Delays stopping an unsafe capability |

## Consequences

- No frozen file, golden vector or historical hash domain changes. New work is additive: two tables with triggers, an adapter over the existing reader, and pure `BigInt` modules.
- Independent vectors can be checked by hand with fractions.
- The envelope policy, the table migration and the digit and size limits each need a decision or a reviewed card before implementation.

## Requests for disposition

1. Approve the additive lifecycle migration (four tables with their triggers) and the adapter as implementation card work, after Astra reviews the adapter's consistency, including the definition-time status policy and the additive parser export.
2. Approve the additive hash domains `AEG-COMP-v1` (composition) and `AEG-LIFE-v1` (lifecycle events).
3. Confirm the digit limits (40 per component for input, 120 for persisted results, 240 raw temporaries) and the measured budgets in Decision 6, or replace them.
4. Confirm the legacy allowlist mechanism, and supply or approve the reviewed allowlist entry for the frozen shortfall row (exact hashes, use and scope).
