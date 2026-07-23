'use client';

import { Fragment, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns/format';
import { es } from 'date-fns/locale/es';
import { Camera, ChevronDown, ChevronRight, ChevronsUpDown, Package } from 'lucide-react';
import type { OrderSummary, OrderSortField, SortDir } from '@smartlogistica/shared';

import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

import { prefetchOrder } from './order-queries';

interface OrdersTableProps {
  items: OrderSummary[];
  sort: OrderSortField;
  dir: SortDir;
  onSort: (field: OrderSortField) => void;
  // Seleccion (opcional). Si se pasa selectedIds, se muestra la columna de checks.
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleSelectAll?: () => void;
  // Abrir el drawer del pedido (click en la fila).
  onOpenOrder?: (order: OrderSummary) => void;
  /** Muestra la columna "Envio" (estado del rastreo). Solo en Facturados. */
  showShipping?: boolean;
  /** Muestra la columna "Direccion" (confirmacion por WhatsApp). General + Por preparar. */
  showAddress?: boolean;
}

export function OrdersTable({
  items,
  sort,
  dir,
  onSort,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onOpenOrder,
  showShipping = false,
  showAddress = false,
}: OrdersTableProps) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const selectable = Boolean(selectedIds && onToggleSelect);
  const colCount = (selectable ? 8 : 7) + (showShipping ? 1 : 0) + (showAddress ? 1 : 0);
  const allSelected = selectable && items.length > 0 && items.every((o) => selectedIds!.has(o.id));

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <>
      {/* Movil: lista de tarjetas (la tabla no cabe). */}
      <div className="flex flex-col divide-y divide-border md:hidden">
        {items.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            selectable={selectable}
            selected={selectable && selectedIds!.has(order.id)}
            onToggleSelect={onToggleSelect}
            onOpenOrder={onOpenOrder}
            showShipping={showShipping}
            showAddress={showAddress}
            onPrefetch={() => onOpenOrder && prefetchOrder(qc, order.id)}
          />
        ))}
      </div>

      {/* Escritorio: tabla completa. */}
      <div className="hidden md:block">
        <Table>
      <TableHeader>
        <TableRow>
          {selectable ? (
            <TableHead className="w-10">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer rounded border-input accent-foreground"
                checked={allSelected}
                onChange={() => onToggleSelectAll?.()}
                aria-label="Seleccionar todos"
              />
            </TableHead>
          ) : null}
          <TableHead>N&ordm; Pedido</TableHead>
          <TableHead>Cliente</TableHead>
          <TableHead>Producto</TableHead>
          <SortHeader label="Cantidad" field="quantity" sort={sort} dir={dir} onSort={onSort} align="right" />
          <SortHeader label="Precio de venta" field="price" sort={sort} dir={dir} onSort={onSort} align="right" />
          <SortHeader label="Fecha" field="date" sort={sort} dir={dir} onSort={onSort} />
          <TableHead>Estado</TableHead>
          {showAddress ? <TableHead>Dirección</TableHead> : null}
          {showShipping ? <TableHead>Envío</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((order) => {
          const multi = order.items.length > 1;
          const isOpen = expanded.has(order.id);
          const isSelected = selectable && selectedIds!.has(order.id);
          return (
            <Fragment key={order.id}>
              <TableRow
                className={cn(
                  (onOpenOrder || multi) && 'cursor-pointer',
                  (isOpen || isSelected) && 'bg-muted/30',
                )}
                onClick={
                  onOpenOrder
                    ? () => onOpenOrder(order)
                    : multi
                      ? () => toggle(order.id)
                      : undefined
                }
                // Precarga la conversacion antes del clic: al abrir, el chat ya
                // esta en cache y se pinta al instante (sin "cargando").
                onMouseEnter={onOpenOrder ? () => prefetchOrder(qc, order.id) : undefined}
                onFocus={onOpenOrder ? () => prefetchOrder(qc, order.id) : undefined}
              >
                {selectable ? (
                  <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 cursor-pointer rounded border-input accent-foreground"
                      checked={isSelected}
                      onChange={() => onToggleSelect!(order.id)}
                      aria-label={`Seleccionar ${order.externalId}`}
                    />
                  </TableCell>
                ) : null}
                <TableCell className="whitespace-nowrap font-mono text-xs">
                  <span className="inline-flex items-center gap-1.5">
                    {order.externalId}
                    {order.hasDevicePhoto ? (
                      <span
                        title="Tiene foto de IMEI/serial"
                        className="text-emerald-600 dark:text-emerald-400"
                      >
                        <Camera className="h-3.5 w-3.5" />
                      </span>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="flex items-center gap-1.5 font-medium text-foreground">
                      {order.customerName}
                      {order.unreadCount > 0 ? (
                        <span
                          title={`${order.unreadCount} mensaje(s) sin leer`}
                          className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
                        >
                          {order.unreadCount > 99 ? '99+' : order.unreadCount}
                        </span>
                      ) : null}
                    </span>
                    {order.customerDocument ? (
                      <span className="text-[11px] text-muted-foreground">{order.customerDocument}</span>
                    ) : null}
                  </div>
                </TableCell>

                {/* Producto: 1 -> nombre; varios -> primero + "+N" con chevron.
                    El nombre SIEMPRE se muestra completo (envuelve en lineas). */}
                <TableCell className="min-w-[200px] max-w-[340px] align-top">
                  <ProductCell
                    order={order}
                    multi={multi}
                    isOpen={isOpen}
                    onToggle={() => toggle(order.id)}
                  />
                </TableCell>

                {/* Cantidad: unidades totales + cuantos productos distintos */}
                <TableCell className="text-right">
                  <div className="flex flex-col items-end leading-tight">
                    <span className="font-medium tabular-nums">{order.totalUnits}</span>
                    {multi ? (
                      <span className="text-[11px] text-muted-foreground">
                        {order.items.length} productos
                      </span>
                    ) : null}
                  </div>
                </TableCell>

                <TableCell className="text-right font-mono tabular-nums">
                  {formatCurrency(order.totalValue, order.currency)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  <div className="flex flex-col leading-tight">
                    <span>{format(new Date(order.marketplaceCreatedAt), 'd MMM yyyy', { locale: es })}</span>
                    <span className="text-[11px]">
                      {format(new Date(order.marketplaceCreatedAt), 'HH:mm')}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge status={order.status} />
                </TableCell>
                {showAddress ? (
                  <TableCell>
                    <AddressCell order={order} />
                  </TableCell>
                ) : null}
                {showShipping ? (
                  <TableCell>
                    <ShippingCell order={order} />
                  </TableCell>
                ) : null}
              </TableRow>

              {/* Sub-fila expandible con el desglose de productos */}
              {multi && isOpen ? (
                <TableRow className="bg-muted/20 hover:bg-muted/20">
                  <TableCell colSpan={colCount} className="py-0">
                    <div className="ml-[2px] border-l-2 border-border py-2 pl-4">
                      <div className="overflow-hidden rounded-lg border border-border bg-background">
                        {order.items.map((item, idx) => (
                          <div
                            key={`${item.sku}-${idx}`}
                            className={cn(
                              'flex items-center gap-3 px-3 py-2 text-sm',
                              idx > 0 && 'border-t border-border',
                            )}
                          >
                            <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium">{item.name}</p>
                              <p className="font-mono text-[11px] text-muted-foreground">{item.sku}</p>
                            </div>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {item.quantity} &times; {formatCurrency(item.unitPrice, order.currency)}
                            </span>
                            <span className="w-28 shrink-0 text-right font-mono tabular-nums">
                              {formatCurrency(lineTotal(item.unitPrice, item.quantity), order.currency)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              ) : null}
            </Fragment>
          );
        })}
      </TableBody>
        </Table>
      </div>
    </>
  );
}

/**
 * Tarjeta de un pedido para la vista movil (la tabla no cabe en pantalla chica).
 * Reusa los mismos badges/formatos. Tocar la tarjeta abre el drawer; el checkbox
 * (en modo seleccion) alterna la seleccion sin abrirlo.
 */
function OrderCard({
  order,
  selectable,
  selected,
  onToggleSelect,
  onOpenOrder,
  showShipping,
  showAddress,
  onPrefetch,
}: {
  order: OrderSummary;
  selectable: boolean;
  selected: boolean;
  onToggleSelect?: (id: string) => void;
  onOpenOrder?: (order: OrderSummary) => void;
  showShipping: boolean;
  showAddress: boolean;
  onPrefetch: () => void;
}) {
  const first = order.items[0];
  const extra = order.items.length - 1;
  return (
    <button
      type="button"
      onClick={() => (onOpenOrder ? onOpenOrder(order) : onToggleSelect?.(order.id))}
      onTouchStart={onPrefetch}
      className={cn(
        'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors active:bg-muted/50',
        selected && 'bg-muted/40',
      )}
    >
      {selectable ? (
        <span onClick={(e) => e.stopPropagation()} className="pt-0.5">
          <input
            type="checkbox"
            className="h-4 w-4 cursor-pointer rounded border-input accent-foreground"
            checked={selected}
            onChange={() => onToggleSelect!(order.id)}
            aria-label={`Seleccionar ${order.externalId}`}
          />
        </span>
      ) : null}

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            <span className="truncate">{order.externalId}</span>
            {order.hasDevicePhoto ? (
              <Camera className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : null}
          </span>
          <StatusBadge status={order.status} />
        </div>

        <div className="mt-1 flex items-center gap-1.5">
          <span className="truncate font-medium text-foreground">{order.customerName}</span>
          {order.unreadCount > 0 ? (
            <span className="inline-flex h-4 min-w-[1rem] shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
              {order.unreadCount > 99 ? '99+' : order.unreadCount}
            </span>
          ) : null}
        </div>

        {first ? (
          <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
            {first.name}
            {extra > 0 ? <span className="text-muted-foreground"> +{extra}</span> : null}
          </p>
        ) : null}

        <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="tabular-nums">
            {order.totalUnits} un &middot;{' '}
            <span className="font-medium text-foreground">
              {formatCurrency(order.totalValue, order.currency)}
            </span>
          </span>
          <span className="shrink-0 tabular-nums">
            {format(new Date(order.marketplaceCreatedAt), "d MMM '·' HH:mm", { locale: es })}
          </span>
        </div>

        {showAddress ? (
          <div className="mt-2">
            <AddressCell order={order} />
          </div>
        ) : null}

        {showShipping && order.guideNumber ? (
          <div className="mt-2">
            <ShippingCell order={order} />
          </div>
        ) : null}
      </div>
    </button>
  );
}

function ProductCell({
  order,
  multi,
  isOpen,
  onToggle,
}: {
  order: OrderSummary;
  multi: boolean;
  isOpen: boolean;
  onToggle: () => void;
}) {
  if (order.items.length === 0) {
    return <span className="text-muted-foreground">&mdash;</span>;
  }
  const first = order.items[0]!;
  if (!multi) {
    return <span className="block break-words leading-snug">{first.name}</span>;
  }
  return (
    <div className="flex items-start gap-1.5">
      {/* El chevron alterna el desglose inline sin abrir el drawer de la fila. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="mt-0.5 shrink-0 rounded text-muted-foreground hover:text-foreground"
        aria-label={isOpen ? 'Ocultar productos' : 'Ver productos'}
      >
        {isOpen ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
      </button>
      <span className="break-words leading-snug">{first.name}</span>
      <Badge variant="secondary" className="mt-0.5 shrink-0">
        +{order.items.length - 1}
      </Badge>
    </div>
  );
}

function SortHeader({
  label,
  field,
  sort,
  dir,
  onSort,
  align = 'left',
}: {
  label: string;
  field: OrderSortField;
  sort: OrderSortField;
  dir: SortDir;
  onSort: (field: OrderSortField) => void;
  align?: 'left' | 'right';
}) {
  const active = sort === field;
  return (
    <TableHead className={cn('whitespace-nowrap', align === 'right' && 'text-right')}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          // text-transform/letter-spacing NO se heredan en <button> (preflight de
          // Tailwind), por eso los repetimos para que sea simetrico con los <th>.
          'inline-flex items-center gap-1 rounded text-[11px] font-medium uppercase tracking-wide transition-colors hover:text-foreground',
          align === 'right' && 'flex-row-reverse',
          active ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {label}
        {active ? (
          <ChevronDown
            className={cn('h-3.5 w-3.5 transition-transform', dir === 'asc' && 'rotate-180')}
          />
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
        )}
      </button>
    </TableHead>
  );
}

/** Etiquetas del estado de envio (rastreo Coordinadora). */
export const SHIPPING_LABELS: Record<
  string,
  { label: string; variant: 'warning' | 'success' | 'secondary' | 'outline' }
> = {
  entregado: { label: 'Entregado', variant: 'success' },
  novedad: { label: 'Novedad', variant: 'warning' },
  en_transito: { label: 'En transito', variant: 'secondary' },
  sin_movimientos: { label: 'Sin movimientos', variant: 'outline' },
};

const SHIPPING_FALLBACK = { label: 'Sin movimientos', variant: 'outline' } as const;

function ShippingCell({ order }: { order: OrderSummary }) {
  if (!order.guideNumber) {
    return <span className="text-xs text-muted-foreground">Sin guia</span>;
  }
  const meta = SHIPPING_LABELS[order.shippingState ?? 'sin_movimientos'] ?? SHIPPING_FALLBACK;
  const detail = order.shippingStatus?.trim();
  return (
    <div className="flex flex-col items-start gap-0.5">
      <Badge variant={meta.variant} className="whitespace-nowrap">
        {meta.label}
      </Badge>
      {detail && detail !== meta.label ? (
        <span className="max-w-[160px] truncate text-[11px] text-muted-foreground" title={detail}>
          {detail}
        </span>
      ) : null}
      <span className="font-mono text-[10px] text-muted-foreground">{order.guideNumber}</span>
    </div>
  );
}

/** Estado de confirmacion de direccion (respuesta del cliente por WhatsApp). */
export const ADDRESS_LABELS: Record<
  string,
  { label: string; variant: 'success' | 'warning' | 'outline' }
> = {
  confirmed: { label: 'Confirmada', variant: 'success' },
  modified: { label: 'Modificada', variant: 'warning' },
};

const ADDRESS_FALLBACK = { label: 'Confirmada', variant: 'success' } as const;

function AddressCell({ order }: { order: OrderSummary }) {
  if (!order.addressStatus) {
    return <Badge variant="outline" className="whitespace-nowrap text-muted-foreground">Sin responder</Badge>;
  }
  const meta = ADDRESS_LABELS[order.addressStatus] ?? ADDRESS_FALLBACK;
  // Solo el estado en la tabla; la direccion nueva se ve en el drawer del pedido.
  return (
    <Badge variant={meta.variant} className="whitespace-nowrap">
      {meta.label}
    </Badge>
  );
}

const STATUS_LABELS: Record<string, { label: string; variant: 'warning' | 'success' | 'secondary' }> = {
  'ready-for-handling': { label: 'Listo para preparar', variant: 'warning' },
  handling: { label: 'Preparando', variant: 'success' },
  invoiced: { label: 'Facturado', variant: 'success' },
  'window-to-cancel': { label: 'En ventana de cancelación', variant: 'secondary' },
  canceled: { label: 'Cancelado', variant: 'secondary' },
};

function StatusBadge({ status }: { status: string }) {
  const mapped = STATUS_LABELS[status];
  return (
    <Badge variant={mapped?.variant ?? 'secondary'} className="whitespace-nowrap">
      {mapped?.label ?? status}
    </Badge>
  );
}

function lineTotal(unitPrice: string, quantity: number): string {
  const n = Number(unitPrice) * quantity;
  return Number.isNaN(n) ? unitPrice : n.toFixed(2);
}

function formatCurrency(value: string, currency: string): string {
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(num);
  } catch {
    return `${currency} ${num.toLocaleString('es-CO')}`;
  }
}
