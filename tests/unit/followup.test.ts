import { describe, expect, it } from 'vitest';
import { buildEmergencyBulletin } from '../../src/services/broadcast/emergency.js';
import { buildFollowUp, FOLLOWUP_MAX_WORDS } from '../../src/services/broadcast/followup.js';
import { loadSchedule } from '../../src/services/broadcast/schedule.js';
import type { FactIncident, FactSheet } from '../../src/services/broadcast/factSheet.js';

const incident: FactIncident = { evidenceId: 'PSI-2026-10-17T09:00:00.000Z', incidentKey: 'haze-sg', hazardType: 'WILDFIRE', alertLevel: 'ORANGE', title: 'Haze in Singapore: 24-hour PSI up to 193 (Unhealthy)', eventTime: '2026-10-17T09:00:00.000Z', lat: 1.35, lon: 103.8, sourceId: 'SRC.NEA.PSI.LIVE' };
const facts = { psi: { observedAt: '2026-10-17T09:00:00.000Z', updatedAt: null, fetchedAt: '2026-10-17T09:05:00.000Z', regions: [{ region: 'west', psi: 193, band: 'Unhealthy' }, { region: 'south', psi: 161, band: 'Unhealthy' }], topBand: 'Unhealthy', freshAtCapture: true },
  metMy: { warnings: [], warningsKnown: true, forecastDate: '2026-10-17', forecastLabel: 'today', key: [{ location: 'Johor Bahru', text: 'haze in the morning and at night, thunderstorms in a few places in the afternoon', minTemp: 24, maxTemp: 33 }], hazeCount: 1, hazeLocations: ['Johor Bahru'] },
  countries: [], majorElsewhere: [], elsewhereCount: 0, advice: [], feeds: [], hash: 'h', captureAt: '2026-10-17T09:10:00Z', airAt: '2026-10-17T09:10:00Z', slotId: 'emergency', scheduleVersion: 'x' } as unknown as FactSheet;
const parent = () => buildEmergencyBulletin({ schedule: loadSchedule(), incident, now: '2026-10-17T09:05:00Z', bulletinId: 'P1', drill: true }).bulletin;

describe('the one-minute follow-up for Johor', () => {
  it('is written from facts on file, passes the validator, and stays about a minute', () => {
    const { bulletin, problems } = buildFollowUp({ schedule: loadSchedule(), parent: parent(), incident, facts, area: 'Johor', areaPins: ['Johor Bahru City Centre', 'Pasir Gudang Industrial', 'Muar'], now: '2026-10-17T09:12:00Z', bulletinId: 'F1', drill: true });
    expect(problems).toEqual([]);
    expect(bulletin.followUpOf).toBe('P1');
    expect(bulletin.segments.map((s) => s.id)).toEqual(['emergency-headline', 'followup-johor', 'emergency-actions', 'emergency-notice']);
    const text = bulletin.segments.map((s) => s.text).join(' ');
    expect(text).toContain('the 24-hour PSI was 161, in the Unhealthy band');
    expect(text).toContain("MetMalaysia's forecast for today in Johor Bahru: haze in the morning and at night");
    expect(text).toContain('3 monitored locations in Johor');
    expect(text).toMatch(/This is an exercise/);
    expect(text.split(/\s+/).length).toBeLessThanOrEqual(FOLLOWUP_MAX_WORDS + 25);
    expect(text).not.toMatch(/PM2\.5|hotspot|Kalimantan|Sumatra/);
  });
  it('says only what is on file: no Johor forecast means no forecast sentence, and no guidance means the plain sentence', () => {
    const noMet = { ...facts, metMy: null } as unknown as FactSheet;
    const quake: FactIncident = { ...incident, hazardType: 'VOLCANO', title: 'Eruption Kanlaon', sourceId: 'SRC.GDACS.LIVE', alertLevel: 'ORANGE' };
    const { bulletin, problems } = buildFollowUp({ schedule: loadSchedule(), parent: buildEmergencyBulletin({ schedule: loadSchedule(), incident: quake, now: '2026-10-17T09:05:00Z', bulletinId: 'P2' }).bulletin, incident: quake, facts: noMet, area: 'Johor', areaPins: [], now: '2026-10-17T09:12:00Z', bulletinId: 'F2' });
    expect(problems).toEqual([]);
    expect(bulletin.segments[1]!.text).toBe('In Johor: For weather warnings that apply to Johor, check MetMalaysia.');
    expect(bulletin.segments[2]!.text).toBe('No official guidance on file. Follow your local authority.');
  });
});
