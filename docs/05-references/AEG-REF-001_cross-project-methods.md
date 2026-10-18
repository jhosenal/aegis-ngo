# AEG-REF-001 — Cross-project methods, skills and tools

| Control field | Value |
|---|---|
| Document ID | AEG-REF-001 |
| Revision | 0.1 |
| Status | WORKING_BASELINE |
| Date | 2026-10-13 |
| Owner | Codex — PM / architecture |
| Approval | Package creation authorized; proposal details tracked in DEC-001 |
| Classification | Internal working document |

## How to use references

These are local development references, not runtime dependencies and not permissions to execute external tools. Source paths are machine-specific locators, not paths to hardcode into Aegis.
Read the source project's instructions first; inspect only relevant files. Capture source hash/version when adapting a method. A hash establishes the inspected local bytes, not deployment state.
The [source snapshot](AEG-SRC-001_local-reference-snapshot.json) records selected local reference paths and hashes. Resolve missing paths from the user's configured project roots; never substitute an unrelated repository.

## OAG: governance, capability routing and integrity

Root: E:/OAGv0.7. Read [.agents/AGENTS.md](E:/OAGv0.7/.agents/AGENTS.md) and VERSION.
- [Windows environment skill](E:/OAGv0.7/.agents/skills/windows-environment/SKILL.md): Windows command/runtime constraints.
- [DNA seal skill](E:/OAGv0.7/.agents/skills/dna-seal/SKILL.md): per-file hashes, combined root and recorded gate mechanics.
- [Module deployment skill](E:/OAGv0.7/.agents/skills/deploy-module/SKILL.md): source mirror -> DB -> restart -> verification; applies only when actually changing OAG core.
- [Environment sync skill](E:/OAGv0.7/.agents/skills/three-env-sync/SKILL.md): read before discussing/changing OAG environments.
- scripts/sdlc-gate.cjs: registration behavior; inspect, do not execute for this package.
- sps/CSCI-ARC-00_v<version>/VLAN_0_Core/sdlcWizard.ts and factoryConsole.ts: locate using root VERSION; verify against engine.db code_modules before claiming authoritative/runtime behavior.

Transfer: registered routes, controlled delegation, evidence gates, isolated child lifecycle and integrity verification.
Do not transfer core deployment paths, ports, shared credentials or force/default-pass behavior. The core DB remains OAG's SSOT; Aegis has its own source and data.

## QZEEX: role workers, financial checks and cards

Root: E:/SOOS_QZEEX_v0.8.3. Read [AGENTS.md](E:/SOOS_QZEEX_v0.8.3/AGENTS.md), NEXT_AGENT_START_HERE.md, PROJECT.md and current session/coordination notes.
- [CFO SOP](E:/SOOS_QZEEX_v0.8.3/07_REFERENCES/LLM_CFO_SOP.md): intake, independent arithmetic, assumptions, costs and review outcomes. This is a draft design; not all steps are implemented.
- [board.ts](E:/SOOS_QZEEX_v0.8.3/tools/runner/desk/seats/board.ts): conditional role calls, code-built facts and text validation.
- [client.ts](E:/SOOS_QZEEX_v0.8.3/tools/runner/desk/seats/client.ts): bounded reAPI transport and capability-specific parameters.
- [budget.ts](E:/SOOS_QZEEX_v0.8.3/tools/runner/desk/seats/budget.ts): usage ledger; adapt with atomic reservations.
- [router.ts](E:/SOOS_QZEEX_v0.8.3/tools/runner/desk/router.ts): local fast paths and constrained language routing.
- tools/runner/desk/seats/prompts.ts and validate.ts: structured role boundaries.
- tools/formula_registry/: formulation/lexicon methods; source-to-materialized-registry distinction.
- 07_REFERENCES/WORK_ORDER_015B_REPORT.md and WORK_ORDER_016_REPORT.md: observed cost and output-cap lessons.

Transfer: code facts before model commentary; independent numerical checks; role/cost budgets; source-linked cards.
Do not inherit live-trading authority, local model names/prices without rechecking, deployment scripts, production keys, or proprietary dataset publication rights.
Known gap: parallel calls check affordability before reserving; Aegis requires atomic reservations. Current inspected transport is reAPI, not Google-primary failover.
Some QZEEX documentation identifies GitHub/hosted state as authoritative. These references are local inspection evidence only.

## Storyboard: engine training, formulations and reusable chat tools

Root: E:/OAG_Storyboard. Read [AGENTS.md](E:/OAG_Storyboard/AGENTS.md), START_HERE.md and current HANDOVER.md. Older startup notes may lag the latest code.
- [chat.ts](E:/OAG_Storyboard/src/modules/chat/chat.ts): local capabilities, revisioned facts/cards and formulation IDs.
- [library.ts](E:/OAG_Storyboard/src/modules/formulations/library.ts): explicit calculation/formulation catalogue.
- [lexicon.ts](E:/OAG_Storyboard/src/modules/registry/lexicon.ts): domain vocabulary registration.
- [agent.ts](E:/OAG_Storyboard/src/modules/agent/agent.ts) and tools.ts: bounded tool loop and code-controlled operations.
- [thresholds.ts](E:/OAG_Storyboard/src/modules/learning/thresholds.ts), trials.ts and tests/app/learning.test.ts: outcome evidence and threshold estimation.
- tools/chat-turn.mjs and tools/inspect-chat.mjs: tool patterns; inspect effects before execution.
- HANDOVER.md and rendering modules: potential demo-production tool, subject to its own budgets and user instructions.

Transfer: explicit registered functions, stable context revisions, measured local computations, candidate improvements evaluated against actual outcomes.
Do not assume the complete recipe-learning engine is implemented. Threshold estimation from small samples does not establish field validity.
Storyboard may prepare a sub-three-minute Aegis demo later. No rendering, media generation, publishing or use of Storyboard's existing budgets is authorized merely by this reference.

## Reuse workflow

Identify a required capability -> inspect source + current authority -> record what is design vs implementation -> adapt minimal concepts/interfaces into Aegis -> register definitions/SOP -> test -> record provenance and audit evidence.
Methods and tools can be referenced without copying their entire code. For code or dataset reuse, record origin, licence/owner permission and competition disclosure accurately.


