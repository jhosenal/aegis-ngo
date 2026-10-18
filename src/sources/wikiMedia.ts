// Place images and Wikipedia links for the monitored places (AEG-MEDIA-001), built on what the Sonic Compass chapter learned the hard way:
//  - use the MediaWiki / Commons API (imageinfo + extmetadata), never scrape a rendered page;
//  - the anonymous tier throttles after about ten quick calls: space the calls, back off on 429, and NEVER read a 429 as "missing";
//  - keep the licence, creator and a credit line from extmetadata, and accept only freely licensed images;
//  - ask only for Wikimedia's standard thumbnail widths (an odd width is throttled), 250 and 500 here;
//  - a place is matched to an article only when the article title agrees with the place name, not merely because it is nearest.
// This module does no file or network work by itself except through the injected fetch, so it is testable.

export const WIKI_STANDARD_WIDTHS = [20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840] as const;
export const USER_AGENT = 'Aegis-NGO-Pilot/0.1 (hazard coordination pilot; place image and link lookup)';

export type MediaStatus = 'matched' | 'no_image' | 'no_free_image' | 'name_mismatch' | 'no_article' | 'rate_limited' | 'error';
export interface PlaceMedia {
  pinId: string;
  status: MediaStatus;
  checkedAt: string;
  article: { title: string; url: string; distanceM: number } | null;
  image: {
    fileTitle: string; commonsUrl: string; thumb250: string; thumb500: string; width500: number; height500: number;
    originalWidth: number; originalHeight: number; creator: string | null; licence: string; licenceUrl: string | null; credit: string; description: string | null;
    thumbVerifiedAt: string | null;
  } | null;
  note: string | null;
}

// ---------- matching ----------
const GENERIC = new Set(['slope', 'landslide', 'zone', 'flood', 'area', 'district', 'central', 'prone', 'risk', 'and', 'the', 'of', 'near', 'peat', 'peatland', 'swamp', 'forest', 'reserve', 'island', 'city', 'town', 'coastal', 'capital', 'industrial', 'estate', 'suburb', 'village']);
const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const tokens = (s: string): string[] => fold(s).split(/[^a-z0-9]+/).filter(Boolean);
export const significantTokens = (placeName: string): string[] => tokens(placeName).filter((t) => !GENERIC.has(t) && t.length > 1);

const COUNTRY_WORDS: Record<string, string[]> = { SG: ['singapore'], MY: ['malaysia'], BN: ['brunei', 'darussalam'] };
const NEUTRAL = new Set(['district', 'town', 'city', 'state', 'new', 'old']);

/** True when the article is about the PLACE: every significant word of the place name is in the title, and the title adds nothing
 *  beyond the place name, its region and its country ("Chinatown, Singapore" passes; "Telok Blangah MRT station", "Sembawang Library" and "Sembawang Hot Spring Park"
 *  do not, because a photo of a station, a library or a park is not a photo of the area). Slash-separated names are explicit alternatives. Parentheses qualify the main name and cannot substitute for it. */
export function titleMatches(placeName: string, title: string, context: { region?: string; country?: string } = {}): boolean {
  const have = new Set(tokens(title));
  const extraAllowed = new Set([...tokens(context.region ?? ''), ...(COUNTRY_WORDS[context.country ?? ''] ?? []), ...NEUTRAL]);
  const one = (name: string): boolean => {
    const sig = significantTokens(name);
    if (sig.length === 0) return false;
    const hit = sig.filter((t) => have.has(t)).length;
    if (hit !== sig.length) return false;   // every significant word: "Bukit Timah Road Canal" is not the article "Bukit Timah Road"
    const own = new Set(tokens(name));
    for (const t of have) if (!own.has(t) && !extraAllowed.has(t)) return false;
    return true;
  };
  const alternatives = placeName.split(/\s*\/\s*/).map((x) => x.split('(')[0]!.trim()).filter(Boolean);
  return alternatives.some(one);
}

