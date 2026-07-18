/**
 * Service worker minimo para la PWA de SmartLogistica.
 *
 * SOLO existe para la instalabilidad (que se pueda "instalar" la app) + cache de
 * los iconos para el arranque. NO cachea los chunks de Next ni el HTML.
 *
 * Por que NO cachear los chunks de Next: antes se hacia cache-first de todos los
 * `.js` y se guardaba cualquier respuesta. Si en un deploy un chunk devolvia un
 * 404/HTML transitorio, quedaba cacheado como si fuera JS -> "Unexpected token '<'"
 * -> la app entera reventaba con "client-side exception". Ademas los assets de
 * Next ya llevan hash + Cache-Control inmutable, asi que el cache HTTP del
 * navegador los maneja perfecto y SEGURO sin el SW.
 *
 * Version del cache: subirla PURGA el cache viejo en `activate` (recupera a los
 * usuarios que quedaron con un cache envenenado de una version anterior).
 */
const CACHE = 'smartlog-static-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((c) =>
      c.addAll(['/icons/icon-192.png', '/icons/icon-512.png']).catch(() => undefined),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // SOLO los iconos se sirven cache-first (para instalabilidad). Y solo se cachea
  // si la respuesta es 200 (nunca un 404/HTML). Todo lo demas -chunks de Next, CSS,
  // HTML, /v1- va a la RED directa, sin que el SW lo toque.
  if (url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => undefined);
            }
            return res;
          }),
      ),
    );
  }
});
