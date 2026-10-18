// Data confidence for the landing-page tile (AEG-HOME-003). PROVISIONAL: the owner asked for a first version now and a later fine-tune
// ("we will come back to fine tune it"), so the formula, the weights (equal) and the band thresholds below are placeholders, stated openly in the
// response. It measures how well the live feeds are working, NOT how accurate any single incident is. Public, non-synthetic evidence only.
//
//   score = round( mean( sourceLiveness, withinValidity, provenance ) )         each component 0..100
//   sourceLiveness  = live sources / expected live sources, a source being live when its last successful poll (source status lastOkAt) was within LIVE_WITHIN_MINUTES
//   withinValidity  = incidents (latest report per incidentKey) not past their validity window / incidents held
//   provenance      = incidents carrying a source URL and a licence reference / incidents held
//   band            = LOW below 50, MEDIUM below 80, HIGH from 80
// With no real incident held the score is null ("not assessed"), never 0 or 100.
import type { EvidenceView, SourceStatus } from '../types/domain.js';

export const LIVE_SOURCE_IDS = ['SRC.USGS.LIVE', 'SRC.GDACS.LIVE'] as const;
export const LIVE_WITHIN_MINUTES = 60;

export interface ConfidenceComponent { key: string; label: string; value: number | null; detail: string }
export interface DataConfidence {
  asOf: string;
  provisional: true;
  score: number | null;
  band: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  components: ConfidenceComponent[];
  note: string;
  remarks: string[];
}

const pct = (part: number, whole: number): number => Math.round((part / whole) * 100);

export function buildDataConfidence(views: EvidenceView[], statuses: SourceStatus[], nowIso: string): DataConfidence {
  const real = views.filter((v) => !v.synthetic && !v.flags.includes('SUPERSEDED'));
  const byIncident = new Map<string, EvidenceView>();
  for (const v of real) {
    const current = byIncident.get(v.payload.incidentKey);
    if (!current || (v.publishedAt ?? '') > (current.publishedAt ?? '')) byIncident.set(v.payload.incidentKey, v);
  }
  const held = [...byIncident.values()];
  const now = Date.parse(nowIso);
  const live = LIVE_SOURCE_IDS.filter((id) => { const st = statuses.find((x) => x.sourceId === id); return st?.lastOkAt != null && now - Date.parse(st.lastOkAt) <= LIVE_WITHIN_MINUTES * 60_000; }).length;
  const base = {
    asOf: nowIso, provisional: true as const,
    note: 'PROVISIONAL formula (equal weights, placeholder thresholds). To be fine-tuned with the owner later. It rates the health of the live feeds, not the accuracy of any single incident.',
  };
  const liveness: ConfidenceComponent = {
    key: 'sourceLiveness', label: 'Live feeds reporting', value: pct(live, LIVE_SOURCE_IDS.length),
    detail: `${live} of ${LIVE_SOURCE_IDS.length} live sources polled successfully within the last ${LIVE_WITHIN_MINUTES} minutes`,
  };
  if (held.length === 0) {
    return {
      ...base, score: null, band: null, components: [liveness],
      remarks: ['No real incident is held, so confidence is not assessed. This is not a score of zero.'],
    };
  }
  const fresh = held.filter((v) => !v.flags.includes('STALE')).length;
  const sourced = held.filter((v) => v.sourceUrl !== null && v.sourceUrl !== '' && v.licenceRef !== '').length;
  const components: ConfidenceComponent[] = [
    liveness,
    { key: 'withinValidity', label: 'Incidents within validity window', value: pct(fresh, held.length), detail: `${fresh} of ${held.length} held incidents are not past their validity window` },
    { key: 'provenance', label: 'Incidents with source and licence', value: pct(sourced, held.length), detail: `${sourced} of ${held.length} carry a source URL and a licence reference` },
  ];
  const score = Math.round(components.reduce((sum, c) => sum + (c.value ?? 0), 0) / components.length);
  return {
    ...base, score, band: score < 50 ? 'LOW' : score < 80 ? 'MEDIUM' : 'HIGH', components,
    remarks: [
      'Counts cover the USGS and GDACS live feeds only. Outbreak, haze and Google air/weather data are not part of this score yet.',
      'No people-affected or casualty figure enters the score: the live feeds give none.',
    ],
  };
}
