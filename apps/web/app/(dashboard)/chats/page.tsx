'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns/format';
import { formatDistanceToNow } from 'date-fns/formatDistanceToNow';
import { isToday } from 'date-fns/isToday';
import { isYesterday } from 'date-fns/isYesterday';
import { es } from 'date-fns/locale/es';
import { AtSign, MessagesSquare } from 'lucide-react';
import type { ChatInboxItem, MemberSummary } from '@smartlogistica/shared';

import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import { initialsOf, splitMentions } from '../orders/mention-utils';
import { useChats } from '../use-chats';
import { orderTarget } from '../use-mentions';

type Filter = 'all' | 'unread' | 'mentions';

/** Separador de dia: "Hoy" / "Ayer" / la fecha en español. */
function dayLabel(date: Date): string {
  if (isToday(date)) return 'Hoy';
  if (isYesterday(date)) return 'Ayer';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return format(date, sameYear ? "EEEE d 'de' MMMM" : "d 'de' MMMM 'de' yyyy", { locale: es });
}

/**
 * Marca de tiempo de la fila. Lo de HOY se lee mejor en relativo ("hace 5
 * minutos"); de "Ayer" hacia atras el relativo pierde precision y se cambia por
 * la hora de reloj — que es lo que le da sentido al separador de dia.
 */
function whenLabel(date: Date): string {
  if (isToday(date)) return formatDistanceToNow(date, { locale: es, addSuffix: true });
  if (isYesterday(date)) return format(date, "'ayer a las' h:mm aaaa", { locale: es });
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return format(date, sameYear ? "d MMM 'a las' h:mm aaaa" : "d MMM yyyy 'a las' h:mm aaaa", {
    locale: es,
  });
}

/**
 * Pagina "Chats": la bandeja del chat interno de los pedidos.
 *
 * Aparece cada pedido en el que participaste — porque escribiste o porque te
 * mencionaron — con lo ULTIMO que se dijo, venga de quien venga, y los mas
 * recientes primero. Esa es la diferencia con Menciones: alli cada fila es un
 * mensaje que te nombra; aqui cada fila es una conversacion.
 *
 * Los filtros trabajan sobre la lista YA cargada: no hay consulta nueva, solo
 * se esconden filas.
 */
