'use client';

import { useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { useCurrentUser } from '@/components/providers/current-user-provider';
import { ensureAudioReady, playNotificationSound } from '@/lib/notification-sound';

import { useOrdersStream, type RealtimeEvent } from './orders/use-orders-stream';

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

  useEffect(() => {
    ensureAudioReady();
    // Pedir permiso de notificaciones con el primer gesto (los navegadores
    // exigen interaccion; pedirlo "en frio" lo bloquea en silencio).
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'default') return;
    const ask = () => {
      void Notification.requestPermission();
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

  const notifyBrowser = useCallback(
    (title: string, body: string, target: string) => {
      if (typeof window === 'undefined' || !('Notification' in window)) return;
      if (Notification.permission !== 'granted') return;
      try {
        const n = new Notification(title, {
          body,
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag: target, // agrupa notifs del mismo pedido
        });
        n.onclick = () => {
          window.focus();
          router.push(target);
          n.close();
        };
      } catch {
        /* algunos navegadores moviles exigen SW para Notification: se ignora */
      }
    },
    [router],
  );

  const onEvent = useCallback(
    (event?: RealtimeEvent) => {
      if (!event || !me) return;

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
        const externalId = String(event.externalId ?? '');
        const body = String(event.body ?? '');
        const target = event.warehouseId
          ? `/warehouses/${String(event.warehouseId)}?order=${String(event.orderId)}`
          : `/orders?order=${String(event.orderId)}`;

        playNotificationSound();
        notifyBrowser(
          mentioned ? `${author} te mencionó · ${externalId}` : `${author} · ${externalId}`,
          body,
          target,
        );
        // El toast de menciones ya lo da la pagina de Menciones; aqui solo
        // respuestas y mensajes de conversaciones donde participo.
        if (!mentioned && document.visibilityState === 'visible') {
          toast(replied ? `${author} respondió tu mensaje` : `${author} · ${externalId}`, {
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
        const externalId = String(event.externalId ?? '');
        const target = event.warehouseId
          ? `/warehouses/${String(event.warehouseId)}?order=${String(event.orderId)}`
          : `/orders?order=${String(event.orderId)}`;

        playNotificationSound();
        notifyBrowser(`${reactor} reaccionó ${emoji}`, `A tu mensaje · ${externalId}`, target);
        if (document.visibilityState === 'visible') {
          toast(`${reactor} reaccionó ${emoji} a tu mensaje`, { description: externalId });
        }
      }
    },
    [me, notifyBrowser],
  );

  useOrdersStream(onEvent);
  return null;
}
