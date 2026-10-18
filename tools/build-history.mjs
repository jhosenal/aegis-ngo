// Builds content/history/hazard-history.json (AEG-HIST-001) from the raw files saved by tools/fetch-history.mjs. Offline and deterministic:
// every value comes from a saved raw file whose SHA-256 is re-checked, nothing is typed by hand.
// Run: node tools/build-history.mjs [--in records/sources/history-2016-2026]
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const argIn = process.argv.indexOf('--in');
const inRel = argIn > -1 ? process.argv[argIn + 1] : 'records/sources/history-2016-2026';
const inDir = `${root}${inRel}/`;
const manifest = JSON.parse(readFileSync(`${inDir}manifest.json`, 'utf8'));
const ADAPTER = 'history-build-1';

const ASEAN_NAMES = new Set(['Indonesia', 'Philippines', 'Malaysia', 'Thailand', 'Myanmar', 'Burma', 'Viet Nam', 'Vietnam', 'Cambodia', 'Laos',
  "Lao People's Democratic Republic", 'Singapore', 'Brunei', 'Brunei Darussalam', 'Timor-Leste', 'Timor Leste', 'East Timor', 'Burma (Myanmar)']);
const ASEAN_ISO3 = new Set(['IDN', 'PHL', 'MYS', 'THA', 'MMR', 'VNM', 'KHM', 'LAO', 'SGP', 'BRN', 'TLS']);
const SEA_RE = /\b(Sea|Ocean|Strait|Gulf|Bay|Trench|region|Ridge|Rise|Basin|Passage|coast of)\b/i;
const IN_BOX = (lat, lon) => lat >= -11.5 && lat <= 21.5 && lon >= 92 && lon <= 141.5;

const DOMAIN = { EQ: 1, FL: 2, TC: 3, WF: 4, VO: 7 };
const HAZARD = { EQ: 'EARTHQUAKE', FL: 'FLOOD', TC: 'STORM', WF: 'WILDFIRE', VO: 'VOLCANO' };
const GDACS_RANK = { GREEN: 0, ORANGE: 1, RED: 2 };
const PAGER_RANK = { GREEN: 0, YELLOW: 1, ORANGE: 2, RED: 3 };

const USGS_LIC = { status: 'STATED_BY_PUBLISHER', text: 'USGS copyrights and credits page (read 2026-10-16): "USGS-authored or produced data and information are considered to be in the U.S. Public Domain." Credit requested: "U.S. Geological Survey".', attribution: 'Credit: U.S. Geological Survey' };
const GDACS_LIC = { status: 'STATED_ON_RSS_FEED', text: 'GDACS RSS items state "European Union (CC BY 4.0), reuse is allowed, provided appropriate credit to GDACS is given". The GDACS disclaimer page (read 2026-10-16) says the information is "purely indicative and should not be used for any decision making without alternate sources of information". No separate API terms page was found.', attribution: 'Source: GDACS (https://www.gdacs.org), CC BY 4.0 as stated on its feed. Indicative only; not for decision making without alternate sources.' };

