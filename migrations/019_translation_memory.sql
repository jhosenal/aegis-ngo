-- Translation memory (AEG-NEWS-007): every sentence-sized piece of a bulletin that was translated is kept with its translation, so the official guidance lines (the same in every bulletin of a hazard) are
-- translated and read by a person ONCE, then reused instantly: only the new event sentence is translated at emergency time. MACHINE = made by the model, not yet read by a person; APPROVED = a person who reads
-- the language approved a bulletin translation that contained it; REJECTED = never reused. The source text is public bulletin text (no Google air or weather values).
CREATE TABLE translation_memory (
  language TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  source_text TEXT NOT NULL,
  target_text TEXT NOT NULL,
  back_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('MACHINE', 'APPROVED', 'REJECTED')),
  model_translate TEXT NOT NULL,
  model_back TEXT NOT NULL,
  made_at TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  PRIMARY KEY (language, source_hash)
);
ALTER TABLE bulletin_translation ADD COLUMN memory_json TEXT NOT NULL DEFAULT '[]';
