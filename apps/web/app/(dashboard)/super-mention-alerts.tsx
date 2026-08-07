'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Megaphone, X } from 'lucide-react';
import type { SuperMentionAlert } from '@smartlogistica/shared';

import { api } from '@/lib/api-client';
import { playSuperMentionSound } from '@/lib/notification-sound';
import { useCurrentUser } from '@/components/providers/current-user-provider';

import { getActiveChat } from './orders/active-chat';
import { orderTarget } from './use-mentions';
import { useOrdersStream } from './orders/use-orders-stream';

/**
 * SUPER MENCION (@todos): alerta MODAL para todo el equipo con acceso al
 * pedido, sin importar en que pestaña esten. Suena una fanfarria propia.
 * Quien no estaba en la plataforma la ve en el instante en que vuelve
 * (alertas persistentes en el server hasta cerrarlas). Montado UNA vez en el
 * layout del dashboard.
 */
export function SuperMentionAlerts() {
  const router = useRouter();
  const me = useCurrentUser();
  const [queue, setQueue] = useState<SuperMentionAlert[]>([]);
  const meRef = useRef(me);
  meRef.current = me;

  const pushAlert = useCallback((a: SuperMentionAlert) => {
    setQueue((q) => (q.some((x) => x.messageId === a.messageId) ? q : [...q, a]));
  }, []);

  // EN VIVO: el evento chat.message con superMention dispara la alerta ya.
  useOrdersStream(
    useCallback(
      (event) => {
        const my = meRef.current;
        if (!event || event.kind !== 'chat.message' || event.superMention !== true || !my) return;
        if (String(event.authorId ?? '') === my.id) return;
        const mentions = Array.isArray(event.mentions) ? (event.mentions as string[]) : [];
        if (!mentions.includes(my.id)) return;
        playSuperMentionSound();
        const messageId = String(event.messageId ?? '');
        // Si estoy MIRANDO ese chat, no tiene sentido el modal: solo suena y
        // se cierra la alerta persistente.
        if (getActiveChat() === String(event.orderId ?? '')) {
          void api.post('/v1/orders/super-mentions/ack', { messageIds: [messageId] }).catch(() => {});
          return;
        }
        pushAlert({
          id: messageId,
          orderId: String(event.orderId ?? ''),
          messageId,
          externalId: String(event.externalId ?? ''),
          customerName: String(event.customerName ?? ''),
          warehouseId: (event.warehouseId as string | null) ?? null,
          stage: event.warehouseId ? 'pending' : 'general',
          authorName: String(event.authorName ?? ''),
          preview: String(event.body ?? ''),
          createdAt: new Date().toISOString(),
        });
      },
      [pushAlert],
    ),
  );

  // AL VOLVER a la plataforma (abrir/enfocar la pestaña): alertas pendientes.
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      api
        .get<SuperMentionAlert[]>('/v1/orders/super-mentions/pending')
        .then((rows) => {
          if (cancelled || rows.length === 0) return;
          playSuperMentionSound();
          rows.reverse().forEach(pushAlert);
        })
        .catch(() => {});
    };
    check();
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [pushAlert]);

  const current = queue[0];
  if (!current || typeof document === 'undefined') return null;

  const ack = () => {
    void api
      .post('/v1/orders/super-mentions/ack', { messageIds: [current.messageId] })
      .catch(() => {});
    setQueue((q) => q.slice(1));
  };
  const goTo = () => {
    const url = `${orderTarget(current)}&msg=${encodeURIComponent(current.messageId)}`;
    ack();
    router.push(url);
  };

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[rgba(5,8,14,0.6)] backdrop-blur-[3px]" />
      <div className="shadow-pop relative w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-popover">
        {/* Franja superior con el megafono pulsando */}
        <div className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400">
            <Megaphone className="h-5 w-5" />
            <span className="absolute -inset-1 animate-ping rounded-full border-2 border-amber-500/40" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-amber-700 dark:text-amber-400">
              Súper mención
            </p>
            <p className="truncate text-sm font-semibold">
              {current.authorName} mencionó a todo el equipo
            </p>
          </div>
          {queue.length > 1 ? (
            <span className="ml-auto shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 font-mono text-[10.5px] font-semibold text-amber-700 dark:text-amber-400">
              +{queue.length - 1}
            </span>
          ) : null}
        </div>

        <div className="space-y-2.5 px-4 py-3.5">
          <p className="font-mono text-[11px] text-muted-foreground">
            #{current.externalId} · {current.customerName}
          </p>
          {current.preview ? (
            <p className="line-clamp-3 rounded-lg bg-muted px-3 py-2 text-[13.5px] leading-snug">
              {current.preview}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={ack}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
              Cerrar
            </button>
            <button
              type="button"
              onClick={goTo}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-[13px] font-semibold text-accent-foreground transition-[filter] hover:brightness-110"
            >
              Ir al pedido
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
