import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { freeLicence } from '../../src/sources/wikiMedia.js';

const root = new URL('../../', import.meta.url);
const pins = JSON.parse(readFileSync(fileURLToPath(new URL('fixtures/environment-pins.json', root)), 'utf8')) as { pins: Array<{ pinId: string }> };
const catalogue = JSON.parse(readFileSync(fileURLToPath(new URL('content/places/place-media.json', root)), 'utf8')) as { counts: Record<string, number>; entries: Record<string, any> };
const subjects = JSON.parse(readFileSync(fileURLToPath(new URL('records/reviews/AEG-MEDIA-LANDMARK-002_2026-10-17_subjects.json', root)), 'utf8')) as { entries: Record<string, any> };

describe('AEG-MEDIA-LUNA-001 125-pin catalogue', () => {
  it('accounts for every current registry pin and recomputes status counts', () => {
    const ids = pins.pins.map((pin) => pin.pinId);
    expect(ids).toHaveLength(125);
    expect(Object.keys(catalogue.entries).sort()).toEqual([...ids].sort());
    const counts = Object.values(catalogue.entries).reduce<Record<string, number>>((out, entry) => {
      out[entry.status] = (out[entry.status] ?? 0) + 1;
      return out;
    }, {});
    expect(counts).toEqual(catalogue.counts);
    expect(Object.values(counts).reduce((sum, value) => sum + value, 0)).toBe(ids.length);
  });

  it('only labels fully credited, allowlisted images with both verified standard thumbnails as matched', () => {
    for (const entry of Object.values(catalogue.entries)) {
      if (entry.status !== 'matched') continue;
      expect(entry.article?.title).toBeTruthy();
      expect(entry.image?.creator).toBeTruthy();
      expect(entry.image?.credit).toContain(entry.image.creator);
      expect(freeLicence(entry.image?.licence ?? '')).toBe(true);
      if (!/^public domain|^pd\b/i.test(entry.image?.licence ?? '')) expect(entry.image?.licenceUrl).toMatch(/^https?:\/\//);
      expect(entry.image?.commonsUrl).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      if (entry.image?.originalWidth <= 500) {
        expect(entry.image?.thumb250).toBe(entry.image?.thumb500);
      } else {
        expect(entry.image?.thumb250).toContain('/250px-');
        expect(entry.image?.thumb500).toContain('/500px-');
      }
      expect(entry.image?.thumbVerifiedAt).toBeTruthy();
      expect(entry.image?.width500).toBeGreaterThan(0);
      expect(entry.image?.height500).toBeGreaterThan(0);
    }
  });

  it('has source-backed subject and plain-text caption evidence for every matched image', () => {
    const matched = Object.values(catalogue.entries).filter((entry) => entry.status === 'matched');
    expect(matched).toHaveLength(70);
    expect(Object.keys(subjects.entries)).toHaveLength(matched.length);
    for (const entry of matched) {
      const evidence = subjects.entries[entry.pinId];
      expect(evidence?.sourceDescription).toBe(entry.image.description);
      expect(evidence?.subject).toBeTruthy();
      expect(evidence?.caption).toMatch(/location illustration/i);
      expect(evidence?.caption).not.toMatch(/<[^>]+>/);
      expect(evidence?.wikipediaUrl).toBe(entry.article.url);
      expect(evidence?.commonsUrl).toBe(entry.image.commonsUrl);
      expect(evidence?.credit).toBe(entry.image.credit);
      expect(evidence?.licence).toBe(entry.image.licence);
    }
  });

  it('labels the 13 reviewed contextual images separately and keeps SNET coordinate cases unresolved', () => {
    const contextual = ['sg-13', 'bn-11', 'my-01', 'my-04', 'my-06', 'my-10', 'my-15', 'my-16', 'my-17', 'my-39', 'my-42', 'my-48', 'my-54'];
    for (const pinId of contextual) expect(subjects.entries[pinId]?.scope).toBe('broader-area/contextual');
    const coordinateCases = ['sg-06', 'sg-08', 'sg-11', 'sg-16', 'sg-20', 'my-09', 'my-21', 'my-23', 'sg-dis-03'];
    for (const pinId of coordinateCases) expect(catalogue.entries[pinId]?.status).toBe('error');
  });

  it('records the nine verified local landmark additions without changing their monitoring coordinates', () => {
    const additions = ['my-40', 'my-22', 'my-dis-18', 'my-dis-02', 'my-61', 'my-dis-12', 'my-dis-13', 'my-33', 'my-65', 'my-26', 'my-50', 'my-51', 'my-13'];
    for (const pinId of additions) {
      const entry = catalogue.entries[pinId];
      expect(entry?.status).toBe('matched');
      expect(entry?.article?.distanceM).toBeGreaterThan(0);
      expect(entry?.note).toContain('Monitoring coordinates remain');
      expect(subjects.entries[pinId]?.association).toMatch(/Reviewed local (?:place\/)?landmark/);
    }
    expect(catalogue.counts).toEqual({ matched: 70, name_mismatch: 42, error: 9, no_article: 4 });
  });
});
