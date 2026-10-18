# AEG-BRF-009 — Slide pack: master facts sheet (use this to settle any number)

| Field | Value |
|---|---|
| Document ID | AEG-BRF-009 |
| Revision | 0.1 (REVIEW_DRAFT) |
| Date | 2026-10-17, about 20:15 local |
| Written for | the owner, finalising the slides. **If a number in an earlier brief differs from this sheet, this sheet wins.** Every row says where the number comes from |
| Snapshot | **The FINAL seal is not made yet: put "final seal ID to be added" on the slides, then insert the ID of the last snapshot (expected `AEG-BAS-004`, made after SOL's map positioning, the stronger meaning checks and Dsol's verified deploy).** `AEG-BAS-003` (2026-10-17; combined root `0x973e11da10371b434956bfeeb9974391335117bf5e7bcf3c11e2890b51019cbf`; 1,545 files; strict check passed with 0 drift when made) is an **internal checkpoint** and will be superseded. Snapshots are documentation and evidence records, **not an OAG seal, not signed, not product acceptance** |

## 1. Which brief for which slide
| Slide topic | Brief (send this) | Extra file to attach |
|---|---|---|
| Problem and impact, personas, validation sprint | `AEG-BRF-005` | none |
| Judging criteria (Gemini, pipeline, evidence, architecture, testing and cost) | `AEG-BRF-004` | |
| ASEAN languages with Google (3 slides) | `AEG-BRF-006` | `records/e2e/2026-10-17_asean/*/*.png` cards |
| Gemini 4 Argon script review and its cost (2 slides and a backup) | `AEG-BRF-008` | `records/e2e/2026-10-17_argon/ui-suggest-wording.png` |
| The whole 15-page deck outline | `AEG-BRF-002` (see corrections in section 4) | |
| Script wording style | `AEG-BRF-007` | |
| Final Gemini wording (held) | `AEG-BRF-003` | |

## 2. Verified numbers
| Claim | Number | Source |
|---|---|---|
| Automated tests | **959** pass (unit and integration); typecheck clean | vitest run, 2026-10-17 |
| Monitored places | **125** (Singapore 23, Malaysia 81, Brunei 21) | `fixtures/environment-pins.json` |
| Sourced historical incident cards | **272**, 2016 to 15 Oct 2026, ASEAN | `content/history/hazard-history.json` |
| Essential places (clinics, hospitals and more, OpenStreetMap) | **9,376** | `content/places/essential-places.seed.json.gz` |
| Emergency alert, machine time (Google translation, code checks, Google voice in 4 languages, 4 cards) | **median 10.9 s** (8.5 to 14.8 s), 15 of 15 translations, 0 flagged | AEG-RPT-001, run of 2026-10-17 |
| 15-second alert, real spoken length | **13 to 16 s** with a short official line, **17 to 28 s** with a long one (Tamil longest) | AEG-RPT-001 |
| Johor alert and one-minute follow-up (live haze reading, exercise) | alert **20.5 / 26.1 / 22.3 / 28.4 s**; follow-up **51.5 / 65.2 / 59.8 / 72.8 s** (English / Malay / Mandarin / Tamil); whole run **37.9 s** | AEG-RPT-003 |
| ASEAN test | **11 countries, 18 languages translated, 8 spoken** (plus English), **24 of 24** translations passed the checks, **7 of 33** top-three slots unsupported by Google (2 are English), system median **10.5 s** (6.1 to 37.9) | AEG-RPT-002 |
| Calm daily bulletin | **341 words, about 156 s** (was 504 words, about 225 s); passes the validator with 0 problems | AEG-LOG-001, 2026-10-17 |
| Gemini 3.5 Flash-Lite assistant stress set | **86 of 87** (82 of 83 first, 4 provider time-outs re-run and passed; one real miss, AEG11) | `data/chat-stress-gemini.json`; BRF-003 |
| Gemini 4 Argon script review on Vertex AI | **25 review calls** recorded (21 completed, 4 client time-outs in the first run); run 2: **8 of 8** passed the checks; run 3 under the strict rule: **8 of 8** succeeded, **7 of 8** passed (the miss was the length rule on a short headline); average cost **0.0036 USD** a call, about **5 s**, occasional spikes to a minute; total **0.0846 USD** | AEG-RPT-004; the job cards |
| Argon price | **4 USD per million input tokens, 20 USD per million output** (Vertex AI list price, effective 2026-10-17) | Cloud Billing Catalog API; price book 1.7.0 |
| Reviewing one whole daily bulletin | about **0.025 USD**; worst case about **3 USD a month** | AEG-RPT-004 |
| Real Google bill, October (billing export up to 13:00 local) | gross **4.32 USD**, credits **4.32 USD**, net to the card **0.00 USD**; Cloud Run 4.32, Gemini API 0.000008 | BigQuery billing export; Admin Desk Google bill card |
| Job cards | **47** cards, total **0.12 USD** (price-book ceilings); job credit opened at **4.00 USD**, balance **3.88 USD** | Admin Desk, Governance and costs |
| Cost engine | monthly budget **10 USD**, committed **6.91 USD** (estimates; includes the deploy gate), remaining **3.09 USD**, ledger **52 entries**, chain intact | `npm run cost -- status` |

