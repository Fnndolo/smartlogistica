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
const CACHE = 'smartlog-static-v9';

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
 * WEB PUSH acumulado POR PEDIDO (estilo WhatsApp): cada pedido tiene UNA
 * notificacion que se actualiza con sus mensajes — el NOMBRE de quien escribe
 * aparece una sola vez y debajo van sus mensajes; si escriben varias personas,
 * cada bloque lleva su nombre. Vuelve a sonar con cada mensaje (renotify).
 * Pedidos distintos = notificaciones separadas. El cliente las limpia al
 * enfocar la app (como WhatsApp al leer).
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'SmartLogistica', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    (async () => {
      const tag = 'smartlog-order-' + (data.url || 'general');
      const existing = await self.registration.getNotifications({ tag });
      const prev = (existing[0] && existing[0].data) || {};

      // Entradas estructuradas {a: autor, m: mensaje} (ultimas 8).
      const entries = (Array.isArray(prev.entries) ? prev.entries : [])
        .concat([{ a: data.author || '', m: data.msg || data.body || '' }])
        .slice(-8);
      const count = (prev.count || 0) + 1;

      let title;
      let body;
      if (count === 1) {
        title = data.title || 'SmartLogistica';
        body = data.body || '';
      } else {
        title = `${count} mensajes · ${data.customer || 'SmartLogistica'}`;
        // Nombre UNA vez y debajo sus mensajes; nuevo bloque al cambiar de autor.
        const parts = [];
        let lastAuthor = null;
        for (const e of entries) {
          if (e.a && e.a !== lastAuthor) {
            parts.push(e.a);
            lastAuthor = e.a;
          }
          if (e.m) parts.push('  ' + e.m);
        }
        body = parts.join('\n');
      }

      await self.registration.showNotification(title, {
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag,
        renotify: true,
        data: { url: data.url || '/mentions', entries, count },
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
