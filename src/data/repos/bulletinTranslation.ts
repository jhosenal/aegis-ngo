import type { Db } from '../db.js';

export type TranslationStatus = 'UNREVIEWED' | 'APPROVED' | 'REJECTED';
export interface Translation {
  bulletinId: string; language: string; texts: string[]; back: string[]; problems: string[]; modelTranslate: string; modelBack: string;
  status: TranslationStatus; madeBy: string; madeAt: string; reviewedBy: string | null; reviewedAt: string | null; reviewNote: string | null;
  /** The memory pieces this translation was built from (hash and where each came from: approved, machine or fresh). */
  memory: { hash: string; origin: string }[];
}
type Row = { bulletin_id: string; language: string; texts_json: string; back_json: string; problems_json: string; model_translate: string; model_back: string; status: TranslationStatus; made_by: string; made_at: string; reviewed_by: string | null; reviewed_at: string | null; review_note: string | null; memory_json: string };
const toOut = (r: Row): Translation => ({ bulletinId: r.bulletin_id, language: r.language, texts: JSON.parse(r.texts_json) as string[], back: JSON.parse(r.back_json) as string[], problems: JSON.parse(r.problems_json) as string[],
  modelTranslate: r.model_translate, modelBack: r.model_back, status: r.status, madeBy: r.made_by, madeAt: r.made_at, reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at, reviewNote: r.review_note, memory: JSON.parse(r.memory_json) as { hash: string; origin: string }[] });

export function logTranslation(db: Db, e: { bulletinId: string; language: string; action: 'TRANSLATE' | 'APPROVE' | 'REJECT'; by: string; at: string; note: string | null }): void {
  db.prepare('INSERT INTO bulletin_translation_log (bulletin_id, language, action, by_user, at, note) VALUES (?, ?, ?, ?, ?, ?)').run(e.bulletinId, e.language, e.action, e.by, e.at, e.note);
}
export function translationLog(db: Db, bulletinId: string): { seq: number; language: string; action: string; by: string; at: string; note: string | null }[] {
  return (db.prepare('SELECT * FROM bulletin_translation_log WHERE bulletin_id = ? ORDER BY seq').all(bulletinId) as { seq: number; language: string; action: string; by_user: string; at: string; note: string | null }[])
    .map((r) => ({ seq: r.seq, language: r.language, action: r.action, by: r.by_user, at: r.at, note: r.note }));
}

/** A new translation replaces the old one and starts UNREVIEWED; an APPROVED one is never replaced (reject it first). */
export function saveTranslation(db: Db, t: { bulletinId: string; language: string; texts: string[]; back: string[]; problems: string[]; modelTranslate: string; modelBack: string; memory?: { hash: string; origin: string }[]; by: string; at: string }): void {
  db.prepare(`INSERT INTO bulletin_translation (bulletin_id, language, texts_json, back_json, problems_json, model_translate, model_back, status, made_by, made_at, reviewed_by, reviewed_at, review_note, memory_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'UNREVIEWED', ?, ?, NULL, NULL, NULL, ?)
    ON CONFLICT(bulletin_id, language) DO UPDATE SET texts_json = excluded.texts_json, back_json = excluded.back_json, problems_json = excluded.problems_json, model_translate = excluded.model_translate, model_back = excluded.model_back,
      status = 'UNREVIEWED', made_by = excluded.made_by, made_at = excluded.made_at, reviewed_by = NULL, reviewed_at = NULL, review_note = NULL, memory_json = excluded.memory_json`)
    .run(t.bulletinId, t.language, JSON.stringify(t.texts), JSON.stringify(t.back), JSON.stringify(t.problems), t.modelTranslate, t.modelBack, t.by, t.at, JSON.stringify(t.memory ?? []));
}
export function getTranslation(db: Db, bulletinId: string, language: string): Translation | null {
  const r = db.prepare('SELECT * FROM bulletin_translation WHERE bulletin_id = ? AND language = ?').get(bulletinId, language) as Row | undefined; return r ? toOut(r) : null;
}
export function listTranslations(db: Db, bulletinId: string): Translation[] {
  return (db.prepare('SELECT * FROM bulletin_translation WHERE bulletin_id = ? ORDER BY language').all(bulletinId) as Row[]).map(toOut);
}
export function reviewTranslation(db: Db, p: { bulletinId: string; language: string; status: 'APPROVED' | 'REJECTED'; by: string; at: string; note: string | null }): void {
  db.prepare('UPDATE bulletin_translation SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE bulletin_id = ? AND language = ?').run(p.status, p.by, p.at, p.note, p.bulletinId, p.language);
}

