# AEG-BRF-001 — AEGIS briefing for consultants

| Field | Value |
|---|---|
| Document ID | AEG-BRF-001 |
| Revision | 0.1 (REVIEW_DRAFT, for the owner to read before sending) |
| Date | 2026-10-17 (written at about 02:30 Malaysia time) |
| Prepared by | SNET (the backend and engineering agent), from the repository, the cost ledger and the work log |
| Audience | external consultants who will review the product, its architecture, its use of Google services and its governance, and who have not seen it before |
| Not for | public release as is. It names internal controls and open problems on purpose |

**How to read the status words.** I use only these, because they mean different amounts of proof:
- **Built, tested**: the code exists and automated tests pass (unit, integration or browser). No real provider was called by the test.
- **Live-checked**: a real provider or feed was called and the result was looked at.
- **Hosted**: running at https://aegis.walkingwithai.com. The hosted site currently runs an **earlier revision** than the one described here (see section 12).
- **Planned**: not built.

---

## 1. What AEGIS is, in one page

AEGIS is a **pilot hazard map and news service for Singapore, Malaysia and Brunei** (with the wider ASEAN region shown on the map). It is built for an NGO coordination setting and for the public.

- A **map** shows current incidents (earthquakes, floods, storms, wildfires, volcanoes) from public feeds, each as a card with its source, licence and timestamps, plus **125 monitored places ("pins")** with air quality and weather.
- **Four news briefings a day** (07:00, 12:00, 17:00, 22:00 Malaysia and Singapore time) are written by code from the captured data, read by an AI presenter, and **approved by a human administrator before the public sees them**.
- A **chat assistant** answers questions about disasters and about AEGIS, **zooms the map to an incident** ("show me the worst flood"), and **finds the nearest hospital, clinic, pharmacy, police station, fire station, disaster office or shelter**. It refuses everything else politely.
- An **Admin Desk** holds the approval workflow, the pin data controls, spend and feed status.

Three design rules run through everything:
1. **Code owns facts; models only word them.** Numbers, rankings and actions come from code and stored data. The bulletin text is written by a template, not by a language model. The chat model never invents a figure.
2. **Unknown stays unknown.** If there is no source, AEGIS says "our feeds record nothing", never "safe".
3. **Every card names its source, licence and times.** Where a licence is unconfirmed, AEGIS records it as **UNVERIFIED** instead of claiming clearance.

Competition context: the entry closes 19 October 2026 at 02:29 (+08); the code freeze is 17 October.

---

## 2. Review of the proposed 15-page deck

The other agent's structure is good for a judging deck (80% of the talk on the working features, a PDF as a leave-behind). Several statements, however, **do not match what is built**, and a few important things are missing. Please check this table first.

### 2.1 Statements to correct or remove

