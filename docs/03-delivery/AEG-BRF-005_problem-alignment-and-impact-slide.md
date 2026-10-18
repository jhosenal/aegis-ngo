# AEG-BRF-005 — Problem alignment and impact: what is solid, what is missing, the slide

| Field | Value |
|---|---|
| Document ID | AEG-BRF-005 |
| Revision | 0.1 (REVIEW_DRAFT) |
| Date | 2026-10-17 |
| Written for | the owner, who builds the slides. Criterion: **Problem Alignment and Impact, 25% of the score**. Judges' note: *the Southeast Asia hazard problem is clear; user validation and real impact metrics are missing* |
| Rule | no invented user, quote, rating or percentage. A judge can ask "who said that?" and the answer must be a name or a form we hold. Every number below has its proof, or is marked **FILL AFTER TEST** |

## 1. Read this first: the pasted advice is not safe to copy

The pasted suggestion is a good *shape* (two columns: user validation, measurable impact) but its content would be **false for Aegis today**. Do not put these on a slide:

| Pasted line | Why not | Say instead |
|---|---|---|
| "Validated with NGO responders / field operators" | no NGO or responder has used Aegis | "Designed for two personas; **being validated** in a short pilot (results below, filled in from real forms)" |
| Quote "reduced situation assessment from 20 min to under 2 min" | an invented quote | use only a quote from a real tester, with their consent; otherwise no quote |
| "90% positive rating on a 3-phase sheet" | no such survey exists | the real result of the feedback form in section 4, even if small (for example "5 of 6 testers found the card in under 30 s") |
| "Broadcast time 30 to 45 min manual, under 2 min with Aegis, 95% faster" | the 30 to 45 min baseline has **no source**; and our human gate takes about 3 min, so "under 2 minutes" is wrong | measured machine time plus the target in section 3; baseline marked "owner estimate, to be replaced by a cited source or interviews" |
| "Zero stale telemetry risk", "100% data compliance" | absolute claims we cannot prove | "Google readings are never held longer than 1 hour, and every card shows its age" |
| "Reaches 100% of local ASEAN demographics" | four languages is not everyone | "Four languages (English, Malay, Mandarin, Tamil) covering the main languages of Singapore, Malaysia and Brunei; more ASEAN languages are planned" |
| "Single 3D spatial dashboard" | the map is 2D with a Street View panel | "one map with every source on it" |
| "120+ hazard pins processed" | close but loose | "**125** monitored places (Singapore 23, Malaysia 81, Brunei 21)" |

## 2. Are we compliant with the pasted checklist?

| Pasted requirement | Status | What would make it true |
|---|---|---|
| Target personas named | **Partly.** Personas can be stated as design personas | Slide them as "design personas" (section 5) until validated |
| User validation / pilot feedback | **Not met.** No real user feedback exists | Run the one-hour validation sprint (section 4) and show its true results, however small |
| Real impact metrics, quantified | **Partly.** We have real measured system metrics, no measured user-impact baseline | Section 3: use the measured numbers; label the baseline an estimate, or cite one |
| Broadcast speed claim | **Partly.** Machine time measured (median 54 s cold, 21 s warm), voice time unmeasured, human review about 3 min is an estimate | Re-run once the Google voice API is on; show "voice on air within 5 minutes of the trigger" as the target, with measured machine part |
| Data freshness / 60-minute TTL | **Met** for Google air and weather (memory only, one hour, countdown shown) | Wording in section 3 |
| Four languages | **Met in the pipeline**, each language needs a human reader to approve; no native reader has checked yet | Name the readers (owner / team) and say so |
| 3D dashboard, 100% demographic reach, zero stale risk, 100% compliance | **Not met; do not claim** | See section 1 |

## 3. Impact metrics we can honestly show (each with proof)