export function saveVoiceMl(db: Db, v: { bulletinId: string; language: string; mime: string; audio: Buffer; voice: string; characters: number; by: string; at: string }): void {
  db.prepare(`INSERT INTO bulletin_voice_ml (bulletin_id, language, mime, audio, voice, characters, made_by, made_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bulletin_id, language) DO UPDATE SET mime = excluded.mime, audio = excluded.audio, voice = excluded.voice, characters = excluded.characters, made_by = excluded.made_by, made_at = excluded.made_at`).run(v.bulletinId, v.language, v.mime, v.audio, v.voice, v.characters, v.by, v.at);
}
export function getVoiceMl(db: Db, bulletinId: string, language: string): { mime: string; audio: Buffer; voice: string; characters: number; madeAt: string } | null {
  const r = db.prepare('SELECT * FROM bulletin_voice_ml WHERE bulletin_id = ? AND language = ?').get(bulletinId, language) as { mime: string; audio: Buffer; voice: string; characters: number; made_at: string } | undefined;
  return r ? { mime: r.mime, audio: r.audio, voice: r.voice, characters: r.characters, madeAt: r.made_at } : null;
}
export function voiceLanguages(db: Db, bulletinId: string): string[] {
  return (db.prepare('SELECT language FROM bulletin_voice_ml WHERE bulletin_id = ? ORDER BY language').all(bulletinId) as { language: string }[]).map((r) => r.language);
}

/** Translation memory: one sentence-sized piece and its translation. */
export function getMemory(db: Db, language: string, hash: string): { target: string; back: string; status: 'MACHINE' | 'APPROVED' | 'REJECTED'; modelTranslate: string; modelBack: string } | null {
  const r = db.prepare('SELECT target_text, back_text, status, model_translate, model_back FROM translation_memory WHERE language = ? AND source_hash = ?').get(language, hash) as { target_text: string; back_text: string; status: 'MACHINE' | 'APPROVED' | 'REJECTED'; model_translate: string; model_back: string } | undefined;
  return r ? { target: r.target_text, back: r.back_text, status: r.status, modelTranslate: r.model_translate, modelBack: r.model_back } : null;
}
/** New pieces enter as MACHINE (a model made them, nobody has read them). An existing piece is never overwritten here. */
export function putMemory(db: Db, language: string, entries: { hash: string; source: string; target: string; back: string; modelTranslate: string; modelBack: string; at: string }[]): void {
  const st = db.prepare("INSERT OR IGNORE INTO translation_memory (language, source_hash, source_text, target_text, back_text, status, model_translate, model_back, made_at) VALUES (?, ?, ?, ?, ?, 'MACHINE', ?, ?, ?)");
  for (const e of entries) st.run(language, e.hash, e.source, e.target, e.back, e.modelTranslate, e.modelBack, e.at);
}
/** A person who reads the language approved a bulletin translation: its pieces become APPROVED and are reused as such. */
export function approveMemory(db: Db, language: string, hashes: string[], by: string, at: string): void {
  const st = db.prepare("UPDATE translation_memory SET status = 'APPROVED', approved_by = ?, approved_at = ? WHERE language = ? AND source_hash = ? AND status <> 'REJECTED'");
  for (const h of hashes) st.run(by, at, language, h);
}
/** A rejected translation's machine pieces are never reused (approved pieces stay approved). */
export function rejectMemory(db: Db, language: string, hashes: string[]): void {
  const st = db.prepare("UPDATE translation_memory SET status = 'REJECTED' WHERE language = ? AND source_hash = ? AND status = 'MACHINE'");
  for (const h of hashes) st.run(language, h);
}
export function memoryStats(db: Db): { language: string; status: string; n: number }[] {
  return db.prepare('SELECT language, status, COUNT(*) AS n FROM translation_memory GROUP BY language, status ORDER BY language, status').all() as { language: string; status: string; n: number }[];
}
