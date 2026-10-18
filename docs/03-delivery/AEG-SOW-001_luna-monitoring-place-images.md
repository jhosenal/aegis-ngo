# AEG-SOW-001 ? Luna: complete monitoring-place media

Revision: 0.2 | Status: WORKING_BASELINE | Date: 2026-10-17
Prepared by: SOL | Executor: Luna | UI owner: SOL | Backend owner: SNET
Authority: owner requested a media-research handoff before further card UI improvement. This is a local assignment, not deployment approval.

## Outcome

Audit all 125 monitoring-place cards and resolve every missing photo case. Supply a correct, freely licensed Wikipedia/Wikimedia image where one can be verified; otherwise record an explicit researched reason and retain the neutral fallback. Completion means 125 accounted-for places, not a fabricated 100% photo rate. Keep reusable lookup logic and provenance so future pins can follow the same process.

Read this entire SOW, then AEG-SOP-005. All instructions for this assignment are in these two documents and the referenced code/contracts. Claim the work in the work log before editing. Check current agent claims; do not overwrite concurrent changes.

## Read first (repository root E:/Aegis)

- AGENTS.md and HANDOVER.md; docs/00-governance/AEG-GOV-001_document-control.md.
- docs/03-delivery/AEG-SOP-005_place-image-research-and-verification.md.
- docs/99-inbox/C0015_snet-to-sol_place-photo-wikipedia-link.md and C0014_snet-to-sol_pin-card-design-mapping.md.
- fixtures/environment-pins.json (pin IDs, place names, countries/regions, coordinates).
- content/places/place-media.json (stored catalogue, not the public response shape).
- tools/fetch-place-media.ts; src/sources/wikiMedia.ts; src/services/placeMedia.ts; tests/unit/wiki-media.test.ts.
- records/reviews/AEG-MEDIA-HANDOFF-026_2026-10-16_inventory.csv (baseline queue, all 125; regenerate current counts before work).

## Observed baseline and first target

At preparation: 125 catalogue entries; 48 matched with images, 71 name_mismatch, 2 no_image, 4 no_article. Thus 77 lack a photo. These are stored statuses, not proof that every possible article was searched or every existing URL still works.

Priority 1: my-35, Cameron Highlands, Pahang, MY. Stored/API status is name_mismatch: the nearby hits were Tanah Rata, Brinchang and Mount Batu Brinchang. The resolver searches only articles within 5 km and stops when none has a matching title. Research the actual Cameron Highlands article by title; do not select one of the unrelated nearby hits just to fill the slot. The baseline is evidence of a search limitation, not evidence that Wikipedia lacks the place.

Priority 2: remaining name_mismatch/no_article, then no_image and broken existing images. Verify all 48 existing matches too. Paired names/canals/risk zones may legitimately have no article or exact image.

## Ownership and permitted implementation

Luna owns the media data/research work for this assignment: catalogue entries, documented candidate/alias decisions, the media fetch tool/resolver and their focused tests. Coordinate the backend-media file claim with SNET through the work log before writing shared backend files; keep the current public pin.media contract stable. Existing user authorization covers this scoped local implementation; do not ask the owner to reapprove routine matching/retry decisions.

SOL retains UI/UX: EnvironmentPopup.tsx, all CSS, card controls, close-button shape, layout, map/presenter and accessibility styling. Report UI defects; do not patch these files. The screenshot's oval close button is tracked for SOL after this handoff.

Do not change pin IDs/names/coordinates, hazard formulas, API permissions, telemetry or incident counts. Do not activate Google/paid providers, render video, deploy, or stop another agent's server/render/build. This SOW covers monitoring-place photographs; it does not authorize replacing hazard artwork or claiming a generic place photo depicts a particular live disaster.

## Deliverables

