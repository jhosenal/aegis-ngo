// Builds content/domains/featured-incidents.json (v2) from the saved raw source files, so no value on a card is typed by hand.
// Run: node tools/build-backfill.mjs            (reads docs/99-inbox/R0220..R0229 and their manifest, writes the content file)
// Rules (Compass SOP section 5/10 adapted, see .agents/skills/aegis-source-every-card): no source, no claim; unknown stays unknown;
// the source's own words and numbers are quoted with attribution, never re-stated as Aegis fact.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const inbox = `${root}docs/99-inbox/`;
const manifest = JSON.parse(readFileSync(`${inbox}R0220-R0229_backfill-manifest.json`, 'utf8'));
const ADAPTER = 'backfill-build-1';

const USGS = {
  sourceId: 'SRC.USGS.FDSN', sourceName: 'USGS Earthquake Hazards Program, FDSN event web service', publisher: 'U.S. Geological Survey',
  licence: { status: 'STATED_BY_PUBLISHER', text: 'USGS copyrights and credits page (read 2026-10-16): "USGS-authored or produced data and information are considered to be in the U.S. Public Domain." Proper credit is requested: "U.S. Geological Survey".', attribution: 'Credit: U.S. Geological Survey' },
};
const GDACS = {
  sourceId: 'SRC.GDACS.API', sourceName: 'GDACS (Global Disaster Alert and Coordination System), event list API', publisher: 'GDACS (European Commission JRC / UN OCHA)',
  licence: { status: 'STATED_ON_RSS_FEED', text: 'Items on the GDACS RSS feed state "European Union (CC BY 4.0), reuse is allowed, provided appropriate credit to GDACS is given". The GDACS disclaimer page (read 2026-10-16) adds: "this information is purely indicative and should not be used for any decision making without alternate sources of information". No separate API terms page was found.', attribution: 'Source: GDACS (https://www.gdacs.org), CC BY 4.0 as stated on its feed. Indicative only; not for decision making without alternate sources.' },
};

function raw(file) {
  const info = manifest.files.find((f) => f.file === file);
  if (!info) throw new Error(`no manifest entry for ${file}`);
  const bytes = readFileSync(`${inbox}${file}`);
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== info.sha256) throw new Error(`hash mismatch for ${file}`);
  return { json: JSON.parse(bytes.toString('utf8')), info };
}
const e6 = (x) => Math.round(Number(x) * 1_000_000);
const iso = (s) => (s && !/Z$|[+-]\d\d:?\d\d$/.test(s) ? `${s}Z` : s);

const out = [];
function tags(extra) { return extra.filter(Boolean); }

function usgsCard({ id, domain, file, pick, apiUrl }) {
  const { json, info } = raw(file);
  const f = json.features.find(pick);
  if (!f) throw new Error(`event not found in ${file}`);
  const p = f.properties;
  const [lon, lat, depth] = f.geometry.coordinates;
  out.push({
    id, domain, status: 'SOURCED', hazardType: 'EARTHQUAKE',
    title: `M ${p.mag} - ${p.place}`,
    eventStart: new Date(p.time).toISOString(), eventEnd: null,
    place: p.place, countries: [],
    alertLevel: p.alert ? { value: p.alert.toUpperCase(), scale: 'USGS PAGER', note: 'as published by USGS' } : { value: null, scale: 'USGS PAGER', note: 'USGS gave no PAGER alert for this event record' },
    location: { latE6: e6(lat), lonE6: e6(lon), basis: 'epicentre (USGS)', depthKm: depth },
    affectedPeopleEstimate: null,
    measurements: [{ key: 'magnitude', label: 'Magnitude', value: p.mag, unit: p.magType ?? null }],
    provenance: {
      ...USGS, sourcePage: p.url, apiUrl, sourceRecordId: f.id, publishedAt: null, sourceUpdatedAt: new Date(p.updated).toISOString(),
      retrievedAt: info.retrievedAt, rawFile: `docs/99-inbox/${file}`, rawSha256: info.sha256, adapterVersion: ADAPTER, method: 'HTTP GET, GeoJSON',
    },
    tags: tags(['source:USGS', `domain:${domain}`, 'hazard:earthquake', 'status:sourced', 'location:epicentre', 'affected:unknown', 'licence:public-domain-stated']),
  });
}

