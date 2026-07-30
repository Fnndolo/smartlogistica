'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Boxes,
  Building2,
  Camera,
  CheckCircle2,
  Hand,
  ListChecks,
  MapPin,
  PackageCheck,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import type { OrdersPulse } from '@smartlogistica/shared';

import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

type Tint = 'accent' | 'ok' | 'warn' | 'bad';

const TINT: Record<Tint, string> = {
  accent: 'bg-accent/10 text-accent',
  ok: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  warn: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  bad: 'bg-destructive/10 text-destructive',
};

interface TileDef {
  icon: LucideIcon;
  tint: Tint;
  label: string;
  sub: string;
}

/** Definicion de las 4 tarjetas segun la vista (las metricas son de DONDE estas). */
const TILES: Record<OrdersPulse['scope'], TileDef[]> = {
  general: [
    { icon: Boxes, tint: 'accent', label: 'Pedidos de hoy', sub: '' },
    { icon: Building2, tint: 'ok', label: 'Sin asignar a sede', sub: 'esperando sede' },
    { icon: MapPin, tint: 'warn', label: 'Dirección sin responder', sub: 'esperando WhatsApp' },
    { icon: Hand, tint: 'accent', label: 'Sin tomar', sub: 'nadie a cargo' },
  ],
  pending: [
    { icon: ListChecks, tint: 'accent', label: 'Por preparar', sub: 'en esta sede' },
    { icon: Camera, tint: 'ok', label: 'Con foto IMEI', sub: 'listos para facturar' },
    { icon: MapPin, tint: 'warn', label: 'Dirección sin responder', sub: 'esperando WhatsApp' },
    { icon: Hand, tint: 'accent', label: 'Sin tomar', sub: 'nadie a cargo' },
  ],
  invoiced: [
    { icon: PackageCheck, tint: 'accent', label: 'Facturados', sub: 'en esta sede' },
    { icon: Truck, tint: 'accent', label: 'En camino', sub: 'con Coordinadora' },
    { icon: AlertTriangle, tint: 'bad', label: 'Novedades de envío', sub: 'requiere gestión' },
    { icon: CheckCircle2, tint: 'ok', label: 'Entregados', sub: 'llegaron al cliente' },
  ],
};

/**
 * "Pulso" de la vista: 4 metricas operativas arriba de la tabla, ACORDES a
 * donde estas (generales / por preparar / facturados). Contenido centrado.
 */
export function OrdersPulseRow({
  scope,
  warehouseId,
}: {
  scope: OrdersPulse['scope'];
  warehouseId?: string;
}) {
  const { data } = useQuery({
    queryKey: ['orders-pulse', scope, warehouseId ?? null],
    queryFn: () =>
      api.get<OrdersPulse>(
        `/v1/orders/pulse?scope=${scope}${warehouseId ? `&warehouse=${warehouseId}` : ''}`,
      ),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });

  const tiles = TILES[scope];
  const values = data ? [data.a, data.b, data.c, data.d] : [null, null, null, null];

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
      {tiles.map((t, i) => {
        const Icon = t.icon;
        const v = values[i];
        return (
          <div
            key={t.label}
            className="shadow-card flex flex-col items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-3 text-center transition-all hover:-translate-y-px hover:shadow-float"
          >
            <div className="flex items-center justify-center gap-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span className={cn('flex h-6 w-6 items-center justify-center rounded-md', TINT[t.tint])}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              {t.label}
            </div>
            {v === null ? (
              <div className="h-7 w-10 animate-pulse rounded bg-muted" />
            ) : (
              <div className="text-2xl font-semibold leading-none tracking-tight tabular-nums">{v}</div>
            )}
            <div className="flex items-center justify-center text-[11.5px] text-muted-foreground">
              {scope === 'general' && i === 0 && data?.deltaToday != null ? (
                <span className="rounded-full bg-accent/10 px-2 py-0.5 font-mono text-[10.5px] font-medium text-accent">
                  {data.deltaToday >= 0 ? `+${data.deltaToday}` : data.deltaToday} vs ayer
                </span>
              ) : (
                t.sub || ' '
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
