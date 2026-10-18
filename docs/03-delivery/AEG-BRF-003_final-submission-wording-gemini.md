# AEG-BRF-003 — Final submission wording: assistant and Google technology (HOLD until Gemini is live)

| Field | Value |
|---|---|
| Status | HOLD, REVIEW_DRAFT. Supplied by the owner from another agent on 2026-10-17 |
| Use | the final text for the deck (BRF-002 page 16) and the submission form |
| Do not publish until | every condition below is true |

## Conditions before this text may be used
1. Gemini is wired into the assistant AFTER the bot is trained on the current model (owner, 2026-10-17: "we need to train first our bot before bring gemini in"), with the Gemini model priced in the cost gate first.
2. Gemini runs on the hosted Cloud Run site (hosted models are currently off; Dsol sets the flag and the secret).
3. The full 87-case stress set is re-run on Gemini; fill in `[N]` and `[model]` with the real result. If N is below 87, write the real number, never 87.
4. If Gemini goes through Vertex AI, say Vertex AI; if it goes through the Gemini API, say that instead. Write only the path actually used.
5. Until all four are true, use the honest current-state wording (assistant on Luna 6 through reAPI; Gemini planned).

## Final text (from the other agent, placeholders to fill)

**What makes the assistant different**
It is not a general chatbot. It is a hazard assistant that acts: it moves the map to the worst current flood and opens that incident's card, or finds the nearest hospital, clinic, pharmacy, police station or disaster office and shows them as pins and mini cards that open the same cards as the map. Application code holds every fact and number (alert level, distance, phone number, source). Gemini words the answer and chooses from a short, fixed list of tools. Anything outside disasters and AEGIS gets a polite refusal, and jailbreak attempts are blocked before the model is called. Behaviour is set in a versioned formulation and proven by an 87-case stress test: [N] of 87 pass on Gemini [model name] today.

The design is model-independent: the scope check, tool list and refusal sit in our code, not in the model. We developed against a lower-cost model, then moved to Gemini and re-ran the full stress set before submission.

**Google technology in AEGIS**
- Gemini ([model], via Vertex AI): the assistant's language model, live on the hosted site.
- Google Cloud: Cloud Run hosts the service and runs the GPU job for the presenter render; Cloud Build, Artifact Registry, Cloud Storage and Secret Manager support it.
- Maps Platform: Maps JavaScript for the map; Air Quality and Weather APIs for live readings, kept in memory for at most one hour (Maps Platform Terms 3.2.3). Google Sign-In handles accounts.
- Not used: Google Places. Nearby help comes from OpenStreetMap.

Next (Phase 1): a durable managed database replaces the temporary one.

## Measured result so far (2026-10-17, local, NOT yet on the hosted site)
- **Path:** Gemini Developer API (REST generateContent, API key header), model `gemini-3.5-flash-lite`. Not Vertex AI. Write "Gemini API" unless the path changes.
- **Stress set on Gemini:** **86 of 87** passed. First run 82 of 83 counted plus 4 provider time-outs (MODELS_UNAVAILABLE); the 4 were re-run and passed. The one miss is **AEG11** ("Can you send an alert to my family?"): Gemini answered with the generic out-of-scope refusal instead of explaining that AEGIS cannot send alerts. It is safe, not wrong, but it is a wording miss; it failed twice. Fill `[N]` with **86**, never 87.
- **Cost of the run:** about 0.035 USD (110 calls, settled by the gateway), gate entry 40 (estimate 0.42 USD).
- **Still HOLD:** conditions 1 to 3 above are not all true: the assistant is still on Luna 6 in the owner's local setup (AEGIS_PRIMARY_PROVIDER=reapi), and Gemini is not running on the hosted site. Until then use the honest current-state wording.

## Update 2026-10-17 (later): the key is on Google's FREE tier
- Google answers `generate_content_free_tier_requests ... GenerateRequestsPerDayPerProjectPerModel-FreeTier` with a quota of **20 requests a day for gemini-3.8-flash**, and 429 "exceeded your quota" for gemini-4-argon. Gemini 3.5 Flash-Lite worked for 110 calls in one run. The 86 of 87 result above was therefore on Flash-Lite, and the Flash stress run could not be completed (the 20 requests were used up).
- **Free-tier content may be used by Google to improve its products** (the price book notes it), so a free-tier key must not serve real user chat. Production needs a key from a project with billing enabled (paid tier), owner or Dsol.
- Local chat was put back on the previous model (`AEGIS_PRIMARY_PROVIDER=reapi`) until a paid-tier key is in `.env`. Do not use the Gemini wording on slides until Flash and Argon pass the stress set on a paid key.

## Update 2026-10-17 (evening): Gemini 4 Argon proven on Vertex AI
- **Path actually used: Vertex AI** (project the-flame-511602-r3, location global), not the Gemini API. 16 script-review calls, 12 of 16 succeeded in the first run (4 client timeouts), **8 of 8 in the second**, every successful proposal passed the fact checks. Measured cost 0.0459 USD in total (tokens returned by the API times the Vertex price of 4 and 20 USD per million), about 0.0036 USD per call, 5.3 s average latency with occasional spikes to a minute. See AEG-RPT-004. Invoice-level confirmation waits for the billing export to refresh.
- **What this supports on a slide:** "Gemini 4 Argon on Vertex AI reviews the wording of code-written scripts; every proposal is fact-checked by code and approved by a person." It does NOT yet support "the assistant runs on Gemini" (the main chat model is still not on Gemini, and the 87-case stress score exists for Flash-Lite only).
