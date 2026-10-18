# AEG-TSK-002 — Database and migrations

| Field | Value |
|---|---|
| Requirements | AEG-REQ-001, 011, 012 (storage base) |
| Depends on | TSK-000 |
| Owned paths | `src/data/db.ts`, `src/data/migrate.ts`, `src/data/migrate-cli.ts`, `tests/unit/db.test.ts` |
| Read | `migrations/001_init.sql`, ENG-001 section 2 |
| Gate | `npm run gate -- TSK-002` |

## Spec
```ts
export type Db = import('better-sqlite3').Database;
export function openDb(path: string): Db;   // foreign_keys=ON, busy_timeout=10000, journal_mode=WAL unless ':memory:'; creates parent folder for files
export function projectRoot(): string;       // from import.meta.url, two levels up from src/data
export function migrate(db: Db, dir: string): { applied: string[]; skipped: string[] };
```
`migrate`: list `*.sql` in `dir` sorted by name; create `schema_migrations` if absent (the 001 file itself creates it, so create it with `CREATE TABLE IF NOT EXISTS` before running and make 001 tolerant: run 001 only when the `tenants` table does not exist and then insert its row); run each unapplied file inside one transaction and insert `(filename, clock ISO)`. Because `migrate` has no clock, accept `nowIso: string` as a third parameter. If an applied filename is no longer present, throw `AegisError('E_INTERNAL', ...)`.
`migrate-cli.ts`: reads config (`loadConfig(process.env)` from TSK-001), opens the DB, migrates, prints applied files, exits 0.

## Tests
- "migrate applies 001 once and is idempotent" (second call applied = []).
- "foreign keys are enforced" (insert user with missing tenant throws).
- "audit_events rejects update and delete".
- "active formulation is immutable but can be deprecated".
- "restart persistence": write a tenant row to a temp file DB, close, reopen, read it back (use `os.tmpdir()`).
- "removed migration file is detected".
- "wal mode on files, not on memory".

## Do not
Edit `migrations/001_init.sql`. Add future schema changes only as `002_*.sql` files if the engineer asks.
