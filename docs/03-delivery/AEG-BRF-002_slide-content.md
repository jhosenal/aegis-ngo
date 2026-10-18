# AEG-BRF-002 — AEGIS slide content (15 pages, ready to build)

| Field | Value |
|---|---|
| Document ID | AEG-BRF-002 |
| Revision | 0.1 (REVIEW_DRAFT) |
| Date | 2026-10-17 |
| Written for | the owner and whoever builds the slides (a person or an agent). Every page has: **on-slide text** (short, copy it), **visual**, **say** (speaker note, 30 to 45 seconds), and **proof** (where the claim can be checked) |
| Source of truth | AEG-BRF-001 (the consultant briefing) and the work log. If a slide and AEG-BRF-001 disagree, AEG-BRF-001 wins |
| Replaces | the other agent's 15-page outline, corrected (what changed is in section 3) |

## 1. How to use the deck

- **Talk time:** spend about 80% of the talk on the working features and the live demo (pages 6 to 9 and the demo). The PDF is a leave-behind for judges who want the architecture, roadmap and compliance pages.
- **Tone:** plain words, no hype, no claim without a proof line. Judges reward candour: say what is a pilot, what is a stub and what is planned.
- **Never put on a slide:** passwords or keys, "GitHub Actions / Snyk / ZAP" (none exist), "WhatsApp or SMS push" (not planned), "Google Places used" (not used), "AI-written scripts" (the script is code-written), "street-level" data, or a Google value kept longer than one hour.
- **Confirm with the owner before the PDF is final:** the submission portal name, team names and contact line, whether to name the five features as written in section 4, and the demo access wording on page 2.

## 2. The 15 pages

### Page 1 — Title
- **On slide:** **AEGIS** — Hazard intelligence for Singapore, Malaysia and Brunei. *125 monitored places. Four news briefings a day. A human approves every one.* Pilot · October 2026.
- **Visual:** the landing page hero with the presenter (screenshot) behind the title.
- **Say:** One sentence: AEGIS turns public hazard data into a map, a daily news briefing and a safe assistant, and nothing reaches the public without a person's approval.
- **Proof:** the live site and the screenshot.

### Page 2 — The pilot, and how to try it
- **On slide:** Open **https://aegis.walkingwithai.com** (Chrome on a laptop). The map, pins and notice work without signing in. **Sign in with Google** to use the chat, credits and saved places. Judge accounts can be added on request.
- **Visual:** a QR code and a 3-step strip: open, tap a pin, ask the assistant.
- **Say:** Judges can look without any login; signing in only unlocks personal features. We do not hand out shared passwords.
- **Proof:** the site; Google sign-in works on the hosted site.
- **Note:** the hosted site must be on the latest revision before you demo it (the operations agent is redeploying).

### Page 3 — The problem
- **On slide:** Hazard information in Southeast Asia is scattered across agencies; official alerts can lag; nobody gives one trusted, sourced picture for the three countries; AI tools that write news can invent facts; and some data (Brunei air quality) has no machine-readable source at all.
- **Visual:** four icons (scattered feeds, delay, trust, a blank on the map for Brunei).
- **Say:** The gap is not more data. It is one trusted view that shows its sources, admits what it does not know, and never lets an AI invent a number.
- **Proof:** the source table in AEG-BRF-001 section 5.2; the Brunei gap is recorded there.

### Page 4 — The solution
- **On slide:** One map, one news service, one assistant, one approval desk. Every card shows its **source, licence and time**. **Unknown stays unknown.** **Code owns the facts; AI only words them.**
- **Visual:** four tiles: Map, News, Assistant, Admin approval.
- **Say:** We built it as a pilot with five working features. The rest of the deck shows them, then what is next.
- **Proof:** AEG-BRF-001 section 3.

### Page 5 — How it works (architecture)
- **On slide:** Public feeds (USGS, GDACS, NEA, MetMalaysia, Open-Meteo, OpenAQ, OpenStreetMap) → evidence store with source and licence → incident cards, pins, bulletins. **Two data lanes:** *Google air and weather = memory only, one hour.* *Everything else = stored with its licence and time.*
- **Visual:** the diagram in AEG-BRF-001 section 4, redrawn.
- **Say:** The key design choice is the two lanes. Google values are shown live for at most an hour and never stored; trends and history come from sources we are allowed to keep.
- **Proof:** AEG-BRF-001 sections 4 and 7.

### Page 6 — Feature 1: the AI news presenter, with the map following the story
- **On slide:** Four briefings a day (07:00, 12:00, 17:00, 22:00). **Script written by code** from data captured an hour earlier, **checked by a validator**. **AI voice and face.** While the presenter names Singapore, Malaysia and Brunei the map **zooms once to Malaysia and back**, smoothly.
- **Visual:** a 20-second screen recording of the landing page: play, jingle, zoom in, zoom out.
- **Say:** The words are never invented: every number must exist in the captured facts. We rendered a full 3 min 39 s presenter video of a bulletin on Google Cloud.
- **Proof:** the rendered file `render/out/news-gcp/presenter.webm`; the validator tests.
- **Honest line (small print):** the public page still plays the welcome clip; plugging the approved bulletin video in is Phase 1.

