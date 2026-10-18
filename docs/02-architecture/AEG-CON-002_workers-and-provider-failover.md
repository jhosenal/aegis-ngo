# AEG-CON-002 — Worker roles and provider failover

| Control field | Value |
|---|---|
| Document ID | AEG-CON-002 |
| Revision | 0.1 |
| Status | WORKING_BASELINE |
| Date | 2026-10-13 |
| Owner | Codex — PM / architecture |
| Approval | Package creation authorized; proposal details tracked in DEC-001 |
| Classification | Internal working document |

## Separate role from provider

Development roles are Codex/Claude/Gemini as assigned by the user. Runtime roles below are application responsibilities with interchangeable tested model bindings.

| Runtime role | Permitted output | Code-owned boundary | Invocation |
|---|---|---|---|
| Manager | Candidate registered route, arguments, clarification | Route allowlist, schema, permission | Ambiguous language after local routing |
| Specialist | Candidate extraction or explanation with evidence IDs | Source checks and output validation | Needed language work only |
| Finance/resource reviewer | Challenge assumptions and explain independently computed checks | Arithmetic, affordability, reserve and approval rules | Material resource/cost assessment |
| Advisor | Structured disagreement/uncertainty | Cannot authorize or change facts | Configured exception triggers |
| Coordinator | Summarize workflow state and outstanding tasks | Durable workflow state, no override | Multi-step status request |

A reviewer role is not an autonomous spending authority. Using different models alone is not independent verification. Run independent calculations/tests.
Models receive minimum necessary input. Do not send all pinned cards or private source datasets by default.

## Provider contract

Binding fields: roleId, primaryProvider/model, backupProvider/model, capabilityRequirements, allowedDataClasses, input/output limits, totalDeadlineMs, maxAttemptsTotal, maxCostPerTask and priceSnapshotId.
Capability requirements include structured output, tool semantics when applicable, context size, refusal handling and usage reporting. Test each binding rather than assuming protocol compatibility.
No hardcoded live model default in this package. Verify current provider catalogue and perform a bounded canary once account/budget is configured.
Google is primary; reAPI is backup. A Gemini model behind reAPI can share upstream failure with direct Google; independent-maker backup requires compatible capability and policy.

## Failure policy

| Condition | Required behavior |
|---|---|
| Google transient 429 / timeout / retryable 5xx | Bounded backoff with jitter, then eligible backup within global deadline/budget |
| Authentication/configuration error | Mark provider unhealthy, surface actionable issue; use preconfigured permitted backup if policy allows, no blind retries |
| Malformed/schema-invalid output | Reject; bounded correction or backup only if task policy permits; no use of invalid content |
| Safety/policy refusal or denied tool permission | Preserve refusal/denial; provider switching cannot bypass it |
| Source data missing/stale | Expose uncertainty; backup model cannot manufacture a replacement fact |
| Backup fails or budget exhausted | Code-only result or explicit clarification/degraded state |
| Timeout after possible charge/effect | Keep reservation and reconcile uncertainty; do not assume free failure |

Control retries in one layer or account for SDK retries explicitly. Track a circuit breaker per provider/binding with bounded health probes; prevent a failing provider from being hammered.
Never replay external workflow effects simply because explanation generation failed.

## Budget contract

Atomic reservation must occur before each network attempt, shared across workers, requests, processes and providers. Transaction checks spent + outstanding reservations + requested maximum <= budget.
Reserve in a fixed monetary unit with explicit pricing version; token estimation heuristics are not guaranteed maxima. Use supported token counts/validated conservative bounds and explicit input/output limits; unknown pricing means no paid call.
Every retry consumes/retains its own reservation as appropriate. On missing usage or ambiguous charge, retain a bounded conservative liability pending reconciliation; avoid premature release.
Apply per-task, per-day and account limits. A model cannot raise them. Initial live spend is disabled until an Aegis account and limits exist.

## Audit record

Record task/attempt IDs, role, requested provider/model, provider-reported model if available, binding version, sanitized input/evidence hash, timestamps, retry/fallback reason, validation result, reported usage, cost basis and reservation outcome.
Keep internal request details private. Do not claim the returned model is verified if the API only echoes the requested name.

## Source lessons

QZEEX inspected client uses reAPI directly; automatic Google-to-reAPI failover is an Aegis design requirement.
QZEEX board checks budget before parallel calls without reserving first: do not inherit that race.
QZEEX manager is model-first after selected local fast paths. Aegis should expand known deterministic routing and measure coverage.
Google transient retry guidance: [Gemini troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting). reAPI model protocols/capabilities: [provider index](https://reapi.ai/llms.txt); reverify before implementation/live use.


