# AEG-ARC-001 — System blueprint

| Control field | Value |
|---|---|
| Document ID | AEG-ARC-001 |
| Revision | 0.1 |
| Status | WORKING_BASELINE |
| Date | 2026-10-13 |
| Owner | Codex — PM / architecture |
| Approval | Package creation authorized; proposal details tracked in DEC-001 |
| Classification | Internal working document |

## Product boundary

Repository: independent Aegis workspace. OAG is the governing method and optional integration provider. QZEEX and Storyboard are reference tools/projects.
Do not move this repository into OAG or create junctions without an integration decision. Formal OAG child-product registration, VLAN/port block and product domain remain pending.
The Aegis app owns its data and audit chain. OAG core updates reach it through reviewed/versioned integration and, when registered, I_factory_patch. No direct reads of another product's runtime state from app requests.

## Proposed components

| Component | Responsibility | Model access |
|---|---|---|
| React workspace | Render cards/chat/maps and explicit user actions | None directly |
| API/auth boundary | Sessions, ownership, input validation and request identity | None |
| Route/workflow engine | Registered capabilities, state transitions, idempotency | Delegates bounded language tasks only |
| Formulation/lexicon registry | Types, definitions, units, assumptions and versions | None |
| Source adapters | GDACS/HDX or fixture intake, normalization and provenance | Optional extraction on permitted text |
| Calculation layer | Deterministic resource/finance calculations | None |
| Model gateway | Role contracts, provider adapters, validation, retry policy | Google primary, reAPI backup |
| Budget ledger | Atomic reservations and usage reconciliation | None |
| Evidence/audit store | Immutable snapshots, event chain and release evidence | None |
| Evaluation registry | Candidate/active versions and measured promotion | Models can suggest; code validates |

One application origin and one API process are the default for the first slice. Use TypeScript/Node/Fastify, React and local SQLite; record package choices/current versions at implementation. Python is optional only for a demonstrated need.

## Request lifecycle

Authenticate -> resolve explicit context revisions -> identify registered route -> validate typed inputs and permission -> pin evidence and formulation versions -> execute code workflow -> persist result and audit event atomically -> render cards -> optionally explain with a bounded model.
For free text, a model may propose a route/arguments before validation. It never authorizes execution. Model-supplied instructions in source text have no authority.
Use an outbox/reconciliation mechanism if a committed workflow later performs an external effect. Idempotency key is tied to owner, workflow and input snapshot; repeating an intent cannot duplicate the effect.

## Storage

Local SQLite is appropriate for isolated development. Keep schema migrations reviewed and reversible where practical.
Cloud Run's writable container filesystem is ephemeral; a local SQLite file plus occasional backup is not a durable multi-instance database. Choose durable transactional storage through DEC-014 before hosted persistence. [Cloud Run container contract](https://cloud.google.com/run/docs/container-contract)
The app is an aggregator of source information but stores workflow/audit state. Describe it as minimizing retained source/personal data; “stateless” must not conceal durable state.
Separate public source evidence, private organization resources, model usage and integrity metadata. Do not put raw confidential payloads into public audit exports.

## Operational configuration contract

Validate at startup: environment, host/port, storage mode, product ID, auth configuration, feed endpoints/limits, model bindings, budgets, retry deadline and audit policy.
Local host may bind loopback. Cloud Run binds 0.0.0.0 and supplied PORT. Provider credentials stay server-side.
Do not copy the draft model names or pricing into defaults without current capability verification. A temperature setting does not enforce determinism.
No OAG_ALLOW_AI_HALLUCINATION flag can guarantee correctness. Replace claims with schema checks, evidence checks and bounded failure modes.
Define total call deadline across SDK retries, application retries and backup; nested retry loops must not multiply attempts invisibly.


