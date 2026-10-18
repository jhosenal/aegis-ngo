// The pins the app monitors = the owner-supplied fixture registry, minus pins an administrator deleted, plus pins an administrator added (AEG-DATA-001).
// Edits live in the database (migration 013); the fixture file is never rewritten. Everything here is coordinates and descriptions: no reading is kept.
import type { Db } from '../data/db.js';
import { coverageOf, type CoverageCountry } from '../domains/coverage.js';
import { cellKey, type EnvPin, type PinRegistry } from '../sources/pinRegistry.js';
import { AegisError } from '../engine/errors.js';

export interface CatalogPin extends EnvPin { origin: 'fixture' | 'admin'; removed: boolean }
export type PinLogAction = 'ADD' | 'DELETE' | 'RESTORE' | 'REFRESH' | 'DUMMY_LOAD' | 'DUMMY_CLEAR' | 'EXPORT';
export interface PinLogEntry { seq: number; action: PinLogAction; pinId: string | null; by: string; at: string; note: string | null }
export interface NewPin { name: string; country: string; region: string; lat: number; lng: number; roles?: string[]; hazards?: string[]; needs?: string[] }
export const MAX_PINS = 300;

export class PinCatalog {
  constructor(private readonly db: Db, private readonly base: PinRegistry) {}

  private rows(): { pin_id: string; kind: 'ADD' | 'DELETE'; payload_json: string | null }[] {
    return this.db.prepare('SELECT pin_id, kind, payload_json FROM pin_overrides ORDER BY at, pin_id').all() as { pin_id: string; kind: 'ADD' | 'DELETE'; payload_json: string | null }[];
  }

  /** Every pin, deleted ones included (flagged), in registry order, administrator pins last. */
  all(): CatalogPin[] {
    const rows = this.rows();
    const deleted = new Set(rows.filter((r) => r.kind === 'DELETE').map((r) => r.pin_id));
    const added = rows.filter((r) => r.kind === 'ADD' && r.payload_json).map((r) => JSON.parse(r.payload_json as string) as EnvPin);
    return [
      ...this.base.pins.map((p): CatalogPin => ({ ...p, origin: 'fixture', removed: deleted.has(p.pinId) })),
      ...added.map((p): CatalogPin => ({ ...p, origin: 'admin', removed: false })),
    ];
  }

  /** The active pins only (what the map, the refresh timers and the scans use). */
  pins(): EnvPin[] { return this.all().filter((p) => !p.removed).map(({ origin: _o, removed: _r, ...pin }) => pin); }
  registry(): PinRegistry { return { ...this.base, pins: this.pins() }; }
  get(pinId: string): CatalogPin | undefined { return this.all().find((p) => p.pinId === pinId); }

  add(input: NewPin, by: string, at: string): EnvPin {
    const name = String(input.name ?? '').trim(); const region = String(input.region ?? '').trim();
    const lat = Number(input.lat); const lng = Number(input.lng);
    if (name.length < 1 || name.length > 120) throw new AegisError('E_VALIDATION', 'Give the pin a name (up to 120 characters).');
    if (region.length < 1 || region.length > 60) throw new AegisError('E_VALIDATION', 'Give the state or region (up to 60 characters).');
    if (!['SG', 'MY', 'BN'].includes(input.country)) throw new AegisError('E_VALIDATION', 'Country must be SG, MY or BN.');
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new AegisError('E_VALIDATION', 'Latitude and longitude must be numbers.');
    const found: CoverageCountry | null = coverageOf(lat, lng);
    if (found !== input.country) throw new AegisError('E_VALIDATION', `These coordinates are not inside the ${input.country} area (rough check: ${found ?? 'outside Singapore, Malaysia and Brunei'}).`);
    const roles = (input.roles ?? ['general']).filter((r) => r === 'general' || r === 'hazard') as ('general' | 'hazard')[];
    const needs = (input.needs ?? ['air', 'weather']).filter((n) => n === 'air' || n === 'weather') as ('air' | 'weather')[];
    if (roles.length === 0 || needs.length === 0) throw new AegisError('E_VALIDATION', 'Choose at least one role and one data need.');
    const active = this.pins();
    if (active.length >= MAX_PINS) throw new AegisError('E_VALIDATION', `The catalog is full (${MAX_PINS} pins).`);
    const key = cellKey(lat, lng);
    const clash = active.find((p) => cellKey(p.lat, p.lng) === key);
    if (clash) throw new AegisError('E_VALIDATION', `${clash.name} (${clash.pinId}) is already within 500 m of this point; open it instead.`);
    const used = (this.db.prepare("SELECT COUNT(*) AS n FROM pin_admin_log WHERE action = 'ADD'").get() as { n: number }).n;
    const pin: EnvPin = { pinId: `ap-${String(used + 1).padStart(3, '0')}`, country: input.country as 'SG' | 'MY' | 'BN', region, name, lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5, roles, hazards: (input.hazards ?? []).map((h) => String(h).slice(0, 120)).slice(0, 10), needs, mergedFrom: [], review: 'Added by an administrator; not yet checked against the owner\'s pin list.' };
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO pin_overrides (pin_id, kind, payload_json, by_user, at) VALUES (?, 'ADD', ?, ?, ?)").run(pin.pinId, JSON.stringify(pin), by, at);
      this.log('ADD', pin.pinId, by, at, `${pin.name} (${pin.country}, ${pin.region})`);
    })();
    return pin;
  }

  /** An administrator pin is removed for good; a fixture pin gets a tombstone and can be restored. */
  remove(pinId: string, by: string, at: string): void {
    const pin = this.get(pinId);
    if (!pin || pin.removed) throw new AegisError('E_NOT_FOUND');
    this.db.transaction(() => {
      if (pin.origin === 'admin') this.db.prepare("DELETE FROM pin_overrides WHERE pin_id = ? AND kind = 'ADD'").run(pinId);
      else this.db.prepare("INSERT OR REPLACE INTO pin_overrides (pin_id, kind, payload_json, by_user, at) VALUES (?, 'DELETE', NULL, ?, ?)").run(pinId, by, at);
      this.log('DELETE', pinId, by, at, pin.name);
    })();
  }

  restore(pinId: string, by: string, at: string): void {
    const pin = this.get(pinId);
    if (!pin || !pin.removed) throw new AegisError('E_NOT_FOUND');
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM pin_overrides WHERE pin_id = ? AND kind = 'DELETE'").run(pinId);
      this.log('RESTORE', pinId, by, at, pin.name);
    })();
  }

  log(action: PinLogAction, pinId: string | null, by: string, at: string, note: string | null): void {
    this.db.prepare('INSERT INTO pin_admin_log (action, pin_id, by_user, at, note) VALUES (?, ?, ?, ?, ?)').run(action, pinId, by, at, note);
  }

  history(limit = 50): PinLogEntry[] {
    return (this.db.prepare('SELECT * FROM pin_admin_log ORDER BY seq DESC LIMIT ?').all(limit) as { seq: number; action: PinLogAction; pin_id: string | null; by_user: string; at: string; note: string | null }[])
      .map((r) => ({ seq: r.seq, action: r.action, pinId: r.pin_id, by: r.by_user, at: r.at, note: r.note }));
  }
}
