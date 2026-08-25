'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, isToday, isYesterday } from 'date-fns';
import { es } from 'date-fns/locale/es';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Bell,
  BellOff,
  ChevronDown,
  Eraser,
  Loader2,
  Mail,
  MessageCircle,
  Pin,
  PinOff,
  Plus,
  Search,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { WaInbox, WaInboxItem, WaMessage, WaThread } from '@smartlogistica/shared';

import { useCurrentUser } from '@/components/providers/current-user-provider';
import { ApiError, api } from '@/lib/api-client';
import { canUseWhatsapp } from '@/lib/rbac';
import { cn, titleCaseName } from '@/lib/utils';

import { Ticks, WhatsappPanel } from '../orders/whatsapp-panel';
import { useOrdersStream } from '../orders/use-orders-stream';

/* =====================================================================
 * BANDEJA de WhatsApp (estilo WhatsApp Web): lista de chats con avatar
 * generado, no leidos VERDES, fijados/silenciados/archivados, etiquetas con
 * COLOR, menu contextual (click derecho EN EL PUNTO o flechita al hover) y
 * el chat calcado al lado.
 * ===================================================================== */

const AVATAR_HUES = [
  ['#00a884', '#02735c'],
  ['#53bdeb', '#2d7fb8'],
  ['#e17bb5', '#b0447f'],
  ['#ffbc38', '#d98f00'],
  ['#a791f5', '#6d4fd1'],
  ['#fa6533', '#c23a10'],
  ['#02a698', '#016158'],
  ['#7d8fe8', '#4a5cc4'],
] as const;

const LABEL_COLORS = ['#00a884', '#53bdeb', '#e17bb5', '#ffbc38', '#a791f5', '#fa6533', '#7d8fe8', '#8696a0'];

function avatarColors(seed: string): readonly [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const pair = AVATAR_HUES[Math.abs(h) % AVATAR_HUES.length] ?? AVATAR_HUES[0];
  return [pair[0], pair[1]];
}

function initialsOf(name: string | null, phone: string): string {
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
    return name.trim().slice(0, 2).toUpperCase();
  }
  return phone.slice(-2);
}

/** Avatar generado (sin foto: la Cloud API no expone la del contacto). */
function WaAvatar({ name, phone, size = 48 }: { name: string | null; phone: string; size?: number }) {
  const [c1, c2] = avatarColors(phone);
  return (
    <span
      className="flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(135deg, ${c1}, ${c2})`,
      }}
    >
      {initialsOf(name, phone)}
    </span>
  );
}

/** Hora de la lista, como WhatsApp: hoy -> hora, ayer -> "Ayer", resto fecha. */
function listTime(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return format(d, 'h:mm aaaa', { locale: es });
  if (isYesterday(d)) return 'Ayer';
  return format(d, 'd/MM/yyyy');
}

/** Vista previa del ultimo mensaje (icono por tipo, como WhatsApp). */
function preview(item: WaInboxItem): string {
  const body = (item.lastBody ?? '').replace(/\s+/g, ' ').trim();
  switch (item.lastKind) {
    case 'image':
      return body && !/\.(jpe?g|png|gif|webp)$/i.test(body) ? `📷 ${body}` : '📷 Foto';
    case 'video':
      return '🎬 Video';
    case 'audio':
      return '🎙️ Mensaje de voz';
    case 'sticker':
      return '🩵 Sticker';
    case 'file':
      return `📎 ${body || 'Documento'}`;
    default:
      return body;
  }
}

const displayName = (c: { name: string | null; phone: string }): string =>
  c.name?.trim() ? titleCaseName(c.name) : `+57 ${c.phone}`;

