# AEG-PLN-003 — Public "Assist" module for the 18 October submission

| Field | Value |
|---|---|
| Document ID | AEG-PLN-003 |
| Revision | 0.4 (WORKING_PLAN, not approved) |
| Date | 2026-10-14 |
| Owner | Claude (engineer); Luna researches sources; the owner decides scope and deploys |
| Inputs | Inbox 0016 (product blueprint), 0017 (atomic architecture), owner answers of 2026-10-14 |
| Deadline | 2026-10-18 (four working days including today) |

## 1. Decisions taken from the owner's answers

| Question | Answer | Consequence |
|---|---|---|
| Deadline | Done by 18 Oct | Scope is cut hard (section 3); a frozen build on 17 Oct, 18 Oct is buffer and submission |
| Relation to the NGO tool | A public front end for the same Aegis (the blueprint) | One repository and one card model; the public path is separate, read-only and has no login |
| Clinical reviewer | Later, not now | **No CPR instruction ships as real guidance until a reviewer signs it** (section 4) |
| Platform | Web app, at least mobile responsive | No native app, no Wallet passes in this phase |
| Market | Malaysia and ASEAN | Content sourced from Malaysian authorities first; English plus Bahasa Malaysia; numbers 999 and 112 to be sourced |

## 2. What it is

A public, no-login, mobile-first page ("Assist") that shows **sourced emergency cards** for a location scenario, with offline use, a CPR-rate beat generator and an opt-in spoken coach. It reuses the existing card model and look of the NGO workspace. It contains no tenant data and no AI free-text.

## 3. Scope for 18 October

| In | Out (not this phase) |
|---|---|
| Public Assist page, mobile responsive, keyboard and screen-reader usable, minimum touch target 48 px | Apple/Google Wallet passes |
| Flash-flood first-help card for a synthetic Kuala Lumpur / Selangor scenario, every line tied to a source | Live geofencing and device location (consent and retention are undecided) |
| Do / Don't panel, nearest-shelter block from synthetic data, emergency numbers | Real alert feeds (researched by Luna, mocked here) |
| Offline use: service worker caching the page, cards and audio | Push updates |
| 100 to 120 BPM metronome (Web Audio) with a visible beat | Native iOS or Android app |
| Opt-in spoken coach using the browser's speech synthesis, started by an explicit tap | Server-side text-to-speech |
| Cardiac-arrest card and coach as a **DRAFT demo**, off by default in any public deployment (section 4) | Medical claims, "certified" language |
| Disclaimer footer on every view; a "Call 999 / 112 first" line on every card | Accounts, tracking, analytics |
| Feature flags in the server config (fail closed) | A JSON config file the browser can edit |
| Tests: content-source rule, offline, metronome timing, mobile Playwright, smoke script | AI chat on the public path |

## 4. Safety rules (non-negotiable)

1. **Every instruction line in a card has a source ID.** A test fails the build if a line has none, or if its source status is not `SOURCED`. A line without a source cannot be rendered in a public build.
2. **Cardiac-arrest content is `DRAFT_UNREVIEWED`** (no clinical reviewer yet). It is controlled by a server-side flag `AEGIS_ASSIST_DRAFT_MEDICAL`, default **off**. When on, the page shows a fixed banner "Demo content, not reviewed by a clinician, not for real emergencies". The owner decides whether the judging build turns it on.
3. Step 1 on every card is to call the emergency number. The numbers used (999, 112) must be sourced from an official Malaysian page before release.
4. Flood advice such as "switch off power" is written only as the authority's own wording, with its condition (for example "only if safe and dry"), never as an unconditional order.
5. No claim about Wallet, App Store or Google Play policy is made anywhere until Luna has read the primary documents.
6. The public path has no login, no cookies, no analytics, rate limiting, and no access to the authenticated API or the database beyond static content.

## 5. Design

