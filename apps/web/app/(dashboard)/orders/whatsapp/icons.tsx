'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Clock3 } from 'lucide-react';
import type { WaMessage } from '@smartlogistica/shared';

import { cn } from '@/lib/utils';

/* ======================= Fondo doodle (SVG inline) ======================= */

const doodleSvg = (stroke: string, opacity: number): string =>
  `<svg xmlns='http://www.w3.org/2000/svg' width='360' height='360' viewBox='0 0 360 360' fill='none' stroke='${stroke}' stroke-opacity='${opacity}' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'>` +
  // corazon / estrella / nota musical / camara / nube
  `<path d='M30 44c-6-8 2-18 10-12 8-6 16 4 10 12l-10 10z'/>` +
  `<path d='M96 24l4 9 10 1-7 7 2 10-9-5-9 5 2-10-7-7 10-1z'/>` +
  `<path d='M168 22v26m0-26 14-4v24'/><circle cx='163' cy='50' r='5'/><circle cx='177' cy='44' r='5'/>` +
  `<rect x='232' y='28' width='34' height='24' rx='5'/><circle cx='249' cy='40' r='7'/><path d='M240 28l4-6h10l4 6'/>` +
  `<path d='M310 46a9 9 0 0 1 2-18 11 11 0 0 1 21-3 8 8 0 0 1 3 21z'/>` +
  // cafe / sol / avion de papel / hoja
  `<path d='M28 110h28v14a14 14 0 0 1-28 0z'/><path d='M56 112h6a6 6 0 0 1 0 12h-6'/><path d='M36 102c0-4 4-4 4-8m6 8c0-4 4-4 4-8'/>` +
  `<circle cx='120' cy='112' r='10'/><path d='M120 94v-6m0 48v-6m18-24h6m-54 0h6m31-13 4-4m-34 34 4-4m30 0 4 4m-34-34 4 4'/>` +
  `<path d='M196 100l44 14-36 10-4 14-8-22z'/><path d='M240 114l-32 2'/>` +
  `<path d='M300 96c22 2 30 16 28 34-18 2-32-6-28-34z'/><path d='M304 102c6 8 12 16 20 24'/>` +
  // reloj / carita / regalo / rayo
  `<circle cx='44' cy='196' r='13'/><path d='M44 188v8l6 4'/>` +
  `<circle cx='124' cy='192' r='13'/><path d='M119 189h.1m9.9 0h.1m-11.1 8c2 3 10 3 12 0'/>` +
  `<rect x='192' y='184' width='30' height='24' rx='3'/><path d='M192 192h30m-15-8v24m0-24c-4-8-14-6-12 0m12 0c4-8 14-6 12 0'/>` +
  `<path d='M296 180l-10 18h9l-6 16 16-20h-9l7-14z'/>` +
  // flor / sandia / burbuja de chat / pez
  `<circle cx='48' cy='285' r='4'/><circle cx='48' cy='275' r='5'/><circle cx='57' cy='282' r='5'/><circle cx='54' cy='293' r='5'/><circle cx='42' cy='293' r='5'/><circle cx='39' cy='282' r='5'/>` +
  `<path d='M112 294a18 18 0 0 1 36 0z'/><path d='M116 294a14 14 0 0 1 28 0'/><path d='M124 289h.1m7.9-1h.1m3.9 4h.1'/>` +
  `<path d='M234 296a16 16 0 1 0-28 10l-2 8 8-3a16 16 0 0 0 22-15z'/>` +
  `<path d='M288 330c8-10 24-10 30 0-6 10-22 10-30 0z'/><path d='M288 330l-8-8v16z'/><circle cx='310' cy='328' r='1.5'/>` +
  // chispas sueltas
  `<path d='M78 66h8m-4-4v8'/><path d='M282 132h8m-4-4v8'/><path d='M160 320h8m-4-4v8'/><circle cx='344' cy='230' r='2'/><circle cx='16' cy='150' r='2'/><circle cx='196' cy='150' r='2'/><circle cx='96' cy='246' r='2'/>` +
  `</svg>`;

