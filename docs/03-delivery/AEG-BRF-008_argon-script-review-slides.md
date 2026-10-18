# AEG-BRF-008 — Slide content: Gemini 4 Argon script review on Vertex AI, with measured cost (send this file)

| Field | Value |
|---|---|
| Document ID | AEG-BRF-008 |
| Revision | 0.1 (REVIEW_DRAFT) |
| Date | 2026-10-17 |
| Written for | the owner, who builds the slides. Three slides (two main, one backup). Each has **on-slide text**, a **visual**, a **say** note (30 seconds), the **proof**, and the **honest line** to keep small on the slide |
| Source of every number | `AEG-RPT-004`, `records/e2e/2026-10-17_argon/run2/results.json` (16 calls in two runs; the figures below are run 2 unless stated) |
| Serves | the judging criteria "Google generative AI integration" (`AEG-BRF-004` criterion 01) and "testing, reliability and cost" (criterion 05) |

## Files to send with this one
1. **This file.**
2. `records/e2e/2026-10-17_argon/ui-suggest-wording.png` (real screenshot of the feature on a live Malaysia segment, with tokens, cost and job ID). Note: it shows the older, stiffer stored wording, which makes the before and after easy to see.
3. Optional proof for a backup slide: `records/e2e/2026-10-17_argon/run2/results.json` and `docs/03-delivery/AEG-RPT-004_argon-vertex-proof.md`.
Do **not** send `.env`, the work log or database files.

---

## Slide A — AI helps with the words. Code owns the facts. A person decides.

**Title:** *Gemini 4 Argon reviews the wording of every script, and cannot change a fact*

**On slide:**
- **What it is:** a "Suggest wording" button on each script segment. **Gemini 4 Argon on Google Cloud Vertex AI** proposes a more natural way to read the same words aloud.
- **What stops it going wrong:** every proposal is checked by code before anyone sees it as valid: **no new number, no new name, the exercise label kept, official guidance and the notice never reworded**, length within limits.
- **Meaning is protected too:** a proposal may not make a hazard sound **more likely, more certain or more urgent**. Qualifiers such as *possible, may, forecast, expected, in a few places, officially rated* must stay, and words such as *will, severe, dangerous, immediately* cannot be added.
- **Who decides:** a person clicks **Accept** or **Dismiss**. Nothing changes without that, and every accepted change is logged with the text before and after.
- **8 of 8 proposals passed the fact checks** in the measured run, on real segments.

**Visual:** the screenshot `ui-suggest-wording.png` on the left. On the right a 3-step strip: *Code writes the facts → Argon proposes wording → Code checks, person accepts.*

**Say:** The AI does the part it is good at, how the words sound. Code owns every number and name, and a person approves. In our test, all eight proposals kept every fact, and we show the cost of each one.

**Proof:** the screenshot; `AEG-RPT-004`; `src/services/broadcast/scriptReview.ts` and its tests.

**Example for a slide (real, from the test; numbers unchanged):**
- *Before:* "In Johor: MetMalaysia's forecast for today in Johor Bahru: haze in the morning and at night, thunderstorms in a few places in the afternoon, 24 to 33 degrees. ... 9 monitored locations in Johor are on the AEGIS map, including Johor Bahru City Centre, Muar and Batu Pahat."
- *After (Argon, strict run):* "In Johor, MetMalaysia's forecast for today in Johor Bahru is 24 to 33 degrees. It shows haze in the morning and at night, with thunderstorms in a few places in the afternoon. Check MetMalaysia for weather warnings that apply to Johor. The AEGIS map shows 9 monitored locations in Johor, including Johor Bahru City Centre, Muar and Batu Pahat."

**Honest line (small print):** *In an earlier run Argon wrote that thunderstorms "will hit" where the forecast said "in a few places": that is the kind of strengthening the new rule now blocks (and a test locks it). Code checks facts and qualifiers, not every nuance of tone, so a person still accepts or rejects every proposal.*

---

## Slide B — What it costs and how fast, measured

**Title:** *Measured on real segments: under a cent per review*

**On slide (table):**

| | Measured |
|---|---|
| Model and path | **Gemini 4 Argon on Vertex AI** (Google Cloud), billed to our project |
| Calls in the test | **16** over two runs (**8 of 8** succeeded in the second) |
| Cost per review | **0.0036 USD average** (0.0016 to 0.0077) |
| One whole daily bulletin (6 segments) | **about 0.025 USD** |
| Worst case, every segment of 4 bulletins a day | **about 3 USD a month** |
| Speed | **5 seconds average**, usually 4 to 8; some calls take up to a minute |
| Price used | **4 USD per million input tokens, 20 USD per million output** (Vertex AI list price) |

**Visual:** a four-number strip (**16 calls · 8 of 8 passed the checks · 0.0036 USD each · 5 s**) over the table; under it a small "job card" thumbnail showing one review job with its UUID and cost.

**Say:** We did not guess the cost. Every call returns its token counts, we multiply by Google's own price list, and each call is a job card we can audit. A review is under a cent; even reviewing everything all day is about three dollars a month.

**Proof:** `results.json`; the job cards (filter "Review" in Governance and costs); price source `records/costs/sources/google-vertex-argon-skus_2026-10-17.json`; ledger entries 46 to 48.

**Honest line (small print):** *Cost is computed from the token counts the API returned at Google's list price. Google's invoice line for these calls was not yet in the billing export when measured, so it is pending confirmation. First run: 4 of 8 calls timed out at 60 seconds; latency has a long tail, so the helper is for editing, never for the emergency path.*

---

## Slide C (backup) — How it is wired, and what is not claimed

**Title:** *Production-grade path, honest limits*

**On slide:**
- **Google Cloud services in this feature:** **Vertex AI** (Gemini 4 Argon, global endpoint), **Cloud Billing Catalog API** (prices), **BigQuery billing export** (the real bill, shown in the Admin Desk), Google Cloud sign-in for the server (no API key in the browser or in the code).
- **Why Vertex AI:** the Gemini Developer API key is on the free tier and refuses Argon; Vertex AI works in our billed project and is the production path.
- **Controls:** Pro and Admin only; refused on an approved (locked) bulletin; one job card per call with estimate, token counts and settled cost; cost gate entry before the test run.
- **Not claimed:** the main chat assistant is **not** yet on Gemini; Argon does **not** write bulletins (code writes them); invoice-level cost is pending; the test used 8 distinct segments, so more cases can be run.

**Visual:** a small flow: *Admin clicks → AEGIS server → Vertex AI (Gemini 4 Argon) → checks → proposal → person accepts → logged*, with the cost line under it.

**Say:** This is how it would run in production. It uses Google Cloud's own authentication, every call is audited with its cost, and we say plainly what is still to prove.

**Proof:** `AEG-RPT-004`; `src/services/vertexGemini.ts`.

---

## Words you must NOT put on these slides
- "Gemini powers the assistant" or "the chatbot runs on Gemini" (not true yet).
- "Argon writes the news" or "AI-generated bulletins" (code writes the script; Argon only rewords on request).
- "Verified on our Google invoice" (pending).
- "Zero errors" or "100% accuracy" (8 of 8 passed the fact checks; the checks do not judge tone).
- Any cost number that is not in the table above.

## Before the slides are final
1. When the billing export refreshes, check the Google bill card for a Vertex AI row near 0.046 USD and, if it matches, change the honest line on Slide B to "confirmed on the Google billing export".
2. If you want a larger test, say how many more cases (the new calm-wording draft, other languages, the follow-up for other areas).
3. Dsol to set the Vertex settings on the hosted server if you want the button on the hosted site.
