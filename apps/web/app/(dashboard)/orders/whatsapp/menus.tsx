'use client';

import { useEffect, useState } from 'react';
import {
  ChevronDown,
  Copy,
  Forward,
  Heart,
  Plus,
  Reply,
  Smile,
  Star,
  Trash2,
} from 'lucide-react';
import type { WaMessage } from '@smartlogistica/shared';

import { cn } from '@/lib/utils';

import { EMOJI_GROUPS, pushRecentEmoji, splitEmojis } from './emoji-picker';

/** Acciones del menu contextual (las implementa el panel). */
export interface BubbleActions {
  reply: (m: WaMessage) => void;
  react: (m: WaMessage, emoji: string) => void;
  forward: (m: WaMessage) => void;
  star: (m: WaMessage) => void;
  remove: (m: WaMessage) => void;
  favSticker: (m: WaMessage) => void;
  openSticker: (m: WaMessage) => void;
}

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

// Un SOLO popover de reacciones/menu abierto a la vez (como WhatsApp: abrir
// otro cierra el anterior; el click por fuera lo cierra el backdrop).
let waPopoverSeq = 0;
export function useSinglePopover(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const mine = ++waPopoverSeq;
    window.dispatchEvent(new CustomEvent('wa-popover', { detail: mine }));
    const onOther = (ev: Event) => {
      if ((ev as CustomEvent).detail !== mine) onClose();
    };
    window.addEventListener('wa-popover', onOther);
    return () => window.removeEventListener('wa-popover', onOther);
  }, [open, onClose]);
}

/**
 * Menu contextual del mensaje (flechita al pasar el mouse), calcado a
 * WhatsApp: la barra de REACCIONES siempre visible encima del menu; se abre
 * hacia ABAJO desde la mitad del mensaje (un poco encimado) si hay espacio, y
 * si no, hacia ARRIBA alineado a la esquina superior; con mini animacion.
 */
export interface MsgMenuAnchor {
  up: boolean;
  /** Con coordenadas: el menu ARRANCA justo en el punto del click derecho. */
  left?: number;
  top?: number;
  bottom?: number;
}