const e6 = (x) => Math.round(Number(x) * 1_000_000);
const iso = (s) => (s && !/Z$|[+-]\d\d:?\d\d$/.test(s) ? `${s}Z` : s);
function hav(la1, lo1, la2, lo2) {
  const R = 6371; const r = (d) => (d * Math.PI) / 180;
  const a = Math.sin(r(la2 - la1) / 2) ** 2 + Math.cos(r(la1)) * Math.cos(r(la2)) * Math.sin(r(lo2 - lo1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---- load raw, verifying hashes ----
const queries = [];
const withoutData = [];
for (const f of manifest.files) {
  if (f.outcome !== 'DATA' || !f.file) { withoutData.push({ id: f.id, outcome: f.outcome, httpStatus: f.httpStatus, meaning: f.outcome === 'NO_EVENTS' ? 'source answered: no matching events' : 'NOT a clean answer; re-run' }); continue; }
  const bytes = readFileSync(`${inDir}${f.file}`);
  if (createHash('sha256').update(bytes).digest('hex') !== f.sha256) throw new Error(`hash mismatch for ${f.file}`);
  queries.push({ meta: f, json: JSON.parse(bytes.toString('utf8')) });
}
const prov = (meta, extra) => ({
  sourceId: meta.source === 'USGS' ? 'SRC.USGS.FDSN' : 'SRC.GDACS.API',
  sourceName: meta.source === 'USGS' ? 'USGS Earthquake Hazards Program, FDSN event web service' : 'GDACS (Global Disaster Alert and Coordination System), event list API',
  publisher: meta.source === 'USGS' ? 'U.S. Geological Survey' : 'GDACS (European Commission JRC / UN OCHA)',
  licence: meta.source === 'USGS' ? USGS_LIC : GDACS_LIC,
  apiUrl: meta.apiUrl, retrievedAt: meta.retrievedAt, rawFile: `${inRel}/${meta.file}`, rawSha256: meta.sha256,
  adapterVersion: ADAPTER, method: 'HTTP GET, GeoJSON', ...extra,
});

const stats = { rawEvents: { USGS: 0, GDACS: 0 }, usgsOutside: 0, gdacsOutside: 0, gdacsDroppedType: 0, mergedEq: 0 };
const dedupeGdacs = new Map();
const usgsEvents = [];
for (const { meta, json } of queries) {
  for (const f of json.features ?? []) {
    if (meta.source === 'USGS') {
      stats.rawEvents.USGS += 1;
      const p = f.properties; const [lon, lat, depth] = f.geometry.coordinates;
      const place = String(p.place ?? ''); const tail = place.includes(',') ? place.split(',').pop().trim() : place.trim();
      const region = ASEAN_NAMES.has(tail) ? 'asean' : SEA_RE.test(tail) && !/India|China|Taiwan|Micronesia|Papua|Palau|Japan/i.test(tail) ? 'offshore' : 'outside';
      if (region === 'outside') { stats.usgsOutside += 1; continue; }
      usgsEvents.push({ meta, f, p, lat, lon, depth, place, tail, region });
    } else {
      stats.rawEvents.GDACS += 1;
      const p = f.properties; const [lon, lat] = f.geometry.coordinates;
      const names = String(p.country ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      const iso3 = String(p.iso3 ?? '');
      const named = names.some((n) => ASEAN_NAMES.has(n)) || [...ASEAN_ISO3].some((c) => iso3.includes(c));
      const unlabelledInBox = names.length === 0 && iso3 === '' && p.eventtype === 'EQ' && IN_BOX(lat, lon);
      if (!named && !unlabelledInBox) { stats.gdacsOutside += 1; continue; }
      if (!DOMAIN[p.eventtype]) { stats.gdacsDroppedType += 1; continue; }
      const key = `${p.eventtype}-${p.eventid}`;
      const level = String(p.alertlevel).toUpperCase();
      const have = dedupeGdacs.get(key);
      if (!have || (GDACS_RANK[level] ?? -1) > (GDACS_RANK[String(have.p.alertlevel).toUpperCase()] ?? -1)) {
        dedupeGdacs.set(key, { meta, f, p, lat, lon, names, region: named ? 'asean' : 'unlabelled-in-box' });
      }
    }
  }
}

const cards = [];
const usedUsgs = new Set();
function tagsFor({ source, domain, hazard, year, countries, region, rank, scale, locBasis }) {
  return [`source:${source}`, `domain:${domain}`, `hazard:${hazard.toLowerCase()}`, `year:${year}`, `region:${region}`, `scale:${scale}`,
    rank !== null ? `rating-rank:${rank}` : 'rating-rank:none', `location:${locBasis}`, 'affected:unknown', 'status:sourced',
    source === 'USGS' ? 'licence:public-domain-stated' : 'licence:cc-by-4.0-stated-on-feed', ...countries.slice(0, 6).map((c) => `country:${c.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`)];
}

// GDACS cards first so earthquakes can absorb a matching USGS event
for (const g of dedupeGdacs.values()) {
  const { meta, f, p, lat, lon, names, region } = g;
  const type = p.eventtype; const domain = DOMAIN[type];
  const level = String(p.alertlevel).toUpperCase();
  const sev = p.severitydata ?? {};
  const start = iso(p.fromdate); const end = iso(p.todate);
  const base = { prov: prov(meta, { sourcePage: p.url?.report ?? null, sourceRecordId: `${type}-${p.eventid}`, sourceUpdatedAt: p.datemodified ? iso(p.datemodified) : null, publishedAt: null }) };
  if (type === 'EQ') {
    const t0 = Date.parse(start);
    let best = null;
    for (const u of usgsEvents) {
      if (usedUsgs.has(u.f.id)) continue;
      const dt = Math.abs(u.p.time - t0);
      if (dt > 20 * 60_000) continue;
      const dist = hav(lat, lon, u.lat, u.lon);
      if (dist <= 200 && (!best || dist < best.dist)) best = { u, dist };
    }
    if (best) {
      usedUsgs.add(best.u.f.id); stats.mergedEq += 1;
      cards.push(usgsCard(best.u, { corroboration: [{ ...base.prov, note: `Also reported by GDACS as ${String(p.alertlevel).toUpperCase()} (event ${p.eventid})`, alertLevel: level }] }));
      continue;
    }
  }
  const countries = names;
  const measurements = [];
  if (type === 'TC' && typeof sev.severity === 'number' && sev.severity > 0) measurements.push({ key: 'maxWind', label: 'Maximum wind speed as reported by GDACS', value: Math.round(sev.severity), unit: 'km/h' });
  if (type === 'EQ' && typeof sev.severity === 'number' && sev.severity > 0) measurements.push({ key: 'magnitude', label: 'Magnitude as reported by GDACS', value: sev.severity, unit: 'M' });
  if (type === 'FL' && typeof sev.severity === 'number' && sev.severity > 0) measurements.push({ key: 'gdacsMagnitude', label: 'GDACS flood magnitude (dimensionless index as published)', value: sev.severity, unit: null });
  const locUnknown = type === 'TC';
  const year = Number(String(start).slice(0, 4));
  cards.push({
    id: `HX-${domain}-GDACS-${type}-${p.eventid}`, domain, status: 'SOURCED', hazardType: HAZARD[type],
    title: `${p.name || p.eventname || HAZARD[type]} (GDACS ${type} ${p.eventid})`.replace(/\s+/g, ' ').trim(),
    eventStart: start, eventEnd: end, place: countries.join(', ') || null, countries,
    alertLevel: { value: level, scale: 'GDACS', note: 'as published by GDACS' },
    rating: { scale: 'GDACS', value: level, rank: GDACS_RANK[level] ?? null },
    location: locUnknown
      ? { latE6: null, lonE6: null, basis: 'unknown: GDACS gives a track point for a cyclone, not the impact location', depthKm: null }
      : { latE6: e6(lat), lonE6: e6(lon), basis: type === 'FL' ? 'approximate area centroid (GDACS)' : type === 'VO' ? 'volcano location (GDACS)' : 'epicentre (GDACS)', depthKm: null },
    affectedPeopleEstimate: null, measurements, provenance: base.prov, corroboration: [],
    glide: String(p.glide ?? '').trim() || null,
    region,
    tags: tagsFor({ source: 'GDACS', domain, hazard: HAZARD[type], year, countries, region, rank: GDACS_RANK[level] ?? null, scale: 'gdacs', locBasis: locUnknown ? 'unknown' : type === 'FL' ? 'centroid' : 'point' }),
  });
}

function usgsCard(u, extra = {}) {
  const { meta, f, p, lat, lon, depth, place, tail, region } = u;
  const pager = p.alert ? String(p.alert).toUpperCase() : null;
  const year = new Date(p.time).getUTCFullYear();
  const countries = ASEAN_NAMES.has(tail) ? [tail] : [];
  return {
    id: `HX-1-USGS-${f.id}`, domain: 1, status: 'SOURCED', hazardType: 'EARTHQUAKE',
    title: `M ${p.mag} - ${place}`, eventStart: new Date(p.time).toISOString(), eventEnd: null, place, countries,
    alertLevel: pager ? { value: pager, scale: 'USGS PAGER', note: 'as published by USGS' } : { value: null, scale: 'USGS PAGER', note: 'USGS gave no PAGER alert for this event record' },
    rating: { scale: 'USGS PAGER', value: pager, rank: pager ? PAGER_RANK[pager] ?? null : null },
    location: { latE6: e6(lat), lonE6: e6(lon), basis: 'epicentre (USGS)', depthKm: depth },
    affectedPeopleEstimate: null,
    measurements: [{ key: 'magnitude', label: 'Magnitude', value: p.mag, unit: p.magType ?? null }],
    provenance: prov(meta, { sourcePage: p.url, sourceRecordId: f.id, sourceUpdatedAt: new Date(p.updated).toISOString(), publishedAt: null }),
    corroboration: extra.corroboration ?? [], region,
    tags: tagsFor({ source: 'USGS', domain: 1, hazard: 'EARTHQUAKE', year, countries, region, rank: pager ? PAGER_RANK[pager] ?? null : null, scale: 'usgs-pager', locBasis: 'point' }),
  };
}
for (const u of usgsEvents) if (!usedUsgs.has(u.f.id)) cards.push(usgsCard(u));

cards.sort((a, b) => b.eventStart.localeCompare(a.eventStart) || a.id.localeCompare(b.id));
const count = (fn) => cards.reduce((m, c) => { const k = fn(c); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const doc = {
  version: '2026-10-16-draft-1', builtAt: new Date().toISOString(), adapterVersion: ADAPTER,
  window: { from: '2016-01-01', to: manifest.builtAt.slice(0, 10) },
  selection: 'GDACS Orange and Red events that name an ASEAN country (earthquakes with no country label only when the point lies in the ASEAN box), plus USGS earthquakes of magnitude 6.5 and above whose place label is an ASEAN country or a sea region. A GDACS earthquake that matches a USGS event within 20 minutes and 200 km is one card with two provenance entries.',
  remark: 'Historical incidents for context. Ratings come from the source and use different scales (GDACS colour, USGS PAGER); they are not comparable. Affected people are not stated on any card. Cyclone locations are unknown on purpose. GDACS content is indicative only. Region "offshore" and "unlabelled-in-box" mean the event is in the search box but its place label does not name an ASEAN country.',
  counts: {
    cards: cards.length, byDomain: count((c) => c.domain), bySource: count((c) => c.provenance.sourceId), byRating: count((c) => `${c.rating.scale}:${c.rating.value ?? 'none'}`),
    byRegion: count((c) => c.region), byYear: count((c) => c.eventStart.slice(0, 4)), withMapLocation: cards.filter((c) => c.location.latE6 !== null).length,
    withoutMapLocation: cards.filter((c) => c.location.latE6 === null).length, corroborated: cards.filter((c) => c.corroboration.length > 0).length,
  },
  reconciliation: { ...stats, queriesWithoutData: withoutData },
  cards,
};
mkdirSync(`${root}content/history`, { recursive: true });
writeFileSync(`${root}content/history/hazard-history.json`, `${JSON.stringify(doc)}\n`);
console.log(JSON.stringify({ counts: doc.counts, reconciliation: doc.reconciliation }, null, 1));
