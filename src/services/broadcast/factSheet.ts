// Fact sheet for one bulletin (AEG-NEWS-004): everything a script may say, assembled by code from PUBLIC, non-synthetic evidence of the narratable
// sources only (content/broadcast/schedule.json). Google Maps content is never read here. The sheet is as at the capture time: evidence fetched
// after it is ignored, so regenerating later gives the same sheet and the same hash.
import { aseanCountryOfRegion, ASEAN_COUNTRIES } from '../../domains/asean.js';
import { hashWithDomain } from '../../engine/canonical.js';
import { toEvidenceViews } from '../../sources/evidenceView.js';
import type { EvidenceRecord, EvidenceView, SourceStatus } from '../../types/domain.js';
import type { StoredPsi } from '../../data/repos/airReadings.js';
import type { AdviceLine } from './advice.js';
import type { StoredSnapshot } from '../../data/repos/officialSnapshots.js';
import { forecastText, hasHaze, type MetWarning } from '../../sources/metMy.js';
import type { ForecastPayload } from '../metMyIngest.js';
import { bandOf, PSI_REGIONS, type PsiBand, type PsiRegion } from '../../sources/psi.js';
import { domainOfHazard } from '../hazardSummary.js';
import type { BroadcastSchedule, SlotTimes } from './schedule.js';

export interface FactIncident {
  evidenceId: string; incidentKey: string; hazardType: string; alertLevel: string; title: string; eventTime: string | null;
  lat: number | null; lon: number | null; sourceId: string;
}
export interface FactCountry { iso3: string; name: string; incidents: FactIncident[] }
export interface FactFeed { sourceId: string; name: string; lastOkAt: string | null; freshAtCapture: boolean }
/** Data fetched up to this long after the nominal capture time still counts: the poll that makes the capture runs in the minutes around it. */
export const CAPTURE_GRACE_MS = 5 * 60_000;
export interface FactPsi {
  observedAt: string; updatedAt: string | null; fetchedAt: string;
  /** Regions, highest PSI first. */
  regions: { region: PsiRegion; psi: number; band: PsiBand }[];
  topBand: PsiBand;
  /** True when the reading is for the capture hour or the one before (NEA publishes hourly). */
  freshAtCapture: boolean;
}
export interface FactMetMy {
  /** Warnings active at the capture instant, one per title (the one valid longest). */
  warnings: { title: string; validTo: string }[];
  /** True when a warnings snapshot existed by capture, so "no active warning" may be said. */
  warningsKnown: boolean;
  forecastDate: string | null;
  forecastLabel: 'today' | 'tomorrow' | null;
  key: { location: string; text: string; minTemp: number | null; maxTemp: number | null }[];
  hazeCount: number;
  hazeLocations: string[];
}
export interface FactSheet {
  slotId: string;
  captureAt: string;
  airAt: string;
  scheduleVersion: string;
  feeds: FactFeed[];
  countries: FactCountry[];
  /** Current incidents in the other ASEAN states and at sea: a count only, never detailed in the script. */
  elsewhereCount: number;
  /** Current RED or ORANGE alerts outside the three covered countries (a cyclone at sea, a quake in Indonesia...), most severe first, at most five. */
  majorElsewhere: FactIncident[];
  /** Singapore's NEA 24-hour PSI as at capture, or null when no reading was available. */
  psi: FactPsi | null;
  /** NEA's own advice for the current PSI band, quoted from the RELEASED guidance card; empty when guidance is not released or there is no reading. */
  advice: AdviceLine[];
  /** MetMalaysia warnings and forecast as at capture, or null when neither snapshot existed. */
  metMy: FactMetMy | null;
  hash: string;
}

/** The canonical hash accepts integers only, so decimals (coordinates, any fractional value) are hashed as their exact text. The sheet itself keeps the numbers. */
export function stringifyDecimals(value: unknown): unknown {
  if (typeof value === 'number') return Number.isInteger(value) ? value : String(value);
  if (Array.isArray(value)) return value.map(stringifyDecimals);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, stringifyDecimals(v)]));
  return value;
}

const micro = (v: number | null | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v / 1_000_000 : null);

