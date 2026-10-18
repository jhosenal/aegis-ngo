// The broadcast schedule (AEG-NEWS-004): ONE file, content/broadcast/schedule.json, read by the generator, the scheduler, the Admin Desk and the
// legal notice, so a time or a source list is never typed twice. UTC times are derived from the local time and the offset, never typed.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const Schema = z.object({
  version: z.string().min(3),
  timezone: z.object({ name: z.string().min(3), utcOffsetHours: z.number().int().min(-12).max(14) }).strict(),
  captureLeadMinutes: z.number().int().min(15).max(240),
  slots: z.array(z.object({ id: z.string().regex(/^[a-z]+$/), airLocal: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), greeting: z.string().min(3) }).strict()).min(1),
  coverage: z.object({ countries: z.array(z.string().regex(/^[A-Z]{3}$/)).min(1), note: z.string().min(10) }).strict(),
  languages: z.array(z.object({ code: z.string().regex(/^[a-z]{2}$/), label: z.string().min(2), state: z.enum(['active', 'locked']) }).strict()).min(1),
  narratedSources: z.array(z.object({ sourceId: z.string().min(3), name: z.string().min(3), credit: z.string().min(10), licence: z.string().min(3) }).strict()).min(1),
  neverNarrated: z.array(z.object({ name: z.string().min(3), reason: z.string().min(20) }).strict()),
  disclosure: z.object({ presenter: z.string(), voice: z.string(), pilot: z.string() }).strict(),
  /** Which MetMalaysia districts the Malaysia segment reads out, and from which local hour the forecast for TOMORROW is used instead of today's. */
  metMalaysia: z.object({ keyLocations: z.array(z.string().min(2)).min(1), tomorrowFromLocalHour: z.number().int().min(12).max(23) }).strict(),
}).strict();
export type BroadcastSchedule = z.infer<typeof Schema>;

const file = fileURLToPath(new URL('../../../content/broadcast/schedule.json', import.meta.url));
export const loadSchedule = (path = file): BroadcastSchedule => Schema.parse(JSON.parse(readFileSync(path, 'utf8')));

const pad = (n: number): string => String(n).padStart(2, '0');
const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const clock = (minutes: number): string => { const m = ((minutes % 1440) + 1440) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };

export interface SlotTimes { id: string; greeting: string; airLocal: string; captureLocal: string; airUtc: string; captureUtc: string }
export function slotTimes(schedule: BroadcastSchedule): SlotTimes[] {
  const offset = schedule.timezone.utcOffsetHours * 60;
  return schedule.slots.map((s) => {
    const air = minutesOf(s.airLocal);
    const capture = air - schedule.captureLeadMinutes;
    return { id: s.id, greeting: s.greeting, airLocal: s.airLocal, captureLocal: clock(capture), airUtc: clock(air - offset), captureUtc: clock(capture - offset) };
  });
}

/** The next capture instant strictly after `nowIso`, with the slot it belongs to. The air instant is the capture plus the lead. */
export function nextCapture(schedule: BroadcastSchedule, nowIso: string): { slot: SlotTimes; captureAt: string; airAt: string } {
  const now = Date.parse(nowIso);
  const times = slotTimes(schedule);
  let best: { slot: SlotTimes; at: number } | null = null;
  for (const day of [0, 1]) {
    const base = Date.parse(`${nowIso.slice(0, 10)}T00:00:00Z`) + day * 86_400_000;
    for (const slot of times) {
      const at = base + minutesOf(slot.captureUtc) * 60_000;
      if (at > now && (best === null || at < best.at)) best = { slot, at };
    }
  }
  if (!best) throw new Error('no capture slot');
  return { slot: best.slot, captureAt: new Date(best.at).toISOString(), airAt: new Date(best.at + schedule.captureLeadMinutes * 60_000).toISOString() };
}

/** The slot whose capture instant is the latest one at or before `nowIso` (today or yesterday). */
export function latestCapture(schedule: BroadcastSchedule, nowIso: string): { slot: SlotTimes; captureAt: string; airAt: string } {
  const now = Date.parse(nowIso);
  let best: { slot: SlotTimes; at: number } | null = null;
  for (const day of [-1, 0]) {
    const base = Date.parse(`${nowIso.slice(0, 10)}T00:00:00Z`) + day * 86_400_000;
    for (const slot of slotTimes(schedule)) {
      const at = base + minutesOf(slot.captureUtc) * 60_000;
      if (at <= now && (best === null || at > best.at)) best = { slot, at };
    }
  }
  if (!best) throw new Error('no capture slot');
  return { slot: best.slot, captureAt: new Date(best.at).toISOString(), airAt: new Date(best.at + schedule.captureLeadMinutes * 60_000).toISOString() };
}

/** The next air instant (not the capture) strictly after `nowIso`: the Google air and weather refresh runs at these four times. */
export function nextAir(schedule: BroadcastSchedule, nowIso: string): { slot: SlotTimes; at: string } {
  const now = Date.parse(nowIso);
  let best: { slot: SlotTimes; at: number } | null = null;
  for (const day of [0, 1]) {
    const base = Date.parse(`${nowIso.slice(0, 10)}T00:00:00Z`) + day * 86_400_000;
    for (const slot of slotTimes(schedule)) {
      const at = base + minutesOf(slot.airUtc) * 60_000;
      if (at > now && (best === null || at < best.at)) best = { slot, at };
    }
  }
  if (!best) throw new Error('no air slot');
  return { slot: best.slot, at: new Date(best.at).toISOString() };
}

/** The latest air instant at or before `nowIso`. */
export function latestAir(schedule: BroadcastSchedule, nowIso: string): { slot: SlotTimes; at: string } {
  const now = Date.parse(nowIso);
  let best: { slot: SlotTimes; at: number } | null = null;
  for (const day of [-1, 0]) {
    const base = Date.parse(`${nowIso.slice(0, 10)}T00:00:00Z`) + day * 86_400_000;
    for (const slot of slotTimes(schedule)) {
      const at = base + minutesOf(slot.airUtc) * 60_000;
      if (at <= now && (best === null || at > best.at)) best = { slot, at };
    }
  }
  if (!best) throw new Error('no air slot');
  return { slot: best.slot, at: new Date(best.at).toISOString() };
}

/** Milliseconds from `nowIso` until the next occurrence of a local HH:MM (in the schedule's timezone); null for a malformed time. Used for one-off test runs. */
export function msUntilLocalTime(nowIso: string, hhmm: string, utcOffsetHours: number): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return null;
  const localNow = Date.parse(nowIso) + utcOffsetHours * 3_600_000;
  const dayStart = Math.floor(localNow / 86_400_000) * 86_400_000;
  let target = dayStart + (Number(m[1]) * 60 + Number(m[2])) * 60_000;
  if (target <= localNow) target += 86_400_000;
  return target - localNow;
}
