# AEG-BRF-010: Final build and Google integration (slide content)

For the last slide part. Written 2026-10-18 by SNET. This describes the **final build as it will stand at submission**, with every Google integration running on the hosted site. Section 6 is the checklist that must be true before the slide is shown.

## 1. One-line message

AEGIS is one Google Cloud service that reads public disaster feeds, lets Gemini help only with wording, and keeps a person in charge of every public word, voice and video.

## 2. The final build, end to end

1. **Feeds in**: USGS, GDACS, NEA PSI, MET Malaysia and AHA Centre reports are stored with source, time and licence. Code builds the fact sheet and the alert level.
2. **Gemini helps with words only**: Gemini on Vertex AI reviews and polishes scripts from the fact sheet; the AEGIS Assist chat (Gemini API) answers from stored evidence only.
3. **A person decides**: the administrator edits, approves or rejects. An emergency bulletin expires one hour after air time if not decided.
4. **Voice and video**: Google Cloud Text-to-Speech makes the voice; a Cloud Run job on one NVIDIA L4 GPU renders the one-minute presenter video.
5. **Languages**: Google Cloud Translation makes the ASEAN language versions, each approved by a person who reads it.
6. **Public page**: React map page on Google Maps with sourced incident cards, live Google Air Quality and Weather readings, and the 2016 to 2026 archive.
7. **Trust and cost**: hash-chained audit log, spend limits and on/off switches for every paid service, Cloud Billing export to BigQuery to read the real bill.

## 3. Google services in the final build

| Google service | What AEGIS uses it for |
|---|---|
| Cloud Run (service) | Hosts the Fastify API and the React app, asia-southeast1 |
| Cloud Run job, NVIDIA L4 GPU | One-minute presenter video render |
| Gemini on Vertex AI | Script review and wording help, billed to the project credit |
| Gemini API | AEGIS Assist chat (main or standby model) |
| Cloud Text-to-Speech | Emergency and news voice |
| Cloud Translation | ASEAN language versions |
| Google Maps JavaScript API | Regional map and archive map |
| Google Air Quality and Weather APIs | Scheduled refresh and click-to-fetch for one place. **Shown on screen only, never narrated and never put in generated video** (Google terms 3.2.3) |
| Cloud Billing export (BigQuery) | Real spend read back into the Admin Desk |
| Artifact Registry and Cloud Build | Build and store the container image |
| Cloud Storage | Render input and output bucket |
| Google sign-in (OAuth) | Admin and registered-user accounts |

## 4. What stays outside Google

SQLite database, hash-chained audit log, the fact sheet and alert-level code, the approval rules and the spend gateway. **Code decides, models speak**: Gemini never sets a figure, a level or a decision.

## 5. Numbers for the slide (checked on 2026-10-18)

- 981 unit and integration tests passed.
- 7 hazard domains; archive 2016 to 2026; live cards from USGS, GDACS and AHA ADInet.
- Emergency run: alert 27 s and Johor follow-up 72 s, both approved by an administrator, voices made.
- Job credit 4.00 USD; renders are gated by it, alerts never are.
- Add after the first render: measured render time and cost (replace the estimates of 0.20 and 0.43 USD).

## 6. Must be true before you show this slide

Tick each one, or change the matching line on the slide. The code for all of them exists; these are the parts that are not yet proven.

- [ ] Hosted redeploy done by Dsol; the hosted site shows the latest page.
- [ ] Gemini chat answers on the hosted site; Vertex AI script review runs there.
- [ ] Presenter render image built, one job run on the L4, video produced, measured time and cost written down.
- [ ] Translation and Text-to-Speech work from the hosted service.
- [x] Google sign-in tested against real Google (owner signed in on the old site at the custom domain, 2026-10-18; not seen by SNET). Repeat once on the final revision after the traffic switch.
- [ ] Google Air Quality and Weather refresh running on the hosted site, and no narration or video uses their values.
- [ ] Billing export current in the Admin Desk.
- [ ] Remarks still true and shown: figures are as the sources published them; the data-confidence tile is a provisional formula; some source licences are marked unverified.

If any box stays empty, say "designed" on the slide for that line. Do not say "live".
