# AEG-RPT-004 - Proof: Gemini 4 Argon runs on Vertex AI, with measured cost (2026-10-17)

| Field | Value |
|---|---|
| Document ID | AEG-RPT-004 |
| Revision | 0.1 (REVIEW_DRAFT) |
| Owner | SNET |
| Raw results | `records/e2e/2026-10-17_argon/run1/results.json`, `run2/results.json`; tool `tools/argon-proof.mjs`; one job card per call (kind `review`, filter "Review" in Governance and costs) |
| Cost gate | ledger entry 46 (GO, estimate 0.216 USD), actual entry 47 (0.045852 USD, tied to entry 46), reconciliation entry 48 (flagged because the estimate was a ceiling) |

## What was proven
- **Gemini 4 Argon answers in production-grade form:** on **Vertex AI**, project `the-flame-511602-r3`, location `global`, authorised by the Google Cloud login (no API key). The Gemini Developer API key is on the free tier and is refused for Argon (quota), so Vertex AI is the working path and the production path in `AEG-BRF-003`.
- **What Argon does in AEGIS:** the **script review** helper (Pro and Admin): it proposes a more natural wording for ONE code-written segment. Every proposal is checked by the same rules as a hand edit (no new number, no new name or acronym, exercise wording kept, official guidance and the notice never reworded, length within -40% to +25%). A person accepts or rejects; nothing changes without that.
- **Real usage on real segments:** 16 calls (two runs), real segments of a stored daily bulletin, an exercise alert headline and the Johor follow-up.

## Measured
| | Run 1 (60 s client timeout) | Run 2 (100 s timeout) |
|---|---|---|
| Calls / succeeded | 8 / 4 (4 timed out) | 8 / 8 |
| Passed the fact checks | 4 of 4 | 8 of 8 |
| Prompt tokens / answer tokens / thinking tokens | 1,247 / 612 / 0 | 2,226 / 986 / 0 |
| Cost (token counts times the Vertex price) | 0.017228 USD | **0.028624 USD** |
| Cost per call (average, range) | 0.004307 | **0.003578** (0.001568 to 0.007700) |
| Latency per call (average, max) | 17.4 s (51.1 s) | **5.3 s (7.0 s)** |

- **Price used:** Vertex AI list price from Google's Cloud Billing Catalog, **4.00 USD per million input tokens and 20.00 USD per million output tokens** (effective 2026-10-17). This is higher than the Gemini API page (2 and 10 until 30 November), so the Vertex number is the production number. Saved source: `records/costs/sources/google-vertex-argon-skus_2026-10-17.json`; price book 1.7.0.
- **Thinking tokens:** the API reported none for this task, so output is only the rewrite.
- **Latency has a heavy tail:** typical 4 to 8 s, but about one call in six took 40 to 60 s or more (seen in run 1 and in separate direct timings). Run 1 lost 4 calls to the 60 s timeout; the client timeout is now 100 s. It is an interactive helper, never part of the emergency path.
- **Cost in practice:** reviewing all six segments of one daily bulletin cost about **0.0245 USD** (run 2). If an admin reviewed every segment of every bulletin, 4 bulletins a day is about 0.10 USD a day, about 3 USD a month at today's price. A single segment is under one cent.

## What the proposals looked like (honest)
- All 8 run-2 proposals kept every number and name (the checks passed). They are natural rewordings, not shortenings: Argon did not cut length, and it kept a phrase ("good news for Brunei") that was in the original, because the checks protect facts, not tone. The administrator decides whether to accept.

## Not yet proven / open
- **Invoice-level confirmation:** the BigQuery billing export had not refreshed past 13:00 Malaysia time when checked, so Google's own charge for these calls is not yet visible. The Google bill card will show a Vertex AI row once it does; compare it with 0.0459 USD (these 16 calls, computed). Until then the cost is computed from the token counts the API returned, not an invoice.
- **Quality sample is small:** 8 distinct segments; more cases (the new calm-wording draft, other languages, the follow-up for other areas) should be run if the owner wants a larger test.
- **Not routed through the chat gateway:** the review runs through its own client, job card and cost accounting; the Vertex path for the main chat model is not built.
- **Hosted server:** needs Dsol to set `AEGIS_VERTEX_PROJECT`, `AEGIS_VERTEX_AUTH=metadata` and give the Cloud Run service account the Vertex AI User role.

## Update: the "do not strengthen likelihood, uncertainty or urgency" rule (owner's agent, 2026-10-17)
- **Why:** run 2 contained a real case: the forecast said thunderstorms "in a few places" and Argon wrote that they "will hit a few places". Numbers and names were intact, so the old checks passed it, but the message sounded more certain and more urgent.
- **What was added (code, not only a prompt line):** a qualifier the original has (possible, may, could, likely, expected, forecast, in a few or some places, preliminary, estimated, up to, at least, officially rated, reportedly) must still be there; words that raise certainty or urgency (will, severe, dangerous, deadly, immediately, hit, strike, confirmed, officially and similar) cannot be added unless the original already has them. The Argon instructions say the same. Tested on the real "will hit" text (rejected) and on a faithful rewording (accepted).
- **Run 3 (strict checks, gate entry 49, actual entry 50 tied to it, reconciliation ok):** 8 of 8 calls succeeded, **7 of 8 passed**, 0.031052 USD, 3,743 tokens in total, average latency 4.9 s (max 6.6 s). The one rejection was the length rule on a 15-word headline that became 19 words, not the new rule; the new rule rejected nothing in this run because Argon, now told not to, kept "in a few places" and added no urgency word. The length rule is strict on very short segments (a person can still edit by hand).
- **Limit:** the check is a word list. It catches the cases that are easy to see; it cannot judge every nuance, so the human accept or reject step stays mandatory.
