'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns/format';
import { formatDistanceToNow } from 'date-fns/formatDistanceToNow';
import { isToday } from 'date-fns/isToday';
import { isYesterday } from 'date-fns/isYesterday';
import { es } from 'date-fns/locale/es';
import { AtSign } from 'lucide-react';
import type { MemberSummary, MentionItem } from '@smartlogistica/shared';

import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import { initialsOf, splitMentions } from '../orders/mention-utils';
import { orderTarget, useMentions } from '../use-mentions';

type Filter = 'all' | 'unread';

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
 * Pagina "Menciones", tipo Google Chat: todas las menciones a mi, completas,
 * mas recientes primero. Click -> abre el pedido directo en la conversacion.
 * Los filtros (Todas / Sin leer) trabajan sobre la lista YA cargada: no hay
 * consulta nueva, solo se esconden filas.
 */
export default function MentionsPage() {
  const router = useRouter();
  const { items } = useMentions();
  const [filter, setFilter] = useState<Filter>('all');

  const { data: members = [] } = useQuery({
    queryKey: ['members'],
    queryFn: () => api.get<MemberSummary[]>('/v1/members'),
    staleTime: 5 * 60_000,
  });
  const nameOf = (raw: string): string => members.find((m) => m.email === raw)?.name ?? raw;

  const unreadCount = items.filter((m) => m.unread).length;
  const visible = filter === 'unread' ? items.filter((m) => m.unread) : items;

  // Agrupacion por dia conservando el orden que llega del API (mas nuevas
  // primero): se corta un grupo cada vez que cambia la fecha.
  const groups = useMemo(() => {
    const out: Array<{ key: string; label: string; rows: MentionItem[] }> = [];
    for (const it of visible) {
      const date = new Date(it.createdAt);
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
          <h1 className="text-[21px] font-extrabold tracking-[-0.025em]">Menciones</h1>
          <p className="mt-0.5 max-w-[62ch] text-[13px] text-muted-foreground">
            Cada vez que alguien te menciona en la conversación de un pedido, aparece aquí.
          </p>
        </div>
      </header>

      {items.length === 0 ? (
        <EmptyState
          title="Sin menciones todavía"
          hint="Cuando te mencionen con @ en un pedido, lo verás aquí."
        />
      ) : (
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
              title="No tienes menciones sin leer"
              hint="Todo lo que te mencionaron ya lo abriste."
            />
          ) : (
            <div className="rounded-[14px] border border-border bg-card p-[6px_8px]">
              {groups.map((group) => (
                <div key={group.key}>
                  <p className="px-0.5 pb-[7px] pt-3.5 text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-hint">
                    {group.label}
                  </p>
                  {group.rows.map((it) => {
                    const author = nameOf(it.author);
                    const parts = splitMentions(it.body, members);
                    return (
                      <button
                        key={it.messageId}
                        type="button"
                        onClick={() => router.push(orderTarget(it))}
                        className={cn(
                          'flex w-full gap-3 rounded-[12px] p-[12px_14px] text-left transition-colors [transition-duration:130ms] hover:bg-surface',
                          it.unread &&
                            'bg-gradient-to-r from-wash to-transparent to-70% hover:from-wash-strong',
                        )}
                      >
                        <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-wash-strong text-[12px] font-extrabold text-accent-ink">
                          {initialsOf(author)}
                          {it.unread ? (
                            <span className="absolute -right-px -top-px h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-card" />
                          ) : null}
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-baseline gap-2">
                            <span
                              className={cn(
                                'text-[10.5px] font-extrabold uppercase tracking-[0.06em]',
                                it.unread ? 'text-accent-ink' : 'text-hint',
                              )}
                            >
                              {it.warehouseName ?? 'Pedidos generales'}
                            </span>
                            <span className="min-w-0 truncate text-[12.5px] text-muted-foreground">
                              {it.externalId} · {it.customerName}
                            </span>
                            <span className="ml-auto shrink-0 whitespace-nowrap text-[11px] text-hint">
                              {whenLabel(new Date(it.createdAt))}
                            </span>
                          </span>

                          <span className="mt-[3px] block truncate text-[12.8px] text-muted-foreground">
                            <span className="font-bold text-foreground">{author}: </span>
                            {parts.map((p, i) =>
                              p.kind === 'mention' ? (
                                <span
                                  key={i}
                                  className="rounded-[5px] bg-wash px-1 font-bold text-accent-ink"
                                >
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
                  })}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
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

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed border-input bg-card py-16 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-full bg-wash text-accent">
        <AtSign className="h-5 w-5" />
      </span>
      <p className="text-[13.5px] font-bold">{title}</p>
      <p className="max-w-[46ch] px-6 text-[12px] text-muted-foreground">{hint}</p>
    </div>
  );
}