export const WA_BG_LIGHT = `url("data:image/svg+xml,${encodeURIComponent(doodleSvg('#a3937b', 0.4))}")`;
export const WA_BG_DARK = `url("data:image/svg+xml,${encodeURIComponent(doodleSvg('#ffffff', 0.05))}")`;

/** Bolita ROJA de fallo: el motivo aparece al pasar el mouse POR LA BOLITA
 *  (tooltip por portal — dentro de la burbuja lo recortaba el overflow). */
function FailDot({ text }: { text?: string }) {
  const [pos, setPos] = useState<null | { left: number; bottom: number }>(null);
  return (
    <>
      <span
        className="inline-flex cursor-help"
        onMouseEnter={(e) => {
          if (!text) return;
          const r = e.currentTarget.getBoundingClientRect();
          const W = 300;
          setPos({
            left: Math.min(Math.max(8, r.left - W + 24), Math.max(8, window.innerWidth - W - 8)),
            bottom: window.innerHeight - r.top + 6,
          });
        }}
        onMouseLeave={() => setPos(null)}
      >
        <AlertCircle className="h-[13px] w-[13px] text-[#f15c6d]" />
      </span>
      {pos && text
        ? createPortal(
          <span
            className="wa-pop fixed z-[80] block w-[300px] rounded-lg bg-[#fde8e8] px-3 py-2 text-[12px] leading-snug text-[#8a1f2d] shadow-md dark:bg-[#3b1d22] dark:text-[#f5a3ad]"
            style={{ left: pos.left, bottom: pos.bottom }}
          >
            {text}
          </span>,
          document.body,
        )
        : null}
    </>
  );
}

/** Chulitos de WhatsApp: reloj (enviando), ✓, ✓✓, ✓✓ azul, bolita roja. */
export function Ticks({
  status,
  pending,
  onMedia = false,
  failText: ft,
}: {
  status: WaMessage['status'];
  pending: boolean;
  onMedia?: boolean;
  /** Motivo del fallo (tooltip al pasar el mouse por la bolita roja). */
  failText?: string;
}) {
  const base = onMedia ? 'text-white' : 'text-[#667781] dark:text-[#8696a0]';
  // 'queued' = aceptado por NUESTRO server (el envio a Meta va en cola):
  // mismo relojito que el envio optimista; el SSE lo sube a chulito.
  if (pending || status === 'queued') return <Clock3 className={cn('h-[13px] w-[13px]', base)} />;
  if (!status) return null;
  if (status === 'failed') return <FailDot text={ft} />;
  const double = status !== 'sent';
  const color = status === 'read' ? 'text-[#53bdeb]' : base;
  return (
    <svg viewBox="0 0 18 11" className={cn('h-[11px] w-[18px] shrink-0', color)} fill="none">
      <path d="M1.5 5.7l2.8 2.8L10 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      {double ? (
        <path d="M8 8l1.3 0.5L15.5 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      ) : null}
    </svg>
  );
}

/** Microfono del avatar de audio: SVG REAL de WhatsApp Web (ptt-status), tal
 * cual — borde blanco alrededor + mic en currentColor (el color por estado). */
