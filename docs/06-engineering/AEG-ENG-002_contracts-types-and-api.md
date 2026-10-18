# AEG-ENG-002 — Contracts, API and rules

| Field | Value |
|---|---|
| Document ID | AEG-ENG-002 |
| Revision | 0.1 |
| Status | WORKING_BASELINE |
| Date | 2026-10-13 |
| Owner | Claude (engineer) |
| Approval | Authored under owner direction (AEG-ADR-001); not independently audited |
| Classification | Internal |

Compilable contracts live in `src/types/domain.ts` and `src/types/api-schemas.ts` (read them first). This document adds the behaviour that types cannot express. If this document and a contract file disagree, the contract file wins and you report the conflict.

## 1. Configuration (environment variables, validated at startup, fail fast with ALL errors listed)

| Variable | Default | Rule |
|---|---|---|
| AEGIS_ENV | local | `local`, `cloud` or `test`. `cloud` requires `PORT` and forces host 0.0.0.0 |
| AEGIS_HOST | 127.0.0.1 | Must be loopback unless AEGIS_ENV=cloud |
| PORT | 8787 | Integer 1024..65535. TSK-000 checks the port is free; never stop another product to get a port |
| AEGIS_PRODUCT_ID | AEG | Must equal `AEG` |
| AEGIS_STORAGE_MODE | sqlite-local | `sqlite-local` or `sqlite-ephemeral-demo`. `cloud` requires `sqlite-ephemeral-demo` |
| AEGIS_DB_PATH | ./data/aegis.db | Resolved from project root. `:memory:` allowed only when AEGIS_ENV=test |
| AEGIS_AUTH_MODE | demo | Only `demo` exists. Demo login is a local/demo mechanism, not production authentication |
| AEGIS_PROVIDER_MODE | stub | `stub` or `live`. `live` requires Google key, model, price snapshot id and budgets > 0 |
| AEGIS_MODELS_ENABLED | false | With false, no provider is ever called |
| AEGIS_GOOGLE_API_KEY / AEGIS_GOOGLE_MODEL | empty | No default model name. Never log the key |
| AEGIS_REAPI_API_KEY / BASE_URL / MODEL | empty | Same rules |
| AEGIS_REAPI_ALLOWED_DATA_CLASSES | public | Comma list of `public`, `tenant_private` |
| AEGIS_PRICE_SNAPSHOT_ID | empty | Unknown pricing means no paid call |
| AEGIS_BUDGET_ACCOUNT_MICRO / DAY / TASK | 0 | Integer micro-USD. 0 means live spend disabled |
| AEGIS_TOTAL_DEADLINE_MS | 15000 | Total deadline across ALL attempts of one task |
| AEGIS_MAX_ATTEMPTS_TOTAL | 3 | Includes primary retries and backup |
| AEGIS_MAX_PRIMARY_ATTEMPTS | 2 | Must be <= max total |
| AEGIS_BACKOFF_BASE_MS | 200 | Retry delay = floor(base * 2^(n-1) * (0.5 + rng())), n = retry number from 1 |
| AEGIS_CIRCUIT_FAILURE_THRESHOLD / COOLDOWN_MS | 3 / 30000 | Per provider |
| AEGIS_FEED_ALLOWLIST / POLL_MINUTES | empty / 15 | Fixture mode needs no allowlist |

## 2. HTTP API (JSON, all under `/api`, Fastify)

Auth: `Authorization: Bearer <token>` from `POST /api/session`. Every route except `health` and `session` requires it. Principal = `{userId, tenantId, productId, role}` from the session, never from the body. Error envelope: `{ "error": { "code": "E_...", "message": "...", "details": {} } }` with the status from `ERROR_STATUS`. Cross-tenant ids return `E_NOT_FOUND`.

