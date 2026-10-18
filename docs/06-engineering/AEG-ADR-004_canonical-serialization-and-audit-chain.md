# AEG-ADR-004 — Canonical serialization v1 and audit chain

| Field | Value |
|---|---|
| Status | accepted |
| Requirement IDs | AEG-REQ-005, AEG-REQ-012, AEG-REQ-017 |
| Refines | AEG-AUD-001 (runtime event envelope) |

## Canonical JSON v1

Defined by `src/engine/canonical.ts` (GOLDEN). Object keys are ASCII `[A-Za-z0-9_]+` and sorted ascending; no whitespace; strings are Unicode NFC and escaped as `JSON.stringify` does; numbers must be safe integers (decimals are encoded as strings); `null` allowed; `undefined`, `NaN`, Date and class instances rejected; arrays keep order; maximum depth 32.

Hash: `sha256_hex(domain + "\n" + canonical(value))`. Domains in use: `AEG-EVT-v1` (audit events), `AEG-INPUT-v1` (workflow/formulation input), `AEG-RESULT-v1`, `AEG-PAYLOAD-v1`, `AEG-EVIDENCE-v1` (raw and normalized evidence).

## Audit chain

One chain per `(productId, tenantId)`. Public evidence ingestion uses the chain `(AEG, SYSTEM)`. Sequence starts at 1. `previousHash` of the first event is 64 zeros. `hash` covers the event body (all envelope fields except `hash`). Sequence and previous hash are assigned inside the same immediate transaction that commits the business result. The table has triggers that reject UPDATE and DELETE.

## What this does and does not prove

- A hash chain detects edits, reordering and middle deletion. Tail truncation or a full rewrite is detected only against a trusted checkpoint (`{sequence, hash}`) stored outside the database.
- It is a hash chain, not a binary Merkle tree. Do not call it a Merkle proof. Do not claim inclusion proofs.
- Integrity is not correctness, safety or legal compliance.
- The frozen vectors are in `tests/unit/golden.test.ts`. Changing canonicalization requires a new ADR, a new hash domain version and new vectors.
