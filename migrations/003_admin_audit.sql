-- AEG migration 003. Forward-only. Account privilege changes are audited, and an administrator's explicit change locks the account
-- against the owner's bootstrap email lists (S0038 finding 4): once an administrator or the admin tool has set a flag, sign-in no longer re-grants it.
ALTER TABLE users ADD COLUMN flags_locked INTEGER NOT NULL DEFAULT 0 CHECK (flags_locked IN (0,1));
CREATE TABLE admin_audit (
  audit_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  at        TEXT NOT NULL,
  actor     TEXT NOT NULL,        -- a user id, 'bootstrap-list' (owner email lists at sign-in) or 'cli' (tools/users.ts)
  target    TEXT NOT NULL,
  before_plan TEXT NOT NULL,
  before_admin INTEGER NOT NULL,
  after_plan  TEXT NOT NULL,
  after_admin INTEGER NOT NULL
);
