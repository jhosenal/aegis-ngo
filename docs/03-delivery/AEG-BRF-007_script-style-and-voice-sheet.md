# AEG-BRF-007 — Script style and voice sheet (draft for the owner)

| Field | Value |
|---|---|
| Document ID | AEG-BRF-007 |
| Revision | 0.1 (REVIEW_DRAFT) |
| Date | 2026-10-17 |
| Written for | the owner (to approve the vibe), then whoever writes or reviews scripts: code templates, the Argon "script review" helper, and human administrators |
| Status | **APPROVED by the owner on 2026-10-17; daily bulletin template built** (emergency alert and Johor follow-up already followed the pattern). Steps 2 to 4 of section 8 (code-made spoken times, Argon review helper, style warnings) are not built.** Today's scripts still use the old stiff templates (examples in section 3). Section 8 lists what must be built if you approve this |

## 1. The idea in one line
**A calm neighbour on the radio, not a database reading itself out.** Say what matters to the listener first, in short plain sentences, then the detail, then what to do. Every fact is still checked by code.

## 2. Non-negotiables (these do not change with style)
1. **Code owns the facts.** Numbers, times, places, alert levels and source names come from the captured data. Style may change the words **around** a fact, never the fact. Every digit that appears in the script must exist in the facts (the validator already enforces this).
2. **No new facts, no guesses, no reassurance we cannot prove.** Not "it should clear up soon", not "there is nothing to worry about". Allowed: "our feeds record nothing for Brunei", with the plain reason that feeds cover only those hazards.
3. **Official advice is quoted whole**, from the official page, and named ("NEA advises ..."). Never paraphrased, shortened mid-sentence or invented. Where none is on file: "No official guidance on file. Follow your local authority."
4. **Never a Google air or weather value** in any script, voice, subtitle or video.
5. **Always the notice:** "Not an official warning. Follow your local authority." An exercise always says it is an exercise.
6. **A person who reads the language approves every language** before it airs.
7. **Hazard likelihood, uncertainty and urgency must not be strengthened by AI rewording** (owner's agent, 2026-10-17). Words such as possible, may, could, forecast, expected, in a few places, in some areas and officially rated carry the meaning of a hazard message, not only style. Code enforces it on every AI proposal (a qualifier the original has must remain; no "will", "severe", "dangerous", "immediately", "hit" and similar unless the original had them), and **the human accept or reject step must never be removed**.

## 3. What was wrong with yesterday's style (real examples from today's draft)
| Problem | Yesterday (real text) |
|---|---|
| Opens with a sources list nobody can listen to | "Our data was captured at 17:29 Malaysia and Singapore time from U.S. Geological Survey (USGS), Global Disaster Alert and Coordination System (GDACS), National Environment Agency (NEA) PSI via data.gov.sg and Malaysian Meteorological Department (MetMalaysia) via api.data.gov.my." |
| Data first, meaning last | "West, central, east, south and north are in the Unhealthy band, 101 to 200." |
| Repetitive labels | "NEA advises the elderly, pregnant women and children: ... NEA advises people with chronic lung or heart disease: ... NEA advises the public: ..." |
| Reads like a form | "At capture, our event feeds record no current earthquake, storm, flood, volcano or wildfire in Singapore, Malaysia and Brunei." |
| "Good news" claim | "Brunei: good news." (a judgement our feeds cannot support) |
| Long, stacked clauses | the whole Malaysia paragraph with four city forecasts in one breath |

## 4. Voice and vibe
- **Calm, clear, warm, a little brisk.** Never dramatic, never cheerful about a hazard, never cold.
- **Plain words.** "Air quality" before "PSI"; say what PSI is once ("PSI, the air quality index"). "Heavy rain", not "precipitation".
- **Short sentences.** Aim for 12 to 18 words, one idea each. Break a list of five regions into two breaths.
- **Lead with what matters to the listener,** then the number, then what to do.
- **Active voice, direct address where the guidance does:** "Avoid ...", "Stay indoors ...". Contractions are fine in English ("it's", "here's").
- **Name sources briefly and once,** the way a presenter would: "from NEA", "from the US Geological Survey". The full source list belongs on screen (lower third and credits), not in the spoken text.
- **Say the time once,** as "as of 17:29 local time"; do not repeat time zones.
- **Signposts help the ear:** "First, Singapore.", "Now Malaysia.", "Elsewhere in ASEAN." End with the next briefing time and one line of safety.

## 5. Daily bulletin (about 60 to 90 seconds)
**Order:** headline sentence (the one thing that matters most) -> Singapore -> Malaysia -> Brunei -> elsewhere -> close.
**Target words:** 150 to 210 spoken words. Cap each country at about 60 words; if more events exist, say the count and point to the map.

**After, using only facts from the same draft (numbers unchanged):**
> Good evening. This is the Aegis 22:00 briefing for Saturday, 17 October, with data as of 17:29 local time.
> The main story: air quality in Singapore is in the Unhealthy band, in all 5 regions. Our feeds record no earthquake, storm, flood, volcano or wildfire in Singapore, Malaysia or Brunei. Elsewhere in ASEAN, 42 other events are on the map. Here's the detail.
>
> First, Singapore. NEA's 24-hour PSI, the air quality index, at 17:00 was 193 in the west, 186 in the central region, 177 in the east, 161 in the south and 131 in the north. NEA advises healthy persons: Reduce prolonged or strenuous outdoor physical exertion. NEA advises the elderly, pregnant women and children: Minimise prolonged or strenuous outdoor physical exertion. NEA advises the public: Drink plenty of water to stay hydrated.
>
> Now Malaysia. MetMalaysia has 2 active warnings: a Strong Winds and Rough Seas Warning, valid until midnight, and a Thunderstorms Warning, valid until 18:00. For Kuala Lumpur, haze in the morning and thunderstorms in a few places in the afternoon, 24 to 33 degrees.
>
> Brunei: our feeds record nothing for Brunei right now. That is not a guarantee of safety, because they only cover these hazards.
>
> Elsewhere in ASEAN, 2 major alerts: Tropical Cyclone CHAMPI-26 in the Western North Pacific, rated red by GDACS, and the Kanlaon eruption, rated orange.
>
> That's the picture at 17:29, and conditions may have changed. Tap any marker on the map for its source and time. Our next briefing is at 07:00. Stay safe.

What changed: a headline first, sources dropped from the spoken text, one list broken into breaths, official advice kept whole, no "good news". Every number above is in the original.

## 6. Emergency alert (about 15 seconds)
**Pattern, three beats:** (1) what and where, with the issue time; (2) the one official action, quoted whole; (3) the notice.
> This is an exercise. Haze in Singapore: 24-hour PSI up to 191 (Unhealthy). Issued 16:37.
> In Singapore: Healthy persons: Reduce prolonged or strenuous outdoor physical exertion. The elderly, pregnant women and children: Minimise prolonged or strenuous outdoor physical exertion.
> Not an official warning. Follow your local authority.
Rules: no preamble such as "This is an Aegis emergency bulletin" (the card carries the branding), no adjectives, no calls to panic, no forecasts. Lead word is the hazard.

## 7. Per language (the vibe must survive translation)
These are our proposals; **a reader of each language must confirm or correct them** before they become rules (status UNREVIEWED).
- **English:** BBC-style plain news English; contractions allowed; British spelling (en-GB voice).
- **Malay (Bahasa Malaysia):** standard, polite, neutral broadcast Malay; "anda" for the listener; avoid stiff parliamentary phrasing; keep NADMA, JPS, MetMalaysia as written.
- **Mandarin (Simplified):** broadcast register (播报), short clauses, Arabic numerals, keep agency names in English with the Chinese gloss on first use only if a reader approves.
- **Tamil:** spoken-formal Tamil as in Tamil news; avoid long compound sentences because the voice speaks Tamil slowest (about 1.4 times the length of English).
- **Vietnamese, Indonesian, Filipino, Thai and the rest:** neutral broadcast register of the country; short sentences; numerals as digits. Each needs its own reader.
- **Never translate** AEGIS, USGS, GDACS, NEA, PSI, storm names, place names (a local spelling may follow in brackets).

## 8. How to make it real (what I would build if you approve)
1. **Rewrite the code templates** (daily bulletin and emergency) to the patterns above. Code keeps writing every fact; only the connecting words change. The validator stays. About 2 to 3 hours with tests.
2. **Spoken time and number forms computed by code** from the same fact (for example "17:29" read as written by the voice, or "5:29 in the evening" generated from it), so the voice sounds natural without a model touching a number. Needs a test with each Google voice.
3. **"Review script" helper in the Admin Desk, powered by Gemini 4 Argon** (Pro and Admin only, once Argon has quota): it proposes a more natural rewording of one segment; the same edit rules apply (no new number or name, official guidance and notice segments untouched); the administrator accepts or rejects, and every change is logged. It never creates a script and never sees a Google air or weather value.
4. **Style checks in code:** warn when a sentence is over 25 words, a segment is over its word budget, or a sources list appears in the spoken text.
5. **Readers:** one named reader per language to approve the language notes in section 7.

## 9. Prompt for the Argon script-review helper (for step 3)
> You help an administrator make a bulletin script sound natural when read aloud. Rewrite ONE segment you are given. Rules: keep every number, time, place, alert level, agency name and storm name exactly as written; add no fact, no advice, no reassurance and no forecast; keep quoted official advice word for word; keep sentences under about 18 words; lead with what matters to the listener; use plain words; keep the length within 10 percent. Return only the rewritten text. If you cannot improve it without changing a fact, return it unchanged.

## 10. Your decisions
1. Approve the vibe in section 4 (calm neighbour, short sentences, sources on screen not in speech)?
2. Daily bulletin target length: about 60 to 90 seconds, or shorter?
3. Build step 1 and 2 now (templates and spoken forms), and step 3 when Argon has quota?
