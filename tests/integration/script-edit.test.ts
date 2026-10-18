import { describe, expect, it } from 'vitest';
import { applyScriptEdits } from '../../src/services/broadcast/edit.js';
import type { Bulletin } from '../../src/services/broadcast/script.js';

const seg = (id: string, text: string, lowerThird = 'Source: U.S. Geological Survey (USGS) · Issued 14:09 MYT') => ({ id, title: id, text, focus: null, evidenceIds: [], sourceIds: [], lowerThird, startSec: 0, durationSec: 5 });
const bulletin = (slotId: string): Bulletin => ({ bulletinId: 'B1', slotId, language: 'en', captureAt: '2026-10-17T06:09:00.000Z', airAt: '2026-10-17T06:09:00.000Z', generatedAt: '2026-10-17T06:09:00.000Z', scheduleVersion: '1', factSheetHash: 'h',
  segments: [seg('emergency-headline', 'This is an exercise, not a real event. Earthquake: magnitude 6.5, 121 km NNE of Teluknaga. USGS rates it green.'), seg('emergency-actions', 'Drop, cover and hold on.')], lowerThird: '', estimatedSeconds: 20 } as unknown as Bulletin);

describe('script edit rules (code owns the facts)', () => {
  it('accepts a rewording, re-times the segments and reports the change', () => {
    const r = applyScriptEdits(bulletin('drill'), [{ id: 'emergency-headline', text: 'This is an exercise, not a real event. A magnitude 6.5 earthquake struck 121 km NNE of Teluknaga. USGS rates it green.' }]);
    expect(r.problems).toEqual([]);
    expect(r.changes).toHaveLength(1);
    expect(r.bulletin.segments[1]!.startSec).toBeGreaterThan(0);
  });
  it('refuses a new number or a new name', () => {
    const r = applyScriptEdits(bulletin('drill'), [{ id: 'emergency-headline', text: 'This is an exercise, not a real event. Earthquake of magnitude 7.1, reported by NASA and USGS.' }]);
    expect(r.problems.join(' ')).toMatch(/number 7\.1/); expect(r.problems.join(' ')).toMatch(/name NASA/);
  });
  it('keeps the exercise wording of a drill and protects official guidance', () => {
    expect(applyScriptEdits(bulletin('drill'), [{ id: 'emergency-headline', text: 'Earthquake: magnitude 6.5, 121 km NNE of Teluknaga. USGS rates it green.' }]).problems.join(' ')).toMatch(/exercise/);
    expect(applyScriptEdits(bulletin('emergency'), [{ id: 'emergency-actions', text: 'Run outside at once, whatever happens.' }]).problems.join(' ')).toMatch(/cannot be edited/);
  });
});