// ---------- licence ----------
export function freeLicence(short: string): boolean {
  const s = short.trim();
  if (/^cc0\b/i.test(s) || /public domain|^pd\b|^pd-/i.test(s)) return true;
  if (/-nc\b|-nd\b|\bnc\b|\bnd\b/i.test(s)) return false;
  return /^cc[- ]by(-sa)?[- ]\d/i.test(s);
}
const stripHtml = (s: string): string => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();

// ---------- polite client ----------
export interface ClientOptions { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; minGapMs?: number; maxRetries?: number; firstBackoffMs?: number }
export interface Reply { status: number; json: unknown }
export class PoliteWikiClient {
  private last = 0;
  readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly minGap: number; private readonly maxRetries: number; private readonly firstBackoff: number;
  constructor(o: ClientOptions = {}) {
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.minGap = o.minGapMs ?? 1200; this.maxRetries = o.maxRetries ?? 3; this.firstBackoff = o.firstBackoffMs ?? 5000;
  }
  private async spaced(): Promise<void> {
    const wait = this.last + this.minGap - Date.now();
    if (wait > 0) await this.sleep(wait);
    this.last = Date.now();
  }
  /** GET json. A 429 or 503 is retried with backoff (honouring Retry-After); if it still fails the reply keeps that status so the caller can say "rate limited", never "missing". */
  async getJson(url: string): Promise<Reply> {
    let backoff = this.firstBackoff;
    for (let attempt = 0; ; attempt++) {
      await this.spaced();
      const res = await this.fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT } });
      if (res.status !== 429 && res.status !== 503) {
        let json: unknown = null;
        try { json = await res.json(); } catch { json = null; }
        return { status: res.status, json };
      }
      if (attempt >= this.maxRetries) return { status: res.status, json: null };
      const retryAfter = Number(res.headers.get('retry-after'));
      await this.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff);
      backoff *= 2;
    }
  }
  /** Checks that a thumbnail really loads (HEAD, then a ranged GET if HEAD is refused). Returns true only for a 200 image response. */
  async imageLoads(url: string): Promise<boolean | null> {
    await this.spaced();
    let res = await this.fetchImpl(url, { method: 'HEAD', headers: { 'User-Agent': USER_AGENT } });
    if (res.status === 429 || res.status === 503) return null;   // unknown, not broken
    if (res.status === 405 || res.status === 403) res = await this.fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Range: 'bytes=0-1023' } });
    if (res.status === 429 || res.status === 503) return null;
    return (res.status === 200 || res.status === 206) && (res.headers.get('content-type') ?? '').startsWith('image/');
  }
}

// ---------- resolution ----------
interface GeoHit { title: string; dist: number }
const api = (host: string, params: Record<string, string>): string => `https://${host}/w/api.php?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`;
const firstPage = (j: unknown): Record<string, unknown> => Object.values(((j as { query?: { pages?: Record<string, unknown> } })?.query?.pages ?? {}))[0] as Record<string, unknown> ?? {};
const missingPage = (page: Record<string, unknown>): boolean => Object.prototype.hasOwnProperty.call(page, 'missing');
const distanceM = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const rad = (n: number): number => n * Math.PI / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};
const context = (pin: { region?: string; country?: string }) => ({ ...(pin.region ? { region: pin.region } : {}), ...(pin.country ? { country: pin.country } : {}) });

async function exactTitlePage(pin: { name: string }, client: PoliteWikiClient): Promise<{ status: number; page: Record<string, unknown> }> {
  const reply = await client.getJson(api('en.wikipedia.org', {
    action: 'query', titles: pin.name, redirects: '1', prop: 'info|coordinates|pageimages', inprop: 'url', piprop: 'name',
  }));
  return { status: reply.status, page: firstPage(reply.json) };
}
const COUNTRY_NAMES: Record<string, string> = { SG: 'Singapore', MY: 'Malaysia', BN: 'Brunei' };
async function searchTitles(pin: { name: string; region?: string; country?: string }, client: PoliteWikiClient): Promise<{ status: number; titles: string[] }> {
  const query = [pin.name, pin.region, COUNTRY_NAMES[pin.country ?? '']].filter(Boolean).join(' ');
  const reply = await client.getJson(api('en.wikipedia.org', { action: 'query', list: 'search', srsearch: query, srnamespace: '0', srlimit: '5' }));
  const titles = ((reply.json as { query?: { search?: Array<{ title?: string }> } })?.query?.search ?? [])
    .map((candidate) => candidate.title).filter((candidate): candidate is string => typeof candidate === 'string');
  return { status: reply.status, titles };
}

