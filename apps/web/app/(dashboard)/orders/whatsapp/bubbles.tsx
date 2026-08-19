'use client';

import { useRef, useState } from 'react';
import { Download, Star } from 'lucide-react';
import type { WaMessage } from '@smartlogistica/shared';

import { cn } from '@/lib/utils';

import { WaAudio } from './audio';
import { dayLabel, emojiCount, failText, isEmojiOnly, timeOf } from './helpers';
import { Tail, Ticks } from './icons';
import {
  AnchoredReactionBar,
  HoverActions,
  MsgMenu,
  anchorAtPoint,
  type BubbleActions,
  type MsgMenuAnchor,
} from './menus';
import { renderBodyWithPhones } from './phone-links';

/* ============================== Burbujas ============================== */

export function WaBubble({
  message: m,
  prev,
  base,
  actions,
}: {
  message: WaMessage;
  prev?: WaMessage;
  base: string;
  actions: BubbleActions;
}) {
  const mine = m.direction === 'out';
  const pending = m.id.startsWith('temp-');
  const [reactOpen, setReactOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState<MsgMenuAnchor | null>(null);
  const [flash, setFlash] = useState(false);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const bareRef = useRef<HTMLDivElement>(null);
  const day = (iso: string) => new Date(iso).toDateString();
  const newDay = !prev || day(prev.createdAt) !== day(m.createdAt);
  const grouped = !newDay && prev && prev.direction === m.direction;
  const hasReactions = m.reactions.length > 0;

  // Solo UN emoji va suelto y gigante; de dos en adelante van EN burbuja
  // (mas grandes que el texto), calcado a WhatsApp.
  const emojiOnly =
    m.kind === 'text' &&
    isEmojiOnly(m.body) &&
    emojiCount(m.body ?? '') === 1 &&
    m.buttons.length === 0 &&
    !m.replyTo;
  const sticker = m.kind === 'sticker';

  return (
    <>
      {newDay ? (
        <div className="my-3 flex justify-center">
          <span className="rounded-lg bg-white px-3 py-1 text-[12px] font-medium text-[#54656f] shadow-sm dark:bg-[#182229] dark:text-[#8696a0]">
            {dayLabel(m.createdAt)}
          </span>
        </div>
      ) : null}
      <div
        className={cn(
          'flex',
          mine ? 'justify-end' : 'justify-start',
          grouped ? 'mt-[2px]' : 'mt-3',
          hasReactions && 'mb-4',
          flash && 'wa-reply-flash rounded-lg',
        )}
        // DOBLE CLIC solo en el espacio LATERAL de la fila: responder (con
        // destello verde). DENTRO de la burbuja no aplica — ahi el doble
        // clic queda libre (seleccionar texto, controles del audio, etc.).
        onDoubleClick={(e) => {
          const t = e.target as Node;
          if (bubbleRef.current?.contains(t) || bareRef.current?.contains(t)) return;
          setFlash(true);
          actions.reply(m);
        }}
        onAnimationEnd={() => setFlash(false)}
      >
        {emojiOnly || sticker ? (
          <BareMessage
            message={m}
            mine={mine}
            pending={pending}
            sticker={sticker}
            actions={actions}
            menuOpen={menuOpen}
            onMenuChange={setMenuOpen}
            containerRef={bareRef}
          />
        ) : (
          <div
            ref={bubbleRef}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenuOpen(anchorAtPoint(e, bubbleRef.current));
            }}
            className={cn('group relative max-w-[85%] md:max-w-[65%]', pending && 'opacity-90')}
          >
            {!grouped ? <Tail mine={mine} /> : null}
            <MsgMenu m={m} mine={mine} actions={actions} open={menuOpen} onOpenChange={setMenuOpen} />
            <HoverActions m={m} mine={mine} actions={actions} onReact={() => setReactOpen(true)} />
            {reactOpen ? (
              <AnchoredReactionBar m={m} mine={mine} actions={actions} onClose={() => setReactOpen(false)} />
            ) : null}
            <div
              className={cn(
                'relative overflow-hidden text-[14.2px] leading-[19px] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]',
                mine
                  ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#005c4b] dark:text-[#e9edef]'
                  : 'bg-white text-[#111b21] dark:bg-[#202c33] dark:text-[#e9edef]',
                grouped
                  ? 'rounded-[7.5px]'
                  : mine
                    ? 'rounded-[7.5px] rounded-tr-none'
                    : 'rounded-[7.5px] rounded-tl-none',
              )}
            >
              <BubbleContent message={m} mine={mine} pending={pending} base={base} />
            </div>
            <ReactionChips message={m} mine={mine} actions={actions} />
          </div>
        )}
      </div>
    </>
  );
}