export default function ChatsPage() {
  const router = useRouter();
  const { items, loading } = useChats();
  const [filter, setFilter] = useState<Filter>('all');

  const { data: members = [] } = useQuery({
    queryKey: ['members'],
    queryFn: () => api.get<MemberSummary[]>('/v1/members'),
    staleTime: 5 * 60_000,
  });
  const nameOf = (raw: string): string => members.find((m) => m.email === raw)?.name ?? raw;

  const unreadCount = items.filter((c) => c.unreadCount > 0).length;
  const mentionCount = items.filter((c) => c.mentioned).length;
  const visible =
    filter === 'unread'
      ? items.filter((c) => c.unreadCount > 0)
      : filter === 'mentions'
        ? items.filter((c) => c.mentioned)
        : items;

  // Agrupacion por dia conservando el orden que llega del API (mas nuevos
  // primero): se corta un grupo cada vez que cambia la fecha.
  const groups = useMemo(() => {
    const out: Array<{ key: string; label: string; rows: ChatInboxItem[] }> = [];
    for (const it of visible) {
      const date = new Date(it.lastAt);
      const key = date.toDateString();
      const last = out[out.length - 1];
      if (last && last.key === key) last.rows.push(it);
      else out.push({ key, label: dayLabel(date), rows: [it] });
    }
    return out;
  }, [visible]);

  return (
    <div>
      <header className="mb-[18px] flex flex-wrap items-start gap-3.5 border-b border-border pb-4">
        <div className="min-w-0">
          <h1 className="text-[21px] font-extrabold tracking-[-0.025em]">Chats</h1>
          <p className="mt-0.5 max-w-[66ch] text-[13px] text-muted-foreground">
            Las conversaciones de pedidos en las que participas, con lo último que se dijo en cada
            una.
          </p>
        </div>
      </header>

      {loading && items.length === 0 ? (
        <ListSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<MessagesSquare className="h-5 w-5" />}
          title="Todavía no participas en ninguna conversación"
          hint="En cuanto escribas en el chat de un pedido — o alguien te mencione — la conversación aparece aquí."
        />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-[7px]">
            <FilterChip
              label="Todos"
              count={items.length}
              selected={filter === 'all'}
              onSelect={() => setFilter('all')}
            />
            <FilterChip
              label="Sin leer"
              count={unreadCount}
              selected={filter === 'unread'}
              onSelect={() => setFilter('unread')}
            />
            <FilterChip
              label="Te mencionan"
              count={mentionCount}
              selected={filter === 'mentions'}
              onSelect={() => setFilter('mentions')}
            />
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon={<MessagesSquare className="h-5 w-5" />}
              title={
                filter === 'unread' ? 'No tienes chats sin leer' : 'Nada sin leer que te nombre'
              }
              hint="Todo lo que llegó a tus conversaciones ya lo abriste."
            />
          ) : (
            <div className="rounded-[14px] border border-border bg-card p-[6px_8px]">
              {groups.map((group) => (
                <div key={group.key}>
                  <p className="px-0.5 pb-[7px] pt-3.5 text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-hint">
                    {group.label}
                  </p>
                  {group.rows.map((it) => (
                    <ChatRow
                      key={it.orderId}
                      chat={it}
                      members={members}
                      authorName={nameOf(it.lastAuthor)}
                      onOpen={() => router.push(orderTarget(it))}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ChatRow({
  chat,
  members,
  authorName,
  onOpen,
}: {
  chat: ChatInboxItem;
  members: MemberSummary[];
  authorName: string;
  onOpen: () => void;
}) {
  const unread = chat.unreadCount > 0;
  const parts = splitMentions(chat.lastBody, members);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex w-full gap-3 rounded-[12px] p-[12px_14px] text-left transition-colors [transition-duration:130ms] hover:bg-surface',
        unread && 'bg-gradient-to-r from-wash to-transparent to-70% hover:from-wash-strong',
      )}
    >
      <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-wash-strong text-[12px] font-extrabold text-accent-ink">
        {initialsOf(authorName)}
        {/* La mencion manda sobre el "sin leer" a secas: si me nombraron, eso
            es lo que hay que ver primero. */}
        {chat.mentioned ? (
          <span className="absolute -right-1 -top-1 grid h-[15px] w-[15px] place-items-center rounded-full bg-accent text-[9px] font-black text-accent-foreground ring-2 ring-card">
            <AtSign className="h-2.5 w-2.5" />
          </span>
        ) : unread ? (
          <span className="absolute -right-px -top-px h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-card" />
        ) : null}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-2">
          <span
            className={cn(
              'text-[10.5px] font-extrabold uppercase tracking-[0.06em]',
              unread ? 'text-accent-ink' : 'text-hint',
            )}
          >
            {chat.warehouseName ?? 'Pedidos generales'}
          </span>
          <span className="min-w-0 truncate text-[12.5px] text-muted-foreground">
            {chat.externalId} · {chat.customerName}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-2 whitespace-nowrap">
            {chat.unreadCount > 0 ? (
              <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-accent px-1.5 py-px text-[10px] font-extrabold tabular-nums leading-[1.4] text-accent-foreground">
                {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
              </span>
            ) : null}
            <span className="text-[11px] text-hint">{whenLabel(new Date(chat.lastAt))}</span>
          </span>
        </span>

        <span className="mt-[3px] block truncate text-[12.8px] text-muted-foreground">
          {/* "Tú:" en vez del propio nombre — en una bandeja uno se reconoce
              antes asi, y ademas distingue de un vistazo si quedaste esperando
              respuesta o si la pelota esta en tu tejado. */}
          <span className={cn('font-bold', chat.lastMine ? 'text-hint' : 'text-foreground')}>
            {chat.lastMine ? 'Tú' : authorName}:{' '}
          </span>
          {parts.map((p, i) =>
            p.kind === 'mention' ? (
              <span key={i} className="rounded-[5px] bg-wash px-1 font-bold text-accent-ink">
                {p.value}
              </span>
            ) : (
              <span key={i}>{p.value}</span>
            ),
          )}
        </span>
      </span>
    </button>
  );
}

function FilterChip({
  label,
  count,
  selected,
  onSelect,
}: {
  label: string;
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-[13px] py-[5px] text-[12.5px] font-bold transition-colors [transition-duration:130ms]',
        selected
          ? 'border-accent bg-accent text-accent-foreground shadow-[0_4px_12px_-4px_hsl(var(--ring))]'
          : 'border-input bg-card text-muted-foreground hover:border-accent hover:text-accent-ink',
      )}
    >
      {label}
      <span className="tabular-nums">{count}</span>
    </button>
  );
}

/** Mientras carga: la MISMA forma de la lista, para que nada salte al llegar. */
function ListSkeleton() {
  return (
    <div className="rounded-[14px] border border-border bg-card p-[6px_8px]">
      <div className="h-3 w-16 animate-pulse rounded bg-muted/60 px-0.5 my-3.5" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex gap-3 p-[12px_14px]">
          <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-56 max-w-full animate-pulse rounded bg-muted/70" />
            <div className="h-3 w-80 max-w-full animate-pulse rounded bg-muted/50" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed border-input bg-card py-16 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-full bg-wash text-accent">
        {icon}
      </span>
      <p className="text-[13.5px] font-bold">{title}</p>
      <p className="max-w-[52ch] px-6 text-[12px] text-muted-foreground">{hint}</p>
    </div>
  );
}
