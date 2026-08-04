'use client';

import { Fragment, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns/format';
import { es } from 'date-fns/locale/es';
import {
  Camera,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Hand,
  MoreHorizontal,
  Package,
  SmilePlus,
} from 'lucide-react';
import type { OrderSummary, OrderSortField, SortDir } from '@smartlogistica/shared';

import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn, titleCaseName } from '@/lib/utils';

import { ClaimChip, ClaimSlot, initialsOf } from './claim-chip';
import { EmojiPicker } from './emoji-picker';
import { prefetchOrder } from './order-queries';
import { useOrderActions } from './use-order-actions';

/** Menu contextual de la fila (tomar/soltar) o picker de reacciones, anclado al boton. */
type RowMenu = { kind: 'claim' | 'react'; order: OrderSummary; x: number; y: number };

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
  const [menu, setMenu] = useState<RowMenu | null>(null);
  const actions = useOrderActions();
  const selectable = Boolean(selectedIds && onToggleSelect);
  const colCount = (selectable ? 8 : 7) + (showShipping ? 1 : 0) + (showAddress ? 1 : 0);
  const allSelected = selectable && items.length > 0 && items.every((o) => selectedIds!.has(o.id));

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const openMenu = (kind: RowMenu['kind']) => (order: OrderSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ kind, order, x: r.left + r.width / 2, y: kind === 'react' ? r.top : r.bottom });
  };

  // El hueco de la ficha "tomado" solo se reserva si ALGUN pedido de la pagina
  // esta tomado (asi la tabla no gana ancho cuando nadie ha tomado nada).
  const anyClaimed = items.some((o) => o.claimedBy);

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
            onClaim={openMenu('claim')}
            onReact={openMenu('react')}
            onToggleReaction={actions.toggleReaction}
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
                className="block h-[15px] w-[15px] cursor-pointer rounded-[4px] border-input accent-accent"
                checked={allSelected}
                onChange={() => onToggleSelectAll?.()}
                aria-label="Seleccionar todos"
              />
            </TableHead>
          ) : null}
          <TableHead>N&ordm; Pedido</TableHead>
          <TableHead>Cliente</TableHead>
          <TableHead>Producto</TableHead>
          <SortHeader label="Cant." field="quantity" sort={sort} dir={dir} onSort={onSort} align="right" />
          <SortHeader label="Precio de venta" field="price" sort={sort} dir={dir} onSort={onSort} align="right" />
          {/* Fecha desc es el orden POR DEFECTO: no se pinta como filtro aplicado. */}
          <SortHeader label="Fecha" field="date" sort={sort} dir={dir} onSort={onSort} defaultDesc />
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
                  'group/row relative transition-colors hover:bg-accent/[0.05]',
                  (onOpenOrder || multi) && 'cursor-pointer',
                  (isOpen || isSelected) && 'bg-accent/[0.08]',
                  // Con reacciones, la fila crece: los chips tienen su FRANJA
                  // propia abajo y nunca tapan contenido (igual que el mockup).
                  order.reactions.length > 0 && '[&>td]:pb-9',
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
                  <TableCell className="relative w-10" onClick={(e) => e.stopPropagation()}>
                    <RowRail />
                    <input
                      type="checkbox"
                      className="block h-[15px] w-[15px] cursor-pointer rounded-[4px] border-input accent-accent"
                      checked={isSelected}
                      onChange={() => onToggleSelect!(order.id)}
                      aria-label={`Seleccionar ${order.externalId}`}
                    />
                  </TableCell>
                ) : null}
                <TableCell className="relative whitespace-nowrap font-mono text-[11.5px] text-muted-foreground">
                  {!selectable ? <RowRail /> : null}
                  <span className="inline-flex items-center gap-2">
                    {/* Distintivo de "tomado" al INICIO de la fila (hueco reservado
                        solo si hay tomados en la pagina: los numeros alinean). */}
                    {order.claimedBy ? (
                      <ClaimChip
                        userId={order.claimedBy.userId}
                        name={order.claimedBy.name}
                        mine={order.claimedBy.mine}
                      />
                    ) : anyClaimed ? (
                      <ClaimSlot />
                    ) : null}
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
                      {titleCaseName(order.customerName)}
                      {order.unreadCount > 0 ? (
                        <span
                          title={`${order.unreadCount} mensaje(s) sin leer`}
                          className="animate-unread inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-accent px-1 font-mono text-[10px] font-semibold leading-none text-accent-foreground"
                        >
                          {order.unreadCount > 99 ? '99+' : order.unreadCount}
                        </span>
                      ) : null}
                    </span>
                    {order.customerDocument ? (
                      <span className="font-mono text-[10.5px] text-muted-foreground/80">
                        CC {order.customerDocument}
                      </span>
                    ) : null}
                  </div>
                </TableCell>

                {/* Producto: 1 -> nombre; varios -> nombre + pildora "+N" debajo.
                    El nombre SIEMPRE se muestra completo (envuelve en lineas). */}
                <TableCell className="min-w-[200px] max-w-[340px]">
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
                    <span className="text-[13px] font-medium tabular-nums">{order.totalUnits}</span>
                    {multi ? (
                      <span className="text-[10.5px] text-muted-foreground/80">
                        {order.items.length} productos
                      </span>
                    ) : null}
                  </div>
                </TableCell>

                <TableCell className="whitespace-nowrap text-right font-mono text-xs tabular-nums">
                  {formatCurrency(order.totalValue, order.currency)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  <div className="flex flex-col leading-tight">
                    <span className="text-xs">
                      {format(new Date(order.marketplaceCreatedAt), 'd MMM yyyy', { locale: es })}
                    </span>
                    <span className="font-mono text-[10.5px] text-muted-foreground/70">
                      {format(new Date(order.marketplaceCreatedAt), 'HH:mm')}
                    </span>
                  </div>
                </TableCell>
                <TableCell className={cn(!showAddress && !showShipping && 'relative pr-16')}>
                  <StatusBadge status={order.status} />
                  {!showAddress && !showShipping ? (
                    <RowActions order={order} onClaim={openMenu('claim')} onReact={openMenu('react')} onToggleReaction={actions.toggleReaction} />
                  ) : null}
                </TableCell>
                {showAddress ? (
                  <TableCell className="relative pr-16">
                    <AddressCell order={order} />
                    <RowActions order={order} onClaim={openMenu('claim')} onReact={openMenu('react')} onToggleReaction={actions.toggleReaction} />
                  </TableCell>
                ) : null}
                {showShipping ? (
                  <TableCell className="relative pr-16">
                    <ShippingCell order={order} />
                    <RowActions order={order} onClaim={openMenu('claim')} onReact={openMenu('react')} onToggleReaction={actions.toggleReaction} />
                  </TableCell>
                ) : null}
              </TableRow>

              {/* Sub-fila expandible con el desglose de productos (mockup):
                  icono + nombre con SKU al lado en gris + "1 × precio" a la
                  derecha. Sin caja interna ni columna de total. */}
              {multi && isOpen ? (
                <TableRow className="bg-muted/20 hover:bg-muted/20">
                  <TableCell colSpan={colCount} className="py-1 pl-12 pr-4">
                    {order.items.map((item, idx) => (
                      <div
                        key={`${item.sku}-${idx}`}
                        className="flex items-center gap-2.5 py-1.5 text-xs"
                      >
                        <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                        <span className="min-w-0 flex-1 break-words leading-snug">
                          {item.name}{' '}
                          <span className="font-mono text-[10.5px] text-muted-foreground/80">
                            SKU {item.sku}
                          </span>
                        </span>
                        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                          {item.quantity} &times; {formatCurrency(item.unitPrice, order.currency)}
                        </span>
                      </div>
                    ))}
                  </TableCell>
                </TableRow>
              ) : null}
            </Fragment>
          );
        })}
      </TableBody>
        </Table>
      </div>

      {/* Menus anclados: picker COMPLETO de emojis / tomar-soltar pedido. */}
      {menu?.kind === 'react' ? (
        <EmojiPicker
          anchor={{ x: menu.x, y: menu.y }}
          onPick={(emoji) => {
            actions.toggleReaction(menu.order.id, emoji);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {menu?.kind === 'claim' ? (
        <ClaimMenu
          order={menu.order}
          meName={actions.me?.name ?? actions.me?.email ?? ''}
          anchor={{ x: menu.x, y: menu.y }}
          onClaim={() => {
            actions.claim(menu.order.id);
            setMenu(null);
          }}
          onUnclaim={() => {
            actions.unclaim(menu.order.id);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </>
  );
}

/** Riel de acento en el borde izquierdo de la fila (aparece al pasar el mouse). */
function RowRail() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute bottom-1 left-0 top-1 w-[2.5px] rounded-full bg-accent opacity-0 transition-opacity group-hover/row:opacity-100"
    />
  );
}

/** Chips de reacciones del pedido (esquina inferior derecha, clic = sumarse/quitarse). */
function ReactionChips({
  order,
  onToggleReaction,
  className,
}: {
  order: OrderSummary;
  onToggleReaction: (orderId: string, emoji: string) => void;
  className?: string;
}) {
  if (!order.reactions || order.reactions.length === 0) return null;
  return (
    <span className={cn('flex flex-wrap justify-end gap-1', className)}>
      {/* span[role=button]: en movil viven dentro del <button> de la tarjeta
          (un <button> anidado seria HTML invalido). */}
      {order.reactions.map((r) => (
        <span
          key={r.emoji}
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onToggleReaction(order.id, r.emoji);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              onToggleReaction(order.id, r.emoji);
            }
          }}
          title={r.mine ? 'Tu reacción · clic para quitar' : `Reaccionaron ${r.count} · clic para sumarte`}
          className={cn(
            // Mas grandes que las del chat: en la fila deben NOTARSE.
            'inline-flex h-[24px] cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-[14px] leading-none shadow-card transition-all hover:-translate-y-px',
            r.mine
              ? 'border-accent/40 bg-accent/10'
              : 'border-border bg-card hover:border-accent/40',
          )}
        >
          {r.emoji}
          <b className={cn('font-mono text-[11px] font-medium', r.mine ? 'text-accent' : 'text-muted-foreground')}>
            {r.count}
          </b>
        </span>
      ))}
    </span>
  );
}

/**
 * Acciones de la fila: carita (reaccionar) y ⋯ (tomar/soltar), flotando a la
 * derecha SOLO al pasar el mouse; debajo, los chips de reacciones existentes.
 */
function RowActions({
  order,
  onClaim,
  onReact,
  onToggleReaction,
}: {
  order: OrderSummary;
  onClaim: (order: OrderSummary, e: React.MouseEvent) => void;
  onReact: (order: OrderSummary, e: React.MouseEvent) => void;
  onToggleReaction: (orderId: string, emoji: string) => void;
}) {
  return (
    <>
      {/* Chips en la esquina inferior derecha de la FILA, dentro de la franja
          reservada (pb-7 del row): nunca tapan el contenido (como el mockup). */}
      <ReactionChips
        order={order}
        onToggleReaction={onToggleReaction}
        className="absolute bottom-1.5 right-3"
      />
      {/* Botones DESPUES del estado (la celda reserva pr-16), centrados. */}
      <span className="absolute right-1.5 top-1/2 flex -translate-y-1/2 gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
        <button
          type="button"
          onClick={(e) => onReact(order, e)}
          aria-label="Reaccionar al pedido"
          title="Reaccionar"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-card transition-colors hover:border-accent/40 hover:text-foreground"
        >
          <SmilePlus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={(e) => onClaim(order, e)}
          aria-label="Opciones del pedido"
          title={order.claimedBy ? (order.claimedBy.mine ? 'Lo tienes tú' : `Tomado por ${order.claimedBy.name}`) : 'Tomar pedido'}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-card transition-colors hover:border-accent/40 hover:text-foreground"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </span>
    </>
  );
}

/** Menu de tomar/soltar pedido (portal anclado al boton ⋯). */
function ClaimMenu({
  order,
  meName,
  anchor,
  onClaim,
  onUnclaim,
  onClose,
}: {
  order: OrderSummary;
  meName: string;
  anchor: { x: number; y: number };
  onClaim: () => void;
  onUnclaim: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (typeof document === 'undefined') return null;

  const W = 252;
  const left = Math.min(Math.max(8, anchor.x - W + 20), window.innerWidth - W - 8);
  const top = Math.min(anchor.y + 6, window.innerHeight - 120);
  const c = order.claimedBy;

  return createPortal(
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0" onClick={onClose} />
      <div
        style={{ left, top, width: W }}
        className="shadow-pop absolute rounded-xl border border-border bg-popover p-1.5"
      >
        {!c ? (
          <>
            <button
              type="button"
              onClick={onClaim}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent/10"
            >
              <span className="ring-halo flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-accent text-[8.5px] font-bold uppercase tracking-wider text-accent-foreground">
                {initialsOf(meName || '·')}
              </span>
              Tomar pedido
            </button>
            <p className="px-2.5 pb-1.5 pt-0.5 text-[11px] leading-snug text-muted-foreground">
              Quedará a tu cargo, con tu distintivo junto al pedido. Nadie más podrá tomarlo.
            </p>
          </>
        ) : c.mine ? (
          <>
            <button
              type="button"
              onClick={onUnclaim}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent/10"
            >
              <Hand className="h-4 w-4 text-muted-foreground" />
              Soltar pedido
            </button>
            <p className="px-2.5 pb-1.5 pt-0.5 text-[11px] leading-snug text-muted-foreground">
              Lo tienes tú. Al soltarlo, cualquier otro podrá tomarlo.
            </p>
          </>
        ) : (
          <>
            <div className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground">
              <ClaimChip userId={c.userId} name={c.name} mine={false} />
              Tomado por {c.name}
            </div>
            <p className="px-2.5 pb-1.5 pt-0.5 text-[11px] leading-snug text-muted-foreground">
              Solo quien lo tomó puede soltarlo.
            </p>
          </>
        )}
      </div>
    </div>,
    document.body,
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
  onClaim,
  onReact,
  onToggleReaction,
}: {
  order: OrderSummary;
  selectable: boolean;
  selected: boolean;
  onToggleSelect?: (id: string) => void;
  onOpenOrder?: (order: OrderSummary) => void;
  showShipping: boolean;
  showAddress: boolean;
  onPrefetch: () => void;
  onClaim: (order: OrderSummary, e: React.MouseEvent) => void;
  onReact: (order: OrderSummary, e: React.MouseEvent) => void;
  onToggleReaction: (orderId: string, emoji: string) => void;
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
            className="block h-[15px] w-[15px] cursor-pointer rounded-[4px] border-input accent-accent"
            checked={selected}
            onChange={() => onToggleSelect!(order.id)}
            aria-label={`Seleccionar ${order.externalId}`}
          />
        </span>
      ) : null}

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 font-mono text-[12.5px] text-muted-foreground">
            {order.claimedBy ? (
              <ClaimChip
                userId={order.claimedBy.userId}
                name={order.claimedBy.name}
                mine={order.claimedBy.mine}
              />
            ) : null}
            <span className="truncate">{order.externalId}</span>
            {order.hasDevicePhoto ? (
              <Camera className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : null}
          </span>
          <StatusBadge status={order.status} />
        </div>

        <div className="mt-1 flex items-center gap-1.5">
          <span className="truncate text-[16px] font-medium text-foreground">
            {titleCaseName(order.customerName)}
          </span>
          {order.unreadCount > 0 ? (
            <span className="animate-unread inline-flex h-[17px] min-w-[17px] shrink-0 items-center justify-center rounded-full bg-accent px-1 font-mono text-[10px] font-semibold leading-none text-accent-foreground">
              {order.unreadCount > 99 ? '99+' : order.unreadCount}
            </span>
          ) : null}
        </div>

        {first ? (
          <p className="mt-0.5 truncate text-[14px] text-muted-foreground">
            {first.name}
            {extra > 0 ? <span className="text-muted-foreground"> +{extra}</span> : null}
          </p>
        ) : null}

        <div className="mt-1.5 flex items-center justify-between gap-2 text-[12.5px] text-muted-foreground">
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

        {/* Reacciones + acciones (en tactil van siempre visibles, discretas). */}
        <div className="mt-2 flex items-center justify-end gap-1.5">
          <ReactionChips order={order} onToggleReaction={onToggleReaction} />
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onReact(order, e as unknown as React.MouseEvent);
            }}
            aria-label="Reaccionar al pedido"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-card"
          >
            <SmilePlus className="h-4 w-4" />
          </span>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onClaim(order, e as unknown as React.MouseEvent);
            }}
            aria-label="Opciones del pedido"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-card"
          >
            <MoreHorizontal className="h-4 w-4" />
          </span>
        </div>
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
    return <span className="block break-words text-[12.5px] leading-snug">{first.name}</span>;
  }
  // Varios: nombre completo + pildora "+N ›" DEBAJO (mockup); la pildora
  // alterna el desglose inline sin abrir el drawer de la fila.
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="break-words text-[12.5px] leading-snug">{first.name}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        aria-label={isOpen ? 'Ocultar productos' : 'Ver productos'}
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted px-2 py-px font-mono text-[10.5px] font-medium text-muted-foreground transition-colors hover:border-accent/40 hover:text-foreground"
      >
        +{order.items.length - 1}
        <ChevronRight
          className={cn('h-2.5 w-2.5 transition-transform', isOpen && 'rotate-90')}
        />
      </button>
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
  defaultDesc = false,
}: {
  label: string;
  field: OrderSortField;
  sort: OrderSortField;
  dir: SortDir;
  onSort: (field: OrderSortField) => void;
  align?: 'left' | 'right';
  /** Este campo en desc ES el orden por defecto: no se marca como aplicado. */
  defaultDesc?: boolean;
}) {
  const active = sort === field && !(defaultDesc && dir === 'desc');
  return (
    <TableHead className={cn('whitespace-nowrap', align === 'right' && 'text-right')}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          // text-transform/letter-spacing NO se heredan en <button> (preflight de
          // Tailwind), por eso los repetimos para que sea simetrico con los <th>.
          // La flecha SIEMPRE despues del label (como el mockup), tambien en
          // las columnas alineadas a la derecha. Mismo tono tenue que los th.
          'inline-flex items-center gap-1 rounded text-[10.5px] font-semibold uppercase tracking-wider transition-colors hover:text-foreground',
          active ? 'text-foreground' : 'text-muted-foreground/70',
        )}
      >
        {label}
        {active ? (
          <ChevronDown
            className={cn('h-3 w-3 transition-transform', dir === 'asc' && 'rotate-180')}
          />
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-50" />
        )}
      </button>
    </TableHead>
  );
}