### Page 7 — Feature 2: human approval before anything is public
- **On slide:** The administrator sees the draft **on the real landing page**, then **approves and locks**, holds, or **withdraws with a written reason**. Every decision is logged. The public page shows approved bulletins only.
- **Visual:** the Admin Desk "News approval" screenshot with the hero preview and the lock.
- **Say:** This is our answer to AI risk: the model cannot publish. A named person does, and the record shows who and when.
- **Proof:** tests for lock and withdraw; the decision log.

### Page 8 — Feature 3: 125 live pins and a custom pin dropper
- **On slide:** 125 monitored places (Singapore 23, Malaysia 81, Brunei 21): air quality, weather, last-updated time, 7-day modelled history, nearest measured sensor, nearby incidents, a photo. **Drop a pin anywhere** in the three countries for **1 demo credit**; save places (name and coordinates only).
- **Visual:** a pin card, and the dropper panel with the credits chip.
- **Say:** Credits are a demonstration: nothing is charged. Live Google readings last at most an hour and are never stored.
- **Proof:** the first live check read all 125 pins (378 readings, 0 failures).

### Page 9 — Feature 4: the assistant that controls the map
- **On slide:** Ask *"Show me the worst flood"* — the map **zooms to it and opens its card**. Ask *"Where is the nearest hospital?"* — pins and a list appear (hospital, clinic, pharmacy, police, fire station, disaster office, shelter). **Anything else gets a polite refusal.** Stress-tested: **87 of 87**.
- **Visual:** two screenshots side by side (flood zoom with the mini card; hospitals with pins).
- **Say:** It is not a general chatbot. It answers about disasters and AEGIS, and it cannot send alerts, call anyone or invent a figure.
- **Proof:** the stress set `content/chat/helper.eval.json` and its result file.

### Page 10 — Feature 5: Data Control and the evidence engine
- **On slide:** Admin tab to see, filter, add, delete and restore pins; refresh any source with a tick; load clearly labelled demo data; export; full history. Behind it, every record keeps **source, licence and timestamps**; unverified licences are shown as unverified.
- **Visual:** the Data Control tab screenshot.
- **Say:** It is how an operator keeps the pilot trustworthy without touching code.
- **Proof:** tests for add, delete, restore, demo data.
- **Note:** confirm with the owner that this is the fifth feature.

### Page 11 — Google services and compliance
- **On slide:** **Used:** Maps JavaScript, Air Quality, Weather, Sign-In, Cloud Run, Cloud Build, Secret Manager. **Not used:** Places, Routes, Geocoding. Rules we follow: Google readings in memory for at most one hour; attribution shown; never narrated or put in video; only Place IDs may be stored (we do not use Places).
- **Visual:** a two-column table used / not used, with a lock icon on "one hour".
- **Say:** We treated the terms as a design constraint, and we audited our own files: three places where a Google value had been kept were found and removed.
- **Proof:** AEG-BRF-001 section 7; the audit entry in the work log.

### Page 12 — Where the content comes from
- **On slide:** USGS (earthquakes) · GDACS (floods, storms, wildfires, volcanoes) · NEA PSI (Singapore air) · MetMalaysia (warnings) · Open-Meteo (modelled history) · OpenAQ (sensors) · OpenStreetMap (nearest help) · Wikimedia (photos). **Brunei: no official feed — we say so.**
- **Visual:** a source table with licence badges (green for confirmed, amber for UNVERIFIED).
- **Say:** Every card links back to its source. Where a licence is unconfirmed we show amber, not green.
- **Proof:** AEG-BRF-001 section 5.2.

### Page 13 — Roadmap
- **On slide:** **Pilot (now):** the five features above. **Phase 1:** durable database, public bulletin video each day, live Gemini chat, Brunei source, licence checks, clinical review of guidance, CI and security scans, real payments only after a terms decision. **Phase 2:** mobile and Safari, more languages (Malay, Chinese, Tamil), satellite hotspots, evacuation routing, messaging push, community reports, NGO onboarding.
- **Visual:** a three-column timeline.
- **Say:** Phase 1 is about dependability; Phase 2 is about growth. The ideas in Phase 2 are proposals, not promises.
- **Proof:** AEG-BRF-001 sections 8 and 11.

### Page 14 — Cost and limits (appendix)
- **On slide:** Monthly budget set by the owner: **10 USD**. The presenter video test cost about **2.4 USD** (computed from the price book). Chat stress tests: well under 0.5 USD. Google Maps Platform use so far is inside free allowances (not yet confirmed by a billing report). Spend is gated and logged.
- **Visual:** a small table.
- **Say:** Costs are small and controlled; unknown prices block an action instead of being guessed.
- **Proof:** the cost ledger; AEG-BRF-001 section 10.

