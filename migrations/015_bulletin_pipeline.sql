-- News pipeline (AEG-NEWS-007): the plan for each bulletin (daily or emergency; voice only, or voice then presenter) and the production steps that follow review
-- (voice, presenter). Steps are append-only, like the review log, so the timeline of a bulletin cannot be rewritten afterwards.
CREATE TABLE bulletin_plan (
  bulletin_id TEXT PRIMARY KEY REFERENCES broadcast_bulletins(bulletin_id),
  scenario TEXT NOT NULL CHECK (scenario IN ('daily', 'emergency')),
  output TEXT NOT NULL CHECK (output IN ('voice', 'voice_presenter')),
  languages TEXT NOT NULL DEFAULT '["en"]',   -- ticked languages (JSON array of codes); English is always there, the others are locked stubs
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL
);
CREATE TABLE bulletin_step (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  bulletin_id TEXT NOT NULL REFERENCES broadcast_bulletins(bulletin_id),
  step TEXT NOT NULL CHECK (step IN ('VOICE_REQUESTED', 'VOICE_READY', 'PRESENTER_REQUESTED', 'PRESENTER_READY')),
  at TEXT NOT NULL,
  by_user TEXT NOT NULL,
  mode TEXT NOT NULL,
  note TEXT
);
CREATE INDEX bulletin_step_bulletin ON bulletin_step(bulletin_id, seq);
CREATE TRIGGER bulletin_step_no_update BEFORE UPDATE ON bulletin_step BEGIN SELECT RAISE(ABORT, 'bulletin_step is append-only'); END;
CREATE TRIGGER bulletin_step_no_delete BEFORE DELETE ON bulletin_step BEGIN SELECT RAISE(ABORT, 'bulletin_step is append-only'); END;
