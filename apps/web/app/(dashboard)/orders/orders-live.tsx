'use client';

import { useSearchParams, usePathname } from 'next/navigation';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Check, ChevronLeft, ChevronRight, MapPin, Truck, Undo2, X } from 'lucide-react';
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
import { cn, replaceUrlParams } from '@/lib/utils';

import { OrdersTable } from './orders-table';
import { OrderDrawer } from './order-drawer';
import { EmptyState } from './empty-state';
import { DateRangeFilter } from './date-range-filter';
import { OrdersPulseRow } from './orders-pulse';
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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const from = searchParams.get('from') ?? undefined;
  const to = searchParams.get('to') ?? undefined;
  const q = searchParams.get('q') ?? undefined;
  const shipping = searchParams.get('shipping') ?? undefined;
  const address = searchParams.get('address') ?? undefined;
  const sort = parseSort(searchParams.get('sort'));
  const dir = parseDir(searchParams.get('dir'));
  const warehouseId = scope.kind === 'warehouse' ? scope.id : undefined;

  const queryKey = [
    'orders',
    { scope: warehouseId ?? 'general', state, shipping, address, page, from, to, q, sort, dir },
  ] as const;
  // Clave con la que se monto la pagina (la que corresponde al initialData del
  // SSR). Se fija UNA vez: si initialData se pasara plano, React Query lo
  // sembraria en CADA clave nueva (al aplicar un filtro) y la tabla mostraba los
  // datos SIN filtrar como si el filtro "no aplicara" hasta terminar el fetch.
  const [mountKey] = useState(() => JSON.stringify(queryKey));

  const { data, dataUpdatedAt, isPlaceholderData } = useQuery({
    queryKey,
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
      if (address) params.set('address', address);
      return api.get<ListOrdersResponse>(`/v1/orders?${params.toString()}`);
    },
    // Solo la clave inicial recibe el initialData del SSR (ver mountKey arriba).
    initialData: () => (JSON.stringify(queryKey) === mountKey ? initialData : undefined),
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
  }, [page, q, from, to, sort, dir, warehouseId, shipping, address]);

  // Pedido abierto en el drawer (click en la fila). La conversacion es SIEMPRE
  // la primera pestaña.
  const [openOrder, setOpenOrder] = useState<OrderSummary | null>(null);
  const [openTab, setOpenTab] = useState<'detalle' | 'conversacion'>('conversacion');
  // Mensaje al que hay que SALTAR al abrir (deep-link de una mencion).
  const [openMsg, setOpenMsg] = useState<string | null>(null);

  const openFromRow = useCallback((o: OrderSummary) => {
    setOpenTab('conversacion');
    setOpenMsg(null);
    setOpenOrder(o);
  }, []);

  // Deep-link desde la campana/menciones: ?order=<id> abre el drawer del pedido
  // (aunque no este en la pagina actual: se trae por id) y ?msg=<id> salta a ese
  // mensaje dentro de la conversacion. Luego limpia los parametros.
  const orderParam = searchParams.get('order');
  const msgParam = searchParams.get('msg');
  useEffect(() => {
    if (!orderParam) return;
    let cancelled = false;
    (async () => {
      try {
        const detail = await api.get<OrderSummary>(`/v1/orders/${orderParam}`);
        if (!cancelled) {
          setOpenTab('conversacion');
          setOpenMsg(msgParam);
          setOpenOrder(detail);
        }
      } catch {
        /* pedido no accesible o inexistente: se ignora */
      } finally {
        const params = new URLSearchParams(searchParams.toString());
        params.delete('order');
        params.delete('msg');
        replaceUrlParams(pathname, params);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Solo depende del id del parametro; pathname/searchParams son estables aqui.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderParam]);

  // Cada evento SSE -> refetch debounced de la pagina actual. El debounce
  // coalesce rafagas (ej: 100 upserts durante un backfill -> pocos refetch).
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleStreamEvent = useCallback(
    (event?: { kind: string }) => {
      // "esta escribiendo" es efimero: no toca las listas.
      if (event?.kind === 'chat.typing') return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['orders'] });
        queryClient.invalidateQueries({ queryKey: ['order-stats'] });
        queryClient.invalidateQueries({ queryKey: ['orders-pulse'] });
      }, SSE_DEBOUNCE_MS);
    },
    [queryClient],
  );
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const live = useOrdersStream(handleStreamEvent);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  // En "Facturados" no se permite seleccionar (ni transferir/devolver): ya se cerro en VTEX.
  const canSelect = state !== 'invoiced';
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  // Re-encolar a primera pagina si los filtros cambiaron y nos quedamos fuera del total
  useEffect(() => {
    if (page > totalPages && totalPages >= 1) {
      const next = new URLSearchParams(searchParams.toString());
      next.delete('page');
      replaceUrlParams(pathname, next);
    }
  }, [page, totalPages, pathname, searchParams]);

  const goToPage = (next: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next <= 1) params.delete('page');
    else params.set('page', String(next));
    replaceUrlParams(pathname, params);
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
    replaceUrlParams(pathname, params);
  };

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleSelectAll = () =>
    setSelected((prev) => (prev.size === items.length ? new Set() : new Set(items.map((o) => o.id))));

  // Asignar/transferir/devolver de forma OPTIMISTA: sacamos los pedidos de la
  // vista al instante y la llamada al API corre por detras (con rollback si
  // falla). Asi la accion se siente inmediata aunque el backend tarde ~1-2s.
  const handleAssign = useCallback(
    async (orderIds: string[], warehouseId: string | null, label: string) => {
      const ids = new Set(orderIds);
      const snapshots = queryClient.getQueriesData<ListOrdersResponse>({ queryKey: ['orders'] });
      queryClient.setQueriesData<ListOrdersResponse>({ queryKey: ['orders'] }, (old) => {
        if (!old) return old;
        const removed = old.items.filter((o) => ids.has(o.id)).length;
        if (removed === 0) return old;
        return {
          ...old,
          items: old.items.filter((o) => !ids.has(o.id)),
          total: Math.max(0, old.total - removed),
        };
      });
      setSelected(new Set());
      toast.success(`${orderIds.length} pedido(s) ${label}`);
      try {
        await api.post('/v1/orders/assign', { orderIds, warehouseId });
      } catch (err) {
        // Falló: revertir la vista a como estaba y avisar.
        snapshots.forEach(([key, data]) => queryClient.setQueryData(key, data));
        toast.error(err instanceof ApiError ? err.message : 'No se pudo completar la acción');
      } finally {
        // Reconciliar contadores/listas con el servidor (en segundo plano).
        queryClient.invalidateQueries({ queryKey: ['orders'] });
        queryClient.invalidateQueries({ queryKey: ['warehouses'] });
        queryClient.invalidateQueries({ queryKey: ['order-stats'] });
      }
    },
    [queryClient],
  );

  const sectionLabel = state === 'invoiced' ? 'Facturados' : 'Por preparar';
  const viewTitle =
    scope.kind === 'general' ? 'Pedidos generales' : `${scope.name} · ${sectionLabel}`;
  const crumbs =
    scope.kind === 'general' ? ['Pedidos', 'Generales'] : ['Sedes', scope.name, sectionLabel];

  return (
    <>
      {/* Encabezado de la vista (mockup): migas + titulo + chip "En vivo" al
          lado + rango en mono a la derecha, con un brillo cobalto sutil. */}
      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-8 -top-8 h-40 w-[540px] rounded-full bg-accent/[0.07] blur-3xl"
        />
        <nav className="relative mb-1.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          {crumbs.map((c, i) => (
            <Fragment key={`${c}-${i}`}>
              {i > 0 ? <span aria-hidden>·</span> : null}
              <span className={i === 0 ? 'font-medium' : undefined}>{c}</span>
            </Fragment>
          ))}
        </nav>
        <div className="relative flex flex-wrap items-center gap-3">
          <h1 className="text-[19px] font-semibold leading-tight tracking-[-0.02em]">{viewTitle}</h1>
          <LivePill live={live} />
          <HeaderRange
            live={live}
            lastUpdate={dataUpdatedAt}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            total={total}
          />
        </div>
      </div>

      {/* Pulso de la vista: 4 metricas operativas acordes a DONDE estas. */}
      <OrdersPulseRow
        scope={scope.kind === 'general' ? 'general' : state === 'invoiced' ? 'invoiced' : 'pending'}
        warehouseId={warehouseId}
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchFilter />
        <DateRangeFilter />
        {state === 'invoiced' && warehouseId ? <ShippingFilter /> : null}
        {state !== 'invoiced' ? <AddressFilter /> : null}
      </div>

      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* Mientras llega el resultado de un filtro/pagina nuevo se muestran los
              datos anteriores atenuados: se VE que esta aplicando. */}
          <div
            className={cn(
              'shadow-card overflow-hidden rounded-xl border border-border bg-card transition-opacity duration-150',
              isPlaceholderData && 'pointer-events-none opacity-50',
            )}
          >
            <OrdersTable
              items={items}
              sort={sort}
              dir={dir}
              onSort={handleSort}
              // En "Facturados" no se selecciona: esos pedidos ya no se transfieren
              // ni se devuelven (la factura quedo emitida contra la cuenta de la sede).
              selectedIds={canSelect ? selected : undefined}
              onToggleSelect={canSelect ? toggleSelect : undefined}
              onToggleSelectAll={canSelect ? toggleSelectAll : undefined}
              onOpenOrder={openFromRow}
              showShipping={state === 'invoiced'}
              // Confirmacion de direccion: en General y Por preparar (no en Facturados).
              showAddress={state !== 'invoiced'}
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
          onAssign={handleAssign}
        />
      ) : null}

      <OrderDrawer
        order={openOrder}
        onClose={() => setOpenOrder(null)}
        initialTab={openTab}
        focusMessageId={openMsg}
      />
    </>
  );
}