/** Emojis grandes y stickers: SIN burbuja (como WhatsApp), hora debajo. */
function BareMessage({
  message: m,
  mine,
  pending,
  sticker,
  actions,
  menuOpen,
  onMenuChange,
  containerRef,
}: {
  message: WaMessage;
  mine: boolean;
  pending: boolean;
  sticker: boolean;
  actions: BubbleActions;
  menuOpen: MsgMenuAnchor | null;
  onMenuChange: (a: MsgMenuAnchor | null) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [reactOpen, setReactOpen] = useState(false);
  return (
    <div
      ref={containerRef}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenuChange(anchorAtPoint(e, containerRef.current));
      }}
      className={cn('group relative flex max-w-[85%] flex-col md:max-w-[65%]', mine ? 'items-end' : 'items-start')}
    >
      <MsgMenu m={m} mine={mine} actions={actions} open={menuOpen} onOpenChange={onMenuChange} />
      <HoverActions m={m} mine={mine} actions={actions} onReact={() => setReactOpen(true)} />
      {reactOpen ? (
        <AnchoredReactionBar m={m} mine={mine} actions={actions} onClose={() => setReactOpen(false)} />
      ) : null}
      {sticker ? (
        m.mediaUrl ? (
          // Clic en el sticker -> visor con "Añadir a Favoritos" (como WhatsApp).
          <button type="button" onClick={() => actions.openSticker(m)} className="cursor-pointer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.mediaUrl} alt="Sticker" decoding="async" className="h-auto w-[180px]" />
          </button>
        ) : (
          <span className="text-[13px] italic text-[#54656f] dark:text-[#8696a0]">🩵 Sticker (no se pudo descargar)</span>
        )
      ) : (
        <p className="whitespace-pre-wrap break-words text-[44px] leading-[52px]">{m.body}</p>
      )}
      {/* Pastillita de hora + chulitos (verde/blanca), como en WhatsApp. */}
      <span
        className={cn(
          'mt-1 flex items-center gap-1 rounded-[7.5px] px-1.5 py-[2px] text-[11px] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]',
          mine
            ? 'bg-[#d9fdd3] text-[#667781] dark:bg-[#005c4b] dark:text-[#8696a0]'
            : 'bg-white text-[#667781] dark:bg-[#202c33] dark:text-[#8696a0]',
        )}
      >
        {timeOf(m.createdAt)}
        {mine ? <Ticks status={m.status} pending={pending} failText={failText(m)} /> : null}
      </span>
      <ReactionChips message={m} mine={mine} bare actions={actions} />
    </div>
  );
}

/** Chips de reaccion pegados al borde inferior de la burbuja. Tocar el chip
 *  QUITA tu reaccion (como WhatsApp). */
function ReactionChips({
  message: m,
  mine,
  bare = false,
  actions,
}: {
  message: WaMessage;
  mine: boolean;
  bare?: boolean;
  actions?: BubbleActions;
}) {
  if (m.reactions.length === 0) return null;
  const emojis = [...new Set(m.reactions.map((r) => r.emoji))];
  const hasMine = m.reactions.some((r) => r.mine);
  return (
    <button
      type="button"
      onClick={() => {
        if (hasMine && actions) actions.react(m, '');
      }}
      title={hasMine ? 'Quitar mi reacción' : undefined}
      className={cn(
        'absolute z-10 flex items-center rounded-full border border-black/5 bg-white px-1.5 py-[1px] text-[13px] shadow-sm dark:border-white/10 dark:bg-[#202c33]',
        hasMine && actions ? 'cursor-pointer' : 'cursor-default',
        bare ? 'bottom-3' : '-bottom-3.5',
        mine ? 'right-1' : 'left-1',
      )}
    >
      {emojis.join('')}
      {m.reactions.length > 1 ? (
        <span className="ml-0.5 text-[11px] text-[#667781] dark:text-[#8696a0]">{m.reactions.length}</span>
      ) : null}
    </button>
  );
}

