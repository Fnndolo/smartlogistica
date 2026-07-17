/**
 * Service worker minimo para la PWA de SmartLogistica.
 *
 * Objetivos: habilitar la instalacion y dar arranque rapido de los assets
 * estaticos, SIN cachear datos con sesion (nada de /v1, ni HTML de paginas
 * autenticadas) para no servir informacion vieja o de otro usuario.
 *
 * Estrategia:
 *  - Navegaciones (documentos): SIEMPRE a la red (network-first). Asi el usuario
 *    ve datos frescos y respeta la sesion/cookies; el SW solo existe para la
 *    instalabilidad y el cache de assets.
 *  - Assets del build de Next (/_next/static, iconos, fuentes): cache-first
 *    (son inmutables, llevan hash).
 *  - Nunca se toca /v1 (API) ni peticiones a otros origenes.
 */
const CACHE = 'smartlog-static-v1';

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

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/pdf.worker.min.mjs' ||
    /\.(?:css|js|woff2?|png|jpg|jpeg|svg|webp|gif|ico)$/.test(url.pathname)
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // otros origenes: sin tocar
  if (url.pathname.startsWith('/v1/')) return; // API con sesion: nunca cachear

  // Assets inmutables del build: cache-first.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => undefined);
            return res;
          }),
      ),
    );
    return;
  }
  // Todo lo demas (navegaciones/HTML): red directa, sin cache.
});
