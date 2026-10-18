import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OverviewSchema } from '../../src/overview/contract.js';
import { applyScenario, scenarioFromSearch, SCENARIOS } from '../../ui/src/overview/seam/scenarios.js';

// The engineer's scenarios for the overview screen (unknown values, empty sections, a failed load).
const base = OverviewSchema.parse(JSON.parse(readFileSync(join(process.cwd(), 'content', 'overview', 'stub-haze-incident.json'), 'utf8')));

describe('overview scenarios', () => {
  it('chooses a scenario from the query string and falls back to the default for anything else', () => {
    expect(scenarioFromSearch('')).toBe('default');
    expect(scenarioFromSearch('?scenario=unknown')).toBe('unknown');
    expect(scenarioFromSearch('?scenario=empty&x=1')).toBe('empty');
    expect(scenarioFromSearch('?scenario=error')).toBe('error');
    expect(scenarioFromSearch('?scenario=<script>')).toBe('default');
    expect(SCENARIOS).toEqual(['default', 'unknown', 'empty', 'error']);
  });

  it('the default scenario is the stub, unchanged', () => {
    expect(applyScenario(base, 'default')).toEqual(base);
  });

  it('unknown: every number is null, bands and priorities are UNKNOWN, no trend is drawn, and the data is still valid', () => {
    const o = applyScenario(base, 'unknown');
    expect(OverviewSchema.safeParse(o).success).toBe(true);
    expect(o.kpis.airQuality).toMatchObject({ value: null, band: 'UNKNOWN', asOf: null, trend: [] });
    expect(o.kpis.peopleAtRisk).toMatchObject({ total: null, changePercent: null, communities: null });
    expect(o.kpis.affectedAreas.count).toBeNull();
    expect(o.kpis.resourceShortfall.criticalItems).toBeNull();
    expect(o.map.areas.every((a) => a.aqi === null && a.band === 'UNKNOWN')).toBe(true);
    expect(o.groups.every((g) => g.count === null && g.sharePercent === null)).toBe(true);
    expect(o.shortfall.every((r) => r.requested === null && r.available === null && r.shortfall === null && r.priority === 'UNKNOWN')).toBe(true);
    // the rows and the communities are still there: only their numbers are unknown
    expect(o.shortfall.length).toBe(base.shortfall.length);
    expect(o.map.areas.length).toBe(base.map.areas.length);
  });

  it('empty: no communities, groups, shortfall rows or updates, still valid, and the incident header is intact', () => {
    const o = applyScenario(base, 'empty');
    expect(OverviewSchema.safeParse(o).success).toBe(true);
    expect(o.map.areas).toEqual([]);
    expect(o.groups).toEqual([]);
    expect(o.shortfall).toEqual([]);
    expect(o.updates).toEqual([]);
    expect(o.incident).toEqual(base.incident);
    expect(o.assist).toEqual(base.assist);
  });

  it('error: loading fails, with a message that holds no stack or internal path', () => {
    let message = '';
    try { applyScenario(base, 'error'); } catch (error) { message = (error as Error).message; }
    expect(message).toMatch(/could not be loaded/);
    expect(message).not.toMatch(/\bat\s|\.ts:|node_modules/);
  });

  it('a scenario never changes the synthetic marking', () => {
    for (const scenario of ['default', 'unknown', 'empty'] as const) {
      const o = applyScenario(base, scenario);
      expect(o.synthetic).toBe(true);
      expect(o.syntheticLabel).toMatch(/synthetic/i);
    }
  });
});
