import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeIncident, parseCoordinate, type RawIncidentRecord } from '../../src/sources/normalize.js';

interface FeedFixture {
  polls: { records: RawIncidentRecord[] }[];
}

interface SourceFixture {
  sources: { sourceId: string; licenceRef: string; validHours: number; adapterVersion: string }[];
}

function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8')) as T;
}

describe('incident normalization', () => {
  it('parseCoordinate matches the ENG-004 coordinate table', () => {
    expect(parseCoordinate('4.5000', 'lat')).toBe(4_500_000);
    expect(parseCoordinate('101.1000', 'lon')).toBe(101_100_000);
    expect(parseCoordinate('-2.2500', 'lat')).toBe(-2_250_000);
    expect(parseCoordinate('123.4000', 'lat')).toBeNull();
    expect(parseCoordinate('abc', 'lat')).toBeNull();
    expect(parseCoordinate('1e3', 'lat')).toBeNull();
    expect(parseCoordinate('-0.000001', 'lat')).toBe(-1);
    expect(parseCoordinate('90', 'lat')).toBe(90_000_000);
    expect(parseCoordinate('90.000001', 'lat')).toBeNull();
    expect(parseCoordinate('-180', 'lon')).toBe(-180_000_000);
    expect(parseCoordinate('180.5', 'lon')).toBeNull();
  });

  it('normalizes fixture records, expiry, synthetic flags and invalid coordinates', () => {
    const feed = readFixture<FeedFixture>('feed-polls.json');
    const sourceFixture = readFixture<SourceFixture>('sources.json');
    const source = sourceFixture.sources[0]!;
    const first = feed.polls[0]!.records[0]!;
    const normalized = normalizeIncident(first, source, '2026-10-13T00:00:00Z');
    expect(normalized.validUntil).toBe('2026-10-14T07:30:00Z');
    expect(normalized.intakeFlags).toEqual(['SYNTHETIC']);
    expect(normalized.payload.latE6).toBe(4_500_000);
    expect(normalized.payload.lonE6).toBe(101_100_000);

    const invalidCoordinates = normalizeIncident(feed.polls[0]!.records[2]!, source, '2026-10-13T00:00:00Z');
    expect(invalidCoordinates.intakeFlags).toEqual(['SYNTHETIC', 'COORD_INVALID']);
    expect(invalidCoordinates.payload.latE6).toBeNull();
    expect(invalidCoordinates.payload.lonE6).toBeNull();

    const incomplete = normalizeIncident({ ...first, title: '' }, source, '2026-10-13T00:00:00Z');
    expect(incomplete.intakeFlags).toContain('INCOMPLETE');
  });
});
