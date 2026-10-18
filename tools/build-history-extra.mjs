// Stage 2 of the history build (AEG-HIST-002). Reads content/history/hazard-history.json (stage 1: GDACS + USGS cards) and adds:
//   1. impact statements quoted from USGS "impact-text" products, with conservative figure parsing (killed, injured, missing, displaced);
//   2. WHO Disease Outbreak News cards for ASEAN countries (domain 5);
//   3. Singapore haze-episode cards derived from daily 24-hour PSI readings (domain 4).
// Offline and deterministic; every raw file's SHA-256 is re-checked. Run after build-history.mjs: node tools/build-history-extra.mjs
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const OUT = `${root}content/history/hazard-history.json`;
const doc = JSON.parse(readFileSync(OUT, 'utf8'));
// make the stage idempotent: drop anything a previous run added
doc.cards = doc.cards.filter((c) => /^HX-[123]-/.test(c.id) || /^HX-7-/.test(c.id));
doc.cards.forEach((c) => { delete c.impact; });
const ADAPTER = 'history-extra-1';
const sha = (b) => createHash('sha256').update(b).digest('hex');
function verified(path, expect) {
  const bytes = readFileSync(`${root}${path}`);
  if (expect && sha(bytes) !== expect) throw new Error(`hash mismatch: ${path}`);
  return bytes;
}

// ---------- 1. USGS impact statements ----------
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50 };
const NUMRE = '(\\d[\\d,]*|' + Object.keys(NUM).join('|') + ')';
const QUAL = '(at least|more than|over|about|approximately|nearly|around|up to)';
const toNum = (t) => { const k = t.toLowerCase(); return NUM[k] ?? Number(k.replace(/,/g, '')); };
const KINDS = [
  ['killed', new RegExp(`(?:${QUAL}\\s+)?${NUMRE}\\s+(?:more\\s+)?(?:persons?|people|children|residents|villagers|students|workers)?\\s*(?:were\\s+)?(?:killed|dead|died)`, 'i')],
  ['injured', new RegExp(`(?:${QUAL}\\s+)?${NUMRE}\\s+(?:more\\s+)?(?:persons?|people|children|residents)?\\s*(?:were\\s+)?injured`, 'i')],
  ['missing', new RegExp(`(?:${QUAL}\\s+)?${NUMRE}\\s+(?:persons?|people)?\\s*(?:were\\s+)?missing`, 'i')],
  ['displaced', new RegExp(`(?:${QUAL}\\s+)?${NUMRE}\\s+(?:persons?|people)?\\s*(?:were\\s+)?(?:displaced|homeless|evacuated)`, 'i')],
];
function parseFigures(statement) {
  // headline sentence only: later sentences list sub-regional counts that must not be added up or mistaken for the total
  const first = statement.split(/\.\s+(?=[A-Z])/)[0];
  const out = [];
  for (const [kind, re] of KINDS) {
    const m = re.exec(first);
    if (!m) continue;
    const value = toNum(m[2]);
    if (!Number.isFinite(value)) continue;
    out.push({ kind, value, qualifier: m[1] ? m[1].toLowerCase() : null, quote: m[0].trim() });
  }
  return out;
}
const detailManifest = JSON.parse(readFileSync(`${root}records/sources/history-2016-2026/usgs-detail/manifest.json`, 'utf8'));
let withStatement = 0; let withKilled = 0;
for (const c of doc.cards) {
  if (c.provenance.sourceId !== 'SRC.USGS.FDSN') continue;
  const m = detailManifest.files.find((f) => f.eventId === c.provenance.sourceRecordId);
  if (!m || !m.file) { c.impact = null; c.tags.push('impact:not-retrieved'); continue; }
  const bytes = verified(`records/sources/history-2016-2026/usgs-detail/${m.file}`, m.sha256);
  const detail = JSON.parse(bytes.toString('utf8'));
  const prod = detail.properties?.products?.['impact-text']?.[0];
  const text = prod?.contents?.['']?.bytes;
  if (typeof text !== 'string' || text.trim() === '') { c.impact = null; c.tags.push('impact:not-stated'); continue; }
  const statement = text.replace(/\s+/g, ' ').trim();
  const figures = parseFigures(statement);
  c.impact = {
    source: 'USGS impact-text product', statement, figures,
    note: 'Quoted from the USGS event page. Figures are parsed from the first sentence of the statement and are as stated by USGS; "at least" and similar qualifiers are kept.',
    productUpdated: prod.contents[''].lastModified ? new Date(prod.contents[''].lastModified).toISOString() : null,
    apiUrl: m.apiUrl, retrievedAt: m.retrievedAt, rawFile: `records/sources/history-2016-2026/usgs-detail/${m.file}`, rawSha256: m.sha256,
  };
  c.tags.push('impact:stated');
  if (figures.some((f) => f.kind === 'killed')) { c.tags.push('impact:killed-stated'); withKilled += 1; }
  withStatement += 1;
}

