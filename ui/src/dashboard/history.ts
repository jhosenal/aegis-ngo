import catalogue from '../../../content/domains/catalogue.json';
import { hazardSymbol } from '../components/HazardIcon.js';
import { loadClosedAhaHistory } from './data.js';

/** One historical incident card from GET /public/hazards/history (contract C0005). Only the fields the UI uses are typed. */
export interface HistoryCard {
  id: string;
  domain: number;
  hazardType: string;
  title: string;
  eventStart: string;
  eventEnd: string | null;
  place: string | null;
  countries: string[];
  alertLevel: { value: string | null; scale: string; note: string };
  rating: { scale: string; value: string | null; rank: number | null };
  location: { latE6: number | null; lonE6: number | null; basis: string; depthKm: number | null };
  measurements: { key: string; label: string; value: number; unit: string | null }[];
  provenance: {
    sourceId: string; sourceName: string; publisher: string; sourcePage: string | null; apiUrl: string; sourceRecordId: string; retrievedAt: string; sourceUpdatedAt: string | null;
    rawSha256: string; licence: { status: string; text: string; attribution: string };
  };
  corroboration: { sourceName?: string; note?: string }[];
  impact?: {
    source: string; statement: string; note: string;
    figures: { kind: 'killed' | 'injured' | 'missing' | 'displaced' | 'affected' | 'cases' | 'deaths'; value: number; qualifier: string | null; quote: string }[];
  } | null;
  region: string;
  tags: string[];
}

export interface HistoryData {
  window: { from: string; to: string };
  builtAt: string;
  remark: string;
  credits: string[];
  cards: HistoryCard[];
}

export type HistoryRangeMs = [number, number];

export function monthStarts(fromIso: string, toDate: Date): number[] {
  const out: number[] = [];
  const first = new Date(`${fromIso.slice(0, 7)}-01T00:00:00Z`);
  for (let t = first; t <= toDate; t = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1))) out.push(t.getTime());
  return out;
}

export function subtractUtcMonths(date: Date, count: number): Date {
  const monthIndex = date.getUTCFullYear() * 12 + date.getUTCMonth() - count;
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex % 12;
  const day = Math.min(date.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month, day, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
}

export function monthEnd(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999);
}

export function monthLabel(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7);
}

export function monthIndexForTime(months: number[], time: number): number {
  let index = 0;
  for (let i = 0; i < months.length && months[i]! <= time; i += 1) index = i;
  return index;
}

export function recentHistoryRange(window: { to: string }): HistoryRangeMs {
  const end = new Date(`${window.to}T23:59:59.999Z`);
  return [subtractUtcMonths(end, 3).getTime(), end.getTime()];
}

export interface HazardSummary {
  asOf: string;
  domains: { number: number; name: string; activeCount: number; activeIsSynthetic: boolean }[];
}

let historyOnce: Promise<HistoryData> | null = null;
let summaryOnce: Promise<HazardSummary> | null = null;

/** The whole history is loaded once per page view and filtered in the browser, so the time slider never waits on the network. */
export function loadHistory(): Promise<HistoryData> {
  historyOnce ??= fetch('/public/hazards/history?limit=1000').then(async (res) => {
    if (!res.ok) throw new Error(`History request failed (${res.status})`);
    const data = await res.json() as HistoryData;
    // CLOSED AHA ADInet reports belong in the archive; if that feed is down the archive still loads.
    const closed = await loadClosedAhaHistory().catch(() => [] as HistoryCard[]);
    return { ...data, cards: [...closed, ...data.cards] };
  }).catch((error: unknown) => { historyOnce = null; throw error; });
  return historyOnce;
}

export function loadSummary(): Promise<HazardSummary> {
  summaryOnce ??= fetch('/public/hazards/summary?limit=1').then(async (res) => {
    if (!res.ok) throw new Error(`Summary request failed (${res.status})`);
    return await res.json() as HazardSummary;
  }).catch((error: unknown) => { summaryOnce = null; throw error; });
  return summaryOnce;
}