export function buildFactSheet(p: {
  schedule: BroadcastSchedule; slot: SlotTimes; captureAt: string; airAt: string;
  evidence: EvidenceRecord[]; statuses: SourceStatus[]; psi?: StoredPsi | null;
  /** Looks up released advice for a band (see advice.ts). Omitted in tests that do not cover advice. */
  adviceFor?: (band: PsiBand) => AdviceLine[];
  metMy?: { warnings: StoredSnapshot<MetWarning[]> | null; forecast: StoredSnapshot<ForecastPayload> | null };
}): FactSheet {
  const allowed = new Set(p.schedule.narratedSources.map((s) => s.sourceId));
  const captureMs = Date.parse(p.captureAt);
  const knownBy = captureMs + CAPTURE_GRACE_MS;
  const known = p.evidence.filter((e) => e.tenantScope === null && !e.synthetic && allowed.has(e.sourceId) && Date.parse(e.fetchedAt) <= knownBy);
  const views = toEvidenceViews(known, null, p.captureAt).filter((v: EvidenceView) => !v.flags.includes('STALE') && !v.flags.includes('SUPERSEDED'));
  const byIncident = new Map<string, EvidenceView>();
  for (const v of views) {
    const current = byIncident.get(v.payload.incidentKey);
    if (!current || (v.publishedAt ?? '') > (current.publishedAt ?? '')) byIncident.set(v.payload.incidentKey, v);
  }
  const covered = new Set(p.schedule.coverage.countries);
  const countries: FactCountry[] = p.schedule.coverage.countries.map((iso3) => ({ iso3, name: ASEAN_COUNTRIES.find((c) => c.iso3 === iso3)?.name ?? iso3, incidents: [] }));
  let elsewhere = 0;
  const majorElsewhere: FactIncident[] = [];
  for (const v of byIncident.values()) {
    if (domainOfHazard(v.payload.hazardType) === null) continue;
    const country = aseanCountryOfRegion(v.regionId);
    if (country && covered.has(country.iso3)) {
      countries.find((c) => c.iso3 === country.iso3)!.incidents.push({
        evidenceId: v.evidenceId, incidentKey: v.payload.incidentKey, hazardType: v.payload.hazardType, alertLevel: v.payload.alertLevel, title: v.payload.title,
        eventTime: v.eventTime, lat: micro(v.payload.latE6), lon: micro(v.payload.lonE6), sourceId: v.sourceId,
      });
    } else {
      elsewhere += 1;
      const level = v.payload.alertLevel.toUpperCase();
      if (level === 'RED' || level === 'ORANGE') {
        majorElsewhere.push({ evidenceId: v.evidenceId, incidentKey: v.payload.incidentKey, hazardType: v.payload.hazardType, alertLevel: v.payload.alertLevel, title: v.payload.title, eventTime: v.eventTime, lat: micro(v.payload.latE6), lon: micro(v.payload.lonE6), sourceId: v.sourceId });
      }
    }
  }
  majorElsewhere.sort((a, b) => Number(b.alertLevel.toUpperCase() === 'RED') - Number(a.alertLevel.toUpperCase() === 'RED') || (b.eventTime ?? '').localeCompare(a.eventTime ?? '') || a.incidentKey.localeCompare(b.incidentKey));
  majorElsewhere.splice(5);
  for (const c of countries) c.incidents.sort((a, b) => (b.eventTime ?? '').localeCompare(a.eventTime ?? '') || a.incidentKey.localeCompare(b.incidentKey));
  const feeds: FactFeed[] = p.schedule.narratedSources.map((s) => {
    const st = p.statuses.find((x) => x.sourceId === s.sourceId);
    const lastOkAt = st?.lastOkAt ?? null;
    return { sourceId: s.sourceId, name: s.name, lastOkAt, freshAtCapture: lastOkAt !== null && captureMs - Date.parse(lastOkAt) <= 60 * 60_000 };
  });
  let psi: FactPsi | null = null;
  if (p.psi && Date.parse(p.psi.fetchedAt) <= knownBy) {
    const regions = PSI_REGIONS.map((region) => ({ region, psi: p.psi!.reading.psi[region], band: bandOf(p.psi!.reading.psi[region]) })).sort((a, b) => b.psi - a.psi || a.region.localeCompare(b.region));
    psi = {
      observedAt: p.psi.reading.observedAt, updatedAt: p.psi.reading.updatedAt, fetchedAt: p.psi.fetchedAt, regions, topBand: regions[0]!.band,
      freshAtCapture: captureMs - Date.parse(p.psi.reading.observedAt) <= 2 * 3_600_000,
    };
  }
  const advice = psi && p.adviceFor ? p.adviceFor(psi.topBand) : [];
  let metMy: FactMetMy | null = null;
  const mw = p.metMy?.warnings && Date.parse(p.metMy.warnings.fetchedAt) <= knownBy ? p.metMy.warnings : null;
  const mf = p.metMy?.forecast && Date.parse(p.metMy.forecast.fetchedAt) <= knownBy ? p.metMy.forecast : null;
  if (mw || mf) {
    const active = new Map<string, string>();
    for (const w of mw?.payload ?? []) if (Date.parse(w.validFrom) <= captureMs && captureMs <= Date.parse(w.validTo) && (active.get(w.title) ?? '') < w.validTo) active.set(w.title, w.validTo);
    const localHour = new Date(captureMs + p.schedule.timezone.utcOffsetHours * 3_600_000).getUTCHours();
    const tomorrow = localHour >= p.schedule.metMalaysia.tomorrowFromLocalHour;
    const forecastDate = mf ? mf.payload.dates[tomorrow ? 1 : 0] ?? null : null;
    const rows = mf && forecastDate ? mf.payload.rows.filter((r) => r.date === forecastDate) : [];
    const key = p.schedule.metMalaysia.keyLocations.flatMap((name) => {
      const row = rows.find((r) => r.location === name);
      const text = row ? forecastText(row) : null;
      return row && text ? [{ location: name, text, minTemp: row.minTemp, maxTemp: row.maxTemp }] : [];
    });
    const hazy = rows.filter(hasHaze).map((r) => r.location).sort((a, b) => a.localeCompare(b));
    metMy = {
      warnings: [...active.entries()].map(([title, validTo]) => ({ title, validTo })).sort((a, b) => a.title.localeCompare(b.title)), warningsKnown: mw !== null,
      forecastDate, forecastLabel: forecastDate ? (tomorrow ? 'tomorrow' : 'today') : null, key, hazeCount: hazy.length, hazeLocations: hazy.slice(0, 5),
    };
  }
  const body = { slotId: p.slot.id, captureAt: p.captureAt, airAt: p.airAt, scheduleVersion: p.schedule.version, feeds, countries, elsewhereCount: elsewhere, majorElsewhere, psi, advice, metMy };
  return { ...body, hash: hashWithDomain('AEG-BULLETIN-FACTS-v1', stringifyDecimals(body)) };
}
