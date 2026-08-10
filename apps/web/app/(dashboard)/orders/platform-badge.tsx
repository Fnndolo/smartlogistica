'use client';

import { useQuery } from '@tanstack/react-query';
import type { BadgeColor, OrderSummary, Platform } from '@smartlogistica/shared';

import { cn } from '@/lib/utils';
import { api } from '@/lib/api-client';

/**
 * Badge de PLATAFORMA (columna "Plataforma" de la sede): VTEX para los del
 * marketplace y la plataforma elegida al montar (Krediya, Mercado Libre...)
 * para los manuales. El color vive en el catalogo de Ajustes.
 */

/** Clases por color de la paleta (misma receta que las variantes del Badge). */
export const BADGE_COLOR_CLASSES: Record<BadgeColor, string> = {
  rose: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400',
  red: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400',
  yellow: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
  amber: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  orange: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400',
  emerald: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  lime: 'border-lime-500/30 bg-lime-500/10 text-lime-700 dark:text-lime-500',
  sky: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400',
  blue: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400',
  cyan: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-400',
  violet: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400',
  fuchsia: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-400',
  slate: 'border-border bg-muted text-muted-foreground',
};

/** Muestra sólida del color (swatch del selector en Ajustes). */
export const SWATCH_COLOR_CLASSES: Record<BadgeColor, string> = {
  rose: 'bg-rose-500',
  red: 'bg-red-500',
  yellow: 'bg-yellow-400',
  amber: 'bg-amber-500',
  orange: 'bg-orange-500',
  emerald: 'bg-emerald-500',
  lime: 'bg-lime-500',
  sky: 'bg-sky-500',
  blue: 'bg-blue-500',
  cyan: 'bg-cyan-500',
  violet: 'bg-violet-500',
  fuchsia: 'bg-fuchsia-500',
  slate: 'bg-slate-500',
};

/** Catalogo de plataformas (cacheado; lo usan la tabla, el form y Ajustes). */
export function usePlatforms() {
  return useQuery({
    queryKey: ['platforms'],
    queryFn: () => api.get<Platform[]>('/v1/platforms'),
    staleTime: 5 * 60_000,
  });
}

/** Resuelve nombre + color del badge para un pedido contra el catalogo. */
export function platformOf(
  order: Pick<OrderSummary, 'provider' | 'platform'>,
  platforms: Platform[],
): { name: string; color: BadgeColor } {
  if (order.provider === 'vtex') {
    const cat = platforms.find((p) => p.id === 'vtex');
    return { name: cat?.name ?? 'VTEX', color: cat?.color ?? 'rose' };
  }
  if (order.platform) {
    const cat = platforms.find((p) => p.id === order.platform!.id);
    // Si la borraron del catalogo, queda el nombre guardado con gris neutro.
    return { name: cat?.name ?? order.platform.name, color: cat?.color ?? 'slate' };
  }
  // Manuales viejos sin plataforma guardada.
  return { name: 'Manual', color: 'slate' };
}

export function PlatformBadge({
  order,
  platforms,
  className,
}: {
  order: Pick<OrderSummary, 'provider' | 'platform'>;
  platforms: Platform[];
  className?: string;
}) {
  const { name, color } = platformOf(order, platforms);
  return (
    <span
      className={cn(
        // Compacto a proposito: esta columna compite por ancho con otras 9.
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-[2.5px] text-[9.5px] font-semibold uppercase tracking-[0.05em]',
        BADGE_COLOR_CLASSES[color],
        className,
      )}
    >
      <span aria-hidden className="h-[5px] w-[5px] shrink-0 rounded-full bg-current" />
      {name}
    </span>
  );
}