/** The catalogue domain number (1 to 7) for a hazard symbol such as "seismic", or null. */
export function domainNumberForSymbol(symbol: string | null): number | null {
  if (!symbol) return null;
  return catalogue.domains.find((domain) => hazardSymbol(domain.name) === symbol)?.number ?? null;
}

export function domainName(number: number): string {
  return catalogue.domains.find((domain) => domain.number === number)?.name ?? `Domain ${number}`;
}

/** Start of a date that may be only a year or a month. */
export function startMs(text: string): number {
  if (/^\d{4}$/.test(text)) return Date.parse(`${text}-01-01T00:00:00Z`);
  if (/^\d{4}-\d{2}$/.test(text)) return Date.parse(`${text}-01T00:00:00Z`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return Date.parse(`${text}T00:00:00Z`);
  return Date.parse(text);
}

export function endMs(card: HistoryCard): number {
  if (card.eventEnd) return Date.parse(card.eventEnd);
  const text = card.eventStart;
  if (/^\d{4}$/.test(text)) return Date.parse(`${text}-12-31T23:59:59.999Z`);
  if (/^\d{4}-\d{2}$/.test(text)) { const [y, m] = text.split('-').map(Number); return Date.UTC(y as number, m as number, 0, 23, 59, 59, 999); }
  return startMs(text) + (/^\d{4}-\d{2}-\d{2}$/.test(text) ? 86_399_999 : 0);
}

export interface HistoryFilter {
  domain: number | null;
  fromMs: number;
  toMs: number;
  text: string;
  scale: string;
  mapOnly: boolean;
}

/** The same rules as the server: a card is kept when its [start, end] overlaps the range; every search word must appear. */
export function filterHistory(cards: HistoryCard[], f: HistoryFilter): HistoryCard[] {
  const terms = f.text.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  return cards.filter((card) => {
    if (f.domain !== null && card.domain !== f.domain) return false;
    if (!(startMs(card.eventStart) <= f.toMs && endMs(card) >= f.fromMs)) return false;
    if (f.scale && card.rating.scale !== f.scale) return false;
    if (f.mapOnly && card.location.latE6 === null) return false;
    if (terms.length > 0) {
      const hay = [card.id, card.title, card.place ?? '', card.countries.join(' '), card.hazardType, card.tags.join(' '), card.alertLevel.value ?? '', card.impact?.statement ?? ''].join(' ').toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  }).sort((a, b) => startMs(b.eventStart) - startMs(a.eventStart) || a.id.localeCompare(b.id));
}

export function formatWhen(card: HistoryCard): string {
  const pretty = (text: string) => (text.length > 10 ? text.slice(0, 10) : text);
  const start = pretty(card.eventStart);
  const end = card.eventEnd ? pretty(card.eventEnd) : null;
  return end && end !== start ? `${start} to ${end}` : start;
}

export function figureLine(card: HistoryCard): string | null {
  const figures = card.impact?.figures ?? [];
  if (figures.length === 0) return null;
  return figures.map((f) => `${f.kind}: ${f.qualifier ? `${f.qualifier} ` : ''}${f.value.toLocaleString('en')}`).join(' · ');
}

export const symbolForDomain = (number: number): ReturnType<typeof hazardSymbol> => hazardSymbol(domainName(number));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "11 Sep 2026" from an ISO date or datetime; a year ("2019") or a month ("2019-05") stays as precise as the source gave it. */
export function prettyDate(text: string): string {
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (day) return `${Number(day[3])} ${MONTHS[Number(day[2]) - 1]} ${day[1]}`;
  const month = /^(\d{4})-(\d{2})$/.exec(text);
  if (month) return `${MONTHS[Number(month[2]) - 1]} ${month[1]}`;
  return text;
}

/** "5 Aug 2011 to 9 Jan 2012", or a single date. */
export function whenLabel(card: HistoryCard): string {
  const start = prettyDate(card.eventStart);
  const end = card.eventEnd ? prettyDate(card.eventEnd) : null;
  return end && end !== start ? `${start} to ${end}` : start;
}

/** Splits the machine title into a headline and a small reference: "M 7.5 - 72 km N of Palu" and "Eruption Kanlaon (GDACS VO 1000152)". */
export function splitTitle(card: HistoryCard): { headline: string; reference: string | null } {
  const quake = /^M\s*([\d.]+)\s*-\s*(.+)$/.exec(card.title);
  if (quake) return { headline: quake[2]!, reference: null };
  const gdacs = /^(.*?)\s*\((GDACS [A-Z]{2} \d+)\)$/.exec(card.title);
  if (gdacs) return { headline: gdacs[1]!, reference: gdacs[2]! };
  const haze = /^(Haze in [^:]+):\s*(.+?)\s*\(peak \d+\)$/.exec(card.title);
  if (haze) return { headline: haze[1]!, reference: null };
  return { headline: card.title, reference: null };
}

export interface FactTile { key: string; value: string; label: string; note: string | null; tone: 'plain' | 'impact' }

const MEASURE_LABEL: Record<string, string> = {
  magnitude: 'Magnitude', maxWind: 'Max wind', gdacsMagnitude: 'Flood index', peakPsi24h: 'Peak 24-hour PSI', daysAbove100: 'Days above 100', daysAbove200: 'Days above 200',
};
const KIND_LABEL: Record<string, string> = { killed: 'Killed', injured: 'Injured', missing: 'Missing', displaced: 'Displaced', affected: 'Affected', cases: 'Cases', deaths: 'Deaths' };

/** The few numbers worth reading first: the measurement(s), then any figures the source states. */
export function factTiles(card: HistoryCard): FactTile[] {
  const tiles: FactTile[] = [];
  for (const m of card.measurements) {
    const label = MEASURE_LABEL[m.key] ?? m.label.split(' as ')[0]!;
    const unit = m.unit === 'days' && m.value === 1 ? 'day' : m.unit;
    const value = unit && ['km/h', 'PSI', 'day', 'days'].includes(unit) ? `${m.value.toLocaleString('en')} ${unit}` : m.value.toLocaleString('en');
    tiles.push({ key: m.key, value, label, note: m.key === 'peakPsi24h' ? 'noon readings' : null, tone: 'plain' });
  }
  if (card.location.depthKm !== null && card.location.latE6 !== null) tiles.push({ key: 'depth', value: `${card.location.depthKm} km`, label: 'Depth', note: null, tone: 'plain' });
  for (const f of card.impact?.figures ?? []) {
    tiles.push({ key: f.kind, value: f.value.toLocaleString('en'), label: KIND_LABEL[f.kind] ?? f.kind, note: f.qualifier, tone: f.kind === 'cases' ? 'plain' : 'impact' });
  }
  return tiles;
}

/** The short credit that stays visible on the card; the full attribution text is in the provenance panel. */
export function creditLine(card: HistoryCard): string {
  const status = card.provenance.licence.status;
  const id = card.provenance.sourceName;
  if (/GDACS/i.test(id)) return 'Source: GDACS, CC BY 4.0 · Indicative only; not for decision making without alternate sources.';
  if (/PSI/i.test(id)) return 'Contains information from PSI, data.gov.sg (National Environment Agency), Singapore Open Data Licence v1.0.';
  if (/WHO|World Health/i.test(id) || status === 'STATED_NON_COMMERCIAL') return 'Source: World Health Organization, Disease Outbreak News · educational, non-commercial use.';
  return card.provenance.licence.attribution;
}

export function retrievedLabel(card: HistoryCard): string {
  return `Retrieved ${prettyDate(card.provenance.retrievedAt)}`;
}
