import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { freeLicence, titleMatches } from '../src/sources/wikiMedia.js';

const root = resolve(import.meta.dirname, '..');
const registry = JSON.parse(readFileSync(resolve(root, 'fixtures/environment-pins.json'), 'utf8')) as { pins: Array<{ pinId: string; name: string; country: string; region: string; lat: number; lng: number }> };
const current = JSON.parse(readFileSync(resolve(root, 'content/places/place-media.json'), 'utf8')) as { entries: Record<string, any> };
const before = JSON.parse(readFileSync(resolve(root, 'data/place-media.pre-AEG-MEDIA-LUNA-001.json'), 'utf8')) as { entries: Record<string, any> };
const identity = JSON.parse(readFileSync(resolve(root, 'records/reviews/AEG-MEDIA-LUNA-001_2026-10-17_identity.json'), 'utf8')) as { records: Array<{ pinId: string; intro: string | null; articleUrl: string; coordinates: { lat: number; lng: number } | null }> };
const identityByPin = new Map(identity.records.map((record) => [record.pinId, record]));
const candidateReviews = [JSON.parse(readFileSync(resolve(root, 'records/reviews/AEG-MEDIA-LUNA-001_2026-10-17_candidates.json'), 'utf8')) as { pinId: string; accepted: { description: string; commonsUrl: string }; rejected: Array<{ fileTitle: string; reason: string }> }];
const candidateByPin = new Map(candidateReviews.map((record) => [record.pinId, record]));
const csv = (value: unknown): string => `"${String(value ?? '').replaceAll('"', '""')}"`;
const rows: unknown[][] = [[
  'pinId', 'place', 'country', 'region', 'latitude', 'longitude', 'beforeStatus', 'afterStatus',
  'articleTitle', 'articleUrl', 'articleDistanceM', 'identityEvidence', 'articleIntroEvidence', 'illustrationScope', 'rejectedCandidates',
  'fileTitle', 'commonsUrl', 'creator', 'licence', 'licenceUrl', 'credit', 'thumb250', 'thumb500', 'thumbVerifiedAt', 'decisionReason',
]];
for (const pin of registry.pins) {
  const entry = current.entries[pin.pinId];
  const image = entry?.image;
  const identityRecord = identityByPin.get(pin.pinId);
  const articleTitle = entry?.article?.title ?? (String(entry?.note ?? '').match(/article "([^"]+)"/)?.[1] ?? '');
  const identityEvidence = entry?.article
    ? `Title accepted by resolver; article lead reviewed; ${entry.article.distanceM} m from registry point; ${identityRecord?.coordinates ? `page coordinate ${identityRecord.coordinates.lat},${identityRecord.coordinates.lng}` : 'page coordinate absent'}; ${entry.article.url}`
    : articleTitle ? `Exact-title candidate ${articleTitle}; page coordinates absent, so no distance was invented` : entry?.note ?? 'No article candidate accepted';
  const entityQualifier = /\b(district|town|city|state|municipality|region|suburb|village|township|capital)\b/i;
  const fileDescription = String(image?.description ?? '');
  const broader = entry?.article && (entityQualifier.test(entry.article.title) || /\b(terminal|waterfall|bridge|port|park|memorial|station|museum|monument)\b/i.test(fileDescription));
  const illustrationScope = image ? (broader ? `broader-area/contextual illustration (${fileDescription || entry.article.title}); does not indicate a live hazard or exact sensor point` : 'place-article illustration; does not indicate a live hazard or exact sensor point') : 'none';
  const rejected = String(entry?.note ?? '').match(/(?:nearby articles|nearest articles) \(([^)]*)\)/)?.[1] ?? '';
  const manual = candidateByPin.get(pin.pinId);
  const rejectedCandidates = [rejected, ...(manual?.rejected.map((candidate) => `${candidate.fileTitle}: ${candidate.reason}`) ?? [])].filter(Boolean).join(' | ');
  const reason = entry?.status === 'matched'
    ? `Accepted after article/title review; ${freeLicence(image?.licence ?? '') ? 'allowlisted licence' : 'licence review required'}; thumb verification ${image?.thumbVerifiedAt ?? 'pending'}`
    : entry?.status === 'error' && articleTitle
      ? `Unresolved: ${entry.note}`
      : entry?.note ?? `Unresolved status: ${entry?.status ?? 'missing catalogue entry'}`;
  rows.push([
    pin.pinId, pin.name, pin.country, pin.region, pin.lat, pin.lng, before.entries[pin.pinId]?.status ?? '', entry?.status ?? '',
    entry?.article?.title ?? articleTitle, entry?.article?.url ?? (articleTitle ? `https://en.wikipedia.org/wiki/${encodeURIComponent(articleTitle.replaceAll(' ', '_'))}` : ''),
    entry?.article?.distanceM ?? '', identityEvidence, identityRecord?.intro ?? '', illustrationScope, rejectedCandidates, image?.fileTitle ?? '', image?.commonsUrl ?? '',
    image?.creator ?? '', image?.licence ?? '', image?.licenceUrl ?? '', image?.credit ?? '', image?.thumb250 ?? '', image?.thumb500 ?? '', image?.thumbVerifiedAt ?? '', reason,
  ]);
}
writeFileSync(resolve(root, 'records/reviews/AEG-MEDIA-LUNA-001_2026-10-17_pins.csv'), `${rows.map((row) => row.map(csv).join(',')).join('\r\n')}\r\n`, 'utf8');
console.log(`wrote ${rows.length - 1} pin rows`);
