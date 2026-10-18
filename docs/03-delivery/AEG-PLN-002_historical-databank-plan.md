# AEG-PLN-002 — Historical databank plan (A0006, DBK-01 to DBK-05)

| Field | Value |
|---|---|
| Document ID | AEG-PLN-002 |
| Revision | 0.1 (WORKING_PLAN, not approved) |
| Date | 2026-10-14 |
| Owner | Claude (engineer); Luna does bounded research and prototypes; Astra reviews contracts |
| Inputs | A0006 (assignment), `015_EG-DEV-004` (original proposal, unchanged), L0007 (source register, 15 datasets), AEG-PLN-001 sec. 1.9 |
| Status of claims | Every external fact below is either cited to L0007/A0006 with its status, or marked NOT_ESTABLISHED. Nothing here is a performance claim. |

## 1. Purpose and non-goals

Build a **versioned local evidence bank** for offline replay, source comparison and validating formulations. Ingestion, parsing, deduplication and checks are plain code with no model dependency.

Non-goals (A0006): a prediction engine; a global multi-decade crawl; a production database; integrating `src/ingestion`; a second mandatory database; any hazard threshold or probability inferred from archive volume. Publishing a dataset **activates no formulation**.

## 2. Principles

1. Coverage is stated **per dataset, version, variable and geography** with observed completeness, never one date range per hazard.
2. "Free" is checked, not assumed: access method, licence, attribution, redistribution, credentials, quotas (L0007 records these per source; 14 of 15 are PARTIAL).
3. Absent data is `UNKNOWN`, never zero. A missing report is not "no event".
4. Raw bytes are immutable and kept in native format. Revisions are new records, not overwrites.
5. A secret never appears in a persisted URL, manifest, log or error (FIRMS MAP_KEY is the known case).
6. Official APIs and bulk exports over scraping; an access failure is reported, never bypassed.
7. Integrity (hashes) is not scientific truth and is not permission.
8. Everything below the pilot gate (sec. 7) is design only until a measured pilot is accepted.

## 3. Record families (shared provenance/time/unit fields, not one event-point schema)

| Family | Examples | Notes |
|---|---|---|
| event | earthquake, tsunami source event, eruption | stable source ID plus version; magnitude type kept (no Mw assumption) |
| measurement | runup observation, gauge reading | observation time distinct from event time |
| gridded-field reference | ERA5, GloFAS | file reference + variable, level, resolution, aggregation, missing-value code; stays NetCDF/GRIB/Zarr as supplied |
| population statistic | UNHCR stock vs flow vs return, population grid | cohort and vintage required; stocks, flows and grids are never conflated |
| narrative advisory | WHO DON, VAAC advisory | not an exhaustive or case-count series |
| candidate association | storm near river basin, quake near tsunami record | `relation = CANDIDATE_ASSOCIATION`, matching-policy ID, input hashes, measured distance/time, uncertainty, alternatives; never a causal or probability label |

Common fields: `datasetId`, `datasetVersion`, `sourceRecordId`, `eventTime` / `validTime`, `availableAt` (when known), `retrievedAt`, `parserVersion`, `licenceRef`, `units`, `crs`.

## 4. Pipeline (shared capabilities, source-specific adapters)

States per chunk: `PLANNED -> REQUESTED -> DOWNLOADED -> VALIDATED -> COMMITTED -> PUBLISHED`, with side states `QUARANTINED` and `FAILED`. Allowed transitions are a closed table; any other transition is an error. A checkpoint is written only after `COMMITTED`.

| Step | Contract |
|---|---|
| Source registration | dataset ID/version, publisher, authoritative URL, access/licence evidence, resolution, units, missing codes, revision semantics, credentials *reference* (never the value), permitted purposes |
| Bounded planning | explicit area/date/variables; deterministic chunk IDs (hash of dataset, version, request parameters, no secrets); a **dry run** lists chunks and estimated sizes before any download |
| Acquisition | allowlisted endpoints, timeouts, bounded retries with backoff and `Retry-After`, pagination, conditional GET where supported, temp file then atomic rename |
| Raw registration | content hash, sanitized request, release/source ID, `retrievedAt`, licence reference, parser version; the raw directory is gitignored |
| Typed transform | schema, CRS/axis order, units, time zone and interval meaning checked; rejects go to quarantine with a reason |
| Reconciliation | version-aware dedup (stable ID), observed vs source-stated counts, missing chunks, restart idempotency |
| Snapshot publication | only complete validated partitions enter the index; incomplete data is retained with coverage flags and restricted use |

Truncation rule (USGS): if a query returns the 20,000-event cap or HTTP 400, split by time/region and compare the count; never accept silently.

## 5. Storage (decision deferred to DBK-02 evidence)

- Keep the existing SQLite for control state and audit linkage.
- Evaluate **DuckDB over partitioned Parquet** for tabular event facts, against criteria measured in the pilot: load time, query time on the pilot sizes, file size, and ability to replay from raw. Grids stay in native formats.
- PostGIS only if a demonstrated workload needs it. Not a default second database.
- Deployment boundary: the app consumes a **versioned snapshot subset through a defined interface**. The local working archive is not the hosted instance's durable database; serving, backup, refresh and tenancy are planned separately (DBK-05).

