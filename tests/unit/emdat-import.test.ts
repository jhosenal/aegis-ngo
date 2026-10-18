import { describe, expect, it } from 'vitest';
import { figuresOf, mapHeaders, matchRecords, parseCsv, readRecords, type MatchCard } from '../../src/sources/emdat.js';

// A synthetic export in EM-DAT's documented column style. NOT a real EM-DAT file.
const csv = [
  'DisNo.,Disaster Type,External IDs,ISO,Country,Start Year,Start Month,Start Day,Total Deaths,No. Injured,No. Homeless,Total Affected,Event Name',
  '2013-0507-PHL,Storm,GLIDE:TC-2013-000139-PHL,PHL,Philippines,2013,11,8,"6,300",28689,4100000,"16,078,181",Haiyan',
  '2021-0600-MYS,Flood,,MYS,Malaysia,2021,12,17,54,,"125,000","400,000","Floods, Selangor"',
  '2021-0601-THA,Flood,,THA,Thailand,2021,12,17,,,,,',
].join('\n');

const cards: MatchCard[] = [
  { id: 'HX-3-A', hazardType: 'STORM', eventStart: '2013-11-04T00:00:00Z', countries: ['Philippines'], glide: 'TC-2013-000139-PHL' },
  { id: 'HX-2-A', hazardType: 'FLOOD', eventStart: '2021-12-17T01:00:00Z', countries: ['Malaysia'] },
  { id: 'HX-2-B', hazardType: 'FLOOD', eventStart: '2021-12-17T01:00:00Z', countries: ['Thailand'] },
  { id: 'HX-2-C', hazardType: 'FLOOD', eventStart: '2021-12-18T01:00:00Z', countries: ['Thailand'] },
];

describe('EM-DAT importer (synthetic fixture; format not yet verified against a real export)', () => {
  it('parses quoted commas and numbers with thousands separators', () => {
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(4);
    const { records } = readRecords(rows);
    expect(records[0]).toMatchObject({ deaths: 6300, affected: 16078181, homeless: 4100000, glide: 'TC-2013-000139-PHL', country: 'Philippines' });
    expect(records[1]).toMatchObject({ deaths: 54, injured: null, homeless: 125000, affected: 400000 });
  });

  it('maps columns by name regardless of order and reports unmapped and missing ones', () => {
    const ok = mapHeaders(['Country', 'Foo', 'Start Year', 'Disaster Type', 'Total Deaths']);
    expect(ok.unmapped).toEqual(['Foo']);
    expect(ok.missingRequired).toEqual([]);
    expect(mapHeaders(['Country', 'Foo']).missingRequired.sort()).toEqual(['deaths', 'disasterType', 'startYear']);
  });

  it('matches by GLIDE first, then by country, type and date when unique, and refuses ambiguous matches', () => {
    const { records } = readRecords(parseCsv(csv));
    const report = matchRecords(records, cards);
    expect(report.matched.map((m) => [m.cardId, m.basis])).toEqual([['HX-3-A', 'glide'], ['HX-2-A', 'country-date-type']]);
    // two Thai flood cards within 30 days of the record: ambiguous, never guessed
    expect(report.ambiguous).toHaveLength(1);
    expect(report.ambiguous[0]!.cardIds.sort()).toEqual(['HX-2-B', 'HX-2-C']);
  });

  it('a record never claims a card another record already took', () => {
    const twice = [...readRecords(parseCsv(csv)).records, ...readRecords(parseCsv(csv)).records.slice(0, 2)];
    const report = matchRecords(twice, cards);
    expect(new Set(report.matched.map((m) => m.cardId)).size).toBe(report.matched.length);
  });

  it('turns a record into figures with their source column and states nothing for blank cells', () => {
    const { records } = readRecords(parseCsv(csv));
    expect(figuresOf(records[0]!).map((f) => [f.kind, f.value])).toEqual([['killed', 6300], ['injured', 28689], ['displaced', 4100000], ['affected', 16078181]]);
    expect(figuresOf(records[1]!).map((f) => f.kind)).toEqual(['killed', 'displaced', 'affected']);
    expect(figuresOf(records[2]!)).toEqual([]);
  });
});
