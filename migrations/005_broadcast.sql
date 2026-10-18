-- Broadcast bulletins (AEG-NEWS-004): one row per slot capture and language. The body holds the fact-sheet hash, the segments and the credits.
-- Only narratable sources feed a bulletin (never Google Maps content), so storing it does not store Google readings.
CREATE TABLE broadcast_bulletins (
  bulletin_id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL,
  language TEXT NOT NULL,
  capture_at TEXT NOT NULL,
  air_at TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  fact_sheet_hash TEXT NOT NULL,
  schedule_version TEXT NOT NULL,
  body_json TEXT NOT NULL,
  UNIQUE (slot_id, capture_at, language)
);
CREATE INDEX broadcast_bulletins_latest ON broadcast_bulletins(language, capture_at);
