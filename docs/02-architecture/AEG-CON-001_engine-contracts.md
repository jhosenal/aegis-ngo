# AEG-CON-001 — Formulations, lexicon, workflow and memory contracts

| Control field | Value |
|---|---|
| Document ID | AEG-CON-001 |
| Revision | 0.1 |
| Status | WORKING_BASELINE |
| Date | 2026-10-13 |
| Owner | Codex — PM / architecture |
| Approval | Package creation authorized; proposal details tracked in DEC-001 |
| Classification | Internal working document |

## Formulation contract

Required fields: formulationId, semanticVersion, title, inputSchema, outputSchema, units, assumptions, preconditions, deterministicAlgorithmRef, algorithmHash, roundingPolicy, examples, invalidCases, owner, status and effectiveFrom.
States: candidate, tested, active, deprecated. Never overwrite an active version. Output records formulation version, canonical input hash, evidence IDs and computed result.
A pure calculation receives explicit values including time/rates where relevant. It must not read the clock, make a network call or ask a model inside execute.
Document numeric representation and rounding. Use integer quantities for indivisible units; money uses specified decimal precision or integer minor units. Define rounding at each boundary instead of relying on display rounding.

Initial proposed formulation: AEG.F.RESOURCE-SHORTFALL/1.0.0
- Inputs: demandUnits, availableUnits, reserveUnits as nonnegative integers; unitId, regionId, asOf.
- Preconditions: same units/region/time basis, reserveUnits <= availableUnits; known inputs only.
- usableUnits = availableUnits - reserveUnits.
- shortfallUnits = max(0, demandUnits - usableUnits).
- surplusUnits = max(0, usableUnits - demandUnits).
- Result is an arithmetic assessment; it does not prove supplies can be transported or allocated.
- Unknown values stay unknown; never coerce null into zero.

## Lexicon contract

Each entry: termId, namespace, preferredLabel, definition, aliases, type/units, domain, provenance, version, owner and lifecycle status.
Project-defined terms are marked as such; a familiar name is not a claim of an international standard definition. Ambiguous aliases prompt clarification.
Internal-to-public vocabulary map: formula -> versioned calculation; PABX -> registered capability routing; liquid memory -> context lifecycle; morphism -> typed transformation; Darwinian evolution -> evaluated candidate promotion; DNA seal -> integrity baseline/release evidence.
Preserve exact internal identifiers in technical interfaces without forcing metaphors into user-facing text.

## Workflow contract

Each workflow: workflowId/version, allowed role, input schema, ordered/conditional steps, required evidence, route IDs, retry classification, timeout, side effects, approval policy, compensation/reconciliation and output schema.
Proposed routes use I_aegis_<domain>_<verb>. Registration is explicit; there is no execute-any-string route.
Step state: pending -> running -> succeeded / failed / awaiting-input / awaiting-approval. Restart resumes from durable state.
Calculations and read-only actions can be replayed. External effects require an idempotency key and confirmed outcome; uncertain effects are reconciled before retry.

## Typed transformation contract

Each adapter maps source schema/version -> internal schema/version with field mappings, units, timezone conversion, missing-value handling, validation and loss-of-information notes.
A mapping to a common representation does not establish equal meaning or equal source quality. Test source-specific examples and reject incompatible dimensions.
No mapping from financial volatility to disaster severity is assumed.

## Context and memory lifecycle

Store context reference, owner, source revision, purpose, sensitivity, creation/as-of/expiry timestamps, retention policy and consent/authorization where applicable.
Retrieve only context permitted for the current user/workflow/provider. Distinguish chat history from evidence. Keep explicit attached card revisions stable through a turn.
Expired context is excluded or prominently marked according to workflow rules. Deletion/retention policy must account for backups and model-provider exposure.
Memory never modifies active policies by itself.

## Improvement contract

Feedback creates a candidate rule/route/threshold with source examples and rationale. Evaluate on separated held-out cases; record errors, coverage, cost and regressions.
Promotion requires stated acceptance criteria, reviewer evidence and versioned activation. Rollback restores a prior active version.
Learning here means improving the governed engine and evaluation evidence. It does not imply LLM fine-tuning or arbitrary self-modifying production code.


