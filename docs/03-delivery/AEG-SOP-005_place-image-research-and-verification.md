# AEG-SOP-005 ? Place-image research and verification

Revision: 0.2 | Status: WORKING_BASELINE | Date: 2026-10-17
Owner: SOL | Executor for first pass: Luna | Related work: AEG-SOW-001 / AEG-MEDIA-001

## 1. Inventory and classification

Start from fixtures/environment-pins.json and join content/places/place-media.json on pinId. Audit all current pins, including existing matches. The handoff CSV is a baseline, not a queue that overrides newer data. Distinguish: no stored media, wrong/no article match, no image/free image, unverified/broken thumbnail, and browser-only load failure. Query GET /public/environment/pin/:pinId to compare served media with disk. Do not retain its unrelated air/weather/incident values in the media report.

Existing storage statuses: matched, no_image, no_free_image, name_mismatch, no_article, rate_limited, error. Use these meanings consistently. A transient failure is not an absence. A matched entry with thumbVerifiedAt null still needs verification; the existing resolver can return that state when verification was throttled.

## 2. Identify the actual place before selecting a photo

Use country/region, coordinates and the geographic entity type as constraints. Try the exact place title with redirects first, then a small Wikipedia title/text search using the name plus region/country. Retain current geosearch as supporting evidence, not the sole discovery method. For API calls use encoded parameters, not interpolated user text.

