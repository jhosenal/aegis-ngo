# AEG-CON-003 — Formulation composition and SOP contract

| Control field | Value |
|---|---|
| Document ID | AEG-CON-003 |
| Revision | 0.4 (revised under A0005; adds R3, R4, R5, R6, R7 and the combined guard) |
| Status | REVIEW_DRAFT — rework submitted for Astra's review; not approved, not active |
| Date | 2026-10-13 |
| Derived by | Claude Sonnet 5.5, engineer, from A0002 by Codex (PM and formulation designer) |
| Requires | AEG-ADR-006 rev 0.2 (numeric policy, rounding, lifecycle storage) |
| Frozen and unchanged | `AEG.F.RESOURCE-SHORTFALL/1.0.0` (ADR-003), canonical JSON v1 and its hash domains (ADR-004), the registry's four states |
| Evidence | `research/engineer/` proofs of concept (count, versions and exit code in `results.txt`); isolated, not integrated |
| Register | Registered as a draft in AEG-REG-001 under the A0004 disposition. A new baseline snapshot follows the corrections. |

This document turns A0002 into a controlled contract. It activates no hazard, clinical or operational formulation. Where A0002 and this text differ, A0002 is the review source and section 12 lists the difference.

## 1. Hierarchy and capability kinds

A domain formulation is a versioned composition of smaller registered formulations, never a monolithic equation with hidden constants. Evidence adapters, then typed observations, then scoped assessment inputs, then demand formulations, eligible supply, net shortfall, pack conversion, an assessment card, and an authorized SOP workflow.

| Kind | What it does | Needs, to be used for real |
|---|---|---|
| `observation` | normalizes a source and preserves its meaning | a verified source |
| `arithmetic` | deterministic quantities from explicit inputs | implementation test and approval for the use |
| `empirical` | validated estimate inside a calibration domain | a qualified domain reviewer |
| `policy` | an organization's chosen rates, thresholds, permissions | the policy owner's approval |
| `action` | an authorized side effect with idempotency and reconciliation | authorization per SOP |

## 2. Formulation record

| Field | Rule |
|---|---|
| `formulationId`, `version` | `AEG.F.<NAME>` and a semantic version; an approved definition is immutable |
| `kind`, `domain` | one kind above; `common` or a hazard domain |
| `description`, `expression` | plain language and the mathematical expression |
| `inputs`, `outputs` | schemas; every quantity has a **dimension** and a registered **unit** (section 6.2) |
| `scope` | population and resource scope, region, time basis; as-of and horizon kept apart; cohort and lot identity |
| `bounds`, `invalid`, `unknown` | allowed ranges; what makes an input `INVALID`; how `UNKNOWN` propagates |
| `numeric` | encoding of each field (ADR-006 Decision 1) and the rounding boundary, if any (Decision 2) |
| `preconditions`, `invariants` | checked before and after execution |
| `coefficients[]` | each with source id, edition, section or page, units, intended context, estimation method, uncertainty, validation dataset and policy owner; an unsourced value is `EXPERIMENTAL` and is never described as a WHO, Sphere or other standard |
| `dependencies[]` | exact formulation ids and versions |
| `lexiconIds[]`, `reference`, `examples[]`, `counterexamples[]`, `tests[]` | terms, executable reference and its hash, independent expected results |
| `authority`, `lifecycle` | who may approve which use; the effective lifecycle is kept in the append-only lifecycle record (ADR-006 Decision 4), **not** in the mutable definition |

An empirical output also carries its estimate type and its uncertainty and validation limits. A calculation on uncertain inputs is a scenario estimate.

## 3. Status, provenance and permission are separate

An output carries three independent fields and no combined "confidence":

- `status`: `VALID`, `UNKNOWN`, `INVALID`, `STALE`, `CONFLICT`;
- `provenance`: the grade of the evidence behind each input;
- `permission`: the effective permitted use for this request (section 3.1).

`applicability` (`APPLICABLE` or `NOT_APPLICABLE`) and a `reasonCode` (for example `ZERO_DURATION`, `ZERO_POPULATION`) are **metadata** on a result, not extra values of `status`.

