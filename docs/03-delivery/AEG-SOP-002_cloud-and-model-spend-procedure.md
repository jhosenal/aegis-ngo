# AEG-SOP-002 — Cloud and model spend procedure

| Field | Value |
|---|---|
| Document ID | AEG-SOP-002 |
| Revision | 0.3 (REVIEW_DRAFT) |
| Date | 2026-10-14 |
| Contract | AEG-CON-004 (the formulas, price book, decision table and ledger) |
| Applies to | every agent and the owner, for any action that can cost money on Google Cloud or an AI model provider |

## 1. Roles

| Role | Who | May |
|---|---|---|
| Estimator | any agent | propose an action and run the gate |
| Operations agent | the dedicated operations agent | execute a cloud action **only** after a GO, or after an ASK_OWNER that the owner approved; record the actual cost |
| Owner | the project owner | approve an ASK_OWNER; set the budget and the cap state; read the console |
| Engineer | the engineer | change formulas, the price book and the policy through the change control of AEG-CON-004 |

Agents propose; the operations agent acts; the owner monitors. No other agent runs a cloud or billing command.

## 2. Before any action that can cost money

1. Write the action as formula lines (for example one Cloud Build run, one image push with scanning, one smoke run in Singapore). List the formulas with `npm run cost -- formulas`.
2. Run the gate: `npm run cost -- gate --action <ID> --agent <name> --purpose "<why>" --lines '<JSON>'`.
3. Obey the exit code and nothing else:
   - **0 GO.** The operations agent may proceed.
   - **10 ASK_OWNER.** Stop. Give the owner the printed decision. The owner decides; if acceptable the owner runs `npm run cost -- approve --seq <N> --by <name> --note "<why>"`. Only then may the operations agent proceed. UNKNOWN costs always come here.
   - **11 STOP.** Do not proceed. A STOP is not approved. The cause (budget exhausted, cap enforced) must be lifted by the owner, then the gate is run again.
   - **2 error.** Fix the input or the data; do not proceed.
4. One gate call per intended action set. **Splitting one action into smaller calls to stay under the per-action limit is prohibited.**

## 3. After the action

5. Within 24 hours of the charge appearing, record the actual cost from the billing console: `npm run cost -- actual --seq <N> --usd <amount> --service <name> --period <YYYY-MM> --source console-report`. An actual with no estimate is recorded without `--seq`.
6. A FLAGGED reconciliation is a finding: say what differed and either correct the price book (with a quoted source and a test) or note the assumption that was wrong. An UNKNOWN estimate that proceeded is always flagged: add the missing price.

## 4. Routine

7. Weekly, and before any deploy: `npm run cost -- verify` (the chain must be intact) and `npm run cost -- status` (budget, committed, anything waiting for the owner, flagged variances).
8. The owner sets `capEnforced` in `records/costs/budget.json` when the console shows an enforced spend cap for a service the engine covers, and updates the monthly budget at the start of a period.
9. Never edit the ledger by hand. A damaged ledger stops the engine; report it.

## 5. Prices

10. A price changes only with a quoted source, its saved page where possible, and a green test run. The engine records the price-book hash with each decision.
11. Google's page can change: re-read the source before relying on a price older than a month, and before any spend above the per-action limit.

## 5a. Funding, commitments and unexplained spend

12. Record the funding source of every actual (`--funding`) and, from the billing report's Credits column, the credit applied (`--credit-usd`). A FLAGGED **card exposure** means money reached the payment method: stop further spend in that service until the owner decides.
13. **No agent purchases a commitment** (committed use discount, reservation, prepaid package, auto-reload) or changes the billing account. Buying one is a spend action that only the owner may approve in writing, and these commitments cannot be cancelled.
14a. **Record an actual against its estimate.** A charge that WAS gated is recorded with `--seq` (the estimate it belongs to). An actual without `--seq` means spend nobody gated, and the engine adds it to committed spend on top of the estimates, so a period total entered that way double counts. A wrong actual is never edited: cancel it with `npm run cost -- reverse --seq N --by NAME --reason "why"` (a REVERSAL entry; both stay in the chain). Ledger entries 42 and 43 were recorded wrongly on 2026-10-17 and reversed by entries 44 and 45. The real monthly bill is read from the BigQuery billing export (Admin Desk, Google bill card) and is not typed into the ledger as a total.
14. The owner reads the billing console's Committed use discounts page and Reports at the start of every period. Any commitment or charge nobody gated is **unexplained spend**: record it as an actual with no estimate and report it the same day.

