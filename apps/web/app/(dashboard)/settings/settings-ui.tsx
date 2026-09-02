'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, X } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Lenguaje visual del mockup Cobalto para Ajustes y Equipo (.phead, .sec-h,
 * .card, .mem, .set, .tile, .pill, .btn). Son piezas PURAS (sin hooks ni
 * estado): las usan tanto la pagina servidor como las tarjetas cliente.
 *
 * Regla: ni un hex a mano — todo sale de los tokens de globals.css.
 */

/* ------------------------------- clases base ------------------------------ */

/** Foco de teclado visible sobre las superficies cobalto. */
export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-card';

/** Tarjeta del mockup (.card): 14px de radio y 15px/16px de aire. */
export const CARD_CLS = 'rounded-[14px] border border-border bg-card px-4 py-[15px]';

/**
 * Ficha de miembro del mockup (.mem): 14px/16px. Un punto mas apretada que una
 * tarjeta de Ajustes a proposito — Equipo es una lista, y se lee mas densa.
 */
export const MEM_CLS = 'rounded-[14px] border border-border bg-card px-4 py-3.5';

/** Boton primario (.btn-p): degradado cobalto, halo de color y reflejo interno. */
export const BTN_PRIMARY_CLS =
  'h-auto gap-[7px] rounded-[10px] bg-[linear-gradient(to_bottom,hsl(var(--accent)),hsl(var(--accent-deep)))] px-[15px] py-2 text-[13px] font-bold text-accent-foreground shadow-[0_6px_18px_-6px_hsl(var(--ring)),inset_0_1px_0_rgba(255,255,255,0.18)] transition-[transform,box-shadow] [transition-duration:120ms] hover:-translate-y-px hover:shadow-[0_10px_24px_-8px_hsl(var(--ring)),inset_0_1px_0_rgba(255,255,255,0.18)] motion-reduce:transition-none motion-reduce:hover:translate-y-0 [&_svg]:size-[14px]';

/** Boton fantasma (.btn-g): borde de campo que se acentua al pasar. */
export const BTN_GHOST_CLS =
  'h-auto gap-[7px] rounded-[10px] border-input bg-card px-[15px] py-2 text-[13px] font-bold text-muted-foreground !shadow-none transition-colors [transition-duration:140ms] hover:border-accent hover:text-accent-ink [&_svg]:size-[14px]';

/** Variante compacta (.btn-sm); se combina con las dos anteriores via cn(). */
export const BTN_SM_CLS = 'gap-[6px] rounded-[9px] px-3 py-1.5 text-[12px]';

/** Boton de solo icono (.icon-btn): 32px, se tiñe de rojo al pasar. */
export const ICON_BTN_CLS =
  'h-8 w-8 shrink-0 rounded-[9px] border-input bg-card p-0 text-hint !shadow-none transition-colors [transition-duration:140ms] hover:border-destructive hover:text-destructive [&_svg]:size-[14px]';

/** Igual que el anterior pero neutro (cerrar, cancelar): se acentua en cobalto. */
export const ICON_BTN_NEUTRAL_CLS = cn(ICON_BTN_CLS, 'hover:border-accent hover:text-accent-ink');

/** Aviso vacio/error dentro de una tarjeta (borde punteado). */
export const EMPTY_CLS =
  'rounded-[11px] border border-dashed border-border bg-surface px-3 py-4 text-center text-[12.5px] text-muted-foreground';

/* ---------------------------------- tiles --------------------------------- */

export type TileTone = 'cobalt' | 'violet' | 'sky' | 'muted';

const TILE_TONE: Record<TileTone, string> = {
  cobalt: 'border-transparent bg-wash text-accent',
  violet:
    'border-transparent bg-violet-500/10 text-violet-600 dark:bg-violet-400/15 dark:text-violet-400',
  sky: 'border-transparent bg-sky-500/10 text-sky-600 dark:bg-sky-400/15 dark:text-sky-400',
  muted: 'border-border bg-surface text-muted-foreground',
};

