// Test scenarios for the overview screen (engineer-owned). The stub is one complete incident; a screen must also look right when values are unknown,
// when whole sections are empty, and when loading fails. A scenario is chosen with `?scenario=` on /overview and changes ONLY the data the seam
// serves; the screen cannot tell it from real data. Pure functions, so they are unit-tested without a browser.
import { parseOverview, type Overview } from '../../../../src/overview/contract.js';

export const SCENARIOS = ['default', 'unknown', 'empty', 'error'] as const;
export type Scenario = (typeof SCENARIOS)[number];

export function scenarioFromSearch(search: string): Scenario {
  const value = new URLSearchParams(search).get('scenario');
  return (SCENARIOS as readonly string[]).includes(value ?? '') ? (value as Scenario) : 'default';
}

/** Every number the data does not know is null; the screen must show "Unknown", never 0, and must not draw a trend or a band it does not have. */
function unknownValues(o: Overview): Overview {
  return {
    ...o,
    kpis: {
      airQuality: { ...o.kpis.airQuality, value: null, band: 'UNKNOWN', asOf: null, trend: [], tag: 'UNKNOWN' },
      peopleAtRisk: { ...o.kpis.peopleAtRisk, total: null, changePercent: null, communities: null, trend: [], tag: 'UNKNOWN' },
      affectedAreas: { ...o.kpis.affectedAreas, count: null, trend: [], tag: 'UNKNOWN' },
      resourceShortfall: { ...o.kpis.resourceShortfall, criticalItems: null, actionNeeded: false, tag: 'UNKNOWN' },
    },
    map: { ...o.map, areas: o.map.areas.map((area) => ({ ...area, aqi: null, band: 'UNKNOWN' as const })) },
    groups: o.groups.map((group) => ({ ...group, count: null, sharePercent: null })),
    shortfall: o.shortfall.map((row) => ({ ...row, requested: null, available: null, shortfall: null, priority: 'UNKNOWN' as const, tag: 'UNKNOWN' as const })),
  };
}

/** Sections with nothing in them: no communities on the map, no groups, no shortfall rows, no updates. */
function emptySections(o: Overview): Overview {
  return {
    ...o,
    map: { ...o.map, areas: [] },
    groups: [],
    shortfall: [],
    updates: [],
    kpis: {
      ...o.kpis,
      affectedAreas: { ...o.kpis.affectedAreas, count: 0, trend: [] },
      resourceShortfall: { ...o.kpis.resourceShortfall, criticalItems: 0, actionNeeded: false },
    },
  };
}

/** The data for a scenario. `error` has no data: loading must fail. */
export function applyScenario(base: Overview, scenario: Scenario): Overview {
  if (scenario === 'unknown') return parseOverview(unknownValues(base));
  if (scenario === 'empty') return parseOverview(emptySections(base));
  if (scenario === 'error') throw new Error('Scenario error: the data could not be loaded.');
  return parseOverview(base);
}
