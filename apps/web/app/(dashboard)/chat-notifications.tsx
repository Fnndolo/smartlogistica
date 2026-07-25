'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { useCurrentUser } from '@/components/providers/current-user-provider';
import { api } from '@/lib/api-client';
import { ensureAudioReady, playNotificationSound } from '@/lib/notification-sound';

import { getActiveChat } from './orders/active-chat';
import { useOrdersStream, type RealtimeEvent } from './orders/use-orders-stream';

/** La llave publica VAPID (base64url) al formato que pide pushManager.subscribe. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(b64);
  // ArrayBuffer explicito: BufferSource no admite SharedArrayBuffer en TS.
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Notificaciones de chat estilo Google Chat (montado UNA vez en el layout):
 * - SONIDO propio siempre que algo me concierne, aunque las notificaciones del
 *   navegador esten apagadas: me mencionan, me responden, escriben en una
 *   conversacion donde participo, o reaccionan a un mensaje mio.
 * - Notificacion del NAVEGADOR (PC y movil/PWA) para lo mismo; el permiso se
 *   pide con el primer gesto del usuario. Click -> abre el pedido en su chat.
 */
export function ChatNotifications() {
  const me = useCurrentUser();
  const router = useRouter();
  // true = este dispositivo recibe WEB PUSH del servidor -> las notificaciones
  // del sistema llegan por ahi (app abierta o cerrada) y el cliente NO crea
  // otras (evita duplicados y el reemplazo silencioso por tag).
  const pushActiveRef = useRef(false);

  useEffect(() => {
    ensureAudioReady();
    if (typeof window === 'undefined' || !('Notification' in window)) return;

    // Suscribirse a WEB PUSH: asi el servidor puede notificar con la app
    // CERRADA (el push despierta al service worker del dispositivo).
    const subscribePush = async () => {
      try {
        if (Notification.permission !== 'granted') return;
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
        const { key } = await api.get<{ key: string }>('/v1/push/vapid-key');
        if (!key) return; // push apagado en el servidor
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        const sub =
          existing ??
          (await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(key),
          }));
        // Registrar/refrescar en el server (liga el dispositivo al usuario actual).
        await api.post('/v1/push/subscriptions', sub.toJSON());
        pushActiveRef.current = true;
      } catch {
        /* sin soporte o rechazado: el resto de notificaciones sigue andando */
      }
    };

    if (Notification.permission === 'granted') {
      void subscribePush();
      return;
    }
    if (Notification.permission !== 'default') return;
    // Pedir permiso de notificaciones con el primer gesto (los navegadores
    // exigen interaccion; pedirlo "en frio" lo bloquea en silencio).
    const ask = () => {
      void Notification.requestPermission().then((p) => {
        if (p === 'granted') void subscribePush();
      });
      window.removeEventListener('pointerdown', ask);
      window.removeEventListener('keydown', ask);
    };
    window.addEventListener('pointerdown', ask, { once: true });
    window.addEventListener('keydown', ask, { once: true });
    return () => {
      window.removeEventListener('pointerdown', ask);
      window.removeEventListener('keydown', ask);
    };
  }, []);

  // Notificacion del sistema SOLO como respaldo cuando el push no quedo
  // activo en este dispositivo (p. ej. VAPID sin configurar). Con push activo,
  // el servidor ya manda la notificacion (y se apilan como WhatsApp).
  // Al volver a la app, limpiar la notificacion acumulada del sistema (como
  // WhatsApp cuando entras: la bandeja queda al dia).
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    const clear = () => {
      if (document.visibilityState !== 'visible') return;
      void navigator.serviceWorker.getRegistration().then(async (reg) => {
        const shown = await reg?.getNotifications({ tag: 'smartlog-chat' });
        shown?.forEach((n) => n.close());
      });
    };
    clear();
    document.addEventListener('visibilitychange', clear);
    window.addEventListener('focus', clear);
    return () => {
      document.removeEventListener('visibilitychange', clear);
      window.removeEventListener('focus', clear);
    };
  }, []);

  const notifyBrowser = useCallback(
    (title: string, body: string, target: string) => {
      if (pushActiveRef.current) return;
      if (typeof window === 'undefined' || !('Notification' in window)) return;
      if (Notification.permission !== 'granted') return;
      const options: NotificationOptions & { data: { url: string }; renotify?: boolean } = {
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        // tag por pedido + renotify: colapsa mensajes del mismo pedido en una
        // notificacion que se actualiza Y suena; pedidos distintos se apilan.
        tag: target,
        renotify: true,
        data: { url: target },
      };
      const viaSw = async (): Promise<boolean> => {
        if (!('serviceWorker' in navigator)) return false;
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg) return false;
        await reg.showNotification(title, options);
        return true;
      };
      void viaSw()
        .catch(() => false)
        .then((shown) => {
          if (shown) return;
          // Fallback escritorio sin SW activo.
          try {
            const n = new Notification(title, options);
            n.onclick = () => {
              window.focus();
              router.push(target);
              n.close();
            };
          } catch {
            /* sin soporte: el sonido + toast ya avisaron */
          }
        });
    },
    [router],
  );

  const onEvent = useCallback(
    (event?: RealtimeEvent) => {
      if (!event || !me) return;

      // Si estoy MIRANDO ese chat ahora mismo, no hay nada que avisar (el
      // mensaje aparece en pantalla): sin sonido, sin toast, sin notificacion.
      const viewingThisChat =
        document.visibilityState === 'visible' &&
        getActiveChat() === String(event.orderId ?? '');
      if (viewingThisChat) return;

      if (event.kind === 'chat.message') {
        const authorId = String(event.authorId ?? '');
        if (authorId === me.id) return; // lo escribi yo
        const mentions = Array.isArray(event.mentions) ? (event.mentions as string[]) : [];
        const participants = Array.isArray(event.participantIds)
          ? (event.participantIds as string[])
          : [];
        const mentioned = mentions.includes(me.id);
        const replied = String(event.replyToAuthorId ?? '') === me.id;
        const participating = participants.includes(me.id);
        if (!mentioned && !replied && !participating) return;

        const author = String(event.authorName ?? 'Alguien');
        // En notificaciones va el NOMBRE DEL CLIENTE del pedido, no el MKT.
        const customer = String(event.customerName ?? event.externalId ?? '');
        const body = String(event.body ?? '');
        const target = event.warehouseId
          ? `/warehouses/${String(event.warehouseId)}?order=${String(event.orderId)}`
          : `/orders?order=${String(event.orderId)}`;

        playNotificationSound();
        notifyBrowser(
          mentioned ? `${author} te mencionó · ${customer}` : `${author} · ${customer}`,
          body,
          target,
        );
        // El toast de menciones ya lo da la pagina de Menciones; aqui solo
        // respuestas y mensajes de conversaciones donde participo.
        if (!mentioned && document.visibilityState === 'visible') {
          toast(replied ? `${author} respondió tu mensaje` : `${author} · ${customer}`, {
            description: body,
          });
        }
        return;
      }

      if (event.kind === 'chat.reaction') {
        if (String(event.messageAuthorId ?? '') !== me.id) return; // no es mi mensaje
        if (String(event.reactorId ?? '') === me.id) return; // reaccione yo
        const reactor = String(event.reactorName ?? 'Alguien');
        const emoji = String(event.emoji ?? '');
        const customer = String(event.customerName ?? event.externalId ?? '');
        const target = event.warehouseId
          ? `/warehouses/${String(event.warehouseId)}?order=${String(event.orderId)}`
          : `/orders?order=${String(event.orderId)}`;

        playNotificationSound();
        notifyBrowser(`${reactor} reaccionó ${emoji} · ${customer}`, 'A tu mensaje', target);
        if (document.visibilityState === 'visible') {
          toast(`${reactor} reaccionó ${emoji} a tu mensaje`, { description: customer });
        }
      }
    },
    [me, notifyBrowser],
  );

  useOrdersStream(onEvent);
  return null;
}
