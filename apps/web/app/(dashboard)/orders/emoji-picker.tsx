'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils';

import { EMOJI_CATEGORIES, QUICK_REACTIONS } from './emoji-data';

/**
 * Picker de emojis (sin dependencias): fila de reacciones rapidas + lista
 * completa por categorias. Se posiciona junto al punto de apertura (portal
 * fijo, ajustado para no salirse de la pantalla).
 */
export function EmojiPicker({
  anchor,
  onPick,
  onClose,
}: {
  /** Punto de apertura (coordenadas de viewport del boton que lo abrio). */
  anchor: { x: number; y: number };
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const [category, setCategory] = useState(EMOJI_CATEGORIES[0]!.id);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  const W = 344;
  const H = 400;
  const pad = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.min(Math.max(pad, anchor.x - W / 2), vw - W - pad);
  // Preferir abrir hacia arriba (el boton suele estar abajo, cerca del mensaje).
  const top = anchor.y - H - 10 >= pad ? anchor.y - H - 10 : Math.min(anchor.y + 10, vh - H - pad);

  const active = EMOJI_CATEGORIES.find((c) => c.id === category) ?? EMOJI_CATEGORIES[0]!;

  return createPortal(
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0" onClick={onClose} />
      <div
        ref={panelRef}
        style={{ left, top, width: W, height: H }}
        className="absolute flex flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
      >
        {/* Reacciones rapidas */}
        <div className="flex items-center justify-around border-b border-border px-2 py-1.5">
          {QUICK_REACTIONS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => onPick(e)}
              className="rounded-lg p-1.5 text-xl transition-transform hover:scale-125 hover:bg-muted"
            >
              {e}
            </button>
          ))}
        </div>

        {/* Pestañas de categoria: DESPLAZABLES (con 11 categorias, apretarlas
            con justify-between dejaba las ultimas — Simbolos, Banderas —
            aplastadas e invisibles). */}
        <div className="scrollbar-none flex items-center gap-0.5 overflow-x-auto border-b border-border px-1.5 py-1">
          {EMOJI_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              title={c.label}
              onClick={() => setCategory(c.id)}
              className={cn(
                'shrink-0 rounded-md px-1.5 py-1 text-base transition-colors',
                category === c.id ? 'bg-muted' : 'opacity-60 hover:bg-muted hover:opacity-100',
              )}
            >
              {c.icon}
            </button>
          ))}
        </div>

        {/* Grilla */}
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <p className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {active.label}
          </p>
          <div className="grid grid-cols-8">
            {active.emojis.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => onPick(e)}
                className="rounded-md p-1 text-xl leading-none transition-transform hover:scale-125 hover:bg-muted"
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
