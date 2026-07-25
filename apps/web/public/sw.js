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
const CACHE = 'smartlog-static-v7';

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

/**
 * WEB PUSH: el servidor manda la notificacion aunque la app este CERRADA —
 * el sistema despierta a este service worker y aqui se muestra como
 * notificacion NATIVA. Payload: {title, body, url}.
 */
/**
 * WEB PUSH con notificacion UNICA acumulada (estilo WhatsApp/Google Chat):
 * siempre hay UNA notificacion de SmartLogistica que se actualiza con la
 * lista de los ultimos mensajes y el contador — venga del pedido que venga —
 * y VUELVE a sonar (renotify). Al tocarla: si todo es del mismo pedido abre
 * ese chat; si hay varios, abre Menciones. El cliente la limpia al enfocar
 * la app (como WhatsApp al leer).
 */
const CHAT_TAG = 'smartlog-chat';

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'SmartLogistica', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    (async () => {
      // Acumular sobre la notificacion existente (si el usuario no la ha tocado).
      const existing = await self.registration.getNotifications({ tag: CHAT_TAG });
      const prev = (existing[0] && existing[0].data) || {};
      const line = data.line || data.title || 'Mensaje nuevo';
      const lines = (Array.isArray(prev.lines) ? prev.lines : []).concat(line).slice(-6);
      const urls = Array.isArray(prev.urls) ? prev.urls.slice() : [];
      if (data.url && urls.indexOf(data.url) === -1) urls.push(data.url);
      const count = (prev.count || 0) + 1;
      const single = urls.length <= 1;

      const title =
        count === 1
          ? data.title || 'SmartLogistica'
          : single
            ? (data.title || '').split(' · ')[1]
              ? `${count} mensajes · ${(data.title || '').split(' · ')[1]}`
              : `${count} mensajes nuevos`
            : `${count} mensajes en ${urls.length} pedidos`;
      const body = count === 1 ? data.body || '' : lines.join('\n');

      await self.registration.showNotification(title, {
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: CHAT_TAG,
        renotify: true,
        data: {
          url: single ? urls[0] || '/mentions' : '/mentions',
          lines,
          urls,
          count,
        },
      });
    })(),
  );
});

/**
 * Click en una notificacion NATIVA (mostrada via registration.showNotification):
 * enfoca una pestana/ventana de la app si existe y navega al pedido; si no,
 * abre una nueva. `data.url` viene del cliente al crear la notificacion.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => 'focus' in c);
      if (existing) {
        return existing.focus().then((c) => ('navigate' in c ? c.navigate(url) : undefined));
      }
      return self.clients.openWindow(url);
    }),
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
