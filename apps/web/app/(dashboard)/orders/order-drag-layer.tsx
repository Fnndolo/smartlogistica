'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, useMotionValue, useSpring } from 'framer-motion';
import { ArrowRight, Ban, Undo2 } from 'lucide-react';
import type { WarehouseSummary } from '@smartlogistica/shared';

import { cn, titleCaseName } from '@/lib/utils';

import {
  isValidTarget,
  orderDrag,
  useOrderDrag,
  type DropTarget,
  type OrderDragPayload,
} from './order-drag';

/** Medidas de la tarjeta que vuela (para centrarla en el destino al soltar). */
const CARD_W = 272;
const CARD_H = 64;
/** La tarjeta va un poco abajo y a la derecha del puntero: no tapa el destino. */
const OFFSET = { x: 14, y: 12 };

type Phase =
  | { kind: 'drag' }
  | { kind: 'drop'; to: { x: number; y: number } }
  | { kind: 'cancel'; to: { x: number; y: number } };

/**
 * La capa del ARRASTRE: la tarjeta que sigue al puntero (con resorte, para que
 * se sienta fisica y no pegada al cursor), el destino bajo el puntero y el
 * soltar. Al soltar en una sede la tarjeta VUELA hacia ella y se encoge; en el
 * aire, regresa a su fila. Va en un portal, sin eventos de puntero, para que
 * elementFromPoint vea lo que hay DEBAJO de ella.
 */
