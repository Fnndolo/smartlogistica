'use client';

import { Suspense, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AtSign, Loader2, MessagesSquare } from 'lucide-react';
import { toast } from 'sonner';
import type { ChatInboxItem, MemberSummary, OrderSummary } from '@smartlogistica/shared';

import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import { initialsOf, splitMentions } from '../orders/mention-utils';
import { OrderDrawer } from '../orders/order-drawer';
import { useChats } from '../use-chats';
import { useMentions } from '../use-mentions';
import {
  DayHeading,
  EmptyState,
  FilterChip,
  ListCard,
  ListSkeleton,
  groupByDay,
  whenLabel,
} from './chats-ui';
import { MentionsList } from './mentions-list';

type Tab = 'chats' | 'menciones';
type Filter = 'all' | 'unread';

export default function ChatsPage() {
  // useSearchParams exige un limite de Suspense para poder prerenderizar.
  return (
    <Suspense fallback={<ListSkeleton />}>
      <ChatsScreen />
    </Suspense>
  );
}

/**
 * Pantalla "Chats": el chat interno de los pedidos, en dos pestañas.
 *
 *  - BANDEJA: una fila por CONVERSACION en la que participas — porque
 *    escribiste o porque te mencionaron — con lo ultimo que se dijo.
 *  - MENCIONES: una fila por MENSAJE que te nombra, con su texto, y al abrirla
 *    salta a ese mensaje exacto dentro del hilo.
 *
 * Menciones tenia su propia seccion en el menu. Se mudo aqui porque es lo mismo
 * mirado de otra forma, y separadas obligaban a decidir en cual entrar antes de
 * saber que habia en cada una.
 *
 * La pestaña viaja en la URL (?tab=menciones): asi se puede enlazar, sobrevive
 * a recargar y el boton atras del navegador hace lo esperable.
 */
function ChatsScreen() {
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab: Tab = searchParams.get('tab') === 'menciones' ? 'menciones' : 'chats';

  const { items, loading } = useChats();
  const { unread: mentionsUnread } = useMentions();
  const [filter, setFilter] = useState<Filter>('all');

  // El pedido abierto, el mensaje al que saltar y que fila se esta trayendo.
  const [openOrder, setOpenOrder] = useState<OrderSummary | null>(null);
  const [openMsg, setOpenMsg] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const { data: members = [] } = useQuery({
    queryKey: ['members'],
    queryFn: () => api.get<MemberSummary[]>('/v1/members'),
    staleTime: 5 * 60_000,
  });
  const nameOf = (raw: string): string => members.find((m) => m.email === raw)?.name ?? raw;

  const goTab = (next: Tab): void => {
    router.replace(next === 'chats' ? pathname : `${pathname}?tab=menciones`, { scroll: false });
  };

  /**
   * Abre la conversacion SIN moverse de aqui.
   *
   * Antes esto navegaba al sitio donde vive el pedido (Generales o su sede), y
   * era un viaje de ida sin vuelta: cerrar el chat te dejaba en otra pantalla.
   * En el celular el propio drawer maneja el boton atras, asi que volver te
   * devuelve aqui.
   *
   * `rowKey` solo sirve para saber QUE fila marcar mientras se trae: la bandeja
   * se identifica por pedido y las menciones por mensaje.
   */
  const openChat = async (orderId: string, rowKey: string, messageId?: string): Promise<void> => {
    setOpening(rowKey);
    try {
      const detail = await api.get<OrderSummary>(`/v1/orders/${orderId}`);
      setOpenMsg(messageId ?? null);
      setOpenOrder(detail);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'No se pudo abrir la conversación de ese pedido',
      );
    } finally {
      setOpening(null);
    }
  };

  const closeChat = (): void => {
    setOpenOrder(null);
    setOpenMsg(null);
    // Abrir un chat lo marca como leido: sin esto la fila seguiria resaltada y
    // los contadores seguirian contandola hasta el siguiente evento.
    qc.invalidateQueries({ queryKey: ['chats-inbox'] });
    qc.invalidateQueries({ queryKey: ['mentions'] });
  };

  const unreadCount = items.filter((c) => c.unreadCount > 0).length;
  const visible = filter === 'unread' ? items.filter((c) => c.unreadCount > 0) : items;
  const groups = groupByDay(visible, (c) => c.lastAt);

  return (
    <div>
      <header className="mb-4 border-b border-border pb-4">
        <h1 className="text-[21px] font-extrabold tracking-[-0.025em]">Chats</h1>
        <p className="mt-0.5 max-w-[66ch] text-[13px] text-muted-foreground">
          {tab === 'chats'
            ? 'Las conversaciones de pedidos en las que participas, con lo último que se dijo en cada una.'
            : 'Cada vez que alguien te menciona con @ en la conversación de un pedido, aparece aquí.'}
        </p>
      </header>

      <div role="tablist" aria-label="Vistas del chat" className="mb-3.5 flex gap-1 border-b border-border">
        <TabButton
          label="Bandeja"
          icon={<MessagesSquare className="h-[15px] w-[15px]" />}
          count={unreadCount}
          selected={tab === 'chats'}
          onSelect={() => goTab('chats')}
        />
        <TabButton
          label="Menciones"
          icon={<AtSign className="h-[15px] w-[15px]" />}
          count={mentionsUnread}
          selected={tab === 'menciones'}
          onSelect={() => goTab('menciones')}
        />
      </div>

      {tab === 'menciones' ? (
        <MentionsList
          members={members}
          opening={opening}
          onOpen={(orderId, messageId) => void openChat(orderId, messageId, messageId)}
        />
      ) : loading && items.length === 0 ? (
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
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon={<MessagesSquare className="h-5 w-5" />}
              title="No tienes chats sin leer"
              hint="Todo lo que llegó a tus conversaciones ya lo abriste."
            />
          ) : (
            <ListCard>
              {groups.map((group) => (
                <div key={group.key}>
                  <DayHeading>{group.label}</DayHeading>
                  {group.rows.map((it) => (
                    <ChatRow
                      key={it.orderId}
                      chat={it}
                      members={members}
                      authorName={nameOf(it.lastAuthor)}
                      opening={opening === it.orderId}
                      onOpen={() => void openChat(it.orderId, it.orderId)}
                    />
                  ))}
                </div>
              ))}
            </ListCard>
          )}
        </>
      )}

      <OrderDrawer
        order={openOrder}
        onClose={closeChat}
        initialTab="conversacion"
        focusMessageId={openMsg}
      />
    </div>
  );
}

