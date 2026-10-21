'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ChevronDown, Loader2, Search } from 'lucide-react';
import type { OrderSearchResult } from '@smartlogistica/shared';

import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import { orderTarget } from '../use-mentions';
import type { OrdersScope } from './orders-live';

const STAGE_META: Record<
  OrderSearchResult['stage'],
  { label: string; variant: 'outline' | 'warning' | 'success' }
> = {
  general: { label: 'Generales', variant: 'outline' },
  pending: { label: 'Por preparar', variant: 'warning' },
  invoiced: { label: 'Facturado', variant: 'success' },
};

/** El resultado vive en la vista que se esta mirando (la tabla ya lo muestra). */
function inThisView(r: OrderSearchResult, scope: OrdersScope, state?: 'pending' | 'invoiced') {
  if (scope.kind === 'general') return r.stage === 'general';
  return r.warehouseId === scope.id && r.stage === (state === 'invoiced' ? 'invoiced' : 'pending');
}

function viewName(scope: OrdersScope, state?: 'pending' | 'invoiced') {
  if (scope.kind === 'general') return state === 'invoiced' ? 'Facturados' : 'Generales';
  return `${scope.name} · ${state === 'invoiced' ? 'Facturados' : 'Por preparar'}`;
}

/**
 * El buscador de la vista tambien busca FUERA de ella (reemplaza a la busqueda
 * global del sidebar). La tabla sigue filtrando lo de esta sede como siempre;
 * esto solo pinta lo que coincide en OTRAS sedes o secciones, y al elegirlo
 * lleva a donde vive el pedido con su drawer abierto.
 *
 * - `empty`: la vista no tiene coincidencias -> ocupa el lugar del estado vacio.
 * - `hint`: la vista si tiene -> una linea discreta y plegada debajo de los
 *   filtros, para no tapar la tabla.
 *
 * Comparte la clave de cache con la busqueda global (['global-search', q]).
 */
export function SearchElsewhere({
  q,
  scope,
  state,
  mode,
  pending = false,
  filtered = false,
}: {
  q: string;
  scope: OrdersScope;
  state?: 'pending' | 'invoiced';
  mode: 'empty' | 'hint';
  /** La tabla aun esta trayendo el resultado de esta busqueda. */
  pending?: boolean;
  /** Hay otros filtros activos (fecha, producto...) que pueden ocultar pedidos. */
  filtered?: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const searchable = q.length >= 2;

  const { data = [], isLoading } = useQuery({
    queryKey: ['global-search', q],
    queryFn: () => api.get<OrderSearchResult[]>(`/v1/orders/search?q=${encodeURIComponent(q)}`),
    enabled: searchable,
    staleTime: 30_000,
  });
  const elsewhere = data.filter((r) => !inThisView(r, scope, state));

  const list = (
    <ul className="divide-y divide-border/60">
      {elsewhere.map((r) => {
        const stage = STAGE_META[r.stage];
        return (
          <li key={r.orderId}>
            <button
              type="button"
              onClick={() => router.push(orderTarget(r))}
              className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent/10 focus-visible:bg-accent/10 focus-visible:outline-none"
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{r.customerName}</span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    {r.externalId}
                  </span>
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {r.productName ?? 'Sin producto'}
                  {r.customerDocument ? ` · CC ${r.customerDocument}` : ''}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <Badge variant={stage.variant}>{stage.label}</Badge>
                <span className="text-[10px] text-muted-foreground">
                  {r.warehouseName ?? 'Sin sede'}
                </span>
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
            </button>
          </li>
        );
      })}
    </ul>
  );

  if (mode === 'hint') {
    if (elsewhere.length === 0) return null;
    const n = elsewhere.length;
    return (
      <div className="shadow-card overflow-hidden rounded-xl border border-border bg-card">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            {n === 1 ? 'También hay 1 coincidencia' : `También hay ${n} coincidencias`} fuera de{' '}
            {viewName(scope, state)}
          </span>
          <ChevronDown
            className={cn('h-3.5 w-3.5 shrink-0 transition-transform', expanded && 'rotate-180')}
          />
        </button>
        {expanded ? <div className="border-t border-border">{list}</div> : null}
      </div>
    );
  }

  // mode === 'empty'
  const loading = pending || (searchable && isLoading);
  return (
    <div className="shadow-card overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-start gap-3 px-4 py-3.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
          ) : (
            <Search className="h-4 w-4 text-muted-foreground" />
          )}
        </span>
        <div className="min-w-0">
          <h2 className="break-words text-sm font-semibold">
            «{q}» no está en {viewName(scope, state)}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {loading
              ? 'Buscando en las demás sedes…'
              : !searchable
                ? 'Escribe al menos 2 caracteres para buscar también en las demás sedes.'
                : elsewhere.length > 0
                  ? 'Lo encontramos aquí. Ábrelo para ir a donde está el pedido.'
                  : `Tampoco aparece en las demás sedes ni en generales.${
                      filtered ? ' Revisa también los filtros activos.' : ''
                    }`}
          </p>
        </div>
      </div>
      {!loading && elsewhere.length > 0 ? (
        <div className="border-t border-border">{list}</div>
      ) : null}
    </div>
  );
}
