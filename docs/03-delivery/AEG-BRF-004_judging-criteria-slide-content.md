# AEG-BRF-004 — Slide content for the five judging criteria

| Field | Value |
|---|---|
| Document ID | AEG-BRF-004 |
| Revision | 0.1 (REVIEW_DRAFT) |
| Date | 2026-10-17 |
| Written for | the owner, who builds the slides. Each criterion has: what the judges ask, **on-slide text** (copy it), a **visual**, a **say** note, the **proof** (a file or screen that can be shown), and the **gaps** to state or fix |
| Source | the owner's five criteria (pasted 2026-10-17); facts from the repository, `AEG-RPT-001`, `AEG-BRF-002`, the work log |
| Rule | every claim has a proof line. Where the proof does not exist yet, the slide says so (MVP remarks rule). Never write a number that is not in a saved source |

## 0. Readiness at a glance

| # | Criterion | Weight | Where we are | What decides the score |
|---|---|---|---|---|
| 01 | Google Generative AI integration | Critical | **Gap.** Gemini is not wired (owner decision: train the bot first). Today the assistant runs on Luna 6 through reAPI; Google AI in the build is Cloud Text-to-Speech and Translation, **not yet enabled** | Gemini (or Gemma) must really do core work and be shown running. See section 1 |
| 02 | End-to-end working pipeline | Critical | **Strong.** Fetch, verify, AI assist, human approval, public page all run locally and are tested | A 90-second recorded run of one incident, start to public |
| 03 | Evidence and data integrity | High | **Strong.** Source, time, licence, freshness, expiry and gaps are shown on cards | Show a card with its provenance and one honest "unknown" |
| 04 | Architecture and scalability | High | **Good, with limits stated.** Cloud Run, GPU render job, quotas; hosted site is a private earlier revision and the database is temporary | Say the limits plainly; show the quota table |
| 05 | Testing, reliability and cost | High | **Good.** Automated tests, 87-case assistant stress set, measured pipeline timings, cost gate | Real numbers from the report; admit what is unmeasured |

**Decision needed from the owner (criterion 01).** The submission closes 19 Oct 02:29 (+08) and the freeze is today. Without Gemini running, criterion 01 can only be answered with "planned". Options, in order of strength:
1. **Wire Gemini into the assistant and into the translation seat** (translation is a short, checkable job, and our number and name checks already guard it). Price it in the cost gate first, run the 87-case stress set on it, then use the final wording in `AEG-BRF-003`.
2. Wire Gemini only into the translation seat (smaller change, still "core work": the emergency voice and card text in Malay, Mandarin and Tamil).
3. Submit with the honest wording "Gemini planned; Google Cloud Text-to-Speech and Translation in the emergency pipeline". Weakest on a Critical criterion.

Recommended: option 2 first (a few hours), option 1 if time remains. Either needs the owner or Dsol to enable the Vertex AI or Gemini API and a key (cloud change, not done by the engineer).

---

## 1. Google Generative AI integration (Critical)

**Judges ask (原文):** 证明 Gemini / Gemma 或符合比赛要求的 AI 技术，真正参与 AEGIS 的核心工作，而不只是列在技术架构图上。

