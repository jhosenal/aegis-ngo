# AEG-CON-004 — Cost-accounting contract (cloud and model spend)

| Field | Value |
|---|---|
| Document ID | AEG-CON-004 |
| Revision | 0.3 (REVIEW_DRAFT: built first, review by the supervisor to follow, per the owner's decision of 2026-10-14; 0.3 adds the free-credit formulation, section 4b) |
| Date | 2026-10-14 |
| Owner | Claude (engineer) |
| Implementation | `src/costs/`, `tools/cost.ts`, `records/costs/`, tests `tests/unit/costs-*.test.ts` |
| Procedure | AEG-SOP-002 |
| Evidence | S0014 (Google Cloud first-test research), L0026 (hosting and pricing research), the saved pages R0050 to R0079 and R0068 |

## 1. Purpose and scope

One engine decides and records every spend on Google Cloud **and** on AI models, so that all agents follow the same formulas and the same procedure and the owner can see what was estimated, approved and actually charged. Owner decisions of 2026-10-14: the engine covers both cloud infrastructure and model spend; the owner approves anything above 0.50 USD per action; actual costs enter from the billing console (CSV or reading) first, not from an automatic export; agents propose and an operations agent acts, monitored by the owner; currency is USD.

The engine **never spends money and never calls a cloud API.** It estimates, decides and records.

## 2. Principles

1. **Exact arithmetic.** Prices and quantities are exact rationals; money is whole nano-USD (1 USD = 1,000,000,000). No floating point. A result is rounded **up**, so an estimate never understates.
2. **Every price has a source.** A price enters the price book only with its URL, access date and a quoted passage. Where a saved copy of the page exists, the entry names it and the strings that must appear in it, and a test checks that mechanically. A price from a second-hand table is marked `SECONDARY`.
3. **Unknown is not zero.** A missing price, an unlisted region, an unknown model or a bad argument gives status `UNKNOWN`; the decision table then asks the owner. Nothing proceeds "for free" because a price is missing.
4. **Google's stated rules are formulas, not guesses.** Example (Cloud Run page): "The free tier is applied as a spending based discount using Tier 1 pricing." The free-tier discount is therefore valued at Tier 1 prices and subtracted from the gross cost at the region's own (for example Singapore Tier 2) prices.
5. **The decision is a proved table.** The spending decision is a decision table in the restricted language of the Aegis table prover. The test suite hands the same table to the exhaustive coverage prover and cross-checks the engine's evaluator against the prover's. A missing rule would be rejected as a coverage gap.
6. **The ledger is append-only and tamper-evident** (section 6).
7. **No quiet attempts.** Every gate call is recorded, including STOP and UNKNOWN.

## 3. Price book (`records/costs/price-book.json`)

Entries: `priceId`, service, unit, `per`, `priceUsd`, tier, status (`QUOTED` or `SECONDARY`), source {url, accessed, passage, note, check}. Also free tiers (per billing account per month), the Cloud Run free-tier rule, and the region-to-tier map read from the Cloud Run locations page. A region that was not read from the source has an UNKNOWN tier: Kuala Lumpur (`asia-southeast4`) appears on the Cloud Run pricing page but not on the locations page, so it is UNKNOWN. Loading refuses a missing source, a duplicate id, a free tier naming no price, or a region in two tiers. The book has a hash (domain `AEG-COST-v1`) that is recorded with every estimate.

## 4. Formulas (registered, versioned, hashed)

| Formula | Computes |
|---|---|
| `AEG.F.GCP-CLOUDRUN-REQUEST-MONTH/1.0.0` | gross = active and idle vCPU-seconds and GiB-seconds and requests at the region's tier; discount = min(gross, free-tier value at Tier 1 prices minus the discount already used); net = gross - discount |
| `AEG.F.GCP-ARTIFACT-STORAGE-MONTH/1.0.0` | max(0, average GiB - 0.5) x hours x price per GiB-hour |
| `AEG.F.GCP-BUILD-MONTH/1.0.0` | billable minutes beyond 2,500 free build-minutes per billing account |
| `AEG.F.GCP-SCAN/1.0.0` | scans x 0.26 USD (billed while the Container Scanning API is enabled) |
| `AEG.F.GCP-EGRESS-MONTH/1.0.0` | GiB x destination price, Premium Tier, first volume band only (up to 1,024 GiB); no free GiB deducted; more than that is UNKNOWN |
| `AEG.F.GEMINI-API-CALL/1.0.0` | Gemini Developer API, paid tier, standard: tokens at the per-million prices **valid on the given date** (the page's prices change on dates, for example gemini-3.8-flash input 0.75 USD through 31 Dec 2026 and 1.50 USD from 1 Jan 2027); funded by `GEMINI_PREPAY`; no single price valid on that date = UNKNOWN |
| `AEG.F.GCP-SECRET-MANAGER-MONTH/1.0.0` | active versions beyond 6 free x hours x price, access operations beyond 10,000 free, rotation notifications beyond 3 free |
| `AEG.F.GCP-LOGGING-MONTH/1.0.0` | ingestion beyond the free 50 GiB per project, plus retention beyond 30 days |
| `AEG.F.GCP-SCHEDULER-MONTH/1.0.0` | jobs beyond 3 free, per 31 days, prorated by days |
| `AEG.F.FIREBASE-HOSTING-MONTH/1.0.0` | storage and CDN transfer beyond 10 GB each, per project |
| `AEG.F.GCP-CDN-EGRESS-MONTH/1.0.0` | Cloud CDN cached egress to Asia Pacific, first band (up to 10 TiB) |
| `AEG.F.MODEL-CALL/1.0.0` | input and output tokens at the per-million prices; no price in the book is UNKNOWN (for example any Gemini model, until its price is read from Google's page) |

A formula's written definition is hashed (`npm run cost -- formulas`). A change is a new version, never an edit.

## 4a. Funding sources (revision 0.2)

The owner's billing account is a paid account that still holds a one-time Google Cloud credit. Per Google's terms (docs.cloud.google.com/free/docs/free-cloud-features, read 2026-10-14) the remaining credit is available "on products and services covered by the Free Trial", "Your payment method is charged for any usage that exceeds your remaining credit", and "The $300 credit can't pay for Gemini API in AI Studio costs". Every formula therefore declares where its money comes from:

| Funding | Pays for | Balance (owner-stated in `records/costs/budget.json`) |
|---|---|---|
| `GCP_CREDIT` | Cloud Run, Cloud Build, Artifact Registry, scans, egress (coverage of each service is ASSUMED until a billing report shows the Credits column applied) | 300.00 USD; counted until the earlier of the console end date (2026-12-17) and signup + 90 days (2026-12-16), see 4b |
| `GEMINI_PREPAY` | Gemini API in AI Studio; per Google's billing page, at 0 USD all API keys of the billing account stop working | 5.00 USD, expires a year after purchase |
| `OTHER` | everything else, including the reAPI model calls in the price book | 0.00 USD: any such spend is STOP until the owner funds it |

The gate computes the headroom for the monthly budget and for **every funding source the action draws on**, and passes the **tightest** headroom to the decision table, so the table itself is unchanged and stays proved. A source with no configured balance counts as 0; a source counts as 0 after its expiry date. An actual cost records its funding source and, when the report shows it, the credits applied; a charge the credit did not fully cover is flagged **card exposure** in the reconciliation and in `status`. Charges recorded with no estimate are listed as **unexplained spend**.

## 4b. Free-credit formulation (revision 0.3)

**Purpose.** Say, before and after a spend, which part of a charge the Google Cloud welcome credit pays, which part the Gemini prepay pays, and which part reaches the owner's card. It is a registered, versioned, hashed formulation like the price formulas (`AEG.CF.CREDIT-APPLICATION/1.0.0`, `src/costs/credit.ts`), with its rules held as data in `records/costs/credit-terms.json`.

**Source.** Google Cloud, "Free Google Cloud features and trial offer" (docs.cloud.google.com/free/docs/free-cloud-features, last updated by Google 2026-10-13, read 2026-10-14). The owner supplied a saved copy (`docs/99-inbox/0018_...html`, read-only evidence). The terms file holds eight rules (CT-1 to CT-8), each with a verbatim quote that the test suite finds in the saved copy. The rules that matter: the credit is 300 USD spent over 90 days (CT-1); it pays for products covered by the Free Trial, including beyond the Free Tier limits (CT-2); it cannot pay for Gemini API in AI Studio (CT-3) or for a generative AI partner model offered as a managed API (CT-4); unused credit expires 90 days from signup even after an upgrade (CT-5, CT-6); usage beyond the credit or on products outside the Free Trial is billed to the payment method (CT-7, CT-8).

**Coverage classes** (every service the engine prices has one; a service not listed is UNCLASSIFIED and is treated as reaching the card):

| Class | Meaning |
|---|---|
| `COVERED_OBSERVED` | a billing report showed the credit applied to this service |
| `COVERED_ASSUMED` | a Google Cloud product the Free Trial rule is expected to cover; the list of covered products is on a page not yet saved and no report has confirmed it. **The engine plans with the credit and reports how much rests on this assumption** |
| `EXCLUDED_GEMINI_AI_STUDIO` | the credit cannot pay; the Gemini prepay pays, then the card |
| `EXCLUDED_PARTNER_MODEL` | the credit cannot pay; all of it reaches the card |
| `NOT_COVERED` | not a Free Trial product (for example the reAPI model service); all of it reaches the card unless funded otherwise |
| `UNCLASSIFIED` | coverage not known; counted as card and flagged, never assumed covered |

**Routing table (version 1.0.0).** For each charge, in the order given, by coverage class, whether the credit has expired, whether the remaining credit covers the charge, and whether the remaining prepay covers it: UNCLASSIFIED gives `CARD_UNKNOWN_COVERAGE` (priority 100); partner model or not covered gives `CARD` (90); Gemini gives `PREPAY` or `PREPAY_THEN_CARD` (80); a covered service with the credit expired gives `CARD` (70); a covered service within the credit gives `CREDIT`, or `CREDIT_THEN_CARD` when the credit runs out (60). The table is written in the restricted rule language of the Aegis table prover and is **proved** (48 combinations, no gap, no ambiguity) and cross-checked against the evaluator by the test suite, like the spending decision in section 5.

**Application.** Each line's credit, prepay and card amounts are whole nano-USD and always add up to the charge; the credit and prepay balances are reduced by what each line uses, so an earlier line uses the credit first; balances never go negative; the credit never pays a Gemini AI Studio line. The result reports `assumedCredit` (credit applied only on assumed coverage, which reaches the card if Google does not cover those services) and the amount with unclassified coverage.

**The 90-day rule.** The credit is counted only up to the earlier of the console end date and signup + 90 days (for a 2026-09-17 start: 2026-12-16), because Google's page says the credit "expires 90 days from the Free Trial signup" and the console date can be a day later. `fundingBalanceNano` applies this to `GCP_CREDIT` (budget field `starts`).

**Consistency with the formulas.** Every cost formula names the service it prices (`service`); a test requires that the service is in the terms file and that the formula's funding agrees with its coverage class (covered gives `GCP_CREDIT`, Gemini AI Studio gives `GEMINI_PREPAY`, the rest `OTHER`). A formula therefore cannot be funded from the credit when the terms say the credit cannot pay.

**Use.** `npm run cost -- credit --charges '[{"service":"Cloud Run","usd":"0.011"}]' [--on YYYY-MM-DD]` shows where charges would land (exit 11 when any part reaches the card); `npm run cost -- status` shows how much committed credit-funded spend no billing report has yet confirmed.

**Not covered.** The list of products the Free Trial covers (a separate Google page) is not saved, so no service is `COVERED_OBSERVED` until a billing report shows the credit applied; credit exhaustion is handled (the rest reaches the card) but the engine does not predict the day it runs out; Vertex AI partner models are treated as not covered; a service not in the terms file must be added with its source before it is relied on.

## 5. Decision table (`src/costs/policy.ts`, version 1.0.0)

Inputs: estimate kind (ESTIMATE or UNPRICED), cap enforced, action cost, headroom (remaining budget minus the action cost; computed first so the table never compares two fields). Highest priority wins; no ties.

| Priority | Rule | Outcome |
|---|---|---|
| 100 | a spend cap is enforced | STOP |
| 90 | the estimate is UNPRICED (unknown) | ASK_OWNER |
| 80 | headroom below 0 | STOP |
| 70 | action cost above the owner's per-action limit (0.50 USD) | ASK_OWNER |
| 10 | estimate, no cap, within the limit and within the budget | GO |

Documented domains: action cost at least 0; headroom within 1,000,000 USD either way. A value outside the domain is refused (ASK_OWNER), not clipped. No rule matching is also ASK_OWNER, never GO. The word UNKNOWN is not used as a table value because the prover reserves it as its marker for an unknown input.

## 6. Ledger (`records/costs/ledger.jsonl`, tracked in git)

One JSON object per line: `ESTIMATE` (action, agent, formula lines, estimate, decision, price-book hash, policy version), `APPROVAL` (owner, note), `ACTUAL` (service, amount, source, period), `RECONCILIATION` (estimate, actual, variance, flag). Each entry carries `prevHash` and `hash` (domain `AEG-COST-v1`); reading verifies structure, contiguous sequence and the whole chain. An edit, deletion, reordering or unknown key is refused and the engine will not append to a damaged ledger. Money committed in a period = for each estimate that proceeded (GO, or ASK_OWNER with an approval; never STOP) its recorded actual if any, otherwise its estimate, plus actuals that belong to no estimate. An UNKNOWN estimate that proceeded counts 0 but is counted and shown as a warning.

## 7. Reconciliation

An actual is recorded against its estimate and flagged when it differs by more than the larger of 0.05 USD and 25 percent of the estimate, in either direction. An actual against an UNKNOWN estimate is always flagged so the missing price is added to the book.

## 8. What v1 does not cover (stated limits)

- Services without a Singapore-specific or complete price in the book: Cloud SQL (the saved tables show the default Iowa price only, and no smallest non-shared instance total), Firestore, AlloyDB, load balancing, Cloud Armor. They return UNKNOWN until sourced. Gemini Developer API prices are in the book for gemini-3.8-flash and gemini-3.5-flash-lite only (standard, paid tier; batch, flex, caching, grounding, audio and image pricing are not modelled).
- Taxes and support. Credit balances are stated by the owner in budget.json (the engine does not read them from Google), and credit coverage per service is verified only from the Credits column of a billing report.
- Committed use discounts and other commitments: they are charges no formula predicts. They appear as unexplained spend when the report is entered; no agent may purchase one (AEG-SOP-002).
- Instance-hour rounding and concurrency: the caller passes billed seconds.
- Only the first egress volume band; no per-day cumulative limit (many small actions below 0.50 USD are bounded only by the monthly budget, so splitting an action to dodge the limit is prohibited by the SOP).
- The cap state is set by the owner from the console (`capEnforced`), not read from Google.
- Cloud Run egress: the Cloud Run page limits its free 1 GiB to North America while the network page lists 0 to 1 GiB free for Asia destinations; the engine deducts none (conservative).
- The Cloud Run Tier 1 and Tier 2 price columns were read from the pricing page's embedded data; the attribution was checked by the pattern across three Tier 1 and three Tier 2 regions, and the numbers themselves are re-checked against the saved page.

## 8a. Console CSV

The console CSV format is not yet verified from a real file (the owner's download failed and the only sample is a chatbot's illustration). Actual costs are entered with `npm run cost -- actual` until a real file exists; no importer is built on an unverified format.

## 9. Change control

A new price, formula or policy rule is a change with a quoted source, a test and an updated hash; the ledger records which price-book hash and policy version each decision used. Review by the supervisor follows the first live use.

## 10. Addendum 2026-10-16: pricing a render job (planning, not a gate formula)

The gate formula for a render is `AEG.F.GCP-CLOUDRUN-GPU-JOB/1.0.0` with `instanceSeconds` set to the job timeout, so the estimate is a worst case and does not depend on a guess of speed. For planning only, once a run has been measured: `instanceSeconds = startupSeconds + renderSecondsPerVideoSecond x videoSeconds + encodeAndUploadSeconds`, and `cost = instanceSeconds x 0.00034884 USD` for 4 vCPU, 16 GiB and one L4 in Singapore (price book 1.1.0). Four bulletins a day of about 3 minutes is `4 x 3 x renderSecondsPerVideoSecond x 60 x 0.00034884` USD a day, to be filled with the measured ratio and never with the laptop figure (436 s of MuseTalk per 10 s of speech on an RTX 4050 is not an L4 figure). Build minutes and image storage are separate gate calls (AEG-SOP-002 Annex A). Cloud Storage has no price in the book yet and is UNKNOWN until the engineer adds one with its source.
