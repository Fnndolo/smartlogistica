'use client';

import { useState } from 'react';
import { AtSign, Loader2 } from 'lucide-react';
import type { MemberSummary, MentionItem } from '@smartlogistica/shared';

import { cn } from '@/lib/utils';

import { initialsOf, splitMentions } from '../orders/mention-utils';
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

type Filter = 'all' | 'unread';

/**
 * Pestaña MENCIONES dentro de Chats.
 *
 * Cada fila es un MENSAJE que te nombra, no una conversacion: por eso se lee el
 * texto completo y al abrirla se salta a ese mensaje exacto dentro del hilo.
 * Es el complemento de la bandeja, que responde a "que conversaciones tengo"
 * mientras esta responde a "donde me nombraron".
 */
export function MentionsList({
  members,
  opening,
  onOpen,
}: {
  members: MemberSummary[];
  /** messageId que se esta abriendo (la fila lo dice en vez de quedarse muda). */
  opening: string | null;
  onOpen: (orderId: string, messageId: string) => void;
}) {
  const { items, loading } = useMentions();
  const [filter, setFilter] = useState<Filter>('all');

  const nameOf = (raw: string): string => members.find((m) => m.email === raw)?.name ?? raw;
  const unreadCount = items.filter((m) => m.unread).length;
  const visible = filter === 'unread' ? items.filter((m) => m.unread) : items;
  const groups = groupByDay(visible, (m) => m.createdAt);

  if (loading && items.length === 0) return <ListSkeleton />;
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<AtSign className="h-5 w-5" />}
        title="Sin menciones todavía"
        hint="Cuando te mencionen con @ en la conversación de un pedido, lo verás aquí."
      />
    );
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-[7px]">
        <FilterChip
          label="Todas"
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
          icon={<AtSign className="h-5 w-5" />}
          title="No tienes menciones sin leer"
          hint="Todo lo que te mencionaron ya lo abriste."
        />
      ) : (
        <ListCard>
          {groups.map((group) => (
            <div key={group.key}>
              <DayHeading>{group.label}</DayHeading>
              {group.rows.map((it) => (
                <MentionRow
                  key={it.messageId}
                  item={it}
                  members={members}
                  authorName={nameOf(it.author)}
                  opening={opening === it.messageId}
                  onOpen={() => onOpen(it.orderId, it.messageId)}
                />
              ))}
            </div>
          ))}
        </ListCard>
      )}
    </>
  );
}

function MentionRow({
  item,
  members,
  authorName,
  opening,
  onOpen,
}: {
  item: MentionItem;
  members: MemberSummary[];
  authorName: string;
  opening: boolean;
  onOpen: () => void;
}) {
  const parts = splitMentions(item.body, members);
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={opening}
      aria-busy={opening}
      className={cn(
        'flex w-full gap-3 rounded-[12px] p-[12px_14px] text-left transition-colors [transition-duration:130ms] hover:bg-surface',
        item.unread && 'bg-gradient-to-r from-wash to-transparent to-70% hover:from-wash-strong',
        opening && 'bg-surface',
      )}
    >
      <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-wash-strong text-[12px] font-extrabold text-accent-ink">
        {opening ? (
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
        ) : (
          initialsOf(authorName)
        )}
        {item.unread && !opening ? (
          <span className="absolute -right-px -top-px h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-card" />
        ) : null}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-2">
          <span
            className={cn(
              'text-[10.5px] font-extrabold uppercase tracking-[0.06em]',
              item.unread ? 'text-accent-ink' : 'text-hint',
            )}
          >
            {item.warehouseName ?? 'Pedidos generales'}
          </span>
          <span className="min-w-0 truncate text-[12.5px] text-muted-foreground">
            {item.externalId} · {item.customerName}
          </span>
          <span className="ml-auto shrink-0 whitespace-nowrap text-[11px] text-hint">
            {whenLabel(new Date(item.createdAt))}
          </span>
        </span>

        <span className="mt-[3px] block truncate text-[12.8px] text-muted-foreground">
          <span className="font-bold text-foreground">{authorName}: </span>
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