/** Casilla de icono de 40px del mockup (.tile). */
export function tileCls(tone: TileTone = 'muted'): string {
  return cn(
    'grid h-10 w-10 shrink-0 place-items-center rounded-[11px] border [&_svg]:h-[18px] [&_svg]:w-[18px]',
    TILE_TONE[tone],
  );
}

/* ---------------------------------- pills --------------------------------- */

export type PillTone = 'ok' | 'warn' | 'bad' | 'cobalt' | 'muted' | 'violet';

const PILL_TONE: Record<PillTone, string> = {
  ok: 'bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-400',
  warn: 'bg-amber-500/10 text-amber-700 dark:bg-amber-400/15 dark:text-amber-400',
  bad: 'bg-red-500/10 text-red-600 dark:bg-red-400/15 dark:text-red-400',
  cobalt: 'bg-wash text-accent-ink',
  muted: 'border border-border bg-surface text-hint',
  violet: 'bg-violet-500/10 text-violet-700 dark:bg-violet-400/15 dark:text-violet-400',
};

/** Pastilla del mockup (.pill): 11px, redonda, con lavado de color. */
export function Pill({
  tone,
  dot,
  children,
}: {
  tone: PillTone;
  /** Punto de 6px del color del texto (pastillas de estado). */
  dot?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-[5px] rounded-full px-[9px] py-0.5 text-[11px] font-bold',
        PILL_TONE[tone],
      )}
    >
      {dot ? <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

/* -------------------------------- cabeceras ------------------------------- */

/** Cabecera de pagina (.phead): titulo, bajada y acciones a la derecha. */
export function PageHead({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-[18px] flex flex-wrap items-start gap-[14px] border-b border-border pb-4">
      <div className="min-w-0">
        <h1 className="text-[21px] font-extrabold tracking-[-0.025em]">{title}</h1>
        <p className="mt-0.5 max-w-[62ch] text-[13px] text-muted-foreground">{description}</p>
      </div>
      {action ? <div className="ml-auto flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}

/** Titulo de seccion (.sec-h): micro-etiqueta + regla de 1px. */
export function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-[9px]">
      <h2 className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-hint">
        {children}
      </h2>
      <span aria-hidden className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * Encabezado de tarjeta de configuracion: casilla de icono + titulo + bajada,
 * con un hueco opcional a la derecha para la accion de la tarjeta.
 */
export function CardHead({
  icon,
  tone = 'muted',
  title,
  description,
  badge,
  action,
  mono = false,
}: {
  icon: React.ReactNode;
  tone?: TileTone;
  title: string;
  description?: React.ReactNode;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  /** Titulos tecnicos (slug del workspace) van en monoespaciada. */
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-[13px]">
      <span className={tileCls(tone)}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3
            className={cn(
              'min-w-0 break-words text-[13.5px] font-extrabold',
              mono && 'font-mono text-[13px]',
            )}
          >
            {title}
          </h3>
          {badge}
        </div>
        {description ? (
          <p className="mt-1 max-w-[72ch] text-[12px] text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-[7px]">{action}</div> : null}
    </div>
  );
}

/* ------------------------------ filas (.set) ------------------------------ */

/**
 * Fila navegable del mockup (.set): tarjeta de ancho completo con casilla
 * apagada, titulo, bajada de 12px y chevron a la derecha.
 *
 * Va en dos piezas (marco + cuerpo) porque la fila de "Clave de acceso"
 * ademas despliega un formulario: un <button> no puede envolver campos, asi
 * que el marco queda fuera y el boton solo cubre la fila.
 */
export const SET_CARD_CLS =
  'group rounded-[14px] border border-border bg-card transition-colors [transition-duration:140ms] hover:border-accent';

/** Cuerpo de la fila (.set): 16px de aire lateral y 14px arriba/abajo. */
export const SET_ROW_CLS =
  'flex w-full items-center gap-[13px] rounded-[14px] px-4 py-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/** Contenido de la fila (.set .bd + .set .go): casilla, textos y chevron. */
export function SettingsRowBody({
  icon,
  title,
  description,
  expanded,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  /** Solo en la fila que despliega: el chevron gira mientras esta abierta. */
  expanded?: boolean;
}) {
  return (
    <>
      <span className={tileCls('muted')}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-extrabold">{title}</span>
        <span className="mt-0.5 block max-w-[72ch] text-[12px] text-muted-foreground">
          {description}
        </span>
      </span>
      <ChevronRight
        aria-hidden
        className={cn(
          'h-4 w-4 shrink-0 text-hint transition-[color,transform] [transition-duration:140ms] group-hover:text-accent motion-reduce:transition-none',
          expanded && 'rotate-90',
        )}
      />
    </>
  );
}

/* ---------------------------- panel lateral ------------------------------ */

/**
 * Panel lateral de Ajustes: portal al body, velo, deslizamiento, Escape,
 * bloqueo del scroll del cuerpo y devolucion del foco a quien lo abrio.
 *
 * Es el mismo mecanismo que ya usaba el catalogo de paquetes; aqui vive
 * extraido para que no haya dos. (El catalogo sigue con el suyo a proposito:
 * funciona y migrarlo ahora solo añadiria riesgo sin darle nada al usuario.)
 */
export function SideDrawer({
  open,
  title,
  subtitle,
  busy = false,
  onClose,
  footer,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  /** Mientras se guarda el panel NO se cierra: si el guardado falla hay que
   *  poder corregir sin volver a teclearlo todo. */
  busy?: boolean;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = React.useState(false);
  const [rendered, setRendered] = React.useState(open);
  const [shown, setShown] = React.useState(false);
  const titleId = React.useId();

  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (open) {
      setRendered(true);
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const t = setTimeout(() => setRendered(false), 200);
    return () => clearTimeout(t);
  }, [open]);

  const close = React.useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  // Quien lo abrio, para devolverle el teclado al cerrar. Se captura cuando
  // APARECE y en una ref: React corre los efectos de los hijos ANTES que los
  // del padre, asi que el formulario ya se habria llevado el foco.
  const openerRef = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (rendered && !openerRef.current) {
      openerRef.current = document.activeElement as HTMLElement | null;
    }
    if (!rendered) openerRef.current = null;
  }, [rendered]);

  // Depende SOLO de `rendered`: si dependiera de `close` (que cambia de
  // identidad con `busy`), el cleanup arrancaria el foco en plena escritura.
  const closeRef = React.useRef(close);
  closeRef.current = close;
  React.useEffect(() => {
    if (!rendered) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      const opener = openerRef.current;
      if (opener?.isConnected) opener.focus();
    };
  }, [rendered]);

  if (!mounted || !rendered) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden
        onClick={close}
        className={cn(
          'absolute inset-0 bg-scrim/55 backdrop-blur-[2px] transition-opacity duration-200',
          shown ? 'opacity-100' : 'opacity-0',
        )}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'absolute right-0 top-0 flex h-full w-full flex-col bg-card shadow-[var(--shadow-float)] transition-transform duration-200 ease-out sm:w-[460px] sm:border-l sm:border-border',
          shown ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <header className="flex items-start gap-3 border-b border-border px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[15px] font-extrabold tracking-[-0.01em]">
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-0.5 text-[12px] text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            aria-label="Cerrar"
            title="Cerrar"
            className={cn(
              'grid h-8 w-8 shrink-0 place-items-center rounded-[9px] border border-input bg-card text-hint transition-colors [transition-duration:140ms] hover:border-accent hover:text-accent-ink disabled:opacity-60',
              FOCUS_RING,
            )}
          >
            <X className="h-[14px] w-[14px]" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>

        {footer ? (
          <footer className="flex flex-wrap items-center gap-2 border-t border-border bg-surface px-4 py-3">
            {footer}
          </footer>
        ) : null}
      </aside>
    </div>,
    document.body,
  );
}