### 3.1 Effective permission

Allowed use `DEMO < PLANNING < OPERATIONAL` is a **ceiling**: it cannot exceed any required dependency's approval or the composition's own approval. It is **not sufficient alone**. The effective permission is the intersection, across the declared transitive dependency set plus the composition, of:

tenant, resource, purpose, geography or jurisdiction, model validity domain, time (expiry) and action permissions.

An empty intersection, a missing approval, a revoked or expired approval, or a missing approval for the composition itself means **no authorized execution** for the requested use. The set is the declared one: a restrictive dependency is never dropped after its output is seen. An unused optional branch may be left out only if the graph's dependency policy excluded it before execution. An `OPERATIONAL` label grants no dispatch, clinical or spending authority, which is authorized separately. Public data is not automatically approved for operational use, and a high provenance grade is not permission.

## 4. The dependency graph

1. **A node has a unique `nodeId`**, separate from the `formulationId` and version it invokes. One formulation may appear twice, with different inputs, under different node ids. A duplicate node id is a registration error.
2. A composition is a **directed acyclic graph**. Edges are typed (`quantity` with its dimension, `status`, `evidence`). A cycle, a missing node, a missing input or output, or an edge whose dimension does not match is an error. **Every required input port has exactly one binding**: an edge, or an explicitly declared constant or external input. A required port with no binding, or any port with more than one writer, is rejected before scheduling. Node definitions, hashes and port declarations are checked against the **trusted registry**, never against the graph's own claims. Identifiers are ASCII (`A-Za-z0-9_.@-`, 1 to 128 characters) and are rejected, not normalized, otherwise.
3. **Three tiers, kept apart.**
   - *Store and lint:* a candidate graph can be stored and linted with no approvals. Registering a candidate graph does not require its dependencies to be implementation-tested.
   - *Sandbox evaluation:* isolated evaluation of a candidate graph needs an explicit, time-limited sandbox authority and produces no approved result.
   - *Approved execution:* every node must pass the effective lifecycle and use checks of ADR-006 Decision 4 and section 3.1, on each execution.
4. Nodes run in a topological order and receive only their declared inputs. No node reads the clock, the network, a model or another node's private state.
5. The run is recorded in a **composition envelope** hashed in the additive domain `AEG-COMP-v1` (ADR-006): graph id, numeric policy, units, each node's id, formulation, version, definition hash and implementation hash, the typed edges, the **external bindings**, the **predeclared exclusion policy** and the **resolved dependency closure** (nested dependencies from the trusted registry, with their definition hashes), all in ordinal order. An exclusion may not remove a dependency that feeds an executing node; excluding a dependency changes the identity. The composition's own grant is bound to this identity. Input hashes, source timestamps, validation results, outputs and the policy version are recorded with it.

## 5. UNKNOWN, INVALID and the aggregate status

Every input keeps its own state and reason. A source adapter may say `UNKNOWN`; a downstream node never replaces it with zero, a default or a model's guess.

**Aggregation is deterministic and independent of visiting order.** The summary precedence is `INVALID`, then `CONFLICT`, then `STALE`, then `UNKNOWN`, then `VALID`, unless an explicit policy says otherwise. Every per-input reason is kept, sorted by severity and then by input name and code with an **ordinal** (UTF-16 code unit) comparator, never a locale comparison. Warning urgency is a separate field and never enters this ranking. (Tested over all 120 orders of five inputs.)

| Aggregate | Result of the node |
|---|---|
| `INVALID` | no output quantity |
| `CONFLICT` | both values shown, none chosen silently |
| `STALE` | a fresh snapshot is needed; a stale value is never presented as newly observed |
| `UNKNOWN` | may expose a **typed known partial value marked `complete: false`** with the names of the missing inputs; it never publishes a complete total and never calls the frozen core with a missing demand or supply |
| `VALID` | the node's own checks decide |

Only a pure `UNKNOWN` exposes a partial. An unsupported domain or an unavailable sensor is `UNKNOWN` or `NEEDS_DATA`, never `nominal`, and never suppresses the workspace as "safe".

## 6. Common arithmetic formulations (registered as candidates)

