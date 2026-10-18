-- AEG migration 001. Forward-only. Money = integer micro-USD. Time = ISO-8601 UTC strings ending in Z. IDs = TEXT.
PRAGMA foreign_keys = ON;

CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);

CREATE TABLE tenants (
  tenant_id  TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  name       TEXT NOT NULL
);
CREATE TABLE users (
  user_id      TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(tenant_id),
  role         TEXT NOT NULL CHECK (role IN ('coordinator','analyst','viewer')),
  display_name TEXT NOT NULL
);
CREATE TABLE sessions (            -- demo auth only (AEGIS_AUTH_MODE=demo). Store sha256(token), never the token.
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(user_id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Public source evidence (tenant_scope IS NULL) or tenant-private evidence.
CREATE TABLE evidence (
  evidence_id             TEXT PRIMARY KEY,
  tenant_scope            TEXT REFERENCES tenants(tenant_id),
  source_id               TEXT NOT NULL,
  source_record_id        TEXT NOT NULL,
  revision                INTEGER NOT NULL CHECK (revision >= 1),
  supersedes_evidence_id  TEXT REFERENCES evidence(evidence_id),
  source_url              TEXT,
  licence_ref             TEXT NOT NULL,
  event_time              TEXT,
  published_at            TEXT,
  fetched_at              TEXT NOT NULL,
  valid_until             TEXT,
  region_id               TEXT,
  raw_artifact_hash       TEXT NOT NULL,
  normalized_payload_hash TEXT NOT NULL,
  adapter_version         TEXT NOT NULL,
  quality_flags_json      TEXT NOT NULL,         -- JSON array of flag strings (see contracts)
  payload_json            TEXT NOT NULL,         -- normalized payload (canonical JSON text)
  synthetic               INTEGER NOT NULL CHECK (synthetic IN (0,1)),
  UNIQUE (source_id, source_record_id, revision)
);
CREATE INDEX idx_evidence_record ON evidence(source_id, source_record_id);

CREATE TABLE source_status (
  source_id       TEXT PRIMARY KEY,
  state           TEXT NOT NULL CHECK (state IN ('OK','UNAVAILABLE','MALFORMED')),
  last_ok_at      TEXT,
  last_attempt_at TEXT NOT NULL,
  detail          TEXT
);

-- Tenant-private synthetic resource records.
CREATE TABLE resources (
  resource_id     TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(tenant_id),
  region_id       TEXT NOT NULL,
  unit_id         TEXT NOT NULL,
  available_units INTEGER NOT NULL CHECK (available_units >= 0),
  reserve_units   INTEGER NOT NULL CHECK (reserve_units >= 0),
  as_of           TEXT NOT NULL,
  synthetic       INTEGER NOT NULL CHECK (synthetic IN (0,1)),
  label           TEXT NOT NULL,
  UNIQUE (tenant_id, region_id, unit_id)
);

CREATE TABLE cards (
  card_id    TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(tenant_id),
  kind       TEXT NOT NULL CHECK (kind IN ('incident','resource','assessment','evidence','note')),
  created_at TEXT NOT NULL
);
CREATE TABLE card_revisions (
  card_id            TEXT NOT NULL REFERENCES cards(card_id),
  revision           INTEGER NOT NULL CHECK (revision >= 1),
  state              TEXT NOT NULL CHECK (state IN ('draft','validated','reviewed','superseded')),
  title              TEXT NOT NULL,
  body_json          TEXT NOT NULL,           -- canonical JSON of CardBody
  evidence_ids_json  TEXT NOT NULL,           -- JSON array
  formulation_ref    TEXT,                    -- e.g. AEG.F.RESOURCE-SHORTFALL/1.0.0
  workflow_run_id    TEXT,
  created_at         TEXT NOT NULL,
  created_by         TEXT NOT NULL,
  PRIMARY KEY (card_id, revision)
);
CREATE TABLE card_links (
  parent_card_id  TEXT NOT NULL,
  parent_revision INTEGER NOT NULL,
  child_card_id   TEXT NOT NULL,
  child_revision  INTEGER NOT NULL,
  relation        TEXT NOT NULL CHECK (relation IN ('input','result','evidence')),
  PRIMARY KEY (parent_card_id, parent_revision, child_card_id, child_revision, relation),
  FOREIGN KEY (parent_card_id, parent_revision) REFERENCES card_revisions(card_id, revision),
  FOREIGN KEY (child_card_id, child_revision)   REFERENCES card_revisions(card_id, revision),
  CHECK (NOT (parent_card_id = child_card_id AND parent_revision = child_revision))
);

-- Pinning keeps a card in the workspace. It NEVER exposes content to a model.
CREATE TABLE pins (
  tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
  user_id   TEXT NOT NULL REFERENCES users(user_id),
  card_id   TEXT NOT NULL REFERENCES cards(card_id),
  pinned_at TEXT NOT NULL,
  PRIMARY KEY (user_id, card_id)
);

CREATE TABLE chat_messages (
  message_id TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(tenant_id),
  user_id    TEXT NOT NULL REFERENCES users(user_id),
  role       TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  text       TEXT NOT NULL,
  route_id   TEXT,
  created_at TEXT NOT NULL
);
-- Explicit attachments: an immutable (card, revision) included in ONE message's request context.
CREATE TABLE chat_attachments (
  message_id TEXT NOT NULL REFERENCES chat_messages(message_id),
  card_id    TEXT NOT NULL,
  revision   INTEGER NOT NULL,
  PRIMARY KEY (message_id, card_id, revision),
  FOREIGN KEY (card_id, revision) REFERENCES card_revisions(card_id, revision)
);

CREATE TABLE workflow_runs (
  run_id              TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(tenant_id),
  workflow_id         TEXT NOT NULL,
  workflow_version    TEXT NOT NULL,
  idempotency_key     TEXT NOT NULL,
  input_snapshot_hash TEXT NOT NULL,
  state               TEXT NOT NULL CHECK (state IN ('pending','running','succeeded','failed','awaiting-input','awaiting-approval')),
  result_card_id      TEXT,
  result_revision     INTEGER,
  error_code          TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE (tenant_id, workflow_id, idempotency_key)
);
CREATE TABLE workflow_steps (
  run_id      TEXT NOT NULL REFERENCES workflow_runs(run_id),
  step_index  INTEGER NOT NULL,
  step_id     TEXT NOT NULL,
  state       TEXT NOT NULL CHECK (state IN ('pending','running','succeeded','failed','awaiting-input','awaiting-approval')),
  started_at  TEXT,
  finished_at TEXT,
  error_code  TEXT,
  PRIMARY KEY (run_id, step_index)
);

-- Append-only audit chain, one chain per (product_id, tenant_id).
CREATE TABLE audit_events (
  event_id      TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL,
  tenant_id     TEXT NOT NULL,
  sequence      INTEGER NOT NULL CHECK (sequence >= 1),
  previous_hash TEXT NOT NULL,
  hash          TEXT NOT NULL,
  body_json     TEXT NOT NULL,                -- canonical JSON of AuditEventBody (hash excluded)
  UNIQUE (product_id, tenant_id, sequence)
);
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;

CREATE TABLE formulation_registry (
  formulation_id TEXT NOT NULL,
  version        TEXT NOT NULL,
  state          TEXT NOT NULL CHECK (state IN ('candidate','tested','active','deprecated')),
  algorithm_hash TEXT NOT NULL,
  spec_json      TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  PRIMARY KEY (formulation_id, version)
);
-- An active version can never change its algorithm or spec. Only a state change (active -> deprecated) is allowed.
CREATE TRIGGER formulation_active_immutable BEFORE UPDATE ON formulation_registry
WHEN OLD.state = 'active' AND (NEW.algorithm_hash <> OLD.algorithm_hash OR NEW.spec_json <> OLD.spec_json OR NEW.version <> OLD.version OR NEW.formulation_id <> OLD.formulation_id)
BEGIN SELECT RAISE(ABORT, 'active formulation is immutable'); END;

CREATE TABLE model_calls (          -- one row per network attempt (stub or live)
  attempt_id        TEXT PRIMARY KEY,
  task_id           TEXT NOT NULL,
  role_id           TEXT NOT NULL,
  provider          TEXT NOT NULL,            -- 'google' | 'reapi' | 'stub-google' | 'stub-reapi'
  is_stub           INTEGER NOT NULL CHECK (is_stub IN (0,1)),
  requested_model   TEXT NOT NULL,
  reported_model    TEXT,
  binding_version   TEXT NOT NULL,
  input_hash        TEXT NOT NULL,
  started_at        TEXT NOT NULL,
  ended_at          TEXT,
  outcome           TEXT NOT NULL,            -- OK | TRANSIENT | TIMEOUT | AUTH | REFUSAL | MALFORMED | BUDGET_DENIED | CIRCUIT_OPEN | ABORTED
  retry_reason      TEXT,
  validation_result TEXT,
  usage_json        TEXT,
  cost_basis        TEXT NOT NULL,            -- 'measured' | 'estimated' | 'unknown' | 'none'
  reservation_id    TEXT
);

CREATE TABLE eval_candidates (       -- REQ-014 boundary: candidates only; nothing here activates itself
  candidate_id   TEXT PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('rule','route','threshold')),
  target_id      TEXT NOT NULL,
  rationale      TEXT NOT NULL,
  examples_json  TEXT NOT NULL,
  state          TEXT NOT NULL CHECK (state IN ('candidate','tested','active','deprecated','rejected')),
  metrics_json   TEXT,
  created_at     TEXT NOT NULL,
  reviewed_by    TEXT
);
CREATE TABLE active_rules (          -- history of activations; rollback = a new row pointing at a prior version
  activation_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id      TEXT NOT NULL,
  candidate_id   TEXT REFERENCES eval_candidates(candidate_id),
  version_label  TEXT NOT NULL,
  activated_at   TEXT NOT NULL,
  activated_by   TEXT NOT NULL,
  reason         TEXT NOT NULL
);