Examples of API parameter sets (construct URLs against https://en.wikipedia.org/w/api.php):

- Exact title: action=query, titles=Cameron Highlands, redirects=1, prop=info|coordinates|pageimages, inprop=url, piprop=name, format=json.
- Discovery: action=query, list=search, srsearch=Cameron Highlands Pahang Malaysia, srnamespace=0, srlimit=5, format=json. Search returns candidates; it does not approve them.

Inspect the article's subject/intro and country/region; reject disambiguation, electoral constituencies, unrelated POIs and namesakes. A broad district's article coordinate may be more than 5 km away: justify entity identity explicitly rather than silently broadening the radius. Do not weaken the global matcher merely to pass one name. For spelling/known aliases, record the pin-specific alias, article identity, evidence URL and rationale and cover it with a test. Keep actual computed distance when coordinates exist; never invent zero distance. If absent, use an explicit unresolved representation compatible with the contract or flag it for SNET rather than manufacturing a value.

For a compound label such as two neighbourhoods or a named canal, do not strip words until an unrelated article matches. Accept an image only when its relation to the monitored area is verified and its caption states any broader-area context. If the existing view cannot represent that distinction truthfully, leave it unresolved and hand the candidate to SOL/SNET; do not silently publish a broader-place image as the exact spot.

## 3. Select and verify Wikimedia media

Prefer the verified article's suitable lead image. If absent/unusable, inspect other article-linked Commons files or narrowly search Commons for that verified place, checking file descriptions/location/depicted subject. This is manual/candidate discovery work unless you add a tested bounded resolver step; never accept the first search hit automatically. Do not fall back to stock, AI-generated, Google Street View or scraped travel-site pictures.

Use Commons API imageinfo with iiprop=url|size|extmetadata and iiurlwidth=500 to obtain the file URL, dimensions, creator and licence. Obtain a verified 250px variant as well; reuse an original only if it is already small enough. Follow the existing project's 250/500px rendition convention; treat it as our contract, not a guarantee of remote availability. Do not invent a live URL from a filename without checking it.

Policy: accept verified CC0/public domain, CC BY and CC BY-SA. Reject unknown, fair use, NC/ND or unclear rights. Check the actual file's licence/creator; Wikipedia's text licence does not license every photo. Keep file title/Commons page, creator, licence name/deed URL, attribution and verification date. Honour required attribution and note modifications if any; this task does not edit photo binaries. Missing required credit/rights evidence means unresolved, not approved. Strip/sanitize metadata to plain text, never render extmetadata HTML.

Verify both thumb250 and thumb500 using spaced HEAD or a small bounded GET when HEAD is refused; check successful response and image content type. Reject HTML/error bodies. A 429/503 means retry later. Save thumbVerifiedAt only after actual verification; do not turn a throttled check into a verified match. Store concise status evidence, not full articles or image binaries.

## 4. Run politely and resumably

Use the existing PoliteWikiClient, one request stream, minimum 1200ms gap (increase if throttled), descriptive existing User-Agent, bounded retry/backoff and Retry-After handling. Cache candidate metadata and checkpoint results after each pin. No concurrent bulk workers, proxy rotation or repeated retry-all loops. After a bounded failure, save a retryable result and continue with unrelated pins.

Current tool commands, from repository root in PowerShell:

    node node_modules/tsx/dist/cli.mjs tools/fetch-place-media.ts --pin my-35 --retry name_mismatch,no_article --gap 1500
    node node_modules/tsx/dist/cli.mjs tools/fetch-place-media.ts --limit 5 --retry name_mismatch,no_article,no_image --gap 1500

These commands currently use the old geosearch-only resolver. Re-running them alone will not solve its discovery limit. Implement/validate exact-title fallback first or stage individually researched candidates with provenance. Never run --retry-all blindly: it can replace good entries and wastes requests. --recheck mutates stored judgements without network and can invalidate reviewed overrides; only use it when the new matcher understands those decisions and the effect is reviewed.

## 5. Save using the existing contracts

Stored entry: pinId, status, checkedAt, article {title,url,distanceM}, image {fileTitle,commonsUrl,thumb250,thumb500,width500,height500,originalWidth,originalHeight,creator,licence,licenceUrl,credit,description,thumbVerifiedAt}, note. Read src/sources/wikiMedia.ts for exact TypeScript nullability. Recompute catalogue counts from entries, not hand-entered totals. Preserve registryId and unrelated entries. Record search/alias decisions in a sidecar if needed; do not change the public contract just to attach research notes.

Public view: status, wikipediaUrl, articleTitle, image {thumb250,thumb500,width,height,alt,credit,licence,licenceUrl,commonsUrl}, fallback='hide-image-keep-link', checkedAt. Existing src/services/placeMedia.ts projects storage into this view. Improve misleading alt/provenance wording only in coordination with SNET and preserve field names. An article/file picture is illustrative context, never proof of a current incident or sensor position.

## 6. Verify and hand back

Run focused wiki-media unit tests with mocked responses, plus any new exact-title/alias/throttle tests:

    node node_modules/vitest/vitest.mjs run tests/unit/wiki-media.test.ts

Use the project TypeScript check for changed code, catalogue validation and a disposable-service/API check. Test wrong country/namesake, compound labels, no article/no free image, 429, both thumbnail checks and preservation of existing matches. Keep missing-image browser fallback/credit/link expectations intact; SOL owns UI edits.

Publish before/after counts and per-pin outcomes, retaining verified negative results. Check my-35 first in the refreshed API; restart coordination is described in SOW-001. Hand back paths, evidence, pending retries and API-refresh state. SOL then handles circular card controls, photo sizing, credit placement and the remaining UI/UX review.

## Primary references (checked 2026-10-16)

- [MediaWiki search](https://www.mediawiki.org/wiki/API:Search): candidate discovery.
- [MediaWiki geosearch](https://www.mediawiki.org/wiki/API:Geosearch): nearby articles, not identity proof.
- [MediaWiki imageinfo](https://www.mediawiki.org/wiki/API:Imageinfo): file metadata/thumbnail information.
- [API etiquette](https://www.mediawiki.org/wiki/API:Etiquette): request behaviour.
- [Commons reuse guidance](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia): file-specific reuse conditions and attribution. Our accepted-licence allowlist is the narrower project policy in C0015/wikiMedia.ts.

## Owner clarification ? 2026-10-17: landmarks and incident imagery

A verified landmark within, or clearly associated with, the named location may represent that location. It need not depict the exact monitoring coordinate. Verify its actual identity/location and label the landmark or subject explicitly, for example `Tea fields, Cameron Highlands ? Location illustration` or `Terminal 3, Changi Airport ? Location illustration`. Preserve the original monitoring coordinates and distinguish the landmark from the sensor point. Keep credit, licence, Commons file link and a truthful Wikipedia link. Do not choose an unrelated nearest landmark, invent coordinates or silently relax country/entity verification. This clarifies acceptable representative location imagery; it does not authorize a live-incident photo claim.

Separate image purposes in the reusable card: location/landmark image belongs beside the location heading; verified disaster photographs belong in a distinct incident/evidence section, with event relevance, source, capture/publication time when supplied and reuse rights. Do not place a landmark image under a disaster-photo label. Existing generic hazard artwork is an illustration and must be labelled as such in a separate illustration section, never passed off as a photograph of this incident. If no verified incident photo exists, do not fabricate one.

For remaining location-image cases, Luna may research landmark alternatives under this policy. Record landmark/subject name, verified association and illustration scope in the research evidence. Coordinate any additive caption/subject field with SNET: the current public media view does not expose the stored Commons description, and the frontend must not guess a landmark name from a filename. SNET still owns the nine coordinate-limited article decisions and Changi live refresh.

Multiple incident photos: render them in the separate incident/evidence gallery, with Previous (<) and Next (>) buttons and an image counter only when there are two or more photos. No automatic cycling. Caption, source/credit, licence and available capture/publication dates follow the selected image. A failed image retains its source and navigation. One image needs no arrows; no verified incident photos must not create a fake gallery.
