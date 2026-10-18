// Public trend for the landing page (AEG-HOME-002): real incidents per day and per hazard domain over the last N days, and per ASEAN country.
// Counted: distinct incidents (latest report per incidentKey) in public, non-synthetic evidence, placed on the UTC day of their EVENT time.
// Nothing here forecasts or estimates people affected; an incident whose event time is older than the window is counted as outside it.
import { ASEAN_COUNTRIES, aseanCountryOfRegion } from '../domains/asean.js';
import type { EvidenceView } from '../types/domain.js';
import { domainOfHazard } from './hazardSummary.js';

export interface TrendDay { date: string; total: number; byDomain: Record<string, number> }
export interface HazardTrend {
  asOf: string;
  days: number;
  series: TrendDay[];
  /** Incidents currently held (not superseded) whose event time is before the first day shown. */
  olderThanWindow: number;
  /** Current incidents (not stale) per ASEAN state; offshore/unknown are those whose region names no ASEAN state. */
  byCountry: { iso3: string; name: string; active: number }[];
  countryUnknown: number;
  remarks: string[];
}

const dayOf = (iso: string): string => iso.slice(0, 10);

export function buildHazardTrend(views: EvidenceView[], nowIso: string, days = 7): HazardTrend {
  const n = Math.min(30, Math.max(1, Math.trunc(days)));
  const real = views.filter((v) => !v.synthetic && !v.flags.includes('SUPERSEDED'));
  const byIncident = new Map<string, EvidenceView>();
  for (const v of real) {
    const current = byIncident.get(v.payload.incidentKey);
    if (!current || (v.publishedAt ?? '') > (current.publishedAt ?? '')) byIncident.set(v.payload.incidentKey, v);
  }
  const end = Date.parse(`${dayOf(nowIso)}T00:00:00Z`);
  const dates = Array.from({ length: n }, (_, i) => new Date(end - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
  const series: TrendDay[] = dates.map((date) => ({ date, total: 0, byDomain: {} }));
  const index = new Map(dates.map((d, i) => [d, i]));
  let older = 0;
  const country = new Map<string, number>(ASEAN_COUNTRIES.map((c) => [c.iso3, 0]));
  let unknown = 0;
  for (const v of byIncident.values()) {
    const when = v.eventTime ? dayOf(v.eventTime) : null;
    const domain = domainOfHazard(v.payload.hazardType);
    if (when !== null && domain !== null) {
      const i = index.get(when);
      if (i !== undefined) { series[i]!.total += 1; series[i]!.byDomain[String(domain)] = (series[i]!.byDomain[String(domain)] ?? 0) + 1; }
      else if (when < dates[0]!) older += 1;
    }
    if (!v.flags.includes('STALE')) {
      const c = aseanCountryOfRegion(v.payload.regionId);
      if (c) country.set(c.iso3, (country.get(c.iso3) ?? 0) + 1); else unknown += 1;
    }
  }
  return {
    asOf: nowIso, days: n, series, olderThanWindow: older,
    byCountry: ASEAN_COUNTRIES.map((c) => ({ iso3: c.iso3, name: c.name, active: country.get(c.iso3) ?? 0 })),
    countryUnknown: unknown,
    remarks: [
      'Counts are incidents held in the Aegis evidence store from the USGS and GDACS live feeds, placed on the UTC day of the event. They are not a complete list of events and not a forecast.',
      'Incidents at sea or whose region names no ASEAN state are counted under "country unknown", not assigned to a country.',
      'No people-affected figure is shown: the live feeds give none.',
    ],
  };
}