// ---------- 2. WHO Disease Outbreak News ----------
const ASEAN = [['Indonesia', 'Indonesia'], ['Philippines', 'Philippines'], ['Malaysia', 'Malaysia'], ['Thailand', 'Thailand'], ['Myanmar', 'Myanmar'], ['Viet Nam', 'Viet Nam'],
  ['Vietnam', 'Viet Nam'], ['Cambodia', 'Cambodia'], ['Lao', 'Lao PDR'], ['Singapore', 'Singapore'], ['Brunei', 'Brunei'], ['Timor', 'Timor-Leste']];
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const whoManifest = JSON.parse(readFileSync(`${root}records/sources/who-don-2016-2026/manifest.json`, 'utf8'));
const WHO_LIC = { status: 'STATED_NON_COMMERCIAL', text: 'WHO terms of use (read 2026-10-16): material may be used with acknowledgement of WHO as the source and the URL; "any use other than for educational or other non-commercial purposes require[s] explicit, prior authorization in writing".', attribution: 'Source: World Health Organization, Disease Outbreak News (URL on the card). Used for educational, non-commercial purposes.' };
function donDate(item) {
  const url = String(item.UrlName ?? ''); const don = String(item.DonId ?? '');
  let m = /^(\d{4})_(\d{2})_(\d{2})/.exec(url);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, basis: 'date in the WHO item URL name' };
  m = /^(\d{1,2})-([a-z]+)-(\d{4})/.exec(url);
  if (m && MONTHS[m[2]]) return { date: `${m[3]}-${String(MONTHS[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}`, basis: 'date in the WHO item URL name' };
  const yearOf = /^(\d{4})/.exec(don) ?? /^(\d{4})/.exec(url);
  const pub = String(item.PublicationDate ?? '').slice(0, 10);
  if (yearOf && pub.startsWith(yearOf[1])) return { date: pub, basis: 'WHO publication date (matches the item year)' };
  if (yearOf) return { date: yearOf[1], basis: 'year from the WHO item id only; WHO republished it later' };
  return { date: pub, basis: 'WHO publication date' };
}

