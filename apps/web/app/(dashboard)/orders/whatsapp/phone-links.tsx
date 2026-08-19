'use client';

import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Copy, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';

import { PHONE_RE } from './helpers';
import { useSinglePopover } from './menus';

/* ============ Numeros de telefono como ENLACE de chat ============ */

/** Numero clicable: menu "Chatear con +57 X" / "Copiar numero". El menu va
 *  en un PORTAL (position fixed) — dentro de la burbuja lo recortaba el
 *  overflow y solo se veia un bordecito. */
function PhoneToken({ raw }: { raw: string }) {
  const router = useRouter();
  const [open, setOpen] = useState<null | { left: number; top?: number; bottom?: number }>(null);
  const close = useCallback(() => setOpen(null), []);
  useSinglePopover(Boolean(open), close);
  const digits = raw.replace(/\D/g, '');
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  const goChat = () => {
    close();
    // En la bandeja: abrir directo (evento); desde un pedido: navegar.
    if (window.location.pathname.startsWith('/whatsapp')) {
      window.dispatchEvent(new CustomEvent('wa-open-chat', { detail: ten }));
    } else {
      router.push(`/whatsapp?chat=${ten}`);
    }
  };
  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (open) return close();
    const r = e.currentTarget.getBoundingClientRect();
    const MENU_W = 270;
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - MENU_W - 8));
    // Encima del numero si hay espacio; si no, debajo.
    setOpen(r.top > 120 ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 });
  };
  const item = (Icon: typeof Copy, label: string, onClick: () => void): React.ReactNode => (
    <button
      key={label}
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex w-full items-center gap-3 whitespace-nowrap px-4 py-2 text-left text-[14px] text-[#111b21] transition-colors hover:bg-[#f5f6f6] dark:text-[#e9edef] dark:hover:bg-white/5"
    >
      <Icon className="h-[16px] w-[16px] shrink-0" />
      {label}
    </button>
  );
  return (
    <>
      <button
        type="button"
        onClick={toggle}
        className="font-semibold text-[#00a884] underline-offset-2 hover:underline"
      >
        {raw}
      </button>
      {open
        ? createPortal(
          <>
            <button type="button" className="fixed inset-0 z-[70] cursor-default" onClick={close} aria-label="Cerrar" />
            <span
              className="wa-pop fixed z-[80] flex w-max flex-col rounded-xl border border-border bg-white py-1 shadow-float dark:bg-[#233138]"
              style={{
                left: open.left,
                ...(open.top != null ? { top: open.top } : { bottom: open.bottom }),
                transformOrigin: open.top != null ? 'top left' : 'bottom left',
              }}
            >
              {item(MessageCircle, `Chatear con +57 ${ten}`, goChat)}
              {item(Copy, 'Copiar número de teléfono', () => {
                void navigator.clipboard.writeText(`+57${ten}`);
                close();
                toast.success('Número copiado');
              })}
            </span>
          </>,
          document.body,
        )
        : null}
    </>
  );
}

/** Texto del mensaje con los TELEFONOS convertidos en enlace. */
export function renderBodyWithPhones(body: string): React.ReactNode {
  PHONE_RE.lastIndex = 0;
  const out: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let k = 0;
  while ((match = PHONE_RE.exec(body)) !== null) {
    if (match.index > last) out.push(body.slice(last, match.index));
    out.push(<PhoneToken key={`ph-${k++}`} raw={match[0]} />);
    last = match.index + match[0].length;
  }
  if (out.length === 0) return body;
  if (last < body.length) out.push(body.slice(last));
  return out;
}
