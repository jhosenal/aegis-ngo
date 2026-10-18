# AEG-RPT-002 — ASEAN-wide language test with Google (2026-10-17)

| Field | Value |
|---|---|
| Document ID | AEG-RPT-002 |
| Revision | 0.1 (REVIEW_DRAFT) |
| Owner | SNET |
| Raw results | `records/e2e/2026-10-17_asean/` (`results.json`, per country `bulletin.json`, cards `<lang>.png/.svg`, `google-language-support.json`); tool `tools/asean-test.mjs`; Vietnam alone: `records/e2e/2026-10-17_vietnam/` |
| Written for | the owner (slides) and reviewers |

## What was tested
For each of the **11 ASEAN countries** (Timor-Leste is the 11th member since October 2025), the most recent matching incident in our history file (Singapore had no flood, quake, storm or volcano record, so a labelled exercise scenario was used), run as a labelled **exercise** (never public) through the real local pipeline in the country's **top three languages**:
draft by code -> **Google Cloud Translation** -> code checks every number and name -> scripted approval (standing in for a reader) -> **Google Cloud Text-to-Speech** where Google has a voice -> 15-second warning card with subtitles. The alert is addressed to the **country's own audience** (`audience` setting), so a Vietnamese alert never carries Singapore, Malaysia or Brunei advice.

**Caveat on "top three".** The ranking of languages by number of speakers is **our compilation from general knowledge, approximate, with no census table saved yet**. Cite a source (a census or Ethnologue) before a slide says "top 3". The sources of truth for what Google supports are the live lists saved in `google-language-support.json`.

## Result (final run)
| Country | Top three languages (our ranking) | Google translation | Google voice | Official guidance on file |
|---|---|---|---|---|
| Brunei | Malay, English, Chinese | ms, zh yes (English is the source) | ms, zh, en | none |
| Cambodia | Khmer, Vietnamese, Cham | km, vi yes; **Cham not supported** | vi, en | none |
| Indonesia | Indonesian, Javanese, Sundanese | all 3 | id only | none |
| Laos | Lao, Khmu, Hmong | lo, hmn yes; **Khmu not supported** | none (no Lao or Hmong voice) | none |
| Malaysia | Malay, Chinese, Tamil | all 3 | all 3 | earthquake: NADMA and MetMalaysia (quoted) |
| Myanmar | Burmese, Shan, Karen | my, shn yes; **Karen not supported** | none | none |
| Philippines | Filipino, Cebuano, Ilocano | all 3 | Filipino only | none |
| Singapore | English, Chinese, Malay | zh, ms yes (English is the source) | zh, ms, en | flood: PUB (quoted) |
| Thailand | Thai, Isan, Northern Thai | th yes; **Isan and Northern Thai not supported** | th | none |
| Timor-Leste | Tetum, Portuguese, Indonesian | all 3 | pt, id (no Tetum voice) | none |
| Vietnam | Vietnamese, Tay, Thai (Vietnam) | vi yes; **Tay and Thai (Vietnam) not supported** | vi | none |

**Numbers.** 33 language slots; 2 are English (the source language); **24 translations made, 24 of 24 OK, 0 flagged by the number and name checks**; **7 slots unsupported by Google Translation** (Cham, Khmu, Karen, Isan, Northern Thai, Tay, Thai of Vietnam). Distinct languages translated: **18** (Malay, Mandarin, Tamil, Vietnamese, Khmer, Hmong, Indonesian, Javanese, Sundanese, Lao, Burmese, Shan, Filipino, Cebuano, Ilocano, Thai, Tetum, Portuguese). Languages with a **Google voice: 8 plus English** (Malay, Mandarin, Tamil, Vietnamese, Indonesian, Filipino, Thai, Portuguese); the other 10 get text, card and subtitles only. System time per country **median 10.5 s (6.1 to 37.9 s; Indonesia was the slow one)**, whole run 142 s.

## What we can truthfully say
- "Google Cloud Translation and Text-to-Speech, with automatic code checks of every number and name, run Aegis's emergency alerts in **18 ASEAN languages (8 of them spoken)**, covering **26 of the 33** top-three language slots of the 11 ASEAN countries (2 are English, the source, and 7 are not supported by Google)." The count 26 = 24 translated + 2 English.
- Honest limits on the same slide: seven minority languages are not supported by Google; ten supported languages have no Google voice; **no native reader has checked any of the 18 translations**; official "what to do" lines exist only for Singapore (flood) and Malaysia (earthquake) in this test, other countries say "no official guidance on file".
- **Do not say** "Google checked the translations are correct": Google produced them; our code checks that numbers and names survived and a second engine translates back for the reviewer; correctness of wording needs a human reader per language.

## Not done
- No reader for any language; card labels are fixed texts in English, Malay, Mandarin, Tamil and Vietnamese (ours, unread); other languages use English labels.
- Official guidance for 9 of the 11 countries (and Brunei) is not sourced.
- The language catalog (admin screen) still lists most of these as locked stubs; the API and this test treat them as translatable.
- The top-three language ranking needs a citation.
