# AEG-DEC-001 — Decisions and open items

| Control field | Value |
|---|---|
| Document ID | AEG-DEC-001 |
| Revision | 0.1 |
| Status | WORKING_BASELINE |
| Date | 2026-10-13 |
| Owner | Codex — PM / architecture |
| Approval | Package creation authorized by user; detailed proposals subject to recorded decisions |
| Classification | Internal working document; review references before public distribution |

## User direction accepted in conversation

| ID | Decision | Evidence |
|---|---|---|
| AEG-DEC-001 | OAG means Open Autonomous Governance | Explicit user correction |
| AEG-DEC-002 | Aegis is an isolated OAG child product with its own audit chain | User direction, OAG product rules |
| AEG-DEC-003 | Train/improve the engine; minimize LLM dependency | User Storyboard example and repeated instruction |
| AEG-DEC-004 | Codex plans/audits; Claude codes; Gemini operates | Explicit user role assignment |
| AEG-DEC-005 | Nested cards; desktop result/chat approximately 2:1; mobile chat and docked cards | User UX direction |
| AEG-DEC-006 | Use standard technical wording in reader-facing documents | User instruction |
| AEG-DEC-007 | Google primary; reAPI backup; role-based workers | Latest discussion accepted with “ok” |
| AEG-DEC-008 | Prepare E:/Aegis documentation and cross-project handover | Current user authorization |

## PM defaults for a buildable baseline

| ID | Default | Change method |
|---|---|---|
| AEG-DEC-009 | First slice: incident evidence + supplied resource figures -> deterministic shortfall card | ADR if scope changes |
| AEG-DEC-010 | TypeScript, React, Node/Fastify, SQLite locally; one application origin | Record stack ADR before setup |
| AEG-DEC-011 | Fixtures first; no actual dispatch/payments in MVP | Record explicit operational expansion |
| AEG-DEC-012 | OAG integration through adapter and registered delegation, no direct cross-product writes | Conformance review |
| AEG-DEC-013 | Public hazard metadata plus synthetic resource data for initial demo | Recheck provenance before real imports |

## Open items and dependency boundaries

| ID | Item | Owner / when needed | Work that can continue |
|---|---|---|---|
| AEG-DEC-014 | Cloud durable database and deployment account/region | Owner + Claude before cloud persistence | Local SQLite and storage interface |
| AEG-DEC-015 | Approved model IDs, capability tests, per-call/day budgets | Owner + Gemini before live model operation | Stubbed adapters, budget tests |
| AEG-DEC-016 | Initial NGO workflow/partner and authority for real action | Owner before field use | Demonstration only |
| AEG-DEC-017 | QZEEX dataset rights, currencies and geographic relevance | Owner + data implementer before import | Synthetic fixtures, schema inspection |
| AEG-DEC-018 | OAG product registration, port block, namespace and integration host | OAG maintainer before registration | Independent repo and adapter contract |
| AEG-DEC-019 | Hackathon deadline timezone and latest deliverable/rules evidence | Team before submission | Build and local demo preparation |
| AEG-DEC-020 | Sensory Loo's acceptance/operational responsibilities | Team before assigning accountability | Team membership is confirmed |

Do not turn open items into invented facts. Ask the owner only when dependent work actually requires an answer. A new agent may make reversible implementation choices within the baseline and document them.


