# AEG-ENG-008 — Model cost and reliability matrix

Written by the engineer on 2026-10-13. Prices change; every figure has a source and a date. Costs are for the model's own usage only, at standard (non-priority) rates.

## Sources

- Google direct: ai.google.dev/gemini-api/docs/pricing (page dated 2026-10-09).
- reAPI: reapi.ai/models ("From" prices, no input/output split, no date; the Kimi K3 banner and card disagree) and the QZEEX price table (2026-10-06) for output prices. The `gpt-6-luna` input price ($0.08) matches in both; opus is listed at $2.80 on the page and $3.20 in the QZEEX table, so reAPI has changed it since 2026-10-06 and its output price is not published.
- Reliability: Google AI Developers Forum threads of 2026-09-15 to 2026-10-09 and our own live calls of 2026-10-13.

## Matrix (USD per 1M tokens)

| Model | Route | Input | Output | Route call (700 in, 150 out) per 1000 calls | Summary call (1500 in, 300 out) per 1000 calls | Calls per $5 (route) | JSON mode | Notes |
|---|---|---|---|---|---|---|---|---|
| `gpt-6-luna` | reAPI | 0.08 | 0.40 | $0.12 | $0.24 | about 43,000 | yes | Cheapest chat model on reAPI that passed tools and strict JSON in QZEEX tests. Answered every live call (31 in / 12 out tokens, 2 s). |
| `gemini-3.6-flash` | reAPI | not priced | not priced | unknown | unknown | n/a | not shown | NOT ENABLED. The reAPI list shows $0, but the model's own page says "Pricing temporarily unavailable" and its FAQ says "Paid", so $0 is a missing price, not a free model. Text only, no tools, max_tokens capped at 8,192. A live call returned 503 on 2026-10-13 (Google-side overload passed through). Rule: no model without a published price enters any seat or ladder. |
| `deepseek-v4.1-flash` | reAPI | 0.40 | 1.30 | $0.48 | $0.99 | about 10,500 | no (code validates) | Different maker. Answered live, 3.7 s. |
| `gpt-6-sol` | reAPI | 1.60 | 8.00 | $2.32 | $4.80 | about 2,150 | yes | Passed tools and strict JSON; the QZEEX CFO seat. Answered live, 2 s. |
| `claude-opus-5-5` | reAPI | 2.80 on the page (3.20 on 10-06) | 16 on 10-06 (now unpublished) | about $4.6 | about $9.6 | about 1,100 | no | Independent second opinion only. Answered live, 8.5 s. |
| `gemini-3.5-flash-lite` | Google paid | 0.30 | 2.50 | $0.59 | $1.20 | about 8,500 | yes | Worked on the free tier live. Forum users use it when 3.8 is busy. |
| `gemini-3.8-flash` | Google paid | 0.75 (1.50 from 2027-01-01) | 3.75 (7.50) | $1.09 ($2.18 in 2027) | $2.25 ($4.50) | about 4,600 | yes | Newest Flash. Overloaded (503) on every live attempt today. |
| `gemini-3.8-flash` | Google Priority (Tier 2) | 1.35 | 6.75 | $1.96 | $4.05 | about 2,550 | yes | Overflow is downgraded to Standard instead of failing, but one forum user reported no improvement. Needs Tier 2 ($100 paid). |
| `gemini-3.8-flash` | Google free | 0 | 0 | $0 | $0 | n/a | yes | Content may be used to improve Google products. 503s reported on the free tier. |

Output prices include thinking tokens for Gemini 3. Google paid prices are for the Standard tier.

## Reading the matrix

1. `gpt-6-luna` through reAPI is about 9 times cheaper than `gemini-3.8-flash` direct and about 5 times cheaper than `gemini-3.5-flash-lite` direct, and it was reliable in every live call. It is the right primary for the routine seats (manager, coordinator, specialist).
2. `gemini-3.6-flash` at $0 on reAPI is not usable as a cost saver today: it returned 503 and has no listed tools or JSON mode. Re-check it later.
3. Google direct remains valuable as the independent backup: a different provider and network path from reAPI, so an outage at one does not stop the other. Use `gemini-3.5-flash-lite` as the backup model unless 3.8 proves reliable.
4. The expensive seats (reviewer on `gpt-6-sol`, advisor on `claude-opus-5-5`) are the only ones where cost matters; call them only for material decisions.
5. A $5 balance covers tens of thousands of routing calls on luna. Even one task at the safety-cap price is about 2 cents, so the in-app budgets, not the balance, are the real guard.

## Chat modes (Auto, Normal, Pro, Expert)

| Mode | Models | Who | State |
|---|---|---|---|
| Normal | `AEGIS_MODEL_NORMAL` (`gpt-6-luna`) | everyone | on |
| Auto (default) | starts on Normal; steps up to Pro then Expert only when code finds the cheaper answer unusable | everyone, but the step-up is for registered users only | step-up off |
| Pro | `AEGIS_MODEL_PRO` (`gpt-6-sol`) | registered users | off |
| Expert | `AEGIS_MODEL_EXPERT` (`claude-opus-5-5`) | registered users | off |

- The browser sends only the mode name and never sees model names. The server picks the model and refuses a mode the user may not use with 403 `E_MODE_UNAVAILABLE`, before anything is stored or sent.
- Pro, Expert and Auto's step-up need both switches: `AEGIS_PREMIUM_MODES_ENABLED=true` and the user's id in `AEGIS_REGISTERED_USERS`. Auto's step-up also needs `AEGIS_ESCALATION_ENABLED=true`. Public and unregistered users therefore always run on luna.
- "Luna could not solve it" is decided by code: invalid JSON, a route outside the allowlist or a failed argument check, no route returned for a request that is not a local command, a failed safety check on a summary, or a provider failure. A refusal, a permission denial (`E_FORBIDDEN_ROLE`) or an exhausted budget never triggers a step-up. Each step is a normal gateway call, so it is budgeted, deadline-bound and audited, and the reply says which mode answered (`escalatedTo`).
- With Google as the primary provider the mode only gates access; no model override is sent.

## Configuration this implies

- `AEGIS_PRIMARY_PROVIDER=reapi`: reAPI is tried first with the seat's reAPI model; Google is the backup with `AEGIS_GOOGLE_MODEL`.
- Seat defaults when reAPI is primary: manager, coordinator, specialist `gpt-6-luna`; reviewer `gpt-6-sol`; advisor `claude-opus-5-5`.
- Price snapshot: the gateway uses one price per snapshot. While the advisor seat is not used by the app, cap at `gpt-6-sol` (1,600,000 and 8,000,000 micro-USD per million tokens); raise it to the opus price before the advisor seat is switched on.
- Data classes: both providers need `public,tenant_private` for the synthetic demo, because the app labels model traffic `tenant_private`. Keep reAPI at `public` and do not use the free Google tier for real tenant data.
