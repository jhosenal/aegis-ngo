# AEG-SOP-003 — Admin Desk operating procedure

| Field | Value |
|---|---|
| Document ID | AEG-SOP-003 |
| Revision | 0.1 (REVIEW_DRAFT) |
| Date | 2026-10-16 |
| Related | AEG-SOP-002 (spend and render gates), AEG-CON-004 (formulas), skill `aegis-news-and-data-sources`, legal notice `content/legal/data-sources-and-pilot-notice.json` |
| Applies to | the owner, any administrator, the engineer, the operations agent and the frontend agent, for the page `/admin` |

## 1. Purpose

The Admin Desk is where an administrator sees the state of the pilot and **approves what the public sees**. It reads; it does not spend money, run cloud commands or edit the cost ledger. The one thing it writes is the screening decision on a bulletin.

## 2. Roles

| Role | Does |
|---|---|
| Owner (Jhosen Choong) | approves or holds bulletins, releases guidance cards (a named decision), approves ASK_OWNER spend, decides each Google pin capture |
| Administrator | any account with the administrator flag; may screen bulletins. The owner grants it (Admin API `/api/admin/users`) |
| Engineer (SNET) | builds the desk data, runs the cost gate, writes run sheets; never runs a cloud command |
| Operations agent (Dsol) | runs cloud commands only through the gate (AEG-SOP-002) |
| Frontend agent (SOL) | styles the desk; structure, data and the rules below are the contract |

## 3. Access

- **Local:** http://127.0.0.1:8787/admin, sign in as Dev Admin. **Hosted:** https://aegis.walkingwithai.com/admin with a Google account that has the administrator flag.
- A non-administrator sees "Administrators only". The desk answers 403 to anyone else.
- The hosted server holds no cost ledger, so the Spend tab says so and shows no numbers; the engineer's local ledger is the record. The hosted database is ephemeral: a redeploy empties bulletins, readings and decisions.
- Chrome on a desktop is the supported browser for now.

## 4. The page and its tabs (address `/admin?tab=approval|news|spend|feeds|notes`)

The page has the landing page's three columns: the dark sidebar (the tabs below, then the EXPLORE AEGIS links), the middle column with the module of the chosen tab, and the AEGIS Assist chat on the right to help the administrator (same chat panel as the landing page; it explains and answers, it does not act). On News approval the hero card sits at the very top of the middle column, exactly where the landing page's hero is, with the heading and the decision modules below it.

| Tab | Cards | Use it to |
|---|---|---|
| **News approval** (default) | the list of bulletins (draft as at now and the stored ones), the decision panel, the real landing page in a frame, the decision history | check the upcoming news on the same view the public gets (map and news reader), then approve, hold or withdraw |
| **News desk** | Aegis Broadcast Desk (slots, sources, latest bulletin, languages); GPU render on GCP | see the next capture, the narrated sources, the locked language stubs, the render gates and whether a test video arrived |
| **Spend and models** | Spend and cost gate; AI model budget | see budget, committed and remaining spend by funding source, what waits for the owner, flagged items |
| **Feeds and data** | Live feeds table; Data confidence (provisional); Google environment status; public evidence count | see whether USGS, GDACS, NEA PSI, MetMalaysia, Open-Meteo and OpenAQ are polling, and when each last succeeded |
| **Data control** | pin data at a glance; Refresh data (tick the sources); Dummy data; Add a pin; the list of pins; History | see and change the monitored pins: filter by country, state, role, data now, history, origin or text; refresh any source now; load demo data; add, delete and restore pins; export the pin list |
| **Remarks** | What this view cannot show | read the standing limits before trusting a number |

## 4a. Data control (AEG-DATA-001)