| Method and path | Roles | Request | Success response |
|---|---|---|---|
| GET /api/health | none | - | `{status:"ok", storage:"local"|"ephemeral-demo", providerMode:"stub"|"live", modelsEnabled:boolean}` |
| POST /api/session | none (demo auth only) | `SessionBody` | `{token, expiresAt, user:{userId,displayName,role,tenantId,tenantName}}`. 404 `E_DEMO_AUTH_DISABLED` if auth mode is not demo |
| GET /api/me | any | - | same user object |
| GET /api/cards?kind= | any | query | `{cards:[{cardId,kind,latestRevision,title,state,updatedAt,synthetic}]}` own tenant only |
| GET /api/cards/:cardId | any | optional `?revision=` | `{card: CardRevision, revisions:[{revision,state,createdAt}], evidence: EvidenceView[], children:[CardLink]}` |
| GET /api/evidence/:evidenceId | any | - | `EvidenceView` (public or own tenant) |
| GET /api/incidents | any | - | incident card summaries plus `sourceStatus: SourceStatus[]` |
| GET /api/pins / PUT /api/pins/:cardId / DELETE /api/pins/:cardId | any | - | `{pins:[{cardId,pinnedAt}]}` |
| POST /api/workflows/resource-assessment | coordinator, analyst | `RunAssessmentBody` | `{run: RunResult, card: CardRevision | null, decisionHash: string}` |
| POST /api/chat | any | `ChatBody` | `ChatReply` |
| GET /api/audit/verify | coordinator | - | `{ok, errors, head}` for the caller's tenant chain |
| GET /api/audit/export | coordinator | - | audit export JSON (see TSK-004) |
| GET /api/budget | coordinator | - | `{limits, committedMicro, modelsEnabled, providerMode}` |

Rules: PUT pins is idempotent. Pinning never sends content anywhere. `POST /api/workflows/...` with `demandUnits: null` returns 200 with `run.state = "awaiting-input"` and a draft card listing `missing`. A domain rule violation returns 422 with the specific code and `details.runId`.

## 3. Audit events

Event types: `evidence.ingested` and `source.status_changed` (chain AEG/SYSTEM); `card.created`, `card.revised`, `workflow.completed`, `workflow.awaiting_input`, `workflow.failed`, `chat.routed`, `model.attempted`, `audit.exported` (tenant chains). `payloadHash` is `hashWithDomain('AEG-PAYLOAD-v1', <small summary object>)`. Raw tenant payloads are never placed in events. `chat.routed` is written for every chat message including denied routes and clarifications.

## 4. Evidence and card rules

- Incident card id: `INC-<tenantId>-<sourceRecordId>`. Incident card revision N corresponds to evidence revision N (`EV-<sourceRecordId>-r<N>`). A duplicate poll creates nothing.
- Cards are immutable snapshots. Flags that depend on "now" or on later evidence (`STALE`, `SUPERSEDED`, `CONFLICTING`) are computed at read time by `toEvidenceViews` and returned beside the card as `evidence`. Never write them into `body_json`.
- Stale rule: `validUntil = publishedAt + source.validHours`; stale when `now > validUntil`. Conflict rule: latest revisions from different sources sharing an `incidentKey` with different `affectedPeopleEstimate` are all `CONFLICTING`. A superseded revision is never part of a conflict.
- Whenever `synthetic` is true, `syntheticLabel` is non-null and the UI shows it on the card itself.
- Every card field carries an `epistemic` tag: `fact` (from a source record), `calculation` (from code), `estimate` (source-estimated figure such as affected people), `proposal` (suggested action, never executed), `unknown` (missing, value null).
- Assessment card id: `ASM-` + first 12 hex chars of `sha256(tenantId|incidentCardId|regionId|unitId)`. A new result for the same key is a new revision; the previous becomes `superseded`. Result card state is `validated`; awaiting-input cards are `draft`.
- Card links: result links to incident revision (`input`) and to evidence cards (`evidence`) if present. No cycles. Longest path through any new link must not exceed 6 (`E_CARD_DEPTH`).

## 5. Resource assessment workflow `AEG.W.RESOURCE-ASSESSMENT/1.0.0`

