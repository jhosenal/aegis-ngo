-- Job sheets (AEG-NEWS-007): every unit of work (a translation, a voice, a presenter render, a code-only draft) is ONE card with a UUID, so it can be pulled for audit. Each card carries its
-- cost ESTIMATE from the price book (formula lines, price basis), later the settled cost, and who asked. The job credit is an operating balance for these jobs (separate from the monthly cost-engine
-- budget and from the Google credit): an append-only ledger, balance = the sum of its rows. Credit never blocks an emergency alert (translation, voice); it gates presenter renders.
CREATE TABLE job_sheet (
  job_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('draft', 'translate', 'voice', 'render')),
  bulletin_id TEXT,
  language TEXT,
  label TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ESTIMATED', 'DONE', 'FAILED', 'WAITING_OWNER', 'CANCELLED')),
  estimate_status TEXT NOT NULL CHECK (estimate_status IN ('ESTIMATE', 'UNKNOWN')),
  estimate_micro INTEGER,
  settled_micro INTEGER,
  lines_json TEXT NOT NULL,
  params_json TEXT NOT NULL,
  note TEXT,
  price_book_version TEXT,
  finished_at TEXT
);
CREATE INDEX job_sheet_bulletin ON job_sheet(bulletin_id, created_at);
CREATE INDEX job_sheet_created ON job_sheet(created_at);
CREATE TABLE job_credit_ledger (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('OPENING', 'TOPUP', 'RESERVE', 'SETTLE', 'RELEASE')),
  amount_micro INTEGER NOT NULL,
  job_id TEXT REFERENCES job_sheet(job_id),
  by_user TEXT NOT NULL,
  note TEXT
);
INSERT INTO job_credit_ledger (at, kind, amount_micro, job_id, by_user, note)
VALUES ('2026-10-17T00:00:00.000Z', 'OPENING', 4000000, NULL, 'owner', 'Opening job credit 4.00 USD, set by the owner on 2026-10-17 ("set it $4 balance now").');