## 3. Claims you may NOT make (in any slide)
- "The chatbot or assistant runs on Gemini" (not true; only the Argon script review uses Gemini, on Vertex AI; the Flash-Lite score is a test of the assistant, not its production model).
- "Argon writes the news" or "AI-generated bulletins" (code writes scripts; Argon only proposes wording on request; a person accepts).
- "Google verified the translations" or "native speakers reviewed" (none has).
- "Verified on the Google invoice" for the Argon calls (pending), or "zero errors" or "100 percent accurate".
- "Covers all ASEAN languages" (18 translated, 8 spoken, 7 minority slots unsupported).
- "Official guidance for every country" (only Singapore flood, Malaysia earthquake, flood and haze, Singapore haze).
- "User validated" or any user quote, rating or percentage unless it comes from a real form (the validation sprint in AEG-BRF-005 has not been run).
- "Deployed on the hosted site" for anything built today (the live site runs an older revision until Dsol deploys at 20:30).

## 4. Corrections to numbers in earlier briefs
| Brief | Says | Now |
|---|---|---|
| AEG-BRF-004, criterion 05 | "906 tests"; "87 of 87" assistant stress cases | **959 tests**; 87 of 87 was the earlier model; Gemini Flash-Lite is **86 of 87** |
| AEG-BRF-004, criterion 01 | Gemini is a gap | Gemini 4 Argon on **Vertex AI** runs the script review (AEG-RPT-004); the main assistant is still not on Gemini |
| AEG-BRF-004 and 005 | machine time 54 s (language-model-only path) | **10.9 s** with Google translation and voice |
| AEG-BRF-004 | Google voice not enabled | enabled and measured |
| AEG-BRF-002 and 003 | "Google Places not used" | Places (New) and Street View are used with daily caps |
| AEG-BRF-007 | style sheet is a proposal | approved and built for the daily bulletin; the code-made spoken times, the sentence warnings and the stronger semantic checks are **not built** |

## 5. Open items and who owns them
| Item | Owner | State |
|---|---|---|
| Deploy the latest to the live hosted site, then enable features one by one | Dsol (brief `O0006`), 20:30 | not done at the time of the seal |
| Vertex AI line in the billing console Reports (about 0.077 USD for the review calls) | owner | waiting for a screenshot; then the Argon cost can be called "confirmed on the Google bill" |
| Paid tier for the Gemini API key (Flash default and stress re-run) | owner | not done; Argon works through Vertex without it |
| Stronger semantic safety checks (back-translations, hand edits) and the next snapshot `AEG-BAS-004` | SNET | after Dsol's build, so the deployed image equals the sealed tree |
| User validation sprint (5 to 8 real people) | owner | not run |
| Native readers for Malay, Mandarin, Tamil; citation for the top-three language rankings | owner | not done |
