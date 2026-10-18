---
name: aegis-storyboard-learning
description: Adapt Storyboard formulation registries, local chat tools and evidence-driven candidate evaluation for Aegis; consult it for later demo-authoring integration.
---

# Aegis Storyboard engine reference

Read [engine contracts](../../../docs/02-architecture/AEG-CON-001_engine-contracts.md) and [reference map](../../../docs/05-references/AEG-REF-001_cross-project-methods.md).

Initial local root: E:/OAG_Storyboard. Read AGENTS.md, START_HERE.md and current HANDOVER.md. References may describe different implementation dates; use code and actual evidence to resolve drift.
Inspect chat/chat.ts, formulations/library.ts, registry/lexicon.ts, agent/agent.ts and agent/tools.ts for local capabilities and bounded model access.
Inspect learning/thresholds.ts, trials.ts and tests/app/learning.test.ts for measured feedback and candidate evaluation.
Transfer the principle: register capabilities and definitions; preserve revisions; measure outcomes; evaluate candidates before activation. Do not copy domain-specific media thresholds into humanitarian decisions.
Keep known commands in local code. Bound any language/tool loop, validate arguments and preserve missing inputs rather than invented defaults.
Do not claim full automatic recipe learning from a threshold-estimation module. Use held-out evidence and rollback.
Storyboard tooling may later create the Aegis demonstration video. Inspect side effects, source asset permissions and budget requirements before running a tool; its previous paid-call allowances do not transfer.
Record conceptual/code reuse in PRV-001. Do not modify Storyboard while implementing Aegis.

