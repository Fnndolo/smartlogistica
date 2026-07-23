'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns/formatDistanceToNow';
import { es } from 'date-fns/locale/es';
import { AtSign, Bell } from 'lucide-react';
import { toast } from 'sonner';
import type { Inbox, MemberSummary } from '@smartlogistica/shared';

import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import { initialsOf, splitMentions } from './orders/mention-utils';
import { useOrdersStream } from './orders/use-orders-stream';

/**
 * Campana de notificaciones: pedidos con mensajes sin leer para el usuario.
 * No hace polling propio — se refresca con el SSE que ya existe (cada mensaje
 * nuevo publica `orders.refresh`). Al hacer clic en un item se abre el pedido.
 */
export function NotificationBell({ align = 'left' }: { align?: 'left' | 'right' }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const seenMentions = useRef<Set<string> | null>(null);

  const { data: inbox } = useQuery({
    queryKey: ['inbox'],
    queryFn: () => api.get<Inbox>('/v1/orders/inbox'),
    staleTime: 10_000,
  });

  // Miembros: para pintar menciones como chips y mostrar nombres (no correos).
  const { data: members = [] } = useQuery({
    queryKey: ['members'],
    queryFn: () => api.get<MemberSummary[]>('/v1/members'),
    staleTime: 5 * 60_000,
  });
  const nameOf = (raw: string): string =>
    members.find((m) => m.email === raw)?.name ?? raw;

  // Refrescar la bandeja con cada evento de tiempo real (sin polling propio).
  useOrdersStream(
    useCallback(() => {
      qc.invalidateQueries({ queryKey: ['inbox'] });
    }, [qc]),
  );

  // Aviso (toast) cuando aparece una mencion nueva sin leer.
  useEffect(() => {
    if (!inbox) return;
    const current = new Set(inbox.items.filter((i) => i.mentioned).map((i) => i.orderId));
    if (seenMentions.current === null) {
      seenMentions.current = current; // primera carga: no avisar de lo ya existente
      return;
    }
    for (const it of inbox.items) {
      if (it.mentioned && !seenMentions.current.has(it.orderId)) {
        toast(`Te mencionaron en el pedido ${it.externalId}`, { icon: '@' });
      }
    }
    seenMentions.current = current;
  }, [inbox]);

  const total = inbox?.totalUnread ?? 0;
  const mentions = inbox?.mentions ?? 0;
  const items = inbox?.items ?? [];

  const goto = (orderId: string, warehouseId: string | null) => {
    setOpen(false);
    const base = warehouseId ? `/warehouses/${warehouseId}` : '/orders';
    router.push(`${base}?order=${encodeURIComponent(orderId)}`);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Notificaciones"
        title="Notificaciones"
      >
        <Bell className="h-[18px] w-[18px]" />
        {total > 0 ? (
          <span
            className={cn(
              'absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none text-white',
              mentions > 0 ? 'bg-red-500' : 'bg-primary',
            )}
          >
            {total > 99 ? '99+' : total}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className={cn(
              'absolute top-full z-40 mt-2 w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-border bg-popover shadow-xl',
              align === 'right' ? 'right-0' : 'left-0',
            )}
          >
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-sm font-semibold">Notificaciones</span>
              {total > 0 ? (
                <span className="text-[11px] text-muted-foreground">{total} sin leer</span>
              ) : null}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {items.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Estas al dia. No hay mensajes sin leer.
                </div>
              ) : (
                items.map((it) => {
                  const author = nameOf(it.lastAuthor);
                  const parts = splitMentions(it.preview, members);
                  return (
                    <button
                      key={it.orderId}
                      type="button"
                      onClick={() => goto(it.orderId, it.warehouseId)}
                      className="flex w-full items-start gap-2.5 border-b border-border px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-muted/60"
                    >
                      {/* Avatar con iniciales de quien escribio (estilo Google Chat). */}
                      <span className="relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                        {initialsOf(author)}
                        {it.mentioned ? (
                          <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white ring-2 ring-popover">
                            <AtSign className="h-2.5 w-2.5" />
                          </span>
                        ) : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">{it.customerName}</span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {formatDistanceToNow(new Date(it.lastMessageAt), { locale: es, addSuffix: false })}
                          </span>
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          <span className="font-medium text-foreground/80">{author}: </span>
                          {parts.map((p, i) =>
                            p.kind === 'mention' ? (
                              <span
                                key={i}
                                className="rounded bg-primary/10 px-1 font-medium text-primary"
                              >
                                {p.value}
                              </span>
                            ) : (
                              <span key={i}>{p.value}</span>
                            ),
                          )}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-muted-foreground/70">
                          {it.externalId}
                          {it.unreadCount > 1 ? ` · ${it.unreadCount} sin leer` : ''}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