### Page 15 — Trust, security and honest limits (appendix)
- **On slide:** What exists: 854 automated tests, a hash-chained audit trail with a verify endpoint, outbound fetch guard, API keys never stored in code, administrator-only routes. **Next:** CI and dependency scanning, a ZAP scan, key rotation. **Limits:** Chrome on desktop; English only; the hosted database is temporary; credits are a demo; some licences are unverified.
- **Visual:** two lists: "In place" and "Next".
- **Say:** We would rather show the limits than have them found.
- **Proof:** AEG-BRF-001 sections 12 and 13.

## 3. What changed from the other agent's outline

| Was | Now | Why |
|---|---|---|
| Page 2 shows login credentials | access wording only | never print credentials; sign-in is Google |
| "AI-generated scripts" | "code-written, validated script; AI voice and face" | it is true and it is a strength |
| Places API listed as used | listed as **not used** | we use OpenStreetMap |
| Seven modules named (routing, SMS, ...) | our own phased list | the seven were suggestions, not our plan |
| WhatsApp webhooks | removed | not built, not planned |
| Snyk, ZAP, GitHub Actions | "Next" | none exist today |
| Three features | five, with the assistant | the assistant is built and tested |
| 120+, 127 or "street-level" | 125 pins; any point in the three countries | accuracy |

## 4. The five features (names to use on every slide)
1. **AI news presenter with map auto-zoom**
2. **Human approval workflow**
3. **125-pin live map and custom pin dropper**
4. **Map-controlling assistant**
5. **Data Control and evidence engine** (owner to confirm)

## 5. Demo script (about 3 minutes, in this order)
1. Open the site; point at the map and a pin card (live Google reading and its one-hour note, 7-day history, nearest sensor).
2. Press play on the presenter: jingle, then the presenter; watch the map zoom to Malaysia and back.
3. Ask the assistant: *"Show me the worst flood"*, then *"Where is the nearest hospital?"*, then *"Give me a pasta recipe"* (polite refusal).
4. Drop a pin, check it for 1 credit, save it.
5. Admin Desk: open News approval, show the draft on the hero, approve and lock, then show Withdraw.
6. Close on the honest-limits slide.

**Before recording:** hard-refresh in Chrome; make sure live place checks are on and the stored essential-places copy has finished loading (`data/essential-places.out.log`); do one practice run; keep the server running.

## 6. Assets to capture
- Screenshots: landing hero with presenter; a pin card; the dropper; a mini card in the chat; hospitals on the map; News approval with lock; Data Control; the source table.
- Video: the rendered bulletin `render/out/news-gcp/presenter.webm` (3 min 39.9 s) and the welcome clip; a 20-second screen recording of the zoom.
- Logos: AEGIS, Google Maps (attribution), OpenStreetMap credit line, source agencies as text only.

## 7. Numbers you can quote
| Fact | Value |
|---|---|
| Pins | 125 (Singapore 23, Malaysia 81, Brunei 21) |
| Briefings | 4 a day: 07:00, 12:00, 17:00, 22:00 (captures an hour earlier) |
| First live Google check | 378 readings, 0 failures |
| Google reading lifetime | at most 1 hour, memory only |
| Presenter video test | 26 beats, 3 min 39.9 s, rendered on Google Cloud in about 50 minutes wall time (three parallel jobs), about 2.4 USD |
| Assistant stress test | 87 of 87 |
| Automated tests | 854 passing |
| Budget | 10 USD a month |

## 8. Additions after the competition audit (R0232): pages 16 to 18

The audit (docs/99-inbox/R0232) says judges score Google AI and Google Cloud depth at 40%. Add these three pages after page 5 or at the end. Say only what is true on the day you export the PDF.

### Page 16 — Google AI and Google Cloud in AEGIS
- **On slide:** *Where Google runs the product:* Cloud Run (service and a GPU job for the presenter render), Cloud Build, Artifact Registry, Cloud Storage, Secret Manager, Maps JavaScript, Air Quality, Weather, Google Sign-In. *Where Gemini fits:* the assistant's language step, behind the same fixed tool list, scope check and refusal. Code supplies every fact and number; the model only words the answer.
- **Visual:** the architecture diagram with the model box marked "Gemini (live deployment)" and the tool allowlist below it.
- **Say:** The assistant was trained and stress-tested first (87 cases) so that any model we plug in is held to the same rules.
- **Proof:** the stress set and the Cloud Run job executions.
- **Rule:** write "Gemini" on this slide only if Gemini is running on the hosted site at export time. Otherwise write "Gemini: next step" and show the rest.

### Page 17 — Team and theme
- **On slide:** Theme: Sustainability & Social Impact (confirm the selector in the dashboard). Team of two: the owner (product, demo) and the engineering agent pair named in the repo README. Who does what.
- **Visual:** two names and roles, no photos needed.
- **Note:** the owner decides how AI agents are described in the team line.

### Page 18 — Measured so far (with dates)
- **On slide:** 125 pins checked live, 378 readings, 0 failures (16 Oct). Assistant stress test 87 of 87. 854 automated tests passing, 1 failing (a stylesheet test, being fixed). Presenter video rendered on Google Cloud: 26 beats, 3 min 39.9 s, about 2.4 USD. These are engineering results, not disaster outcomes.
- **Visual:** four number tiles.
