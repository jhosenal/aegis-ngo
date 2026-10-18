-- Pin catalog edits by an administrator (AEG-DATA-001): pins added in Admin Desk and tombstones for fixture pins that were deleted (restorable).
-- Coordinates and descriptions only; no air or weather reading is ever stored here. The log is append-only.
CREATE TABLE pin_overrides (
  pin_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('ADD', 'DELETE')),
  payload_json TEXT,
  by_user TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE TABLE pin_admin_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL CHECK (action IN ('ADD', 'DELETE', 'RESTORE', 'REFRESH', 'DUMMY_LOAD', 'DUMMY_CLEAR', 'EXPORT')),
  pin_id TEXT,
  by_user TEXT NOT NULL,
  at TEXT NOT NULL,
  note TEXT
);
CREATE INDEX pin_admin_log_seq ON pin_admin_log(seq);