// ---------- 2a. WHO case and death counts from the opening sentences (conservative) ----------
const WORD_NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const WNUM = '(\\d[\\d,]*|a|an|' + Object.keys(WORD_NUM).filter((k) => k.length > 2).join('|') + ')';
const CASE_RE = new RegExp(`\\b${WNUM}\\s+((?:[A-Za-z-]+\\s+){0,3}?)cases?\\b`, 'gi');
const DEATH_RE = new RegExp(`\\b${WNUM}\\s+(?:[A-Za-z-]+\\s+){0,2}?(?:deaths?|fatalit(?:y|ies))\\b`, 'gi');
const plain = (h) => String(h ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#?\w+;/g, ' ').replace(/\s+/g, ' ').trim();
const COUNTRY_ALIAS = { 'Lao PDR': ['lao'], 'Viet Nam': ['viet nam', 'vietnam'], Philippines: ['philippines'], 'Timor-Leste': ['timor'], Brunei: ['brunei'] };
const MONTH_INDEX = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
/** A sentence fits the event when every year it names is the event's year, or a month within the 4 months before the notice ("December 2023" for a January 2024 notice). */
function sentenceFits(sentence, eventDate) {
  const eventMs = Date.parse(/^\d{4}$/.test(eventDate) ? `${eventDate}-01-01` : eventDate);
  const eventYear = new Date(eventMs).getUTCFullYear();
  for (const m of sentence.matchAll(/\b(19|20)\d{2}\b/g)) {
    const year = Number(m[0]);
    if (year === eventYear) continue;
    const before = sentence.slice(Math.max(0, m.index - 24), m.index).toLowerCase();
    const month = /(january|february|march|april|may|june|july|august|september|october|november|december)\s*$/.exec(before);
    if (month) {
      const diff = (eventMs - Date.UTC(year, MONTH_INDEX[month[1]], 1)) / 86_400_000;
      if (diff >= -31 && diff <= 120) continue;
    }
    return false;
  }
  return true;
}
function whoImpact(item, countries, eventDate) {
  const text = plain(item.Overview) || plain(item.Summary);
  const allSentences = text.split(/(?<=[.!?])\s+(?=[A-Z0-9])/).slice(0, 2);
  const opening = allSentences.join(' ');
  // a sentence that speaks of another year ("In 2022, ... six deaths") is about another period and must not be read as this event's count
  const sentences = allSentences.filter((sentence) => sentenceFits(sentence, eventDate));
  if (opening === '') return { impact: null, why: 'no-text' };
  const lower = opening.toLowerCase();
  const names = countries.flatMap((c) => COUNTRY_ALIAS[c] ?? [c.toLowerCase()]);
  // guard: WHO sometimes files a note under another country's title; extract only when the opening names this country
  if (!names.some((n) => lower.includes(n)) && !/\b(the country|national|ministry of health)\b/i.test(opening)) return { impact: null, why: 'country-not-in-opening' };
  if (!names.some((n) => lower.includes(n))) return { impact: null, why: 'country-not-in-opening' };
  const counted = sentences.join(' ');
  const found = [];
  const total = new RegExp(`\\btotal of ${WNUM}\\s+((?:[A-Za-z-]+\\s+){0,3}?)cases?\\b`, 'i').exec(counted);
  if (total) {
    const v = WORD_NUM[total[1].toLowerCase()] ?? Number(total[1].replace(/,/g, ''));
    if (Number.isFinite(v)) found.push({ kind: 'cases', value: v, qualifier: null, quote: total[0].trim() });
  }
  for (const m of total ? [] : counted.matchAll(CASE_RE)) {
    const words = m[2].toLowerCase();
    if (/sample|environmental|isolate/.test(words)) continue;
    const value = WORD_NUM[m[1].toLowerCase()] ?? Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    const q = /laboratory[- ]confirmed|lab-confirmed/.test(words) ? 'laboratory-confirmed' : /confirmed/.test(words) ? 'confirmed' : /suspected/.test(words) ? 'suspected' : /probable/.test(words) ? 'probable' : null;
    found.push({ kind: 'cases', value, qualifier: q, quote: m[0].trim() });
  }
  for (const m of counted.matchAll(DEATH_RE)) {
    const value = WORD_NUM[m[1].toLowerCase()] ?? Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(value)) found.push({ kind: 'deaths', value, qualifier: null, quote: m[0].trim() });
  }
  // more than one distinct number for the same kind means several periods or places: keep the statement, state no figure
  const figures = [];
  for (const kind of ['cases', 'deaths']) {
    const of = found.filter((f) => f.kind === kind);
    const distinct = new Set(of.map((f) => f.value));
    if (of.length > 0 && distinct.size === 1) figures.push(of[0]);
  }
  const statement = opening.length > 520 ? `${opening.slice(0, 517)}...` : opening;
  return { impact: { statement, figures }, why: figures.length ? 'figures' : 'statement-only' };
}