1. Updated content/places/place-media.json, preserving valid entries and the existing schema. Before editing, record a hash and retain a local backup under data/ (not a live DB).
2. An auditable research report under records/reviews/AEG-MEDIA-LUNA-001_<date>_review.md and a per-pin CSV: pinId, before/after status, article/file URLs, identity evidence, rejected candidates/reasons, creator, licence/deed URL, thumbnail verification time, decision/reason. Record exact-place versus broader-area illustration. Do not put HTML in captions.
3. Reusable, resumable tool improvements for exact-title/redirect/search fallback and explicit reviewed per-pin aliases if needed. Keep aliases/provenance in a separate documented data file if the existing schema cannot carry them. No ad hoc frontend image URLs or blanket matcher weakening.
4. Focused automated checks for added matching/retry/metadata behaviour and a summary of all 125 outcomes. No network in unit tests.
5. API handback: prove matching media is served for changed pins. The route reads the catalogue once when registered, so disk edits alone are not a live-service refresh. Coordinate restart of the owner-managed local service with SNET, or validate a disposable instance and mark :8787 refresh pending. Never claim the live API updated solely because a file changed.
6. Update HANDOVER/work/build logs and relevant registry/provenance records; run handover verification and make a new scoped evidence snapshot. Preserve old manifests.

## Acceptance / definition of done

- All current registry pins have a result row; before/after totals sum to the actual registry size (125 at handoff).
- Every accepted image is about the verified place, legally reusable under project policy, credited, and both compact/retina URLs checked to return an image. A title match alone is insufficient for ambiguous names.
- Transient network/429 results remain retryable, never relabelled no_article/no_image. Any unresolved candidate is documented honestly, with the next step.
- Known good matches are preserved or a replacement/rejection has a recorded reason. No unrelated locality, mall, station or mountain is substituted for a district/canal.
- Existing public media fields and neutral fallback still work; article link and attribution survive image failure.
- No downloaded photo binaries or base64 assets enter ui/public, docs or the deploy bundle; use Wikimedia thumbnail URLs. No secrets or telemetry dumps in evidence.
- Target my-35 is researched first and its actual result is explained. Do not guarantee it has a qualifying image before verifying it.

## Final message back to SOL

Give before/after photo counts, remaining reasons by status, my-35 result and URLs, files changed, tests/evidence paths, any API restart pending, and any UI issue seen. State research-complete / fixture-tested / API-tested / pending separately. Then release the media file claim so SOL can improve the card UI against stable data.

## Owner clarification ? 2026-10-17: landmarks and incident imagery

A verified landmark within, or clearly associated with, the named location may represent that location. It need not depict the exact monitoring coordinate. Verify its actual identity/location and label the landmark or subject explicitly, for example `Tea fields, Cameron Highlands ? Location illustration` or `Terminal 3, Changi Airport ? Location illustration`. Preserve the original monitoring coordinates and distinguish the landmark from the sensor point. Keep credit, licence, Commons file link and a truthful Wikipedia link. Do not choose an unrelated nearest landmark, invent coordinates or silently relax country/entity verification. This clarifies acceptable representative location imagery; it does not authorize a live-incident photo claim.

Separate image purposes in the reusable card: location/landmark image belongs beside the location heading; verified disaster photographs belong in a distinct incident/evidence section, with event relevance, source, capture/publication time when supplied and reuse rights. Do not place a landmark image under a disaster-photo label. Existing generic hazard artwork is an illustration and must be labelled as such in a separate illustration section, never passed off as a photograph of this incident. If no verified incident photo exists, do not fabricate one.

For remaining location-image cases, Luna may research landmark alternatives under this policy. Record landmark/subject name, verified association and illustration scope in the research evidence. Coordinate any additive caption/subject field with SNET: the current public media view does not expose the stored Commons description, and the frontend must not guess a landmark name from a filename. SNET still owns the nine coordinate-limited article decisions and Changi live refresh.

Multiple incident photos: render them in the separate incident/evidence gallery, with Previous (<) and Next (>) buttons and an image counter only when there are two or more photos. No automatic cycling. Caption, source/credit, licence and available capture/publication dates follow the selected image. A failed image retains its source and navigation. One image needs no arrows; no verified incident photos must not create a fake gallery.
