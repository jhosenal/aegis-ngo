import { useEffect, useState } from 'react';

const CONTENT_CACHE_MESSAGE = 'PRECACHE_ASSIST_CONTENT';
const PRECACHE_COMPLETE_EVENT = 'aegis-assist-precache-complete';

/** Register Assist PWA support and ask its worker to save the supplied public content URLs. */
export async function registerAssistServiceWorker(contentUrls: string[]): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !isAllowedOrigin(window.location)) return null;

  try {
    ensureManifestLink();
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    const urls = collectPrecacheUrls(contentUrls);
    let precacheComplete = false;
    try {
      const ready = await navigator.serviceWorker.ready;
      precacheComplete = await precacheContent(ready.active, urls);
    } catch {
      // The page remains available if pre-caching is unavailable or interrupted.
    } finally {
      window.dispatchEvent(new CustomEvent(PRECACHE_COMPLETE_EVENT, {
        detail: { complete: precacheComplete, urls },
      }));
    }
    return registration;
  } catch {
    // Assist remains usable online if the browser blocks worker registration.
    return null;
  }
}

/** Track the browser's online/offline signal for a visible status badge. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);

  useEffect(() => {
    const markOnline = () => setOnline(true);
    const markOffline = () => setOnline(false);
    window.addEventListener('online', markOnline);
    window.addEventListener('offline', markOffline);
    setOnline(navigator.onLine);
    return () => {
      window.removeEventListener('online', markOnline);
      window.removeEventListener('offline', markOffline);
    };
  }, []);

  return online;
}

function isAllowedOrigin(location: Location): boolean {
  return location.protocol === 'https:'
    || location.hostname === 'localhost'
    || location.hostname.endsWith('.localhost')
    || location.hostname === '127.0.0.1'
    || location.hostname === '[::1]';
}

function ensureManifestLink(): void {
  if (document.querySelector('link[rel="manifest"]')) return;
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = '/manifest.webmanifest';
  document.head.append(link);
}

function collectPrecacheUrls(contentUrls: string[]): string[] {
  const urls = new Set<string>();
  urls.add('/public/assist/cards');
  for (const contentUrl of contentUrls) urls.add(contentUrl);

  const addAsset = (candidate: string): void => {
    try {
      const url = new URL(candidate, window.location.href);
      if (url.origin !== window.location.origin || !url.pathname.startsWith('/assets/')) return;
      if (/(?:^|\/)sceneRuntime-[^/]+\.js$/i.test(url.pathname)) return;
      urls.add(`${url.pathname}${url.search}`);
    } catch {
      // Ignore malformed or non-URL resource entries.
    }
  };

  for (const script of Array.from(document.scripts)) {
    if (script.src) addAsset(script.src);
  }
  for (const stylesheet of Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]'))) {
    addAsset(stylesheet.href);
  }
  for (const entry of performance.getEntriesByType('resource')) {
    addAsset(entry.name);
  }
  return [...urls];
}

function precacheContent(worker: ServiceWorker | null, contentUrls: string[]): Promise<boolean> {
  if (!worker || contentUrls.length === 0) return Promise.resolve(false);

  return new Promise<boolean>((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    const timeout = window.setTimeout(() => finish(false), 10_000);
    channel.port1.onmessage = (event: MessageEvent<{ ok?: boolean }>) => finish(event.data?.ok === true);
    try {
      worker.postMessage({ type: CONTENT_CACHE_MESSAGE, urls: contentUrls }, [channel.port2]);
    } catch {
      finish(false);
    }

    function finish(success: boolean): void {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      channel.port1.close();
      channel.port2.close();
      resolve(success);
    }
  });
}
