# AEG-RPT-001 - Emergency pipeline, end-to-end timing test (2026-10-17)

Revision 0.3 | REVIEW_DRAFT | Owner: SNET | Raw results: `records/e2e/2026-10-17_emergency/results.json`, cards and bulletin text per set in the same folder (`<hazard>/<lang>.png`, `.svg`, `bulletin.json`). Tool: `tools/emergency-e2e.mjs`.

## What was tested
Five **exercises** (drills), each built from the most recent matching record in our history file, run through the real local server, never published (slot `drill`, labelled "exercise, not a real event" in the text and on the card, refused by every public route):

| Set | Record used | Level | Illustration |
|---|---|---|---|
| Earthquake | M 6.5 - 121 km NNE of Teluknaga, Indonesia (USGS) | GREEN | seismic |
| Flood | Flood in Malaysia, Thailand (GDACS FL 1103663) | ORANGE | hydrological |
| Storm | Tropical Cyclone NOUL-26 (GDACS TC 1001294) | ORANGE | meteorological |
| Wildfire / haze | Haze in Singapore, 24-hour PSI above 100, peak 212 (NEA PSI) | RED | wildfire |
| Volcano | Eruption Kanlaon (GDACS VO 1000152) | ORANGE | volcanic |

Pipeline per set: **draft** (code, validated) -> **translate** to Malay, Mandarin, Tamil (model, then code checks every number and name, then a different model translates back to English for the reviewer; one automatic repair pass) -> **human gate** (here a script clicks approve; real review time is separate, see below) -> **voice** (Google Cloud Text-to-Speech, one voice per language) -> **warning card** in four languages (the owner's AI-illustrated hazard artwork, alert-level band, the spoken text, a **WHAT TO DO** block quoted from the country's official guidance, "not an official warning" line; SVG made by the server, rendered to PNG in Chrome) -> **subtitles** (timed cues shown over the card in the player page, which plays the voice).

The emergency is **voice first**: the card is the picture and subtitle carrier, there is no presenter. "What to do" is only ever quoted from an official page on file (`content/guidance/hazard-guidance.json`): earthquake (SG BCA, MY NADMA/MetMalaysia), flood (SG PUB, MY JPS via Assist), storm (MY MetMalaysia), haze (SG NEA via Assist). Brunei hazards and volcano have **no sourced guidance on file**, so the card says so instead of inventing any.

## Measured system time (no human, final passes)
Two full passes of the five sets (15 translations each), run after the translation memory and retry changes:

| Pass | System min / median / max | Translate (median) | Translations OK | Wall time for all five |
|---|---|---|---|---|
| Cold (empty memory) | 30.4 / **54.0** / 66.9 s | 52.8 s | 15 of 15 | 249.6 s |
| Warm (guidance lines remembered) | 11.0 / **21.2** / 44.1 s | 19.6 s | 15 of 15 | 132.9 s |

**System time X: about 54 s cold, about 21 s once the official guidance lines are in translation memory, with the language model translating.** Cards: about 1 to 1.5 s for four languages. Draft: milliseconds. The spread is the provider (reAPI) speed, not our code. **Voice: not measured**, the Google Cloud Text-to-Speech API is not enabled in the project, so no audio was made.

How it got there: the first run had 14 of 15 successes with a median 48 s; two earlier runs failed more because provider time-outs opened the shared model circuit breaker. Fixes: a per-call deadline for translation only, at most 8 requests at once, sentence-sized pieces, one repair pass, 3 tries of 30 s, and **translation memory** (each sentence is stored; official guidance lines are the same in every bulletin of a hazard so only the new event sentence is translated live).

Quality checks: 0 number or name problems after the repair pass in the final passes. Memory pieces start as MACHINE; they become APPROVED only when a person who reads the language approves a **real** bulletin. Exercise approvals never promote memory (the test once did, and the memory was purged and the rule added).