let whoRaw = 0; let whoKept = 0;
const whoStats = { figures: 0, statementOnly: 0, guarded: 0, noText: 0 };
const seenDon = new Set();
for (const f of whoManifest.files) {
  if (!f.file) continue;
  const bytes = verified(`records/sources/who-don-2016-2026/${f.file}`, f.sha256);
  for (const item of JSON.parse(bytes.toString('utf8')).value ?? []) {
    whoRaw += 1;
    const title = String(item.Title ?? '').replace(/\s+/g, ' ').trim();
    const tail = title.split(/\s[–-]\s|–/).pop() ?? '';
    const hit = ASEAN.filter(([needle]) => tail.toLowerCase().includes(needle.toLowerCase()));
    if (hit.length === 0) continue;
    const when = donDate(item);
    if (Number(when.date.slice(0, 4)) < 2016) continue;
    const key = String(item.UrlName || item.Id || item.DonId);   // DonId is not unique (several notices carry "2019DON")
    if (seenDon.has(key)) continue;
    seenDon.add(key);
    const countries = [...new Set(hit.map(([, c]) => c))];
    const extracted = whoImpact(item, countries, when.date);
    if (extracted.why === 'figures') whoStats.figures += 1; else if (extracted.why === 'statement-only') whoStats.statementOnly += 1;
    else if (extracted.why === 'country-not-in-opening') whoStats.guarded += 1; else whoStats.noText += 1;
    const whoImpactObject = extracted.impact === null ? null : {
      source: 'WHO Disease Outbreak News', statement: extracted.impact.statement, figures: extracted.impact.figures,
      note: 'Counts are parsed from the opening sentences of the WHO notice and describe the cases WHO was notified of, not the whole outbreak. The quoted text is the check.',
      productUpdated: item.LastModified ?? null, apiUrl: f.apiUrl, retrievedAt: f.retrievedAt, rawFile: `records/sources/who-don-2016-2026/${f.file}`, rawSha256: f.sha256,
    };
    const slug = key.replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 60);
    const disease = title.split(/\s[–-]\s|–/)[0].trim();
    doc.cards.push({
      id: `HX-5-WHO-${slug}`, domain: 5, status: 'SOURCED', hazardType: 'OUTBREAK', title,
      eventStart: when.date, eventEnd: null, place: countries.join(', '), countries,
      alertLevel: { value: null, scale: 'none', note: 'WHO Disease Outbreak News items carry no alert rating' },
      rating: { scale: 'none', value: null, rank: null },
      location: { latE6: null, lonE6: null, basis: 'unknown: a national outbreak report has no single point', depthKm: null },
      affectedPeopleEstimate: null, measurements: [],
      provenance: {
        sourceId: 'SRC.WHO.DON', sourceName: 'WHO Disease Outbreak News (public news API)', publisher: 'World Health Organization', licence: WHO_LIC,
        sourcePage: item.ItemDefaultUrl ? `https://www.who.int/emergencies/disease-outbreak-news/item${item.ItemDefaultUrl}` : null,
        apiUrl: f.apiUrl, sourceRecordId: key, publishedAt: item.PublicationDate ?? null, sourceUpdatedAt: item.LastModified ?? null,
        retrievedAt: f.retrievedAt, rawFile: `records/sources/who-don-2016-2026/${f.file}`, rawSha256: f.sha256, adapterVersion: ADAPTER,
        method: `HTTP GET, OData JSON; event date basis: ${when.basis}`,
      },
      corroboration: [], region: 'asean', impact: whoImpactObject,
      tags: ['source:WHO', 'domain:5', 'hazard:outbreak', `year:${when.date.slice(0, 4)}`, 'region:asean', 'scale:none', 'rating-rank:none', 'location:unknown',
        'affected:unknown', 'status:sourced', 'licence:non-commercial-stated', extracted.why === 'figures' ? 'impact:stated' : extracted.why === 'statement-only' ? 'impact:no-count-in-opening' : 'impact:not-extracted', `disease:${disease.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}`,
        ...countries.map((c) => `country:${c.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`)],
    });
    whoKept += 1;
  }
}