## 5b. Where the money lands: the free credit (AEG-CON-004 section 4b)

15. When an action involves a service you are not sure the credit pays for, run `npm run cost -- credit --charges '[{"service":"<name>","usd":"<amount>"}]'` first. **Exit 11 means part of it would reach the owner's card: stop and ask the owner.** Gemini API in AI Studio is paid only from the Gemini prepay, a partner model or a non-Google service only from the card, and nothing from the credit after 2026-12-16.
16. A service is `COVERED_ASSUMED` until a billing report shows the credit applied. `npm run cost -- status` reports the committed spend that rests on that assumption. After a report shows the credit equal to the charge, the engineer (not an operations agent) changes that service to `COVERED_OBSERVED` in `records/costs/credit-terms.json` with the report as evidence and a green test run. If the report shows the credit did **not** apply, the service becomes `NOT_COVERED`, its formula funding becomes `OTHER`, and the owner is told the same day.
17. A new service is added to the terms file with its source before any formula for it is relied on; until then it is `UNCLASSIFIED` and counts as card spend.

## 6. Gaps agents must respect

The engine returns UNKNOWN for services without a price (see AEG-CON-004 section 8). UNKNOWN is a reason to ask the owner, never a reason to proceed. No agent may substitute its own price.

## 7. Annex A: GPU render jobs (added 2026-10-16 from the first news render test, AEG-RENDER-001)

A render of the AI presenter on Cloud Run with one L4 is a chain of gated steps. Each is its own gate call; none is covered by another.

1. **Price book first.** The L4 price (Singapore, no zonal redundancy), jobs CPU and jobs memory come from the saved Cloud Billing Catalog read in `records/costs/sources/`. One job instance with 4 vCPU and 16 GiB costs 0.00034884 USD per second (1.256 USD an hour). Never use a Tier 1 price for Singapore.
2. **Gate the job at its timeout**, not at an assumed speed: formula `AEG.F.GCP-CLOUDRUN-GPU-JOB/1.0.0`, `instanceSeconds` = the task timeout (900 for a short trial, 3600 for about 3 minutes of video). The job settings (region `asia-southeast1`, 1 task, parallelism 1, max retries 0, the timeout, one L4, 4 vCPU, 16 GiB) become part of the approval and may not be loosened. Over 0.50 USD comes back ASK_OWNER: the owner approves with `npm run cost -- approve --seq N --by <name> --note "<their instruction>"`. An owner's written instruction in chat that names the action is an acceptable note; quote it.
3. **Gate the build separately** (`AEG.F.GCP-BUILD-MONTH` and `AEG.F.GCP-ARTIFACT-STORAGE-MONTH`). Cloud Build needs `--timeout 5400s` (the default 10 minutes is too short for the CUDA image). The image has to exist before the job is created.
4. **Uncovered items are named, not forgotten:** the Cloud Storage bucket (weights, input, output) has no price in the book yet. Say so in the handoff; ask the engineer for a gate call (add the price with its source first) before creating a large bucket.
5. **The operations agent (or the owner) runs the commands; the engineer writes a run sheet** (pattern: `docs/99-inbox/O0001`, `O0002`, `O0004`) with the ledger numbers, the exact settings, what to measure and what to report. A failed build is reported with the failing step and the log lines; the build is not retried in a loop.
6. **Record the actual** against the ESTIMATE entry (the lower seq, not the approval entry): `npm run cost -- actual --seq <estimate seq> ...`, within 24 hours of the charge, for the job and for the build.
7. **Measure** instance start, weights load, Kokoro, MuseTalk per beat, encode, upload, total seconds and peak GPU memory, and compute seconds of render per second of video. That ratio replaces any guess in the next gate.
8. **Input is only narratable data.** The script comes from `tools/export-render-script.ts` (USGS, GDACS, NEA PSI, MetMalaysia). Google air and weather never enter a script or a video (Maps Platform Terms 3.2.3). A render is a test and is not played publicly while the weight and idle-clip licences are UNVERIFIED.
9. A new run is a new gate call. Do not split or repeat a run to stay under a limit.