Identifiers are proposals; none exists in the registry. Arithmetic is exact (ADR-006); rounding happens only where a formulation says so.

### 6.1 Formulations and bounds

| Id | Expression | Bounds and checks |
|---|---|---|
| `AEG.F.DEMAND-FLOW/1.0.0` | Q = P · r · T; changing cohorts: sum over disjoint intervals of Pᵢ · rᵢ · durationᵢ | P a nonnegative integer of persons; r a nonnegative rational with the dimension quantity per person per day; T a nonnegative duration; cohort identity and period compatibility checked; no overlapping time; zero horizon gives zero incremental demand with `reasonCode ZERO_DURATION`, never "needs met" |
| `AEG.F.DEMAND-SPACE/1.0.0` | A = P · a | a positive rational m² per person; no multiplication by days; covered living area and settlement land are different resource types |
| `AEG.F.ELIGIBLE-SUPPLY/1.0.0` | per lot: eligible = onHand − unusable − reservedOther − protectedReserve, all computed exactly | categories disjoint and nonnegative with total at most onHand, else `INVALID`; lot identity unique; unknown access, expiry or stock gives the known eligible quantity as a partial with `complete: false`; confirmed stock and planned deliveries are separate scenarios |
| `AEG.F.RESOURCE-SHORTFALL/1.0.0` (frozen) | shortfall = max(0, demand − usable); surplus = max(0, usable − demand) | called only through the adapter in section 7 |
| `AEG.F.PACK-REQUIREMENT/1.0.0` | packs = ceil(shortfall / usablePerPack) | denominator positive, matching specification and unit; **ceiling is the declared packing boundary**, applied once after aggregation |
| `AEG.F.CAPACITY-GAP/1.0.0` | required = ceil(P / personsPerFacility); gap = max(0, required − verifiedSuitableFunctionalFacilities) | ratio positive; suitability explicit; ceiling is the declared allocation boundary |
| `AEG.F.POPULATION-SCENARIO/1.0.0` | P_next = P + arrivals − departures over a defined interval | disjoint counts; a negative result is `INVALID`; area per person at zero population is `applicability NOT_APPLICABLE`; exposed, affected, displaced, seeking service and already served are different quantities |
| `AEG.F.ASH-MASS-AREA/1.0.0` | massPerArea = thicknessMm / 1000 · densityKgPerM3 | **thickness ≥ 0, density > 0**, finite, scoped to the measurement; deposited mass only: not pressure, roof failure, a safety decision or a clearing instruction |
| `AEG.F.WIND-DYNAMIC-PRESSURE/1.0.0` | q = ½ · ρ · v² | **density > 0, speed ≥ 0**, finite; records gust or sustained basis, height and density assumption; not a structural load |

### 6.2 Dimensions are checked, not labelled

A unit string alone is not dimensional validation. Units carry dimension vectors (length, mass, time, count) and a formula is checked by carrying them through it.

| Quantity | Dimension | Registered units (examples) |
|---|---|---|
| volume | L³ | litre, m³ (they convert exactly, 1 L = 1/1000 m³) |
| area | L² | m² (never converts to a volume or a mass) |
| areal mass | M L⁻² | kg/m² |
| density | M L⁻³ | kg/m³ |
| pressure | M L⁻¹ T⁻² | Pa |
| flow (per person per day) | volume or area ÷ (count · time) | L per person per day |

Sums need equal dimensions. For example persons · (L per person per day) is a flow, not a volume, until multiplied by a duration; persons · (m² per person) is an area and multiplying it by days gives area-days, not an area; adding kg/m² to Pa is refused. An unregistered unit is an error. (Tested.)

## 7. Adapter to the frozen shortfall function

