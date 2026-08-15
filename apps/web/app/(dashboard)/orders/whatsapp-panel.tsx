'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, isToday, isYesterday } from 'date-fns';
import { es } from 'date-fns/locale/es';
import {
  AlertCircle,
  Clock3,
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

/* =====================================================================
 * Chat del pedido CALCADO a WhatsApp Web: fondo doodle, burbujas con cola,
 * citas, reacciones, emojis grandes sin burbuja, stickers, media con hora
 * encima, documentos con tarjeta y chulitos de entrega/lectura.
 * El historial vive en la plataforma (webhook de la Cloud API, 360dialog).
 * ===================================================================== */

/** Reemplaza {{n}} por los valores — el mismo render que hace el server. */
const renderTpl = (body: string, params: string[]): string =>
  body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? '');

/** Etiquetas de las variables por convencion del negocio ({{1}}..{{3}}). */
const VAR_HINTS = ['Nombre del cliente', 'Productos', 'Dirección de entrega'];

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

const WA_BG_LIGHT = `url("data:image/svg+xml,${encodeURIComponent(doodleSvg('#a3937b', 0.4))}")`;
const WA_BG_DARK = `url("data:image/svg+xml,${encodeURIComponent(doodleSvg('#ffffff', 0.05))}")`;

/* ======================= Helpers de presentacion ======================= */

/** ¿El texto son SOLO emojis? (WhatsApp los pinta grandes y sin burbuja). */
const isEmojiOnly = (s: string | null): boolean => {
  if (!s || !s.trim()) return false;
  try {
    // Solo pictograficos + ZWJ/VS16/tonos de piel/espacios (los digitos y #*
    // NO cuentan: "123" debe ir en burbuja normal).
    return /^(?=.*\p{Extended_Pictographic})[\p{Extended_Pictographic}‍️\u{1F3FB}-\u{1F3FF}\s]+$/u.test(
      s.trim(),
    );
  } catch {
    return false;
  }
};
const emojiCount = (s: string): number => {
  try {
    return [...s.matchAll(/\p{Extended_Pictographic}/gu)].length;
  } catch {
    return 99;
  }
};

/** Color estable por autor (como los nombres en los grupos de WhatsApp). */
const NAME_COLORS = ['#e17bb5', '#53bdeb', '#06cf9c', '#fa6533', '#ffbc38', '#a791f5', '#02a698'];
const nameColor = (name: string): string => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return NAME_COLORS[Math.abs(h) % NAME_COLORS.length] ?? '#06cf9c';
};

const timeOf = (iso: string): string => format(new Date(iso), 'h:mm aaaa', { locale: es });

const dayLabel = (iso: string): string => {
  const d = new Date(iso);
  if (isToday(d)) return 'HOY';
  if (isYesterday(d)) return 'AYER';
  return format(d, "d 'de' MMMM 'de' yyyy", { locale: es }).toUpperCase();
};