export function OrderDragLayer({ warehouses }: { warehouses: WarehouseSummary[] }) {
  const drag = useOrderDrag();
  // La sesion sobrevive al fin del arrastre lo justo para animar el vuelo.
  const [session, setSession] = useState<{ payload: OrderDragPayload; phase: Phase } | null>(null);
  const overRef = useRef<{ target: DropTarget | null; el: Element | null }>({
    target: null,
    el: null,
  });

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 620, damping: 42, mass: 0.55 });
  const sy = useSpring(y, { stiffness: 620, damping: 42, mass: 0.55 });

  // Arranca un arrastre: la tarjeta aparece donde se agarro (sin resorte desde 0,0).
  const payload = drag?.payload ?? null;
  useEffect(() => {
    if (!payload) return;
    const px = payload.origin.x + OFFSET.x;
    const py = payload.origin.y + OFFSET.y;
    x.jump(px);
    y.jump(py);
    sx.jump(px);
    sy.jump(py);
    overRef.current = { target: null, el: null };
    setSession({ payload, phase: { kind: 'drag' } });
  }, [payload, x, y, sx, sy]);

  const dragging = session?.phase.kind === 'drag';
  useEffect(() => {
    if (!dragging || !session) return;
    const current = session.payload;
    const root = document.documentElement;
    const prevCursor = root.style.cursor;
    const prevSelect = root.style.userSelect;
    root.style.cursor = 'grabbing';
    root.style.userSelect = 'none';
    window.getSelection()?.removeAllRanges();

    const finish = (dropAt: { target: DropTarget; el: Element } | null) => {
      if (dropAt) {
        const r = dropAt.el.getBoundingClientRect();
        const to = { x: r.left + r.width / 2 - CARD_W / 2, y: r.top + r.height / 2 - CARD_H / 2 };
        x.set(to.x);
        y.set(to.y);
        setSession({ payload: current, phase: { kind: 'drop', to } });
        orderDrag.end(dropAt.target);
        current.drop(dropAt.target);
      } else {
        const to = { x: current.origin.x + OFFSET.x, y: current.origin.y + OFFSET.y };
        x.set(to.x);
        y.set(to.y);
        setSession({ payload: current, phase: { kind: 'cancel', to } });
        orderDrag.end(null);
      }
    };

    const onMove = (e: PointerEvent) => {
      // Un arrastre MUY rapido puede soltarse antes de que esta capa escuche
      // el pointerup: sin boton apretado, el arrastre ya termino.
      if (e.buttons === 0) {
        onUp();
        return;
      }
      x.set(e.clientX + OFFSET.x);
      y.set(e.clientY + OFFSET.y);
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-drop-target]');
      const target = (el as HTMLElement | null)?.dataset.dropTarget ?? null;
      overRef.current = { target, el: el ?? null };
      orderDrag.setOver(target);
    };
    const onUp = () => {
      const { target, el } = overRef.current;
      finish(target && el && isValidTarget(current, target) ? { target, el } : null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(null);
    };
    const onCancel = () => finish(null);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      root.style.cursor = prevCursor;
      root.style.userSelect = prevSelect;
    };
  }, [dragging, session, x, y]);

  if (!session || typeof document === 'undefined') return null;

  const { payload: p, phase } = session;
  const count = p.orderIds.length;
  const first = p.preview[0];
  const over = phase.kind === 'drag' ? (drag?.over ?? null) : null;
  const valid = over ? isValidTarget(p, over) : false;
  const name = (t: DropTarget) =>
    t === 'general' ? 'generales' : (warehouses.find((w) => w.id === t)?.name ?? 'la sede');

  const hint = !over
    ? { tone: 'idle' as const, text: 'Suelta sobre una sede del menú' }
    : valid
      ? {
          tone: 'go' as const,
          text:
            over === 'general'
              ? 'Devolver a generales'
              : p.fromWarehouseId
                ? `Transferir a ${name(over)}`
                : `Asignar a ${name(over)}`,
        }
      : {
          tone: 'no' as const,
          text:
            over === 'general' && p.fromWarehouseId
              ? 'Los montados a mano no van a generales'
              : 'Ya está aquí',
        };

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[80]" aria-hidden>
      <motion.div
        style={{ x: sx, y: sy, width: CARD_W, transformOrigin: '50% 50%' }}
        className="absolute left-0 top-0"
        initial={{ opacity: 0, scale: 0.94, rotate: 0 }}
        animate={
          phase.kind === 'drag'
            ? { opacity: 1, scale: valid ? 0.97 : 1.02, rotate: valid ? 0 : -1.5 }
            : phase.kind === 'drop'
              ? { opacity: 0, scale: 0.28, rotate: 0 }
              : { opacity: 0, scale: 0.92, rotate: 0 }
        }
        transition={
          phase.kind === 'drag'
            ? { type: 'spring', stiffness: 420, damping: 30 }
            : { duration: phase.kind === 'drop' ? 0.32 : 0.26, ease: [0.32, 0.72, 0, 1] }
        }
        onAnimationComplete={() => {
          if (phase.kind !== 'drag') setSession(null);
        }}
      >
        {/* Pila: con varios pedidos asoman tarjetas detras (como un mazo). */}
        {count > 1 ? (
          <>
            <span className="absolute inset-x-3 -bottom-[10px] h-full rounded-xl border border-border bg-card/80 shadow-sm" />
            <span className="absolute inset-x-1.5 -bottom-[5px] h-full rounded-xl border border-border bg-card/90 shadow-sm" />
          </>
        ) : null}
        <div
          className={cn(
            'shadow-pop relative flex items-center gap-3 rounded-xl border bg-popover px-3 py-2.5 transition-colors duration-150',
            valid ? 'border-accent ring-2 ring-accent/25' : 'border-border',
          )}
          style={{ minHeight: CARD_H }}
        >
          <span
            className={cn(
              'grid h-9 w-9 shrink-0 place-items-center rounded-[10px] font-mono text-[12px] font-bold tabular-nums transition-colors duration-150',
              valid ? 'bg-accent text-accent-foreground' : 'bg-wash text-accent-ink',
            )}
          >
            {count > 99 ? '99+' : count}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold leading-tight">
              {count > 1
                ? `${count} pedidos`
                : first
                  ? titleCaseName(first.customerName)
                  : 'Pedido'}
            </p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
              {count > 1
                ? p.preview
                    .slice(0, 3)
                    .map((o) => o.externalId)
                    .join(' · ') + (count > 3 ? ' …' : '')
                : (first?.externalId ?? '')}
              {count === 1 && first?.product ? (
                <span className="font-sans"> · {first.product}</span>
              ) : null}
            </p>
          </div>
        </div>
        {/* A donde va: se lee SIN soltar (asignar / transferir / devolver). */}
        <motion.div
          key={hint.text}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: phase.kind === 'drag' ? 1 : 0, y: 0 }}
          transition={{ duration: 0.14 }}
          className={cn(
            'mt-2.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold shadow-sm',
            hint.tone === 'go' && 'bg-accent text-accent-foreground',
            hint.tone === 'no' && 'bg-muted text-muted-foreground',
            hint.tone === 'idle' && 'border border-border bg-popover text-muted-foreground',
          )}
        >
          {hint.tone === 'go' ? (
            over === 'general' ? (
              <Undo2 className="h-3 w-3" />
            ) : (
              <ArrowRight className="h-3 w-3" />
            )
          ) : hint.tone === 'no' ? (
            <Ban className="h-3 w-3" />
          ) : null}
          {hint.text}
        </motion.div>
      </motion.div>
    </div>,
    document.body,
  );
}