1. Compute demand and eligible supply **exactly**; reserve, unusable and other-allocation deductions are subtracted exactly before any permitted rounding.
2. Pass `usable` as available and `reserve = 0`, so a reserve is never deducted twice.
3. Convert both to the same registered **integer subunit** exactly. If the exact result is not a whole number the adapter returns `NOT_REPRESENTABLE`; if it is outside 0 to 1,000,000,000 it returns `OUT_OF_RANGE`. It never ceilings, floors or clips silently. Choosing a finer subunit may make a value representable; the choice is declared and recorded.
4. Use a common assessment `asOf` only after freshness validation; keep each source timestamp separately.
5. Unit, region and as-of are identical across the three quantities.
6. Return the frozen function's output unchanged inside the graph and provenance record.
7. A conservative planning envelope (demand rounded up, supply rounded down at a stated scale) is a **separate output** of a separately selected policy, labelled with `policyId`, version, original values, rounded values, scale, reason and rounding deltas. It is never presented as the exact gap and never overwrites observed stock.

## 8. Domain restrictions

Domain models are held. Only the common composition may run, on explicit scenario inputs.

| Domain | First supported composition | Held (no activation) |
|---|---|---|
| Seismic | authoritative event or ShakeMap references, explicit population scenario, common resources | PGA, MMI, tsunami logistic, inferred displacement |
| Hydrological | verified inundation footprint, scoped population, common resources | displacement and disease curves, invented sensor fields |
| Meteorological | source agency's wind convention preserved, dynamic pressure as description, common resources | 10-minute to 1-minute category substitution, damage-radius heuristic |
| Wildfire | product-specific fire evidence, independently supplied planning population, common resources | spread, time-to-impact, smoke equations, evacuation triggers |
| Biological | public outbreak evidence, authorized aggregate requirements and inventory | generic disease forecast, fluid dosing, universal PPE, RUTF and kit rules |
| Displacement | verified counts or an explicit arrivals and departures scenario, context-selected capacity and demand | access-divided water, universal therapeutic feeding |
| Volcanic | official advisory, observed ash and density arithmetic, explicit resource inputs | VEI-radius inference, universal roof-collapse and evacuation rules |

## 9. SOP contract

Every SOP has: `sopId` and version, owner, jurisdiction, required authority, input, step and output schemas, allowed routes, evidence requirements, dependency versions, freshness policy, approval rules, effect classification, idempotency, recovery and audit events.

**Workflow status is separate from the issuing authority's hazard classification.** `RECEIVED`, `VALIDATING`, then `NEEDS_DATA`, `NEEDS_REVIEW` or `ASSESSMENT_READY`; from there `PROPOSAL_READY`, `AWAITING_APPROVAL`, `AUTHORIZED`, `EXECUTING`, then `COMPLETED`, `FAILED` or `OUTCOME_UNKNOWN`. The prototype stops at assessment or proposal unless an action was separately authorized. No public evacuation or "security override" exists by default.

Rules:

1. Preserve all triggering reasons and the source's official alerts. A local calculation cannot downgrade or cancel an authority-issued warning.
2. Every decision table has explicit priority, equality boundaries, overlap resolution and a total default of `UNKNOWN`. An unmatched input is never `nominal`.
3. **Coverage is proven, not sampled, where the rule language allows it, **after the table is validated**.** A decision table is written in a restricted language: conjunctions of intervals over ordered numeric fields and of value sets over enumerated fields. In that language a rule is constant on each cell of the partition formed by all its breakpoints, so checking one representative per cell, including each breakpoint itself (equality) and each open interval between breakpoints, is an **exhaustive finite proof** of gaps and overlaps. Validation comes first and refuses, with an explicit reason, an empty enum domain, an unknown field, a type-mismatched or empty or unbounded interval, a duplicate field or rule id, an out-of-range priority, an unsupported operator, or no rules. The result keeps **analysis and acceptance separate**: `analysisComplete` says every cell was examined; `tableAccepted` is true only when the language and domain are valid, the analysis is complete, no tie is unresolved, and every cell has an effective outcome (a rule or the explicit default). Gap and ambiguity witnesses are always kept. A table whose partition exceeds the budget is `NOT_PROVEN`; a reproducible sample may be retained and is labelled **tested coverage**, which proves nothing about untested cells. Interval endpoints enter through the same 40-digit external limit as every other number. The runtime handling below still applies. (Tested: boundary equality, gaps, ties, enumerations, malformed tables, an over-budget table.)
4. **V10 requires one effective outcome per valid bounded input; no unresolved ambiguity; missing inputs or unmatched cases return UNKNOWN** (Astra, S0006). It does not require exactly one raw predicate: several rules may match when one has a unique highest priority that a recorded policy decision justifies, and a tie between different outcomes is an unresolved ambiguity and fails. An unmatched case is `UNKNOWN`: no hazard level is invented and never `nominal`.
5. Official-warning urgency and data completeness are separate. Insufficient data must not hide a received warning.
6. Thresholds are versioned policies. Escalation requests human review; it grants no spending or dispatch authority.
7. Re-evaluation uses a new snapshot; cancellation and de-escalation record authoritative updates and any configured persistence or hysteresis.
8. Source revisions and affected cohorts are de-duplicated; concurrent reservations use compare-and-swap or transactional accounting.
9. A retry resumes from durable state; an ambiguous external outcome is reconciled, not repeated automatically.
10. Models may explain outcomes and draft proposals; they cannot change coefficients, approve candidates or select privileged routes.

