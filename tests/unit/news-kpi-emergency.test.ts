import { describe, expect, it } from 'vitest';
import { buildTimeline, evaluateKpi, KPI_TARGETS, type Timeline } from '../../src/services/broadcast/kpi.js';
import { buildEmergencyBulletin, emergencyCandidates, EMERGENCY_GUIDANCE } from '../../src/services/broadcast/emergency.js';
import { loadSchedule } from '../../src/services/broadcast/schedule.js';
import type { FactIncident, FactSheet } from '../../src/services/broadcast/factSheet.js';

const iso = (base: string, plusMs: number): string => new Date(Date.parse(base) + plusMs).toISOString();
const MIN = 60_000;

describe('news pipeline KPIs (AEG-NEWS-007)', () => {
  const capture = '2026-10-17T22:00:00.000Z';   // 06:00 MYT
  const air = '2026-10-17T23:00:00.000Z';       // 07:00 MYT
  const base: Timeline = { triggerAt: capture, draftedAt: iso(capture, 40_000), airAt: air, approvedAt: null, voiceReadyAt: null, presenterRequestedAt: null, presenterReadyAt: null };
  const by = (rows: ReturnType<typeof evaluateKpi>, id: string) => rows.find((r) => r.id === id)!;

  it('daily: drafted within 2 minutes, approved 15 minutes before air time, voice within 5 minutes of approval, presenter by air time', () => {
    const t = { ...base, approvedAt: iso(air, -20 * MIN), voiceReadyAt: iso(air, -17 * MIN), presenterReadyAt: iso(air, -5 * MIN) };
    const rows = evaluateKpi('daily', 'voice_presenter', t, iso(air, 5 * MIN));
    expect(rows.map((r) => [r.id, r.status])).toEqual([['draft', 'ok'], ['approval', 'ok'], ['voice', 'ok'], ['presenter', 'ok']]);
    expect(by(rows, 'draft').actualMs).toBe(40_000);
    expect(by(rows, 'approval').dueAt).toBe(iso(air, -15 * MIN));
  });
  it('daily: late approval, pending and at-risk states, and the presenter not counted for voice only', () => {
    const late = evaluateKpi('daily', 'voice', { ...base, approvedAt: iso(air, -10 * MIN) }, iso(air, -9 * MIN));
    expect(by(late, 'approval').status).toBe('late');
    expect(by(late, 'presenter').status).toBe('not_applicable');
    expect(by(evaluateKpi('daily', 'voice', base, iso(air, -40 * MIN)), 'approval').status).toBe('pending');
    expect(by(evaluateKpi('daily', 'voice', base, iso(air, -17 * MIN)), 'approval').status).toBe('at_risk');
    expect(by(evaluateKpi('daily', 'voice', base, iso(air, -14 * MIN)), 'approval').status).toBe('late');   // not approved and past the limit
    expect(by(evaluateKpi('daily', 'voice', { ...base, approvedAt: iso(air, -30 * MIN) }, iso(air, -20 * MIN)), 'voice').status).toBe('late');   // 5 minutes after approval has passed
  });
  it('emergency: voice on air within 5 minutes of the trigger; the presenter is an optional follow-up', () => {
    const t0 = '2026-10-17T03:00:00.000Z';
    const ok: Timeline = { triggerAt: t0, draftedAt: iso(t0, 20_000), airAt: t0, approvedAt: iso(t0, 90_000), voiceReadyAt: iso(t0, 4 * MIN), presenterRequestedAt: null, presenterReadyAt: null };
    const rows = evaluateKpi('emergency', 'voice', ok, iso(t0, 10 * MIN));
    expect(rows.map((r) => [r.id, r.status])).toEqual([['draft', 'ok'], ['approval', 'ok'], ['voice', 'ok'], ['presenter', 'not_applicable']]);
    const slow = evaluateKpi('emergency', 'voice_presenter', { ...ok, draftedAt: iso(t0, 2 * MIN), approvedAt: iso(t0, 6 * MIN), voiceReadyAt: iso(t0, 6 * MIN) }, iso(t0, 10 * MIN));
    expect(by(slow, 'draft').status).toBe('late'); expect(by(slow, 'approval').status).toBe('late'); expect(by(slow, 'voice').status).toBe('late');
    expect(by(slow, 'presenter').status).toBe('pending');
    expect(KPI_TARGETS.emergency.voiceFromTriggerMs).toBe(5 * MIN);
  });
  it('the timeline counts an approval only while the bulletin is still approved', () => {
    const log = [{ seq: 1, bulletinId: 'B', action: 'APPROVE' as const, by: 'a', at: iso(air, -20 * MIN), note: null }];
    const b = { captureAt: capture, generatedAt: base.draftedAt, airAt: air };
    expect(buildTimeline(b, { decision: 'APPROVED' }, log, []).approvedAt).toBe(iso(air, -20 * MIN));
    expect(buildTimeline(b, { decision: 'HELD' }, log, []).approvedAt).toBeNull();
    const steps = [{ seq: 1, step: 'VOICE_READY' as const, at: iso(air, -18 * MIN), by: 'a', mode: 'browser-stub', note: null }];
    expect(buildTimeline(b, { decision: 'APPROVED' }, log, steps).voiceReadyAt).toBe(iso(air, -18 * MIN));
  });
});

