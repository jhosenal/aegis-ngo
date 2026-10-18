---
name: aegis-oag-governance
description: Apply OAG capability routing, lifecycle evidence and isolated product audit patterns when designing or reviewing Aegis integration.
---

# Aegis OAG governance reference

Read [cross-project map](../../../docs/05-references/AEG-REF-001_cross-project-methods.md) and [audit contract](../../../docs/04-assurance/AEG-AUD-001_integrity-and-release-evidence.md).

Locate OAG at the configured reference root (initial machine: E:/OAGv0.7). Read its .agents/AGENTS.md and VERSION first, then only the required skill:
- windows-environment for commands;
- dna-seal for integrity semantics;
- deploy-module only for a separately authorized OAG code change;
- three-env-sync before OAG environment/deployment discussion.

Aegis is an independent workspace. OAG core code_modules is its authoritative code store; its sps files are mirrors. Verify DB/source agreement before claiming current runtime behavior.
Inspect sdlcWizard/factoryConsole for artifact and product-lifecycle schemas. Prefer registered routes and PABX delegation over direct DB coupling.
Keep Aegis's product chain independent; never append to Audit's or core's chain as a substitute. Product registration is pending.
Recompute evidence hashes and require actual test outcomes; a supplied gate score/root is insufficient.
Do not run source seal/deploy tools to seal this documentation package. Core ledger/version changes require a real authorized core change and current SOP reconciliation.
Deliver an Aegis contract/adapter design or audit finding, with source hash and limitations. Do not claim a binary Merkle proof from a combined digest or hash chain.

