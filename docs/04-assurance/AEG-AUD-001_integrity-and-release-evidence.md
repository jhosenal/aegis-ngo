# AEG-AUD-001 — Integrity, OAG audit and release evidence

| Control field | Value |
|---|---|
| Document ID | AEG-AUD-001 |
| Revision | 0.1 |
| Status | WORKING_BASELINE |
| Date | 2026-10-13 |
| Owner | Codex — PM / architecture |
| Approval | Package creation authorized; proposal details tracked in DEC-001 |
| Classification | Internal working document |

## Three distinct evidence layers

1. **Documentation snapshot:** file hashes for this handover, with a manifest and independent root receipt. Does not register an OAG product or prove code works.
2. **Product runtime chain:** Aegis workflow events linked and sequenced within its own product/tenant boundary.
3. **Release baseline:** exact source/build artifact, requirements, executed tests, review disposition and release authorization, linked to the product lifecycle.

OAG uses several integrity constructions. Its combined DNA root is SHA-256 over concatenated per-file hexadecimal digests; lifecycle records use a previous-hash chain. Neither construction alone is a binary Merkle tree with inclusion proofs. Label each accurately.

## Initial documentation snapshot specification

Algorithm: SHA-256 over exact UTF-8 file bytes. File paths are normalized relative paths with forward slashes and sorted by ordinal string order.
Manifest lists path, byte length and lowercase hex SHA-256. `combinedDnaRoot` = 0x + SHA256(UTF8(concatenated file hashes in listed order)).
To bind paths and lengths, `pathBoundRoot` = 0x + SHA256(UTF8(each listed path + TAB + decimal length + TAB + hex digest + LF)).
The manifest and its SHA-256 receipt are excluded to avoid self-reference. No document embeds its own hash.
An adjacent receipt detects ordinary drift but is not a trusted external anchor if an attacker can replace both. Anchor the approved root in an independently controlled signed/tagged release or OAG lifecycle when integration is available.
The helper reports integrity only. New files are outside the initial snapshot unless listed; this must not be interpreted as coverage of later code.

## Proposed runtime event envelope

Fields: eventId, productId, tenantId, sequence, previousHash, eventType, actorIdentity/role, occurredAt, workflowId/version, inputSnapshotHash, resultHash, policy/formulation versions, payloadHash and correlation/idempotency key.
Define canonical serialization and hash version, including Unicode, numeric encoding, null treatment and field ordering. Do not rely on unconstrained JSON.stringify order across languages.
Assign sequence/previousHash under a transaction and enforce uniqueness. Commit result plus audit entry atomically or with an explicit recoverable outbox.
Hash = SHA256(domain/version prefix + canonical event excluding current hash). Store current hash separately.
First event uses a documented genesis value. Validate product/tenant and complete sequence during replay.
Restricted append-only application/database permissions do not make administrator rewriting impossible. Check trusted checkpoints, backups and signatures.

## True Merkle proofs, if required

Specify leaf construction, ordering, domain separation, duplicate handling, odd-node behavior and proof format in an ADR before claiming inclusion proofs.
Do not retrofit an untested “Merkle” label onto the OAG-compatible combined digest. Actual integration must preserve the current OAG wire format; use an adapter if Aegis's event format differs.

## OAG registration and release

Read current canonical instructions and source/version; code_modules in OAG engine.db is authoritative, sps is its audit mirror.
Formal child registration is pending. The expected model is a dedicated product lifecycle chain; validated core patches use I_factory_patch and enter that child's chain.
Before invocation, verify actual route schema/permissions and product ID, artifact/root and review evidence. Do not directly insert into core DB or borrow OAG Audit's chain.
Verify hashes locally, submit via authorized lifecycle route, then read back the recorded product event and reverify. A refused/unavailable integration leaves status unregistered, not “sealed.”
Do not advance a published patch ledger ahead of the authoritative database record.

## Audit checklist

Recalculate a representative result independently; inspect source timestamps/units.
Try permission bypass, model-injected route, stale context, duplicate action, concurrent budget calls and process interruption.
Modify a sealed artifact; delete/reorder chain entries; verify detection against trusted root/sequence.
Confirm model call failure cannot erase a code result or duplicate an action.
Keep findings, resolutions and residual risk linked to the exact build. Integrity does not establish factual correctness, safety, ISO conformity or legal compliance.