**On slide (today's honest version):**
- **AI does the wording, never the facts.** Code writes every number, place, level and time; a model only translates and words them; code then checks that every number and name survived.
- **Where AI works in AEGIS:** (1) the assistant that moves the map and finds help, (2) translation of emergency bulletins into Malay, Mandarin and Tamil with a second model translating back for the human reviewer, (3) the voice of the briefing, (4) the hazard illustrations on the warning cards.
- **Google technology:** Cloud Text-to-Speech (voice in four languages), Cloud Translation (fast first pass), Maps Platform (map, Air Quality, Weather, Street View, Places), Cloud Run, Cloud Build, Artifact Registry, Cloud Storage, Secret Manager, a GPU job for the presenter render, Google sign-in.
- **Gemini:** **[fill after wiring: model name, path (Vertex AI or Gemini API), job it does, 87-case result]**. Until then write: *"Gemini is the planned model; the design is model-independent, so it is a configuration change that we re-test with the same 87 cases."*

**Visual:** one slide, left a flow "facts (code) → AI wording → checks (code) → human approves → public", right a table "AI job / model / where it is checked".

**Say:** The judges want AI that does real work. Ours does the part AI is good at, language, inside a pipeline where code proves the facts and a person approves. [If Gemini is wired: show it translating a live bulletin and the check passing.]

**Proof:** `content/chat/helper.eval.json` and its result; `AEG-RPT-001` (15 of 15 translations with number and name checks); `src/services/broadcast/translation.ts`.

**Gaps to state or fix:**
- Gemini not wired (see section 0). Do not write "powered by Gemini" until `AEG-BRF-003` conditions are met.
- Google Cloud Text-to-Speech and Translation are now **enabled and measured** (run of 2026-10-17). Google AI technology in the core pipeline is therefore real; Gemini is still not wired.
- `AEG-BRF-003` and `AEG-BRF-002` still say "Google Places not used". That is now **out of date**: Places (New) and Street View are used with daily caps. Fix the wording before the PDF.

---

## 2. End-to-end working pipeline (Critical)

**Judges ask (原文):** 从灾害资料抓取、事实验证、AI 协助，到人工审批及公开展示，展示完整可重复的工作流程。

**On slide:**
- **Seven steps, each with an owner:**
  1. **Fetch** public feeds (USGS, GDACS, NEA, MetMalaysia, Open-Meteo, OpenAQ, OpenStreetMap; Google air and weather on demand).
  2. **Verify:** every record keeps source, licence and capture time; expired data is flagged; gaps stay "unknown".
  3. **Draft by code:** the bulletin script and the emergency text are written by code from the captured facts and validated.
  4. **AI assist:** translation into Malay, Mandarin, Tamil; back-translation for the reviewer; voice; warning card with the official "what to do".
  5. **Human gate:** an administrator approves, holds or withdraws; a reader of each language approves that language.
  6. **Publish:** the public page and the emergency player show **approved items only**.
  7. **Log:** every step is timed and written to an append-only log; KPI flags for late steps.
- **Repeatable:** the same command runs five drills from the most recent records (`tools/emergency-e2e.mjs`): earthquake, flood, storm, haze, volcano.
- **Two scenarios, two clocks:** daily news (about 1 hour of preparation) and emergency (voice on air within 5 minutes of the trigger).

**Visual:** a horizontal seven-box strip with a stopwatch under steps 3 to 5; below it a 90-second screen recording: pick the latest incident, Create, translations arrive with back-translation, tick "I read this language", card with subtitles plays, public page shows it.

**Say:** The pipeline is not a diagram, it runs. Here is the most recent real incident turned into a four-language voice card, with a person approving each language, in about a minute of machine time and a few minutes of human review.

**Proof:** `records/e2e/2026-10-17_emergency/` (cards and bulletin text per hazard and language, `results.json`); `AEG-RPT-001`; the Admin Desk News approval tab.

**Measured (local, Google Cloud Translation first pass, Google Cloud Text-to-Speech in four languages, 15-second alert):** system time per alert **median 10.9 s (8.5 to 14.8 s)**; voice 2.3 to 2.9 s; cards about 1.4 s; 15 of 15 translations, 0 flagged. Spoken length 13 to 28 s depending on the length of the official line (see AEG-RPT-001). Earlier language-model-only path: median 54 s cold, 21 s warm.

**Gaps to state:**
- The human review time (about 3 minutes for one reader of English, Malay, Mandarin; a Tamil reader in parallel) is an **estimate**, not a measurement.
- No native reader has checked the Malay, Mandarin, Tamil text or the card labels; the number, time and name checks are proof of facts, not of wording.
- Brunei hazard guidance and volcano guidance are **unsourced** (the card says so instead of inventing advice).
- The Admin Desk review screen for translations is API only; the screen is with SOL.

---

## 3. Evidence and data integrity (High priority)

**Judges ask (原文):** 提供数据来源、时间戳、许可、事实校验、过期控制及资料缺口的可检查证据。

**On slide:**
- **Every card shows source, licence and time.** No source, no card.
- **Facts are checked in code:** every number in a bulletin must exist in the captured facts; every number and name must survive translation; a flagged translation cannot be approved.
- **Expiry is visible:** Google air and weather readings are held in memory for at most one hour (Maps Platform Terms 3.2.3). A countdown shows green for minutes 0 to 50, yellow for 50 to 60, red with a Refresh button after that. Sample-data mode is clearly labelled and per viewer.
- **Gaps are shown, not hidden:** "unknown stays unknown". Brunei air quality has no public feed and says so; guidance without an official source on file says so; licences not yet verified are marked UNVERIFIED.
- **Official "what to do" is quoted, never written by AI:** earthquake (Singapore BCA; Malaysia NADMA and MetMalaysia), flood (Singapore PUB; Malaysia JPS), storm (MetMalaysia), haze (Singapore NEA). English lines made from official Malay are marked as our translation.

**Visual:** one real card on the left with arrows to its source, licence, captured-at and freshness badge; on the right a three-row "what we refuse to show" list (unsourced advice, expired Google values, unlicensed data).

**Say:** A judge can open any card and check where it came from and how old it is. The things we do not know are on screen as unknown.

**Proof:** `content/guidance/hazard-guidance.json` (source per line); `AEG-PRV-001` provenance and reuse log; the freshness component and its browser test; the evidence table in the database (125 monitored places: Singapore 23, Malaysia 81, Brunei 21).

**Gaps to state:** licence status for several sources is recorded UNVERIFIED; the data-confidence score formula is a **provisional placeholder** (owner will fine-tune; weaknesses in C0011); no billing report yet confirms Google free allowances.

---

## 4. Architecture and scalability (High priority)

**Judges ask (原文):** 解释 Google Cloud 服务、数据流、API 限额、GPU 视频生成、部署状态和持续运行的限制。

**On slide:**
- **Services and what each does:** Cloud Run (the web service), Cloud Build and Artifact Registry (builds and images), Secret Manager (keys, never in code), Cloud Storage (render weights and output), a GPU job on Cloud Run for the presenter video (a full bulletin video of 3 min 39 s was rendered there), Maps Platform (Maps JavaScript, Air Quality, Weather, Street View, Places).
- **Data flow:** public feeds → evidence store (source, licence, time) → incident cards, pins and bulletins → admin approval → public page. **Two lanes:** Google air and weather live in memory for one hour; everything else is stored with its licence.
- **Quotas we set ourselves (per day, enforced in code):** Street View 150, Places 30, Google air and weather on demand 60; model budgets per request, per day and per account; a cost gate that records an estimate before a paid action and an actual afterwards.
- **GPU video:** priced from the price book, approved through the cost gate, run by the operations agent; the engineer never runs a cloud command.
- **Deployment status (say it plainly):** the hosted site is a **private earlier revision**; the latest revision runs locally and is waiting for the hosted redeploy (operations agent). Hosted models are off until the flag and secret are set.
- **Limits of continuous running:** the hosted database is **temporary** (Cloud Run instance storage); a durable managed database is Phase 1. The presenter render takes about 50 minutes, so it is an update after the emergency voice card, never part of the 5-minute path. One model provider's speed varies a lot (6 to 58 s per translation); a Google Cloud Translation fast path is planned for the first pass.

**Visual:** the architecture diagram from `AEG-BRF-001` section 4 redrawn, with the two lanes in two colours, plus a small quota table.

**Say:** We know where it breaks. It runs a pilot for three countries, quotas stop surprise bills, the GPU job is a gated side lane, and the two things to fix before real scale are the durable database and the single model provider.

**Proof:** `AEG-BRF-001` section 4; `records/costs/price-book.json` (v1.4.0, with saved source files); `src/api/routes/streetview.ts` (daily allowances); `O0005` hosted redeploy request.

**Gaps:** hosted state as above; GPU price and Cloud Storage price status in the price book (storage not priced yet; unknown is never free).

---

## 5. Testing, reliability and cost (High priority)

**Judges ask (原文):** 展示自动化测试、AI stress evaluation、真实运行日志、错误处理、成本控制及实际测量指标。

**On slide:**
- **Automated tests:** 906 unit and integration tests passing in the last full run (3 failing tests belong to the presenter-render shell scripts and fail only because the Windows machine's `bash` is the WSL one; not the application). Browser tests in desktop Chrome cover the map, drop-a-pin, freshness countdown, news approval, emergency player and admin desk.
- **AI stress evaluation:** 87 assistant cases (scope, refusals, tool use) passed 87 of 87 on the current model. **[After Gemini: re-run on Gemini; write the real count, never 87 unless it is 87.]**
- **Real run logs:** every pipeline step is timed in an append-only log; the work log records every change; the five-drill harness writes `results.json` per run.
- **Error handling we measured and fixed:** provider time-outs opened the shared circuit breaker and broke chat. Fixes: per-call deadline for translation only, at most 8 requests at once, sentence-sized pieces, one repair pass, three tries of 30 s, translation memory. Result: **15 of 15 translations in both final passes** (earlier runs 14 of 15 and worse).
- **Cost control:** a cost gate with a price book built from Google's own pricing API; budget set by the owner; per-request, per-day and per-account model caps; Street View, Places and on-demand air and weather daily caps. The presenter video test cost about 2.4 USD (computed from the price book). Google billing so far is about **3 USD** (owner's reading of the billing page, not yet in the repository); the owner is told if spend would pass 50 USD.
- **Measured metrics:** see section 2 (median 54.0 s cold, 21.2 s warm, cards 1.4 s).

**Visual:** a four-number strip (906 tests, 87 of 87 stress cases, 15 of 15 translations, 54 s → 21 s) and below it a small "what broke and how we fixed it" timeline for the circuit-breaker story.

**Say:** Candour wins here: we show the timeouts that broke us, the fix, and the number after the fix. Cost is gated before money is spent.

**Proof:** `AEG-RPT-001`; `records/e2e/2026-10-17_emergency/`; `records/costs/ledger.jsonl` (written by the cost tool only, never by hand); the vitest and Playwright runs.

**Gaps to state:** Google voice time unmeasured; stress set not yet re-run on Gemini; one browser failure and several skipped browser tests from the earlier SOL run are tracked in the work log (check the latest figure before quoting); no load test (the pilot is single-user scale).

---

## 6. What to do before the deck is final (in order)

1. **Owner or Dsol:** enable Cloud Text-to-Speech and Cloud Translation; create a restricted key; set `AEGIS_GOOGLE_TTS_API_KEY` and `AEGIS_TTS_ENABLED=true` in `.env` (never in chat). Then the engineer re-runs the five drills and fills in the voice time.
2. **Owner decision (section 0):** Gemini in the translation seat and/or the assistant. Then the stress set is re-run and `AEG-BRF-003` placeholders are filled.
3. **Dsol:** hosted redeploy of the latest revision, so the demo link shows what the deck shows.
4. **Fix stale wording:** "Google Places not used" (now used, capped); presenter-in-emergency (the emergency is voice, card and subtitles, no presenter).
5. **Name human reviewers** for Malay, Mandarin and Tamil, and have the card labels and the English lines of official Malay guidance checked.
6. **Record the 90-second pipeline run** (section 2) and the 20-second map-follows-the-presenter clip.

## 7. Wording that must NOT appear on a slide

- "Powered by Gemini" or any Gemini model name before it runs (see `AEG-BRF-003`).
- Any Google air or weather value inside narration, a script, a video or stored longer than one hour.
- "Official warning": AEGIS summaries are labelled "not an official warning; follow local authorities".
- Guidance lines for Brunei hazards or volcanoes (none are sourced).
- "Tested by native speakers" (nobody has yet).
- Keys, passwords, "GitHub Actions, Snyk, ZAP" (none exist), "WhatsApp or SMS push" (not planned).