| Metric | Value | Baseline | Proof |
|---|---|---|---|
| Emergency alert, machine time (draft, Google translation to 3 languages with number and name checks, Google voice in 4 languages, 4 warning cards) | **median 10.9 s, range 8.5 to 14.8 s** (5 drills, 15 of 15 translations; earlier language-model-only path: median 54 s) | not measured for a manual process: **owner estimate 30 to 45 min, to cite or replace** | `AEG-RPT-001`, `records/e2e/2026-10-17_emergency/` |
| Time to public voice | target **within 5 minutes of the trigger** including a person approving each language (human review about 3 min, an estimate) | same estimate as above | `AEG-RPT-001`; measure again with the Google voice on |
| Languages per emergency card | **4** (English, Malay, Mandarin, Tamil), each approved by a named reader | usually one | pipeline test; reader names to add |
| Facts checked by code | every number and source name in a bulletin; **0 number or name problems** left after the repair pass in the final two runs | model-written text is unchecked | `AEG-RPT-001` |
| Official "what to do" on the card | quoted from the official agency page, never written by AI, with the source named; gaps (Brunei hazards, volcano) shown as **unsourced** | advice from unknown sources | `content/guidance/hazard-guidance.json` |
| One map, many sources | **125 monitored places** (SG 23, MY 81, BN 21); sources: USGS, GDACS, NEA, MetMalaysia, Open-Meteo, OpenAQ, OpenStreetMap, WHO notices; Google air and weather on demand | agency pages in separate tabs | the map and the evidence table |
| Real recent history behind the map | **272 sourced historical incident cards, 2016 to 15 Oct 2026** across ASEAN (GDACS Orange and Red, USGS magnitude 6.5 and up, WHO outbreak notices, Singapore haze episodes), 29 corroborated by two sources | none in one place | `content/history/hazard-history.json` |
| Data freshness | Google readings **never held over 1 hour**; every card shows source, licence, time and an age countdown | stale cached copies | the freshness component and its test |
| Assistant safety | **87 of 87** stress cases passed (scope, refusals, tool use) | untested chatbots | `content/chat/helper.eval.json` |
| Cost | Google billing about **3 USD** so far (owner's reading of the billing page); a cost gate records an estimate before any paid action | cloud bills discovered after the fact | `records/costs/` |

**One honest sentence for the slide:** "We measured the machine part of an emergency alert, including the real Google voice in four languages, at about 11 seconds; the rest of the five-minute target is a person reading and approving, which is the safety feature, not the delay."

## 4. The one-hour validation sprint (do this today, it turns the weak point into the strongest evidence)

Goal: real feedback from **5 to 8 real people** within a few hours. You and your teammate are over 21; ask relatives, colleagues, a local volunteer group, a school safety officer, a clinic or a community leader. If anyone works in an NGO, civil defence, a council or a newsroom, ask them first (they are the real target personas).

**Setup (2 minutes per person):** open the localhost or hosted site in Chrome on a laptop. Do not coach. Start a stopwatch per task. Record a short consent line ("OK to quote you by role, not name?").

**Tasks (about 8 minutes):**
1. "Find the most serious hazard in Malaysia right now and tell me its source and how old the information is." (time it; correct source and age = pass)
2. "Find the nearest hospital or clinic to a place you choose and open its details." (time it)
3. "Here is an emergency card in Malay or Tamil: what should you do?" (shows the official guidance; pass if they state it)
4. Admin only: "Approve or reject this bulletin, and fix one word in the script." (time it, note confusion)

**Then ask 5 questions (score 1 to 5):** How clear was the information? How much do you trust it (why)? Would you use it in a real event? What was missing? What confused you?

**Record each person in a row** (copy to a sheet; keep as `records/validation/AEG-VAL-001_feedback.csv` once collected):

`id, role (no name), date, task1_seconds, task1_pass, task2_seconds, task3_pass, task4_seconds, clarity_1to5, trust_1to5, would_use_1to5, missing, confusing, quote_ok_to_use`

**What the slide may then say (only from the rows):** "Tested with N people (list roles). Task 1 median X s, passed by Y of N. Clarity A of 5, trust B of 5. Top requests: ..." If N is small, say N. A small honest test beats a large invented one; judges notice the difference.

**Optional but strong:** ask one person in each persona for a **one-line written endorsement or an email** ("I reviewed Aegis and ...") and show it with permission.

## 5. Personas to put on the slide (as design personas)

Mark the slide "Design personas, validation in progress" until section 4 has real rows.

1. **Field first responder or community volunteer.** Needs the nearest worst hazard, its source and age, and the nearest hospital, clinic or shelter, in seconds, on a phone or laptop, without reading long reports. *Aegis answer:* one map, source and age on every card, nearby-help pins, the assistant that moves the map.
2. **Regional command centre or newsroom administrator.** Needs a trusted draft in several languages fast, but must keep a person in control before the public sees it. *Aegis answer:* code-written draft, AI translation with automatic number and name checks, back-translation, per-language approval, approve or reject, full log.
3. **Resident or traveller in Singapore, Malaysia or Brunei** (public viewer). Needs plain-language "what should I do" from the official agency, in their language. *Aegis answer:* the emergency card with sourced guidance and subtitles in four languages.

## 6. The slide (two columns, honest version)

**Title:** *Problem fit and measured impact*

| Left: who it is for and what users told us | Right: what we measured |
|---|---|
| **Problem (sourced):** hazard information for Singapore, Malaysia and Brunei is spread across many agency pages, in different languages, with different freshness. 272 sourced incidents since 2016 across ASEAN, from four official sources | **~11 s** machine time for a four-language emergency alert with real Google voice (range 8.5 to 14.8 s), with a person approving each language |
| **Design personas:** responder or volunteer; command-centre administrator; resident | **4 languages**, every number and source name checked by code; **0** unresolved number or name errors in the final runs |
| **Pilot feedback:** *[FILL AFTER SECTION 4: N testers, roles, median time to find the worst hazard, clarity and trust scores, one quote with consent]* | **125** monitored places on one map; every card shows source, licence and age; Google readings never older than **1 hour** |
| *Honest line:* "Validation is early and small; here are the real results and what we will test next." | **87 of 87** assistant stress cases; about **3 USD** of Google spend so far |

**Say (30 seconds):** The problem is real and spread across agencies; we built Aegis around two people who must act fast and one public viewer. We measured our machine time (about 11 seconds) and kept the human approval on purpose. Our user testing is small and early; here is what N people told us, and the next step is a pilot with a civil defence or NGO partner.

**Roadmap line (credible, not claimed):** "Next: pilot with an NGO or civil-defence partner; measure real alert-to-voice time against their current process; add more ASEAN languages."

## 7. What to do now, in order

1. Run the validation sprint (section 4), 5 to 8 people, today. Send me the rows or the CSV and I will compute the medians and fill the slide text.
2. Decide the baseline: either ask one real newsroom or NGO contact "how long does a multilingual alert take today?" and quote their answer, or cite a public source for manual multilingual alert time. Until then keep it as "owner estimate".
3. Enable the Google Text-to-Speech and Translation APIs (earlier message) so the **voice time** is measured, not estimated.
4. Name the human language readers (Malay, Mandarin, Tamil) so "approved by a reader" is real.
5. Replace section 1's forbidden lines on the deck before export.
