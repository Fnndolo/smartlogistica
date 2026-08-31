import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Piezas visuales compartidas de Conexiones (lenguaje "Cobalto" del mockup
 * aprobado). Son SOLO presentacion: cada tarjeta conserva sus datos, sus
 * consultas, sus permisos y sus handlers.
 */

/** Tarjeta contenedora (.card / .conn del mockup): plana, solo borde. */
export const CONN_CARD = 'rounded-[14px] border border-border bg-card p-[15px_16px]';

/** Boton primario: degradado cobalto + halo (.btn-p). */
export const BTN_PRIMARY =
  'h-auto gap-[7px] rounded-[10px] bg-gradient-to-b from-accent to-accent-deep px-[15px] py-2 text-[13px] font-bold text-accent-foreground shadow-[0_6px_18px_-6px_hsl(var(--ring)),inset_0_1px_0_rgba(255,255,255,0.18)] transition-transform [transition-duration:120ms] hover:-translate-y-px [&_svg]:size-[14px]';

/**
 * Variante compacta (.btn-sm): 12px de texto, 6px/12px de aire y 9px de radio.
 * Se combina con BTN_PRIMARY via cn() — es la medida de las acciones de la
 * cabecera de pagina. (BTN_GHOST y BTN_QUIET ya vienen en esta medida.)
 */
export const BTN_SM = 'gap-[6px] rounded-[9px] px-3 py-1.5 text-[12px]';

/** Boton fantasma sobre la tarjeta (.btn-g .btn-sm). */
export const BTN_GHOST =
  'h-auto gap-[7px] rounded-[9px] border border-input bg-card px-3 py-1.5 text-[12px] font-bold text-muted-foreground shadow-none transition-colors [transition-duration:140ms] hover:border-accent hover:bg-card hover:text-accent-ink [&_svg]:size-[14px]';

/** Boton discreto, SIN borde (Cancelar / Atras): no compite con el fantasma. */
export const BTN_QUIET =
  'h-auto gap-[7px] rounded-[9px] border border-transparent bg-transparent px-3 py-1.5 text-[12px] font-bold text-hint shadow-none transition-colors [transition-duration:140ms] hover:bg-wash hover:text-accent-ink [&_svg]:size-[14px]';

/** Boton-icono cuadrado (.icon-btn): la basurita de desconectar. */
export const BTN_ICON =
  'h-8 w-8 shrink-0 rounded-[9px] border border-input bg-card text-hint shadow-none transition-colors [transition-duration:140ms] hover:border-destructive hover:bg-card hover:text-destructive [&_svg]:size-[14px]';

/** Micro-etiqueta de campo del formulario. */
export const LABEL_MICRO = 'text-[11px] font-extrabold uppercase tracking-[0.08em] text-hint';

/** Segmentado (modo sandbox/produccion, proveedor de IA). */
export const SEG_WRAP = 'grid gap-1 rounded-[10px] border border-input bg-surface p-1';
export const SEG_ITEM =
  'rounded-[7px] px-2 py-1.5 text-[12px] font-bold transition-colors [transition-duration:130ms]';
export const SEG_ON =
  'bg-gradient-to-b from-accent to-accent-deep text-accent-foreground shadow-[0_4px_12px_-4px_hsl(var(--ring))]';
export const SEG_OFF = 'text-muted-foreground hover:text-accent-ink';

/** Encabezado de seccion (.sec-h): micro-titulo + regla de 1px. */
export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-[9px]">
      <h2 className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-hint">
        {children}
      </h2>
      <span aria-hidden className="h-px flex-1 bg-border" />
    </div>
  );
}

type TileTone = 'cobalt' | 'violet' | 'sky' | 'muted';

// Mismo tratamiento que settings-ui.tsx: en oscuro NO basta con aclarar el
// texto, tambien se levanta el lavado de fondo — si no, la baldosa de IA y la
// de WhatsApp se ven mas apagadas aqui que en Ajustes.
const TILE_TONE: Record<TileTone, string> = {
  cobalt: 'bg-wash text-accent',
  violet: 'bg-violet-500/10 text-violet-600 dark:bg-violet-400/15 dark:text-violet-400',
  sky: 'bg-sky-500/10 text-sky-600 dark:bg-sky-400/15 dark:text-sky-400',
  muted: 'border border-border bg-surface text-muted-foreground',
};

/** Baldosa de 40px del icono (.tile). */
export function Tile({
  tone = 'muted',
  className,
  children,
}: {
  tone?: TileTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-[11px]',
        TILE_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

type PillTone = 'ok' | 'warn' | 'bad' | 'cobalt' | 'muted' | 'violet';

const PILL_TONE: Record<PillTone, string> = {
  // MISMA receta que settings-ui.tsx: en oscuro tambien sube el lavado, no
  // solo el texto — si no, la misma pastilla se ve plana aqui y con fondo alla.
  ok: 'bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-400',
  warn: 'bg-amber-500/10 text-amber-700 dark:bg-amber-400/15 dark:text-amber-400',
  bad: 'bg-red-500/10 text-red-600 dark:bg-red-400/15 dark:text-red-400',
  cobalt: 'bg-wash text-accent-ink',
  muted: 'border border-border bg-surface text-hint',
  violet: 'bg-violet-500/10 text-violet-700 dark:bg-violet-400/15 dark:text-violet-400',
};

/**
 * Pastilla (.pill). Las de ESTADO llevan punto de 6px; el `icon` reemplaza al
 * punto cuando el estado necesita otra señal (spinner, alerta).
 */
export function Pill({
  tone = 'muted',
  dot = false,
  icon,
  children,
}: {
  tone?: PillTone;
  dot?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[5px] whitespace-nowrap rounded-full px-[9px] py-0.5 text-[11px] font-bold',
        PILL_TONE[tone],
      )}
    >
      {icon ?? (dot ? <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" /> : null)}
      {children}
    </span>
  );
}

/** Linea de error de la conexion (.err): ambar con icono de alerta. */
export function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <p className="mt-[5px] flex items-start gap-[5px] text-[11.5px] text-amber-700 dark:text-amber-400">
      <AlertTriangle className="mt-px h-[13px] w-[13px] shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}