| Page | The deck says | What is true | Suggested fix |
|---|---|---|---|
| 2 | "Demo login credentials, quick credentials for testing" | Sign-in is **Google sign-in** (plus an invitation/registration flow). A developer login exists only on the local machine. The public landing page, map, pins and legal notice work **without** signing in | **Never print credentials in a PDF.** Say: "Open the site; sign in with Google to use chat, credits and the admin tools; judges' accounts can be added to the allow-list on request" |
| 1, 4, 8 | "125 / 127 / 120+ micro-grids", "street level" | There are **125 fixed pins** (23 Singapore, 81 Malaysia, 21 Brunei). A dropped pin can be any point inside the three countries, but the data is the nearest grid cell of the provider, not street-level | Say "125 monitored places" and "any point in Singapore, Malaysia or Brunei"; avoid "street-level" |
| 5 | "Google Maps API in memory under 60 minutes; Open-Meteo and government data on disk for 7 days" | Right in spirit, but: the in-memory rule applies to the **Google Air Quality and Weather APIs**, not to the map itself. Open-Meteo and OpenAQ are kept **30 days** (the pin card shows 7). Government feeds (USGS, GDACS, NEA, MetMalaysia) are kept as evidence with their timestamps | Reword as in section 8 of this document |
| 6 | "AI-generated scripts" and "automated avatar linked to GIS triggers" | The **script is not AI-written**: it is built from a template and checked by a validator (every number, agency name and evidence id must exist in the captured facts). Only the **voice (Kokoro) and the lip-synced face (MuseTalk)** are AI. The map zoom follows the narration by a formula; word timings are still estimated for the welcome clip | Say "code-written, validated script; AI presenter" (this is a strength: no hallucinated bulletin text) and describe the zoom as built and being tuned |
| 7 | Admin approval portal | Built: approve and lock, withdraw with a written reason, decision history, preview on the real landing page hero. One gap: the lock and history are in the database, not yet in the hash-chained audit | Fine to show; mention the gap in the appendix |
| 8 | "On-demand street/micro-grid weather, AQI, custom bookmarking" | Built: drop a pin, check air and weather for **1 credit** (credits are a **demo, nothing is charged**), save a place (name and coordinates only). Needs live lookups switched on (currently off on the hosted site) | Say "credits are a stub; no payment provider is connected" |
| 9 | "Places API Place IDs" listed as used | **Google Places API is not used.** The nearest-services search uses **OpenStreetMap**. Places was studied (Place IDs can be stored; other content cannot) and is a candidate for Phase 1 | Move Places to "considered, not used" |
| 10 | "7 remaining modules: Evacuation Routing, Multi-lingual SMS Push, Community Report Verification, Hotspot Infrared, Resource Logistics, Shelter Capacity, Post-Disaster Audit" | These seven names are **the other agent's suggestions, not our plan**. Our own backlog is in section 11 | Replace with the phased list in section 11, or have the owner confirm each module before claiming it |
| 11 | "WhatsApp webhooks", SMS | **Not built and not planned** in our backlog | Remove, or label as an idea |
| 14 | "Google Maps credits, Open-Meteo free tier" | Real numbers are in section 10: a monthly budget of 10 USD set by the owner; the news render cost about 2.4 USD; Google Maps Platform usage so far is far inside free allowances (not yet confirmed by a billing report) | Use section 10 |
| 15 | "GitHub Actions, Snyk and ZAP scan compliance" | **There is no evidence of any of these in the project.** The workspace is not a git repository. What exists is listed in section 12.3 | **Remove the claim** unless the owner has run them; otherwise judges may check |
| 12 | "Hack2skill execution timeline" | I cannot confirm the portal name | Owner to confirm |

### 2.2 What the deck is missing

| Missing | Why it matters |
|---|---|
| **The chat assistant** (map control, nearest help, stress-tested 87 of 87) | It is one of our five core features and the deck counts three |
| **Evidence and provenance model**: every card has source, licence, retrieved time, revision history; "UNVERIFIED" licences are shown, not hidden | The strongest answer to "can we trust it?" |
| **Cost governance**: a cost gate, an append-only ledger, a price book with saved sources, and rules that no agent buys a commitment | Shows engineering maturity and protects the budget |
| **Hash-chained audit trail** with a verify endpoint | Tamper evidence for decisions |
| **Legal and pilot notice** (12 sections, draft, not reviewed by a lawyer) and the Google terms handling | Compliance story |
| **Honest limits**: Chrome on desktop only, English only, Brunei has no official machine-readable air source, MetMalaysia licence unverified, guidance released as "sources checked, not clinical" | Judges and consultants reward candour |
| **Data Control** (add, delete, refresh, demo data, export, history) | Operational maturity |
| **Test evidence**: 854 backend tests pass, type check clean, browser tests, a chat stress set | Quality signal |

### 2.3 What the deck gets right
Human-in-the-loop as the headline; showing the working features first; a compliance page; a roadmap; an appendix for cost and security. Keep those.

---

## 3. The five core features

I count the five from the owner's description. **Feature 5 is my assumption; the owner should confirm it.**

