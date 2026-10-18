# AEG-TSK-005 — Evidence, fixture adapter, incident cards and seed

| Field | Value |
|---|---|
| Requirements | AEG-REQ-005, 015 (fixture part), AEG-DAT-001, AEG-TST-005 |
| Depends on | TSK-001, TSK-002, TSK-003, TSK-004 (TSK-007 is NOT required; this card writes incident card rows itself as described below) |
| Owned paths | `src/sources/normalize.ts`, `src/sources/fixtureAdapter.ts`, `src/sources/evidenceView.ts`, `src/data/repos/evidence.ts`, `src/services/incidentCards.ts`, `src/services/seed.ts`, `src/services/seed-cli.ts`, `tests/unit/normalize.test.ts`, `tests/integration/evidence.test.ts` |
| Read | ENG-002 section 4, ENG-004 section 2, `fixtures/*.json`, `src/types/domain.ts` |
| Gate | `npm run gate -- TSK-005` |

## Spec
```ts
// normalize.ts
export function parseCoordinate(s: string, kind: 'lat' | 'lon'): number | null;   // regex ^-?\d{1,3}(\.\d{1,6})?$ ; micro-degrees as integer; |lat| <= 90e6, |lon| <= 180e6 else null
export interface RawIncidentRecord { sourceRecordId: string; incidentKey: string; title: string; hazardType: string; alertLevel: string; eventTime: string; publishedAt: string; regionId: string; lat: string; lon: string; affectedPeopleEstimate: number; sourceUrl: string }
export function normalizeIncident(raw: RawIncidentRecord, source: { sourceId: string; licenceRef: string; validHours: number; adapterVersion: string }, fetchedAt: string): { payload: IncidentPayload; intakeFlags: IntakeFlag[]; validUntil: string }
// fixtureAdapter.ts
export interface ApplyResult { pollId: string; outcome: SourceState; inserted: string[]; duplicates: string[]; superseded: { old: string; new: string }[] }
export function applyPoll(db: Db, poll: FixturePoll, sources: SourceDef[], ids: IdGen): ApplyResult;   // ONE transaction (.immediate()) per poll
// evidenceView.ts  (pure)
export function toEvidenceViews(all: EvidenceRecord[], targetIds: string[] | null, nowIso: string): EvidenceView[];
// services/incidentCards.ts
export function projectIncidentCards(db: Db, ids: IdGen, nowIso: string): { created: string[] };   // idempotent
// services/seed.ts
export function seedAll(db: Db, fixturesDir: string, clock: Clock, ids: IdGen): SeedSummary;
```
Rules:
- Evidence id `EV-<sourceRecordId>-r<revision>`. Duplicate = same `(source, record)` and equal `rawArtifactHash` as the latest revision. Different hash = new revision with `supersedesEvidenceId`.
- `validUntil = publishedAt + validHours` as ISO Z. `INCOMPLETE` flag if any required raw field is empty. `SYNTHETIC` flag and `synthetic = 1` for all fixture records. `licenceRef` from the source. `tenantScope = null`.
- Source poll outcomes: `OK` upserts `source_status` (state OK, `last_ok_at = poll.fetchedAt`). `UNAVAILABLE` or `MALFORMED` set state and detail, keep `last_ok_at`, write NO evidence and delete nothing; append `source.status_changed` to chain `(AEG, SYSTEM)` when the state changes to a non-OK state. Each inserted evidence row appends `evidence.ingested` to the SYSTEM chain (inside the same transaction).
- `projectIncidentCards`: for every tenant and every latest evidence revision N of every `(source, record)`: ensure card `INC-<tenantId>-<sourceRecordId>` has revision N; create missing revisions in order; mark the previous revision `superseded`; new revision state `validated`; body `kind: 'incident'`, status `ok`, synthetic true with label `SYNTHETIC DEMO DATA - not a real event`, fields per ENG-002 (hazardType, alertLevel fact; eventTime, publishedAt fact; affectedPeople estimate; region fact; location fact or unknown), `evidenceIds = [EV id]`, `created_by = 'SYSTEM'`. Write these rows with plain prepared statements in this card (TSK-007 later offers a service; do not wait for it) and append a `card.created`/`card.revised` event to the tenant chain.
- `seedAll`: migrate is done by the caller; insert tenants, users, resources, formulations (`seedFormulations`), apply all polls in order, project incident cards. Idempotent: running twice changes nothing. `seed-cli.ts` loads config, opens the DB, runs `migrate`, then `seedAll` with a `FixedClock` set from `fixtures/clock.json` (fixture seeding always uses that fixed instant) and a `RandomIdGen`.

## Tests
Implement every row of ENG-004 section 2 (evidence ids, duplicate, supersede, validUntil, flags at T-now, coordinates table, source_status, retained evidence, SYSTEM chain length 7 and verifies, incident card counts, determinism across two fresh DBs).
