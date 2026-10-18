// Runtime on/off switches for the outside services an administrator may pause (owner request 2026-10-18).
// A switch only turns a service that is already configured off, or back on. It never creates a service: a service with no key or setting cannot be switched on from the page.
// The gate is applied once, in createApp: a switched-off service is simply absent for every route (`deps.tts` is undefined, and so on), exactly as if it had never been set up.
import type { Database } from 'better-sqlite3';
import { AegisError } from '../engine/errors.js';
import type { AppDeps } from '../api/server.js';

/** The services that have a switch, and the AppDeps field each one controls. */
export const SWITCHABLE = {
  'vertex-argon': 'reviewer',
  translation: 'translator',
  tts: 'tts',
  'billing-export': 'billing',
  'google-on-demand': 'envOnDemand',
} as const;
export type SwitchId = keyof typeof SWITCHABLE;
export const isSwitchId = (id: unknown): id is SwitchId => typeof id === 'string' && Object.prototype.hasOwnProperty.call(SWITCHABLE, id);

export interface SwitchRow { apiId: string; off: boolean; changedBy: string; changedAt: string }

export function listSwitches(db: Database): Record<string, SwitchRow> {
  let rows: { api_id: string; off: number; changed_by: string; changed_at: string }[] = [];
  try { rows = db.prepare('SELECT api_id, off, changed_by, changed_at FROM api_switch').all() as typeof rows; } catch { return {}; }
  return Object.fromEntries(rows.map((r) => [r.api_id, { apiId: r.api_id, off: r.off === 1, changedBy: r.changed_by, changedAt: r.changed_at }]));
}
/** A database that does not have the table yet (not migrated) has no switches, so nothing is switched off. */
export function isSwitchedOff(db: Database, id: string): boolean {
  try { return (db.prepare('SELECT off FROM api_switch WHERE api_id = ?').get(id) as { off: number } | undefined)?.off === 1; } catch { return false; }
}

/** Turns a configured service off (`on` false) or back on (`on` true). Refuses an unknown id and a service that is not set up on this server. */
export function setSwitch(db: Database, raw: AppDeps, id: unknown, on: boolean, by: string, atIso: string): SwitchRow {
  if (!isSwitchId(id)) throw new AegisError('E_VALIDATION', 'That service has no switch.');
  if (raw[SWITCHABLE[id]] == null) throw new AegisError('E_VALIDATION', 'That service is not set up on this server, so there is nothing to switch. Set it up first (its setting is shown on the row).');
  db.prepare('INSERT INTO api_switch (api_id, off, changed_by, changed_at) VALUES (?, ?, ?, ?) ON CONFLICT(api_id) DO UPDATE SET off = excluded.off, changed_by = excluded.changed_by, changed_at = excluded.changed_at').run(id, on ? 0 : 1, by, atIso);
  return { apiId: id, off: !on, changedBy: by, changedAt: atIso };
}

/** A copy of the app's deps in which each switchable service reads as absent while it is switched off. `unswitched` keeps the real services for the status page. */
export function withSwitches(raw: AppDeps): AppDeps & { unswitched: AppDeps } {
  const gated = { ...raw } as AppDeps & { unswitched: AppDeps };
  for (const [id, field] of Object.entries(SWITCHABLE)) {
    Object.defineProperty(gated, field, { enumerable: true, configurable: true, get: () => (isSwitchedOff(raw.db, id) ? undefined : raw[field as keyof typeof raw]) });
  }
  Object.defineProperty(gated, 'unswitched', { enumerable: false, value: raw });
  return gated;
}