// ---------- 3. Singapore haze episodes from daily 24-hour PSI ----------
const psiManifest = JSON.parse(readFileSync(`${root}records/sources/psi-2016-2026/manifest.json`, 'utf8'));
const days = [];
for (const m of psiManifest.months) {
  const parsed = JSON.parse(verified(`records/sources/psi-2016-2026/${m.file}`, m.sha256).toString('utf8'));
  for (const d of parsed.days) {
    const item = d.body?.items?.[0];
    const r = item?.readings?.psi_twenty_four_hourly;
    if (d.httpStatus !== 200 || !r || !String(item.timestamp).startsWith(d.date)) { days.push({ date: d.date, psi: null, month: m }); continue; }
    const regions = Object.entries(r).filter(([k, v]) => k !== 'national' && Number.isFinite(v));
    const top = regions.reduce((a, b) => (b[1] > a[1] ? b : a), ['none', -1]);
    days.push({ date: d.date, psi: Math.max(r.national ?? -1, top[1]), region: top[0], month: m });
  }
}
const band = (v) => (v > 300 ? ['Hazardous', 3] : v > 200 ? ['Very Unhealthy', 2] : v > 100 ? ['Unhealthy', 1] : ['Moderate or better', 0]);
const episodes = [];
let cur = null; let gap = 0;
for (const d of days) {
  const bad = d.psi !== null && d.psi > 100;
  if (bad) {
    if (!cur) cur = { start: d.date, end: d.date, days: [] };
    cur.end = d.date; cur.days.push(d); gap = 0;
  } else if (cur) {
    gap += 1;
    if (gap > 2) { episodes.push(cur); cur = null; gap = 0; }
  }
}
if (cur) episodes.push(cur);
const PSI_ATTR = (date) => `Contains information from PSI accessed on ${date} from data.gov.sg (National Environment Agency, Singapore), made available under the terms of the Singapore Open Data Licence version 1.0 (https://data.gov.sg/open-data-licence).`;
const sampled = days.filter((d) => d.psi !== null).length;
const lastReading = [...days].reverse().find((d) => d.psi !== null)?.date ?? null;
const dayBefore = (iso) => new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
for (const ep of episodes) {
  const peak = ep.days.reduce((a, b) => (b.psi > a.psi ? b : a));
  const [bandName, rank] = band(peak.psi);
  const monthsUsed = [...new Map(ep.days.map((d) => [d.month.month, d.month])).values()];
  const mk = (m, note) => ({
    sourceId: 'SRC.DATAGOVSG.PSI', sourceName: 'data.gov.sg PSI (24-hour PSI by region), v1 API', publisher: 'National Environment Agency, Singapore',
    licence: { status: 'STATED_BY_PUBLISHER', text: 'Singapore Open Data Licence v1.0 (data.gov.sg, read 2026-10-16): worldwide, perpetual, royalty-free; commercial and non-commercial use allowed; a conspicuous source notice and a link to the licence are required.', attribution: PSI_ATTR(m.retrievedAt.slice(0, 10)) },
    sourcePage: 'https://data.gov.sg/', apiUrl: 'https://api.data.gov.sg/v1/environment/psi?date_time=YYYY-MM-DDT12:00:00 (one request per day)',
    sourceRecordId: `psi-${m.month}`, publishedAt: null, sourceUpdatedAt: null, retrievedAt: m.retrievedAt,
    rawFile: `records/sources/psi-2016-2026/${m.file}`, rawSha256: m.sha256, adapterVersion: ADAPTER, method: 'HTTP GET, JSON, one reading per day at 12:00 local', ...(note ? { note } : {}),
  });
  const primary = monthsUsed.find((m) => m.month === peak.month.month) ?? monthsUsed[0];
  const above200 = ep.days.filter((d) => d.psi > 200).length;
  doc.cards.push({
    id: `HX-4-PSI-${ep.start}`, domain: 4, status: 'SOURCED', hazardType: 'HAZE',
    title: `Haze in Singapore: 24-hour PSI above 100 from ${ep.start} to ${ep.end} (peak ${peak.psi})`,
    eventStart: `${ep.start}T00:00:00Z`, eventEnd: `${ep.end}T23:59:59Z`, place: 'Singapore', countries: ['Singapore'],
    alertLevel: { value: bandName.toUpperCase(), scale: 'NEA PSI band (24-hour)', note: 'band of the highest daily reading in the episode, using the NEA bands 101-200 Unhealthy, 201-300 Very Unhealthy, above 300 Hazardous' },
    rating: { scale: 'NEA PSI band (24-hour)', value: bandName, rank },
    location: { latE6: 1_357_350, lonE6: 103_820_000, basis: 'central region label point from the PSI response metadata; the haze is regional and its source is not located here', depthKm: null },
    affectedPeopleEstimate: null,
    measurements: [
      { key: 'peakPsi24h', label: `Highest 24-hour PSI (any region) on ${peak.date}, one reading per day at 12:00 local`, value: peak.psi, unit: 'PSI' },
      { key: 'daysAbove100', label: 'Days with 24-hour PSI above 100 (one reading per day)', value: ep.days.length, unit: 'days' },
      { key: 'daysAbove200', label: 'Days with 24-hour PSI above 200 (one reading per day)', value: above200, unit: 'days' },
    ],
    provenance: mk(primary, null),
    corroboration: monthsUsed.filter((m) => m.month !== primary.month).map((m) => mk(m, 'additional month of the same episode')),
    region: 'asean', impact: null,
    tags: ['source:NEA-PSI', 'domain:4', 'hazard:haze', `year:${ep.start.slice(0, 4)}`, 'region:asean', 'scale:nea-psi-band', `rating-rank:${rank}`, 'location:label-point',
      'affected:unknown', 'status:sourced', 'licence:sodl-1.0', 'impact:not-stated', 'country:singapore',
      ...(lastReading && ep.end >= dayBefore(lastReading) ? ['period:ongoing-or-recent'] : [])],
  });
}