Truth tables for each domain are work package 1.4.1 (S0004).

## 10. Evidence, determinism and audit

- Numeric policy, rounding, conversion and typed encodings: ADR-006. No floats in the common core.
- Hash canonical, versioned, normalized values with canonical JSON v1; the serializer does not reduce fractions, so normalization comes first.
- Record the graph, input and dependency hashes, source timestamps, validation results, output and policy version. This proves consistency of the record, not truth of an observation.
- Model calls are not needed for these calculations. Learning produces evaluated candidate rules; there is no live self-promotion.

## 11. Acceptance vectors

Review vectors, run in the isolated proof of concept and **not** reported as passed in the application.

| # | Case | Expected |
|---|---|---|
| V1 | 100 persons, 15 L per person per day, 14 days | 21,000 L |
| V2 | 6,000 L on hand, 1,000 protected, 500 reserved elsewhere, none unusable | eligible 4,500 L; shortfall 16,500 L; 20 L per container gives 825 |
| V3 | shelter 100 persons at 3.5 m² each, a 7 or 14 day view | 350 m² for both |
| V4 | 101 persons, 20 per facility, 4 suitable | required 6, gap 2 |
| V5 | ash 100 mm at 1,000 kg/m³ | 100 kg/m², no collapse decision |
| V6 | density 1.225, speed 40 m/s | 980 Pa exactly (the proof of concept uses exact rationals; binary floating point gives 980.0000000000001) |
| V7 | unknown population or stock | `UNKNOWN`; a typed partial marked incomplete may be shown (for example eligible supply 4,500 L); never a complete total, and the frozen core is not called |
| V7b | mismatched unit or period; double-reserved lot; out-of-range conversion | `INVALID`, `NOT_REPRESENTABLE` or `OUT_OF_RANGE` |
| V8 | the same people or stock in two domains | counted once |
| V9 | one-minute versus ten-minute wind | distinct types; direct category mapping rejected |
| V10 | each SOP rule at below, equal and above its boundary, plus each pair of overlapping rules | one effective outcome per valid bounded input; a tie or unmatched case is UNKNOWN or fails |
| D1a | demand = supply = 2/5 L | exact gap 0; 400 mL and 400 mL; the frozen core returns 0 |
| D1b | demand 6/5 L, supply 11/10 L, 100 mL subunits | exact gap 1/10 L; 12 − 11 = 1 subunit |
| D1c | 2/5 + 2/5 + 1/5, then packing | 1 before packing; any partition of the same total gives the same result |
| D1d | 1/3 L in mL | `NOT_REPRESENTABLE` (exact value 1000/3) |
| D3 | a DEMO dependency under an OPERATIONAL graph; conflicting scopes; an expired or revoked approval; a missing own approval | each denies |
| D4 | external 2/4 normalizes to 1/2; internal 2/4 rejected; 0/1 valid; 0/2, 1/0 and oversized digits rejected | stable identity after normalization |

## 12. Differences from A0002 and open points

