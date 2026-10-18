-- Translations of a bulletin and their human review (AEG-NEWS-007). A model translates the validated English script; code checks numbers and names; a second model translates it back for the reviewer;
-- a person who reads the language approves or rejects it. Nothing translated is public without that approval. The log is append-only. Voice per language lives in bulletin_voice_ml.
CREATE TABLE bulletin_translation (
  bulletin_id TEXT NOT NULL REFERENCES broadcast_bulletins(bulletin_id),
  language TEXT NOT NULL,
  texts_json TEXT NOT NULL,
  back_json TEXT NOT NULL,
  problems_json TEXT NOT NULL,
  model_translate TEXT NOT NULL,
  model_back TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('UNREVIEWED', 'APPROVED', 'REJECTED')),
  made_by TEXT NOT NULL,
  made_at TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  PRIMARY KEY (bulletin_id, language)
);
CREATE TABLE bulletin_translation_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  bulletin_id TEXT NOT NULL REFERENCES broadcast_bulletins(bulletin_id),
  language TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('TRANSLATE', 'APPROVE', 'REJECT')),
  by_user TEXT NOT NULL,
  at TEXT NOT NULL,
  note TEXT
);
CREATE INDEX bulletin_translation_log_bulletin ON bulletin_translation_log(bulletin_id, seq);
CREATE TRIGGER bulletin_translation_log_no_update BEFORE UPDATE ON bulletin_translation_log BEGIN SELECT RAISE(ABORT, 'bulletin_translation_log is append-only'); END;
CREATE TRIGGER bulletin_translation_log_no_delete BEFORE DELETE ON bulletin_translation_log BEGIN SELECT RAISE(ABORT, 'bulletin_translation_log is append-only'); END;
CREATE TABLE bulletin_voice_ml (
  bulletin_id TEXT NOT NULL REFERENCES broadcast_bulletins(bulletin_id),
  language TEXT NOT NULL,
  mime TEXT NOT NULL,
  audio BLOB NOT NULL,
  voice TEXT NOT NULL,
  characters INTEGER NOT NULL,
  made_by TEXT NOT NULL,
  made_at TEXT NOT NULL,
  PRIMARY KEY (bulletin_id, language)
);