/** Pastilla del estado de envio: texto corto + color por estado canonico. */
function shippingChip(c: WaInboxItem): { text: string; cls: string } | null {
  if (!c.shippingState && !c.shippingStatus) return null;
  const raw = (c.shippingStatus ?? '').toLowerCase();
  const state = c.shippingState ?? '';
  const text =
    state === 'entregado'
      ? 'Entregado'
      : state === 'novedad'
        ? 'Novedad'
        : raw.includes('reparto')
          ? 'Reparto'
          : raw.includes('destino')
            ? 'T. destino'
            : raw.includes('origen')
              ? 'Origen'
              : state === 'sin_movimientos' || raw.includes('sin movimiento')
                ? 'Guía enviada'
                : 'En tránsito';
  const cls =
    state === 'entregado'
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
      : state === 'novedad'
        ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
        : state === 'en_transito'
          ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300'
          : 'bg-black/[0.07] text-[#54656f] dark:bg-white/10 dark:text-[#8696a0]';
  return { text, cls };
}

/** Ancla del menu contextual de chat (en el PUNTO del click / la flechita). */
interface ChatMenuAnchor {
  phone: string;
  x: number;
  y: number;
  up: boolean;
}

export function WhatsappInbox() {
  const me = useCurrentUser();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'archived' | string>('all');
  const [menu, setMenu] = useState<ChatMenuAnchor | null>(null);
  const [labelFor, setLabelFor] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;

  // WhatsApp es de administradores (el API lo exige): ni gestores ni operadores.
  const isAdminUser = canUseWhatsapp(me?.role);

  const { data: inbox, isLoading } = useQuery({
    queryKey: ['wa-inbox'],
    queryFn: () => api.get<WaInbox>('/v1/whatsapp/inbox'),
    refetchInterval: 30_000,
    enabled: isAdminUser,
  });

  // Marcar LEIDO (apaga el contador verde de este usuario).
  const markRead = useMutation({
    mutationFn: (phone: string) => api.post<{ ok: true }>(`/v1/whatsapp/chats/${phone}/read`, {}),
  });
  const clearUnread = useCallback(
    (phone: string) => {
      qc.setQueryData<WaInbox>(['wa-inbox'], (old) =>
        old
          ? { ...old, chats: old.chats.map((c) => (c.phone === phone ? { ...c, unread: 0 } : c)) }
          : old,
      );
      markRead.mutate(phone);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc],
  );

  // PRE-CARGA de hilos (cero pantalla de carga al abrir).
  const prefetchedRef = useRef(new Set<string>());
  const prefetchThread = useCallback(
    (phone: string) => {
      if (prefetchedRef.current.has(phone)) return;
      prefetchedRef.current.add(phone);
      void qc.prefetchQuery({
        queryKey: ['wa-thread', `/v1/whatsapp/chats/${phone}`],
        queryFn: () => api.get<WaThread>(`/v1/whatsapp/chats/${phone}`),
        staleTime: 15_000,
      });
    },
    [qc],
  );
  const topChats = inbox?.chats;
  useEffect(() => {
    (topChats ?? []).slice(0, 15).forEach((c) => prefetchThread(c.phone));
  }, [topChats, prefetchThread]);

  const openChat = (phone: string) => {
    setSelected(phone);
    clearUnread(phone);
  };
  const openChatRef = useRef(openChat);
  openChatRef.current = openChat;

  // Abrir chat por ?chat=NUMERO (enlace desde un pedido) o por el evento
  // wa-open-chat (numero clicado dentro de un mensaje de la bandeja).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('chat');
    if (p) {
      const ten = p.replace(/\D/g, '').slice(-10);
      if (ten.length === 10) openChatRef.current(ten);
    }
    const onOpen = (e: Event) => {
      const ten = String((e as CustomEvent).detail ?? '');
      if (ten.length >= 7) openChatRef.current(ten);
    };
    window.addEventListener('wa-open-chat', onOpen);
    return () => window.removeEventListener('wa-open-chat', onOpen);
  }, []);

  // ESC cierra el chat abierto (como WhatsApp Web).
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  // "Escribiendo..." por chat (de OTROS admins), con auto-expiracion.
  const [typing, setTyping] = useState<Record<string, string>>({});
  const typingTimersRef = useRef<Record<string, number>>({});
  const noteTyping = useCallback((phone: string, name: string) => {
    setTyping((t) => ({ ...t, [phone]: name }));
    const timers = typingTimersRef.current;
    if (timers[phone]) window.clearTimeout(timers[phone]);
    timers[phone] = window.setTimeout(() => {
      setTyping((t) => {
        if (!(phone in t)) return t;
        const next = { ...t };
        delete next[phone];
        return next;
      });
    }, 3500);
  }, []);
  const clearTyping = useCallback((phone: string) => {
    setTyping((t) => {
      if (!(phone in t)) return t;
      const next = { ...t };
      delete next[phone];
      return next;
    });
  }, []);

  // Tiempo real: el evento trae el MENSAJE -> lista al instante.
  useOrdersStream(
    useCallback(
      (event) => {
        if (event?.kind === 'wa.typing') {
          const phone = typeof event.phone === 'string' ? event.phone : null;
          if (!phone) return;
          if (me?.id && (event as { userId?: string }).userId === me.id) return;
          noteTyping(phone, String((event as { name?: string }).name ?? ''));
          return;
        }
        if (event?.kind !== 'wa.message') return;
        const phone = typeof event.phone === 'string' ? event.phone : null;
        if (!phone) return;
        const msg = (event as { message?: WaMessage }).message;
        if (!msg?.id) {
          void qc.invalidateQueries({ queryKey: ['wa-inbox'] });
          return;
        }
        clearTyping(phone);
        const isOpen = selectedRef.current === phone;
        qc.setQueryData<WaInbox>(['wa-inbox'], (old) => {
          if (!old) return old;
          const existing = old.chats.find((c) => c.phone === phone);
          // Un UPDATE de un mensaje VIEJO (chulito en cascada, reaccion,
          // editado) NO es "el ultimo mensaje": no reescribe la fila.
          if (existing && msg.createdAt < existing.lastAt) return old;
          // ¿Es actualizacion del MISMO mensaje que ya se muestra? -> no
          // volver a contar el no-leido.
          const isUpdateOfShown =
            existing && msg.createdAt === existing.lastAt && msg.direction === existing.lastDirection;
          const updated: WaInboxItem = {
            phone,
            name: existing?.name ?? null,
            labels: existing?.labels ?? [],
            lastAt: msg.createdAt,
            lastKind: msg.kind,
            lastBody: msg.body,
            lastDirection: msg.direction,
            lastStatus: msg.direction === 'out' ? msg.status : null,
            // Regla: ultimo mensaje NUESTRO -> respondido -> 0.
            unread:
              msg.direction === 'out'
                ? 0
                : isOpen
                  ? 0
                  : isUpdateOfShown
                    ? (existing?.unread ?? 0)
                    : (existing?.unread ?? 0) + 1,
            shippingState: existing?.shippingState ?? null,
            shippingStatus: existing?.shippingStatus ?? null,
            archived: existing?.archived ?? false,
            muted: existing?.muted ?? false,
            pinned: existing?.pinned ?? false,
          };
          const rest = old.chats.filter((c) => c.phone !== phone);
          const next = [updated, ...rest].sort((a, b) => Number(b.pinned) - Number(a.pinned));
          return { ...old, chats: next };
        });
        if (isOpen && msg.direction === 'in') markRead.mutate(phone);
        if (!existingName(qc, phone)) void qc.invalidateQueries({ queryKey: ['wa-inbox'] });
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [qc, me?.id, noteTyping, clearTyping],
    ),
  );

  // ===== Operaciones del menu contextual =====
  const patchChat = useCallback(
    (phone: string, patch: Partial<WaInboxItem>) => {
      qc.setQueryData<WaInbox>(['wa-inbox'], (old) =>
        old
          ? {
              ...old,
              chats: old.chats
                .map((c) => (c.phone === phone ? { ...c, ...patch } : c))
                .sort((a, b) => Number(b.pinned) - Number(a.pinned)),
            }
          : old,
      );
    },
    [qc],
  );
  const chatOp = useMutation({
    mutationFn: (vars: { phone: string; patch: { archived?: boolean; muted?: boolean; pinned?: boolean } }) =>
      api.post<{ ok: true }>(`/v1/whatsapp/chats/${vars.phone}/op`, vars.patch),
    onMutate: (vars) => patchChat(vars.phone, vars.patch),
    onError: (err) => {
      void qc.invalidateQueries({ queryKey: ['wa-inbox'] });
      toast.error(err instanceof ApiError ? err.message : 'No se pudo aplicar el cambio');
    },
  });
  const markUnread = useMutation({
    mutationFn: (phone: string) => api.post<{ ok: true }>(`/v1/whatsapp/chats/${phone}/unread`, {}),
    onMutate: (phone) => patchChat(phone, { unread: 1 }),
    onError: (err) => {
      void qc.invalidateQueries({ queryKey: ['wa-inbox'] });
      toast.error(err instanceof ApiError ? err.message : 'No se pudo marcar como no leído');
    },
  });
  const clearChat = useMutation({
    mutationFn: (phone: string) => api.delete<{ ok: true }>(`/v1/whatsapp/chats/${phone}/messages`),
    onSuccess: (_r, phone) => {
      void qc.invalidateQueries({ queryKey: ['wa-inbox'] });
      void qc.invalidateQueries({ queryKey: ['wa-thread', `/v1/whatsapp/chats/${phone}`] });
      toast.success('Chat vaciado');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'No se pudo vaciar'),
  });
  const deleteChat = useMutation({
    mutationFn: (phone: string) => api.delete<{ ok: true }>(`/v1/whatsapp/chats/${phone}`),
    onSuccess: (_r, phone) => {
      if (selectedRef.current === phone) setSelected(null);
      void qc.invalidateQueries({ queryKey: ['wa-inbox'] });
      toast.success('Chat eliminado');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'No se pudo eliminar'),
  });

  const openMenuAt = (phone: string, x: number, y: number) => {
    const MENU_H = 330;
    const below = window.innerHeight - y;
    setMenu({ phone, x, y, up: below < MENU_H && y > below });
  };

  const chats = inbox?.chats ?? [];
  const labels = inbox?.labels ?? [];
  const labelColor = useMemo(() => new Map(labels.map((l) => [l.name, l.color] as const)), [labels]);
  // CHATS con no leidos (sin silenciados ni archivados) — el numerito del chip.
  const unreadChats = chats.filter((c) => c.unread > 0 && !c.muted && !c.archived).length;

  const query = q.trim().toLowerCase();
  const digits = query.replace(/\D/g, '');
  const filtered = chats.filter((c) => {
    if (filter === 'archived') {
      if (!c.archived) return false;
    } else {
      if (c.archived) return false;
      if (filter === 'unread' && c.unread === 0) return false;
      if (filter !== 'all' && filter !== 'unread' && !c.labels.includes(filter)) return false;
    }
    if (!query) return true;
    return (
      (c.name ?? '').toLowerCase().includes(query) ||
      (digits.length >= 3 && c.phone.includes(digits)) ||
      (c.lastBody ?? '').toLowerCase().includes(query)
    );
  });

  const selectedChat = chats.find((c) => c.phone === selected) ?? null;
  const menuChat = menu ? (chats.find((c) => c.phone === menu.phone) ?? null) : null;

  if (!isAdminUser) {
    return (
      <p className="m-6 rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        WhatsApp es solo para administradores.
      </p>
    );
  }

  return (
    // Tarjeta a ALTURA COMPLETA de la vista (la pagina no scrollea: scrollean
    // la lista y el chat).
    <div className="shadow-card flex h-[calc(100dvh-176px)] min-h-[420px] overflow-hidden rounded-xl border border-border bg-card md:h-[calc(100vh-64px)]">
      {/* ===== Lista de chats ===== */}
      <div
        className={cn(
          'flex w-full shrink-0 flex-col border-r border-border md:w-[380px]',
          selected && 'hidden md:flex',
        )}
      >
        <div className="px-4 pb-2 pt-4">
          <h1 className="text-[19px] font-bold text-[#111b21] dark:text-[#e9edef]">Chats</h1>
        </div>
        <div className="px-3 pb-2">
          <div className="flex h-9 items-center gap-2 rounded-lg bg-[#f0f2f5] px-3 dark:bg-[#202c33]">
            <Search className="h-4 w-4 shrink-0 text-[#54656f] dark:text-[#8696a0]" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar un chat"
              className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-[#667781] dark:placeholder:text-[#8696a0]"
            />
            {q ? (
              <button type="button" onClick={() => setQ('')} aria-label="Limpiar">
                <X className="h-3.5 w-3.5 text-[#54656f] dark:text-[#8696a0]" />
              </button>
            ) : null}
          </div>
        </div>
        {/* Filtros: Todos / No leidos / etiquetas / Archivados */}
        <div className="scrollbar-none flex gap-1.5 overflow-x-auto px-3 pb-2">
          {[
            { id: 'all', label: 'Todos', color: null as string | null },
            { id: 'unread', label: unreadChats > 0 ? `No leídos ${unreadChats}` : 'No leídos', color: null },
            ...labels.map((l) => ({ id: l.name, label: l.name, color: l.color })),
            { id: 'archived', label: 'Archivados', color: null },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                'flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-[12.5px] transition-colors',
                filter === f.id
                  ? 'border-transparent bg-[#e7fce3] font-medium text-[#008069] dark:bg-[#0a332c] dark:text-[#00a884]'
                  : 'border-border text-[#54656f] hover:bg-muted dark:text-[#8696a0]',
              )}
            >
              {f.color ? <span className="h-2 w-2 rounded-full" style={{ backgroundColor: f.color }} /> : null}
              {f.label}
            </button>
          ))}
        </div>
        {/* Chats */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              {chats.length === 0
                ? 'Aún no hay chats: aquí aparecerá todo lo que entre o salga por el número.'
                : 'Ningún chat coincide.'}
            </p>
          ) : (
            filtered.map((c) => (
              <div
                key={c.phone}
                role="button"
                tabIndex={0}
                onClick={() => openChat(c.phone)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') openChat(c.phone);
                }}
                onMouseEnter={() => prefetchThread(c.phone)}
                onContextMenu={(e) => {
                  // Click DERECHO: el menu arranca JUSTO donde diste click.
                  e.preventDefault();
                  openMenuAt(c.phone, e.clientX, e.clientY);
                }}
                className={cn(
                  'group flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[#f5f6f6] dark:hover:bg-[#202c33]',
                  selected === c.phone && 'bg-[#f0f2f5] dark:bg-[#2a3942]',
                )}
              >
                <WaAvatar name={c.name} phone={c.phone} />
                <span className="min-w-0 flex-1 border-b border-border/60 py-1.5">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[15px] text-[#111b21] dark:text-[#e9edef]">
                      {displayName(c)}
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      {(() => {
                        /* Pastilla del ESTADO DE ENVIO (arriba de la hora). */
                        const s = shippingChip(c);
                        return s ? (
                          <span
                            className={cn(
                              'rounded-full px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide',
                              s.cls,
                            )}
                          >
                            {s.text}
                          </span>
                        ) : null;
                      })()}
                      <span
                        className={cn(
                          'text-[11.5px]',
                          c.unread > 0 && !c.muted
                            ? 'font-medium text-[#00a884]'
                            : 'text-[#667781] dark:text-[#8696a0]',
                        )}
                      >
                        {listTime(c.lastAt)}
                      </span>
                    </span>
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1 text-[13px] text-[#667781] dark:text-[#8696a0]">
                      {typing[c.phone] ? (
                        /* Otro admin teclea en este chat (verde, como WhatsApp). */
                        <span className="truncate font-medium italic text-[#00a884]">escribiendo…</span>
                      ) : (
                        <>
                          {c.lastDirection === 'out' && c.lastStatus ? (
                            <Ticks status={c.lastStatus} pending={false} />
                          ) : null}
                          <span className="truncate">{preview(c)}</span>
                        </>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {c.labels.slice(0, 2).map((l) => (
                        <span
                          key={l}
                          className="rounded-full px-1.5 py-px text-[10px] font-medium text-white"
                          style={{ backgroundColor: labelColor.get(l) ?? '#00a884' }}
                        >
                          {l}
                        </span>
                      ))}
                      {c.muted ? <BellOff className="h-3.5 w-3.5 text-[#8696a0]" /> : null}
                      {c.pinned ? <Pin className="h-3.5 w-3.5 fill-current text-[#8696a0]" /> : null}
                      {c.unread > 0 ? (
                        <span
                          className={cn(
                            'inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold leading-none text-white',
                            c.muted ? 'bg-[#8696a0]' : 'bg-[#25d366]',
                          )}
                        >
                          {c.unread > 99 ? '99+' : c.unread}
                        </span>
                      ) : null}
                      {/* Flechita del menu (hover), como WhatsApp */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          openMenuAt(c.phone, r.right - 8, r.bottom + 2);
                        }}
                        className="hidden h-5 w-5 items-center justify-center rounded-full text-[#8696a0] hover:text-[#54656f] group-hover:flex"
                        aria-label="Opciones del chat"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    </span>
                  </span>
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ===== Chat abierto / estado vacio ===== */}
      <div className={cn('min-w-0 flex-1 flex-col', selected ? 'flex' : 'hidden md:flex')}>
        {selected ? (
          <>
            <ChatHeader
              chat={selectedChat ?? { phone: selected, name: null, labels: [] }}
              labelColor={labelColor}
              typingName={typing[selected] ?? null}
              onLabels={() => setLabelFor(selected)}
              onClose={() => setSelected(null)}
            />
            <div className="min-h-0 flex-1">
              <WhatsappPanel key={selected} phone={selected} showHeader={false} active />
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 bg-[#f8f9fa] text-center dark:bg-[#222e35]">
            <span className="flex h-24 w-24 items-center justify-center rounded-full bg-[#eceff1] dark:bg-[#2a3942]">
              <MessageCircle className="h-11 w-11 text-[#8696a0]" strokeWidth={1.2} />
            </span>
            <div>
              <p className="text-[19px] font-light text-[#41525d] dark:text-[#e9edef]">
                WhatsApp de Smart Gadgets
              </p>
              <p className="mx-auto mt-1 max-w-sm text-[13px] text-[#667781] dark:text-[#8696a0]">
                Elige un chat de la izquierda para ver la conversación completa, responder, mandar
                archivos o plantillas con {'"/"'}.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ===== Menu contextual del chat (en el punto del click) ===== */}
      {menu && menuChat ? (
        <ChatContextMenu
          anchor={menu}
          chat={menuChat}
          onClose={() => setMenu(null)}
          onOp={(patch) => chatOp.mutate({ phone: menu.phone, patch })}
          onUnread={() => markUnread.mutate(menu.phone)}
          onLabels={() => setLabelFor(menu.phone)}
          onClear={() => {
            if (confirm('¿Vaciar este chat? Se borra el historial de la plataforma (el WhatsApp del cliente no se toca).')) {
              clearChat.mutate(menu.phone);
            }
          }}
          onDelete={() => {
            if (confirm('¿Eliminar este chat de la plataforma? Historial y etiquetas se borran (el WhatsApp del cliente no se toca).')) {
              deleteChat.mutate(menu.phone);
            }
          }}
        />
      ) : null}

      {/* ===== Modal de etiquetas (con color) ===== */}
      {labelFor ? (
        <LabelModal
          phone={labelFor}
          current={chats.find((c) => c.phone === labelFor)?.labels ?? []}
          registry={labels}
          onClose={() => setLabelFor(null)}
        />
      ) : null}
    </div>
  );
}

/** ¿Ya conocemos el nombre del chat? (si no, un refetch lo trae del contacto). */
function existingName(qc: ReturnType<typeof useQueryClient>, phone: string): boolean {
  const inbox = qc.getQueryData<WaInbox>(['wa-inbox']);
  return Boolean(inbox?.chats.find((c) => c.phone === phone)?.name);
}

/** Menu contextual del chat: arranca en el punto exacto; arriba si no hay espacio. */
function ChatContextMenu({
  anchor,
  chat,
  onClose,
  onOp,
  onUnread,
  onLabels,
  onClear,
  onDelete,
}: {
  anchor: ChatMenuAnchor;
  chat: WaInboxItem;
  onClose: () => void;
  onOp: (patch: { archived?: boolean; muted?: boolean; pinned?: boolean }) => void;
  onUnread: () => void;
  onLabels: () => void;
  onClear: () => void;
  onDelete: () => void;
}) {
  const MENU_W = 232;
  const left = Math.min(anchor.x, Math.max(8, window.innerWidth - MENU_W - 8));
  const item = (
    Icon: typeof Archive,
    label: string,
    onClick: () => void,
    danger = false,
  ): React.ReactNode => (
    <button
      key={label}
      type="button"
      onClick={() => {
        onClick();
        onClose();
      }}
      className={cn(
        'flex w-full items-center gap-3 px-4 py-2 text-left text-[14px] transition-colors hover:bg-[#f5f6f6] dark:hover:bg-white/5',
        danger ? 'text-[#f15c6d]' : 'text-[#111b21] dark:text-[#e9edef]',
      )}
    >
      <Icon className="h-[17px] w-[17px]" />
      {label}
    </button>
  );
  return (
    <>
      <button type="button" className="fixed inset-0 z-40 cursor-default" onClick={onClose} aria-label="Cerrar" />
      <div
        className="wa-pop fixed z-50 w-[232px] rounded-xl border border-border bg-white py-1.5 shadow-float dark:bg-[#233138]"
        style={{
          left,
          ...(anchor.up ? { bottom: window.innerHeight - anchor.y } : { top: anchor.y }),
          transformOrigin: `${anchor.up ? 'bottom' : 'top'} left`,
        }}
      >
        {item(chat.archived ? ArchiveRestore : Archive, chat.archived ? 'Desarchivar chat' : 'Archivar chat', () =>
          onOp({ archived: !chat.archived }),
        )}
        {item(chat.muted ? Bell : BellOff, chat.muted ? 'Activar notificaciones' : 'Silenciar notificaciones', () =>
          onOp({ muted: !chat.muted }),
        )}
        {item(chat.pinned ? PinOff : Pin, chat.pinned ? 'Desfijar chat' : 'Fijar chat', () =>
          onOp({ pinned: !chat.pinned }),
        )}
        {item(Mail, 'Marcar como no leído', onUnread)}
        {item(Tag, 'Etiquetas', onLabels)}
        <div className="my-1 border-t border-border" />
        {item(Eraser, 'Vaciar chat', onClear, true)}
        {item(Trash2, 'Eliminar chat', onDelete, true)}
      </div>
    </>
  );
}

/** Modal "Etiquetar" (como WhatsApp Business): checkboxes + color + nueva. */
function LabelModal({
  phone,
  current,
  registry,
  onClose,
}: {
  phone: string;
  current: string[];
  registry: Array<{ name: string; color: string }>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [checked, setChecked] = useState<Set<string>>(new Set(current));
  const [extra, setExtra] = useState<Array<{ name: string; color: string }>>([]);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(LABEL_COLORS[0] ?? '#00a884');

  const all = useMemo(() => {
    const seen = new Set(registry.map((l) => l.name));
    return [...registry, ...extra.filter((l) => !seen.has(l.name))];
  }, [registry, extra]);

  const toggle = (name: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };
  const addNew = () => {
    const name = newName.trim();
    if (!name) return;
    setExtra((prev) => (prev.some((l) => l.name === name) ? prev : [...prev, { name, color: newColor }]));
    setChecked((prev) => new Set(prev).add(name));
    setNewName('');
  };

  const save = useMutation({
    mutationFn: () => {
      const colorOf = new Map(all.map((l) => [l.name, l.color] as const));
      const labels = [...checked].map((name) => ({ name, color: colorOf.get(name) ?? '#00a884' }));
      return api.put<{ ok: true }>(`/v1/whatsapp/chats/${phone}/labels`, { labels });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wa-inbox'] });
      onClose();
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudieron guardar las etiquetas'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white dark:bg-[#111b21]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 bg-[#00a884] px-4 py-3 text-white">
          <button type="button" onClick={onClose} aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
          <p className="text-[15px] font-semibold">Etiquetar chat</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {all.length === 0 ? (
            <p className="px-4 py-6 text-center text-[12.5px] text-[#667781]">
              Crea la primera etiqueta abajo.
            </p>
          ) : (
            all.map((l) => (
              <button
                key={l.name}
                type="button"
                onClick={() => toggle(l.name)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[#f5f6f6] dark:hover:bg-white/5"
              >
                <Tag className="h-[18px] w-[18px]" style={{ color: l.color }} />
                <span className="min-w-0 flex-1 truncate text-[14px] text-[#111b21] dark:text-[#e9edef]">
                  {l.name}
                </span>
                <span
                  className={cn(
                    'flex h-[18px] w-[18px] items-center justify-center rounded border text-[11px] text-white',
                    checked.has(l.name) ? 'border-[#00a884] bg-[#00a884]' : 'border-[#8696a0]',
                  )}
                >
                  {checked.has(l.name) ? '✓' : ''}
                </span>
              </button>
            ))
          )}
        </div>
        {/* Nueva etiqueta + COLOR */}
        <div className="border-t border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-[#00a884]" />
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addNew();
                }
              }}
              placeholder="Nueva etiqueta"
              className="h-8 min-w-0 flex-1 rounded-lg bg-[#f0f2f5] px-2.5 text-[13px] outline-none placeholder:text-[#667781] dark:bg-[#202c33] dark:text-[#e9edef]"
            />
            <button
              type="button"
              onClick={addNew}
              disabled={!newName.trim()}
              className="rounded-full bg-[#00a884] px-3 py-1 text-[12px] font-medium text-white disabled:opacity-40"
            >
              Crear
            </button>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            {LABEL_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setNewColor(c)}
                className={cn(
                  'h-5 w-5 rounded-full transition-transform',
                  newColor === c && 'scale-125 ring-2 ring-offset-1 ring-[#00a884]',
                )}
                style={{ backgroundColor: c }}
                aria-label={`Color ${c}`}
              />
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-4 border-t border-border px-4 py-3">
          <button type="button" onClick={onClose} className="text-[13px] font-medium uppercase text-[#54656f]">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="rounded-md bg-[#00a884] px-4 py-1.5 text-[13px] font-medium uppercase text-white disabled:opacity-60"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

/** Cabecera del chat abierto: avatar + nombre + etiquetas (color) + cerrar. */
function ChatHeader({
  chat,
  labelColor,
  typingName,
  onLabels,
  onClose,
}: {
  chat: { phone: string; name: string | null; labels: string[] };
  labelColor: Map<string, string>;
  /** Nombre del ADMIN que esta tecleando en este chat (null = nadie). */
  typingName?: string | null;
  onLabels: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border bg-[#f0f2f5] px-3 py-2 dark:bg-[#202c33]">
      <button
        type="button"
        onClick={onClose}
        className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#54656f] hover:bg-black/5 dark:text-[#8696a0] dark:hover:bg-white/5 md:hidden"
        aria-label="Volver a los chats"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>
      <WaAvatar name={chat.name} phone={chat.phone} size={40} />
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-[15px] font-medium text-[#111b21] dark:text-[#e9edef]">
          {displayName(chat)}
        </p>
        {typingName ? (
          <p className="truncate text-[12px] font-medium italic text-[#00a884]">
            {typingName} está escribiendo…
          </p>
        ) : (
          <p className="truncate text-[12px] text-[#667781] dark:text-[#8696a0]">+57 {chat.phone}</p>
        )}
      </div>
      <div className="hidden items-center gap-1 sm:flex">
        {chat.labels.map((l) => (
          <span
            key={l}
            className="rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
            style={{ backgroundColor: labelColor.get(l) ?? '#00a884' }}
          >
            {l}
          </span>
        ))}
      </div>
      <button
        type="button"
        onClick={onLabels}
        className="flex h-9 w-9 items-center justify-center rounded-full text-[#54656f] transition-colors hover:bg-black/5 dark:text-[#8696a0] dark:hover:bg-white/5"
        aria-label="Etiquetas"
        title="Etiquetar chat"
      >
        <Tag className="h-[18px] w-[18px]" />
      </button>
      <button
        type="button"
        onClick={onClose}
        className="hidden h-9 w-9 items-center justify-center rounded-full text-[#54656f] transition-colors hover:bg-black/5 dark:text-[#8696a0] dark:hover:bg-white/5 md:flex"
        aria-label="Cerrar chat"
        title="Cerrar chat"
      >
        <X className="h-[18px] w-[18px]" />
      </button>
    </div>
  );
}