describe('emergency bulletin (AEG-NEWS-007)', () => {
  const schedule = loadSchedule();
  const quake: FactIncident = { evidenceId: 'EV-1', incidentKey: 'usgs-1', hazardType: 'EARTHQUAKE', alertLevel: 'ORANGE', title: 'M 6.1 - 20 km NE of Kota Kinabalu, Malaysia', eventTime: '2026-10-17T01:30:00Z', lat: 6.1, lon: 116.2, sourceId: 'SRC.USGS.LIVE' };
  const cyclone: FactIncident = { evidenceId: 'EV-2', incidentKey: 'gdacs-2', hazardType: 'STORM', alertLevel: 'RED', title: 'Tropical Cyclone CHAMPI-26 - Western North Pacific (GDACS TC 1001)', eventTime: '2026-10-17T00:00:00Z', lat: 15, lon: 130, sourceId: 'SRC.GDACS.LIVE' };
  const unknownSource: FactIncident = { ...quake, evidenceId: 'EV-3', sourceId: 'SRC.UNKNOWN' };

  it('lists the current incidents most severe first, only from sources the bulletin may name, without repeats', () => {
    const facts = { countries: [{ iso3: 'MYS', name: 'Malaysia', incidents: [quake, unknownSource] }], majorElsewhere: [cyclone, quake] } as unknown as FactSheet;
    expect(emergencyCandidates(facts, schedule).map((i) => i.evidenceId)).toEqual(['EV-2', 'EV-1']);
  });
  it('writes a short bulletin from one incident, with the guidance line, passing the same validator as the daily script', () => {
    const { bulletin, problems } = buildEmergencyBulletin({ detail: 'full', schedule, incident: quake, now: '2026-10-17T03:00:00.000Z', bulletinId: 'BULL-E1' });
    expect(problems).toEqual([]);
    expect(bulletin.slotId).toBe('emergency');
    expect(bulletin.segments.map((s) => s.id)).toEqual(['emergency-headline', 'emergency-actions', 'emergency-notice']);
    expect(bulletin.segments[0]!.text).toContain('AEGIS emergency information bulletin');
    expect(bulletin.segments[0]!.text).toContain('magnitude 6.1');
    expect(bulletin.segments[2]!.text).toBe(EMERGENCY_GUIDANCE);
    // what to do: quoted from the official guidance of the country the quake is in (Sabah, Malaysia), with the Malaysian emergency number, and no advice of our own
    expect(bulletin.segments[1]!.text).toContain('In Malaysia, NADMA advises:');
    expect(bulletin.segments[1]!.text).toContain('Drop, Cover, Hold On');
    expect(bulletin.segments[1]!.text).toContain('call 999');
    expect(bulletin.credits.lines.some((l) => l.startsWith('Guidance: Malaysia: LANGKAH KESELAMATAN KETIKA GEMPA BUMI'))).toBe(true);
    expect(bulletin.remarks.join(' ')).toContain('translation of the official Malay text');
    expect(EMERGENCY_GUIDANCE).toContain('not an official warning');
    expect(bulletin.segments[0]!.evidenceIds).toEqual(['EV-1']);
    expect(bulletin.estimatedSeconds).toBeGreaterThan(8);
    expect(buildEmergencyBulletin({ detail: 'full', schedule, incident: cyclone, now: '2026-10-17T03:00:00.000Z', bulletinId: 'BULL-E2' }).problems).toEqual([]);
  });
  it('refuses a source the bulletin may not name', () => {
    expect(buildEmergencyBulletin({ detail: 'full', schedule, incident: unknownSource, now: '2026-10-17T03:00:00.000Z', bulletinId: 'BULL-E3' }).problems.length).toBeGreaterThan(0);
  });
});
