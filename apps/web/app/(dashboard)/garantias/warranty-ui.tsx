'use client';

import { Check, Clock, PackageCheck, Truck, Wrench } from 'lucide-react';
import {
  WARRANTY_RESOLUTION_LABEL,
  WARRANTY_STATUS_LABEL,
  WARRANTY_STATUS_ORDER,
  type WarrantyEvent,
  type WarrantyResolution,
  type WarrantyStatus,
} from '@smartlogistica/shared';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** Color de cada estado: azul recien llega, ambar afuera, verde listo, gris cerrado. */
const STATUS_VARIANT: Record<WarrantyStatus, 'info' | 'warning' | 'success' | 'secondary'> = {
  received: 'info',
  at_supplier: 'warning',
  ready: 'success',
  closed: 'secondary',
};

export const STATUS_ICON: Record<WarrantyStatus, typeof Clock> = {
  received: Clock,
  at_supplier: Truck,
  ready: PackageCheck,
  closed: Wrench,
};

/**
 * Estado de la garantia. Cerrada dice COMO termino (reparada, cambio...): "No
 * procede" va en rojo porque el cliente se va sin solucion.
 */
export function WarrantyStatusBadge({
  status,
  resolution,
  className,
}: {
  status: WarrantyStatus;
  resolution?: WarrantyResolution | null;
  className?: string;
}) {
  if (status === 'closed') {
    const denied = resolution === 'denied';
    return (
      <Badge dot variant={denied ? 'destructive' : 'secondary'} className={className}>
        {resolution ? WARRANTY_RESOLUTION_LABEL[resolution] : 'Cerrada'}
      </Badge>
    );
  }
  return (
    <Badge dot variant={STATUS_VARIANT[status]} className={className}>
      {WARRANTY_STATUS_LABEL[status]}
    </Badge>
  );
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "2026-11-26" -> "26 nov 2026" (fechas sin hora: no se mueven por zona horaria). */
export function formatDay(value: string | null | undefined, withYear = true): string {
  if (!value) return '—';
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return value;
  return withYear ? `${d} ${MONTHS[m - 1]} ${y}` : `${d} ${MONTHS[m - 1]}`;
}

/** Fecha y hora local de un ISO: "26 nov, 3:42 p. m.". */
export function formatMoment(iso: string): string {
  const dt = new Date(iso);
  const time = dt.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
  return `${dt.getDate()} ${MONTHS[dt.getMonth()]}, ${time}`;
}

/** Hoy en Colombia como AAAA-MM-DD (para los campos de fecha). */
export function todayIso(): string {
  return new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
}

/** Dias desde que se recibio (hasta hoy, o hasta que se cerro). */
export function daysOpen(receivedAt: string, closedAt?: string | null): number {
  const start = Date.parse(`${receivedAt.slice(0, 10)}T12:00:00Z`);
  const end = closedAt ? Date.parse(closedAt) : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

/**
 * Dias en tramite con semaforo: hasta 8 tranquilo, hasta 15 ambar, mas rojo.
 * Cerradas se pintan neutras (ya no corre el reloj).
 */
export function AgeChip({
  receivedAt,
  closedAt,
  closed,
}: {
  receivedAt: string;
  closedAt?: string | null;
  closed: boolean;
}) {
  const days = daysOpen(receivedAt, closedAt);
  const tone = closed
    ? 'bg-muted text-muted-foreground'
    : days > 15
      ? 'bg-destructive/10 text-destructive'
      : days > 8
        ? 'bg-amber-500/12 text-amber-700 dark:text-amber-400'
        : 'bg-muted text-muted-foreground';
  return (
    <span
      title={closed ? `Se resolvió en ${days} días` : `${days} días en trámite`}
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums',
        tone,
      )}
    >
      {days} d
    </span>
  );
}

/** "#0198": el radicado siempre con 4 digitos (se lee como en la hoja). */
export function radicado(n: number): string {
  return `#${String(n).padStart(4, '0')}`;
}

/** Cuando ENTRO por ultima vez a cada estado (para la barra de pasos). */
export function statusDates(events: WarrantyEvent[]): Partial<Record<WarrantyStatus, string>> {
  const out: Partial<Record<WarrantyStatus, string>> = {};
  for (const e of events) {
    if (e.toStatus) out[e.toStatus] = e.createdAt;
  }
  return out;
}

/**
 * Barra de pasos del ciclo (Recibida -> En proveedor -> Lista -> Cerrada). Si
 * se salto el proveedor (se resolvio en la tienda), ese paso queda punteado.
 */
export function WarrantyStepper({
  status,
  events,
}: {
  status: WarrantyStatus;
  events: WarrantyEvent[];
}) {
  const dates = statusDates(events);
  const currentIdx = WARRANTY_STATUS_ORDER.indexOf(status);
  return (
    <ol className="flex items-start">
      {WARRANTY_STATUS_ORDER.map((s, i) => {
        const done = i < currentIdx;
        const current = i === currentIdx;
        const skipped = done && !dates[s];
        const Icon = STATUS_ICON[s];
        return (
          <li key={s} className="relative flex flex-1 flex-col items-center text-center">
            {i > 0 ? (
              <span
                aria-hidden
                className={cn(
                  'absolute right-1/2 top-[13px] h-[2px] w-full -translate-y-1/2',
                  i <= currentIdx ? 'bg-accent' : 'bg-border',
                  skipped &&
                    'bg-transparent bg-[length:6px_2px] bg-repeat-x [background-image:linear-gradient(90deg,hsl(var(--accent))_50%,transparent_0)]',
                )}
              />
            ) : null}
            <span
              className={cn(
                'relative z-10 flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 transition-colors',
                current
                  ? 'ring-halo border-accent bg-accent text-accent-foreground'
                  : done
                    ? skipped
                      ? 'border-dashed border-accent/60 bg-card text-accent/70'
                      : 'border-accent bg-accent text-accent-foreground'
                    : 'border-border bg-card text-muted-foreground',
              )}
            >
              {done && !skipped ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3 w-3" />}
            </span>
            <span
              className={cn(
                'mt-1.5 text-[11px] font-semibold leading-tight',
                current ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {s === 'ready' ? 'Lista' : WARRANTY_STATUS_LABEL[s]}
            </span>
            <span className="mt-0.5 h-3.5 font-mono text-[10px] text-muted-foreground/80">
              {skipped
                ? 'se saltó'
                : dates[s] && (done || current)
                  ? formatMoment(dates[s]!).split(',')[0]
                  : ''}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