export function MicFilled({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg
      viewBox="0 0 19 26"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      style={style}
      aria-hidden
    >
      <path
        fill="#d9fdd3"
        d="M9.217,24.401c-1.158,0-2.1-0.941-2.1-2.1v-2.366c-2.646-0.848-4.652-3.146-5.061-5.958L2.004,13.62 l-0.003-0.081c-0.021-0.559,0.182-1.088,0.571-1.492c0.39-0.404,0.939-0.637,1.507-0.637h0.3c0.254,0,0.498,0.044,0.724,0.125v-6.27 C5.103,2.913,7.016,1,9.367,1c2.352,0,4.265,1.913,4.265,4.265v6.271c0.226-0.081,0.469-0.125,0.723-0.125h0.3 c0.564,0,1.112,0.233,1.501,0.64s0.597,0.963,0.571,1.526c0,0.005,0.001,0.124-0.08,0.6c-0.47,2.703-2.459,4.917-5.029,5.748v2.378 c0,1.158-0.942,2.1-2.1,2.1H9.217V24.401z"
      />
      <path
        fill="currentColor"
        d="M9.367,15.668c1.527,0,2.765-1.238,2.765-2.765V5.265c0-1.527-1.238-2.765-2.765-2.765 S6.603,3.738,6.603,5.265v7.638C6.603,14.43,7.84,15.668,9.367,15.668z M14.655,12.91h-0.3c-0.33,0-0.614,0.269-0.631,0.598 c0,0,0,0-0.059,0.285c-0.41,1.997-2.182,3.505-4.298,3.505c-2.126,0-3.904-1.521-4.304-3.531C5.008,13.49,5.008,13.49,5.008,13.49 c-0.016-0.319-0.299-0.579-0.629-0.579h-0.3c-0.33,0-0.591,0.258-0.579,0.573c0,0,0,0,0.04,0.278 c0.378,2.599,2.464,4.643,5.076,4.978v3.562c0,0.33,0.27,0.6,0.6,0.6h0.3c0.33,0,0.6-0.27,0.6-0.6V18.73 c2.557-0.33,4.613-2.286,5.051-4.809c0.057-0.328,0.061-0.411,0.061-0.411C15.243,13.18,14.985,12.91,14.655,12.91z"
      />
    </svg>
  );
}

/** Muñequito del avatar: SVG REAL de WhatsApp Web (default-contact-refreshed),
 * dibujado para llenar el circulo completo (el aire ya viene dentro del path). */
export function DefaultContactIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" preserveAspectRatio="xMidYMid meet" className={className} fill="none" aria-hidden>
      <path
        fill="currentColor"
        d="M24 23q-1.86 0-3.18-1.32T19.5 18.5t1.32-3.18T24 14t3.18 1.32q1.32 1.32 1.32 3.18t-1.32 3.18T24 23m-6.75 10q-.93 0-1.59-.66T15 30.75v-.9q0-.96.5-1.76a3.3 3.3 0 0 1 1.3-1.22 16.7 16.7 0 0 1 3.54-1.3q1.8-.44 3.66-.44t3.66.43 3.54 1.31q.82.42 1.3 1.22t.5 1.76v.9q0 .93-.66 1.59t-1.59.66z"
      />
    </svg>
  );
}

/** Play del audio: SVG REAL de WhatsApp Web (ic-play-arrow-filled). */
export function PlayFilled({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" className={className} fill="currentColor" aria-hidden>
      <path d="M9.53 18.02a.91.91 0 0 1-1.02.04.95.95 0 0 1-.51-.88V6.82c0-.4.17-.7.51-.88a.91.91 0 0 1 1.02.03l8.15 5.18c.3.2.45.48.45.85s-.15.65-.45.85l-8.15 5.17Z" />
    </svg>
  );
}

/** Pausa a juego con el play de WhatsApp (dos barras redondeadas). */
export function PauseFilled({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" className={className} fill="currentColor" aria-hidden>
      <rect x="6.8" y="5.6" width="3.6" height="12.8" rx="1.3" />
      <rect x="13.6" y="5.6" width="3.6" height="12.8" rx="1.3" />
    </svg>
  );
}

/** Cola de la burbuja (primera del grupo), como en WhatsApp Web. */
export function Tail({ mine }: { mine: boolean }) {
  return mine ? (
    <svg viewBox="0 0 8 13" className="absolute -right-[8px] top-0 h-[13px] w-2 text-[#d9fdd3] dark:text-[#005c4b]">
      <path fill="currentColor" d="M6.467 2.568 0 11.193V0h5.188c1.77 0 2.338 1.156 1.279 2.568z" transform="translate(0,0) scale(1,1)" />
    </svg>
  ) : (
    <svg viewBox="0 0 8 13" className="absolute -left-[8px] top-0 h-[13px] w-2 text-white dark:text-[#202c33]">
      <path fill="currentColor" d="M6.467 2.568 0 11.193V0h5.188c1.77 0 2.338 1.156 1.279 2.568z" transform="translate(8,0) scale(-1,1)" />
    </svg>
  );
}
