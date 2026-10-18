import { describe, expect, it } from 'vitest';
import { cameraFor, lerpCamera, planCamera, stepAt } from '../../ui/src/dashboard/cameraPlan.js';
import { CAMERA_VIEWS, WELCOME_MENTIONS } from '../../ui/src/dashboard/newsContent.js';

describe('camera formula (AEG-NEWS-006)', () => {
  it('welcome: ONE zoom in to the Malaysia frame 1 s before the first country is said, ONE zoom out 2 s after the last', () => {
    const plan = planCamera(WELCOME_MENTIONS);
    expect(plan.map((s) => [s.view, Math.round(s.at * 10) / 10])).toEqual([['mys', 6.8], ['default', 12.7]]);
    expect(plan.every((s) => s.travelSec === 1.2)).toBe(true);
  });
  it('the Malaysia frame holds Singapore and Brunei', () => {
    const f = CAMERA_VIEWS.mys;
    for (const [lat, lng] of [[1.35, 103.82], [4.89, 114.94]] as const) expect(lat >= f.south && lat <= f.north && lng >= f.west && lng <= f.east).toBe(true);
  });
  it('moves never pile up: a country said soon after the previous one waits at least 0.8 s after the previous move began', () => {
    const plan = planCamera([{ view: 'sgp', at: 1.0, end: 1.5 }, { view: 'mys', at: 1.6, end: 2.0 }]);
    expect(plan[0]!.at).toBe(0);
    expect(plan[1]!.at).toBeCloseTo(0.8, 5);
    expect(plan[2]).toMatchObject({ view: 'default' });
    expect(plan[2]!.at).toBeGreaterThanOrEqual(plan[1]!.at + 1.2);   // never starts the return before the last move has arrived
  });
  it('a long segment stays on its country, then returns 2 s after it ends; no mention means no move', () => {
    const plan = planCamera([{ view: 'mys', at: 40, end: 120 }]);
    expect(plan.map((s) => [s.view, s.at])).toEqual([['mys', 39], ['default', 122]]);
    expect(planCamera([])).toEqual([]);
    expect(stepAt(plan, 10)).toBeNull();
    expect(stepAt(plan, 60)?.view).toBe('mys');
    expect(stepAt(plan, 130)?.view).toBe('default');
  });
  it('fits a country into the free part of the map (left of the presenter) at a sensible zoom, and eases between two cameras', () => {
    const sgp = cameraFor(CAMERA_VIEWS.sgp, 900, 500, { top: 90, bottom: 90, left: 60, right: 360 });
    const asean = cameraFor(CAMERA_VIEWS.asean, 900, 500, { top: 90, bottom: 90, left: 60, right: 360 });
    expect(sgp.zoom).toBeGreaterThan(asean.zoom + 3);                 // Singapore is much closer in than all ASEAN
    expect(sgp.zoom).toBeLessThanOrEqual(14);
    expect(sgp.lng).toBeGreaterThan(CAMERA_VIEWS.sgp.east - 0.2);     // the map centre sits east of Singapore so Singapore shows in the left part
    const start = lerpCamera(asean, sgp, 0); const mid = lerpCamera(asean, sgp, 0.5); const end = lerpCamera(asean, sgp, 1);
    expect(start.zoom).toBeCloseTo(asean.zoom, 6); expect(end.zoom).toBeCloseTo(sgp.zoom, 6);
    expect(mid.zoom).toBeCloseTo((asean.zoom + sgp.zoom) / 2, 6);     // eased: halfway in time is halfway in zoom
    expect(lerpCamera(asean, sgp, 0.1).zoom - asean.zoom).toBeLessThan((sgp.zoom - asean.zoom) * 0.1);   // ease in: slow start
  });
});
