# AEG-RPT-003 - Johor: 15-second alert and one-minute follow-up, with video (2026-10-17)

| Field | Value |
|---|---|
| Document ID | AEG-RPT-003 |
| Revision | 0.1 (REVIEW_DRAFT) |
| Owner | SNET |
| Files | `records/e2e/2026-10-17_johor/` (`alert/` and `followup/`: per language card PNG and SVG, cues, `bulletin.json`, and the MP4 videos), `results.json`; tools `tools/johor-run.mjs`, `tools/make-card-video.mjs` |

## What was made
The live Singapore haze reading (NEA 24-hour PSI up to 193, Unhealthy) as the incident, run as a labelled **exercise** (never public) for a **Malaysian audience**:
1. **15-second alert**: what happened and the issue time, three quoted Ministry of Health Malaysia lines (reduce outdoor activity, stay indoors, N95 or P100 mask), the notice.
2. **One-minute follow-up for Johor**, drafted by code at the same moment: update (with NEA's southern PSI, 161, next to Johor), what is on file for Johor (MetMalaysia's Johor Bahru forecast; "check MetMalaysia for warnings"; the 9 monitored Johor locations by name only), the same quoted Malaysian guidance, the notice. It carries `followUpOf` and needs its own approval.
Each in English, Malay, Mandarin and Tamil: Google Cloud Translation, code checks, scripted approval (standing in for readers), Google Text-to-Speech, card, subtitles, and an MP4 (card, subtitles in step with the voice, no presenter).

## Measured
| | English | Malay | Mandarin | Tamil |
|---|---|---|---|---|
| Alert, real audio length | 20.5 s | 26.1 s | 22.3 s | 28.4 s |
| Follow-up, real audio length | 51.5 s | 65.2 s | 59.8 s | 72.8 s |
Both drafts took 0.25 s of machine time; the whole run (alert and follow-up, three translations each, four voices each, cards, cues) took 37.9 s. Every length includes about 3 s of "This is an exercise" that a real alert would not have, so a real follow-up is about 48 to 70 s. Videos: eight MP4 files (about 0.5 to 1.9 MB each). The voice is read at 1.15 times normal speed.

## Rules the follow-up keeps
Facts only from what is on file (no PM2.5 one-hour value, no hotspot origin, no Google air or weather value); official lines quoted whole and not editable; the follow-up is trimmed in this order when long: guidance down to 3 lines, then the map-pins sentence, then further guidance; a person approves each language.

## Fixes made on the way
- The Malaysian haze guidance contains numbers (100, 95, 100): numbers that appear inside the quoted official lines are now allowed by the validator (they are the official wording, not facts we add).
- The English back-translation sometimes spells a number out ("nine" for 9): that no longer flags the translation (the forward translation must still keep the digits).

## Not done
- Native readers for Malay, Mandarin, Tamil; the follow-up is only for Johor and only for the haze case was run.
- Johor flood advice is not sourced (the released flood card is Klang Valley and Selangor).
- The video is voice, card and subtitles; no presenter.
- Videos were assembled with an ffmpeg binary installed in a temporary folder outside the project (not a project dependency); the video tool takes the binary path as an argument. Choose and record a licence-checked ffmpeg build before it becomes part of the product.
