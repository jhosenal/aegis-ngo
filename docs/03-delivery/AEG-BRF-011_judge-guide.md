# AEG-BRF-011 — Judge and developer guide

Date: 2026-10-19 | Status: review update | Scope: AI Builder Cup 2026 prototype

## Submission links

- [Live prototype](https://aegis.walkingwithai.com/assist)
- [Demo video](https://youtu.be/y8nBXJLnKXA)
- [Public repository](https://github.com/jhosenal/aegis-ngo)
- Theme: Sustainability & Social Impact — fragmented disaster information and multilingual emergency communication across ASEAN.

## Suggested walkthrough

1. Open the public map. Select a country and inspect an incident's source and timestamp.
2. Open the historical archive. Broaden the date/hazard filters if the selected category has no records. A zero count is not proof of missing ingestion.
3. Select EN/CN/BM/TA. Available subtitle translations follow the selection; the prerecorded example voice remains English.
4. Sign in with Google to try workspace chat. First-time users accept terms/privacy and receive the standard tier. Model answers are subject to runtime caps and service availability.
5. For Pro/Admin location tools, use `show Gombak` or a name present in stored monitoring/essential-place data. A matched area is approximate; a named facility is not a verified service-availability claim.
6. Use the demo video to review the privileged draft/validation/approval workflow. No shared admin or Judge Trial password is published. A standard account does not gain operational privileges by switching UI tabs.

Google consent-screen test-user restrictions, if still active, may prevent a new evaluator from signing in. This review did not independently verify first-time Google consent or a paid model response. The video provides a demonstration, not proof that every hosted feature is available to every account.

## Local reproduction

Run the README commands with no keys to inspect the source and synthetic local workflow. A new local database is migrated and seeded by the API startup. The local preview identities are development-only and must not be enabled in a public cloud deployment.

For live integrations, use your own project and configure the relevant settings. `AEGIS_PROVIDER_MODE=live`, `AEGIS_MODELS_ENABLED=true`, `AEGIS_PRIMARY_PROVIDER=google` and a supported Google model/key are only part of the configuration: current price metadata, spending authority and positive account/day/task budgets are also validated. Do not copy someone else's limits or treat example deployment YAML as the current hosted configuration.

Google sign-in requires an OAuth client, the exact callback URI at the intended origin, and a canonical `AEGIS_PUBLIC_BASE_URL`. Map display requires a restricted Maps browser key. Translation/TTS require their own switches and project access. Keep server secrets out of source and browser bundles.

The shipped welcome video works from the source export. The hosted example-news media is omitted; building this export does not reproduce that optional recording. `records/sources/` is intentional public provenance input for hash tests, not private runtime state.

## How to interpret the evidence

The deck's historic model evaluations and timings refer to specific local runs. They are not an overall AI-accuracy score, a field validation or an invoice. Current review results are in [AEG-QC-001](AEG-QC-001_submission-review.md). Human language review, durable hosting storage and operational validation remain open work.