export async function resolvePlaceMedia(pin: { pinId: string; name: string; lat: number; lng: number; region?: string; country?: string }, client: PoliteWikiClient, nowIso: string): Promise<PlaceMedia> {
  const base = { pinId: pin.pinId, checkedAt: nowIso, article: null, image: null, note: null } as PlaceMedia;
  const limited = (note: string): PlaceMedia => ({ ...base, status: 'rate_limited', note });
  const geo = await client.getJson(api('en.wikipedia.org', { action: 'query', list: 'geosearch', gscoord: `${pin.lat}|${pin.lng}`, gsradius: '5000', gslimit: '10' }));
  if (geo.status === 429 || geo.status === 503) return limited('geosearch throttled');
  if (geo.status !== 200) return { ...base, status: 'error', note: `geosearch HTTP ${geo.status}` };
  const hits = ((geo.json as { query?: { geosearch?: GeoHit[] } })?.query?.geosearch ?? []);
  const pinContext = context(pin);
  const match = hits.find((h) => titleMatches(pin.name, h.title, pinContext));
  let title = match?.title;
  let dist = match?.dist;
  let page: Record<string, unknown> = {};
  if (!title) {
    // Geosearch is supporting evidence only. An exact-title lookup can find a broad district article whose centre is beyond 5 km.
    const exact = await exactTitlePage(pin, client);
    if (exact.status === 429 || exact.status === 503) return limited('exact-title lookup throttled');
    if (exact.status !== 200) return { ...base, status: 'error', note: `exact-title lookup HTTP ${exact.status}` };
    page = exact.page;
    const exactTitle = typeof page['title'] === 'string' ? page['title'] : '';
    if (!missingPage(page) && titleMatches(pin.name, exactTitle, pinContext)) {
      title = exactTitle;
    } else {
      const search = await searchTitles(pin, client);
      if (search.status === 429 || search.status === 503) return limited('Wikipedia title search throttled');
      if (search.status !== 200) return { ...base, status: 'error', note: `Wikipedia title search HTTP ${search.status}` };
      const candidate = search.titles.find((candidateTitle) => titleMatches(pin.name, candidateTitle, pinContext));
      if (candidate) {
        const candidatePage = await exactTitlePage({ name: candidate }, client);
        if (candidatePage.status === 429 || candidatePage.status === 503) return limited('candidate page lookup throttled');
        if (candidatePage.status !== 200) return { ...base, status: 'error', note: `candidate page lookup HTTP ${candidatePage.status}` };
        const candidateTitle = typeof candidatePage.page['title'] === 'string' ? candidatePage.page['title'] : '';
        if (!missingPage(candidatePage.page) && titleMatches(pin.name, candidateTitle, pinContext)) {
          title = candidateTitle;
          page = candidatePage.page;
        }
      }
      if (!title) return { ...base, status: hits.length ? 'name_mismatch' : 'no_article', note: hits.length
        ? `nearby articles (${hits.slice(0, 3).map((h) => h.title).join(', ')}) and title search candidates do not agree with the place name`
        : `no matching article found by exact title or title search for ${pin.name}` };
    }
    if (!title) return { ...base, status: 'name_mismatch', note: 'no verified title match' };
    const coords = (page['coordinates'] as Array<{ lat?: number; lon?: number }> | undefined)?.[0];
    if (!match) dist = coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lon) ? distanceM(pin.lat, pin.lng, coords.lat!, coords.lon!) : undefined;
  }
  if (!title) return { ...base, status: 'name_mismatch', note: 'no verified title match' };
  if (dist === undefined || !Number.isFinite(dist)) return { ...base, status: 'error', note: `article "${title}" has no coordinates; storage contract cannot represent an unknown distance without inventing one` };
  const articleUrl = typeof page['fullurl'] === 'string' ? page['fullurl'] : `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  const article = { title, url: articleUrl, distanceM: Math.round(dist) };

  const pi = page['pageimage'] ? { status: 200, json: { query: { pages: { 1: page } } } } : await client.getJson(api('en.wikipedia.org', { action: 'query', titles: title, prop: 'pageimages', piprop: 'name', redirects: '1' }));
  if (pi.status === 429 || pi.status === 503) return { ...limited('pageimages throttled'), article };
  const fileName = firstPage(pi.json)['pageimage'];
  if (typeof fileName !== 'string') return { ...base, article, status: 'no_image', note: 'the article has no lead image (the link is still kept)' };

  const fileTitle = `File:${fileName}`;
  const info = await client.getJson(api('commons.wikimedia.org', { action: 'query', titles: fileTitle, prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: '500', redirects: '1' }));
  if (info.status === 429 || info.status === 503) return { ...limited('commons imageinfo throttled'), article };
  const ii = (firstPage(info.json)['imageinfo'] as Array<Record<string, unknown>> | undefined)?.[0];
  if (!ii) return { ...base, article, status: 'no_image', note: 'the lead image is not a Commons file (for example a local fair-use file)' };
  const meta = (ii['extmetadata'] ?? {}) as Record<string, { value?: string }>;
  const licence = stripHtml(meta['LicenseShortName']?.value ?? '');
  if (!freeLicence(licence)) return { ...base, article, status: 'no_free_image', note: `licence "${licence || 'unknown'}" is not one we accept (CC0, public domain, CC BY, CC BY-SA)` };

  const creator = meta['Artist']?.value ? stripHtml(meta['Artist'].value).slice(0, 120) : null;
  let thumb500 = String(ii['thumburl'] ?? '');
  let thumb250 = thumb500.replace('/500px-', '/250px-');
  if (!/\/500px-/.test(thumb500)) {
    // An image whose original is no wider than 500 px has no 500 px thumbnail: the API returns the original, which is already the right size.
    const originalWidth = Number(ii['width'] ?? 0);
    const original = String(ii['url'] ?? '');
    if (original && originalWidth > 0 && originalWidth <= 500) { thumb500 = original; thumb250 = original; }
    else return { ...base, article, status: 'error', note: 'the API did not return a 500 px thumbnail' };
  }
  const load250 = await client.imageLoads(thumb250);
  const load500 = await client.imageLoads(thumb500);
  const loads: boolean | null = load250 === false || load500 === false ? false : load250 === null || load500 === null ? null : true;
  const credit = `Photo: ${creator ?? 'unknown author'}, ${licence}, via Wikimedia Commons`;
  return {
    ...base, article, status: loads === false ? 'error' : 'matched',
    note: loads === false ? 'the 250 px or 500 px thumbnail did not load' : loads === null ? 'one or both thumbnail URLs not verified (rate limited)' : null,
    image: loads === false ? null : {
      fileTitle, commonsUrl: String(ii['descriptionurl'] ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(fileTitle.replace(/ /g, '_'))}`),
      thumb250, thumb500, width500: Number(ii['thumbwidth'] ?? 500), height500: Number(ii['thumbheight'] ?? 0),
      originalWidth: Number(ii['width'] ?? 0), originalHeight: Number(ii['height'] ?? 0),
      creator, licence, licenceUrl: meta['LicenseUrl']?.value ?? null, credit, description: meta['ImageDescription']?.value ? stripHtml(meta['ImageDescription'].value).slice(0, 240) : null,
      thumbVerifiedAt: loads === true ? nowIso : null,
    },
  };
}