1. **Added structure:** the formulation record fields (section 2), node identity and tiers (section 4), the propagation and aggregation rules (section 5), the dimension table (section 6.2), the adapter steps (section 7), and the restricted rule language and its proof (section 9). These make A0002 testable; they do not change its meaning.
2. **Rounding:** the blanket rule of revision 0.2 is withdrawn (A0004 D1). Rounding happens only at declared packing or allocation boundaries; a conservative envelope is a separately labelled policy output.
3. **Lifecycle:** carried in an append-only record beside the unchanged registry (ADR-006 Decision 4), not in the mutable definition. This needs an additive migration, which is a proposal for review, not a change made.
4. **Not done here:** the lexicon in code, the machine-readable schema (work package 1.3.4, a card), source verification of any coefficient (S0002), any activation.

## Appendix A — Lexicon candidates (lifecycle `candidate`, project-defined)

Added to the lexicon by implementation card 1.5.1 after review. A familiar word is not a claim of an international definition.

| Term id | Meaning | Must not be confused with |
|---|---|---|
| `AEG.T.DEMAND` | quantity of a resource required for a defined cohort and horizon | `AEG.T.SHORTFALL_UNITS` (demand minus eligible supply) |
| `AEG.T.GROSS_REQUIREMENT` | demand before any supply is subtracted | shortfall; several wildfire, volcanic and displacement outputs are this |
| `AEG.T.STOCK` | a quantity held at a point in time | flow and capacity |
| `AEG.T.FLOW` | a quantity per unit time | stock; flow times a horizon is a quantity, not a rate |
| `AEG.T.CAPACITY` | what a facility can serve in a period | stock on hand |
| `AEG.T.POPULATION_EXPOSED` | people inside a hazard footprint | affected, displaced, planning |
| `AEG.T.POPULATION_AFFECTED` | people whose circumstances changed, by an approved definition | exposed |
| `AEG.T.POPULATION_DISPLACED` | people who left their place of residence, from counts or an approved model | affected; never inferred from building footprints |
| `AEG.T.POPULATION_PLANNING` | the number an organization chooses to plan for, with its basis | any observed count |
| `AEG.T.AVERAGING_PERIOD` | the time window of a measurement | instantaneous value; incompatible periods are never mixed |
| `AEG.T.SCENARIO` | a calculation on stated assumptions | `AEG.T.OBSERVATION` (a measured or reported value with source and time) |
| `AEG.T.OFFICIAL_ALERT` | a warning issued by the responsible authority, preserved verbatim | workflow status |
| `AEG.T.WORKFLOW_STATUS` | where Aegis's own process stands | an official hazard classification |
| `AEG.T.PLANNING_UNIT` | the registered integer unit a quantity is held in | a display unit |
| `AEG.T.ROUNDING_ENVELOPE` | a separately labelled conservative planning output with its policy, scale and deltas | the exact quantity |

## Appendix B — Example graph (water, illustrative scenario, not a policy; corrected under C1)

Node ids are unique and separate from the formulation they invoke. Population feeds demand. Inventory feeds eligible supply **independently**. **Both** demand and eligible supply feed the shortfall. The shortfall feeds packing.

```text
node population  (AEG.F.POPULATION-SCENARIO)   P = 100 persons
        |
        v
node demand      (AEG.F.DEMAND-FLOW)           r = "15/1" L per person per day, T = 14 days   ->  21,000 L
        |
        v                                                  node inventory (AEG.F.ELIGIBLE-SUPPLY)
node gap         (AEG.F.RESOURCE-SHORTFALL) <------------  onHand 6000, protected 1000,
        |         via the adapter, reserve = 0             reservedOther 500, unusable 0  ->  4,500 L
        v
node packs       (AEG.F.PACK-REQUIREMENT)      20 L per container: shortfall 16,500 L -> 825 containers
```

Edges: `population.persons → demand.persons`, `demand.litres → gap.demand`, `inventory.litres → gap.usable`, `gap.shortfall → packs.shortfall`. There is no edge from demand to inventory. With an `UNKNOWN` population, `demand`, `gap` and `packs` return `UNKNOWN`; `inventory` still reports 4,500 L and the shortfall node may show it only as a typed partial marked incomplete. The same formulation may be invoked twice under different node ids (for example a second demand node for shelter water). This graph is validated in `research/engineer/composition.test.ts`.