- **Refresh data:** tick the sources (USGS and GDACS, NEA PSI, MetMalaysia, Open-Meteo history, OpenAQ stations, Google air and weather) and the pins (all, the filtered list, or the ticked ones), then Refresh now. The free sources run as ticked. **Google is a billed call:** it needs the confirmation box, goes through the quota gate, is limited to 130 pins and one run per 10 minutes, and its readings are shown for one hour and never saved. Do it only when the owner has agreed.
- **Dummy data:** loads synthetic readings (labelled DEMO, kept one hour, never Google data) for all or the ticked pins, so the map, pin cards and temperature rings can be tried; Clear removes them and the last-updated time they made.
- **Add a pin:** name, country, state or region, latitude and longitude. The point must be inside the chosen country (rough check) and 500 m or more from another pin. It is marked "not yet checked against the owner's list", gets its Open-Meteo history at once, and appears on the public map immediately. **Delete:** an added pin is removed for good; a pin from the owner's list is hidden and can be restored under "show deleted". Nothing edits the owner's fixture file.
- **The list:** columns for pin, country, state, location, origin, last updated, data now (live, demo, expired, none) and 7-day rows; per pin Refresh (Open-Meteo), Google (billed, asks first), Delete; tick pins for bulk delete, demo load or a scoped refresh; Export CSV gives names and coordinates only.
- **History:** every add, delete, restore, refresh, demo load or clear and export is kept (who, when, what) in `pin_admin_log`.

## 5. Routine for each bulletin (captures 06:00, 11:00, 16:00, 21:00; air 07:00, 12:00, 17:00, 22:00 Malaysia time)

1. **Before the capture:** on Feeds and data, all narrated sources show OK with a recent last success (USGS, GDACS, NEA PSI, MetMalaysia). A source marked UNAVAILABLE or MALFORMED is read as "unknown", never as "no event"; the bulletin says its data was not available.
2. **After the capture** (about one minute later): News tab, Screening room. The new bulletin shows WAITING.
3. **Check it on the landing page.** The frame under the decision panel is the landing page's own hero card (same code, same layout, same size as on the landing page: map toolbar, presenter bottom right, EN/CN/BM/TA, play, transcript) with the news reader showing this bulletin. Press play for the subtitles and the lower third naming the source; the transcript button shows the script and the credits; "Fast play (8x)" speeds it up; the size buttons show the hero as on a 1440 or 1920 px screen. Languages other than English are disabled (no reviewed translation). The presenter is a placeholder and there is no audio until a render exists; the timing is estimated. Read every segment against this list; any failure is HOLD:
   - Numbers and places match the source pages (PSI values and bands, MetMalaysia warnings, GDACS alert level, USGS magnitude and place).
   - Source names are right and the credits list every narrated source with its licence line.
   - **No Google air or weather value or word** anywhere in the text or lower thirds.
   - Tone: "good news" only when nothing is wrong (no PSI band above Moderate, no warning, no event); Brunei is "our feeds record nothing", never "safe".
   - Capture time is stated; the next briefing time is right; the closing says conditions may have changed.
   - Guidance lines appear only if the release is APPROVED (see section 6) and quote NEA, not our own advice.
