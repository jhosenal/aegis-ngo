# AEG-GOV-001 — Document and record control

| Control field | Value |
|---|---|
| Document ID | AEG-GOV-001 |
| Revision | 0.1 |
| Status | WORKING_BASELINE |
| Date | 2026-10-13 |
| Owner | Codex — PM / architecture |
| Approval | Package creation authorized by user; detailed proposals subject to recorded decisions |
| Classification | Internal working document; review references before public distribution |

## Convention

Controlled document filename: `AEG-<TYPE>-<NNN>_<lowercase-kebab-title>.<ext>`. Example: `AEG-ARC-001_system-blueprint.md`.
The stable ID is never reused. Revision is metadata, not part of the working filename, so links survive revisions. Immutable exported baselines use `AEG-BAS-<NNN>_<YYYY-MM-DD>_manifest.json`.
Folders use ordered lowercase categories. README.md, AGENTS.md, CLAUDE.md, GEMINI.md, HANDOVER.md, SKILL.md and tool filenames are explicit discovery/tooling exceptions.
Use UTF-8, LF, ISO-style date YYYY-MM-DD; machine event timestamps include UTC Z or an explicit offset. Store event occurrence and ingestion times separately.
Use stable requirement AEG-REQ-NNN, test AEG-TST-NNN, decision AEG-DEC-NNN and work order AEG-WO-NNN identifiers.

## Controls

The register identifies each controlled document, owner, revision, status and path. Markdown files contain their metadata; CSV registers use register metadata to avoid mixing prose and tabular records.
Statuses: DRAFT, WORKING_BASELINE, REVIEWED, APPROVED, SUPERSEDED. Initial WORKING_BASELINE is usable for reversible implementation; it is not human sign-off or product certification.
Record material changes with reason, affected requirements, author, reviewer and evidence in the work log or an ADR. Supersede records; do not silently rewrite release evidence.
Release approval identifies exact artifact/hash and approving actor. Keep permissions separate from document status.
Maintain original evidence and redacted publication copies separately. Apply data-specific retention/deletion policies; do not claim indefinite retention is universally appropriate.

## Standards reference and limits

This is a project-defined naming convention, not a universal ISO filename syntax. We use identification, revision, ownership, traceability and review controls.

Public ISO material checked 2026-10-13:
- [ISO/IEC/IEEE 15289:2019](https://www.iso.org/standard/74909.html): lifecycle information/documentation reference; catalogue says confirmed in 2025, revision work exists.
- [ISO/IEC/IEEE 12207:2026](https://www.iso.org/standard/90219.html): current software lifecycle process reference; it does not prescribe a single lifecycle model.
- [ISO documented-information guidance](https://www.iso.org/iso/documented_information.pdf): historical ISO 9001:2015 guidance, used only as background.

OAG is our chosen engineering/governance method. These references inform organization; no full licensed-standard assessment or ISO certification has been performed. OAG is not an official successor named PRINCE3. Record the edition and scope before making a future conformity claim.


