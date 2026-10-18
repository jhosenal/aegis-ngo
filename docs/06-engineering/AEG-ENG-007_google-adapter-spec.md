# AEG-ENG-007 — Provider adapter spec (Google primary, reAPI backup)

Written by the engineer on 2026-10-13 from documentation read that day. Re-read the sources before any production claim; model ids, limits and prices change.

## Google (src/providers/google.ts)

| Item | Value | Source |
|---|---|---|
| Endpoint | `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` | ai.google.dev/api/generate-content |
| Key | header `x-goog-api-key`; never in the URL, never in an error message | ai.google.dev/gemini-api/docs/text-generation |
| Body | `systemInstruction.parts[].text`, `contents[{role:user,parts[].text}]`, `generationConfig{maxOutputTokens,temperature:0,responseMimeType?}` | same |
| Reply | `candidates[0].content.parts[].text` (parts with `thought:true` ignored), `usageMetadata{promptTokenCount,candidatesTokenCount,thoughtsTokenCount}`, `modelVersion`, `promptFeedback.blockReason` | same |
| Current models (models page, 2026-10-09) | Flash: `gemini-3.8-flash` (newest, stable, default here). Flash-Lite: `gemini-3.5-flash-lite` (newest, stable). Pro: `gemini-3.1-pro-preview` (preview). Gemini 2.5 models are legacy and are not used: they are limited to users who used them before, and `gemini-2.5-flash-lite` answered 404 for this key. | ai.google.dev/gemini-api/docs/models and a live check |
| Thinking | Gemini 3 models think by default and thoughts count toward `maxOutputTokens` and latency. The adapter sends `generationConfig.thinkingConfig.thinkingLevel` (default `low`, the lowest 3.8 Flash supports) for `gemini-3*` models only. | ai.google.dev/gemini-api/docs/thinking, accepted by a live call |
| Demand | On 2026-10-13 `gemini-3.8-flash` answered 503 "high demand" on the free tier several times and one call hung for 22 s. The gateway deadline (15 s) and the reAPI backup exist for exactly this. | live checks |
| Free tier data use | "Content used to improve our products" on the Free plan; not on the Paid plan | same |
| Limits | RPM, TPM and RPD per project (not per key); RPD resets at midnight Pacific; exact free-tier values are shown in AI Studio, not on the docs page | ai.google.dev/gemini-api/docs/rate-limits |
| Retry guidance | retry only 429, 408 and 5xx; about 1 s first wait, exponential, with jitter and a maximum number of retries; 400 and 403 are not retried | ai.google.dev/gemini-api/docs/troubleshooting |

### Error mapping to `ProviderErrorKind`

| Condition | Kind | Notes |
|---|---|---|
| 429 | TRANSIENT | The provider is blocked locally for `Retry-After`, the `RetryInfo.retryDelay` detail, or 60 s; no network call is made meanwhile. |
| 5xx except 504 | TRANSIENT | `Retry-After` honoured when present. |
| 408, 504, abort | TIMEOUT | `possiblyCharged = true`. |
| 401, 403, 400 with `API_KEY_INVALID` | AUTH | Opens the circuit in the gateway. |
| other 4xx | BAD_REQUEST | |
| `promptFeedback.blockReason`, finish reason SAFETY, RECITATION, BLOCKLIST, PROHIBITED_CONTENT, SPII, IMAGE_SAFETY | REFUSAL | |
| finish reason MAX_TOKENS, empty text, non-JSON body, no candidate | MALFORMED | `possiblyCharged = true`. |
| network failure before a response | TRANSIENT | |

### Staying inside the free tier (anti-blacklisting rules)

1. `RequestPacer` spaces request starts (default 12 s, `AEGIS_GOOGLE_MIN_INTERVAL_MS`), caps requests per Pacific day (default 200, `AEGIS_GOOGLE_DAILY_REQUEST_CAP`), and refuses to wait longer than 15 s.
2. After a 429 the adapter makes no request until the stated delay has passed. The gateway circuit breaker adds its own cool-down.
3. The gateway allows at most two primary attempts and three in total per task. The adapter itself never retries.
4. These defaults are conservative guesses, not published limits. Set the real values from AI Studio.
5. `AEGIS_GOOGLE_ALLOWED_DATA_CLASSES` defaults to `public,tenant_private` only because all demo data is synthetic. For any real tenant data remove `tenant_private` or move to the paid tier.

### Price snapshot (safety cap, dated)

The free tier costs nothing, but the budget ledger needs a price. Use the paid-equivalent price as a ceiling.