4. **Decide.** WAITING bulletins have **Approve and lock** (asks to confirm) and **Hold**. 
   - **Approved means locked.** Nothing about an approved bulletin can be changed: no second approve, no hold. The panel shows the lock, who approved and when.
   - **Withdraw** is the only way back: it needs a written reason (at least 5 characters), takes the bulletin off the public page at once, and records who, when and why. A withdrawn or held bulletin shows its reason and an **Approve again** button, which locks it again.
   - Every approve, hold and withdraw is kept in an append-only decision history shown under the panel.
   - The public page shows the newest bulletin that is currently approved (an older one states its own capture time). Withdraw that one too if it must not be shown.
   - **Reject** is the button for Hold: it asks for a written reason (at least 5 characters), keeps the bulletin off the public page and records who, when and why.
   - **Emergency alert length:** a new emergency bulletin is the 15-second alert (what happened, the one key official action, the notice). The long version is the API option `detail: "full"`. The voice is read at 1.15 times normal speed for an emergency or exercise.
   - **Singapore haze** appears in the emergency picker when NEA's 24-hour PSI is Unhealthy or worse (fresh reading); its alert reads two quoted NEA lines (healthy persons, then the elderly, pregnant women and children).
   - **Languages and audience:** the translation languages are listed in `content/broadcast/translation-languages.json` (18 languages Google can translate; a Google voice exists for 8 of them, the rest get text, card and subtitles only). An emergency request may carry `audience` (an ISO3 code such as VNM): the alert then uses that country's guidance, and a country with no sourced guidance says "No official guidance on file" instead of borrowing another country's advice.
   - **Follow-up (Johor):** `POST /api/admin/screening/emergency` with `{ followUpOf: <alert id>, area: "Johor" }` drafts the one-minute follow-up from the same incident and the current captured facts. It is a separate bulletin with its own approval, translations and voice, labelled as an exercise when the alert is.
   - **Job cards and the job credit (Governance and costs tab, and "Jobs and cost of this bulletin" in the review panel).** Every unit of work (a code draft, a translation, a voice, a presenter render) is one card with a UUID, its priced lines, its estimate and its settled cost, so it can be pulled for audit (Download JSON). The job credit is an operating balance (opening 4.00 USD, set by the owner 2026-10-17; an administrator tops it up with a reason). Estimates are ceilings from the price book (UNKNOWN when a price or the price book is missing, never shown as zero); the credit never blocks an alert, it gates presenter renders (a render above the balance waits for the owner). Neither the estimate nor the settled cost is Google's invoice.
   - **Presenter render speed:** Normal (1 GPU job), Fast (2), Max (3, the project's L4 quota) with ETA and estimated cost shown before the request. The request creates a render job card and records the speed; Dsol starts the render. "Mark presenter ready" with the instance seconds settles the card.
   - **Google bill (Governance and costs tab):** Google's real charges for the month (gross cost, credits applied, net to the card, by service), read-only, from the Cloud Billing export in BigQuery (`AEGIS_BILLING_EXPORT_TABLE`; local login `AEGIS_BILLING_AUTH=gcloud`, on Cloud Run the service account needs BigQuery Data Viewer and Job User). The export lags the console by a few hours. The Cloud Billing API KEY cannot read charges (it reads only the public price catalog). Services still inside their free allowance (Text-to-Speech, Translation) do not appear. Do NOT record a period total with `cost actual` without `--seq`: the cost engine counts it as unexplained spend on top of the estimates it overlaps.
   - **Script review (Suggest wording, Pro and Admin):** each editable segment has "Suggest wording (Argon)". Gemini 4 Argon on Vertex AI proposes a more natural wording; the proposal is checked by the edit rules and shown with its tokens, latency, cost and job card; "Accept this wording" saves it through the normal script edit (logged), "Dismiss" discards it. It usually answers in 4 to 8 seconds and sometimes takes up to a minute; never use it on the emergency path. Needs `AEGIS_VERTEX_PROJECT` (and `AEGIS_VERTEX_AUTH=gcloud` on the owner's machine).
4a. **Edit the script and review each language (standard workflow, before step 4's Approve).** The Review panel under the decision buttons:
   1. **Edit** (English script only, only while the bulletin is not approved): each segment has an Edit button, a text box, an optional reason and Save script. Code checks the edit: it may not add a number or a name/acronym the original segment did not have, a drill must keep saying it is an exercise, and the official **What to do** and **Notice** segments are not editable here (change the guidance file, with its source). Every change is kept in "Script changes" with the text before and after. Saving clears the translations and voice made from the old words; make them again.
   2. **Translate** the ticked languages (needs the models on, or Google Cloud Translation with `AEGIS_TRANSLATE_ENABLED=true`; the key is `AEGIS_GOOGLE_TRANSLATE_API_KEY` or the shared `AEGIS_GOOGLE_TTS_API_KEY`, in `.env` only). Google does the first pass in about a second and a model translates back, or a model translates and Google is not used. A model translates, code checks every number and name, a second model translates back to English so you can compare.
   3. **Per language:** tick "I read this language", then **Approve** (disabled while code flagged a number or name problem) or **Reject** with a reason (5+ characters). Approved is locked. Only an approved language gets its voice and public card. Approving a real bulletin makes its pieces human-approved translation memory; an exercise never does.
   4. Then approve and lock, or Reject, the English bulletin (step 4). Order: edit, translate, review each language, approve.
5. If the public page shows "No bulletin has been approved yet" at air time, the bulletin is still WAITING, HELD or withdrawn. A held bulletin is not republished; the next capture produces a new one.
6. The **Draft as at now** card is a preview built from stored data at this moment. It is never stored or shown to the public.

## 6. Guidance cards (NEA band advice and hydration line)

They enter a bulletin only while `records/releases/assist-release.json` is APPROVED for the current content hash. This is the owner's named decision, recorded as "sources checked, not clinical" (SOURCES_CHECKED_NOT_CLINICAL). Any edit to a card cancels it and the bulletin falls back to text without advice. Release before building the hosted image (the record is baked into the image).

## 7. Spend and render

The Spend tab and the GPU render card show the ledger; they never change it. Every action that can cost money goes through `npm run cost -- gate` (AEG-SOP-002). ASK_OWNER waits for the owner's approval entry. The render card lists each render gate (decision, worst case, approved, actual), whether the script exists, whether a video has arrived and the run sheet. A video from a test render is not played publicly while the weight and idle-clip licences are UNVERIFIED.

## 8. Google data on the desk and on pins

Google air and weather readings are held in memory for at most one hour, never stored, never narrated and never in a script, image or video. The Google environment card shows only status and counts. The four-a-day Google schedule is OFF (owner decision 2026-10-16); a capture is a one-off owner-approved run (`AEGIS_ENV_REFRESH_ONCE_AT`). Seven-day history on a pin comes from Open-Meteo (modelled) and OpenAQ (measured by sensors), both stored with source and licence.

## 9. If something looks wrong

| You see | Do |
|---|---|
| Screening room is empty after a capture time | check the server is running and `AEGIS_BROADCAST=true`; read `data/api.out.log` for the `broadcast:` line; tell the engineer. Do not hand-edit the database |
| Validator problems in the draft card | do not approve; tell the engineer with the card text |
| A source stays UNAVAILABLE | tell the engineer; the bulletin must say the data was not available |
| Spend shows "UNKNOWN cost" or a flagged item | stop new spend in that service and tell the engineer (AEG-SOP-002 section 5) |
| A number or word from Google appears in a script, image or file | HOLD, delete the file, tell the engineer the same day |
| The hosted desk is empty after a deploy | expected (ephemeral database); the next capture refills it |

## 10. Changing the desk

A change to what the desk shows or writes is an engineer change with a test, a work-log entry and a re-declared work-log hash. The frontend agent may restyle, reorder cards and rename labels; it may not remove the screening decision, the rules in section 5, the Google remarks or the read-only nature of the desk. New cards state their source and whether they are live, stored or modelled.

## 11. Open items (honest list)

- Reject (hold) now asks for a written reason in the form. Script editing covers the English script only; translations are not hand-edited (reject and translate again).
- Decisions are in an append-only table (`broadcast_review_log`) but not in the hash-chained audit.
- The preview has no audio and no real video: it shows a presenter placeholder and estimated timing until a render exists.
- The Remarks tab is generic; Data confidence is provisional; Brunei has no official source.
- The hosted server has not yet received the screening room (Dsol redeploys).

## News pipeline: daily and emergency bulletins (added 2026-10-17, AEG-NEWS-007)
**Order, always:** Capture, Write (code-written template), Validate (every number must exist in the captured facts), **Review** (an administrator approves and locks, holds, or withdraws with a written reason), Voice, Presenter, Publish. Review comes before the voice and the presenter because the presenter render is slow and paid (the test render of 3 min 40 s took about 50 minutes on Google Cloud, about 2.4 USD).
1. **Daily bulletin.** Captured one hour before its 07:00, 12:00, 17:00 or 22:00 slot. Targets: script within 2 minutes of the capture; approved at least 15 minutes before air time; voice ready within 5 minutes of approval; presenter ready by air time. If the presenter is late the voice airs on time and the video follows.
2. **Emergency bulletin.** Admin Desk > News approval > Emergency bulletin: pick a current incident (most severe first), choose Voice only or Voice then presenter, Create emergency draft. A short bulletin is written by code from that incident, checked by the same validator, and stored unreviewed. It says it is an AEGIS summary of an official source, never an official warning. **It is not published until you approve it.** Targets: draft within 1 minute of the trigger; approval within 2 minutes of the draft; voice on air within 5 minutes of the trigger; the presenter is an optional follow-up and never delays the voice. The system never creates or publishes an emergency bulletin by itself.
3. **Pipeline panel** (under the decision on each stored bulletin): the scenario badge (DAILY or EMERGENCY), the output choice (Voice only, Voice then presenter; fixed once the presenter is requested), the languages, the timing rows against the targets (On target, At risk, Late, Pending), and the production steps. Missed targets are flagged, not hidden.
4. **Voice (stub).** Listen (browser voice) lets you proof-listen to the script in your browser at any time. Prepare voice (stub) is available after approval and records the step; the audio is made by the browser and no file is kept. Google Cloud Text-to-Speech is the planned voice service (about 4 USD per 1M characters for standard voices and 16 USD for WaveNet, with 4M and 1M characters free each month; read from the billing catalog 2026-10-17). It never reads Google air or weather values.
5. **Presenter (gated).** Request presenter render only records the request (AEG-SOP-002 Annex A, the Render card); it does not start a cloud job. When the video exists, Mark presenter ready and say where it is.
6. **Languages.** English is always made. Tick others with the + (Malay, Mandarin, Tamil, Indonesian, Thai, Vietnamese, Filipino, Burmese, Khmer, Lao). Every language except English is a locked stub: ticking records the request and nothing is translated or voiced until a reviewer who reads that language signs it off (catalog: content/broadcast/language-catalog.json).
7. Every step is append-only (bulletin_step, broadcast_review_log): the timeline of a bulletin cannot be rewritten afterwards.

### Voice with Google Cloud Text-to-Speech (added 2026-10-17)
When the server runs with `AEGIS_TTS_ENABLED=true`, **Make voice (Google Text-to-Speech)** (after approval) turns the approved, validated script into an MP3, keeps it with the bulletin (`bulletin_voice`) and records the step with the voice and the number of characters. **Listen (Google voice)** then plays that file; an approved bulletin's audio is also served at `/public/broadcast/voice/<bulletinId>` and is withdrawn from the public with the bulletin. Without the switch the voice step stays the browser-voice stub. Default voice `en-GB-Standard-B` (standard voices: first 4M characters a month free, then 4 USD per 1M; a bulletin is about 3,000 characters). The call needs the Cloud Text-to-Speech API enabled on the project and either `AEGIS_GOOGLE_TTS_API_KEY` (a key allowed to call it) or, on Cloud Run, the service account. The script holds no Google air or weather values, so the voice never reads them. If Google refuses, no voice is recorded as ready and the message says why; the browser voice still works for proof-listening.

### Live test: the environment pointer line (added 2026-10-18, owner request)
For a flood or haze alert, the spoken script may end with a pointer to the live map instead of any air or weather figure. The approved wording:

> An official flood alert remains in effect for Johor Bahru as issued by MET Malaysia. For real-time environmental conditions, rain forecasts, and air quality indexes over the next hour, please check the interactive live map on our AEGIS dashboard.

Rules for the administrator before approving a script that contains it:
1. **The first sentence is a claim.** Say "remains in effect" only if a current MET Malaysia statement for that area is stored and still in force (the card shows its source and time). If the statement has ended or is older than the bulletin window, change the sentence ("A flood alert was issued ..." with the time) or remove it. Do not leave it by habit.
2. **The pointer is the only mention of air quality or weather.** Google Air Quality and Weather values are never narrated and never in generated video (Google terms 3.2.3). The sentence names no number and no condition; the map shows them on screen.
3. **The map must be live.** Before approving, open the public page and check the map shows the readings for that place. If the hosted site is not serving the Google refresh, remove the pointer sentence.
4. **Name the area as the source does** (Johor Bahru, not a nearby district) and keep the source's wording for the alert.
5. Log the check in the bulletin note when approving: "MET statement current, pointer line checked".
