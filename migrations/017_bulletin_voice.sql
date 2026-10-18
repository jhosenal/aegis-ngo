-- Voice of an approved bulletin (AEG-NEWS-007): the MP3 that Google Cloud Text-to-Speech made from the validated script. The script holds no Google air or weather values, so storing the audio does not store them.
-- One row per bulletin; it can only be added by an administrator after approval, and it is served to the public only while the bulletin is approved.
CREATE TABLE bulletin_voice (
  bulletin_id TEXT PRIMARY KEY REFERENCES broadcast_bulletins(bulletin_id),
  mime TEXT NOT NULL,
  audio BLOB NOT NULL,
  voice TEXT NOT NULL,
  characters INTEGER NOT NULL,
  made_by TEXT NOT NULL,
  made_at TEXT NOT NULL
);