/** Cita (respuesta): barrita de color + nombre + resumen, como WhatsApp. */
function ReplyQuote({ replyTo, mine }: { replyTo: NonNullable<WaMessage['replyTo']>; mine: boolean }) {
  const fromMe = replyTo.direction === 'out';
  const color = fromMe ? '#06cf9c' : '#e17bb5';
  const label = fromMe ? (replyTo.authorName ?? 'Tú') : (replyTo.authorName ?? 'Cliente');
  const snippet =
    replyTo.kind === 'text'
      ? (replyTo.body ?? '')
      : replyTo.kind === 'image'
        ? '📷 Foto'
        : replyTo.kind === 'video'
          ? '🎬 Video'
          : replyTo.kind === 'audio'
            ? '🎙️ Audio'
            : replyTo.kind === 'sticker'
              ? '🩵 Sticker'
              : `📎 ${replyTo.body ?? 'Archivo'}`;
  return (
    <div
      className={cn(
        'mx-1 mt-1 flex overflow-hidden rounded-[6px]',
        mine ? 'bg-black/[0.06] dark:bg-black/20' : 'bg-black/[0.05] dark:bg-white/5',
      )}
    >
      <span className="w-1 shrink-0" style={{ backgroundColor: color }} />
      <div className="min-w-0 px-2 py-1">
        <p className="truncate text-[12.5px] font-semibold" style={{ color }}>
          {label}
        </p>
        <p className="line-clamp-2 text-[12.5px] text-[#667781] dark:text-[#8696a0]">{snippet}</p>
      </div>
    </div>
  );
}