## 6. Manifest, integrity and audit

A manifest binds: dataset/version, normalized schema version, parser version, chunk IDs, **sorted** file paths, byte counts and content hashes. If a Merkle tree is used (decision in DBK-02), the design must define leaf encoding, domain separation (new domain, e.g. `AEG-DBK-v1`, additive to the existing ones), ordering, duplicate handling, odd-leaf policy, and include proof tests. The completed snapshot root is linked into Aegis's **own** audit evidence. It is not sealed into the OAG core chain.

## 7. Work packages

| ID | Luna (bounded research / prototype) | Engineer deliverable and verification | Gate to proceed |
|---|---|---|---|
| DBK-01 source register | L0007 done (15 rows). Remaining: IBTrACS agency wind bases and version, Dartmouth access, GVP release/licence, per-VAAC archives, HDX publisher licences | I re-opened the key official pages for USGS, UNHCR, FIRMS, ERA5 (matched). Smithsonian pages return 403 to me, so they stay unverified. Coordinate with S0002; no duplicate research | each accepted claim verified directly |
| DBK-02 shared engine design | compare a shared adapter interface with separate crawlers; prototype deterministic chunking, record identity, raw manifest, **offline** | controlled design: interfaces, state table (sec. 4), record families (sec. 3), storage choice with measured criteria, numeric conversion boundary, budgets, failure/recovery, paths, tests | Astra reviews the contracts |
| DBK-03 bounded pilot | USGS only first (card below). IBTrACS only after its licence/redistribution is verified. Other sources use clearly labelled fixtures | I rerun the pilot independently and compare counts and hashes | pilot card approved; measured results reported before any expansion |
| DBK-04 adversarial tests | fixtures: missing/extra pages, rate limit, revoked access, timeout, truncated or corrupt download, schema drift, unit/type mismatch, duplicate/revised records, interrupted commit and restart | replay failures; prove no partial publication, idempotent restart, no silent loss, no secret in logs, raw-to-normalized provenance | all fixtures pass in my rerun |
| DBK-05 integration and backfill | estimate storage/download effort **from measured samples**; per-source retention and incremental schedule | integration cards with exact evidence; Astra reviews before production integration | backfill uses measured budgets, never an uncapped job |

### 7.1 Pilot card DBK-03a (draft for Astra; not started)

| Item | Proposal |
|---|---|
| Source | USGS FDSN Event API (`earthquake.usgs.gov/fdsnws/event/1/`), no credentials (L0007) |
| Window | magnitude >= 6.0, worldwide, 2020-01-01 to 2020-12-31 (a bounded year; the expected count is **not asserted**: a `count` query comes first and is recorded) |
| Caps | at most 5 requests, 10 MB, 50 MB disk, concurrency 1, 1 request per second, total time 5 minutes |
| Stop conditions | HTTP 400 (cap exceeded: split, do not widen), any non-200 other than 429/503, `Retry-After` handling exhausted, byte or request cap reached, parse failure rate above 0 (quarantine and stop) |
| Outputs | raw files + hashes, normalized table, manifest, count reconciliation (`count` query vs rows), throughput and size measurements |
| Licence | the API page states no licence (L0007); this blocks **redistribution**, not a local research pilot. Recorded as NOT_ESTABLISHED for any publication |
| Verification | I rerun from the manifest and compare hashes and counts |

## 8. Evaluation and leakage rules (for later use of the bank)

Distinguish occurrence time from `availableAt`. Later corrections and revised reanalysis must not leak into an "as known then" evaluation; where availability cannot be established, label the evaluation **retrospective**. Training, validation and test partitions are explicit and time-separated; a candidate improvement needs held-out outcomes and a recorded promotion decision. An association is not causation.

## 9. Reuse boundaries

SOOS_QMS / QZEEX / Storyboard: patterns only (resumable time-series ingestion, timestamps, unit discipline, versioned transforms, evidence-linked evaluation), through identified, reviewed adapters, after checking exact paths and licences. Read-only; no bulk copying of financial datasets or private databases; no transfer of financial correlations into hazard coefficients.

## 10. Held items from the proposal (A0006, unchanged)

Tsunami probability from magnitude/depth/coast/time; antecedent soil saturation from discharge; PM10 / roof-load trajectories from VEI and winds; Parquet for every dataset; DuckDB + PostgreSQL + PostGIS together; any claim of prevention or prediction.

## 11. Paths and controls

Prototypes and fixtures: `research/databank/` (raw download directories gitignored). Inbox notes use the next free `S`/`L` numbers. New controlled document IDs are registered before the file exists (this plan: AEG-PLN-002, registered 2026-10-14). Luna has no per-card gates; her notes record options, exact commands, exit codes, hashes, source evidence and NOT_ESTABLISHED items. I rerun critical cases and own integration gates by behavior.

## 12. Open questions for Astra

1. Approve the pilot card DBK-03a (sec. 7.1) as drafted, or change the window and caps.
2. Is a local-research pilot acceptable while the USGS licence is NOT_ESTABLISHED for redistribution?
3. Agree that the Merkle/manifest design (new additive hash domain) is decided in DBK-02, not now.
