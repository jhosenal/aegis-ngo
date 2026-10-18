# AEG-ENG-005 — Schedule and scope cuts

| Field | Value |
|---|---|
| Document ID | AEG-ENG-005 |
| Revision | 0.1 |
| Status | WORKING_BASELINE |
| Date | 2026-10-13 |
| Owner | Claude (engineer) |
| Approval | Authored under owner direction (AEG-ADR-001); not independently audited |
| Classification | Internal |

Baseline fact from `docs/00-governance` (DEC-005 and the hackathon record): submission deadline is 2026-10-18; the time zone is not confirmed. Today is 2026-10-13. Plan as if the deadline is **2026-10-17 23:59 Malaysia time** and treat 10-18 as buffer only. The owner confirms the real deadline and time zone.

## 1. Priority tiers

| Tier | Cards | Why |
|---|---|---|
| MUST (the demo does not exist without these) | TSK-000 to TSK-010, TSK-012 (local router part), TSK-013, TSK-014, TSK-019, TSK-020 | Working slice, tenant isolation, calculation, audit, UI, a real Google AI function, a hosted URL |
| SHOULD | TSK-011 gateway failover, TSK-015 browser tests, TSK-018 traceability | Robustness and honest evidence |
| COULD | TSK-016 fetch-guard and extended security suite, TSK-017 evaluation boundary | Assurance depth |
| BLOCKED on owner | TSK-019, TSK-020, TSK-021 | Need keys, budget, price snapshot, cloud project |

Cut order when behind schedule: TSK-021, then TSK-017, then TSK-016, then TSK-015 (keep one smoke browser test), then depth of TSK-011. Never cut: tenant isolation, audit chain, synthetic labels, honest provider status, the shortfall calculation tests.

## 2. Day plan

| Day | Date | Programmer cards | Engineer and owner actions |
|---|---|---|---|
| 1 | Oct 13 | TSK-000 to TSK-005 | Owner installs Node 22+, gives Luna the repo. Engineer reviews each card. Owner supplies items for TSK-019/020 (below) |
| 2 | Oct 14 | TSK-006 to TSK-010 | Engineer writes the Google adapter spec after checking current documentation with the owner's key |
| 3 | Oct 15 | TSK-011, TSK-012, start TSK-013 | Owner creates the cloud project and budget cap |
| 4 | Oct 16 | TSK-013 to TSK-015, TSK-019 | Engineer reviews live call evidence |
| 5 | Oct 17 | TSK-020, TSK-016 or TSK-017 if time, TSK-018 | Freeze at 18:00 MYT. Codex or owner smoke test. Demo video |
| 6 | Oct 18 | none | Buffer and submission only |

## 3. What the owner must supply (nothing here is invented by the build)

1. Confirmed deadline and time zone, and the exact submission artifacts (URL, repository, video, deck).
2. Google AI credentials: API key, the model identifier to use, current price per million input and output tokens (the engineer records a dated price snapshot), and a hard daily and total budget in USD. Without these the app stays in stub mode and must say so.
3. A cloud project with billing and a spending alert for the hosted demo (Cloud Run recommended). The owner runs deploy commands; the programmer only prepares files.
4. Permission to publish: Codex audit result and owner approval before the public URL is shared.

## 4. Honest status vocabulary for the submission

Use exactly: **implemented**, **fixture-tested**, **live-tested**, **hosted**, **pending**. The hosted demo uses synthetic data, ephemeral storage and one instance. Do not claim durability, scale, real operational readiness, third-party endorsement, or "Merkle proof". The Google-powered function must be genuinely live-tested before it is described as live.