/** Contenido interno de la burbuja segun el tipo. */
function BubbleContent({
  message: m,
  mine,
  pending,
  base,
}: {
  message: WaMessage;
  mine: boolean;
  pending: boolean;
  base: string;
}) {
  const timeRow = (onMedia = false) => (
    <span
      className={cn(
        'flex items-center gap-1 text-[11px]',
        onMedia ? 'text-white' : 'text-[#667781] dark:text-[#8696a0]',
      )}
    >
      {m.starred ? <Star className="h-[11px] w-[11px] fill-current" /> : null}
      {m.edited ? <span>Editado</span> : null}
      {timeOf(m.createdAt)}
      {mine ? (
        <Ticks status={m.status} pending={pending} onMedia={onMedia} failText={failText(m)} />
      ) : null}
    </span>
  );

  // ===== Medios (foto / video) =====
  if ((m.kind === 'image' || m.kind === 'video') && m.mediaUrl) {
    const caption = m.body && !/\.(jpe?g|png|gif|webp|mp4|mov|3gp)$/i.test(m.body) ? m.body : null;
    return (
      <div className="p-[3px]">
        {m.replyTo ? <ReplyQuote replyTo={m.replyTo} mine={mine} /> : null}
        <div className="relative overflow-hidden rounded-[6px]">
          {m.kind === 'image' ? (
            <a href={m.mediaUrl} target="_blank" rel="noreferrer" className="block bg-black/5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.mediaUrl} alt={caption ?? 'Imagen'} decoding="async" className="max-h-[320px] w-full min-w-[180px] object-cover" />
            </a>
          ) : (
            <video src={m.mediaUrl} controls preload="metadata" className="block max-h-[320px] w-[280px] max-w-full bg-black" />
          )}
          {!caption ? (
            <span className="pointer-events-none absolute bottom-0 right-0 flex items-center gap-1 rounded-tl-md bg-gradient-to-l from-black/45 to-transparent py-0.5 pl-6 pr-1.5">
              {timeRow(true)}
            </span>
          ) : null}
        </div>
        {caption ? (
          <div className="px-1.5 pb-1 pt-1">
            <p className="whitespace-pre-wrap break-words">{renderBodyWithPhones(caption)}</p>
            <div className="flex justify-end">{timeRow()}</div>
          </div>
        ) : null}
      </div>
    );
  }

  // ===== Audio (nota de voz calcada a WhatsApp) =====
  if (m.kind === 'audio' && m.mediaUrl) {
    return <WaAudio message={m} mine={mine} pending={pending} base={base} />;
  }

  // ===== Documento =====
  if (m.kind === 'file' && m.mediaUrl) {
    return (
      <div className="p-[5px]">
        {m.replyTo ? <ReplyQuote replyTo={m.replyTo} mine={mine} /> : null}
        <DocCard name={m.body ?? 'Documento'} url={m.mediaUrl} mine={mine} />
        <div className="flex justify-end px-1 pt-0.5">{timeRow()}</div>
      </div>
    );
  }

  // ===== Medio que no se pudo descargar =====
  if (m.kind !== 'text') {
    const label =
      m.kind === 'image' ? '📷 Foto' : m.kind === 'video' ? '🎬 Video' : m.kind === 'audio' ? '🎙️ Audio' : '📎 Archivo';
    return (
      <div className="px-2 py-1.5">
        <p className="italic text-[#667781] dark:text-[#8696a0]">
          {label}
          {m.body ? ` · ${m.body}` : ' (no se pudo descargar)'}
        </p>
        <div className="flex justify-end">{timeRow()}</div>
      </div>
    );
  }

  // ===== Texto (con cita y botones de plantilla) =====
  // La hora va ANCLADA abajo-derecha (como WhatsApp): el espaciador invisible
  // al final del texto le reserva el campo en la ultima linea.
  // Emojis solos (2 o mas): en burbuja pero MAS GRANDES, como WhatsApp.
  const emojiBig = isEmojiOnly(m.body) && m.buttons.length === 0;
  return (
    <div>
      {m.replyTo ? <ReplyQuote replyTo={m.replyTo} mine={mine} /> : null}
      <div className="relative px-2 pb-[7px] pt-[6px]">
        <p className={cn('whitespace-pre-wrap break-words', emojiBig && 'text-[28px] leading-[38px]')}>
          {m.body ? renderBodyWithPhones(m.body) : null}
          <span
            className="inline-block h-0"
            // El espaciador reserva TODO lo que lleve la fila de la hora:
            // base (hora+chulitos) + "Editado" (+44px) + estrella (+15px).
            // Si no cabe junto al texto, salta solo a la linea de abajo.
            style={{ width: (mine ? 72 : 62) + (m.edited ? 32 : 0) + (m.starred ? 15 : 0) }}
            aria-hidden
          />
        </p>
        {/* bottom-[Npx]: distancia al FONDO de la burbuja -> MAS PEQUEÑO = MAS
            ABAJO baja toda la fila junta (Editado + hora + chulitos). */}
        <span className="absolute bottom-[-1px] right-[7px]">{timeRow()}</span>
      </div>
      {m.buttons && m.buttons.length > 0 ? (
        <div>
          {m.buttons.map((b, i) => (
            <div
              key={i}
              className="flex items-center justify-center gap-1.5 border-t border-black/[0.08] py-2 text-[14px] font-medium text-[#00a5f4] dark:border-white/10 dark:text-[#53bdeb]"
            >
              {b}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Tarjeta de documento (PDF/Excel/Word...), como la de WhatsApp. */
function DocCard({ name, url, mine }: { name: string; url: string; mine: boolean }) {
  const ext = (/\.([a-z0-9]{1,6})$/i.exec(name)?.[1] ?? '').toUpperCase();
  const tone = /^PDF$/.test(ext)
    ? 'bg-[#f04438]'
    : /^(XLS|XLSX|CSV)$/.test(ext)
      ? 'bg-[#12b76a]'
      : /^(DOC|DOCX)$/.test(ext)
        ? 'bg-[#2e90fa]'
        : 'bg-[#98a2b3]';
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'flex items-center gap-2.5 rounded-[6px] px-2.5 py-2.5 transition-colors',
        mine
          ? 'bg-black/[0.06] hover:bg-black/[0.09] dark:bg-black/20 dark:hover:bg-black/30'
          : 'bg-black/[0.04] hover:bg-black/[0.07] dark:bg-white/5 dark:hover:bg-white/10',
      )}
    >
      <span className={cn('flex h-9 w-8 shrink-0 items-center justify-center rounded-[5px] text-[9px] font-bold text-white', tone)}>
        {ext || 'DOC'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px]">{name}</span>
        <span className="block text-[11.5px] uppercase text-[#667781] dark:text-[#8696a0]">
          {ext || 'Documento'}
        </span>
      </span>
      <Download className="h-4 w-4 shrink-0 text-[#667781] dark:text-[#8696a0]" />
    </a>
  );
}
