import { describe, expect, it } from 'vitest';
import { MATCH_RADIUS_M, distanceM, pickNearest, todayLine } from '../../ui/src/dashboard/placeMatch.js';

describe('google place details matching (AEG-PLACES-001)', () => {
  it('accepts only the result within 150 m of the OpenStreetMap place and prefers the nearest', () => {
    const osm = { lat: 3.209, lng: 101.658 };
    const items = [{ id: 'far', lat: 3.215, lng: 101.658 }, { id: 'near', lat: 3.2091, lng: 101.6581 }, { id: 'nearer', lat: 3.20901, lng: 101.65801 }];
    expect(pickNearest(items, osm)?.id).toBe('nearer');
    expect(pickNearest([items[0]!], osm)).toBeNull();
    expect(MATCH_RADIUS_M).toBe(150);
    expect(Math.round(distanceM(3.209, 101.658, 3.2091, 101.6581))).toBeGreaterThan(10);
  });
  it("picks today's opening hours line for the weekday in Kuala Lumpur", () => {
    const week = ['Monday: 7:00 AM – 10:00 PM', 'Tuesday: 7:00 AM – 10:00 PM', 'Wednesday: Closed', 'Thursday: 8:00 AM – 5:00 PM', 'Friday: 7:00 AM – 10:00 PM', 'Saturday: 7:00 AM – 9:00 PM', 'Sunday: 7:00 AM – 8:00 PM'];
    expect(todayLine(week, new Date('2026-10-17T02:00:00Z'))).toBe('Today: 7:00 AM – 9:00 PM');            // Saturday 10:00 in Kuala Lumpur
    expect(todayLine(week, new Date('2026-10-16T17:00:00Z'))).toBe('Today: 7:00 AM – 9:00 PM');            // still Saturday 01:00 in Kuala Lumpur, Friday in UTC
    expect(todayLine(week, new Date('2026-10-14T05:00:00Z'))).toBe('Today: Closed');
    expect(todayLine(undefined)).toBeNull();
  });
});