Resolve inputs (exact algorithm):
1. `row` = the tenant's `resources` row for `(regionId, unitId)`, or none.
2. `asOf = request.asOf ?? row.as_of ?? clock.now()`.
3. `demand = { units: request.demandUnits ?? null, unitId, regionId, asOf }` (demand is never stored, so omitted means unknown).
4. For `available` and `reserve`: if the request field is a number -> `{ units: n, unitId, regionId, asOf }`; if it is `null` -> `{ units: null, ... asOf }`; if it is omitted and `row` exists -> `{ units: row value, unitId, regionId, asOf: row.as_of }`; if it is omitted and there is no row -> `{ units: null, ... asOf }` plus warning `NO_RESOURCE_RECORD`.
5. If any `units` is null the workflow does NOT call the calculation: state `awaiting-input`, `missing` lists the field names (`demandUnits`, `availableUnits`, `reserveUnits`), a draft card is written.
6. Otherwise call `computeShortfall`. A thrown `AegisError` becomes run state `failed` with that code (no card), HTTP 422.
7. A request `asOf` that differs from `row.as_of` therefore yields `E_ASOF_MISMATCH` from the calculation (values loaded from the row keep the row's time basis).

Decision payload (compared across runs and across models enabled/disabled): canonical `{result, missing, status, warningCodes}`; `decisionHash = hashWithDomain('AEG-RESULT-v1', payload)`.

Warnings (codes): `EVIDENCE_STALE`, `EVIDENCE_CONFLICTING`, `EVIDENCE_COORD_INVALID`, `SOURCE_UNAVAILABLE` (incident's source currently not OK), `RESOURCE_AS_OF_OLD` (resource `as_of` more than 24 h before now), `NO_RESOURCE_RECORD`. Warnings never block the calculation; they are shown on the card.

Card text: title `Resource assessment: <unitId> in <regionId>`; summary with shortfall `Shortfall <n> <unitId> (demand <d>, usable <u>)`; no shortfall `No shortfall; surplus <n> <unitId> (demand <d>, usable <u>)`; unknown `Awaiting input: <missing list>`. Assumptions (always): `Arithmetic assessment only; it does not show that supplies can be transported or allocated.` and `Demand, available and reserve share one unit, region and as-of time.` plus, when synthetic: `Resource figures are SYNTHETIC DEMO DATA, not a real stock record.`

## 6. Chat

Local grammar (keywords case-insensitive, whitespace collapsed, ids case-sensitive; `unknown` means null):
- `help` -> `I_aegis_help_show`
- `list incidents` -> `I_aegis_incident_list`
- `open <cardId>` -> `I_aegis_card_open`
- `assess <incidentCardId> unit <unitId> region <regionId> demand <N|unknown> [available <N|unknown>] [reserve <N|unknown>]` -> `I_aegis_resource_assess` (uses the incident card's latest revision unless an attachment of that card is present, then the attached revision)
- `verify audit` -> `I_aegis_audit_verify`
- `explain <cardId>` -> `I_aegis_card_explain` (always a code-built explanation; a model rewrite is optional, see TSK-012)

Anything else is ambiguous: if models are enabled and the budget allows, the manager role may propose `{routeId, args, clarification}`; otherwise reply with a clarification block listing the known commands. A model proposal is validated against: route allowlist, `modelProposable`, caller role, and the route's argument schema. Failure = `denied` with no side effect. Replies contain only `ChatBlock`s.

Provider notices: `GOOGLE_UNAVAILABLE_BACKUP_USED`, `MODELS_UNAVAILABLE`, `MODELS_DISABLED`, `BUDGET_EXHAUSTED`, `REFUSED`. The code-built result is always returned even if every provider fails.

## 7. Provider gateway policy (defaults; all from config)

| Condition | Behaviour |
|---|---|
| TRANSIENT or TIMEOUT from primary | Retry primary with backoff up to AEGIS_MAX_PRIMARY_ATTEMPTS, then ONE backup attempt, all within AEGIS_TOTAL_DEADLINE_MS and AEGIS_MAX_ATTEMPTS_TOTAL |
| AUTH | Open the circuit for that provider immediately; no retry; use backup if permitted |
| MALFORMED (fails schema or `validate`) | Discard the text; no correction attempt; try backup once if attempts remain |
| REFUSAL | Return status REFUSED; never switch provider |
| BAD_REQUEST | Return DEGRADED; no retry, no backup |
| Budget reservation denied | Record attempt `BUDGET_DENIED`; no network call; try next eligible provider (also needs a reservation) |
| Backup data class not allowed | Backup is not eligible; no call |
| Timeout after possible charge, or OK without usage | Mark reservation `liability` (keep full amount) until reconciled |
| Both providers fail | DEGRADED, notice `MODELS_UNAVAILABLE`, caller keeps the code-built result |

Reservation amount per attempt = `ceil((utf8Bytes(system+user) * inputMicroPerMTok + maxOutputTokens * outputMicroPerMTok) / 1,000,000)` using the price snapshot. Unknown price snapshot = no paid call. Every attempt writes a `model_calls` row and a `model.attempted` audit event.
