-- Screening room (AEG-NEWS-005): an administrator approves or holds each stored bulletin before the public page shows it.
CREATE TABLE broadcast_reviews (
  bulletin_id TEXT PRIMARY KEY REFERENCES broadcast_bulletins(bulletin_id),
  decision TEXT NOT NULL CHECK (decision IN ('APPROVED', 'HELD')),
  decided_by TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  note TEXT
);
