// Reads content/places/place-media.json (built by tools/fetch-place-media.ts) and turns an entry into what the place card needs (AEG-MEDIA-001).
// A place with no match or no free image yields a Wikipedia link when there is one and NO photo; nothing is ever guessed.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PlaceMedia } from '../sources/wikiMedia.js';

const file = fileURLToPath(new URL('../../content/places/place-media.json', import.meta.url));

export interface PlaceMediaView {
  status: PlaceMedia['status'];
  /** Link to the matching Wikipedia article, or null. Shown as "Read more on Wikipedia". */
  wikipediaUrl: string | null;
  articleTitle: string | null;
  image: {
    thumb250: string; thumb500: string; width: number; height: number;
    /** Plain-language alt text. The lead image of an article may not show the exact monitored spot, so it says where the image comes from. */
    alt: string;
    credit: string; licence: string; licenceUrl: string | null; commonsUrl: string;
  } | null;
  /** What the page does when the image cannot load: hide the picture, keep the credit and the Wikipedia link. */
  fallback: 'hide-image-keep-link';
  checkedAt: string;
}

export function loadPlaceMedia(path = file): Record<string, PlaceMediaView> {
  if (!existsSync(path)) return {};
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { entries?: Record<string, PlaceMedia> };
  const out: Record<string, PlaceMediaView> = {};
  for (const [pinId, e] of Object.entries(parsed.entries ?? {})) {
    if (e.status === 'rate_limited' || e.status === 'error') continue;   // not a result: nothing to show, and nothing is claimed
    out[pinId] = {
      status: e.status,
      wikipediaUrl: e.article?.url ?? null,
      articleTitle: e.article?.title ?? null,
      image: e.image ? {
        thumb250: e.image.thumb250, thumb500: e.image.thumb500, width: e.image.width500, height: e.image.height500,
        alt: `Image from the Wikipedia article "${e.article?.title ?? ''}", the nearest article to this place`,
        credit: e.image.credit, licence: e.image.licence, licenceUrl: e.image.licenceUrl, commonsUrl: e.image.commonsUrl,
      } : null,
      fallback: 'hide-image-keep-link',
      checkedAt: e.checkedAt,
    };
  }
  return out;
}
