'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';

import { FOCUS_RING } from './settings-ui';

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
