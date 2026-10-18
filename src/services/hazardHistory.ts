// Ten-year ASEAN incident history (AEG-HIST-001): loads content/history/hazard-history.json (built offline by tools/build-history.mjs from saved raw
// files), validates it, and answers date-range, domain, rating, text-search and map-location queries. Pure functions; the route only parses input.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { CardField } from '../types/domain.js';

const NullableString = z.string().nullable();
const Provenance = z.object({
  sourceId: z.string(), sourceName: z.string(), publisher: z.string(),
  licence: z.object({ status: z.string(), text: z.string(), attribution: z.string() }).strict(),
  sourcePage: NullableString, apiUrl: z.string().regex(/^https:\/\//), sourceRecordId: z.string(), publishedAt: NullableString, sourceUpdatedAt: NullableString,
  retrievedAt: z.string(), rawFile: z.string(), rawSha256: z.string().regex(/^[0-9a-f]{64}$/), adapterVersion: z.string(), method: z.string(),
  note: z.string().optional(),
}).strict();

const Figure = z.object({ kind: z.enum(['killed', 'injured', 'missing', 'displaced', 'affected', 'cases', 'deaths']), value: z.number().int().nonnegative(), qualifier: NullableString, quote: z.string() }).strict();
const Impact = z.object({
  source: z.string(), statement: z.string(), figures: z.array(Figure), note: z.string(), productUpdated: NullableString,
  apiUrl: z.string(), retrievedAt: z.string(), rawFile: z.string(), rawSha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();
export type HistoryImpact = z.infer<typeof Impact>;

const Card = z.object({
  id: z.string().regex(/^HX-[1-7]-(USGS|GDACS|WHO|PSI)-[A-Za-z0-9_.-]+$/),
  domain: z.number().int().min(1).max(7),
  status: z.literal('SOURCED'),
  hazardType: z.string(),
  title: z.string().min(3).max(200),
  eventStart: z.string(),
  eventEnd: NullableString,
  place: NullableString,
  countries: z.array(z.string()),
  alertLevel: z.object({ value: NullableString, scale: z.string(), note: z.string() }).strict(),
  rating: z.object({ scale: z.string(), value: NullableString, rank: z.number().int().nullable() }).strict(),
  location: z.object({ latE6: z.number().int().nullable(), lonE6: z.number().int().nullable(), basis: z.string(), depthKm: z.number().nullable() }).strict(),
  affectedPeopleEstimate: z.null(),
  measurements: z.array(z.object({ key: z.string(), label: z.string(), value: z.number(), unit: NullableString }).strict()),
  provenance: Provenance,
  corroboration: z.array(Provenance.partial({ licence: true, method: true, adapterVersion: true }).passthrough()),
  region: z.enum(['asean', 'offshore', 'unlabelled-in-box']),
  /** GLIDE number when GDACS gives one: the key to EM-DAT and ReliefWeb records. */
  glide: NullableString.optional(),
  /** Casualty and displacement figures exactly as the source states them; null when the source states none. */
  impact: Impact.nullable().optional(),
  tags: z.array(z.string()).min(5),
}).strict();
export type HistoryCard = z.infer<typeof Card>;

const HistoryDoc = z.object({
  version: z.string(), builtAt: z.string(), adapterVersion: z.string(),
  window: z.object({ from: z.string(), to: z.string() }).strict(),
  selection: z.string(), remark: z.string(), counts: z.record(z.string(), z.unknown()), reconciliation: z.record(z.string(), z.unknown()),
  cards: z.array(Card).min(1),
}).strict().superRefine((d, ctx) => {
  const ids = new Set<string>();
  for (const c of d.cards) {
    if (ids.has(c.id)) ctx.addIssue({ code: 'custom', message: `duplicate card ${c.id}` });
    ids.add(c.id);
    if ((c.location.latE6 === null) !== (c.location.lonE6 === null)) ctx.addIssue({ code: 'custom', message: `${c.id}: half a location` });
  }
});
export type HistoryDoc = z.infer<typeof HistoryDoc>;

const historyFile = fileURLToPath(new URL('../../content/history/hazard-history.json', import.meta.url));
export function loadHistory(file: string = historyFile): HistoryDoc {
  return HistoryDoc.parse(JSON.parse(readFileSync(file, 'utf8')));
}

export interface HistoryQuery {
  /** ISO date (YYYY-MM-DD) or datetime, inclusive. */
  from?: string;
  to?: string;
  domain?: number;
  /** Minimum rating rank within the card's own scale (GDACS 0..2, PAGER 0..3). Cards with no rank are excluded when this is set. */
  minRank?: number;
  scale?: string;
  /** Whole-word, case-insensitive; every term must match somewhere in title, place, countries, hazard, tags or id. */
  q?: string;
  hasLocation?: boolean;
  limit?: number;
}

export class HistoryQueryError extends Error {}

function dayBounds(from?: string, to?: string): { fromMs: number; toMs: number } {
  const parse = (text: string, end: boolean): number => {
    if (!/^\d{4}-\d{2}-\d{2}(T[0-9:.]+Z?)?$/.test(text)) throw new HistoryQueryError(`not a date: ${text.slice(0, 30)}`);
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
    const ms = Date.parse(dateOnly ? `${text}T${end ? '23:59:59.999' : '00:00:00.000'}Z` : (text.endsWith('Z') ? text : `${text}Z`));
    if (!Number.isFinite(ms)) throw new HistoryQueryError(`not a date: ${text.slice(0, 30)}`);
    return ms;
  };
  return { fromMs: from ? parse(from, false) : Number.NEGATIVE_INFINITY, toMs: to ? parse(to, true) : Number.POSITIVE_INFINITY };
}

/** Start of a date that may be only a year (2019) or a month (2019-05). */
function startMs(text: string): number {
  if (/^\d{4}$/.test(text)) return Date.parse(`${text}-01-01T00:00:00Z`);
  if (/^\d{4}-\d{2}$/.test(text)) return Date.parse(`${text}-01T00:00:00Z`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return Date.parse(`${text}T00:00:00Z`);
  return Date.parse(text);
}
/** A year-only or month-only date covers that whole year or month, so a date range inside it still finds the card. */
function endMs(text: string): number {
  if (/^\d{4}$/.test(text)) return Date.parse(`${text}-12-31T23:59:59.999Z`);
  if (/^\d{4}-\d{2}$/.test(text)) { const [y, m] = text.split('-').map(Number); return Date.UTC(y as number, m as number, 0, 23, 59, 59, 999); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return Date.parse(`${text}T23:59:59.999Z`);
  return Date.parse(text);
}

function haystack(c: HistoryCard): string {
  return [c.id, c.title, c.place ?? '', c.countries.join(' '), c.hazardType, c.tags.join(' '), c.alertLevel.value ?? '', c.impact?.statement ?? ''].join(' ').toLowerCase();
}

export function queryHistory(doc: HistoryDoc, q: HistoryQuery): HistoryCard[] {
  const { fromMs, toMs } = dayBounds(q.from, q.to);
  if (fromMs > toMs) throw new HistoryQueryError('from is after to');
  const terms = (q.q ?? '').toLowerCase().split(/\s+/).filter((t) => t.length > 0).slice(0, 8);
  const matched = doc.cards.filter((c) => {
    const start = startMs(c.eventStart);
    const end = c.eventEnd ? Date.parse(c.eventEnd) : endMs(c.eventStart);
    if (!(start <= toMs && (Number.isFinite(end) ? end : start) >= fromMs)) return false;   // overlap with the range; no end = a point in time
    if (q.domain !== undefined && c.domain !== q.domain) return false;
    if (q.scale !== undefined && c.rating.scale.toLowerCase() !== q.scale.toLowerCase()) return false;
    if (q.minRank !== undefined && (c.rating.rank === null || c.rating.rank < q.minRank)) return false;
    if (q.hasLocation !== undefined && (c.location.latE6 !== null) !== q.hasLocation) return false;
    if (terms.length > 0) { const h = haystack(c); if (!terms.every((t) => h.includes(t))) return false; }
    return true;
  });
  matched.sort((a, b) => b.eventStart.localeCompare(a.eventStart) || a.id.localeCompare(b.id));
  return matched.slice(0, Math.min(1000, Math.max(1, q.limit ?? 500)));
}

/** The same field list an incident card carries, so existing card rendering can be reused. */
export function cardFields(c: HistoryCard): CardField[] {
  const has = c.location.latE6 !== null && c.location.lonE6 !== null;
  return [
    { key: 'hazardType', label: 'Hazard type', value: c.hazardType, unit: null, epistemic: 'fact' },
    { key: 'alertLevel', label: `Alert level (${c.alertLevel.scale})`, value: c.alertLevel.value, unit: null, epistemic: c.alertLevel.value === null ? 'unknown' : 'fact' },
    { key: 'eventTime', label: 'Event start', value: c.eventStart, unit: null, epistemic: 'fact' },
    { key: 'eventEnd', label: 'Event end', value: c.eventEnd, unit: null, epistemic: c.eventEnd === null ? 'unknown' : 'fact' },
    { key: 'affectedPeopleEstimate', label: 'Affected people estimate', value: null, unit: 'people', epistemic: 'unknown' },
    { key: 'regionId', label: 'Place', value: c.place, unit: null, epistemic: c.place === null ? 'unknown' : 'fact' },
    { key: 'location', label: `Location (${c.location.basis})`, value: has ? `${c.location.latE6},${c.location.lonE6}` : null, unit: has ? 'micro-degrees (latitude, longitude)' : null, epistemic: has ? 'fact' : 'unknown' },
    ...c.measurements.map((m) => ({ key: m.key, label: m.label, value: m.value, unit: m.unit, epistemic: 'fact' as const })),
    ...(c.impact?.figures ?? []).map((f) => ({ key: f.kind, label: `${f.kind[0]!.toUpperCase()}${f.kind.slice(1)} (as stated by ${c.impact!.source}${f.qualifier ? `, "${f.qualifier}"` : ''})`, value: f.value, unit: 'people', epistemic: 'fact' as const })),
  ];
}

export function historyResponse(doc: HistoryDoc, cards: HistoryCard[], q: HistoryQuery, includeFields = false) {
  const credits = [...new Set(cards.flatMap((c) => [c.provenance.licence.attribution, ...c.corroboration.map((x) => x.licence?.attribution).filter((a): a is string => typeof a === 'string')]))];
  return {
    window: doc.window, builtAt: doc.builtAt, query: q, matched: cards.length, totalCards: doc.cards.length,
    remark: doc.remark, selection: doc.selection, credits,
    cards: includeFields ? cards.map((c) => ({ ...c, fields: cardFields(c) })) : cards,
  };
}