/** Etiquetas del estado de envio (rastreo Coordinadora). */
export const SHIPPING_LABELS: Record<
  string,
  { label: string; variant: 'warning' | 'success' | 'secondary' | 'outline' | 'info' }
> = {
  entregado: { label: 'Entregado', variant: 'success' },
  novedad: { label: 'Novedad', variant: 'warning' },
  en_transito: { label: 'En transito', variant: 'info' },
  sin_movimientos: { label: 'Sin movimientos', variant: 'outline' },
};

const SHIPPING_FALLBACK = { label: 'Sin movimientos', variant: 'outline' } as const;

/**
 * Paso del recorrido canonico de Coordinadora (1..6) a partir del texto del
 * rastreo; si no hay texto, se aproxima por el estado agregado.
 * 1 A recibir · 2 Terminal origen · 3 En transporte · 4 Terminal destino ·
 * 5 En reparto · 6 Entregado.
 */
function shipStep(order: OrderSummary): number {
  const t = (order.shippingStatus ?? '').toUpperCase();
  if (/ENTREGAD/.test(t)) return 6;
  if (/REPARTO/.test(t)) return 5;
  if (/TERMINAL\s+(DE\s+)?DESTINO/.test(t)) return 4;
  if (/TRANSPORTE/.test(t)) return 3;
  if (/TERMINAL\s+(DE\s+)?ORIGEN/.test(t)) return 2;
  if (/RECIBIR/.test(t)) return 1;
  switch (order.shippingState) {
    case 'entregado':
      return 6;
    case 'novedad':
    case 'en_transito':
      return 3;
    default:
      return 1;
  }
}

