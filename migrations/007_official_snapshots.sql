-- Official snapshots (AEG-METMY-001): the latest MetMalaysia warnings and district forecasts, one row per CHANGE (payload_hash), so a bulletin can be rebuilt as at its
-- capture time. Not Google data. Licence of the source is recorded as UNVERIFIED (pilot).
CREATE TABLE official_snapshots (
  source_id TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (source_id, fetched_at)
);
CREATE INDEX official_snapshots_latest ON official_snapshots(source_id, fetched_at);