/** Chulitos de WhatsApp: reloj (enviando), ✓, ✓✓, ✓✓ azul, ! rojo. */
function Ticks({
  status,
  pending,
  onMedia = false,
}: {
  status: WaMessage['status'];
  pending: boolean;
  onMedia?: boolean;
}) {
  const base = onMedia ? 'text-white' : 'text-[#667781] dark:text-[#8696a0]';
  if (pending) return <Clock3 className={cn('h-[13px] w-[13px]', base)} />;
  if (!status) return null;
  if (status === 'failed') return <AlertCircle className="h-[13px] w-[13px] text-[#f15c6d]" />;
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

/** Cola de la burbuja (primera del grupo), como en WhatsApp Web. */
function Tail({ mine }: { mine: boolean }) {
  return mine ? (
    <svg viewBox="0 0 8 13" className="absolute -right-[8px] top-0 h-[13px] w-2 text-[#d9fdd3] dark:text-[#005c4b]">
      <path fill="currentColor" d="M6.467 2.568 0 11.193V0h5.188c1.77 0 2.338 1.156 1.279 2.568z" transform="translate(8,0) scale(-1,1)" />
    </svg>
  ) : (
    <svg viewBox="0 0 8 13" className="absolute -left-[8px] top-0 h-[13px] w-2 text-white dark:text-[#202c33]">
      <path fill="currentColor" d="M6.467 2.568 0 11.193V0h5.188c1.77 0 2.338 1.156 1.279 2.568z" transform="translate(8,0) scale(-1,1)" />
    </svg>
  );
}

/* ============================== Panel ============================== */

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

  const optimistic = (body: string, buttons: string[] = []): WaMessage => ({
    id: `temp-${crypto.randomUUID()}`,
    direction: 'out',
    kind: 'text',
    body,
    mediaUrl: null,
    authorName: 'Tú',
    buttons,
    replyTo: null,
    reactions: [],
    status: null,
    createdAt: new Date().toISOString(),
  });

  const sendText = useMutation({
    mutationFn: (vars: { body: string; tempId: string }) =>
      api.post<WaMessage>(`/v1/orders/${orderId}/whatsapp/text`, { text: vars.body }),
    // OPTIMISTA: la burbuja aparece AL INSTANTE con relojito; el POST corre por detras.
    onMutate: (vars) => {
      appendMessage({ ...optimistic(vars.body), id: vars.tempId });
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
        ...optimistic(renderTpl(vars.tpl.body, vars.params), vars.tpl.buttons),
        id: vars.tempId,
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
      {/* Cabecera del hilo, estilo WhatsApp */}
      <div className="flex items-center gap-3 border-b border-border bg-[#f0f2f5] px-4 py-2 dark:bg-[#202c33]">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#dfe5e7] text-[#54656f] dark:bg-[#2a3942] dark:text-[#8696a0]">
          <MessageCircle className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[14px] font-medium text-[#111b21] dark:text-[#e9edef]">
            {thread.contactName ? titleCaseName(thread.contactName) : 'WhatsApp del cliente'}
          </p>
          <p className="flex items-center gap-1 text-[12px] text-[#667781] dark:text-[#8696a0]">
            <Phone className="h-3 w-3" />
            +57 {thread.phone}
          </p>
        </div>
      </div>

      {/* Hilo sobre el FONDO DOODLE (fijo; los mensajes scrollean encima). */}
      <div className="relative min-h-0 flex-1 bg-[#efe7dd] dark:bg-[#0b141a]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 dark:hidden"
          style={{ backgroundImage: WA_BG_LIGHT, backgroundSize: '360px 360px' }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 hidden dark:block"
          style={{ backgroundImage: WA_BG_DARK, backgroundSize: '360px 360px' }}
        />
        <div ref={scrollRef} className="absolute inset-0 flex flex-col overflow-y-auto px-4 py-2 md:px-[6%]">
          <div className="mt-auto" aria-hidden />
          {thread.messages.length === 0 ? (
            <div className="py-8 text-center">
              <span className="inline-block rounded-lg bg-[#ffeecd] px-3 py-2 text-[12.5px] text-[#54656f] shadow-sm dark:bg-[#182229] dark:text-[#8696a0]">
                Aún no hay historial para este teléfono. Aquí queda todo lo que se envíe y todo lo
                que llegue o salga por el número.
              </span>
            </div>
          ) : (
            thread.messages.map((m, i) => (
              <WaBubble key={m.id} message={m} prev={thread.messages[i - 1]} />
            ))
          )}
        </div>
      </div>

      {/* Picker de plantillas ("/"): las plantillas REALES de la WABA en Meta. */}
      {slashMode ? (
        <div className="border-t border-border bg-[#f0f2f5] dark:bg-[#202c33]">
          <p className="flex items-center gap-1.5 px-4 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-[#667781] dark:text-[#8696a0]">
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
                      approved ? 'hover:bg-black/5 dark:hover:bg-white/5' : 'cursor-not-allowed opacity-55',
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
        <div className="border-t border-border bg-[#f0f2f5] px-4 py-3 dark:bg-[#202c33]">
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
              className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
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
                className="h-8 w-full rounded-lg bg-white px-2.5 text-[12.5px] outline-none ring-1 ring-border placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:bg-[#2a3942]"
              />
            ))}
          </div>
          {/* Vista previa: EXACTAMENTE lo que le llegará al cliente. */}
          <p className="mt-2 line-clamp-4 whitespace-pre-wrap rounded-lg bg-white/70 px-2.5 py-1.5 text-[11.5px] leading-snug text-muted-foreground ring-1 ring-border/60 dark:bg-[#2a3942]/70">
            {renderTpl(tpl.body, tplParams)}
          </p>
          <Button
            size="sm"
            className="mt-2 h-8 w-full bg-[#00a884] text-white hover:bg-[#029377]"
            disabled={tplParams.some((p) => !p.trim()) || sendTemplate.isPending}
            onClick={submitTemplate}
          >
            <Send className="h-3.5 w-3.5" />
            Enviar plantilla
          </Button>
        </div>
      ) : null}

      {/* Composer estilo WhatsApp */}
      <div className="bg-[#f0f2f5] px-3 py-2 dark:bg-[#202c33] md:px-4">
        <div className="flex items-end gap-1">
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
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#54656f] transition-colors hover:bg-black/5 disabled:opacity-50 dark:text-[#8696a0] dark:hover:bg-white/5"
            aria-label="Adjuntar archivo"
            title="Enviar imagen, video o archivo"
          >
            {sendFile.isPending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Paperclip className="h-5 w-5" />
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
            placeholder='Escribe un mensaje — "/" para plantillas'
            className="h-10 min-w-0 flex-1 rounded-lg bg-white px-4 text-[16px] text-[#111b21] outline-none placeholder:text-[#667781] dark:bg-[#2a3942] dark:text-[#e9edef] dark:placeholder:text-[#8696a0] md:text-[14.5px]"
          />
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={submit}
            disabled={!text.trim()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#54656f] transition-colors hover:bg-black/5 disabled:opacity-40 dark:text-[#8696a0] dark:hover:bg-white/5"
            aria-label="Enviar"
          >
            <Send className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================== Burbujas ============================== */

function WaBubble({ message: m, prev }: { message: WaMessage; prev?: WaMessage }) {
  const mine = m.direction === 'out';
  const pending = m.id.startsWith('temp-');
  const day = (iso: string) => new Date(iso).toDateString();
  const newDay = !prev || day(prev.createdAt) !== day(m.createdAt);
  const grouped = !newDay && prev && prev.direction === m.direction;
  const hasReactions = m.reactions.length > 0;

  const emojiOnly = m.kind === 'text' && isEmojiOnly(m.body) && m.buttons.length === 0 && !m.replyTo;
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
        )}
      >
        {emojiOnly || sticker ? (
          <BareMessage message={m} mine={mine} pending={pending} sticker={sticker} />
        ) : (
          <div className={cn('relative max-w-[85%] md:max-w-[65%]', pending && 'opacity-90')}>
            {!grouped ? <Tail mine={mine} /> : null}
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
              <BubbleContent message={m} mine={mine} pending={pending} grouped={Boolean(grouped)} />
            </div>
            <ReactionChips message={m} mine={mine} />
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
}: {
  message: WaMessage;
  mine: boolean;
  pending: boolean;
  sticker: boolean;
}) {
  const n = m.body ? emojiCount(m.body) : 0;
  const sizeClass = n <= 1 ? 'text-[44px] leading-[52px]' : n <= 3 ? 'text-[34px] leading-[42px]' : 'text-[26px] leading-[34px]';
  return (
    <div className={cn('relative flex max-w-[85%] flex-col md:max-w-[65%]', mine ? 'items-end' : 'items-start')}>
      {sticker ? (
        m.mediaUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.mediaUrl} alt="Sticker" decoding="async" className="h-auto w-[160px]" />
        ) : (
          <span className="text-[13px] italic text-[#54656f] dark:text-[#8696a0]">🩵 Sticker (no se pudo descargar)</span>
        )
      ) : (
        <p className={cn('whitespace-pre-wrap break-words', sizeClass)}>{m.body}</p>
      )}
      <span className="mt-0.5 flex items-center gap-1 text-[11px] text-[#667781] dark:text-[#8696a0]">
        {timeOf(m.createdAt)}
        {mine ? <Ticks status={m.status} pending={pending} /> : null}
      </span>
      <ReactionChips message={m} mine={mine} bare />
    </div>
  );
}

/** Chips de reaccion pegados al borde inferior de la burbuja. */
function ReactionChips({ message: m, mine, bare = false }: { message: WaMessage; mine: boolean; bare?: boolean }) {
  if (m.reactions.length === 0) return null;
  const emojis = [...new Set(m.reactions.map((r) => r.emoji))];
  return (
    <span
      className={cn(
        'absolute z-10 flex items-center rounded-full border border-black/5 bg-white px-1.5 py-[1px] text-[13px] shadow-sm dark:border-white/10 dark:bg-[#202c33]',
        bare ? 'bottom-3' : '-bottom-3.5',
        mine ? 'right-1' : 'left-1',
      )}
    >
      {emojis.join('')}
      {m.reactions.length > 1 ? (
        <span className="ml-0.5 text-[11px] text-[#667781] dark:text-[#8696a0]">{m.reactions.length}</span>
      ) : null}
    </span>
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
  grouped,
}: {
  message: WaMessage;
  mine: boolean;
  pending: boolean;
  grouped: boolean;
}) {
  const timeRow = (onMedia = false) => (
    <span
      className={cn(
        'flex items-center gap-1 text-[11px]',
        onMedia ? 'text-white' : 'text-[#667781] dark:text-[#8696a0]',
      )}
    >
      {timeOf(m.createdAt)}
      {mine ? <Ticks status={m.status} pending={pending} onMedia={onMedia} /> : null}
    </span>
  );

  const authorRow =
    mine && m.authorName && !grouped ? (
      <p className="px-2 pt-1 text-[12.5px] font-semibold" style={{ color: nameColor(m.authorName) }}>
        {m.authorName}
      </p>
    ) : null;

  // ===== Medios (foto / video) =====
  if ((m.kind === 'image' || m.kind === 'video') && m.mediaUrl) {
    const caption = m.body && !/\.(jpe?g|png|gif|webp|mp4|mov|3gp)$/i.test(m.body) ? m.body : null;
    return (
      <div className="p-[3px]">
        {authorRow}
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
            <p className="whitespace-pre-wrap break-words">{caption}</p>
            <div className="flex justify-end">{timeRow()}</div>
          </div>
        ) : null}
      </div>
    );
  }

  // ===== Audio =====
  if (m.kind === 'audio' && m.mediaUrl) {
    return (
      <div className="px-2 py-1.5">
        {authorRow}
        <audio src={m.mediaUrl} controls className="my-1 w-[240px] max-w-full" />
        <div className="flex justify-end">{timeRow()}</div>
      </div>
    );
  }

  // ===== Documento =====
  if (m.kind === 'file' && m.mediaUrl) {
    return (
      <div className="p-[5px]">
        {authorRow}
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
        {authorRow}
        <p className="italic text-[#667781] dark:text-[#8696a0]">
          {label}
          {m.body ? ` · ${m.body}` : ' (no se pudo descargar)'}
        </p>
        <div className="flex justify-end">{timeRow()}</div>
      </div>
    );
  }

  // ===== Texto (con cita, botones de plantilla y hora "flotada" al final) =====
  return (
    <div>
      {authorRow}
      {m.replyTo ? <ReplyQuote replyTo={m.replyTo} mine={mine} /> : null}
      <div className="px-2 pb-1.5 pt-1">
        <p className="whitespace-pre-wrap break-words">
          {m.body}
          {/* espaciador invisible para que la hora quepa a la derecha */}
          <span className="invisible inline-block h-0 pl-[70px]" aria-hidden />
        </p>
        <span className="float-right -mt-[15px] ml-2">{timeRow()}</span>
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
