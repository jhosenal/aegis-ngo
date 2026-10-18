# AEG-RSK-001 — Risks and limitations

| Control field | Value |
|---|---|
| Document ID | AEG-RSK-001 |
| Revision | 0.1 |
| Status | WORKING_BASELINE |
| Date | 2026-10-13 |
| Owner | Codex — PM / architecture |
| Approval | Package creation authorized; proposal details tracked in DEC-001 |
| Classification | Internal working document |

| Risk | Consequence | Control / owner |
|---|---|---|
| Stale or incomplete disaster information | Misleading assessment | Source timestamps, unknown state, operational review / data owner |
| LLM invents a capacity or action | Incorrect decision | Code calculations, source checks, bounded roles / Claude |
| reAPI shares failing upstream | Backup also fails | Capability/provider diversity when permitted; code-only fallback / architect |
| Concurrent calls exceed cap | Unintended spend | Atomic reservations, retry/unknown-charge accounting / Claude |
| SQLite on ephemeral hosting | Lost state/audit or divergent writers | Durable cloud storage gate / architect |
| A checksum is mistaken for truth | Unsupported safety claim | Separate integrity, correctness and human review / Codex |
| Local reference differs from live SSOT | Stale behavior copied | Record reference hashes, reverify authoritative state / implementer |
| Shared source tool mutates another product | Cross-product damage/spend | Read-only references; never run imported tools blindly / all agents |
| Unclear data licence | Unusable public release | Per-dataset provenance and permitted-use review / data owner |
| Too much scope before deadline | No working demonstrator | WO-001 first, feature cut by evidence / PM |
| Provider model IDs/prices change | Failures or unexpected billing | Versioned registry, current capability/pricing check / Gemini |
| Novel terminology obscures product | Weak handover or pitch | Standard public technical terms / PM |
| Self-review is mistaken for independent audit | Overstated assurance | Record reviewer independence and unresolved gaps / Codex |
| Local paths/private references published | Unintended disclosure or broken onboarding | Public provenance edition, redact host-specific details / release owner |

No initial product risk has been closed by implementation testing. This is a planning register.


