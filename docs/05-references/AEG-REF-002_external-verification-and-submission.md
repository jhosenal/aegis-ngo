# AEG-REF-002 — External verification and submission checklist

| Control field | Value |
|---|---|
| Document ID | AEG-REF-002 |
| Revision | 0.1 |
| Status | WORKING_BASELINE |
| Date | 2026-10-13 |
| Owner | Codex — PM / architecture |
| Approval | Package creation authorized; proposal details tracked in DEC-001 |
| Classification | Internal working document |

## Source register

| Source | Checked | Finding / remaining check |
|---|---|---|
| [ISO lifecycle standard catalogue](https://www.iso.org/standard/90219.html) | 2026-10-13 | ISO/IEC/IEEE 12207:2026 published; lifecycle reference |
| [ISO documentation catalogue](https://www.iso.org/standard/74909.html) | 2026-10-13 | ISO/IEC/IEEE 15289:2019 remains published; revision in development |
| [Cloud Run contract](https://cloud.google.com/run/docs/container-contract) | 2026-10-13 | Bind 0.0.0.0:PORT; container files do not survive instance termination |
| [Gemini troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting) | 2026-10-13 planning review | Transient retry/backoff guidance; recheck selected SDK/model |
| [reAPI documentation](https://reapi.ai/llms.txt) | Earlier planning review; latest fetch unsuccessful | Model-specific capability/price refresh required before live binding |
| [Hack2skill initiative](https://hack2skill.com/event/aibuildercup2026) | 2026-10-13 | Entry page supplied by user; text extraction limited |
| [AI Builder Cup site](https://aibuildercup.com/) | 2026-10-13 | Team formation through Oct 14; submission deadline listed Oct 18; exact cutoff timezone not established |

No API capability or price is certified merely from a marketing model name. Recheck official provider pages before live use.

## Competition delivery plan

User confirms a registered team of two including Sensory Loo. Prepare:
- Working Google-hosted demonstration with meaningful Google AI functionality.
- Source repository with runnable setup, requirements and honest dependency/provenance disclosure.
- Presentation deck and demo video shorter than three minutes.
- Evidence of deterministic engine execution, bounded language assistance and degraded/provider-failure behavior.

These deliverables reflect the prior planning discussion; recheck the organizer's current challenge/FAQ and submission form for exact formats, access requirements, originality rules and cutoff time before submission. This package does not assert that using any particular pre-existing code is automatically allowed.
Describe OAG as the user's governance/engineering method. Disclose actual runtime libraries/services/tools when required; calling a server “methodology” does not remove a disclosure obligation.
Storyboard can be a demo-authoring tool without making its old product code the Aegis submission.

## Suggested demo narrative: approximately 165 seconds

0–20: operational problem and incident/source card.
20–65: coordinator asks for a resource assessment; explain source/assumptions and code result.
65–100: inspect nested evidence and show Google helping interpret language.
100–130: disable model; repeat the structured workflow with identical calculated result.
130–150: demonstrate labelled backup/degraded behavior and budget guard.
150–165: audit export and what remains prototype-only.

Use synthetic labels. Do not represent a stubbed provider switch as a live call. Final duration is measured from the exported video.