// ---------- 4. optional EM-DAT figures (owner-supplied export; off unless --include-emdat) ----------
let emdatMerged = 0;
if (process.argv.includes('--include-emdat')) {
  const overridesFile = `${root}data/emdat-overrides.json`;
  const ov = JSON.parse(readFileSync(overridesFile, 'utf8'));
  for (const card of doc.cards) {
    const o = ov.overrides?.[card.id];
    if (!o || card.impact) continue;               // never overwrite a figure a primary source already states
    card.impact = {
      source: o.source, statement: `${o.figures.map((f) => f.quote).join('; ')} (EM-DAT record ${o.disNo ?? 'n/a'})`, figures: o.figures,
      note: o.note, productUpdated: ov.fileModified ?? null, apiUrl: 'https://public.emdat.be/', retrievedAt: ov.importedAt,
      rawFile: 'data/emdat-overrides.json', rawSha256: ov.sha256,
    };
    card.tags.push('impact:stated', 'impact:emdat');
    emdatMerged += 1;
  }
}


// ---------- 5. optional IDMC displacement figures (needs IDMC's key; CC BY-NC-SA 3.0 IGO; off unless --include-idmc) ----------
let idmcMerged = 0;
if (process.argv.includes('--include-idmc')) {
  const ov = JSON.parse(readFileSync(`${root}data/idmc-overrides.json`, 'utf8'));
  const pages = (ov.pages ?? []).map((p) => p.sha256).join(',');
  for (const card of doc.cards) {
    const o = ov.overrides?.[card.id];
    if (!o) continue;
    const figures = o.figures.map((f) => ({ kind: f.kind, value: f.value, qualifier: f.qualifier, quote: f.quote }));
    if (card.impact) {
      // a primary source already speaks for this card: add IDMC's displacement only when that kind is not stated yet
      for (const f of figures) if (!card.impact.figures.some((x) => x.kind === f.kind)) card.impact.figures.push(f);
      card.impact.note += ' Displacement figures, where shown, are IDMC\'s (CC BY-NC-SA 3.0 IGO).';
    } else {
      card.impact = {
        source: o.source, statement: `${o.eventName ?? 'Event'}: ${figures.map((f) => f.quote).join('; ')} (IDMC, reporting year ${o.year})`, figures,
        note: `${o.citation} Licence: ${o.licence}. Displacement is counted as movements ("flows"), so one person displaced twice counts twice.`,
        productUpdated: null, apiUrl: 'https://helix-tools-api.idmcdb.org/external-api/gidd/disasters/', retrievedAt: ov.importedAt,
        rawFile: 'records/sources/idmc-gidd', rawSha256: createHash('sha256').update(pages).digest('hex'),
      };
    }
    card.tags.push('impact:stated', 'impact:idmc');
    idmcMerged += 1;
  }
}