export function MsgMenu({
  m,
  mine,
  actions,
  open,
  onOpenChange,
}: {
  m: WaMessage;
  mine: boolean;
  actions: BubbleActions;
  open: MsgMenuAnchor | null;
  onOpenChange: (anchor: MsgMenuAnchor | null) => void;
}) {
  const [reacts, setReacts] = useState(false);
  const close = () => {
    onOpenChange(null);
    setReacts(false);
  };
  const POPUP_H = 440; // reacciones + menu, aprox
  const openMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    const anchor = (e.currentTarget.parentElement ?? e.currentTarget) as HTMLElement;
    const rect = anchor.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    const above = rect.top;
    onOpenChange({ up: below < POPUP_H && above > below });
  };
  const myEmoji = m.reactions.find((r) => r.mine)?.emoji ?? null;
  const pickReaction = (emoji: string) => {
    // Volver a tocar la MISMA reaccion la QUITA (como WhatsApp).
    const next = emoji && myEmoji === emoji ? '' : emoji;
    actions.react(m, next);
    if (next) pushRecentEmoji(next);
    close();
  };
  useSinglePopover(Boolean(open), close);
  const item = (
    icon: typeof Reply,
    label: string,
    onClick: () => void,
    danger = false,
  ): React.ReactNode => {
    const Icon = icon;
    return (
      <button
        key={label}
        type="button"
        onClick={onClick}
        className={cn(
          'flex w-full items-center gap-3 px-4 py-2 text-left text-[14px] transition-colors hover:bg-[#f5f6f6] dark:hover:bg-white/5',
          danger ? 'text-[#f15c6d]' : 'text-[#111b21] dark:text-[#e9edef]',
        )}
      >
        <Icon className="h-[17px] w-[17px]" />
        {label}
      </button>
    );
  };
  return (
    <>
      <button
        type="button"
        onClick={openMenu}
        className={cn(
          'absolute right-0.5 top-0.5 z-10 rounded-full p-0.5 opacity-0 transition-opacity group-hover:opacity-100',
          mine
            ? 'bg-[#d9fdd3]/80 text-[#54656f] dark:bg-[#005c4b]/80 dark:text-[#aebac1]'
            : 'bg-white/80 text-[#8696a0] dark:bg-[#202c33]/80',
        )}
        aria-label="Opciones del mensaje"
      >
        <ChevronDown className="h-4 w-4" />
      </button>
      {open ? (
        <>
          <button type="button" className="fixed inset-0 z-30 cursor-default" onClick={close} aria-label="Cerrar" />
          <div
            className={cn(
              'wa-pop absolute z-40 flex w-64 flex-col gap-1.5',
              open.left == null && (mine ? 'right-0 items-end' : 'left-0 items-start'),
              // ABAJO: desde la mitad del mensaje, un poco encimado.
              // ARRIBA: pegado sobre la esquina superior.
              open.left == null && (open.up ? 'bottom-[calc(100%-6px)]' : 'top-[calc(50%-4px)]'),
              open.left != null && 'items-start',
            )}
            style={{
              transformOrigin: `${open.up ? 'bottom' : 'top'} ${open.left != null ? 'left' : mine ? 'right' : 'left'}`,
              // Click derecho: el menu ARRANCA en el punto exacto del cursor.
              ...(open.left != null
                ? { left: open.left, ...(open.up ? { bottom: open.bottom } : { top: open.top }) }
                : {}),
            }}
          >
            {/* Barra de REACCIONES siempre encima del menu (tamaño WhatsApp). */}
            <div className="shadow-float flex items-center rounded-full border border-border bg-white px-1 py-[3px] dark:bg-[#233138]">
              {QUICK_REACTIONS.map((e) => (
                <button
                  key={e}
                  type="button"
                  className={cn(
                    'rounded-full p-[4px] text-[19px] leading-[24px] transition-transform hover:scale-125',
                    myEmoji === e && 'bg-black/10 dark:bg-white/15',
                  )}
                  onClick={() => pickReaction(e)}
                >
                  {e}
                </button>
              ))}
              <button
                type="button"
                className="ml-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/5 text-[#54656f] hover:bg-black/10 dark:bg-white/10 dark:text-[#8696a0]"
                onClick={() => setReacts((v) => !v)}
                aria-label="Más emojis"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="shadow-float w-60 rounded-xl border border-border bg-white py-1.5 dark:bg-[#233138]">
              {reacts ? (
                <div className="h-52 overflow-y-auto px-2">
                  <div className="flex flex-wrap">
                    {EMOJI_GROUPS.flatMap((g) => splitEmojis(g.list)).map((e, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => pickReaction(e)}
                        className="rounded-lg p-1 text-[22px] leading-[28px] transition-transform hover:scale-110"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {item(Reply, 'Responder', () => {
                    actions.reply(m);
                    close();
                  })}
                  {m.kind === 'text' && m.body
                    ? item(Copy, 'Copiar', () => {
                      void navigator.clipboard.writeText(m.body ?? '');
                      close();
                    })
                    : null}
                  {item(Forward, 'Reenviar', () => {
                    actions.forward(m);
                    close();
                  })}
                  {item(Star, m.starred ? 'Quitar destacado' : 'Destacar', () => {
                    actions.star(m);
                    close();
                  })}
                  {m.kind === 'sticker' && m.mediaUrl
                    ? item(Heart, 'Añadir a Favoritos', () => {
                      actions.favSticker(m);
                      close();
                    })
                    : null}
                  <div className="my-1 border-t border-border" />
                  {item(
                    Trash2,
                    'Eliminar',
                    () => {
                      actions.remove(m);
                      close();
                    },
                    true,
                  )}
                </>
              )}
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}

/**
 * Barra de reacciones ANCLADA a la burbuja, calcada a WhatsApp: se monta
 * sobre el borde superior con ~3 emojis ENCIMA de la burbuja y el resto por
 * fuera — en recibidos el tercero queda al filo del final de la burbuja; en
 * enviados, el quinto al filo del inicio. Sin importar el tamaño del mensaje.
 */
export function AnchoredReactionBar({
  m,
  mine,
  actions,
  onClose,
}: {
  m: WaMessage;
  mine: boolean;
  actions: BubbleActions;
  onClose: () => void;
}) {
  const [more, setMore] = useState(false);
  const myEmoji = m.reactions.find((r) => r.mine)?.emoji ?? null;
  const pick = (e: string) => {
    // Tocar la MISMA reaccion la quita (toggle, como WhatsApp).
    const next = e && myEmoji === e ? '' : e;
    actions.react(m, next);
    if (next) pushRecentEmoji(next);
    onClose();
  };
  useSinglePopover(true, onClose);
  return (
    <>
      <button type="button" className="fixed inset-0 z-30 cursor-default" onClick={onClose} aria-label="Cerrar" />
      <div
        className={cn('wa-pop absolute z-40 flex flex-col gap-1', mine ? 'items-end' : 'items-start')}
        style={{
          // Apenas ~3px de solape con la burbuja (encima "por un milimetro").
          top: '-34px',
          // Casillas FIJAS de 30px: el 3er emoji (recibidos) o el 5o
          // (enviados) queda AL PIXEL del borde de la burbuja:
          // borde + padding(5) + 3 casillas(90) = 95px.
          ...(mine ? { right: 'calc(100% - 95px)' } : { left: 'calc(100% - 95px)' }),
          transformOrigin: mine ? 'top right' : 'top left',
        }}
      >
        <div className="shadow-float flex items-center rounded-full border border-border bg-white px-1 py-[3px] dark:bg-[#233138]">
          {QUICK_REACTIONS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => pick(e)}
              className={cn(
                'flex h-[30px] w-[30px] items-center justify-center rounded-full text-[19px] leading-none transition-transform hover:scale-125',
                myEmoji === e && 'bg-black/10 dark:bg-white/15',
              )}
            >
              {e}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setMore((v) => !v)}
            className="ml-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/5 text-[#54656f] hover:bg-black/10 dark:bg-white/10 dark:text-[#8696a0]"
            aria-label="Más emojis"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {more ? (
          <div className="shadow-float h-48 w-64 overflow-y-auto rounded-2xl border border-border bg-white p-2 dark:bg-[#233138]">
            <div className="flex flex-wrap">
              {EMOJI_GROUPS.flatMap((g) => splitEmojis(g.list)).map((e, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => pick(e)}
                  className="rounded-lg p-1 text-[20px] leading-[26px] transition-transform hover:scale-110"
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

/**
 * Botones FLOTANTES al lado de la burbuja (hover): reaccionar siempre, y
 * reenviar directo cuando es multimedia/archivo — como WhatsApp Web.
 */
export function HoverActions({
  m,
  mine,
  actions,
  onReact,
}: {
  m: WaMessage;
  mine: boolean;
  actions: BubbleActions;
  onReact: () => void;
}) {
  const media = m.kind !== 'text';
  return (
    <div
      className={cn(
        'absolute top-1/2 z-10 flex -translate-y-1/2 items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100',
        mine ? 'right-full mr-2' : 'left-full ml-2',
      )}
    >
      {media ? (
        <button
          type="button"
          onClick={() => actions.forward(m)}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-[#8696a0] shadow-md transition-colors hover:text-[#54656f] dark:bg-[#233138]"
          aria-label="Reenviar"
          title="Reenviar"
        >
          <Forward className="h-4 w-4" />
        </button>
      ) : null}
      <button
        type="button"
        onClick={onReact}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-[#8696a0] shadow-md transition-colors hover:text-[#54656f] dark:bg-[#233138]"
        aria-label="Reaccionar"
        title="Reaccionar"
      >
        <Smile className="h-4 w-4" />
      </button>
    </div>
  );
}

/** Ancla del menu en el PUNTO del click derecho (relativo al contenedor). */
export function anchorAtPoint(e: React.MouseEvent, el: HTMLElement | null): MsgMenuAnchor | null {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const below = window.innerHeight - e.clientY;
  const up = below < 440 && e.clientY > below;
  const left = Math.min(Math.max(0, e.clientX - rect.left), Math.max(0, rect.width - 264));
  return up
    ? { up, left, bottom: rect.height - (e.clientY - rect.top) }
    : { up, left, top: e.clientY - rect.top };
}
