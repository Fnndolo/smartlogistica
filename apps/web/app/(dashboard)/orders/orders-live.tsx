'use client';

import { useSearchParams, usePathname } from 'next/navigation';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Check, ChevronLeft, ChevronRight, MapPin, Package, PackagePlus, Search, Truck, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';
import type {
  ListOrdersResponse,
  OrderSortField,
  OrderSummary,
  SortDir,
  WarehouseSummary,
} from '@smartlogistica/shared';

import { useCurrentUser } from '@/components/providers/current-user-provider';
import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api-client';
import { canTransferOrders } from '@/lib/rbac';
import { cn, replaceUrlParams } from '@/lib/utils';

import { OrdersTable } from './orders-table';
import { OrderDrawer } from './order-drawer';
import { EmptyState } from './empty-state';
import { DateRangeFilter } from './date-range-filter';
import { MountOrderDialog } from './mount-order-dialog';
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
  const me = useCurrentUser();
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const from = searchParams.get('from') ?? undefined;
  const to = searchParams.get('to') ?? undefined;
  const q = searchParams.get('q') ?? undefined;
  const shipping = searchParams.get('shipping') ?? undefined;
  const address = searchParams.get('address') ?? undefined;
  const product = searchParams.get('product') ?? undefined;
  const sort = parseSort(searchParams.get('sort'));
  const dir = parseDir(searchParams.get('dir'));
  const warehouseId = scope.kind === 'warehouse' ? scope.id : undefined;

  const queryKey = [
    'orders',
    { scope: warehouseId ?? 'general', state, shipping, address, product, page, from, to, q, sort, dir },
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
      if (product) params.set('product', product);
      return api.get<ListOrdersResponse>(`/v1/orders?${params.toString()}`);
    },
    // Solo la clave inicial recibe el initialData del SSR (ver mountKey arriba).
    initialData: () => (JSON.stringify(queryKey) === mountKey ? initialData : undefined),
    // Mantener los resultados anteriores mientras carga la nueva busqueda/pagina
    // -> la tabla no parpadea a vacio (se siente fluido al escribir).
    placeholderData: keepPreviousData,
    // SIEMPRE refetch al montar: el initialData del SSR puede venir del cache
    // del router de Next (los <Link prefetch> guardan la pagina hasta 5 min).
    // Sin esto, al transferir un pedido y navegar a la sede se veia la lista
    // VIEJA hasta el poll de 20s (parecia que "no llegaba" sin F5). Se pinta
    // lo sembrado al instante y el refetch corrige en milisegundos.
    refetchOnMount: 'always',
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
  }, [page, q, from, to, sort, dir, warehouseId, shipping, address, product]);

  // Pedido abierto en el drawer (click en la fila). La conversacion es SIEMPRE
  // la primera pestaña.
  const [openOrder, setOpenOrder] = useState<OrderSummary | null>(null);
  const [openTab, setOpenTab] = useState<'detalle' | 'conversacion'>('conversacion');
  // Mensaje al que hay que SALTAR al abrir (deep-link de una mencion).
  const [openMsg, setOpenMsg] = useState<string | null>(null);
  // "Montar pedido" (solo en la sede · Por preparar): pedido externo a mano.
  const [mounting, setMounting] = useState(false);

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

  // Cada evento SSE -> refetch de la pagina actual. El PRIMER evento refresca
  // AL INSTANTE (una transferencia/asignacion se pinta ya en la sede destino);
  // solo las RAFAGAS (ej: 100 upserts durante un backfill) se coalescen con el
  // debounce. Antes TODO esperaba el debounce y la transferencia se sentia lenta.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefetchRef = useRef(0);
  const handleStreamEvent = useCallback(
    (event?: { kind: string }) => {
      // "esta escribiendo" es efimero, las reacciones a mensajes no tocan la
      // lista y los mensajes de WHATSAPP viven en su propia pestaña: cero
      // refetch de la tabla por ellos.
      if (
        event?.kind === 'chat.typing' ||
        event?.kind === 'chat.reaction' ||
        event?.kind === 'wa.message'
      )
        return;
      const chatOnly = event?.kind === 'chat.message';
      const run = () => {
        lastRefetchRef.current = Date.now();
        // chat.message solo afecta el badge de no leidos -> solo la lista.
        queryClient.invalidateQueries({ queryKey: ['orders'] });
        if (!chatOnly) {
          queryClient.invalidateQueries({ queryKey: ['order-stats'] });
          queryClient.invalidateQueries({ queryKey: ['orders-pulse'] });
        }
      };
      // Borde de ATAQUE: si llevamos un rato quietos, este evento es una accion
      // puntual -> refetch YA. Lo que llegue enseguida se coalesce (debounce).
      if (Date.now() - lastRefetchRef.current > 1_000) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        run();
        return;
      }
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(run, SSE_DEBOUNCE_MS);
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
  // La seleccion existe SOLO para mover pedidos entre sedes, y eso lo hace
  // unicamente un administrador (el gestor trabaja el pedido donde esta). Sin
  // ese permiso no se pintan ni las casillas: no habria nada que hacer con ellas.
  // Y en "Facturados" tampoco se selecciona: ya se cerro en VTEX.
  const canTransfer = canTransferOrders(me?.role);
  const canSelect = state !== 'invoiced' && canTransfer;
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

  // Asignar/transferir/devolver de forma OPTIMISTA: los pedidos SALEN de esta
  // vista al instante y ademas ENTRAN ya a la cache de la sede destino — al
  // navegar alla estan pintados sin esperar ni al API ni al SSE. La llamada
  // corre por detras (con rollback si falla).
  const handleAssign = useCallback(
    async (orderIds: string[], destId: string | null, label: string) => {
      const ids = new Set(orderIds);
      const snapshots = queryClient.getQueriesData<ListOrdersResponse>({ queryKey: ['orders'] });
      const nowIso = new Date().toISOString();
      // Copias ya "movidas" (para sembrar la vista destino).
      const moving = items
        .filter((o) => ids.has(o.id))
        .map((o) => ({ ...o, warehouseId: destId, assignedAt: destId ? nowIso : null }));

      for (const [key, data] of snapshots) {
        if (!data) continue;
        const filters = (key as [string, Record<string, unknown> | undefined])[1];
        // ¿Esta cache es la sede DESTINO (Por preparar, pagina 1 sin filtros)?
        // Ahi los pedidos se AGREGAN arriba (el refetch ordena en un momento).
        const isDestSeed =
          destId !== null &&
          filters?.scope === destId &&
          filters?.state !== 'invoiced' &&
          (filters?.page ?? 1) === 1 &&
          !filters?.q &&
          !filters?.product;
        if (isDestSeed && moving.length > 0) {
          queryClient.setQueryData<ListOrdersResponse>(key, {
            ...data,
            items: [...moving, ...data.items.filter((o) => !ids.has(o.id))],
            total: data.total + moving.filter((m) => !data.items.some((o) => o.id === m.id)).length,
          });
          continue;
        }
        const removed = data.items.filter((o) => ids.has(o.id)).length;
        if (removed > 0) {
          queryClient.setQueryData<ListOrdersResponse>(key, {
            ...data,
            items: data.items.filter((o) => !ids.has(o.id)),
            total: Math.max(0, data.total - removed),
          });
        }
      }
      setSelected(new Set());
      toast.success(`${orderIds.length} pedido(s) ${label}`);
      try {
        await api.post('/v1/orders/assign', { orderIds, warehouseId: destId });
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
    [queryClient, items],
  );

  const sectionLabel = state === 'invoiced' ? 'Facturados' : 'Por preparar';
  // Generales + invoiced = pedidos FACTURADOS POR FUERA de SmartLogistica
  // (trazabilidad: sin envio, sin facturar/guia).
  const externalView = scope.kind === 'general' && state === 'invoiced';
  const viewTitle =
    scope.kind === 'general'
      ? externalView
        ? 'Generales · Facturados'
        : 'Pedidos generales'
      : `${scope.name} · ${sectionLabel}`;
  const crumbs =
    scope.kind === 'general'
      ? ['Pedidos', externalView ? 'Facturados' : 'Generales']
      : ['Sedes', scope.name, sectionLabel];

  return (
    <>
      {/* Encabezado de la vista (mockup): migas + titulo + chip "En vivo" al
          lado + rango en mono a la derecha, con un brillo cobalto sutil. */}
      <div className="relative">
        {/* w-full max-w: el brillo NUNCA es mas ancho que la pantalla (en cel
            un ancho fijo creaba paneo horizontal de toda la pagina). */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-8 left-0 h-40 w-full max-w-[540px] rounded-full bg-accent/[0.07] blur-3xl"
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

      {/* Pulso de la vista: 4 metricas operativas acordes a DONDE estas. En la
          vista de facturados por fuera no aplica (es solo trazabilidad). */}
      {!externalView ? (
        <OrdersPulseRow
          scope={scope.kind === 'general' ? 'general' : state === 'invoiced' ? 'invoiced' : 'pending'}
          warehouseId={warehouseId}
        />
      ) : (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-[12.5px] text-amber-700 dark:text-amber-400">
          Estos pedidos fueron facturados <b>por fuera de SmartLogística</b> (cerrados directo en
          VTEX). Quedan como trazabilidad: sin seguimiento de envío y sin facturar ni generar guía.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <SearchFilter />
        <DateRangeFilter />
        <ProductFilter warehouseId={warehouseId} state={state} />
        {state === 'invoiced' && warehouseId ? <ShippingFilter /> : null}
        {state !== 'invoiced' ? <AddressFilter /> : null}
        {/* Montar pedido: SOLO en la sede (Por preparar) — pedidos externos a
            las plataformas, escritos a mano (sin MKT: solo factura y guia). */}
        {scope.kind === 'warehouse' && state !== 'invoiced' ? (
          <Button size="sm" onClick={() => setMounting(true)} className="ml-auto h-[34px] rounded-lg">
            <PackagePlus className="h-3.5 w-3.5" />
            Montar pedido
          </Button>
        ) : null}
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
              // Envio SOLO en Facturados de sede (los facturados por fuera no
              // tienen guia ni rastreo).
              showShipping={state === 'invoiced' && scope.kind === 'warehouse'}
              // Confirmacion de direccion: en General y Por preparar (no en Facturados).
              showAddress={state !== 'invoiced'}
              // Plataforma (VTEX / Krediya / Mercado Libre...): solo en la sede.
              showPlatform={scope.kind === 'warehouse'}
            />
          </div>

          {totalPages > 1 ? (
            <Pagination page={page} totalPages={totalPages} onChange={goToPage} />
          ) : null}
        </>
      )}

      {canTransfer && selected.size > 0 ? (
        <AssignmentBar
          scope={scope}
          warehouses={warehouses}
          selectedIds={[...selected]}
          // Los MONTADOS a mano nunca estuvieron en generales: si hay alguno en
          // la seleccion, "Devolver a generales" ni se ofrece.
          canReturn={!items.some((o) => selected.has(o.id) && o.provider === 'manual')}
          onClear={() => setSelected(new Set())}
          onAssign={handleAssign}
        />
      ) : null}

      {mounting && scope.kind === 'warehouse' ? (
        <MountOrderDialog
          warehouseId={scope.id}
          warehouseName={scope.name}
          onClose={() => setMounting(false)}
          onCreated={(order) => {
            setMounting(false);
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            queryClient.invalidateQueries({ queryKey: ['orders-pulse'] });
            queryClient.invalidateQueries({ queryKey: ['warehouses'] });
            // Abrir el pedido recien montado directo en el drawer.
            openFromRow(order);
          }}
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

/**
 * Filtro por PRODUCTO. Vive en la URL (?product=). Popover con buscador y
 * sugerencias REALES de la vista (nombres distintos de items via el API);
 * tambien acepta texto libre con Enter (match "contiene", sin mayusculas).
 */
function ProductFilter({
  warehouseId,
  state,
}: {
  warehouseId: string | undefined;
  /** Etapa de la vista: las sugerencias se recortan a lo que esa pestaña muestra. */
  state: 'pending' | 'invoiced' | undefined;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  // En movil el boton puede quedar cerca del borde derecho: el popover (320px)
  // se ancla al lado que SI cabe (el body corta todo paneo horizontal).
  const [alignRight, setAlignRight] = useState(false);
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const current = searchParams.get('product') ?? '';
  const hasFilter = current !== '';

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  const stage = state === 'invoiced' ? 'invoiced' : 'pending';
  const { data: options = [], isFetching } = useQuery({
    queryKey: ['product-options', warehouseId ?? 'general', stage, debounced],
    queryFn: () => {
      const params = new URLSearchParams();
      if (warehouseId) params.set('warehouse', warehouseId);
      params.set('state', stage);
      if (debounced) params.set('q', debounced);
      return api.get<string[]>(`/v1/orders/products?${params.toString()}`);
    },
    enabled: open,
    staleTime: 30_000,
  });

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
    if (value) params.set('product', value);
    else params.delete('product');
    params.delete('page');
    replaceUrlParams(pathname, params);
    setOpen(false);
    setTerm('');
  };

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="outline"
        size="sm"
        onClick={(e) => {
          // ¿Cabe el popover (320px) hacia la derecha del boton? Si no, se
          // ancla a la derecha (crece hacia la izquierda) para no cortarse.
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setAlignRight(r.left + 320 > window.innerWidth - 12);
          setOpen((s) => !s);
        }}
        className={cn('h-[34px] rounded-lg font-normal text-muted-foreground', hasFilter && 'border-accent/40')}
      >
        <Package className="h-3.5 w-3.5 text-muted-foreground/70" />
        <span className="text-xs">
          Producto:{' '}
          <span className="max-w-[140px] truncate align-bottom font-semibold text-foreground inline-block">
            {hasFilter ? current : 'Todos'}
          </span>
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
        <div
          className={cn(
            'absolute top-full z-20 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-popover shadow-lg',
            alignRight ? 'right-0' : 'left-0',
          )}
        >
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={term}
              maxLength={160}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && term.trim()) set(term.trim().slice(0, 160));
              }}
              placeholder="Buscar producto..."
              className="h-7 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <ul className="max-h-64 overflow-auto p-1.5">
            {isFetching && options.length === 0 ? (
              <li className="px-2.5 py-2 text-xs text-muted-foreground">Buscando...</li>
            ) : options.length === 0 ? (
              <li className="px-2.5 py-2 text-xs text-muted-foreground">
                Sin productos que coincidan.
              </li>
            ) : (
              options.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    onClick={() => set(name)}
                    className={cn(
                      'w-full break-words rounded-md px-2.5 py-2 text-left text-sm leading-snug transition-colors hover:bg-muted',
                      current === name && 'bg-accent/10 font-medium',
                    )}
                  >
                    {name}
                  </button>
                </li>
              ))
            )}
          </ul>
          <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            Enter aplica el texto tal cual (busca por «contiene»)
          </div>
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
  canReturn = true,
  onClear,
  onAssign,
}: {
  scope: OrdersScope;
  warehouses: WarehouseSummary[];
  selectedIds: string[];
  /** false si la seleccion incluye pedidos montados a mano (no van a generales). */
  canReturn?: boolean;
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

        {scope.kind === 'warehouse' && canReturn ? (
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
