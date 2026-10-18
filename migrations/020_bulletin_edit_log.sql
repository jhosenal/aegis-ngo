-- Script edits (AEG-NEWS-007): an administrator may reword a bulletin's English script BEFORE approving it. Code still owns the facts: an edit may not add a number or an acronym/name the original
-- segment did not have, the official "what to do" and notice segments cannot be edited, and an approved bulletin is locked. Every change is kept here (append-only) with the text before and after.
-- An edit clears the bulletin's translations and voice, because they were made from the old words.
CREATE TABLE bulletin_edit_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  bulletin_id TEXT NOT NULL REFERENCES broadcast_bulletins(bulletin_id),
  segment_id TEXT NOT NULL,
  before_text TEXT NOT NULL,
  after_text TEXT NOT NULL,
  by_user TEXT NOT NULL,
  at TEXT NOT NULL,
  note TEXT
);
CREATE INDEX bulletin_edit_log_bulletin ON bulletin_edit_log(bulletin_id, seq);
