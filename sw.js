/* LibreHoy · Service Worker
 * Nota: la app solo funciona sin conexión si se cargó al menos una vez con red.
 * Si no hubo una carga previa, el navegador mostrará su error estándar de red.
 * Las actualizaciones quedan en "waiting" hasta que la página envíe SKIP_WAITING
 * (toast "Nueva versión disponible"); la primera instalación se activa sola.
 */
const CACHE_VERSION = 'librehoy-v2';
const FONT_CACHE = 'librehoy-fonts-v2';
const FONT_CACHE_MAX_ENTRIES = 40;
const PRECACHE_URLS = ['./', './index.html', './manifest.webmanifest'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('librehoy-') && key !== CACHE_VERSION && key !== FONT_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(handleNavigation(event));
    return;
  }

  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(event, FONT_CACHE, true));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(event, CACHE_VERSION, false));
  }
});

async function handleNavigation(event) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = (await cache.match('./index.html')) || (await cache.match('./'));

  const network = fetch(event.request)
    .then((response) => {
      if (response && response.ok) {
        cache.put('./index.html', response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(network);
    return cached;
  }

  const fresh = await network;
  return fresh || new Response('Sin conexión. Abre LibreHoy una vez con internet para usarla sin conexión.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

async function staleWhileRevalidate(event, cacheName, allowOpaque) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request);

  const network = fetch(event.request)
    .then(async (response) => {
      const cacheable = response && (response.ok || (allowOpaque && response.type === 'opaque'));
      if (cacheable) {
        await cache.put(event.request, response.clone());
        if (allowOpaque) await trimCache(cache, FONT_CACHE_MAX_ENTRIES);
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(network);
    return cached;
  }

  const fresh = await network;
  return fresh || Response.error();
}

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  const excess = keys.length - maxEntries;
  for (let i = 0; i < excess; i += 1) {
    await cache.delete(keys[i]);
  }
}
