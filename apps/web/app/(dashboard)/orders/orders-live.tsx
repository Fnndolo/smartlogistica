'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Building2, ChevronLeft, ChevronRight, RefreshCw, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';
import type {
  ListOrdersResponse,
  OrderSortField,
  OrderSummary,
  SortDir,
  WarehouseSummary,
} from '@smartlogistica/shared';

import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api-client';

import { OrdersTable } from './orders-table';
import { OrderDrawer } from './order-drawer';
import { EmptyState } from './empty-state';
import { DateRangeFilter } from './date-range-filter';
import { SearchFilter } from './search-filter';
import { useOrdersStream } from './use-orders-stream';

export type OrdersScope = { kind: 'general' } | { kind: 'warehouse'; id: string; name: string };

const SORT_FIELDS = new Set<OrderSortField>(['date', 'quantity', 'price']);
const parseSort = (v: string | null): OrderSortField =>
  v && SORT_FIELDS.has(v as OrderSortField) ? (v as OrderSortField) : 'date';
const parseDir = (v: string | null): SortDir => (v === 'asc' ? 'asc' : 'desc');

interface OrdersLiveProps {
  initialData: ListOrdersResponse;
  scope?: OrdersScope;
  /** Etapa en la sede: 'pending' (por preparar) | 'invoiced' (facturados). */
  state?: 'pending' | 'invoiced';
}

// SSE es el canal primario (instantaneo). El polling lento es solo red de
// seguridad por si el stream cae y aun no reconecto.
const FALLBACK_POLL_MS = 20_000;
const SSE_DEBOUNCE_MS = 350;
const PAGE_SIZE = 50;