| # | Feature | What it does | Status |
|---|---|---|---|
| 1 | **AI news presenter with map auto-zoom** | Four bulletins a day, written by code, spoken by an AI presenter. While the presenter names Singapore, Malaysia and Brunei the map zooms once to the Malaysia frame (which contains the other two) and back, smoothly (a dissolve is used if the viewer prefers reduced motion). A station jingle plays first | **Built, tested.** Script generator, validator and storage are live-checked on the local server (the 21:00 bulletin was captured and approved). A full 3 min 39 s presenter video of a bulletin script was **rendered on Google Cloud** (L4 GPU, three parallel jobs) and joined. The public landing page still plays the welcome clip; wiring the approved bulletin video into it is Phase 1 |
| 2 | **Admin approval workflow** | An administrator reads the draft on the real landing page hero (map and reader), approves and **locks** a bulletin or holds it; an approved one can only be withdrawn with a written reason; every decision is logged. The public page shows approved bulletins only | **Built, tested** |
| 3 | **Live 125-pin map and custom pin dropper** | Each pin shows air quality and weather (live Google reading for at most one hour), when it was last updated, 7-day modelled history (Open-Meteo), nearby sensors (OpenAQ), nearby incidents and a place photo. A signed-in user can drop a pin anywhere in the three countries for 1 demo credit and save places | **Built, tested.** Live Google lookups were checked for all 125 pins (378 readings, 0 failures) on 16 October |
| 4 | **Chat assistant** | Disasters and AEGIS only. Zooms the map to an incident and opens a card ("show me the worst flood"). Finds the nearest hospital, clinic, pharmacy, police, fire station, disaster office or shelter, shown as pins and as mini cards that open the full card. Refuses everything else politely and resists jailbreak attempts | **Built, tested.** Stress set of 87 questions: **87 of 87 pass** on the formulation version 1.2.0 with the real model (reAPI gpt-6-luna). The nearest-services data is being copied locally because the public OpenStreetMap servers were unreliable (section 6) |
| 5 | **Data Control and the evidence engine** (assumed) | Admin tab to see and edit the 125 pins, refresh any data source, load clearly labelled demo data, export, and keep a history; behind it the evidence pipeline with licences and timestamps | **Built, tested** |

---

## 4. Architecture in brief

```
 public feeds ──► ingest jobs ──► evidence store (SQLite) ──► incident cards ──► map, cards, charts
 (USGS, GDACS,    (every 15 min)   with source, licence,        (country, period
  NEA PSI,                          time, revision)              derived at read time)
  MetMalaysia,
  Open-Meteo, OpenAQ)
                                   fact sheet "as at capture" ──► template script ──► validator ──► bulletin (stored)
                                                                                          │
                              Admin Desk: draft preview on the landing hero ◄─────────────┘
                              approve and lock / hold / withdraw (logged) ──► public page shows approved only

 Google Air Quality and Weather ──► in-memory store (1 hour, never written to disk)
        ▲  quota gate + cost gate                    ▲ shown on pins, rings, dropped pins
        └── on demand per place / admin refresh / (scheduled refresh: OFF)

 Chat: question ─► pre-filter ─► model (reAPI gpt-6-luna; Gemini planned for live) ─► tool call
        tools: list/read cards, show on map (code ranks), find nearby (stored OSM copy first)
        ─► reply blocks (text, mini cards, map focus, places) ─► the page zooms and opens panels
```

- **Stack:** TypeScript on Node 22, Fastify API, SQLite (WAL), React and Vite UI, Google Maps JavaScript API, Playwright and Vitest tests.
- **Hosting:** Google Cloud Run (one always-on instance with an **ephemeral** SQLite file), Cloud Build, Artifact Registry, Secret Manager. A GPU Cloud Run **job** was used for the video render.
- **Persistence caveat:** the hosted database is ephemeral by design for the pilot; a redeploy empties it. A durable store is Phase 1.