function gdacsCard({ id, domain, file, pick, hazardType, apiUrl, locationBasis }) {
  const { json, info } = raw(file);
  const f = json.features.find(pick);
  if (!f) throw new Error(`event not found in ${file}`);
  const p = f.properties;
  const [lon, lat] = f.geometry.coordinates;
  const sev = p.severitydata ?? {};
  const unusableSeverity = !(typeof sev.severity === 'number' && sev.severity > 0);
  const measurements = [];
  if (hazardType === 'STORM' && typeof sev.severity === 'number' && sev.severity > 0) {
    measurements.push({ key: 'maxWind', label: 'Maximum wind speed as reported by GDACS', value: Math.round(sev.severity), unit: 'km/h' });
  }
  if (hazardType === 'FLOOD' && !unusableSeverity) {
    measurements.push({ key: 'gdacsMagnitude', label: 'GDACS flood magnitude (dimensionless index as published)', value: sev.severity, unit: null });
  }
  const countries = String(p.country ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  out.push({
    id, domain, status: 'SOURCED', hazardType,
    title: `${p.eventname || p.name || hazardType} (GDACS ${p.eventtype} ${p.eventid})`.replace(/\s+/g, ' ').trim(),
    eventStart: iso(p.fromdate), eventEnd: iso(p.todate),
    place: countries.join(', ') || null, countries,
    alertLevel: { value: String(p.alertlevel).toUpperCase(), scale: 'GDACS', note: 'as published by GDACS' },
    location: locationBasis === 'unknown'
      ? { latE6: null, lonE6: null, basis: 'unknown: GDACS gives a track point for a cyclone, which is not the impact location', depthKm: null }
      : { latE6: e6(lat), lonE6: e6(lon), basis: 'event centroid (GDACS)', depthKm: null },
    affectedPeopleEstimate: null,
    measurements,
    provenance: {
      ...GDACS, sourcePage: p.url?.report ?? null, apiUrl, sourceRecordId: `${p.eventtype}-${p.eventid}`,
      publishedAt: null, sourceUpdatedAt: p.datemodified ? iso(p.datemodified) : null,
      retrievedAt: info.retrievedAt, rawFile: `docs/99-inbox/${file}`, rawSha256: info.sha256, adapterVersion: ADAPTER, method: 'HTTP GET, GeoJSON',
      notes: unusableSeverity && hazardType === 'FLOOD' ? 'GDACS severity is 0 or absent for this record; it is not a measurement, so no magnitude is shown.' : undefined,
    },
    tags: tags(['source:GDACS', `domain:${domain}`, `hazard:${hazardType.toLowerCase()}`, 'status:sourced', locationBasis === 'unknown' ? 'location:unknown' : 'location:centroid', 'affected:unknown', 'licence:cc-by-4.0-stated-on-feed']),
  });
}

const G = (a, b, t) => `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=${t}&fromdate=${a}&todate=${b}&alertlevel=Green;Orange;Red`;
const U = (a, b, m, extra = '') => `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${a}&endtime=${b}&minmagnitude=${m}&orderby=magnitude${extra}`;

usgsCard({ id: 'BF-1-01', domain: 1, file: 'R0220_usgs-fdsn-2004-12-26-sumatra.json', pick: (f) => f.properties.mag >= 9, apiUrl: U('2004-12-26', '2004-12-27', '8.5') });
usgsCard({ id: 'BF-1-02', domain: 1, file: 'R0221_usgs-fdsn-2018-09-28-palu.json', pick: (f) => f.properties.mag >= 7.4, apiUrl: U('2018-09-28', '2018-09-29', '7.0') });
usgsCard({ id: 'BF-1-03', domain: 1, file: 'R0222_usgs-fdsn-2015-06-05-ranau.json', pick: (f) => /Ranau/.test(f.properties.place), apiUrl: U('2015-06-04', '2015-06-07', '5.0', '&minlatitude=3&maxlatitude=8&minlongitude=114&maxlongitude=119') });

gdacsCard({ id: 'BF-2-01', domain: 2, file: 'R0226_gdacs-fl-2011-07-to-12-thailand.json', pick: (f) => f.properties.eventid === 3850, hazardType: 'FLOOD', apiUrl: G('2011-07-01', '2011-12-31', 'FL') });
gdacsCard({ id: 'BF-2-02', domain: 2, file: 'R0227_gdacs-fl-2014-12-to-2015-01-malaysia.json', pick: (f) => f.properties.eventid === 4216, hazardType: 'FLOOD', apiUrl: G('2014-12-15', '2015-01-15', 'FL') });
gdacsCard({ id: 'BF-2-03', domain: 2, file: 'R0228_gdacs-fl-2021-12-malaysia.json', pick: (f) => f.properties.eventid === 1101219, hazardType: 'FLOOD', apiUrl: G('2021-12-10', '2021-12-25', 'FL') });

gdacsCard({ id: 'BF-3-01', domain: 3, file: 'R0224_gdacs-tc-2008-05-nargis.json', pick: (f) => f.properties.eventid === 10238, hazardType: 'STORM', apiUrl: G('2008-04-25', '2008-05-10', 'TC'), locationBasis: 'unknown' });
gdacsCard({ id: 'BF-3-02', domain: 3, file: 'R0223_gdacs-tc-2013-11-haiyan.json', pick: (f) => f.properties.eventid === 41058, hazardType: 'STORM', apiUrl: G('2013-11-01', '2013-11-15', 'TC'), locationBasis: 'unknown' });
gdacsCard({ id: 'BF-3-03', domain: 3, file: 'R0225_gdacs-tc-2021-12-rai.json', pick: (f) => f.properties.eventid === 1000853, hazardType: 'STORM', apiUrl: G('2021-12-10', '2021-12-22', 'TC'), locationBasis: 'unknown' });

gdacsCard({ id: 'BF-7-01', domain: 7, file: 'R0229_gdacs-vo-2020-01-taal.json', pick: (f) => f.properties.eventid === 273070, hazardType: 'VOLCANO', apiUrl: G('2020-01-08', '2020-01-20', 'VO') });

// Entries with no saved source yet: name, date and place only, plainly marked. They are context, not evidence.
const UNSOURCED = [
  [4, 'BF-4-01', '1997 Southeast Asian haze', '1997-09', 'Indonesia, affecting Malaysia and Singapore'],
  [4, 'BF-4-02', '2015 Southeast Asian haze', '2015-09', 'Sumatra and Kalimantan, Indonesia, affecting Malaysia and Singapore'],
  [4, 'BF-4-03', '2019 Southeast Asian haze', '2019-09', 'Sumatra and Kalimantan, Indonesia, affecting Malaysia and Singapore'],
  [5, 'BF-5-01', 'Nipah virus outbreak', '1998', 'Peninsular Malaysia'],
  [5, 'BF-5-02', 'SARS outbreak', '2003', 'Several countries including Singapore and Vietnam'],
  [5, 'BF-5-03', 'COVID-19 pandemic', '2020-03-11', 'Worldwide, including all ASEAN states'],
  [6, 'BF-6-01', 'Zamboanga City crisis', '2013-09', 'Zamboanga City, Philippines'],
  [6, 'BF-6-02', 'Marawi siege', '2017-05', 'Marawi City, Philippines'],
  [6, 'BF-6-03', 'Rohingya displacement from Rakhine State', '2017-08', 'Rakhine State, Myanmar, and neighbouring countries'],
  [7, 'BF-7-02', '1991 eruption of Mount Pinatubo', '1991-06-15', 'Luzon, Philippines'],
  [7, 'BF-7-03', '2010 eruption of Mount Merapi', '2010-10', 'Central Java and Yogyakarta, Indonesia'],
];
const HAZ = { 4: 'WILDFIRE', 5: 'OUTBREAK', 6: 'DISPLACEMENT', 7: 'VOLCANO' };
for (const [domain, id, title, date, place] of UNSOURCED) {
  out.push({
    id, domain, status: 'UNSOURCED', hazardType: HAZ[domain], title, eventStart: date, eventEnd: null, place, countries: [],
    alertLevel: { value: null, scale: null, note: 'not stated' }, location: { latE6: null, lonE6: null, basis: 'unknown', depthKm: null },
    affectedPeopleEstimate: null, measurements: [],
    provenance: {
      sourceId: null, sourceName: null, publisher: null, licence: { status: 'NONE', text: 'No source saved.', attribution: null }, sourcePage: null, apiUrl: null,
      sourceRecordId: null, publishedAt: null, sourceUpdatedAt: null, retrievedAt: null, rawFile: null, rawSha256: null, adapterVersion: ADAPTER,
      method: 'general knowledge; not retrieved from a source', notes: 'Name, date and place only. Must be checked against a primary source before it is relied on.',
    },
    tags: [`domain:${domain}`, `hazard:${HAZ[domain].toLowerCase()}`, 'status:unsourced', 'location:unknown', 'affected:unknown', 'licence:none'],
  });
}

const doc = {
  version: '2026-10-16-draft-2',
  builtAt: manifest.builtAt,
  adapterVersion: ADAPTER,
  remark: 'Notable past incidents shown for context on each hazard domain. Entries marked SOURCED carry the source, its licence status, the time we retrieved it and a hash of the saved raw file. Entries marked UNSOURCED give only name, date and place from general knowledge, with no figures, and must be checked against a primary source before they are relied on or published beyond the pilot. Casualty and damage figures are not stated on any card.',
  incidents: out,
};
writeFileSync(`${root}content/domains/featured-incidents.json`, `${JSON.stringify(doc, null, 1)}\n`);
console.log(`wrote ${out.length} cards: ${out.filter((c) => c.status === 'SOURCED').length} sourced, ${out.filter((c) => c.status !== 'SOURCED').length} unsourced`);
