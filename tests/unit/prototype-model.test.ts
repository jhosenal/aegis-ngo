import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseHazardMap, HAZARD_TYPES, type HazardType } from '../../src/prototype/hazard-map.js';
import { BLINK_HZ, blinkOpacity, describeModel, projectEvents } from '../../ui/src/prototype/model.js';

const root = process.cwd();
const map = parseHazardMap(JSON.parse(readFileSync(join(root, 'content/prototype/hazard-map.stub.json'), 'utf8')) as unknown);

describe('hazard map pure model', () => {
  it('projects all stub events and describes the same model rows', () => {
    const model = projectEvents(map, 'all');
    const descriptions = describeModel(model);
    expect(model.events).toHaveLength(9);
    expect(descriptions).toHaveLength(model.events.length);
    model.events.forEach((event, index) => {
      expect(descriptions[index]).toBe(`${event.label} | ${event.type} | ${event.severity} | ${event.hoursAgo} hours ago | ${event.note}`);
    });
    expect(model.events.find((event) => event.id === 'ev-01')?.hoursAgo).toBe(0);
    expect(model.events.find((event) => event.id === 'ev-04')?.hoursAgo).toBe(44);
  });

  it('filters the stub for each hazard type and returns an empty filtered model', () => {
    for (const type of HAZARD_TYPES) {
      const model = projectEvents(map, type as HazardType);
      expect(model.filter).toBe(type);
      expect(model.events.length).toBeGreaterThan(0);
      expect(model.events.every((event) => event.type === type)).toBe(true);
      expect(describeModel(model)).toHaveLength(model.events.length);
    }
    const empty = projectEvents({ ...map, events: [] } as typeof map, 'all');
    expect(empty.events).toEqual([]);
    expect(describeModel(empty)).toEqual([]);
  });

  it('keeps the critical pulse soft, bounded and periodic, and static while paused or reduced', () => {
    expect(BLINK_HZ).toBeGreaterThan(0);
    expect(BLINK_HZ).toBeLessThanOrEqual(1);
    const samples = Array.from({ length: 100 }, (_, index) => blinkOpacity(index / 17));
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0.35);
    expect(Math.max(...samples)).toBeLessThanOrEqual(1);
    expect(blinkOpacity(0)).toBeCloseTo(blinkOpacity(1 / BLINK_HZ));
    expect(blinkOpacity(2.25, true)).toBe(1);
    expect(blinkOpacity(2.25, false, true)).toBe(1);
  });
});
