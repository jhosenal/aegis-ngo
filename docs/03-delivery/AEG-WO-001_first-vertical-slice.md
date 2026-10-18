# AEG-WO-001 — First local vertical slice

| Control field | Value |
|---|---|
| Document ID | AEG-WO-001 |
| Revision | 0.1 |
| Status | WORKING_BASELINE |
| Date | 2026-10-13 |
| Owner | Codex — PM / architecture |
| Approval | Package creation authorized; proposal details tracked in DEC-001 |
| Classification | Internal working document |

## Assignment

Implementation owner: Claude. Operational verification: Gemini. Audit: Codex.
Status: READY FOR LOCAL IMPLEMENTATION. No application implementation is supplied in the handover.

## Outcome

A user opens a synthetic incident card, supplies/attaches resource figures, receives a deterministic shortfall card, inspects its evidence and reopens the same persisted assessment after restart. The same workflow works with all models disabled.
Use 120 demand, 85 available, 5 reserve in the initial scenario; result usable 80, shortfall 40. Additional cases must not simply mirror this one happy path.

## Read

CHR-001, REQ-001, UXD-001, ARC-001, CON-001, CON-002, DAT-001, AUD-001 and VVP-001.
Read the OAG reference skill for registration/audit concepts, QZEEX skill for bounded workers and Storyboard skill for local chat/formulations.

## Delivery sequence

1. Record stack ADR, establish independent repository/dependency lock and proposed local port after checking for conflicts. Never stop another product to obtain a port.
2. Implement types, lexicon and versioned resource formulation, with invalid/unknown/unit mismatch handling.
3. Add source fixture adapter, explicit evidence snapshots, workflow registry and durable state.
4. Build nested cards and desktop/mobile workspace; distinguish pinning from attaching context.
5. Add local command route and provider interface with deterministic Google/reAPI stubs. Implement atomic budget reservation and bounded failover before paid calls.
6. Add product-local event chain/export verifier and a documentation of root semantics.
7. Execute mapped tests; prepare evidence and handover.

Suggested future layout: src/{engine,registry,providers,data,audit,api}, ui/, tests/{unit,integration,browser}, migrations/, tools/. These paths are suggestions; document deviations rather than creating empty directories now.

## Out of scope for this order

Actual disaster dispatch, payments, model training, mass market-history import, production OAG writes, cloud deployment and paid media generation.
Google live integration and public feeds follow the fixture slice when required accounts/capability choices are available.

## Definition of done

- REQ-001 through 013 and 015 have applicable local evidence; 017 has a completed traceability update.
- REQ-014 candidate/evaluation boundary documented; automatic promotion not claimed.
- Data and provider failure behavior exercised; no mock labelled live.
- No credential or private dataset in source/build artifacts.
- Restart recovers persisted local state; app works with models disabled.
- Desktop/mobile screenshots and interaction records demonstrate actual browser behavior.
- Audit findings resolved or explicitly carried; no release assertion solely from a checksum.
- HANDOVER.md provides launch/test commands that were actually run.

## Follow-on orders to create after this slice

WO-002: live source adapters and Google capability canary.
WO-003: approved reAPI canary and failure/reconciliation verification.
WO-004: durable cloud storage, deployment and demo packaging.
These are backlog proposals, not evidence of completed work or new paid authorization.


