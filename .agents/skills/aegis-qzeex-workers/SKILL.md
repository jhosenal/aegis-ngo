---
name: aegis-qzeex-workers
description: Adapt QZEEX bounded worker roles, evidence cards and cost-control patterns for Aegis model routing or resource review.
---

# Aegis QZEEX worker reference

Read [worker contract](../../../docs/02-architecture/AEG-CON-002_workers-and-provider-failover.md) and [reference map](../../../docs/05-references/AEG-REF-001_cross-project-methods.md).

Initial local root: E:/SOOS_QZEEX_v0.8.3. Read AGENTS.md and its canonical PROJECT.md, next-agent and coordination pointers before source inspection.
Inspect LLM_CFO_SOP.md for intended authority; board.ts/client.ts/budget.ts/router.ts for implemented behavior. Draft SOP features are not automatically present in code.
Keep roles independent of model names. Code supplies calculations, permissions and facts; model roles parse, explain and challenge.
Invoke only necessary roles. Preserve dissent and rejected-output evidence without presenting invalid text as fact.
Adapt transport behind an Aegis provider interface: current inspected QZEEX uses reAPI directly; Aegis adds Google-primary failover.
Fix before adopting: budget checks must atomically reserve before concurrent calls; all attempts/backup/uncertain billing count. Do not inherit a per-client throttle as a global account limiter.
Treat token estimates and model self-reported confidence as estimates, not guarantees.
For market history, read DAT-001 and inspect bounded schema/provenance queries read-only. Do not import trading authority or equate volatility with disaster risk.
Record reference hashes and adapted paths in PRV-001. Never execute QZEEX production/deployment/trading tools for this task.

