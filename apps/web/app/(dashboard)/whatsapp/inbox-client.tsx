'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, isToday, isYesterday } from 'date-fns';
import { es } from 'date-fns/locale/es';
import { ArrowLeft, Loader2, MessageCircle, Plus, Search, Tag, X } from 'lucide-react';
import { toast } from 'sonner';
import type { WaInbox, WaInboxItem, WaMessage } from '@smartlogistica/shared';

import { useCurrentUser } from '@/components/providers/current-user-provider';
import { ApiError, api } from '@/lib/api-client';
import { cn, titleCaseName } from '@/lib/utils';

import { WhatsappPanel } from '../orders/whatsapp-panel';
import { useOrdersStream } from '../orders/use-orders-stream';

/* =====================================================================
 * BANDEJA de WhatsApp (estilo WhatsApp Web): lista de chats a la izquierda
 * (avatar generado, ultimo mensaje, hora y contador VERDES cuando hay no
 * leidos) + el chat calcado a la derecha. Ordenada en vivo por ultimo
 * mensaje; filtros Todos / No leidos / etiquetas; etiquetado por chat.
 * ===================================================================== */

/** Colores para el avatar generado (par degradado estable por telefono). */
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

export function WhatsappInbox() {
  const me = useCurrentUser();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | string>('all');
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;

  const isAdminUser = me?.role === 'OWNER' || me?.role === 'ADMIN';

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

  const openChat = (phone: string) => {
    setSelected(phone);
    clearUnread(phone);
  };

  // Tiempo real: el evento trae el MENSAJE -> actualizar la lista al instante
  // (subir el chat, vista previa, contador). Si el chat esta ABIERTO, se marca
  // leido de una. Sin mensaje (reacciones/estados/etiquetas) -> refetch.
  useOrdersStream(
    useCallback(
      (event) => {
        if (event?.kind !== 'wa.message') return;
        const phone = typeof event.phone === 'string' ? event.phone : null;
        if (!phone) return;
        const msg = (event as { message?: WaMessage }).message;
        if (!msg?.id) {
          void qc.invalidateQueries({ queryKey: ['wa-inbox'] });
          return;
        }
        const isOpen = selectedRef.current === phone;
        qc.setQueryData<WaInbox>(['wa-inbox'], (old) => {
          if (!old) return old;
          const existing = old.chats.find((c) => c.phone === phone);
          const updated: WaInboxItem = {
            phone,
            name: existing?.name ?? null,
            labels: existing?.labels ?? [],
            lastAt: msg.createdAt,
            lastKind: msg.kind,
            lastBody: msg.body,
            lastDirection: msg.direction,
            unread:
              msg.direction === 'in' && !isOpen ? (existing?.unread ?? 0) + 1 : (isOpen ? 0 : (existing?.unread ?? 0)),
          };
          const rest = old.chats.filter((c) => c.phone !== phone);
          return { ...old, chats: [updated, ...rest] };
        });
        if (isOpen && msg.direction === 'in') markRead.mutate(phone);
        if (!existingName(qc, phone)) void qc.invalidateQueries({ queryKey: ['wa-inbox'] });
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [qc],
    ),
  );

  const chats = inbox?.chats ?? [];
  const labels = inbox?.labels ?? [];
  const query = q.trim().toLowerCase();
  const digits = query.replace(/\D/g, '');
  const filtered = chats.filter((c) => {
    if (filter === 'unread' && c.unread === 0) return false;
    if (filter !== 'all' && filter !== 'unread' && !c.labels.includes(filter)) return false;
    if (!query) return true;
    return (
      (c.name ?? '').toLowerCase().includes(query) ||
      (digits.length >= 3 && c.phone.includes(digits)) ||
      (c.lastBody ?? '').toLowerCase().includes(query)
    );
  });

  const selectedChat = chats.find((c) => c.phone === selected) ?? null;

  if (!isAdminUser) {
    return (
      <p className="m-6 rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        WhatsApp es solo para administradores.
      </p>
    );
  }

  return (
    // Tarjeta a ALTURA COMPLETA de la vista (la pagina no scrollea: scrollean
    // la lista y el chat). El calc descuenta paddings del layout y barras del cel.
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
        {/* Buscador */}
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
        {/* Filtros: Todos / No leidos / etiquetas */}
        <div className="scrollbar-none flex gap-1.5 overflow-x-auto px-3 pb-2">
          {[
            { id: 'all', label: 'Todos' },
            { id: 'unread', label: 'No leídos' },
            ...labels.map((l) => ({ id: l, label: l })),
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1 text-[12.5px] transition-colors',
                filter === f.id
                  ? 'border-transparent bg-[#e7fce3] font-medium text-[#008069] dark:bg-[#0a332c] dark:text-[#00a884]'
                  : 'border-border text-[#54656f] hover:bg-muted dark:text-[#8696a0]',
              )}
            >
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
              <button
                key={c.phone}
                type="button"
                onClick={() => openChat(c.phone)}
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[#f5f6f6] dark:hover:bg-[#202c33]',
                  selected === c.phone && 'bg-[#f0f2f5] dark:bg-[#2a3942]',
                )}
              >
                <WaAvatar name={c.name} phone={c.phone} />
                <span className="min-w-0 flex-1 border-b border-border/60 py-1.5">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[15px] text-[#111b21] dark:text-[#e9edef]">
                      {displayName(c)}
                    </span>
                    <span
                      className={cn(
                        'shrink-0 text-[11.5px]',
                        c.unread > 0
                          ? 'font-medium text-[#00a884]'
                          : 'text-[#667781] dark:text-[#8696a0]',
                      )}
                    >
                      {listTime(c.lastAt)}
                    </span>
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] text-[#667781] dark:text-[#8696a0]">
                      {preview(c)}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {c.labels.slice(0, 2).map((l) => (
                        <span
                          key={l}
                          className="rounded-full bg-[#e7f7ef] px-1.5 py-px text-[10px] font-medium text-[#008069] dark:bg-[#0a332c] dark:text-[#00a884]"
                        >
                          {l}
                        </span>
                      ))}
                      {c.unread > 0 ? (
                        <span className="inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-[#25d366] px-1.5 text-[11px] font-semibold leading-none text-white">
                          {c.unread > 99 ? '99+' : c.unread}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </span>
              </button>
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
              allLabels={labels}
              onClose={() => setSelected(null)}
            />
            <div className="min-h-0 flex-1">
              <WhatsappPanel phone={selected} showHeader={false} active />
            </div>
          </>
        ) : (
          // Estado VACIO (como WhatsApp Web sin chat abierto).
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
    </div>
  );
}

/** ¿Ya conocemos el nombre del chat? (si no, un refetch lo trae del contacto). */
function existingName(qc: ReturnType<typeof useQueryClient>, phone: string): boolean {
  const inbox = qc.getQueryData<WaInbox>(['wa-inbox']);
  return Boolean(inbox?.chats.find((c) => c.phone === phone)?.name);
}

/** Cabecera del chat abierto: avatar + nombre + etiquetas + cerrar. */
function ChatHeader({
  chat,
  allLabels,
  onClose,
}: {
  chat: { phone: string; name: string | null; labels: string[] };
  allLabels: string[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const save = useMutation({
    mutationFn: (labels: string[]) =>
      api.put<{ ok: true }>(`/v1/whatsapp/chats/${chat.phone}/labels`, { labels }),
    onMutate: (labels) => {
      qc.setQueryData<WaInbox>(['wa-inbox'], (old) =>
        old
          ? {
              ...old,
              chats: old.chats.map((c) => (c.phone === chat.phone ? { ...c, labels } : c)),
              labels: [...new Set([...old.labels, ...labels])].sort((a, b) => a.localeCompare(b)),
            }
          : old,
      );
    },
    onError: (err) => {
      void qc.invalidateQueries({ queryKey: ['wa-inbox'] });
      toast.error(err instanceof ApiError ? err.message : 'No se pudieron guardar las etiquetas');
    },
  });

  const toggle = (label: string) => {
    const next = chat.labels.includes(label)
      ? chat.labels.filter((l) => l !== label)
      : [...chat.labels, label];
    save.mutate(next);
  };
  const addNew = () => {
    const l = newLabel.trim();
    if (!l) return;
    setNewLabel('');
    if (!chat.labels.includes(l)) save.mutate([...chat.labels, l]);
  };

  const options = useMemo(
    () => [...new Set([...allLabels, ...chat.labels])].sort((a, b) => a.localeCompare(b)),
    [allLabels, chat.labels],
  );

  return (
    <div className="flex items-center gap-3 border-b border-border bg-[#f0f2f5] px-3 py-2 dark:bg-[#202c33]">
      {/* Volver (cel) */}
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
        <p className="truncate text-[12px] text-[#667781] dark:text-[#8696a0]">+57 {chat.phone}</p>
      </div>
      {/* Etiquetas del chat */}
      <div className="hidden items-center gap-1 sm:flex">
        {chat.labels.map((l) => (
          <span
            key={l}
            className="rounded-full bg-[#e7f7ef] px-2 py-0.5 text-[11px] font-medium text-[#008069] dark:bg-[#0a332c] dark:text-[#00a884]"
          >
            {l}
          </span>
        ))}
      </div>
      <div className="relative" ref={boxRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-9 w-9 items-center justify-center rounded-full text-[#54656f] transition-colors hover:bg-black/5 dark:text-[#8696a0] dark:hover:bg-white/5"
          aria-label="Etiquetas"
          title="Etiquetar chat"
        >
          <Tag className="h-[18px] w-[18px]" />
        </button>
        {open ? (
          <div className="shadow-float absolute right-0 top-11 z-30 w-56 rounded-xl border border-border bg-card p-2">
            <p className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Etiquetas
            </p>
            {options.length === 0 ? (
              <p className="px-2 pb-1 text-[12px] text-muted-foreground">Crea la primera abajo.</p>
            ) : (
              <div className="max-h-44 overflow-y-auto">
                {options.map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => toggle(l)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-muted"
                  >
                    <span
                      className={cn(
                        'flex h-4 w-4 items-center justify-center rounded border',
                        chat.labels.includes(l)
                          ? 'border-[#00a884] bg-[#00a884] text-white'
                          : 'border-border',
                      )}
                    >
                      {chat.labels.includes(l) ? '✓' : ''}
                    </span>
                    <span className="truncate">{l}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="mt-1 flex items-center gap-1 border-t border-border pt-1.5">
              <input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addNew();
                  }
                }}
                placeholder="Nueva etiqueta"
                className="h-8 min-w-0 flex-1 rounded-lg bg-muted px-2 text-[12.5px] outline-none placeholder:text-muted-foreground"
              />
              <button
                type="button"
                onClick={addNew}
                disabled={!newLabel.trim()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#00a884] text-white disabled:opacity-40"
                aria-label="Agregar etiqueta"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : null}
      </div>
      {/* Cerrar chat */}
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
