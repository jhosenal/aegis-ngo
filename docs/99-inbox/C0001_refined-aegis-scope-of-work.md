# C0001 — Refined AEGIS scope of work

| Control field | Value |
|---|---|
| Inbox ID | C0001 |
| Revision | 0.1 |
| Date | 2026-10-15 |
| Status | OWNER_DIRECTION_RECORDED / WORKING_SCOPE |
| Source | Owner supplied SOW in the AEGIS UI/news-reader conversation |
| Recorded by | Codex |
| Authority | Preserve this direction and use C0001 as the first record in this sequence. This note does not approve public release, broadcasting, paid generation or cloud deployment. |

The existing project folder is `docs/99-inbox/`; the owner's reference to “99_inbox” is filed here rather than creating a parallel inbox. C0001 starts this requested sequence. Existing A/L/S inbox records remain unchanged.

## Product direction

One AEGIS central engine serves two audiences. Registered code controls validation, source references, calculations, permissions, budgets and actions. AI helps explain or format validated material. GCP is the intended cloud deployment/integration direction; the current local app must not be presented as proof that every capability already runs on GCP.

```text
                     AEGIS CENTRAL ENGINE
                  deterministic / source-grounded
                              |
             +----------------+----------------+
             |                                 |
      PUBLIC / CITIZENS                    NGO / MEDIA
      accessibility first                  rapid release
      - offline emergency cards            - generated card drafts
      - audio + equivalent text            - short reel drafts (~30 sec)
      - captioned visual/video support     - reviewed channel packages
      - dynamic infographics               - verified audit trail
```

## 1. Public / citizens

Owner's requested capabilities:

- Modular emergency-help cards saved on a phone/browser and available after connectivity is lost.
- Audio output for people who benefit from listening, with a complete text equivalent.
- Sign/video and clear visual graphics for people who benefit from visual information.
- Dynamic infographics built from validated information.

Implementation requirements to carry into the work packages:

- Offline use requires an initial successful download. Show saved-at time, source/revision and stale-content status; do not imply live alerts, Google map tiles or remote services work offline.
- Maintain public content isolation from authenticated tenant records. Do not cache private workspace data into public service-worker caches.
- Use sourced, reviewed guidance with appropriate conditions. An AI model must not invent medical/emergency instructions or promote draft guidance into a released card.
- Audio is not itself an input method for non-speaking users. Retain usable text/touch input, keyboard navigation, readable text and accessible controls.
- Captions/transcripts support accessibility but are not sign language. Sign-language assets require suitable production, permission and review; generated presenter lip motion is not a sign-language substitute.

## 2. NGO / media — rapid media factory

Owner's intended workflow: an NGO supplies verified disaster data; AEGIS produces a consistent crisis-card package, audio/visual material and a short presenter reel, then prepares it for distribution.

Requested outputs:

- Auto-generated card drafts from validated incident/resource/evidence records.
- Approximately 30-second short reel drafts, using the presenter/avatar concept where appropriate.
- Audio/visual crisis cards and dynamic infographics.
- Packages for Facebook, WhatsApp, Instagram, website/RSS and related channels.
- A traceable audit trail connecting each output to its source record revisions, template, editor/reviewer, render/export and any eventual publication result.

Publication boundary: generate and preview drafts first. “Auto-broadcast” is the owner's desired later capability, not authorization to send messages or publish now. Channel credentials, platform permissions/terms, account ownership, human approval, rate limits, retries/idempotency, correction/retraction and channel-specific audience controls need explicit implementation and validation. A preview/export is not a successful broadcast. No social messages or releases were sent as part of recording this scope.

## Current state versus requested work

| Area | Current evidence / boundary |
|---|---|
| Engine/cards | Local deterministic workflows, versioned cards, source/evidence views and local audit exist; this does not independently verify an incident as true. |
| Public Assist | Existing public card route/UI and offline/service-worker code exist. End-to-end release/content coverage must be checked per card; this note does not certify universal offline availability. |
| Presenter | Transparent 2D presenter with cached introduction, opt-in controls, transcript and approximate audio-amplitude mouth movement exists. It is not a rigged 3D avatar or rendered talking-head reel. |
| Google | Live browser Maps is connected locally. Agent Platform authentication has passed; dynamic cloud speech remains unconnected. |
| Media factory | Arbitrary news-script authoring, source-bound reel generation, sign-language video and multi-channel publishing are backlog work. |
| Cloud/release | Earlier private deployment evidence is separate from the current local build. No new cloud deployment or release was performed for C0001. |

## Initial delivery sequence

1. **Public offline-card package:** inspect the existing Assist content/release and offline tests, identify one eligible non-medical card, verify sources/conditions, keyboard/text access, offline reload and stale-state behavior. Preserve source and revision in text/audio/visual exports.
2. **NGO media draft package:** define a versioned script/card contract referencing exact authorized source revisions; render a preview with provenance, uncertainty and synthetic labels. Keep approval separate from rendering.
3. **Cached reel pipeline:** take a fixed reviewed script, render/cache once, check audio/video/transparency and captions in supported browsers, and retain the source/template/output hashes. Repeated playback should not call a generation API. Download/hosting costs still need accounting.
4. **Channel adapters:** only after draft/export verification, implement approved per-channel publication, delivery receipts, retry/correction and access controls.

These are work-package starting points. C0001 records the SOW; it does not declare these packages implemented or accepted.

## Evaluation / funding rationale supplied by owner

The owner associates this direction with social impact/accessibility, practical NGO value and Google Cloud integration for the Google AI Builder Cup / grant strategy. Preserve that intended positioning. Statements about current competition eligibility, judging priorities, grant fit, free generation-tool availability, licensing or guaranteed zero hosting costs are unverified here and require the applicable current primary rules/terms before a submission or budget claim.

## Related records

- `docs/03-delivery/AEG-PLN-003_public-assist-module-18-oct.md` — existing public Assist/offline plan.
- `docs/02-architecture/AEG-CON-001_engine-contracts.md` — deterministic/AI responsibilities.
- `docs/02-architecture/AEG-DAT-001_data-and-provenance-plan.md` — data and provenance.
- `docs/03-delivery/AEG-SOP-002_cloud-and-model-spend-procedure.md` — spend controls.
- `records/reviews/AEG-NEWS-001_2026-10-15_review.md` and `AEG-NEWS-002_2026-10-15_review.md` — actual presenter capability and checks.

Next: use this record when scoping subsequent public accessibility/offline and NGO media work. Resolve per-package acceptance criteria against existing implementation before adding duplicate modules.
