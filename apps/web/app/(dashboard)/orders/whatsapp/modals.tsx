'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Forward, Heart, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { WaInbox, WaMessage } from '@smartlogistica/shared';

import { ApiError, api } from '@/lib/api-client';
import { titleCaseName } from '@/lib/utils';

/* ==================== Modales (reenviar / sticker / contacto) ==================== */

/** Reenviar un mensaje a OTRO chat (lista de la bandeja). */
export function ForwardModal({
  message,
  onClose,
  onDone,
}: {
  message: WaMessage;
  onClose: () => void;
  onDone: () => void;
}) {
  const [q, setQ] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const { data: inbox } = useQuery({
    queryKey: ['wa-inbox'],
    queryFn: () => api.get<WaInbox>('/v1/whatsapp/inbox'),
    staleTime: 30_000,
  });
  const query = q.trim().toLowerCase();
  const digits = query.replace(/\D/g, '');
  const chats = (inbox?.chats ?? []).filter(
    (c) =>
      !query ||
      (c.name ?? '').toLowerCase().includes(query) ||
      (digits.length >= 3 && c.phone.includes(digits)),
  );

  const send = async (phone: string) => {
    setSending(phone);
    try {
      await api.post(`/v1/whatsapp/chats/${phone}/forward`, { messageId: message.id });
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo reenviar');
      setSending(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[70vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white dark:bg-[#111b21]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <p className="text-[15px] font-semibold text-[#111b21] dark:text-[#e9edef]">Reenviar a…</p>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-[#54656f] dark:text-[#8696a0]">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-3 pb-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar chat"
            className="h-9 w-full rounded-lg bg-[#f0f2f5] px-3 text-[13.5px] outline-none placeholder:text-[#667781] dark:bg-[#202c33] dark:text-[#e9edef]"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          {chats.map((c) => (
            <button
              key={c.phone}
              type="button"
              disabled={sending !== null}
              onClick={() => void send(c.phone)}
              className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-[#f5f6f6] disabled:opacity-60 dark:hover:bg-white/5"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#dfe5e7] text-[12px] font-semibold text-[#54656f] dark:bg-[#2a3942] dark:text-[#8696a0]">
                {(c.name ?? c.phone).trim().slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] text-[#111b21] dark:text-[#e9edef]">
                  {c.name ? titleCaseName(c.name) : `+57 ${c.phone}`}
                </span>
              </span>
              {sending === c.phone ? <Loader2 className="h-4 w-4 animate-spin text-[#00a884]" /> : null}
            </button>
          ))}
          {chats.length === 0 ? (
            <p className="px-4 py-6 text-center text-[12.5px] text-[#667781]">Ningún chat coincide.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Visor de sticker (clic en un sticker): grande + Añadir a Favoritos. */
export function StickerViewer({
  message,
  onClose,
  onFav,
  onForward,
}: {
  message: WaMessage;
  onClose: () => void;
  onFav: () => void;
  onForward: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-black/60 p-4" onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={message.mediaUrl ?? ''}
        alt="Sticker"
        className="h-auto w-[260px] drop-shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onFav}
          className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[13.5px] font-medium text-[#008069] shadow hover:bg-[#f5f6f6]"
        >
          <Heart className="h-4 w-4" />
          Añadir a Favoritos
        </button>
        <button
          type="button"
          onClick={onForward}
          className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[13.5px] font-medium text-[#54656f] shadow hover:bg-[#f5f6f6]"
        >
          <Forward className="h-4 w-4" />
          Reenviar
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#54656f] shadow hover:bg-[#f5f6f6]"
          aria-label="Cerrar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** Enviar una tarjeta de CONTACTO. */
export function ContactModal({
  onClose,
  onSend,
}: {
  onClose: () => void;
  onSend: (name: string, phone: string) => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-xs rounded-2xl bg-white p-4 dark:bg-[#111b21]"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[15px] font-semibold text-[#111b21] dark:text-[#e9edef]">Enviar contacto</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre"
          className="mt-3 h-9 w-full rounded-lg bg-[#f0f2f5] px-3 text-[13.5px] outline-none placeholder:text-[#667781] dark:bg-[#202c33] dark:text-[#e9edef]"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Teléfono (ej. 3001234567)"
          className="mt-2 h-9 w-full rounded-lg bg-[#f0f2f5] px-3 text-[13.5px] outline-none placeholder:text-[#667781] dark:bg-[#202c33] dark:text-[#e9edef]"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-1.5 text-[13px] text-[#54656f] hover:bg-black/5 dark:text-[#8696a0]"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!name.trim() || phone.replace(/\D/g, '').length < 7}
            onClick={() => onSend(name.trim(), phone.trim())}
            className="rounded-full bg-[#00a884] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[#029377] disabled:opacity-40"
          >
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}
