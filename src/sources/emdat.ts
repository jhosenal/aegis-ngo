// EM-DAT importer core (AEG-HIST-002). EM-DAT (CRED / UCLouvain) is the structured source of deaths, injured, homeless and total affected for floods,
// storms and volcanic events. The owner must register and export a CSV; this module maps its columns to history cards and builds an `impact`.
// STATUS: written against the documented column names and a synthetic fixture. It has NOT been run on a real EM-DAT export; the first real file
// needs a column check (the importer reports every column it could not map).
// Licence: EM-DAT is free for non-commercial use with citation and restricts redistribution of its data, so merged figures stay out of the
// shipped content unless the owner passes --include-emdat to the build.

export interface EmdatRecord {
  disNo: string | null;
  glide: string | null;
  iso3: string | null;
  country: string | null;
  disasterType: string | null;
  startYear: number | null; startMonth: number | null; startDay: number | null;
  deaths: number | null; injured: number | null; homeless: number | null; affected: number | null;
}

export interface HeaderMap { column: string; field: keyof EmdatRecord }

const ALIASES: Record<keyof EmdatRecord, string[]> = {
  disNo: ['disno', 'disasterno', 'disasternumber'],
  glide: ['externalids', 'glide', 'glideno', 'glidenumber', 'externalid'],
  iso3: ['iso', 'isocode', 'iso3'],
  country: ['country', 'countryname'],
  disasterType: ['disastertype', 'type'],
  startYear: ['startyear'], startMonth: ['startmonth'], startDay: ['startday'],
  deaths: ['totaldeaths', 'deaths', 'nodeaths'],
  injured: ['noinjured', 'injured', 'numberinjured'],
  homeless: ['nohomeless', 'homeless', 'numberhomeless'],
  affected: ['totalaffected', 'noaffected', 'affected'],
};

const norm = (h: string): string => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/** RFC-4180-style CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = []; let field = ''; let quoted = false;
  const input = text.replace(/^﻿/, '');
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"') { if (input[i + 1] === '"') { field += '"'; i += 1; } else quoted = false; } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

export function mapHeaders(header: string[]): { map: Map<number, keyof EmdatRecord>; unmapped: string[]; missingRequired: string[] } {
  const map = new Map<number, keyof EmdatRecord>();
  const used = new Set<keyof EmdatRecord>();
  const unmapped: string[] = [];
  header.forEach((h, index) => {
    const n = norm(h);
    const field = (Object.keys(ALIASES) as (keyof EmdatRecord)[]).find((f) => !used.has(f) && ALIASES[f].includes(n));
    if (field) { map.set(index, field); used.add(field); } else unmapped.push(h);
  });
  const required: (keyof EmdatRecord)[] = ['country', 'disasterType', 'startYear', 'deaths'];
  return { map, unmapped, missingRequired: required.filter((f) => !used.has(f)) };
}

const toNum = (v: string): number | null => {
  const t = v.replace(/[,\s]/g, '');
  if (t === '' || !/^\d+(\.\d+)?$/.test(t)) return null;
  return Math.round(Number(t));
};

export function readRecords(rows: string[][]): { records: EmdatRecord[]; unmapped: string[]; missingRequired: string[] } {
  if (rows.length === 0) return { records: [], unmapped: [], missingRequired: ['header'] };
  const { map, unmapped, missingRequired } = mapHeaders(rows[0]!);
  const records: EmdatRecord[] = [];
  for (const row of rows.slice(1)) {
    const r: EmdatRecord = { disNo: null, glide: null, iso3: null, country: null, disasterType: null, startYear: null, startMonth: null, startDay: null, deaths: null, injured: null, homeless: null, affected: null };
    for (const [index, field] of map) {
      const raw = (row[index] ?? '').trim();
      if (raw === '') continue;
      if (['startYear', 'startMonth', 'startDay', 'deaths', 'injured', 'homeless', 'affected'].includes(field)) (r[field] as number | null) = toNum(raw);
      else (r[field] as string | null) = raw;
    }
    if (r.glide) { const m = /([A-Z]{2}-\d{4}-\d{6}(?:-[A-Z]{3})?)/.exec(r.glide); r.glide = m ? m[1]! : r.glide; }
    records.push(r);
  }
  return { records, unmapped, missingRequired };
}

export interface MatchCard { id: string; hazardType: string; eventStart: string; countries: string[]; glide?: string | null }

const TYPE_TO_HAZARD: Record<string, string> = { flood: 'FLOOD', storm: 'STORM', 'volcanic activity': 'VOLCANO', earthquake: 'EARTHQUAKE', drought: 'DROUGHT' };
export const HAZARD_OF_EMDAT = (t: string | null): string | null => (t ? TYPE_TO_HAZARD[t.trim().toLowerCase()] ?? null : null);

export interface MatchResult { cardId: string; record: EmdatRecord; basis: 'glide' | 'country-date-type' }
export interface MatchReport { matched: MatchResult[]; ambiguous: { record: EmdatRecord; cardIds: string[] }[]; unmatched: EmdatRecord[] }

/** GLIDE number first (exact); otherwise the same country, the same hazard type and a start date within 30 days, accepted only when it is unique. */
export function matchRecords(records: EmdatRecord[], cards: MatchCard[]): MatchReport {
  const report: MatchReport = { matched: [], ambiguous: [], unmatched: [] };
  const claimed = new Set<string>();
  for (const record of records) {
    const byGlide = record.glide ? cards.filter((c) => c.glide && c.glide === record.glide) : [];
    if (byGlide.length === 1 && !claimed.has(byGlide[0]!.id)) { claimed.add(byGlide[0]!.id); report.matched.push({ cardId: byGlide[0]!.id, record, basis: 'glide' }); continue; }
    const hazard = HAZARD_OF_EMDAT(record.disasterType);
    if (!hazard || record.startYear === null || !record.country) { report.unmatched.push(record); continue; }
    const start = Date.UTC(record.startYear, (record.startMonth ?? 1) - 1, record.startDay ?? 1);
    const candidates = cards.filter((c) => c.hazardType === hazard && c.countries.some((x) => x.toLowerCase() === record.country!.toLowerCase())
      && Math.abs(Date.parse(c.eventStart.length === 4 ? `${c.eventStart}-01-01` : c.eventStart) - start) <= 30 * 86_400_000 && !claimed.has(c.id));
    if (candidates.length === 1) { claimed.add(candidates[0]!.id); report.matched.push({ cardId: candidates[0]!.id, record, basis: 'country-date-type' }); }
    else if (candidates.length > 1) report.ambiguous.push({ record, cardIds: candidates.map((c) => c.id) });
    else report.unmatched.push(record);
  }
  return report;
}

export interface EmdatFigure { kind: 'killed' | 'injured' | 'displaced' | 'affected'; value: number; qualifier: null; quote: string }

export function figuresOf(r: EmdatRecord): EmdatFigure[] {
  const out: EmdatFigure[] = [];
  const add = (kind: EmdatFigure['kind'], value: number | null, label: string) => { if (value !== null) out.push({ kind, value, qualifier: null, quote: `${label}: ${value}` }); };
  add('killed', r.deaths, 'Total Deaths'); add('injured', r.injured, 'No. Injured'); add('displaced', r.homeless, 'No. Homeless'); add('affected', r.affected, 'Total Affected');
  return out;
}