| Snapshot id | Model | Input | Output | Captured | Source |
|---|---|---|---|---|---|
| `GOOGLE-3.8-FLASH-2026-10-09` | `gemini-3.8-flash` | 750000 micro-USD per million tokens ($0.75) | 3750000 ($3.75) | page dated 2026-10-09 | ai.google.dev/gemini-api/docs/pricing |

Prices on that page apply through 2026-12-31 and some rise on 2027-01-01.

## Role seats (src/roles/seats.ts)

Modelled on how the QZEEX project runs its LLM "company" (its `LLM_CFO_SOP.md`): every seat has one narrow job, its own model and limits; cheap seats do bulk work and the expensive seat is used only for material decisions; hard limits (budgets, permissions, validation) live in code, never in a model. QZEEX also found that a different maker per seat gives independence, that models differ in tool and strict-JSON support, and that one maker has to repeat when the endpoint is limited.

| Seat | Google primary | reAPI backup | Limits | Job |
|---|---|---|---|---|
| manager | `AEGIS_GOOGLE_MODEL` (`gemini-3.8-flash`) | `gpt-6-luna` | 2000 chars in, 512 tokens out | proposes one registered route as strict JSON; code validates |
| coordinator | same | `gpt-6-luna` | 2000, 512 | cheap bulk sorting and tagging |
| specialist | same | `gpt-6-luna` | 4000, 1024 | summarises one attached card, adds no facts |
| reviewer | same | `gpt-6-sol` | 6000, 512 | re-checks a specialist summary against its card |
| advisor | same | `claude-opus-5-5` | 8000, 1024 | second opinion on material decisions only; no veto |

`AEGIS_PRIMARY_PROVIDER` (`google` by default, `reapi` in this deployment) chooses which provider is tried first; the other is the backup, and the columns above swap sides when it is `reapi`. Costs and the reasons for choosing `gpt-6-luna` first are in AEG-ENG-008.

Override any seat with `AEGIS_ROLE_<ROLE>_PRIMARY_MODEL` or `AEGIS_ROLE_<ROLE>_BACKUP_MODEL`. `AEGIS_REAPI_MODEL`, if set, replaces every seat's backup model. The backup exists only when reAPI is configured.

Limits of this design: Aegis has one primary and one backup provider, so seats differ by model and limits, not by provider. The reviewer's and advisor's independence from the specialist comes only from their backup models. Today only the manager and specialist seats are called by the app.

**Price snapshot with several seats.** The budget gateway uses one price per snapshot. Set it to the most expensive model that can run, so reservations over-count and the budgets stay safe: with the advisor seat that is `claude-opus-5-5` at 3200000 and 16000000 micro-USD per million tokens (QZEEX table 2026-10-06); without it, `gpt-6-sol` at 1600000 and 8000000.

## reAPI (src/providers/reapi.ts)

OpenAI-compatible: `POST https://reapi.ai/api/v1/chat/completions`, `Authorization: Bearer <key>`, body `{model, messages, max_completion_tokens | max_tokens, reasoning_effort?, response_format?}`, reply `choices[0].message.content` and `usage.prompt_tokens / completion_tokens`. Verified against the QZEEX client (2026-10-06) and one live call on 2026-10-13.

- Fails closed: host must be exactly `reapi.ai`, https, port 443, no credentials in the URL.
- Backup data classes are limited by `AEGIS_REAPI_ALLOWED_DATA_CLASSES` (default `public`).
- Its JSON mode needs the lowercase word "json" in a message, so the adapter appends a one-line hint to the user message when the prompt lacks it.
- Rate limit 5 requests per second (QZEEX security notes): the pacer spaces starts by 200 ms; a 429 `Retry-After` blocks up to 5 s.
- Per-model request profiles (`REAPI_MODEL_PROFILES`): `gpt-6-luna`, `gpt-6-sol` and `kimi-k3` use `max_completion_tokens` and JSON mode; `deepseek-v4.1-flash` and `claude-opus-5-5` use `max_tokens` and no JSON mode (QZEEX found Claude ignores strict JSON and deepseek has none, so the answer is validated by code). An unlisted model gets no JSON mode and the configured output-limit field. QZEEX price table 2026-10-06, per million tokens in/out: luna $0.08/$0.40, deepseek $0.40/$1.30, sol $1.60/$8, opus $3.20/$16. The reAPI credit pool may be shared with other projects, so keep the Aegis budgets small.

## Status vocabulary

- Google adapter: implemented, fixture-tested, and live-tested once on 2026-10-13 (`records/evidence/AEG-LIVE-google_*.md`: one tiny call, usage and reported model recorded). One call is not a load or failure-mode test.
- reAPI adapter: implemented, fixture-tested, and live-tested once on 2026-10-13 (`records/evidence/AEG-LIVE-reapi_*.md`: one tiny call, usage and reported model recorded).
