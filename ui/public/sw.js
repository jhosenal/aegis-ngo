const CACHE_PREFIX = 'aegis-assist-';
const CACHE_NAME = `${CACHE_PREFIX}v3`;
const CARD_PATH = '/public/assist/cards';
const CARD_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const APP_SHELL = [
  '/assist',
  '/assist/guidance',
  '/manifest.webmanifest',
  '/offline.html',
  '/icons/assist-192.svg',
  '/icons/assist-512.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(APP_SHELL.map((path) => cacheShellResource(cache, path)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (data?.type !== 'PRECACHE_ASSIST_CONTENT' || !Array.isArray(data.urls)) return;

  const urls = data.urls.filter((value) => typeof value === 'string');
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const results = await Promise.all(urls.map((value) => cacheContentUrl(cache, value)));
    event.ports[0]?.postMessage({ ok: results.every(Boolean), urls: urls.filter((_url, index) => results[index]) });
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('authorization')) return;

  if (request.mode === 'navigate' && isAssistNavigation(url.pathname)) {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isPublicAssistContentPath(url.pathname) || url.pathname.startsWith('/content/assist/')) {
    event.respondWith(networkFirstCards(request));
    return;
  }

  if (isApiPath(url.pathname)) return;
  if (isVersionedStaticAsset(url.pathname)) event.respondWith(cacheFirstStatic(request));
});

async function cacheShellResource(cache, path) {
  try {
    const response = await fetch(path, { cache: 'reload' });
    if (isCacheable(response) && !isApiPath(path)) await cache.put(path, response);
  } catch {
    // The route may be wired after the worker; this must not prevent installation.
  }
}

async function cacheContentUrl(cache, value) {
  let url;
  try {
    url = new URL(value, self.location.origin);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin || isApiPath(url.pathname) || !isAllowedContentPath(url.pathname)) return false;
  const request = new Request(url.href, { method: 'GET', cache: 'no-cache' });
  if (request.method !== 'GET' || request.headers.has('authorization')) return false;
  try {
    const response = await fetch(request);
    if (isCacheable(response) && isPublicContentResponse(url.pathname, response)) {
      await putWithTimestamp(cache, request, response);
      return true;
    } else {
      await cache.delete(request);
      return false;
    }
  } catch {
    // Keep any still-fresh copy already saved from a previous online visit.
    const previous = await cache.match(request);
    return Boolean(previous && !isExpired(previous));
  }
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request, { cache: 'no-cache' });
    if (isCacheable(response)) await (await caches.open(CACHE_NAME)).put(request, response.clone());
    return response;
  } catch {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(request)
      || await cache.match('/assist')
      || await cache.match('/offline.html')
      || Response.error();
  }
}

async function networkFirstCards(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request, { cache: 'no-cache' });
    if (isCacheable(response) && isPublicContentResponse(new URL(request.url).pathname, response)) {
      await putWithTimestamp(cache, request, response);
    } else {
      await cache.delete(request);
    }
    return response;
  } catch {
    const saved = await cache.match(request);
    if (!saved) return Response.error();
    if (isExpired(saved)) {
      await cache.delete(request);
      return Response.error();
    }
    return saved;
  }
}

async function cacheFirstStatic(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (isCacheable(response)) await cache.put(request, response.clone());
  return response;
}

async function putWithTimestamp(cache, request, response) {
  const headers = new Headers(response.headers);
  headers.set('X-Aegis-Assist-Cached-At', String(Date.now()));
  const cachedResponse = new Response(await response.clone().arrayBuffer(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  await cache.put(request, cachedResponse);
}

function isExpired(response) {
  const storedAt = Number(response.headers.get('X-Aegis-Assist-Cached-At'));
  return !Number.isFinite(storedAt) || storedAt <= 0 || Date.now() - storedAt > CARD_CACHE_MAX_AGE_MS;
}

function isCacheable(response) {
  if (!response || !response.ok || response.type === 'opaque') return false;
  const cacheControl = response.headers.get('cache-control')?.toLowerCase() ?? '';
  return !/(?:^|,\s*)(?:private|no-store)(?:\s|,|$)/.test(cacheControl);
}

function isPublicContentResponse(path, response) {
  if (path === CARD_PATH || path.startsWith(`${CARD_PATH}/`)) {
    return /(?:^|,\s*)public(?:\s|,|$)/i.test(response.headers.get('cache-control') ?? '');
  }
  return true;
}

function isAllowedContentPath(path) {
  return path.startsWith('/public/assist/')
    || path.startsWith('/content/assist/')
    || (path.startsWith('/assets/') && !isSceneRuntimeAsset(path));
}

function isPublicAssistContentPath(path) {
  return path === CARD_PATH
    || path.startsWith(`${CARD_PATH}/`);
}

function isApiPath(path) {
  return path === '/api' || path.startsWith('/api/');
}

function isVersionedStaticAsset(path) {
  return !isSceneRuntimeAsset(path)
    && path.startsWith('/assets/')
    && /(?:^|[.-])[A-Za-z0-9_-]{8,}(?=\.)/.test(path)
    || (!isSceneRuntimeAsset(path)
      && (path === '/manifest.webmanifest' || path === '/offline.html' || path.startsWith('/icons/')));
}

function isSceneRuntimeAsset(path) {
  return /(?:^|\/)sceneRuntime-[^/]+\.js$/i.test(path);
}

function isAssistNavigation(path) {
  return path === '/assist' || path === '/assist/' || path === '/assist/guidance' || path === '/assist/guidance/';
}