## What the test does NOT prove
- **No native reader checked the translations.** The code proved numbers, times and names survived and a second model back-translated them; it cannot prove the wording is natural or right. The three fixed labels on the card (heading, level, exercise tag, disclaimer) were written by us and also need a native check.
- Voice and the subtitle timing against real audio were not produced (API off); subtitle cues are proportional to text length until real audio exists. The human review time below is an estimate, not a measurement.
- The English lines of official Malay guidance are our translation (marked as such) and need a native check, like the card labels.
- The model path depends on one provider's speed (reAPI, gpt-6-luna).

## Best practice we recommend (and which parts exist now)
1. **Code writes the facts, AI only translates, voices and illustrates.** No model writes a number, a place or a level. Exists.
2. **Automatic checks before a human sees it:** numbers, times and names must survive translation; a different model translates back; a flagged translation cannot be approved. Exists.
3. **A named person who reads the language approves each language** (a checkbox "I read this language"), rejection needs a reason, approval locks. Exists (API; the review screen is the next UI task).
4. **Release progressively:** English first (as soon as it is approved), each other language the moment its own reader approves it; never hold English for Tamil. Exists in the rules (each language has its own approval and public switch).
5. **Drills labelled and never public;** run the same harness monthly and before any real event season. Exists.
6. **Fixed texts (headings, levels, "not an official warning") translated once, reviewed once, reused;** only the event sentence is translated live. Exists through translation memory; the card labels are fixed texts.
7. **Fast machine path:** Google Cloud Translation (neural machine translation, typically about a second) for the first pass and the language model only for the back-translation check. This would take the machine time from about 54 s cold to well under 15 s and removes the single-provider dependency. Needs the Translation API enabled (see below).
8. **A fallback:** if the model or voice fails, the English card and voice still go out; the other languages follow when ready.
9. **Always a withdraw button;** every step timed and logged (append-only); KPI flags for late steps.

## Proposed time budget (target: voice on air within 5 minutes of the trigger)
| Step | Who | Budget |
|---|---|---|
| Trigger: pick the incident, Create | Administrator | 0:15 |
| Draft, translations (fast path), cards, voice | System | 0:15 (fast path) to 1:30 (language-model path, measured median 0:54 cold, 0:21 warm) |
| Review pack on one screen: English text, three translations with back-translations and flags, the four cards | Administrator who reads English, Malay and Mandarin | 2:00 to 3:00 |
| Tamil review | A Tamil reader, in parallel | by 4:00 |
| Approve and publish | Administrator | 0:15 |
| **English on air** | | **about 3:30 to 4:00** |
| Other languages | each as its reader approves | by 5:00 |

So **system X is about 0:15 to 1:30; the human gate is about 3 minutes if one person reads three of the four languages, and the 5-minute target holds with a Tamil reader on call.** There is no presenter in the emergency flow (voice, card and subtitles only).

## What is needed from the owner or Dsol
1. Enable the Google Cloud APIs (a cloud change, so the owner or Dsol runs it): `gcloud services enable texttospeech.googleapis.com translate.googleapis.com --project the-flame-511602-r3`, then create one key restricted to those two APIs (`gcloud services api-keys create --display-name=aegis-tts-translate --api-target=service=texttospeech.googleapis.com --api-target=service=translate.googleapis.com`) and put it in `.env` as `AEGIS_GOOGLE_TTS_API_KEY` (never in a chat or a file in git), plus `AEGIS_TTS_ENABLED=true`. Both are free at our volume (check the price book) (standard voices 4M characters a month free; Cloud Translation first 500,000 characters a month free).
2. Name the human reviewers per language (at least Malay, Mandarin, Tamil readers) and the native check of the fixed card labels.
3. Say whether the review screen (Translate, per-language review with back-translation, card preview) should be built next in Admin Desk.

## Update 2026-10-17 (later): the 15-second alert, Google voice and Google translation, measured

**Design change (owner: the alert must be as short as possible and to the point, about 15 s).** The emergency alert is now three short segments: what happened (one sentence, with the issue time), the one key official action (the first quoted official line of each sourced country, at most about 24 words; where nothing is sourced it says so), and a notice ("Not an official warning. Follow your local authority."). The long version is still available (`detail: "full"`). An emergency or exercise is read at 1.15 times normal speed (`AEGIS_TTS_EMERGENCY_RATE`, default 1.15, allowed 0.9 to 1.3).