export function OrdersLive({ initialData, scope = { kind: 'general' }, state }: OrdersLiveProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const from = searchParams.get('from') ?? undefined;
  const to = searchParams.get('to') ?? undefined;
  const q = searchParams.get('q') ?? undefined;
  const shipping = searchParams.get('shipping') ?? undefined;
  const sort = parseSort(searchParams.get('sort'));
  const dir = parseDir(searchParams.get('dir'));
  const warehouseId = scope.kind === 'warehouse' ? scope.id : undefined;

  const { data, dataUpdatedAt } = useQuery({
    queryKey: ['orders', { scope: warehouseId ?? 'general', state, shipping, page, from, to, q, sort, dir }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(PAGE_SIZE));
      params.set('sort', sort);
      params.set('dir', dir);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (q) params.set('q', q);
      if (warehouseId) params.set('warehouse', warehouseId);
      if (state) params.set('state', state);
      if (shipping) params.set('shipping', shipping);
      return api.get<ListOrdersResponse>(`/v1/orders?${params.toString()}`);
    },
    // El SSR de page.tsx ya respeta scope/page/from/to actual, asi que el
    // initialData siempre matchea la primera query del cliente.
    initialData,
    // Mantener los resultados anteriores mientras carga la nueva busqueda/pagina
    // -> la tabla no parpadea a vacio (se siente fluido al escribir).
    placeholderData: keepPreviousData,
    refetchInterval: FALLBACK_POLL_MS,
    refetchIntervalInBackground: false,
  });

  // Sedes (para el menu de asignar/transferir).
  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get<WarehouseSummary[]>('/v1/warehouses'),
    staleTime: 30_000,
  });

  // Seleccion multiple (se limpia al cambiar de pagina/scope/filtros).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    setSelected(new Set());
  }, [page, q, from, to, sort, dir, warehouseId, shipping]);

  // Pedido abierto en el drawer (click en la fila).
  const [openOrder, setOpenOrder] = useState<OrderSummary | null>(null);
  // Cuando el pedido se abre desde la campana entramos directo a la conversacion.
  const [openTab, setOpenTab] = useState<'detalle' | 'conversacion'>('detalle');

  const openFromRow = useCallback((o: OrderSummary) => {
    setOpenTab('detalle');
    setOpenOrder(o);
  }, []);

  // Deep-link desde la campana de notificaciones: ?order=<id> abre el drawer del
  // pedido (aunque no este en la pagina actual: se trae por id). Luego limpia el
  // parametro para que no se reabra al navegar.
  const orderParam = searchParams.get('order');
  useEffect(() => {
    if (!orderParam) return;
    let cancelled = false;
    (async () => {
      try {
        const detail = await api.get<OrderSummary>(`/v1/orders/${orderParam}`);
        if (!cancelled) {
          setOpenTab('conversacion');
          setOpenOrder(detail);
        }
      } catch {
        /* pedido no accesible o inexistente: se ignora */
      } finally {
        const params = new URLSearchParams(searchParams.toString());
        params.delete('order');
        router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ''}`);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Solo depende del id del parametro; router/pathname son estables.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderParam]);

  // Cada evento SSE -> refetch debounced de la pagina actual. El debounce
  // coalesce rafagas (ej: 100 upserts durante un backfill -> pocos refetch).
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleStreamEvent = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['order-stats'] });
    }, SSE_DEBOUNCE_MS);
  }, [queryClient]);
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const live = useOrdersStream(handleStreamEvent);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  // Re-encolar a primera pagina si los filtros cambiaron y nos quedamos fuera del total
  useEffect(() => {
    if (page > totalPages && totalPages >= 1) {
      const next = new URLSearchParams(searchParams.toString());
      next.delete('page');
      router.replace(`${pathname}?${next.toString()}`);
    }
  }, [page, totalPages, router, pathname, searchParams]);

  const goToPage = (next: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next <= 1) params.delete('page');
    else params.set('page', String(next));
    router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ''}`);
  };

  const handleSort = (field: OrderSortField) => {
    const params = new URLSearchParams(searchParams.toString());
    if (sort === field) {
      // mismo campo -> alternar direccion
      params.set('dir', dir === 'asc' ? 'desc' : 'asc');
    } else {
      params.set('sort', field);
      params.set('dir', 'desc'); // por defecto, mayor a menor
    }
    params.delete('page');
    router.replace(`${pathname}?${params.toString()}`);
  };

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleSelectAll = () =>
    setSelected((prev) => (prev.size === items.length ? new Set() : new Set(items.map((o) => o.id))));

  const clearSelectionAndRefresh = () => {
    setSelected(new Set());
    queryClient.invalidateQueries({ queryKey: ['orders'] });
    queryClient.invalidateQueries({ queryKey: ['warehouses'] });
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SearchFilter />
          <DateRangeFilter />
          {state === 'invoiced' && warehouseId ? (
            <>
              <ShippingFilter />
              <ShippingAutoStatus warehouseId={warehouseId} />
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-4">
          <LiveIndicator live={live} lastUpdate={dataUpdatedAt} itemCount={total} />
          {total > 0 ? (
            <p className="text-xs tabular-nums text-muted-foreground">
              {rangeStart}–{rangeEnd} de {total} {total === 1 ? 'pedido' : 'pedidos'}
            </p>
          ) : null}
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="rounded-xl border border-border bg-card">
            <OrdersTable
              items={items}
              sort={sort}
              dir={dir}
              onSort={handleSort}
              selectedIds={selected}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={toggleSelectAll}
              onOpenOrder={openFromRow}
              showShipping={state === 'invoiced'}
            />
          </div>

          {totalPages > 1 ? (
            <Pagination page={page} totalPages={totalPages} onChange={goToPage} />
          ) : null}
        </>
      )}

      {selected.size > 0 ? (
        <AssignmentBar
          scope={scope}
          warehouses={warehouses}
          selectedIds={[...selected]}
          onClear={() => setSelected(new Set())}
          onDone={clearSelectionAndRefresh}
        />
      ) : null}

      <OrderDrawer order={openOrder} onClose={() => setOpenOrder(null)} initialTab={openTab} />
    </>
  );
}

const SHIPPING_OPTIONS = [
  { value: '', label: 'Envio: todos' },
  { value: 'sin_movimientos', label: 'Sin movimientos' },
  { value: 'en_transito', label: 'En transito' },
  { value: 'novedad', label: 'Con novedad' },
  { value: 'entregado', label: 'Entregado' },
] as const;

/** Filtro por estado del envio (Facturados). Vive en la URL (?shipping=). */
function ShippingFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get('shipping') ?? '';

  const onChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set('shipping', value);
    else params.delete('shipping');
    params.delete('page');
    router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ''}`);
  };

  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="Filtrar por estado del envio"
    >
      {SHIPPING_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * El rastreo de Coordinadora corre solo en el servidor (cada ~2 min) y el estado
 * llega por SSE, asi que la lista se actualiza sola: no hay boton "Actualizar
 * envios". Este control solo informa que es automatico y deja forzar una consulta
 * inmediata (icono) para quien no quiera esperar el proximo ciclo.
 */
function ShippingAutoStatus({ warehouseId }: { warehouseId: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const runNow = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ updated: number }>(
        `/v1/orders/refresh-shipping?warehouse=${encodeURIComponent(warehouseId)}`,
      );
      if (r.updated > 0) toast.success(`${r.updated} envio(s) actualizados`);
      qc.invalidateQueries({ queryKey: ['orders'] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo actualizar el seguimiento');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs text-muted-foreground">
      <span className="text-[13px]">Envios en vivo</span>
      <button
        type="button"
        onClick={runNow}
        disabled={busy}
        title="Se actualizan solos. Clic para consultar ahora."
        aria-label="Consultar envios ahora"
        className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted disabled:opacity-50"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
      </button>
    </div>
  );
}

/**
 * Barra flotante de acciones para los pedidos seleccionados.
 * - En generales: "Asignar a [sede]".
 * - En una sede: "Devolver a generales" + "Transferir a [otra sede]".
 */
function AssignmentBar({
  scope,
  warehouses,
  selectedIds,
  onClear,
  onDone,
}: {
  scope: OrdersScope;
  warehouses: WarehouseSummary[];
  selectedIds: string[];
  onClear: () => void;
  onDone: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const targets = useMemo(
    () => warehouses.filter((w) => !(scope.kind === 'warehouse' && w.id === scope.id)),
    [warehouses, scope],
  );

  const assign = async (warehouseId: string | null, label: string) => {
    setSubmitting(true);
    try {
      const res = await api.post<{ count: number }>('/v1/orders/assign', {
        orderIds: selectedIds,
        warehouseId,
      });
      toast.success(`${res.count} pedido(s) ${label}`);
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo completar la accion');
    } finally {
      setSubmitting(false);
    }
  };

  // En movil la barra se levanta por encima de la navegacion inferior.
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 md:bottom-6">
      <div className="pointer-events-auto flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-popover px-4 py-3 shadow-lg">
        <span className="text-sm font-medium tabular-nums">
          {selectedIds.length} seleccionado{selectedIds.length === 1 ? '' : 's'}
        </span>
        <div className="h-5 w-px bg-border" />

        {scope.kind === 'warehouse' ? (
          <Button variant="outline" size="sm" loading={submitting} onClick={() => assign(null, 'devueltos a generales')}>
            <Undo2 className="h-3.5 w-3.5" />
            Devolver a generales
          </Button>
        ) : null}

        {targets.length > 0 ? (
          <WarehousePicker
            label={scope.kind === 'warehouse' ? 'Transferir a' : 'Asignar a sede'}
            warehouses={targets}
            disabled={submitting}
            onPick={(w) => assign(w.id, scope.kind === 'warehouse' ? `transferidos a ${w.name}` : `asignados a ${w.name}`)}
          />
        ) : (
          <span className="text-xs text-muted-foreground">No hay otras sedes. Crea una en &laquo;Sedes&raquo;.</span>
        )}

        <button
          type="button"
          onClick={onClear}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Limpiar seleccion"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function WarehousePicker({
  label,
  warehouses,
  disabled,
  onPick,
}: {
  label: string;
  warehouses: WarehouseSummary[];
  disabled: boolean;
  onPick: (w: WarehouseSummary) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button size="sm" disabled={disabled} loading={disabled} onClick={() => setOpen((s) => !s)}>
        <Building2 className="h-3.5 w-3.5" />
        {label}
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? '-rotate-90' : 'rotate-90'}`} />
      </Button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <ul className="absolute bottom-full left-0 z-20 mb-2 max-h-64 w-56 overflow-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
            {warehouses.map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onPick(w);
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted"
                >
                  <span className="truncate">{w.name}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{w.orderCount}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (next: number) => void;
}) {
  const pages = buildPageList(page, totalPages);

  return (
    <nav className="flex items-center justify-end gap-1" aria-label="Paginacion">
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        aria-label="Pagina anterior"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </Button>

      {pages.map((p, idx) =>
        p === 'ellipsis' ? (
          <span key={`e-${idx}`} className="px-1 text-xs text-muted-foreground">
            ...
          </span>
        ) : (
          <Button
            key={p}
            variant={p === page ? 'default' : 'outline'}
            size="sm"
            onClick={() => onChange(p)}
            className="min-w-8 px-2 tabular-nums"
          >
            {p}
          </Button>
        ),
      )}

      <Button
        variant="outline"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        aria-label="Pagina siguiente"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </nav>
  );
}

/**
 * Devuelve una lista compacta de paginas para mostrar como botones:
 *   [1, 2, 3, 4, 5]        (≤7 total)
 *   [1, '...', 4, 5, 6, '...', 20]  (current=5 de 20)
 *   [1, 2, 3, '...', 20]   (current=2 de 20)
 *   [1, '...', 18, 19, 20] (current=19 de 20)
 */
function buildPageList(current: number, total: number): Array<number | 'ellipsis'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const window: Array<number | 'ellipsis'> = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  if (start > 2) window.push('ellipsis');
  for (let i = start; i <= end; i++) window.push(i);
  if (end < total - 1) window.push('ellipsis');
  window.push(total);
  return window;
}

function LiveIndicator({
  live,
  lastUpdate,
  itemCount,
}: {
  live: boolean;
  lastUpdate: number;
  itemCount: number;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  const secondsAgo = Math.max(0, Math.floor((now - lastUpdate) / 1000));

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          live ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
        }`}
        aria-hidden
      />
      <span className="tabular-nums">
        {live ? 'En vivo' : 'Reconectando'} · {itemCount} {itemCount === 1 ? 'pedido' : 'pedidos'}
        {!live ? ` · hace ${secondsAgo}s` : ''}
      </span>
    </div>
  );
}
