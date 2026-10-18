// IDMC Global Internal Displacement Database importer core (AEG-HIST-002). Written against IDMC's published OpenAPI schema
// (https://helix-tools-api.idmcdb.org/external-api/api-schema/, read 2026-10-16) and a synthetic fixture; NOT yet run against the live API
// because access needs a client_id that IDMC issues by email on request.
// Licence (from that schema): Creative Commons Attribution-NonCommercial-ShareAlike 3.0 IGO. Non-commercial use only, attribution to IDMC is
// required, and works derived from the data must be shared under the same licence. Merging these figures into the shipped history is opt-in
// (--include-idmc) for that reason.
import { matchRecords, type EmdatRecord, type MatchCard, type MatchReport } from './emdat.js';

/** The fields of GET /external-api/gidd/disasters/ that the importer reads (names as in the OpenAPI schema). */
export interface IdmcDisaster {
  iso3: string;
  country_name: string;
  year: number;
  start_date: string | null;
  end_date: string | null;
  event_name: string | null;
  new_displacement: number | null;
  new_displacement_rounded: number | null;
  hazard_type_name: string | null;
  hazard_sub_type_name: string | null;
  event_codes: string[] | null;
  event_codes_type: string[] | null;
}

export interface IdmcPage { count: number; next: string | null; results: IdmcDisaster[] }

export const IDMC_CITATION = 'Internal Displacement Monitoring Centre. Global Internal Displacement Database. IDMC (2026). Available at: https://www.internal-displacement.org/database/displacement-data/';
export const IDMC_LICENCE = 'Creative Commons Attribution-NonCommercial-ShareAlike 3.0 IGO';

/** The GLIDE number is the event code whose type says GLIDE (or that looks like one: TC-2013-000139-PHL). */
export function glideOf(row: IdmcDisaster): string | null {
  const codes = row.event_codes ?? []; const types = row.event_codes_type ?? [];
  const byType = codes.find((_, i) => /glide/i.test(types[i] ?? ''));
  const candidate = byType ?? codes.find((c) => /^[A-Z]{2}-\d{4}-\d{6}(?:-[A-Z]{3})?$/.test(c));
  return candidate ?? null;
}

function toRecord(row: IdmcDisaster): EmdatRecord {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(row.start_date ?? '');
  return {
    disNo: row.event_name, glide: glideOf(row), iso3: row.iso3, country: row.country_name, disasterType: row.hazard_type_name,
    startYear: m ? Number(m[1]) : row.year ?? null, startMonth: m ? Number(m[2]) : null, startDay: m ? Number(m[3]) : null,
    deaths: null, injured: null, homeless: null, affected: null,
  };
}

/** Matching is the same as for EM-DAT: GLIDE number first, else same country, hazard type and a start date within 30 days, only when unique. */
export function matchIdmc(rows: IdmcDisaster[], cards: MatchCard[]): { report: MatchReport; byRecord: Map<EmdatRecord, IdmcDisaster> } {
  const byRecord = new Map<EmdatRecord, IdmcDisaster>();
  const records = rows.map((row) => { const r = toRecord(row); byRecord.set(r, row); return r; });
  return { report: matchRecords(records, cards), byRecord };
}

export interface IdmcFigure { kind: 'displaced'; value: number; qualifier: string; quote: string }

/** New internal displacements ("flows") reported for the event. They count movements, so one person displaced twice counts twice. */
export function displacementFigure(row: IdmcDisaster): IdmcFigure | null {
  const value = row.new_displacement ?? row.new_displacement_rounded;
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return null;
  return { kind: 'displaced', value, qualifier: 'new internal displacements', quote: `new_displacement: ${value}` };
}