**Pipeline now:** draft by code -> Google Cloud Translation (first pass, about 1 s per request) -> code checks every number and name -> a model translates back (one 10 s try; Google translates back if the model is slow) -> a person approves each language -> Google Cloud Text-to-Speech in four languages -> warning card with subtitles. Five exercises from the latest records, 15 of 15 translations OK, 0 flagged, in both runs.

| Run | System time per alert (draft, translate, voice, four cards) | Note |
|---|---|---|
| Google translation, model back-translation with the normal retries | 8.9 to 26.4 s, median 20.1 s | translate 5 to 22 s: the model back-translation was the slow part |
| Fast back-translation fallback (final) | **8.5 to 14.8 s, median 10.9 s** | translate 4 to 10 s, voice 2.3 to 2.9 s for three languages at once, cards 1.3 to 1.6 s |

**Real spoken length (MP3 length measured from the audio frames, includes "This is an exercise." of about 3 s that a real alert does not have):**

| Hazard | Malay | Mandarin | Tamil |
|---|---|---|---|
| Volcano (no official guidance on file) | 13.2 s | 12.6 s | 15.7 s |
| Flood (Malaysia, one short official line) | 13.6 s | 13.3 s | 15.4 s |
| Storm (Malaysia, one long official line) | 17.6 s | 16.2 s | 21.3 s |
| Earthquake (Malaysia, one long official line) | 21.8 s | 19.8 s | 26.5 s |
| Haze (Singapore, long headline and line) | 24.2 s | 21.9 s | 27.6 s |

**Honest reading:** the alert is about 13 to 16 s when the official line is short and 17 to 28 s when it is long; Tamil is the longest because the language needs more syllables. An official line is quoted whole and never cut, so it cannot be shortened by machine. To get every hazard to about 15 s, pick one short official line per hazard (for example the official phrase "Drop, Cover, Hold On" for earthquakes) and mark it as the brief line in `content/guidance/hazard-guidance.json`; that needs a reader of the source and the owner's approval. Human review time (about 3 minutes for one reader of English, Malay and Mandarin, a Tamil reader in parallel) is still an estimate, not measured.

### Live haze alert (Singapore, from the real NEA reading, 2026-10-17 16:37 MYT)
The emergency picker now offers **Singapore haze** whenever NEA's 24-hour PSI is Unhealthy or worse in a fresh reading (today: "Haze in Singapore: 24-hour PSI up to 191 (Unhealthy)", source NEA via data.gov.sg; regional values were 191 west, 185 central, 176 east, 160 south, 132 north). The haze alert reads the first **two** quoted NEA lines (healthy persons; the elderly, pregnant women and children). Run as a labelled exercise from the live reading: translations 3 of 3 OK with 0 flagged, machine plus scripted approval plus Google voice in four languages **16.1 s**; real audio length English 21.0 s, Malay 25.7 s, Mandarin 24.4 s, Tamil 29.5 s, each including the 2.5 s "This is an exercise" that a real alert does not have (so about 18 to 27 s). Not in the alert, on purpose: PM2.5 one-hour values and hotspot origin (no source on file), any Google air or weather value.

### Vietnam test (2026-10-17, `tools/vietnam-test.mjs`, results in `records/e2e/2026-10-17_vietnam/`)
Most recent Vietnam incident in our history: **Tropical Cyclone MAYSAK-26 (GDACS TC 1001281), ORANGE**, run as a labelled exercise. Languages: **Vietnamese, Khmer, Hmong** (the three machine-translatable languages of Vietnam by speakers; the largest minority languages Tay, Thai and Muong are not supported by Google Translation or Text-to-Speech). Result: 3 of 3 translations OK, 0 flagged; system time **13.7 s** (translate 7.6 s, voice 3.6 s, four cards 1.9 s). **Voice: Vietnamese and English yes; Khmer and Hmong no, Google Text-to-Speech has no voice for them** (text, card and subtitles only). The card for Khmer and Hmong uses English labels until a reader supplies them; the Vietnamese labels are ours and unread by a Vietnamese reader. **No official Vietnamese guidance is on file**, so the alert says so and never gives Singapore, Malaysia or Brunei advice to a Vietnam event.
