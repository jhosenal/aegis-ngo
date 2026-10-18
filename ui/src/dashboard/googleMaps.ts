/// <reference types="google.maps" />

let loading: Promise<typeof google.maps> | null = null;
const MAP_LANGUAGE_KEY = 'aegis-map-language';
export type MapLanguage = 'en' | 'zh' | 'ms' | 'ta';
const MAP_LANGUAGE_CODES: Record<MapLanguage, string> = { en: 'en', zh: 'zh-CN', ms: 'ms', ta: 'ta' };
let loadedLanguage: MapLanguage | null = null;
type MapsWindow = Window & { google?: typeof google; aegisMapsReady?: () => void; gm_authFailure?: () => void };

export function getMapLanguage(): MapLanguage {
  try {
    const value = window.localStorage.getItem(MAP_LANGUAGE_KEY);
    if (value === 'en' || value === 'zh' || value === 'ms' || value === 'ta') return value;
  } catch { /* Storage can be disabled; English remains the default. */ }
  return 'en';
}

/** Google applies locale when its SDK is loaded; reload so every map uses the selected tile language. */
export function selectMapLanguage(language: MapLanguage): void {
  const previous = getMapLanguage();
  try { window.localStorage.setItem(MAP_LANGUAGE_KEY, language); } catch { /* The current page still reloads with its selected locale. */ }
  if (previous === language && loadedLanguage === language) return;
  window.location.reload();
}

/** One SDK request per page. Only the dedicated, referrer-restricted browser key is accepted. */
export function loadGoogleMaps(apiKey: string): Promise<typeof google.maps> {
  const host = window as MapsWindow;
  if (loading) return loading;
  if (host.google?.maps?.Map && host.google.maps.marker?.AdvancedMarkerElement) return Promise.resolve(host.google.maps);
  const language = getMapLanguage();
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    // A failed load must not be remembered: drop the cached promise and the dead script tag so the Retry button can try again.
    const fail = () => { clearTimeout(timeout); loading = null; loadedLanguage = null; script.remove(); reject(new Error('Google Maps could not load')); };
    const timeout = window.setTimeout(fail, 20_000);
    host.gm_authFailure = () => {
      fail();
      window.dispatchEvent(new Event('aegis-maps-auth-failure'));
    };
    host.aegisMapsReady = () => {
      clearTimeout(timeout);
      if (host.google?.maps?.Map && host.google.maps.marker?.AdvancedMarkerElement) resolve(host.google.maps);
      else reject(new Error('Google Maps libraries unavailable'));
    };
    const params = new URLSearchParams({ key: apiKey, v: 'quarterly', loading: 'async', libraries: 'marker', language: MAP_LANGUAGE_CODES[language], callback: 'aegisMapsReady' });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    loadedLanguage = language;
    script.async = true;
    script.referrerPolicy = 'strict-origin-when-cross-origin';
    script.onerror = fail;
    script.dataset.aegisMaps = 'true';
    document.head.append(script);
  });
  return loading;
}
