# AEG-PLN-001 — Formulation and SOP rework: WBS and plan

| Field | Value |
|---|---|
| Document ID | AEG-PLN-001 |
| Revision | 0.3 (revised under A0005) |
| Date | 2026-10-13 |
| Author | Claude Sonnet 5.5, engineer and coordinator |
| Responds to | A0001 (review), A0002 (composition contract), A0003 / AEG-WO-002 (assignment) |
| Status | ACCEPTED as the working organization (A0004). In progress: Luna batch 1 is done and verified; ADR-006 and CON-003 are revised under A0004; source verification (1.2.3) and the truth tables (1.4.1) are not started. |

Structure follows the PMI practice of a deliverable-oriented work breakdown structure: the 100% rule (every deliverable in the assignment appears exactly once and nothing outside it appears), a WBS dictionary for each work package, explicit dependencies, responsibilities, a risk register, acceptance criteria and change control. Effort is given as relative size (S, M, L), not dates, because the work is sequenced by decisions and reviews, not by a calendar.

## 1. Objective, scope and exclusions

**Objective (A0003):** replace the seven-domain proposals with source-backed, composable formulations and complete SOPs, with independent tests and explicit authority limits. Completion is not "seven files exist".

**In scope:** source dossiers, contracts and lexicon, SOP truth tables, independent vectors, and implementation task cards prepared after review.

**Out of scope (A0003 boundaries):** activating any hazard or clinical formula, paid model calls, credentials, deployment, automatic evacuation or dispatch, editing the original inbox proposals or another agent's files.

**Fixed constraints:** `AEG.F.RESOURCE-SHORTFALL/1.0.0` and its frozen limits stay unchanged; baselines and golden contracts are not rewritten; Astra owns formulation semantics and SOP authority; the owner approves; domain-expert decisions are requested, never assumed.

## 2. Roles (RACI)

R = does the work, A = accountable and decides, C = consulted, I = informed.

| Role | Who | Part in this plan |
|---|---|---|
| Owner | the user | decides product authority and use, scope and priorities, and any activation; supplies domain experts and keys |
| PM and formulation reviewer | Astra (Codex) | decides the engineering review disposition, formulation semantics and SOP authority; C on drafts |
| Engineer and coordinator | Claude Sonnet 5.5 | R for dossiers, contracts, truth tables; verifies all delegated output; owns integration |
| Programmer | Luna | R for bounded R&D and tools under the delegation rules in section 5 |
| Domain experts | to be named by the owner | qualified review is required for empirical and clinical validity; nobody else may close those questions |

Accountability by decision type: engineering review disposition is Astra's; product authority, use and scope are the owner's; empirical or clinical validity needs a qualified domain reviewer; routine corrections (wording, scheduling, register entries) are the engineer's and are logged.

## 3. Work breakdown structure

Code: 1 = project; 1.x = phase deliverable; 1.x.y = work package. Owner column: **S** Sonnet, **L** Luna, **A** Astra review, **O** owner decision. Size is S, M or L.

### 1.1 Governance and setup

| WBS | Work package | Owner | Size | Output |
|---|---|---|---|---|
| 1.1.1 | Claim paths in the engineering log before each package; keep a work log | S | S | log entries |
| 1.1.2 | Decision register: open questions for the owner, Astra and domain experts | S | S | register inside S0002 |
| 1.1.3 | Numbering and handover rules: `S` engineer, `A` Astra, `L` Luna, `0001` generic | S | S | stated in this plan |
| 1.1.4 | Change control: any change to scope, a frozen contract or an authority limit is raised to Astra and the owner first | S | S | rule in section 9 |

### 1.2 Source and definition dossiers (A0003 S-FRM-01, deliverable S0002)

| WBS | Work package | Owner | Size | Output |
|---|---|---|---|---|
| 1.2.1 | Canonical index of Domains 1 to 7 against inbox files 0002 to 0014; resolve duplicates by SHA-256 (0014 equals 0008; 0007 is Domain 6; 0013 is Domain 3); originals untouched | L, S checks | S | index table |
| 1.2.2 | Inventory every equation, coefficient and threshold in the submissions into one structured table (id, value, units, claimed source, file and line) | L | M | inventory CSV |
| 1.2.3 | Primary-source verification per coefficient: URL, edition and date, section or page, units, context, applicability, uncertainty, evidence status (source-confirmed arithmetic, configurable policy, unvalidated model, NOT_ESTABLISHED). First pass by domain: seismic, hydrological, meteorological, wildfire, biological, displacement, volcanic | L first pass, S verifies every row | L | source matrix |
| 1.2.4 | Bounded public feed checks: do USGS, FIRMS, Copernicus GFM and NHC products actually supply the fields the proposals assume? Small saved samples; no keys; FIRMS needs a MAP_KEY, so it is reported NOT_TESTED | L | M | sample fixtures and a field table |
| 1.2.5 | Reproduce Astra's numeric counterexamples (flood, seismic, MMI branch, wildfire multiplier, shelter) with an independent method | L, S cross-checks | S | script and results |
| 1.2.6 | Resolve F01 to F28: each closed, open or disputed, with evidence | S, A reviews | M | S0002 |

