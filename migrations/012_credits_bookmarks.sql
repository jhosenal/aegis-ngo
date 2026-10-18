-- Credits (tokens) and saved places (AEG-CREDIT-001). STUB: no payment provider is connected; "buying" credits adds demo credits and says so.
-- A custom pin check costs credits instead of dollars. The ledger is append-only: the balance is the sum of the rows.
CREATE TABLE credit_ledger (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('STARTER', 'STUB_PURCHASE', 'PIN_LOOKUP')),
  ref TEXT,
  at TEXT NOT NULL
);
CREATE INDEX credit_ledger_user ON credit_ledger(user_id, seq);
CREATE UNIQUE INDEX credit_ledger_starter ON credit_ledger(user_id) WHERE reason = 'STARTER';

-- Saved places keep ONLY a name and coordinates (coordinates may be kept). Air quality and weather values are never saved: Google readings live in memory for one hour.
CREATE TABLE user_bookmarks (
  bookmark_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX user_bookmarks_user ON user_bookmarks(user_id, created_at);
