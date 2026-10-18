import { describe, expect, it } from 'vitest';
import type { MatchCard } from '../../src/sources/emdat.js';
import { displacementFigure, glideOf, matchIdmc, type IdmcDisaster } from '../../src/sources/idmc.js';

// Synthetic rows in the field names of IDMC's OpenAPI schema. NOT real IDMC data.
const base: IdmcDisaster = {
  iso3: 'PHL', country_name: 'Philippines', year: 2013, start_date: '2013-11-08', end_date: '2013-11-11', event_name: 'Typhoon Haiyan',
  new_displacement: 4_095_280, new_displacement_rounded: 4_100_000, hazard_type_name: 'Storm', hazard_sub_type_name: 'Tropical cyclone',
  event_codes: ['TC-2013-000139-PHL', 'EM-2013-0507'], event_codes_type: ['GLIDE number', 'EM-DAT'],
};
const cards: MatchCard[] = [
  { id: 'HX-3-A', hazardType: 'STORM', eventStart: '2013-11-04T00:00:00Z', countries: ['Philippines'], glide: 'TC-2013-000139-PHL' },
  { id: 'HX-2-A', hazardType: 'FLOOD', eventStart: '2021-12-17T01:00:00Z', countries: ['Malaysia'] },
];

describe('IDMC displacement importer (synthetic fixture; not run against the live API)', () => {
  it('finds the GLIDE number by its type, or by its shape', () => {
    expect(glideOf(base)).toBe('TC-2013-000139-PHL');
    expect(glideOf({ ...base, event_codes: ['TC-2013-000139-PHL'], event_codes_type: [] })).toBe('TC-2013-000139-PHL');
    expect(glideOf({ ...base, event_codes: ['EM-2013-0507'], event_codes_type: ['EM-DAT'] })).toBeNull();
    expect(glideOf({ ...base, event_codes: null, event_codes_type: null })).toBeNull();
  });

  it('matches by GLIDE number, then by country, type and date, and states displacement as a flow', () => {
    const flood: IdmcDisaster = { ...base, iso3: 'MYS', country_name: 'Malaysia', start_date: '2021-12-18', event_name: 'Floods', hazard_type_name: 'Flood', hazard_sub_type_name: null, event_codes: null, event_codes_type: null, new_displacement: 125_000 };
    const { report, byRecord } = matchIdmc([base, flood], cards);
    expect(report.matched.map((m) => [m.cardId, m.basis])).toEqual([['HX-3-A', 'glide'], ['HX-2-A', 'country-date-type']]);
    const first = byRecord.get(report.matched[0]!.record)!;
    expect(displacementFigure(first)).toEqual({ kind: 'displaced', value: 4_095_280, qualifier: 'new internal displacements', quote: 'new_displacement: 4095280' });
  });

  it('uses the rounded figure when the exact one is missing and states nothing for a missing or negative value', () => {
    expect(displacementFigure({ ...base, new_displacement: null })?.value).toBe(4_100_000);
    expect(displacementFigure({ ...base, new_displacement: null, new_displacement_rounded: null })).toBeNull();
    expect(displacementFigure({ ...base, new_displacement: -1 })).toBeNull();
  });

  it('never matches when country or hazard type differs', () => {
    const wrong: IdmcDisaster = { ...base, event_codes: null, event_codes_type: null, country_name: 'Indonesia' };
    expect(matchIdmc([wrong], cards).report.matched).toEqual([]);
  });
});
