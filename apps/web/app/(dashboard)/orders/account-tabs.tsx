'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { OrderAccount } from '@smartlogistica/shared';

import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/**
 * Pestañas por TIENDA en pedidos generales.
 *
 * Con dos VTEX conectados los pedidos NO se mezclan aqui: cada tienda tiene su
 * pestaña. (En la sede si conviven, porque alli la sede ya es el criterio.)
 *
 * Con una sola tienda no se pinta NADA: una pestaña sola no informa de nada y
 * solo roba una fila de alto.
 */
export function AccountTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get('account') ?? '';

  const { data: accounts = [] } = useQuery({
    queryKey: ['order-accounts'],
    queryFn: () => api.get<OrderAccount[]>('/v1/orders/accounts'),
    staleTime: 60_000,
  });

  if (accounts.length < 2) return null;

  const go = (accountName: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (accountName) params.set('account', accountName);
    else params.delete('account');
    // Cambiar de tienda es cambiar de listado: se vuelve a la primera pagina.
    params.delete('page');
    const qs = params.toString();
    router.push(qs ? `/orders?${qs}` : '/orders');
  };

  const total = accounts.reduce((n, a) => n + a.count, 0);

  return (
    <nav
      aria-label="Tienda"
      className="flex max-w-full flex-wrap gap-[3px] rounded-xl border border-border bg-wash p-[3px] sm:inline-flex"
    >
      <Tab label="Todas" count={total} on={current === ''} onClick={() => go('')} />
      {accounts.map((a) => (
        <Tab
          key={a.accountName}
          label={a.label}
          count={a.count}
          on={current === a.accountName}
          onClick={() => go(a.accountName)}
        />
      ))}
    </nav>
  );
}

function Tab({
  label,
  count,
  on,
  onClick,
}: {
  label: string;
  count: number;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'inline-flex min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-4 py-[7px] text-[13px] font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:flex-none sm:justify-start max-md:min-h-[40px]',
        on ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground',
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
      <span
        className={cn(
          'shrink-0 rounded-full px-[7px] py-px text-[11px] font-bold tabular-nums',
          on ? 'bg-wash-strong text-accent-ink' : 'bg-card/60 text-hint',
        )}
      >
        {count}
      </span>
    </button>
  );
}
