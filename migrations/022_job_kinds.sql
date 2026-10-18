-- Job kinds (AEG-NEWS-007): the script review (a Gemini call on Vertex AI) is a new kind of job. SQLite cannot change a CHECK, so both job tables are rebuilt without the kind CHECK (the code validates
-- kinds); every row and the ledger sequence are copied unchanged.
CREATE TABLE job_sheet_v2 (
  job_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
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
INSERT INTO job_sheet_v2 SELECT job_id, kind, bulletin_id, language, label, created_by, created_at, status, estimate_status, estimate_micro, settled_micro, lines_json, params_json, note, price_book_version, finished_at FROM job_sheet;
CREATE TABLE job_credit_ledger_v2 (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('OPENING', 'TOPUP', 'RESERVE', 'SETTLE', 'RELEASE')),
  amount_micro INTEGER NOT NULL,
  job_id TEXT REFERENCES job_sheet_v2(job_id),
  by_user TEXT NOT NULL,
  note TEXT
);
INSERT INTO job_credit_ledger_v2 SELECT seq, at, kind, amount_micro, job_id, by_user, note FROM job_credit_ledger;
DROP TABLE job_credit_ledger;
DROP TABLE job_sheet;
ALTER TABLE job_sheet_v2 RENAME TO job_sheet;
ALTER TABLE job_credit_ledger_v2 RENAME TO job_credit_ledger;
CREATE INDEX job_sheet_bulletin ON job_sheet(bulletin_id, created_at);
CREATE INDEX job_sheet_created ON job_sheet(created_at);