doc.cards.sort((a, b) => b.eventStart.localeCompare(a.eventStart) || a.id.localeCompare(b.id));
const count = (fn) => doc.cards.reduce((m, c) => { const k = fn(c); m[k] = (m[k] ?? 0) + 1; return m; }, {});
doc.version = '2026-10-16-draft-2';
doc.builtAt = new Date().toISOString();
doc.adapterVersion = `${doc.adapterVersion}+${ADAPTER}`;
doc.selection += ' Stage 2 adds WHO Disease Outbreak News items whose title names an ASEAN country (event year 2016 or later, judged from the item URL name or id because WHO re-dated old items), and Singapore haze episodes: runs of days (gaps of up to 2 days allowed) with the highest regional 24-hour PSI above 100, from one reading per day at 12:00 local.';
doc.remark = 'Historical incidents for context. Ratings come from the source and use different scales (GDACS colour, USGS PAGER, NEA PSI band); they are not comparable. Casualty and affected-people figures appear only where the source states them (USGS impact statements) and are quoted with the statement; "affectedPeopleEstimate" stays null. Cyclone locations are unknown on purpose. GDACS content is indicative only. Outbreak items carry WHO\'s title and link; case and death counts are quoted from the notice\'s opening sentences only when they are unambiguous. Haze episodes are measured in Singapore and sampled once a day, so a short peak between samples can be missed. Region "offshore" means an ASEAN sea region.';
doc.counts = {
  cards: doc.cards.length, byDomain: count((c) => c.domain), bySource: count((c) => c.provenance.sourceId), byRating: count((c) => `${c.rating.scale}:${c.rating.value ?? 'none'}`),
  byRegion: count((c) => c.region), byYear: count((c) => c.eventStart.slice(0, 4)), withMapLocation: doc.cards.filter((c) => c.location.latE6 !== null).length,
  withoutMapLocation: doc.cards.filter((c) => c.location.latE6 === null).length, corroborated: doc.cards.filter((c) => c.corroboration.length > 0).length,
  withImpactStatement: withStatement, withKilledFigure: withKilled,
};
doc.reconciliation = {
  ...doc.reconciliation,
  who: { rawItems: whoRaw, kept: whoKept, extraction: whoStats },
  psi: { daysTotal: days.length, daysWithReading: sampled, daysWithoutReading: days.length - sampled, episodes: episodes.length },
  emdat: { requested: process.argv.includes('--include-emdat'), merged: emdatMerged },
  idmc: { requested: process.argv.includes('--include-idmc'), merged: idmcMerged },
  usgsImpact: { usgsCards: doc.cards.filter((c) => c.provenance.sourceId === 'SRC.USGS.FDSN').length, withStatement },
};
writeFileSync(OUT, `${JSON.stringify(doc)}\n`);
console.log(JSON.stringify({ counts: doc.counts, reconciliation: { who: doc.reconciliation.who, psi: doc.reconciliation.psi, usgsImpact: doc.reconciliation.usgsImpact } }, null, 1));