/** Ruta de puntos del envio: 6 estados canonicos, rellenos hasta el actual. */
function RouteDots({ order }: { order: OrderSummary }) {
  const step = shipStep(order);
  const done = order.shippingState === 'entregado';
  return (
    <span className="mt-1.5 flex items-center" aria-hidden title={order.shippingStatus ?? undefined}>
      {Array.from({ length: 6 }, (_, i) => {
        const n = i + 1;
        const on = n <= step;
        const fill = done ? 'bg-emerald-600 dark:bg-emerald-500' : 'bg-accent';
        return (
          <Fragment key={n}>
            <span
              className={cn(
                'h-1.5 w-1.5 shrink-0 rounded-full',
                on ? fill : 'bg-border',
                n === step && !done && 'ring-halo',
              )}
            />
            {n < 6 ? (
              <span className={cn('h-[1.5px] w-3 shrink-0', n < step ? fill : 'bg-border')} />
            ) : null}
          </Fragment>
        );
      })}
    </span>
  );
}

function ShippingCell({ order }: { order: OrderSummary }) {
  if (!order.guideNumber) {
    return <span className="text-xs text-muted-foreground">Sin guía</span>;
  }
  // Badge + recorrido de 6 puntos + Nº de guia: el estado del envio se lee
  // de un vistazo sin abrir el pedido.
  const meta = SHIPPING_LABELS[order.shippingState ?? 'sin_movimientos'] ?? SHIPPING_FALLBACK;
  return (
    <div className="flex flex-col items-start">
      <Badge dot variant={meta.variant} className="whitespace-nowrap">
        {meta.label}
      </Badge>
      <RouteDots order={order} />
      <span className="mt-1 font-mono text-[10.5px] text-muted-foreground/70" title="Número de guía">
        Guía {order.guideNumber}
      </span>
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
    return <Badge dot variant="outline" className="whitespace-nowrap">Sin responder</Badge>;
  }
  const meta = ADDRESS_LABELS[order.addressStatus] ?? ADDRESS_FALLBACK;
  // Solo el estado en la tabla; la direccion nueva se ve en el drawer del pedido.
  return (
    <Badge dot variant={meta.variant} className="whitespace-nowrap">
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
    <Badge dot variant={mapped?.variant ?? 'secondary'} className="whitespace-nowrap">
      {mapped?.label ?? status}
    </Badge>
  );
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
