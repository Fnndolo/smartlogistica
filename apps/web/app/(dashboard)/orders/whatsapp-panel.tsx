'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns/format';
import { es } from 'date-fns/locale/es';
import {
  Download,
  FileText,
  Loader2,
  MessageCircle,
  Paperclip,
  Phone,
  Plug,
  Send,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { WaMessage, WaTemplate, WaTemplateList, WaThread } from '@smartlogistica/shared';

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
/** Reemplaza {{n}} por los valores — el mismo render que hace el server. */
const renderTpl = (body: string, params: string[]): string =>
  body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? '');

/** Etiquetas de las variables por convencion del negocio ({{1}}..{{3}}). */
const VAR_HINTS = ['Nombre del cliente', 'Productos', 'Dirección de entrega'];

export function WhatsappPanel({ orderId, active = true }: { orderId: string; active?: boolean }) {
  const qc = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  // Picker de "/": plantillas de Meta (WABA). tpl = plantilla elegida (llenando variables).
  const [tpl, setTpl] = useState<WaTemplate | null>(null);
  const [tplParams, setTplParams] = useState<string[]>([]);
  const slashMode = !tpl && text.startsWith('/');

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
        buttons: [],
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

  // Plantillas de la WABA: se cargan la primera vez que se escribe "/".
  const { data: tplList, isLoading: tplLoading } = useQuery({
    queryKey: ['wa-templates', orderId],
    queryFn: () => api.get<WaTemplateList>(`/v1/orders/${orderId}/whatsapp/templates`),
    enabled: active && (slashMode || Boolean(tpl)),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const sendTemplate = useMutation({
    mutationFn: (vars: { tpl: WaTemplate; params: string[]; tempId: string }) =>
      api.post<WaMessage>(`/v1/orders/${orderId}/whatsapp/template`, {
        name: vars.tpl.name,
        language: vars.tpl.language,
        params: vars.params,
      }),
    onMutate: (vars) => {
      appendMessage({
        id: vars.tempId,
        direction: 'out',
        kind: 'text',
        body: renderTpl(vars.tpl.body, vars.params),
        mediaUrl: null,
        authorName: 'Tú',
        buttons: vars.tpl.buttons,
        createdAt: new Date().toISOString(),
      });
    },
    onSuccess: (msg, vars) => {
      qc.setQueryData<WaThread>(['wa-thread', orderId], (old) =>
        old
          ? { ...old, messages: old.messages.map((x) => (x.id === vars.tempId ? msg : x)) }
          : old,
      );
    },
    onError: (err, vars) => {
      qc.setQueryData<WaThread>(['wa-thread', orderId], (old) =>
        old ? { ...old, messages: old.messages.filter((x) => x.id !== vars.tempId) } : old,
      );
      toast.error(err instanceof ApiError ? err.message : 'No se pudo enviar la plantilla');
    },
  });

  /** Elegir plantilla del picker: prellena variables con datos del pedido. */
  const pickTemplate = (t: WaTemplate) => {
    setText('');
    if (t.variables === 0) {
      sendTemplate.mutate({ tpl: t, params: [], tempId: `temp-${crypto.randomUUID()}` });
      return;
    }
    const sug = tplList?.suggestions;
    const pre = [sug?.nombre ?? '', sug?.productos ?? '', sug?.direccion ?? ''];
    setTpl(t);
    setTplParams(Array.from({ length: t.variables }, (_, i) => pre[i] ?? ''));
  };

  const submitTemplate = () => {
    if (!tpl || tplParams.some((p) => !p.trim())) return;
    sendTemplate.mutate({
      tpl,
      params: tplParams.map((p) => p.trim()),
      tempId: `temp-${crypto.randomUUID()}`,
    });
    setTpl(null);
    setTplParams([]);
  };

  const tplQuery = text.slice(1).trim().toLowerCase();
  const tplMatches = (tplList?.templates ?? []).filter(
    (t) => !tplQuery || t.name.toLowerCase().includes(tplQuery) || t.body.toLowerCase().includes(tplQuery),
  );

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
    // En modo "/" el Enter/boton eligen plantilla, no envian el texto literal.
    if (slashMode) {
      const first = tplMatches.find((t) => t.status === 'approved');
      if (first) pickTemplate(first);
      return;
    }
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
          <h3 className="mt-2 text-base font-semibold">WhatsApp no está conectado</h3>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Conecta el API key de 360dialog (WhatsApp Cloud API) para ver y responder el WhatsApp
            del cliente desde aquí.
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
              aquí y todo lo que llegue o salga por el número (incluido lo del celular).
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

      {/* Picker de plantillas ("/"): las plantillas REALES de la WABA en Meta. */}
      {slashMode ? (
        <div className="border-t border-border bg-muted/20">
          <p className="flex items-center gap-1.5 px-4 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <FileText className="h-3 w-3" />
            Plantillas de Meta
          </p>
          <div className="max-h-56 overflow-y-auto p-2">
            {tplLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : tplMatches.length === 0 ? (
              <p className="px-2 py-3 text-center text-[12.5px] text-muted-foreground">
                {(tplList?.templates.length ?? 0) === 0
                  ? 'La WABA aún no tiene plantillas (se crean en el administrador de Meta o te las creamos por API).'
                  : 'Ninguna plantilla coincide con la búsqueda.'}
              </p>
            ) : (
              tplMatches.map((t) => {
                const approved = t.status === 'approved';
                return (
                  <button
                    key={`${t.name}:${t.language}`}
                    type="button"
                    disabled={!approved}
                    onClick={() => pickTemplate(t)}
                    className={cn(
                      'block w-full rounded-lg px-2.5 py-2 text-left transition-colors',
                      approved ? 'hover:bg-muted' : 'cursor-not-allowed opacity-55',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate font-mono text-[12px] font-semibold">{t.name}</span>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-1.5 py-px text-[9.5px] font-semibold uppercase',
                          approved
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                            : t.status === 'rejected'
                              ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                              : 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
                        )}
                      >
                        {approved ? 'Aprobada' : t.status === 'rejected' ? 'Rechazada' : 'Pendiente'}
                      </span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-muted-foreground">
                      {t.body}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}

      {/* Variables de la plantilla elegida (prellenadas con datos del pedido). */}
      {tpl ? (
        <div className="border-t border-border bg-muted/20 px-4 py-3">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 truncate font-mono text-[12px] font-semibold">
              <FileText className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              {tpl.name}
            </p>
            <button
              type="button"
              onClick={() => {
                setTpl(null);
                setTplParams([]);
              }}
              className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Cancelar plantilla"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-2 space-y-1.5">
            {tplParams.map((p, i) => (
              <input
                key={i}
                value={p}
                onChange={(e) =>
                  setTplParams((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))
                }
                placeholder={`{{${i + 1}}} ${VAR_HINTS[i] ?? `Variable ${i + 1}`}`}
                className="h-8 w-full rounded-lg bg-background px-2.5 text-[12.5px] outline-none ring-1 ring-border placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-emerald-500/40"
              />
            ))}
          </div>
          {/* Vista previa: EXACTAMENTE lo que le llegará al cliente. */}
          <p className="mt-2 line-clamp-4 whitespace-pre-wrap rounded-lg bg-background/60 px-2.5 py-1.5 text-[11.5px] leading-snug text-muted-foreground ring-1 ring-border/60">
            {renderTpl(tpl.body, tplParams)}
          </p>
          <Button
            size="sm"
            className="mt-2 h-8 w-full bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={tplParams.some((p) => !p.trim()) || sendTemplate.isPending}
            onClick={submitTemplate}
          >
            <Send className="h-3.5 w-3.5" />
            Enviar plantilla
          </Button>
        </div>
      ) : null}

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
              if (e.key === 'Escape' && slashMode) {
                e.preventDefault();
                setText('');
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (slashMode) {
                  // Enter en modo "/": elige la primera plantilla aprobada.
                  const first = tplMatches.find((t) => t.status === 'approved');
                  if (first) pickTemplate(first);
                  return;
                }
                submit();
              }
            }}
            placeholder='Mensaje por WhatsApp — "/" para plantillas'
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
          Se envía por WhatsApp y queda guardado aquí para siempre.
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
          {/* Botones del mensaje: se PINTAN como en el celular (solo visual —
              quien los toca es el cliente en su WhatsApp). */}
          {m.buttons && m.buttons.length > 0 ? (
            <div className="mb-1 mt-2 space-y-1">
              {m.buttons.map((b, i) => (
                <div
                  key={i}
                  className={cn(
                    'rounded-lg px-2.5 py-1.5 text-center text-[12.5px] font-medium',
                    mine ? 'bg-white/15 text-white' : 'bg-background text-sky-600 dark:text-sky-400',
                  )}
                >
                  {b}
                </div>
              ))}
            </div>
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