- **Content table:** `content/assist/*.json`. Each card has `id`, `language`, `hazard`, `severity`, lines `{ kind: step|do|dont|contact, text, sourceId, condition? }`, and a `sources` list `{ sourceId, publisher, url, accessed, status: SOURCED | DRAFT_UNREVIEWED, passage }`.
- **Route:** one read-only endpoint (for example `GET /public/assist/cards`) serving only static, validated content with caching headers; the UI also ships the same JSON for offline use.
- **UI:** a new `Assist` view in `ui/src` using the existing card look. Atomic naming from 0017 is adopted for new components only (no rewrite of existing ones).
- **Audio:** the metronome schedules beats with the Web Audio clock (not `setInterval`), 110 BPM default, 100 to 120 adjustable; spoken coach through `speechSynthesis`, started by tap, always with a text equivalent on screen.
- **Config:** new keys in the existing env config (`AEGIS_ASSIST_ENABLED`, `AEGIS_ASSIST_DRAFT_MEDICAL`), validated and fail-closed like the others.
- **Repositories:** the public-versus-private split follows inbox 0012. A runtime flag is not a security boundary, so anything proprietary stays out of the public build rather than hidden by a flag.

## 6. Day plan

| Day | Engineer | Luna |
|---|---|---|
| 14 Oct (today) | This plan; register; Luna batch 10 issued; content schema and the source-rule test | Sources: Malaysian flood guidance, emergency numbers, alert-feed terms |
| 15 Oct | Assist view, flood card, do/don't, shelter block, disclaimer; mobile layout | CPR guideline primary text saved for the future reviewer; Wallet and store claims from primary documents |
| 16 Oct | Offline service worker; metronome; spoken coach; draft-medical flag; Bahasa Malaysia strings from sourced text | Review of translations against sources |
| 17 Oct | Tests, Playwright mobile viewport, accessibility pass, owner deploys, smoke test; **feature freeze** | Fix list from my verification |
| 18 Oct | Buffer, submission package, README section | none |

## 7. Acceptance for 18 October

1. The Assist page loads on a 360 px wide screen with no horizontal scroll and 48 px touch targets.
2. The flood card shows only lines whose source IDs resolve to `SOURCED` entries; the test proves a missing source fails.
3. With the network off after the first load, the page, cards and beat still work.
4. The beat stays within 100 to 120 BPM, measured by a test against the audio clock.
5. The spoken coach never starts without a tap.
6. The draft medical content is invisible when the flag is off, and the banner is visible when it is on.
7. Disclaimer and the emergency-number line appear on every view.
8. `node tools/ci.mjs` passes, and the smoke script passes against the deployed URL.

## 8. Risks

| Risk | Handling |
|---|---|
| Unreviewed medical content causing harm | Section 4 rules 1 to 3; default off; fixed banner |
| Four days is too short | Hard scope cut; the flood card is the core, CPR is the stretch |
| Source texts not found in Bahasa Malaysia | English first; BM only from sourced text, otherwise English is shown |
| Browser speech voices missing for Malay | Text equivalent always shown; test records which voices exist |
| Deployment not ready by 17 Oct | The owner starts the Cloud Run steps on 15 Oct; the local build is the fallback demo |
| Location privacy | No device location in this phase; scenario picker only |

## 9. Open decisions for the owner

1. Is the judging build allowed to turn the draft CPR demo on (with its banner), or does it stay off?
2. Which hackathon or grant is it, and are there format rules (video, repository link, licence)?
3. English only, or English plus Bahasa Malaysia on day one?

## 10. Decisions of 2026-10-14 (revision 0.2)

| Open decision (section 9) | Owner's answer | Effect on this plan |
|---|---|---|
| CPR demo in the judging build | **Off** | No cardiac content is built, shipped or shown in this phase. The flag `AEGIS_ASSIST_DRAFT_MEDICAL` stays default off and unused. The 100 to 120 BPM beat exists only for CPR, so it is **out of scope** too. The spoken coach stays and reads the flood cards. |
| Language | **English only** | No Bahasa Malaysia in this phase. |
| Workers | Several parallel AI workers, each named Luna | Luna II is the current worker; new workers are Luna III, IV, V and so on. Each owns separate paths and note numbers (section 11). |

