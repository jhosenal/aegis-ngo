# AEG-BRF-006 — Slide content: ASEAN language coverage with Google (send this file)

| Field | Value |
|---|---|
| Document ID | AEG-BRF-006 |
| Revision | 0.1 (REVIEW_DRAFT) |
| Date | 2026-10-17 |
| Written for | the owner, who builds the slides. Three slides (or one slide plus two backups). Each has **on-slide text** (copy it), a **visual** (with the exact image files), a **say** note (30 seconds) and a **proof** line |
| Source of numbers | `AEG-RPT-002` and `records/e2e/2026-10-17_asean/results.json` |
| Fits in | the Google technology slide (`AEG-BRF-004` criterion 01) and the impact slide (`AEG-BRF-005`) |

## Files to send with this one
1. **This file** (the slide text).
2. These images, one per slide, from `records/e2e/2026-10-17_asean/` (PNG, 1200 by 675, ready to place):
   - `MY/ms.png` (Malay card with official earthquake guidance), `SG/zh.png` (Mandarin flood card), `VN/vi.png` (Vietnamese card, "no official guidance on file"), `MM/my.png` (Burmese card), `TH/th.png` (Thai card), `KH/km.png` (Khmer card), `ID/id.png`, `PH/tl.png`, `TL/tet.png`.
   - If a file is missing, run `node tools/asean-test.mjs` again (server on :8787); every card is regenerated.
3. Optional proof for a backup slide: `records/e2e/2026-10-17_asean/google-language-support.json` (the lists Google returned, no secrets) and `AEG-RPT-002_asean-language-test.md`.
Do **not** send `.env`, the work log or raw database files.

---

## Slide A — One alert, every ASEAN country, in their languages

**Title:** *Emergency alerts in the languages people speak: tested across ASEAN*

**On slide:**
- **11 countries tested** (all ASEAN members), **18 languages** translated with **Google Cloud Translation**, **8 languages spoken** with **Google Cloud Text-to-Speech**.
- Each alert is **15 seconds**: what happened, one official action, a notice.
- **24 of 24 translations passed the code checks** (every number and name must survive). **Median machine time 10.5 seconds** per country.
- A person who reads the language approves it before anyone hears it.

**Visual:** a row of four cards left to right: Malay (`MY/ms.png`), Vietnamese (`VN/vi.png`), Thai (`TH/th.png`), Burmese (`MM/my.png`), each captioned with its country and language. Above them one line: *Each country's own recent incident, the same checks, a different language and script.*

**Say:** We asked Google which ASEAN languages it supports, then ran an emergency drill in every country in its top three languages. Twenty-four of twenty-four translations passed our automatic fact checks. Nothing is broadcast until a person who reads that language approves it.

**Proof:** `AEG-RPT-002`; `records/e2e/2026-10-17_asean/results.json`.

---

## Slide B — The coverage table (honest version)

**Title:** *What Google covers today, and what it does not*

**On slide (table, 11 rows; keep the colour code: green = text and voice, amber = text only, grey = not supported):**

| Country | Top three languages | Text | Voice |
|---|---|---|---|
| Brunei | Malay, English, Chinese | ms, zh | ms, zh, en |
| Cambodia | Khmer, Vietnamese, Cham | km, vi | vi |
| Indonesia | Indonesian, Javanese, Sundanese | all 3 | id |
| Laos | Lao, Khmu, Hmong | lo, hmn | none |
| Malaysia | Malay, Chinese, Tamil | all 3 | all 3 |
| Myanmar | Burmese, Shan, Karen | my, shn | none |
| Philippines | Filipino, Cebuano, Ilocano | all 3 | Filipino |
| Singapore | English, Chinese, Malay | zh, ms | zh, ms, en |
| Thailand | Thai, Isan, Northern Thai | th | th |
| Timor-Leste | Tetum, Portuguese, Indonesian | all 3 | pt, id |
| Vietnam | Vietnamese, Tay, Thai (Vietnam) | vi | vi |

**Below the table, one line:** *7 minority languages are not supported by Google (Cham, Khmu, Karen, Isan, Northern Thai, Tay, Thai of Vietnam). 10 supported languages have no Google voice.*

**Visual:** the table with green, amber, grey cells and a small legend.

**Say:** This is not a claim that we cover everyone. Google covers eighteen of our languages today; seven minority languages need another route, and ten supported languages are text-only because Google has no voice for them. We show that on the slide rather than hide it.

**Proof:** `google-language-support.json` (Google's live lists) and `results.json`.

**Footnote to put on the slide (small):** *Top three languages by number of speakers are the team's compilation and are approximate; a census citation will be added.* (Remove only when a source is cited.)

---

## Slide C — Safe by design: Google writes words, code owns facts, people approve

**Title:** *Why faster does not mean riskier*

**On slide:**
- **Code writes the facts** (numbers, place, time, level). **Google translates and speaks.**
- **Checks:** every number and name must survive translation; a second engine translates back so the reviewer can compare; a flagged translation cannot be approved.
- **Human gate:** a named reader approves each language; rejection needs a reason; approval locks; every step is logged.
- **Official advice only quotes official pages.** Where none is on file the alert says **"No official guidance on file. Follow your local authority."** In the test only Singapore flood advice (PUB) and Malaysia earthquake advice (NADMA, MetMalaysia) are sourced; every other country says so.
- **Not an official warning:** every card says so and tells people to follow their local authority.

**Visual:** left, the Vietnamese card (`VN/vi.png`) with a callout on "no official guidance on file"; right, the Malay earthquake card (`MY/ms.png`) with a callout on the quoted official line.

**Say:** Speed comes from machines doing the words; safety comes from code owning the facts and a person approving. Where we have no official advice we say so and do not invent any.

**Proof:** `AEG-RPT-001`, `AEG-RPT-002`, `content/guidance/hazard-guidance.json`.

---

## Words you must NOT put on these slides
- "Google verified the translations are correct" (Google produced them; our code checks numbers and names; a reader checks wording).
- "Covers all ASEAN languages" or "100% of the population" (18 languages; 7 minority languages unsupported).
- "Native speakers reviewed" (none has yet).
- "Official guidance for every country" (only two cases in this test).
- Any number not listed here (use only: 11 countries, 18 languages, 8 spoken, 24 of 24, 7 unsupported slots, 10.5 s median, 15 seconds).

## Before the slides are final
1. Cite a source for the top-three language rankings (census or Ethnologue), or keep the footnote.
2. Name a reader for at least Malay, Mandarin, Tamil (and Vietnamese if available) so "approved by a reader" is true for those languages.
3. If you add Gemini, say so only after `AEG-BRF-003` conditions are met.
