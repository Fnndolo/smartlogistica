'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns/format';
import { es } from 'date-fns/locale/es';
import {
  Download,
  Loader2,
  MessageCircle,
  Paperclip,
  Phone,
  Plug,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';
import type { WaMessage, WaThread } from '@smartlogistica/shared';

import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api-client';
import { cn, titleCaseName } from '@/lib/utils';

import { useOrdersStream } from './use-orders-stream';

/**
 * Pestaña WHATSAPP del pedido (solo administradores): el hilo con el cliente
 * via Whapify. El API de Whapify no expone historial, asi que aqui vive el
 * NUESTRO: todo lo que se envia desde la plataforma + lo entrante que reenvia
 * el flow de Whapify al webhook. Se puede responder y mandar archivos.
 */
export function WhatsappPanel({ orderId, active = true }: { orderId: string; active?: boolean }) {
  const qc = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: thread, isLoading } = useQuery({
    queryKey: ['wa-thread', orderId],
    queryFn: () => api.get<WaThread>(`/v1/orders/${orderId}/whatsapp`),
    // Respaldo por si el SSE se cae; el canal primario es wa.message.
    refetchInterval: active ? 30_000 : false,
    retry: false,
  });

  // Mensaje nuevo (entrante o de otro admin) -> refrescar el hilo al instante.
  const phoneRef = useRef<string | null>(null);
  phoneRef.current = thread?.phone ?? null;
  useOrdersStream(
    useCallback(
      (event) => {
        if (event?.kind !== 'wa.message') return;
        if (event.phone && phoneRef.current && event.phone !== phoneRef.current) return;
        qc.invalidateQueries({ queryKey: ['wa-thread', orderId] });
      },
      [qc, orderId],
    ),
  );

  const appendMessage = useCallback(
    (msg: WaMessage) => {
      qc.setQueryData<WaThread>(['wa-thread', orderId], (old) =>
        old && !old.messages.some((m) => m.id === msg.id)
          ? { ...old, messages: [...old.messages, msg] }
          : old,
      );
    },
    [qc, orderId],
  );

  // Al fondo al abrir y con cada mensaje nuevo.
  const count = thread?.messages.length ?? 0;
  useEffect(() => {
    if (active && count > 0) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
      });
    }
  }, [active, count]);

  const sendText = useMutation({
    mutationFn: (vars: { body: string; tempId: string }) =>
      api.post<WaMessage>(`/v1/orders/${orderId}/whatsapp/text`, { text: vars.body }),
    // OPTIMISTA: la burbuja aparece AL INSTANTE; el POST corre por detras
    // (el sandbox/API puede tardar segundos y no debe sentirse).
    onMutate: (vars) => {
      appendMessage({
        id: vars.tempId,
        direction: 'out',
        kind: 'text',
        body: vars.body,
        mediaUrl: null,
        authorName: 'Tú',
        createdAt: new Date().toISOString(),
      });
    },
    onSuccess: (msg, vars) => {
      // Reemplazar la burbuja temporal por la real (con su id/wamid).
      qc.setQueryData<WaThread>(['wa-thread', orderId], (old) =>
        old
          ? {
              ...old,
              messages: old.messages.map((x) => (x.id === vars.tempId ? msg : x)),
            }
          : old,
      );
    },
    onError: (err, vars) => {
      qc.setQueryData<WaThread>(['wa-thread', orderId], (old) =>
        old ? { ...old, messages: old.messages.filter((x) => x.id !== vars.tempId) } : old,
      );
      setText(vars.body); // devolver el texto al campo para reintentar
      toast.error(err instanceof ApiError ? err.message : 'No se pudo enviar el mensaje');
    },
  });

  const sendFile = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file, file.name);
      return api.upload<WaMessage>(`/v1/orders/${orderId}/whatsapp/file`, fd);
    },
    onSuccess: (msg) => appendMessage(msg),
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudo enviar el archivo'),
  });

  const submit = () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    sendText.mutate({ body, tempId: `temp-${crypto.randomUUID()}` });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!thread) {
    return (
      <p className="m-5 rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        No se pudo cargar el hilo de WhatsApp.
      </p>
    );
  }

  if (!thread.connected) {
    return (
      <div className="p-5">
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-5 text-center">
          <MessageCircle className="mx-auto h-7 w-7 text-emerald-600 dark:text-emerald-400" />
          <h3 className="mt-2 text-base font-semibold">Whapify no está conectado</h3>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Conecta el token del API de Whapify para ver y responder el WhatsApp del cliente desde
            aquí.
          </p>
          <Button asChild size="sm" className="mt-4">
            <Link href="/connections">
              <Plug className="h-3.5 w-3.5" />
              Ir a Conexiones
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!thread.phone) {
    return (
      <p className="m-5 rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        Este pedido no tiene teléfono del cliente: no hay chat de WhatsApp que mostrar.
      </p>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Cabecera del hilo: contacto + numero */}
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <MessageCircle className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13px] font-semibold">
            {thread.contactName ? titleCaseName(thread.contactName) : 'WhatsApp del cliente'}
          </p>
          <p className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
            <Phone className="h-3 w-3" />
            {thread.phone}
          </p>
        </div>
      </div>

      {/* Hilo */}
      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3">
        <div className="mt-auto" aria-hidden />
        {thread.messages.length === 0 ? (
          <div className="py-8 text-center">
            <MessageCircle className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
              Aún no hay historial guardado para este teléfono. Se guarda todo lo que envíes desde
              aquí y lo que el cliente responda (vía el flow de Whapify).
            </p>
          </div>
        ) : (
          thread.messages.map((m, i) => (
            <WaBubble
              key={m.id}
              message={m}
              prev={thread.messages[i - 1]}
            />
          ))
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-border px-3 py-2.5 md:px-4">
        <div className="flex items-end gap-1.5">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) sendFile.mutate(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={sendFile.isPending}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 md:h-9 md:w-9"
            aria-label="Adjuntar archivo"
            title="Enviar imagen, video o archivo"
          >
            {sendFile.isPending ? (
              <Loader2 className="h-[18px] w-[18px] animate-spin" />
            ) : (
              <Paperclip className="h-[18px] w-[18px]" />
            )}
          </button>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Mensaje por WhatsApp"
            className="h-10 min-w-0 flex-1 rounded-full bg-muted px-4 text-[16px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-emerald-500/40 md:h-9 md:text-[13px]"
          />
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={submit}
            disabled={!text.trim()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white transition-colors hover:bg-emerald-700 disabled:opacity-40 md:h-9 md:w-9"
            aria-label="Enviar"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1.5 text-center text-[10.5px] text-muted-foreground">
          Se envía por Whapify y queda guardado aquí para siempre.
        </p>
      </div>
    </div>
  );
}

/** Burbuja estilo WhatsApp: salientes verdes a la derecha, entrantes grises. */
function WaBubble({ message: m, prev }: { message: WaMessage; prev?: WaMessage }) {
  const mine = m.direction === 'out';
  // Separador de dia (como WhatsApp).
  const day = (iso: string) => new Date(iso).toDateString();
  const newDay = !prev || day(prev.createdAt) !== day(m.createdAt);
  const grouped = !newDay && prev && prev.direction === m.direction;

  return (
    <>
      {newDay ? (
        <div className="my-3 flex justify-center">
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-[10.5px] font-medium text-muted-foreground">
            {format(new Date(m.createdAt), "d 'de' MMMM", { locale: es })}
          </span>
        </div>
      ) : null}
      <div className={cn('flex', mine ? 'justify-end' : 'justify-start', grouped ? 'mt-[3px]' : 'mt-2.5')}>
        <div
          className={cn(
            'max-w-[85%] overflow-hidden rounded-2xl px-3 py-1.5 text-[14.5px] leading-snug md:text-[13px]',
            mine
              ? 'rounded-br-sm bg-emerald-600 text-white'
              : 'rounded-bl-sm bg-muted text-foreground',
            // Burbuja optimista (enviando): apenas un pelin translucida.
            m.id.startsWith('temp-') && 'opacity-70',
          )}
        >
          {mine && m.authorName && !grouped ? (
            <p className="mb-0.5 text-[10.5px] font-semibold text-white/75">{m.authorName}</p>
          ) : null}
          <WaMedia message={m} mine={mine} />
          {m.body && m.kind === 'text' ? (
            <p className="whitespace-pre-wrap break-words">{m.body}</p>
          ) : null}
          <p className={cn('mt-0.5 text-right text-[9.5px]', mine ? 'text-white/60' : 'text-muted-foreground')}>
            {format(new Date(m.createdAt), 'HH:mm')}
          </p>
        </div>
      </div>
    </>
  );
}

function WaMedia({ message: m, mine }: { message: WaMessage; mine: boolean }) {
  if (m.kind === 'text' || !m.mediaUrl) {
    // Medio sin URL (no se pudo descargar): etiqueta + el caption si lo trae.
    if (m.kind !== 'text') {
      const label =
        m.kind === 'image' ? '📷 Foto' : m.kind === 'video' ? '🎬 Video' : m.kind === 'audio' ? '🎙️ Audio' : '📎 Archivo';
      return (
        <p className={cn('italic', mine ? 'text-white/80' : 'text-muted-foreground')}>
          {label}
          {m.body ? ` · ${m.body}` : ' (no se pudo descargar)'}
        </p>
      );
    }
    return null;
  }
  if (m.kind === 'image') {
    return (
      <a href={m.mediaUrl} target="_blank" rel="noreferrer" className="-mx-3 -mt-1.5 mb-1 block bg-black/5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={m.mediaUrl} alt={m.body ?? 'Imagen'} decoding="async" className="max-h-56 w-full object-cover" />
      </a>
    );
  }
  if (m.kind === 'video') {
    return <video src={m.mediaUrl} controls preload="metadata" className="-mx-3 -mt-1.5 mb-1 block max-h-56 w-[230px] max-w-full bg-black" />;
  }
  if (m.kind === 'audio') {
    return <audio src={m.mediaUrl} controls className="my-1 w-[220px] max-w-full" />;
  }
  return (
    <a
      href={m.mediaUrl}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'my-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] font-medium',
        mine ? 'bg-white/15 text-white' : 'bg-muted-foreground/10 text-foreground',
      )}
    >
      <Download className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{m.body ?? 'Archivo'}</span>
    </a>
  );
}