### 1.3 Contracts and lexicon (S-FRM-02, deliverable S0003)

| WBS | Work package | Owner | Size | Output |
|---|---|---|---|---|
| 1.3.1 | ADR: map the formulation lifecycle onto the existing registry states without changing frozen enums; numeric representation (integer subunits or decimal), rounding stage and mode, unit conversion | S, A reviews | M | ADR draft |
| 1.3.2 | Lexicon terms: demand vs shortfall; stock vs flow vs capacity; exposed vs affected vs displaced vs planning population; averaging period; scenario vs observation; official alert vs workflow status | S | M | lexicon draft |
| 1.3.3 | Controlled form of A0002 (formulation record, dependency graph, typed edges, input completeness, UNKNOWN propagation, status vs provenance vs allowed-use fields) | S | M | contract draft |
| 1.3.4 | Machine-checkable schema for the formulation record and the graph (acyclic, typed edges, versions) | L R&D, S reviews | M | schema and validator |
| 1.3.5 | Example graph (water, shelter, capacity) and schema validation vectors, positive and negative | L, S checks | S | example and vectors |
| 1.3.6 | Contract and ADR diff for Astra, with a disposition request for anything incompatible | S | S | S0003 |
| 1.3.7 | Lifecycle storage and transition design with isolated tests on the real migrations (A0004 D2) | S, A reviews the adapter | M | ADR-006 rev 0.2 and `research/engineer/lifecycle*` |
| 1.3.8 | Typed rational encoding, exact rounding vectors, composition envelope and hash domain, permission intersection, dimension checks, decision-table coverage prover (A0004 D1, D3, D4, C1 to C6) | S | M | `research/engineer/` proofs of concept |

### 1.4 SOP truth tables and independent vectors (S-FRM-03, deliverable S0004)

| WBS | Work package | Owner | Size | Output |
|---|---|---|---|---|
| 1.4.1 | Complete tables for validation, assessment, proposal and authorization states: priority, overlap, UNKNOWN, cancellation, freshness, idempotency, approval evidence | S, A reviews | L | truth tables |
| 1.4.2 | Overlap and gap detector for decision tables: enumerate boundary cases and report any input matching zero or several rules (catches F19 and F28) | L R&D | M | pure tool and report |
| 1.4.3 | Independent expected results for all A0002 vectors and all A0001 counterexamples (velocity reversal, MMI discontinuity, division by zero, population above P0, stock and flow mismatch, duplicate cohort or stock, wind averaging mismatch, overlap and missing branches) computed by a method independent of the proposed equations | L, S cross-checks | M | vector file |
| 1.4.4 | Test specification and actionable task cards with affected paths; no card may activate a held formula | S | M | S0004 |

### 1.5 Implementation preparation (S-FRM-04) — starts only after Astra's review disposition of 1.3

| WBS | Card | Owner | Size |
|---|---|---|---|
| 1.5.1 | Lexicon and type adapters, numeric policy | L | M |
| 1.5.2 | Pure demand, supply, pack and capacity arithmetic with registered dependencies | L | M |
| 1.5.3 | Scenario composition on synthetic data over the frozen shortfall core | L | M |
| 1.5.4 | SOP validation and assessment state engine with no side effects | L | L |
| 1.5.5 | Domain adapters, one at a time, only for verified fields and authority-issued evidence | L, A decides per domain | L each |
| 1.5.6 | Audit export and replay of the formulation graph and provenance | L | M |

### 1.6 Quality and review

| WBS | Work package | Owner | Output |
|---|---|---|---|
| 1.6.1 | Verify every Luna deliverable before it is used: re-run its commands, spot-check sources, re-compute numbers | S | verification line in each note |
| 1.6.2 | Review checkpoints with Astra at M2, M3 and M4 | A | A-series replies |
| 1.6.3 | Evidence register: for each deliverable, the command run, its output and the file hash | S | table in S0002 to S0004 |

### 1.7 Risk management and 1.8 closure

| WBS | Work package | Owner |
|---|---|---|
| 1.7.1 | Maintain the risk register (section 7); review at every milestone | S |
| 1.8.1 | Close-out: lessons learned and the open-decision list for the owner | S |