---

## 5. Services and APIs we use

### 5.1 Google

| Service | Used for | How it is used | Retention rule we apply | Status |
|---|---|---|---|---|
| **Maps JavaScript API** | the map, markers, the camera | browser key restricted by website referrer | map content is live; nothing stored | **Hosted** (working; the key referrer fix was done by the operations agent) |
| **Air Quality API** (current conditions) | pin air quality: Universal AQI, local indexes (for example Malaysia's API), pollutants | server key limited to this API; one call per pin per refresh | **in memory, one hour at most, never stored**, never narrated | **Live-checked** (all 125 pins) |
| **Weather API** (current, hourly, alerts) | pin temperature, conditions, forecast hours; alerts only for Singapore | separate server key | same as above | **Live-checked** |
| **Google sign-in (OAuth)** | accounts | web client with the redirect on our domain | account record only | **Hosted** (login working per the operations agent) |
| **Gemini API** | planned live chat model for the judges | prepaid key, `gemini-3.5-flash-lite` | n/a | **Planned** for live; the chat is tested on reAPI Luna |
| **Cloud Run, Cloud Build, Artifact Registry, Cloud Storage, Secret Manager, Logging** | hosting, builds, the render job and its bucket, secrets | spend gated by our cost procedure | n/a | **Hosted / live-checked** |
| **Cloud Billing Catalog API** | read prices into our price book | key limited to billing catalog | n/a | **Live-checked** |
| **Google Places API (New)** | considered for hospitals and pharmacies | **not used.** Place IDs may be stored, other content may not, results must show on a Google map with attribution; needs a Places key and a priced SKU | n/a | **Not used** (candidate for Phase 1) |
| Geocoding, Routes, Street View | none | not used | n/a | **Not used** (Routes would be needed for evacuation routing, Phase 2) |

### 5.2 Public data we ingest and show

| Source | What | How often | Licence (as recorded) | Kept |
|---|---|---|---|---|
| **USGS** earthquake feed | earthquakes in or near ASEAN | every 15 minutes | public domain, credit USGS (terms page not re-read: NOT_VERIFIED) | evidence, with times |
| **GDACS** | floods, storms (cyclones), wildfires, volcanoes, droughts, with alert level green, orange, red | every 15 minutes | CC BY 4.0, "indicative only" | evidence |
| **NEA PSI** (Singapore, via data.gov.sg) | 24-hour PSI by region, bands and advice | every 15 minutes and before each bulletin | Singapore Open Data Licence v1.0 | time series |
| **MetMalaysia** (via api.data.gov.my) | warnings, forecasts, haze districts | every 15 minutes and before each bulletin | **UNVERIFIED** (pilot use only) | snapshots |
| **Open-Meteo** | hourly modelled temperature, rain, PM2.5 and PM10 for 125 pins, past 7 days | at most every 6 hours | CC BY 4.0, free tier is non-commercial; terms read, **upstream model licences unchecked** | 30 days |
| **OpenAQ** v3 | measured PM2.5 from nearby community, low-cost and agency sensors | hourly | per-station open licences (CC BY 4.0, CC0, public domain) | 30 days |
| **OpenStreetMap** via Overpass | hospitals, clinics, pharmacies, police, fire stations, disaster offices, shelters | a stored copy (see 6.4) | ODbL, credit "(c) OpenStreetMap contributors" | stored copy |
| **Wikipedia and Wikimedia Commons** | place photos, links | built once | free licences only, author and licence shown | stored list |
| **NEA haze measures page** | the advice quoted in bulletins and Assist | saved page | quoted with source; released as "sources checked, not clinical" | saved file |
| **Brunei** | **no official machine-readable air or weather source found** (English and Malay searched) | n/a | n/a | the bulletin says "our feeds record nothing" |

### 5.3 AI services

| Service | Role | Status |
|---|---|---|
| **reAPI gpt-6-luna ("Luna 6")** | chat model for testing, and live backup | **Live-checked** (stress test); calls go through our gateway with a budget |
| **Kokoro-82M** (voice) | presenter voice, stock voice, no cloning | **Live-checked** (local and on the GPU job) |
| **MuseTalk 1.5** (lip-sync) | presenter face from an idle clip | **Live-checked** (L4 GPU about 3.5 times faster than the owner's laptop) |
| **reAPI image-to-video** | made the presenter's idle clip once | one-off, cost recorded in the kit |
| Weights and idle clip licences | | **UNVERIFIED**; the video is for the pilot only |

---

## 6. Where the content comes from

### 6.1 Incident cards
Each live record from USGS or GDACS becomes a card with title, hazard, alert level, event time, region, position, source link, evidence ids and revision history. The **country** and whether the incident is **current or historical** are derived when the card is read and are never stored or guessed. About 370 incident cards were held on 16 October, current and past (about 200 wildfire, 120 earthquake, 26 storm, 20 flood, 4 volcano).

### 6.2 News bulletins
1. At the capture time (06:00, 11:00, 16:00, 21:00) the system polls PSI and MetMalaysia, then builds a **fact sheet "as at capture"** (data fetched up to five minutes after still counts).
2. A **template script** writes six segments (headline, Singapore, Malaysia, Brunei, regional alerts, closing) using only the fact sheet. Wording follows tone rules ("good news" only when nothing is wrong).
3. A **validator** rejects any number, agency name or evidence id that is not in the fact sheet.
4. The bulletin is stored once per capture, then waits for an administrator. NEA's band advice is included **only if** the guidance release record is approved (it is, scope "sources checked, not clinical").
5. Google air and weather values are **never** part of a bulletin, a script, a voice or a video.

### 6.3 Pin cards
Place, photo (free licence), last updated time, live Google reading while held, 7-day modelled history (Open-Meteo), nearest measured sensor (OpenAQ), nearby incidents within 100 km, and the update times. Modelled values are labelled as models.

### 6.4 Chat answers
- General disaster knowledge: the model's own knowledge under strict rules (short, safety-first, "follow your local authority", no invented numbers).
- Facts about AEGIS: from a fixed list of facts in the formulation file.
- Current events and places: **only from tool results** (our stored incidents, our stored essential-places copy), with the ranking explained.
- Nearest help: a copy of OpenStreetMap data for the three countries, fetched once and stored locally (ODbL) because the public Overpass servers were frequently at capacity during testing (only 2 of 28 live test queries succeeded). The data is volunteer-made and may be out of date; every answer says to call first and to use the local emergency number in an emergency.

---

## 7. How the live Google air and weather works

1. **Where the data comes from.** Google Air Quality API (current conditions) and Google Weather API (current, hourly, alerts). One restricted key per API. Alerts are requested for Singapore only; for Malaysia and Brunei there is no Google alert source, so "no alert" is never shown for them.
2. **Three ways a reading is fetched** (all go through a **quota gate** with monthly caps set by the owner, and our **cost gate**):
   - **Scheduled refresh** of all 125 pins at 07:00, 12:00, 17:00, 22:00: built, **switched OFF** by the owner.
   - **Admin refresh** from Data Control: explicit confirmation, at most 130 pins, one run per 10 minutes.
   - **On demand** for one place: when a signed-in user drops a pin (1 demo credit) or an admin presses Google on a pin; limits per visitor and per day.
3. **Where it lives.** In the server's **memory only**. Each reading carries a valid-until time (fetch time plus at most one hour); the store drops it at that time; a restart empties it. It is **never** written to the database, a file, a log, a document, an export, an image, a script, a narration or a video. The browser also drops it at expiry.
4. **What we keep.** Our own metadata only: when a pin was last fetched. After the hour the pin shows "last updated HH:MM", the next update time, and the stored official and modelled data instead.
5. **Display rules.** Google's attribution lines are shown with the values ("Source: Includes air quality data from Google" and the weather equivalent). Readings are shown on a Google map.
6. **What it is never used for.** Narration, text-to-speech, generated scripts, generated video, the chat assistant, long-term analysis or trends. A category or colour computed from a Google value is treated as Google content and is also not stored. Trends use Open-Meteo, OpenAQ and the government feeds instead.
7. **Checks done.** An audit on 17 October found and removed three places where Google values had been kept (a canary file on disk, and sample values in two documents); the canary tool now prints shapes only; a test confirms that no table in the database contains a Google value.
8. **Risk to put to the consultants:** whether charging **credits** for a Google-derived reading could conflict with the Maps Platform terms. Credits are a demo today (nothing is charged), and this question must be answered before any real payment is connected.

---

## 8. All functions, with their phase

**Pilot** = built and tested now (runs locally; the hosted site shows an earlier revision until the next deploy). **Phase 1** = the next weeks, proposed. **Phase 2** = after that, proposed. Phases are my proposal for the consultants to challenge, not a commitment.

### 8.1 Public site

| Function | Pilot | Phase 1 | Phase 2 |
|---|---|---|---|
| Regional map with incident markers, hazard layers, clustering, GREEN toggle, map and satellite, fullscreen | ✔ | | |
| Incident cards with source, licence, times, revisions; evidence view | ✔ | | |
| Hazard overview, seven hazard domain guides, incident history databank (backfilled, sourced) | ✔ | more hazards | |
| Emergency Assist: guidance cards (released as sources checked, not clinical) | ✔ | clinical review; more countries | |
| 125 air and weather pins: last updated, live Google reading for one hour, temperature ring, 7-day modelled history, nearest measured sensor, nearby incidents, photo | ✔ | durable history store | |
| Custom pin dropper, demo credits, saved places | ✔ | **real payments** (needs a provider and a terms decision) | |
| News reader: presenter, jingle, EN subtitles; MS, ZH, TA locked | ✔ | public page plays the approved bulletin video; reviewed MS, ZH, TA | more languages |
| Map camera follows the narration | ✔ (test; word timings estimated) | exact timings from the render | incident-by-incident zoom |
| Chat assistant: disaster Q and A, AEGIS Q and A, map zoom, nearest help, polite refusal | ✔ (local; models off on the hosted site) | live model (Gemini) for judges; Malay and other languages | voice input |
| Nearest essential services from a stored OpenStreetMap copy | ✔ (copy being built) | Google Places (Place IDs) if approved; curated hospital and disaster-office list | routing to the place |
| Data confidence tile (provisional formula), hazard trend chart | ✔ | finalise formula | |
| Legal and pilot notice (12 sections, draft) | ✔ | lawyer review | |
| Google sign-in, registration | ✔ (hosted) | privacy notice review | |
| Workspace: cards, classic chat, resource assessment, pins | ✔ (demo data) | real NGO data | multi-tenant onboarding |

### 8.2 Admin Desk

| Function | Pilot | Phase 1 | Phase 2 |
|---|---|---|---|
| News approval: draft preview on the real hero, approve and lock, hold, withdraw with reason, decision history | ✔ | decisions in the hash-chained audit; a reason on Hold | two-person approval |
| News desk: slots, sources, languages, render gates and status | ✔ | | |
| Spend and models: budget, ledger, funding, flags | ✔ | billing-report reconciliation | |
| Feeds and data: source status and last success | ✔ | alerts when a source stays down | |
| Data Control: pin list with filters, add, delete, restore, refresh any source, demo data, CSV export, history | ✔ | | bulk import |
| User administration (plan and admin flags) via API | ✔ | screen in the Desk | roles |

### 8.3 Platform

| Function | Pilot | Phase 1 | Phase 2 |
|---|---|---|---|
| Ingest: USGS, GDACS, PSI, MetMalaysia, Open-Meteo, OpenAQ | ✔ | NASA FIRMS hotspots; official Brunei source | more national agencies |
| Bulletin generator, validator, per-slot storage, estimated timings, credits | ✔ | | |
| GPU presenter render on Cloud Run (tested: 3 min 39 s from a bulletin script, about 2.4 USD) | ✔ (test) | automated daily render with the cost gate and approval | multilingual renders |
| Hash-chained audit with verify endpoint | ✔ | | external anchoring |
| Cost gate, ledger, price book with saved sources, owner approvals | ✔ | | |
| Hosted deployment on Cloud Run | ✔ (earlier revision) | **redeploy of the latest**, durable database, monitoring, alerts | multi-region |
| Security scans, CI pipeline | | **add** (none exist today) | penetration test |
| Mobile and Safari | | | ✔ (Chrome desktop only now) |

### 8.4 Ideas that are not in our plan (so far)
Evacuation routing (needs the Routes API), SMS and WhatsApp push (needs a provider and consent handling), community report verification, shelter capacity, resource logistics, post-disaster audit. The deck's roadmap lists some of these; if the owner wants them in the story they should be marked as ideas, not as planned modules.

---

## 9. Governance

- **Human in the loop:** nothing reaches the public bulletin page without an administrator's approval; approval is locked; withdrawals need a reason.
- **No hallucinated bulletin text:** templates and a validator.
- **Chat guard rails:** the standard refusal is fixed text written in a reviewed file, not model output; jailbreak phrases never reach the model; the chat cannot send alerts, call anyone, change data or approve anything.
- **Procedures (SOPs):** spend gate, Admin Desk operation, chat tuning and stress test, place image research, reusable page layout.
- **Provenance log** of everything reused from other projects or sources, with licence status.

---

## 10. Cost model (real numbers, with their limits)

| Item | Figure | Note |
|---|---|---|
| Monthly budget set by the owner | **10 USD** | the gate asks the owner above 0.50 USD for one action |
| Committed this month (including worst-case estimates) | about **5.9 USD** | many entries are worst-case caps, not charges |
| Presenter video render on GCP (26 beats, 3 parallel L4 jobs, 6,803 instance seconds) | about **2.37 USD** | computed from the price book (0.00034884 USD per second for one L4 job), **not from a billing report** |
| Image builds on Cloud Build | within the free build minutes | about 12 to 30 minutes each |
| Chat stress tests on reAPI gpt-6-luna | well under **0.5 USD** in total | prices 0.08 and 0.40 USD per million tokens; 87 cases per run |
| Google Maps Platform (Maps JavaScript, Air Quality, Weather) | inside the free monthly allowances so far | **not yet confirmed by a billing report** |
| Google Cloud credit | 300 USD, about 294 USD left | coverage of each service is **assumed** until a billing report shows it |
| A recorded exposure flag of 0.32 USD | an entry error of mine (credit entered as 0) | harmless, kept for honesty |

---

## 11. Phases (summary)

| Phase | Goal | Main items |
|---|---|---|
| **Pilot** (now to the 19 October deadline) | five core features working and demonstrable | everything marked ✔ in section 8; redeploy the latest revision to the hosted site; public bulletin approved at 07:00 |
| **Phase 1** (next weeks) | make it dependable and publishable | durable database; automated daily render and public bulletin video; Gemini live chat; official Brunei source or a documented manual entry; MetMalaysia and Open-Meteo upstream licence checks; clinical review of guidance; real payments only after a terms decision; CI, security scans, monitoring; lawyer review of the notice; curated essential-services list or Google Places |
| **Phase 2** | grow | mobile and Safari; more languages with reviewed translations; FIRMS hotspots; evacuation routing; messaging push; community reports; shelter capacity; NGO multi-tenant onboarding |

---

## 12. Current state, limits and honest gaps

### 12.1 Where things run
- **Local server** (the development machine): the latest revision, all features above, backend tests passing (854 of 855; the one failure is a style test of another agent's stylesheet).
- **Hosted** (https://aegis.walkingwithai.com): running and capturing bulletins (a 21:00 bulletin exists there), but on an **earlier revision**: the screening gate, pin history, Data Control, credits, chat changes and the stored places copy are **not deployed yet**. The operations agent is to redeploy.

### 12.2 Known gaps
- Brunei has no official machine-readable air or weather source.
- MetMalaysia licence is unverified; Open-Meteo upstream model licences and OpenStreetMap and Overpass terms were not re-read in this session; weights and presenter clip licences are unverified.
- The stored OpenStreetMap copy is still being built (public servers were unreliable); coverage in Malaysia and Brunei is uneven because the data is volunteer-made.
- Languages other than English are locked stubs. Chrome on desktop only.
- The data confidence tile uses a provisional formula.
- The hosted database is ephemeral. No payment provider. Credits are a demo.
- The presenter portrait and idle clip are AI-generated; the presenter is labelled as AI-generated with a synthetic voice.

### 12.3 Security and quality evidence that exists
- 854 automated backend tests, type check clean, Playwright browser tests (desktop Chrome), and an 87-question chat stress set.
- Content Security Policy and other response headers; an outbound fetch guard (allow-listed hosts, public IP check) for every feed; API keys only in the environment or Secret Manager and never printed or committed; administrator-only routes checked by tests; a hash-chained audit with a verify endpoint.
- **Not present:** CI pipeline, Snyk, OWASP ZAP, penetration test.

---

## 13. Questions we would like the consultants to answer

1. **Google terms:** is it acceptable to show Google Air Quality and Weather readings for a dropped pin in return for credits (even demo credits that later become paid)? Is the one-hour in-memory rule the right reading of the caching terms for these two APIs?
2. **Places versus OpenStreetMap:** for hospitals, pharmacies and police stations, is a stored OpenStreetMap copy (ODbL, credit, share-alike) acceptable for a public safety tool, or should Google Places (Place IDs stored, details fetched live) be the primary source?
3. **Safety wording:** is the chat's disclaimer pattern ("our feeds record nothing, not a guarantee of safety; follow your local authority; call your local emergency number") enough for a disaster-information service in these three countries?
4. **AI presenter disclosure:** is the on-screen "AI-generated presenter, synthetic voice" label enough for Singapore, Malaysia and Brunei?
5. **Data protection:** what must we add for accounts and saved places (Singapore PDPA, Malaysia PDPA, Brunei)?
6. **Architecture:** the best path from an ephemeral SQLite file on one Cloud Run instance to a durable, always-on design that is still cheap for an NGO.
7. **Cost:** a realistic monthly model for four bulletins a day with GPU rendering, the chat model and Google Maps Platform usage at 1,000 and at 100,000 monthly users.
8. **Security:** which scans and controls to add first (CI with dependency and secret scanning, ZAP against the hosted site, key rotation).
9. **Licences:** the cleanest way to settle MetMalaysia, Open-Meteo upstream and the presenter weights before any public launch.

---

## 14. Key numbers

| Item | Value |
|---|---|
| Monitored pins | 125 (Singapore 23, Malaysia 81, Brunei 21) |
| Bulletins per day | 4 (07:00, 12:00, 17:00, 22:00; captures at 06:00, 11:00, 16:00, 21:00) |
| Google readings in the first full live check | 378 (105 air, 125 weather, 125 hourly, 23 alerts), 0 failures |
| Google reading lifetime | at most 1 hour, memory only |
| Presenter video test | 26 beats, 3 min 39.9 s, 816 x 960, VP9 with alpha and Opus; GPU render about 20 seconds of render per second of speech |
| Chat stress set | 87 cases in 6 groups; 87 of 87 on formulation 1.2.0; 20 of 20 out-of-scope refused politely |
| Backend tests | 854 passing, 1 failing (another agent's stylesheet test) |
| Competition close | 19 October 2026, 02:29 (+08); code freeze 17 October |
