import { describe, expect, it } from 'vitest';
import { buildEmergencyBulletin } from '../../src/services/broadcast/emergency.js';
import { loadSchedule } from '../../src/services/broadcast/schedule.js';

const base = { evidenceId: 'EV-1', incidentKey: 'k', eventTime: '2026-10-17T05:23:00Z', lat: 3.0, lon: 101.5 };
const cases = [
  { ...base, hazardType: 'EARTHQUAKE', alertLevel: 'GREEN', title: 'M 6.5 - 121 km NNE of Teluknaga, Indonesia', sourceId: 'SRC.USGS.LIVE', lat: -5.9, lon: 106.4 },
  { ...base, hazardType: 'FLOOD', alertLevel: 'ORANGE', title: 'Flood in Malaysia, Thailand', sourceId: 'SRC.GDACS.LIVE' },
  { ...base, hazardType: 'VOLCANO', alertLevel: 'ORANGE', title: 'Eruption Kanlaon', sourceId: 'SRC.GDACS.LIVE', lat: 10.4, lon: 123.1 },
];

describe('the 15-second emergency alert', () => {
  for (const incident of cases) {
    it(`${incident.hazardType}: spoken length about 15 s, passes the validator, says exercise when a drill`, () => {
      const { bulletin, problems } = buildEmergencyBulletin({ schedule: loadSchedule(), incident, now: '2026-10-17T06:09:00Z', bulletinId: 'B', drill: true });
      expect(problems).toEqual([]);
      const spoken = bulletin.segments.reduce((n, s) => n + s.durationSec, 0);
      expect(spoken).toBeLessThanOrEqual(19);
      expect(bulletin.segments.map((s) => s.id)).toEqual(['emergency-headline', 'emergency-actions', 'emergency-notice']);
      expect(bulletin.segments[0]!.text).toMatch(/exercise/i);
      expect(bulletin.segments[2]!.text).toBe('Not an official warning. Follow your local authority.');
    });
  }
  it('the full version is still available and longer', () => {
    const brief = buildEmergencyBulletin({ schedule: loadSchedule(), incident: cases[1]!, now: '2026-10-17T06:09:00Z', bulletinId: 'B' }).bulletin;
    const full = buildEmergencyBulletin({ schedule: loadSchedule(), incident: cases[1]!, now: '2026-10-17T06:09:00Z', bulletinId: 'B', detail: 'full' }).bulletin;
    expect(full.segments.reduce((n, s) => n + s.durationSec, 0)).toBeGreaterThan(brief.segments.reduce((n, s) => n + s.durationSec, 0));
  });
});

import { psiCandidate } from '../../src/services/broadcast/emergency.js';
import type { FactSheet } from '../../src/services/broadcast/factSheet.js';

describe('Singapore haze as an emergency candidate', () => {
  const sheet = (psi: unknown): FactSheet => ({ psi } as unknown as FactSheet);
  const reading = (top: number, band: string, fresh = true) => ({ observedAt: '2026-10-17T08:00:00.000Z', updatedAt: null, fetchedAt: '2026-10-17T08:05:00.000Z', regions: [{ region: 'west', psi: top, band }], topBand: band, freshAtCapture: fresh });
  it('is offered at Unhealthy or worse from a fresh reading, and only then', () => {
    expect(psiCandidate(sheet(reading(191, 'Unhealthy')))[0]).toMatchObject({ hazardType: 'WILDFIRE', alertLevel: 'ORANGE', sourceId: 'SRC.NEA.PSI.LIVE', title: 'Haze in Singapore: 24-hour PSI up to 191 (Unhealthy)' });
    expect(psiCandidate(sheet(reading(212, 'Very Unhealthy')))[0]!.alertLevel).toBe('RED');
    expect(psiCandidate(sheet(reading(90, 'Moderate')))).toEqual([]);
    expect(psiCandidate(sheet(reading(191, 'Unhealthy', false)))).toEqual([]);
    expect(psiCandidate(sheet(null))).toEqual([]);
  });
  it('the haze alert passes the validator, names NEA, and reads two official lines (healthy people, then the vulnerable)', () => {
    const incident = psiCandidate(sheet(reading(191, 'Unhealthy')))[0]!;
    const { bulletin, problems } = buildEmergencyBulletin({ schedule: loadSchedule(), incident, now: '2026-10-17T08:10:00Z', bulletinId: 'B' });
    expect(problems).toEqual([]);
    expect(bulletin.segments[0]!.text).toContain('Haze in Singapore: 24-hour PSI up to 191 (Unhealthy)');
    const action = bulletin.segments[1]!.text;
    expect(action).toMatch(/^In Singapore:/);
    expect(action).toMatch(/Healthy persons/i);
  });
});

describe('an alert for a Vietnam audience', () => {
  it('gets no Singapore, Malaysia or Brunei advice: it says no official guidance is on file', () => {
    const incident = { evidenceId: 'EV-V', incidentKey: 'v', hazardType: 'STORM', alertLevel: 'ORANGE', title: 'Tropical Cyclone MAYSAK-26', eventTime: '2026-07-01T00:00:00Z', lat: 16, lon: 107.5, sourceId: 'SRC.GDACS.LIVE' };
    const { bulletin, problems } = buildEmergencyBulletin({ schedule: loadSchedule(), incident, now: '2026-10-17T08:10:00Z', bulletinId: 'B', drill: true, audience: 'VNM' });
    expect(problems).toEqual([]);
    expect(bulletin.segments[1]!.text).toBe('No official guidance on file. Follow your local authority.');
    expect(bulletin.segments[1]!.text).not.toMatch(/Singapore|Malaysia|Brunei/);
  });
});