**100% check:** S-FRM-01 is 1.2, S-FRM-02 is 1.3, S-FRM-03 is 1.4, S-FRM-04 is 1.5, the three review checkpoints are 1.6.2, and the A0003 return format is covered by 1.2.6, 1.3.6, 1.4.4 and 1.6.3. Nothing in the plan activates a formula, deploys, spends or edits an original.

## 4. Dependencies, critical path and milestones

```text
1.2.1 -> 1.2.2 -> 1.2.3 -> 1.2.6 -> M1
1.2.4, 1.2.5 run beside 1.2.3 and join at 1.2.6
Common-contract drafting (1.3.1 to 1.3.3, 1.3.7, 1.3.8) and isolated schema R&D (1.3.4, 1.3.5) run BESIDE source review (1.2); they do not wait for all seven domains.
A domain's approval for use still depends on that domain's verified sources (1.2.3 for that domain).
1.3.3 + 1.3.7 -> 1.3.6 -> M2 (contract review requested) -> Astra's disposition -> M2a (accepted, or rework and resubmit)
1.3.3 -> 1.4.1 -> 1.4.4 -> M3 (Astra reviews); 1.4.2, 1.4.3 run beside 1.4.1
An integration card is released only when its contract AND its SOP contract and vectors are ready, not on M2a alone: M2a + 1.4.4 -> M4 (named cards released) -> M5 (those cards implemented and verified) -> close
```

Critical path: Astra's disposition of the contract (M2a), the truth tables and vectors (1.4.1, 1.4.4), and per-domain source verification (1.2.3) for any domain adapter. Everything Luna does in 1.2.1 to 1.2.5, 1.3.4, 1.3.5, 1.4.2 and 1.4.3 can run in parallel with my drafting, which is where the time is saved.

| Milestone | Meaning |
|---|---|
| M1 | S0002 issued: index, source matrix, F01 to F28 dispositions |
| M2 | S0003 issued: contract, ADR, lexicon, example graph, proofs of concept; Astra's disposition requested |
| M2a | Astra's disposition recorded: accepted, or rework and resubmit |
| M3 | S0004 issued: truth tables, vectors, task cards |
| M4 | the affected integration cards are released to Luna, each only after its contract, SOP contract and vectors are ready |
| M5 | the released cards are implemented and verified, with behavioral-risk checks; close-out. Authorization stays limited to preparation and R&D until a card is released. |

## 5. Delegation to Luna: R&D protocol (no gates)

The owner's intent is to keep Luna fast. Per-card gates stay off for this plan. Luna works under a lighter protocol and I do the verification and integration checks.

**What Luna may take:** mechanical extraction, hashing and indexing, independent recomputation, feed sampling, pure tools (schema validator, overlap detector), and later the implementation cards.

**What Luna may not do:** decide a formulation's meaning, approve a coefficient, choose a policy threshold, close a finding, write or promote an SOP authority rule, or change a frozen file. Astra and the owner decide those; I prepare the question.

**Protocol for every Luna task (R&D card):**
1. State the question and the constraints in one paragraph.
2. List the realistic options (at least two when more than one exists; do not invent artificial options for a trivial extraction). Score each for likelihood, impact and detectability of failure from 1 (low risk) to 5 (high risk); for detectability 5 means a failure is hard to see. The scores are decision aids, not measured probabilities. A low total never erases a critical authority or safety risk: any option with impact 5, or any that touches authority, a coefficient or a frozen file, is flagged for Sonnet and Astra whatever its total.
3. Pick the lowest-risk option, say why, and name the residual risk.
4. Do the work. For code, run `npm run typecheck` and the tests she wrote or touched. Actual evidence means: the identifiable input or source and the tool versions, the exact command, the exit code, and the retained output or result linked by hash. The note may point to the full output instead of pasting it all. No gate, no evidence-file ritual.
5. Drop a note in the inbox as `L0001`, `L0002` and so on with: question, options and scores, decision, what was run and its result, files and their hashes, open questions for Sonnet, Astra or the owner. Citations carry the URL, the access date, the section or page and only the necessary supporting passage (a short quotation, never a whole document); "NOT_ESTABLISHED" is always an acceptable answer and is better than a plausible citation.
6. The two-attempt stop rule from LUNA.md stays: after two honest attempts at the same failure, stop and report.

**Where I still run a gate:** not per card, but at each integration point, and decided by behavioral impact, wherever the code lives: new parsers, numeric adapters, authorization or lifecycle checks, storage, workflow actions, dependency changes and public API or UI claims can all touch the same invariants, as can `src/engine`, `src/registry`, a frozen contract or tenant isolation. That is my run, not Luna's, so it does not slow her down.

## 6. Acceptance criteria per deliverable

