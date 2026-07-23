'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns/formatDistanceToNow';
import { es } from 'date-fns/locale/es';
import { AtSign } from 'lucide-react';
import type { MemberSummary } from '@smartlogistica/shared';

import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import { initialsOf, splitMentions } from '../orders/mention-utils';
import { orderTarget, useMentions } from '../use-mentions';

/**
 * Pagina "Menciones", tipo Google Chat: todas las menciones a mi, completas,
 * mas recientes primero. Click -> abre el pedido directo en la conversacion.
 */
export default function MentionsPage() {
  const router = useRouter();
  const { items } = useMentions();

  const { data: members = [] } = useQuery({
    queryKey: ['members'],
    queryFn: () => api.get<MemberSummary[]>('/v1/members'),
    staleTime: 5 * 60_000,
  });
  const nameOf = (raw: string): string => members.find((m) => m.email === raw)?.name ?? raw;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Menciones</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cada vez que alguien te menciona en la conversación de un pedido, aparece aquí.
        </p>
      </header>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-16 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <AtSign className="h-5 w-5" />
          </span>
          <p className="text-sm font-medium">Sin menciones todavía</p>
          <p className="text-xs text-muted-foreground">
            Cuando te mencionen con @ en un pedido, lo verás aquí.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {items.map((it) => {
            const author = nameOf(it.author);
            const parts = splitMentions(it.body, members);
            return (
              <button
                key={it.messageId}
                type="button"
                onClick={() => router.push(orderTarget(it))}
                className={cn(
                  'flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-0 hover:bg-muted/60',
                  it.unread && 'bg-primary/[0.04]',
                )}
              >
                <span className="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {initialsOf(author)}
                  {it.unread ? (
                    <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-card" />
                  ) : null}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span
                      className={cn(
                        'truncate text-xs uppercase tracking-wide',
                        it.unread ? 'font-semibold text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {it.warehouseName ?? 'Pedidos generales'}
                      <span className="ml-2 normal-case tracking-normal text-muted-foreground">
                        {it.externalId} · {it.customerName}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {formatDistanceToNow(new Date(it.createdAt), { locale: es, addSuffix: true })}
                    </span>
                  </span>

                  <span className="mt-0.5 block truncate text-sm">
                    <span className="font-medium">{author}: </span>
                    {parts.map((p, i) =>
                      p.kind === 'mention' ? (
                        <span
                          key={i}
                          className="rounded-md bg-primary/10 px-1 py-0.5 font-medium text-primary"
                        >
                          {p.value}
                        </span>
                      ) : (
                        <span key={i} className="text-foreground/90">
                          {p.value}
                        </span>
                      ),
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