Full-beta scope requested by the owner for 48 hours: everything in section 3 except the CPR items, real Wallet passes and live location. Wallet is built to "ready for credentials" only if time allows; live location needs a consent decision first.

## 11. Workers, paths and note numbers

| Worker | Task | Owns (only these paths) | Notes |
|---|---|---|---|
| Luna II | Sourced flood content, emergency numbers, shelter data format, alert-feed terms | `research/assist/**`, `content/assist/**`, `docs/99-inbox/R0020` to `R0039` | L0022 to L0029 |
| Luna III | Assist page UI (atomic components) | `ui/src/assist/**` except `audio/` and `pwa/` | L0030 to L0039 |
| Luna IV | Offline: service worker, manifest, cache rules | `ui/src/assist/pwa/**`, `ui/public/**` | L0040 to L0049 |
| Luna V | Spoken coach (speech synthesis reader) | `ui/src/assist/audio/**` | L0050 to L0059 |
| Luna VI | Wallet and store-policy research from primary documents; unsigned pass generator spec | `research/assist-wallet/**` | L0060 to L0069 |
| Engineer | Contract, public route, config flags, integration, tests, CI, deploy, verification | everything else | S notes |

Nobody except the engineer edits `package.json`, `src/config/config.ts`, `ui/src/App.tsx`, `ui/src/styles.css`, `src/assist/contract.ts` or `tools/**`. Merge gate: `node tools/ci.mjs` passes.

## 12. Scope change of 2026-10-14: Singapore and Indonesia, and haze (revision 0.3)

The owner added Singapore and Indonesia because of the recent regional haze.

| Item | Decision |
|---|---|
| Countries | Malaysia (MY), Singapore (SG), Indonesia (ID). The contract now has `country` (missing means MY). The page has a country choice made by the visitor, remembered in the browser, with no device location. |
| Hazards | `haze` added next to `flood`. `cardiac` stays off. |
| Emergency numbers | Each country's number must be sourced from that country's own authority before a contact line appears for it. Until then the page for that country says there is no checked guidance yet and tells the visitor to call their local emergency number, with no number shown. No number is taken from memory. |
| Haze content | Only official wording and bands from each country's authorities (for example the air-quality index bands and the health advice they publish) and from the ASEAN haze centre for regional context. Health advice (masks, staying indoors) is quoted verbatim with the authority's own condition. It is public-health guidance from an authority, not clinical advice, and is still labelled with the disclaimer. |
| Language | English only for the 18 Oct build, which limits reach for Indonesian speakers. Option for the owner: official Indonesian or Malay wording quoted verbatim as a card in its original language (no translation by us). Needs `language` values added to the contract and a spoken-coach decision, because the coach is English only. Not started. |
| Workers | Luna II researches SG and ID numbers, haze guidance for all three countries, and the ASEAN regional source. Luna III's UI is unchanged: country choice and filtering are in the engineer-owned route. |

## 13. Release hold (supervisor decision of 2026-10-14, revision 0.4)

Astra: keep release held pending review of contextual accuracy, country-specific emergency routing and source applicability; saved quotations alone do not establish safe guidance.

- **Mechanism (in code):** `records/releases/assist-release.json` is `HELD`. A cloud build serves no Assist content (503 `E_RELEASE_HELD`) until the record is `APPROVED` with reviewer, date, evidence reference and the exact content hash from `npm run assist:hash`. Any card change cancels the approval. A private preview (`AEGIS_ASSIST_PREVIEW=true`) shows the content with an "under review, not approved" banner; local and test runs show the same banner. Tests cover held, missing, incomplete, stale and approved records.
- **Review evidence:** `tools/assist-review-dossier.py` generates S0013, a per-line table with the source section, the text before each quotation on the saved page, and engineer flags. It decides nothing.
- **Consequence for 18 October:** the public release needs a recorded review decision first. Until then the hosted build can run only as a private preview.
