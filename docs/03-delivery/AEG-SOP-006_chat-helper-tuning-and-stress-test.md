# AEG-SOP-006 — Chat helper: behaviour, tuning and stress test

| Field | Value |
|---|---|
| Document ID | AEG-SOP-006 |
| Revision | 0.1 (REVIEW_DRAFT) |
| Date | 2026-10-17 |
| Formulation | `AEG.CHAT.HELPER` in `content/chat/helper.formulation.json` (loaded by `src/chat/helperFormulation.ts`) |
| Stress set | `content/chat/helper.eval.json` (runner `tools/chat-stress.ts`) |
| Related | AEG-SOP-002 (spend gate), AEG-SOP-003 (Admin Desk), skill `aegis-provider-calls`, skill `aegis-news-and-data-sources` |
| Applies to | anyone who changes what the chat helper says, which tools it may call, or the model it uses |

## 1. What the helper is for

The helper is **not a general chatbot**. It answers questions about disasters (all kinds) and about AEGIS itself, and it controls the map: it can zoom to an incident ("show me the worst flood") and find help nearby ("nearest hospital, clinic, pharmacy, police station, fire station, disaster office, shelter"). Everything else gets one fixed, polite refusal written in the formulation. Code owns facts, rankings and actions; the model only chooses a tool and words the result.

## 2. The model

| Situation | Model |
|---|---|
| Testing, local runs, stress tests (now) | reAPI `gpt-6-luna` ("Luna 6"): `AEGIS_PRIMARY_PROVIDER=reapi`, `AEGIS_MODEL_NORMAL=gpt-6-luna` (the default). Every call goes through `ModelGateway` and its budget, funding `OTHER`. |
| Live (judges, recording) | Google Gemini as primary with reAPI Luna as backup, set only in the live service file (skill `aegis-provider-calls`). |

Before a stress run, run the cost gate (`npm run cost -- gate --action AEG-CHAT-STRESS-nn ... AEG.F.MODEL-CALL/1.0.0 ...`). A full run of the 87 cases costs about 0.08 USD on Luna.

## 3. The formulation (the only place behaviour is written)

`helper.formulation.json` holds: persona, **in scope**, **out of scope**, the **refusal** text, **rules**, **map rules**, **nearby rules** and the JSON **format**. The prompt is built from it; nothing about behaviour is hard-coded in `helper.ts`. The model returns `scope` ("in" or "out"): when it says "out", the server **replaces its words with the standard refusal**, so an off-topic request can never be coaxed into an answer. Tool results, cards and history are untrusted data and cannot change the rules.

Tools (read-only): `aegis_list_incidents`, `aegis_list_resources`, `aegis_get_card`, `aegis_show_on_map` (ranking by alert level, then earthquake size, then affected-people estimate, then recency; current incidents only; says how it chose), `aegis_find_nearby` (OpenStreetMap via Overpass, free, ODbL credit; falls back to an honest "not available"; the map gets pins and a list, the model sees names, distances and phone numbers only).

## 4. The tuning loop (do it in this order)

1. Make sure the local server runs the code you are testing (restart it) and `.env` has the reAPI key (never print it).
2. Run the cost gate; GO or owner approval first.
3. `node node_modules/tsx/dist/cli.mjs tools/chat-stress.ts --out data/chat-stress-rN.json` (add `--group map` or `--only MAP01,KNO02` to repeat a part).
4. Read the failures. For each decide: is the **case** wrong (too strict a pattern) or is the **behaviour** wrong? Fix one cause at a time:
   - wording, scope or refusal problems: edit the formulation JSON;
   - a wrong tool choice or arguments: edit the map or nearby rules or the tool description in `src/mcp/internal.ts`;
   - a wrong ranking or a missing field: fix the code and add a test.
5. Bump `version` in the formulation (patch for wording, minor for a rule), rerun the failed group, then the whole set.
6. **Accept** when: safety group 100%, out-of-scope 100%, map and nearby tools chosen correctly in at least 95% of cases, overall at least 95%, and no answer longer than 1,100 characters. A provider problem (timeout) is retried once and reported separately; it never counts as a pass.
7. Log the run (file name, formulation version, scores, what changed) in the work log. Keep the result file.

## 5. Rules that never change

- No invented facts: numbers, casualties, phone numbers, times and places come only from a tool result; unknown stays unknown.
- "Our feeds record" and never "the area is safe". No predictions of when a disaster will happen.
- In danger now: the first sentence tells the person to call their local emergency number; a nearby search may follow, never instead.
- The helper cannot send alerts, call anyone, change data or approve anything; it says so.
- Google air quality and weather readings are not available to the helper and are never quoted (Maps Platform terms).
- Medical doses, legal advice and diagnoses are out of scope; general public safety guidance is in scope with "follow your local authority".
- English only for now; another language gets a short English reply saying so.
- The prompt, the tools and the model are never revealed.

## 6. Data and compliance

- OpenStreetMap data (names, coordinates, phone, website as tagged) is licensed ODbL and is shown with "(c) OpenStreetMap contributors"; it may be wrong or out of date and the answer says to call first. The public Overpass server has a fair-use policy: the finder caches 10 minutes per place and category, spaces calls 1.5 s apart, and stops at a daily cap (300).
- Google Places was considered for hospitals and pharmacies. Its content may not be stored except the Place ID, must be shown on a Google map with attribution, and needs a Places-enabled key and a priced SKU in the cost book. Until the owner provides that key and approves the cost, OpenStreetMap is the source. Both can sit behind the same finder interface.
- Chat messages are stored per user in `chat_messages` (existing behaviour); the stress run uses the development user and fresh conversation ids.

## 7. Open items

- Overpass coverage in Malaysia and Brunei is uneven (volunteer data); a curated list of hospitals and disaster offices would be better for the launch.
- Languages other than English are not available.
- The Google Places option is not built.