/** Pestaña de la pantalla. No confundir con los filtros, que son pastillas. */
function TabButton({
  label,
  icon,
  count,
  selected,
  onSelect,
}: {
  label: string;
  icon: React.ReactNode;
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        '-mb-px flex items-center gap-2 rounded-t-[10px] border-b-2 px-3.5 py-2.5 text-[13px] font-bold transition-colors [transition-duration:130ms]',
        selected
          ? 'border-accent text-accent-ink'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
      {count > 0 ? (
        <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-accent px-1.5 py-px text-[10px] font-extrabold tabular-nums leading-[1.4] text-accent-foreground">
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </button>
  );
}

function ChatRow({
  chat,
  members,
  authorName,
  opening,
  onOpen,
}: {
  chat: ChatInboxItem;
  members: MemberSummary[];
  authorName: string;
  /** Se esta trayendo el pedido: la fila lo dice en vez de quedarse muda. */
  opening: boolean;
  onOpen: () => void;
}) {
  const unread = chat.unreadCount > 0;
  const parts = splitMentions(chat.lastBody, members);

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={opening}
      aria-busy={opening}
      className={cn(
        'flex w-full gap-3 rounded-[12px] p-[12px_14px] text-left transition-colors [transition-duration:130ms] hover:bg-surface',
        unread && 'bg-gradient-to-r from-wash to-transparent to-70% hover:from-wash-strong',
        opening && 'bg-surface',
      )}
    >
      <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-wash-strong text-[12px] font-extrabold text-accent-ink">
        {opening ? (
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
        ) : (
          initialsOf(authorName)
        )}
        {/* La mencion manda sobre el "sin leer" a secas: si me nombraron, eso
            es lo primero que hay que ver. */}
        {opening ? null : chat.mentioned ? (
          <span className="absolute -right-1 -top-1 grid h-[15px] w-[15px] place-items-center rounded-full bg-accent text-accent-foreground ring-2 ring-card">
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
          {/* "Tú:" en vez del propio nombre — uno se reconoce antes asi, y de un
              vistazo se ve si quedaste esperando respuesta o si la pelota esta
              en tu tejado. */}
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