const SHIPPING_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'sin_movimientos', label: 'Sin movimientos' },
  { value: 'en_transito', label: 'En tránsito' },
  { value: 'novedad', label: 'Con novedad' },
  { value: 'entregado', label: 'Entregado' },
] as const;

/**
 * Filtro por estado del envio (Facturados). Vive en la URL (?shipping=). Mismo
 * diseno que DateRangeFilter: boton outline + popover con filas de radio.
 */
function ShippingFilter() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = searchParams.get('shipping') ?? '';
  const hasFilter = current !== '';
  const label = SHIPPING_OPTIONS.find((o) => o.value === current)?.label ?? 'Todos';

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const set = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set('shipping', value);
    else params.delete('shipping');
    params.delete('page');
    replaceUrlParams(pathname, params);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen((s) => !s)}
        className={cn('h-[34px] rounded-lg font-normal text-muted-foreground', hasFilter && 'border-accent/40')}
      >
        <Truck className="h-3.5 w-3.5 text-muted-foreground/70" />
        <span className="text-xs">
          Envío: <span className="font-semibold text-foreground">{label}</span>
        </span>
        {hasFilter ? (
          <span
            role="button"
            tabIndex={0}
            aria-label="Limpiar filtro"
            onClick={(e) => {
              e.stopPropagation();
              set('');
            }}
            className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-sm hover:bg-muted"
          >
            <X className="h-3 w-3" />
          </span>
        ) : null}
      </Button>

      {open ? (
        <div className="absolute left-0 top-full z-20 mt-2 w-56 overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
          <ul className="p-1.5">
            {SHIPPING_OPTIONS.map((o) => {
              const isActive = current === o.value;
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => set(o.value)}
                    className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
                  >
                    <span
                      className={cn(
                        'flex h-4 w-4 items-center justify-center rounded-full border',
                        isActive ? 'border-foreground' : 'border-muted-foreground/40',
                      )}
                    >
                      {isActive ? <span className="h-2 w-2 rounded-full bg-foreground" /> : null}
                    </span>
                    {o.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

const ADDRESS_OPTIONS = [
  { value: 'confirmed', label: 'Confirmada' },
  { value: 'modified', label: 'Modificada' },
  { value: 'pending', label: 'Sin responder' },
] as const;

/**
 * Filtro por confirmacion de direccion (General + Por preparar). MULTISELECT:
 * vive en la URL como lista (?address=confirmed,pending). Mismo diseno que
 * DateRangeFilter (boton outline + popover con filas), con checkbox cuadrado
 * porque se pueden combinar estados. El popover queda abierto entre clics.
 */
function AddressFilter() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = new Set(
    (searchParams.get('address') ?? '')
      .split(',')
      .filter((v) => ADDRESS_OPTIONS.some((o) => o.value === v)),
  );
  const hasFilter = selected.size > 0;
  const label =
    selected.size === 0
      ? 'Todas'
      : selected.size === 1
        ? (ADDRESS_OPTIONS.find((o) => selected.has(o.value))?.label ?? 'Todas')
        : `${selected.size} estados`;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const commit = (values: Set<string>) => {
    const params = new URLSearchParams(searchParams.toString());
    // Ordenar segun ADDRESS_OPTIONS para URLs estables/compartibles.
    const list = ADDRESS_OPTIONS.filter((o) => values.has(o.value)).map((o) => o.value);
    if (list.length > 0 && list.length < ADDRESS_OPTIONS.length) {
      params.set('address', list.join(','));
    } else {
      // Nada o todo seleccionado = sin filtro.
      params.delete('address');
    }
    params.delete('page');
    replaceUrlParams(pathname, params);
  };

  const toggle = (value: string) => {
    const next = new Set(selected);
    next.has(value) ? next.delete(value) : next.add(value);
    commit(next);
  };

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen((s) => !s)}
        className={cn('h-[34px] rounded-lg font-normal text-muted-foreground', hasFilter && 'border-accent/40')}
      >
        <MapPin className="h-3.5 w-3.5 text-muted-foreground/70" />
        <span className="text-xs">
          Dirección: <span className="font-semibold text-foreground">{label}</span>
        </span>
        {hasFilter ? (
          <span
            role="button"
            tabIndex={0}
            aria-label="Limpiar filtro"
            onClick={(e) => {
              e.stopPropagation();
              commit(new Set());
              setOpen(false);
            }}
            className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-sm hover:bg-muted"
          >
            <X className="h-3 w-3" />
          </span>
        ) : null}
      </Button>

      {open ? (
        <div className="absolute left-0 top-full z-20 mt-2 w-56 overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
          <ul className="p-1.5">
            <li>
              <button
                type="button"
                onClick={() => {
                  commit(new Set());
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
              >
                <span
                  className={cn(
                    'flex h-4 w-4 items-center justify-center rounded-full border',
                    !hasFilter ? 'border-foreground' : 'border-muted-foreground/40',
                  )}
                >
                  {!hasFilter ? <span className="h-2 w-2 rounded-full bg-foreground" /> : null}
                </span>
                Todas
              </button>
            </li>
            {ADDRESS_OPTIONS.map((o) => {
              const isActive = selected.has(o.value);
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => toggle(o.value)}
                    className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
                  >
                    <span
                      className={cn(
                        'flex h-4 w-4 items-center justify-center rounded border',
                        isActive
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-muted-foreground/40',
                      )}
                    >
                      {isActive ? <Check className="h-3 w-3" /> : null}
                    </span>
                    {o.label}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            Puedes combinar varios estados
          </div>
        </div>
      ) : null}
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
  onAssign,
}: {
  scope: OrdersScope;
  warehouses: WarehouseSummary[];
  selectedIds: string[];
  onClear: () => void;
  onAssign: (orderIds: string[], warehouseId: string | null, label: string) => void;
}) {
  const targets = useMemo(
    () => warehouses.filter((w) => !(scope.kind === 'warehouse' && w.id === scope.id)),
    [warehouses, scope],
  );

  // En movil la barra se levanta por encima de la navegacion inferior.
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 md:bottom-6">
      <div className="shadow-pop pointer-events-auto flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] border border-border bg-popover px-3 py-[9px]">
        <span className="text-[12.5px] font-medium tabular-nums">
          {selectedIds.length} seleccionado{selectedIds.length === 1 ? '' : 's'}
        </span>
        <div className="h-5 w-px bg-border" />

        {scope.kind === 'warehouse' ? (
          <Button variant="outline" size="sm" onClick={() => onAssign(selectedIds, null, 'devueltos a generales')}>
            <Undo2 className="h-3.5 w-3.5" />
            Devolver a generales
          </Button>
        ) : null}

        {targets.length > 0 ? (
          <WarehousePicker
            label={scope.kind === 'warehouse' ? 'Transferir a' : 'Asignar a sede'}
            warehouses={targets}
            onPick={(w) =>
              onAssign(
                selectedIds,
                w.id,
                scope.kind === 'warehouse' ? `transferidos a ${w.name}` : `asignados a ${w.name}`,
              )
            }
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
  onPick,
}: {
  label: string;
  warehouses: WarehouseSummary[];
  onPick: (w: WarehouseSummary) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button size="sm" onClick={() => setOpen((s) => !s)}>
        <Building2 className="h-3.5 w-3.5" />
        {label}
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? '-rotate-90' : 'rotate-90'}`} />
      </Button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <ul className="shadow-pop absolute bottom-full left-0 z-20 mb-2 max-h-64 w-56 overflow-auto rounded-lg border border-border bg-popover p-1">
            {warehouses.map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onPick(w);
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent/10"
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

/** Chip "En vivo" del encabezado (pill esmeralda con punto que emite ondas). */
function LivePill({ live }: { live: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium',
        live
          ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
          : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
      )}
    >
      <span className="relative inline-flex h-1.5 w-1.5" aria-hidden>
        <span className="absolute inline-flex h-full w-full rounded-full bg-current" />
        {live ? (
          <span className="absolute -inset-0.5 animate-ping rounded-full bg-current opacity-40" />
        ) : null}
      </span>
      {live ? 'En vivo' : 'Reconectando'}
    </span>
  );
}

/** Rango + frescura, a la derecha del titulo, en mono (mockup). */
function HeaderRange({
  live,
  lastUpdate,
  rangeStart,
  rangeEnd,
  total,
}: {
  live: boolean;
  lastUpdate: number;
  rangeStart: number;
  rangeEnd: number;
  total: number;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  const secondsAgo = Math.max(0, Math.floor((now - lastUpdate) / 1000));

  return (
    <span className="ml-auto hidden font-mono text-[11.5px] tabular-nums text-muted-foreground md:block">
      {total > 0
        ? `${rangeStart}–${rangeEnd} de ${total} ${total === 1 ? 'pedido' : 'pedidos'} · `
        : ''}
      {live ? `sincronizado hace ${secondsAgo} s` : `reconectando · hace ${secondsAgo} s`}
    </span>
  );
}