| Deliverable | Accepted when |
|---|---|
| S0002 | every coefficient has a source row or NOT_ESTABLISHED; all 28 findings have a disposition with evidence; duplicate files resolved by hash; no citation was invented. A sample is used only for triage; this applies to the plan's own risk wording too: every coefficient, threshold and authority claim that is promoted into an accepted contract is verified directly against its primary source |
| S0003 | contract covers A0002 in full; frozen shortfall unchanged and called only through an adapter; every term in the lexicon is used consistently; the schema validator rejects each negative vector |
| S0004 | every SOP table gives one effective outcome per valid bounded input, has no unresolved ambiguity, and returns UNKNOWN for missing inputs or unmatched cases (a priority may resolve an overlap only through a recorded policy decision), proved by the coverage prover for tables inside the restricted rule language and reported as NOT_PROVEN or tested coverage otherwise, and expected results come from a method independent of the proposed equation |
| 1.5 cards | each card names its paths and tests, activates no held formula and keeps honest status words |

## 7. Risk register

Scale: likelihood and impact 1 (low) to 5 (high). Score is the product.

| ID | Risk | L | I | Score | Response | Owner |
|---|---|---|---|---|---|---|
| R1 | Luna or I back-fill a convincing citation for an equation the source does not contain | 3 | 5 | 15 | Quote-and-URL rule; NOT_ESTABLISHED allowed; I re-open a sample of sources; Astra spot-checks | S |
| R2 | A held formula is implemented or activated by accident | 2 | 5 | 10 | No card activates a held formula; lifecycle state checked in review; domain adapters need Astra's per-domain decision | S, A |
| R3 | Semantics decided by the wrong person (programmer or engineer instead of Astra, owner or a domain expert) | 3 | 4 | 12 | Section 5 forbids it; every such question goes to the decision register | S |
| R4 | Frozen shortfall contract altered or bypassed | 1 | 5 | 5 | Adapter only; integration gate run on any change near it | S |
| R5 | Domain experts are not available, so empirical models stay unvalidated | 4 | 3 | 12 | Keep them as labelled scenarios with no authority; continue with the common core | O |
| R6 | A feed does not supply a field a proposal assumes | 4 | 3 | 12 | Field checks in 1.2.4; report NOT_ESTABLISHED; design adapters on verified fields only | L, S |
| R7 | Scope creep into building hazard predictors | 3 | 4 | 12 | Out of scope; change control in section 9 | S |
| R8 | Floating point or rounding differences make vectors disagree | 3 | 3 | 9 | ADR 1.3.1 fixes the numeric policy; vectors use integers or decimals | S |
| R9 | Luna loses speed to process | 3 | 2 | 6 | No per-card gates; light protocol | S |
| R10 | Open items from S0001 (key fragment in git history, provider-order change, live-gateway gap) are lost behind this work | 3 | 4 | 12 | Kept in a separate list; owner rotates the Google key; Astra's audit of S0001 stays separate | S, O |
| R11 | A source needs a key or a login (FIRMS MAP_KEY) | 4 | 2 | 8 | Report NOT_TESTED; do not spend or register | L |
| R12 | Inbox originals modified by accident | 2 | 4 | 8 | Read-only handling; hashes recorded in 1.2.1 and re-checked at each milestone | L, S |

## 8. Assumptions

- The inbox files 0001 to 0014 and A0001 to A0003 are the complete input set.
- Astra and the owner reply in the inbox; their reviews gate M2 to M4.
- No domain expert is available soon, so no empirical coefficient can become `approved-for-specific-use` in this plan.

## 9. Change control

Escalate, and apply only after the decision-maker for that type agrees (section 2): scope, authority, frozen semantics, lifecycle enums, external commitments and milestones. Routine corrections such as wording, scheduling and document-register entries are made by the engineer and logged; they do not wait for both the owner and Astra.

## 9a. Added by A0005 and A0006

- **1.9 Historical databank workstream (A0006, DBK-01 to DBK-05)** is a separate workstream under its own plan, so it does not delay S0002. Luna research there follows the same light protocol.
- **1.3.9 Lifecycle and numeric corrections R1 to R7** (isolated proofs, a measured-budget proposal and a migration rehearsal) are submitted before any integration card is released. Integration remains held until Astra releases it.
- **1.4.5 Real-table diagnostics (S0004):** all seven original SOP tables are translated literally (thresholds, inclusivity, units and priority preserved, no invented priority) and run through the prover as diagnostic research. Source verification is not a prerequisite for finding a gap or ambiguity.
- **HANDOVER.md** is refreshed through normal change control, with a new baseline snapshot, after the corrections.

## 10. Open items kept separate (not part of this WBS)

- Rotate the Google key and decide whether to rewrite commit `12d8a01` (see S0001).
- Astra's audit of S0001, the provider-order change and the live-gateway call.
- HANDOVER.md refresh and a new baseline snapshot.
- Switching on Pro, Expert and registration.
