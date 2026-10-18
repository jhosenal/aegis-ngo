import type { Db } from '../db.js';

export type Scenario = 'daily' | 'emergency';
export type Output = 'voice' | 'voice_presenter';
export type StepName = 'VOICE_REQUESTED' | 'VOICE_READY' | 'PRESENTER_REQUESTED' | 'PRESENTER_READY';
export interface Plan { scenario: Scenario; output: Output; languages: string[]; explicit: boolean; setBy: string | null; setAt: string | null }
export interface Step { seq: number; step: StepName; at: string; by: string; mode: string; note: string | null }

/** The plan of a bulletin. Without a stored choice: an emergency bulletin is voice only, a daily one is voice then presenter. */
export function getPlan(db: Db, bulletinId: string, slotId: string): Plan {
  const r = db.prepare('SELECT * FROM bulletin_plan WHERE bulletin_id = ?').get(bulletinId) as { scenario: Scenario; output: Output; languages: string; set_by: string; set_at: string } | undefined;
  if (r) return { scenario: r.scenario, output: r.output, languages: JSON.parse(r.languages) as string[], explicit: true, setBy: r.set_by, setAt: r.set_at };
  const scenario: Scenario = slotId === 'emergency' || slotId === 'drill' ? 'emergency' : 'daily';
  return { scenario, output: scenario === 'emergency' ? 'voice' : 'voice_presenter', languages: ['en'], explicit: false, setBy: null, setAt: null };
}

export function setPlan(db: Db, p: { bulletinId: string; scenario: Scenario; output: Output; languages?: string[]; by: string; at: string }): void {
  db.prepare(`INSERT INTO bulletin_plan (bulletin_id, scenario, output, languages, set_by, set_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(bulletin_id) DO UPDATE SET output = excluded.output, languages = excluded.languages, set_by = excluded.set_by, set_at = excluded.set_at`).run(p.bulletinId, p.scenario, p.output, JSON.stringify(p.languages ?? ['en']), p.by, p.at);
}

export function addStep(db: Db, s: { bulletinId: string; step: StepName; at: string; by: string; mode: string; note: string | null }): void {
  db.prepare('INSERT INTO bulletin_step (bulletin_id, step, at, by_user, mode, note) VALUES (?, ?, ?, ?, ?, ?)').run(s.bulletinId, s.step, s.at, s.by, s.mode, s.note);
}

export function listSteps(db: Db, bulletinId: string): Step[] {
  return (db.prepare('SELECT * FROM bulletin_step WHERE bulletin_id = ? ORDER BY seq').all(bulletinId) as { seq: number; step: StepName; at: string; by_user: string; mode: string; note: string | null }[])
    .map((r) => ({ seq: r.seq, step: r.step, at: r.at, by: r.by_user, mode: r.mode, note: r.note }));
}

export interface VoiceRow { mime: string; audio: Buffer; voice: string; characters: number; madeBy: string; madeAt: string }
export function saveVoice(db: Db, v: { bulletinId: string; mime: string; audio: Buffer; voice: string; characters: number; by: string; at: string }): void {
  db.prepare(`INSERT INTO bulletin_voice (bulletin_id, mime, audio, voice, characters, made_by, made_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bulletin_id) DO UPDATE SET mime = excluded.mime, audio = excluded.audio, voice = excluded.voice, characters = excluded.characters, made_by = excluded.made_by, made_at = excluded.made_at`).run(v.bulletinId, v.mime, v.audio, v.voice, v.characters, v.by, v.at);
}
export function getVoice(db: Db, bulletinId: string): VoiceRow | null {
  const r = db.prepare('SELECT * FROM bulletin_voice WHERE bulletin_id = ?').get(bulletinId) as { mime: string; audio: Buffer; voice: string; characters: number; made_by: string; made_at: string } | undefined;
  return r ? { mime: r.mime, audio: r.audio, voice: r.voice, characters: r.characters, madeBy: r.made_by, madeAt: r.made_at } : null;
}
