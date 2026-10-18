-- API switches (owner request 2026-10-18): an administrator can switch a service that is already set up on this server OFF, and back ON, from the Admin Desk, without a restart.
-- A switch can only turn a configured service off or back on; it can never set up a service that has no key or setting (the code refuses). One row per service, the latest change only.
CREATE TABLE api_switch (
  api_id TEXT PRIMARY KEY,
  off INTEGER NOT NULL CHECK (off IN (0, 1)),
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL
);
