-- Screening log (AEG-NEWS-005): every approve, hold and withdraw of a bulletin, append-only, so a decision is never overwritten without a trace.
CREATE TABLE broadcast_review_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  bulletin_id TEXT NOT NULL REFERENCES broadcast_bulletins(bulletin_id),
  action TEXT NOT NULL CHECK (action IN ('APPROVE', 'HOLD', 'WITHDRAW')),
  by_user TEXT NOT NULL,
  at TEXT NOT NULL,
  note TEXT
);
CREATE INDEX broadcast_review_log_bulletin ON broadcast_review_log(bulletin_id, seq);
