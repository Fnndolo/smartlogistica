'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, isToday, isYesterday } from 'date-fns';
import { es } from 'date-fns/locale/es';
import {
  AlertCircle,
  Camera,
  ChevronDown,
  Clock3,
  Copy,
  Download,
  FileText,
  Forward,
  Headphones,
  Heart,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  Mic,
  Pause,
  Phone,
  Play,
  Plug,
  Plus,
  Reply,
  Send,
  Smile,

  Star,
  Sticker as StickerIcon,
  Trash2,
  User,
  UserRound,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  WaInbox,
  WaMessage,
  WaStickerFav,
  WaTemplate,
  WaTemplateList,
  WaThread,
} from '@smartlogistica/shared';

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

const timeOf = (iso: string): string => format(new Date(iso), 'h:mm aaaa', { locale: es });

/** Errores de Meta traducidos al ESPAÑOL (por codigo). */
const META_ERRORS: Array<[RegExp, string]> = [
  [/131053/, 'No se pudo procesar el archivo: WhatsApp no aceptó el formato o el tamaño del multimedia (131053).'],
  [/131047|re-?engagement/i, 'Han pasado más de 24 horas desde la última respuesta del cliente. Usa una plantilla aprobada para reabrir la conversación (131047).'],
  [/131026/, 'No se pudo entregar: el número puede no tener WhatsApp o bloqueó al negocio (131026).'],
  [/131049/, 'Meta limitó los mensajes de marketing a este usuario (131049). Reintenta en unas horas o usa una plantilla utility.'],
  [/131056/, 'Demasiados mensajes a este número en poco tiempo. Espera unos minutos y reintenta (131056).'],
  [/131048/, 'Meta limitó temporalmente los envíos del número (posible marca de spam) (131048).'],
  [/132000|132001|132005|132007|132012/, 'Problema con la plantilla: no existe, no está aprobada o las variables no coinciden.'],
  [/\b470\b/, 'Solo se puede responder dentro de las 24 horas siguientes al último mensaje del cliente; usa una plantilla aprobada (470).'],
  [/131051/, 'Tipo de mensaje no soportado por WhatsApp (131051).'],
];

/** Motivo del fallo en español (a partir de lo que reportó Meta). */
const failText = (m: WaMessage): string => {
  const raw = (m.error ?? '').trim();
  for (const [re, es] of META_ERRORS) if (re.test(raw)) return es;
  return raw
    ? `No entregado — ${raw.replace(/^Meta:\s*/i, '')}`
    : 'WhatsApp no entregó este mensaje.';
};

/* ============ Numeros de telefono como ENLACE de chat ============ */

// Celulares colombianos (3xx...), con o sin +57, con espacios/guiones/puntos.
const PHONE_RE = /(\+?57[\s.-]?)?(3\d{2}[\s.-]?\d{3}[\s.-]?\d{4})(?!\d)/g;

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
function renderBodyWithPhones(body: string): React.ReactNode {
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

/** Aviso flotante del fallo (aparece al pasar el mouse por el mensaje). */
function FailBanner({ m, mine }: { m: WaMessage; mine: boolean }) {
  if (m.status !== 'failed') return null;
  return (
    <div
      className={cn(
        'pointer-events-none absolute bottom-full z-30 mb-1 hidden w-max max-w-[290px] rounded-lg bg-[#fde8e8] px-3 py-2 text-[12px] leading-snug text-[#8a1f2d] shadow-md group-hover:block dark:bg-[#3b1d22] dark:text-[#f5a3ad]',
        mine ? 'right-0' : 'left-0',
      )}
    >
      {failText(m)}
    </div>
  );
}

const dayLabel = (iso: string): string => {
  const d = new Date(iso);
  if (isToday(d)) return 'HOY';
  if (isYesterday(d)) return 'AYER';
  return format(d, "d 'de' MMMM 'de' yyyy", { locale: es }).toUpperCase();
};

/** Chulitos de WhatsApp: reloj (enviando), ✓, ✓✓, ✓✓ azul, ! rojo (clic = detalle). */
export function Ticks({
  status,
  pending,
  onMedia = false,
  onFail,
}: {
  status: WaMessage['status'];
  pending: boolean;
  onMedia?: boolean;
  /** Con handler, la bolita roja es CLICABLE (muestra el error). */
  onFail?: () => void;
}) {
  const base = onMedia ? 'text-white' : 'text-[#667781] dark:text-[#8696a0]';
  if (pending) return <Clock3 className={cn('h-[13px] w-[13px]', base)} />;
  if (!status) return null;
  if (status === 'failed') {
    const icon = <AlertCircle className="h-[13px] w-[13px] text-[#f15c6d]" />;
    return onFail ? (
      <button type="button" onClick={onFail} aria-label="Ver por qué falló" title="Ver por qué falló">
        {icon}
      </button>
    ) : (
      icon
    );
  }
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

export function WhatsappPanel({
  orderId,
  phone: chatPhone,
  active = true,
  showHeader = true,
}: {
  /** Modo PEDIDO (pestaña del drawer). */
  orderId?: string;
  /** Modo BANDEJA (chat por telefono). */
  phone?: string;
  active?: boolean;
  /** false = la bandeja pinta su propia cabecera (con etiquetas y cerrar). */
  showHeader?: boolean;
}) {
  // Mismos sub-paths en ambos modos (el API los expone identicos).
  const base = orderId ? `/v1/orders/${orderId}/whatsapp` : `/v1/whatsapp/chats/${chatPhone}`;
  const qc = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  // Picker de "/": plantillas de Meta (WABA). tpl = plantilla elegida (llenando variables).
  const [tpl, setTpl] = useState<WaTemplate | null>(null);
  const [tplParams, setTplParams] = useState<string[]>([]);
  const slashMode = !tpl && text.startsWith('/');

  const { data: thread, isLoading, isFetchedAfterMount, dataUpdatedAt } = useQuery({
    queryKey: ['wa-thread', base],
    queryFn: () => api.get<WaThread>(base),
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
        // INSTANTANEO: si el evento trae el mensaje completo, se pinta YA
        // (cero refetch). El evento generico {phone} queda como respaldo.
        const msg = (event as { message?: WaMessage }).message;
        if (msg?.id) {
          qc.setQueryData<WaThread>(['wa-thread', base], (old) => {
            if (!old) return old;
            return old.messages.some((x) => x.id === msg.id)
              ? { ...old, messages: old.messages.map((x) => (x.id === msg.id ? msg : x)) }
              : { ...old, messages: [...old.messages, msg] };
          });
          return;
        }
        qc.invalidateQueries({ queryKey: ['wa-thread', base] });
      },
      [qc, base],
    ),
  );

  const appendMessage = useCallback(
    (msg: WaMessage) => {
      qc.setQueryData<WaThread>(['wa-thread', base], (old) =>
        old && !old.messages.some((m) => m.id === msg.id)
          ? { ...old, messages: [...old.messages, msg] }
          : old,
      );
    },
    [qc, base],
  );

  // ===== SCROLL como WhatsApp: al abrir -> al FONDO (o al divisor de no
  // leidos); los medios cargan despues y ESTIRAN el contenido, asi que un
  // ResizeObserver mantiene el fondo pegado mientras el usuario no suba.
  const count = thread?.messages.length ?? 0;
  const contentRef = useRef<HTMLDivElement>(null);
  const stickBottomRef = useRef(true);
  const initialScrollDoneRef = useRef(false);

  const onThreadScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 120;
  };

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
    error: null,
    starred: false,
    createdAt: new Date().toISOString(),
  });

  const sendText = useMutation({
    mutationFn: (vars: { body: string; tempId: string; replyToId?: string }) =>
      api.post<WaMessage>(`${base}/text`, { text: vars.body, replyToId: vars.replyToId }),
    // OPTIMISTA: la burbuja aparece AL INSTANTE con relojito; el POST corre por detras.
    onMutate: (vars) => {
      const quoted = vars.replyToId
        ? (qc.getQueryData<WaThread>(['wa-thread', base])?.messages.find((x) => x.id === vars.replyToId) ?? null)
        : null;
      appendMessage({
        ...optimistic(vars.body),
        id: vars.tempId,
        replyTo: quoted
          ? {
              id: quoted.id,
              direction: quoted.direction,
              kind: quoted.kind,
              body: quoted.body,
              authorName: quoted.authorName,
            }
          : null,
      });
    },
    onSuccess: (msg, vars) => {
      // Si el SSE ya trajo el mensaje real, solo se quita la burbuja temporal.
      qc.setQueryData<WaThread>(['wa-thread', base], (old) => {
        if (!old) return old;
        const already = old.messages.some((x) => x.id === msg.id);
        return {
          ...old,
          messages: already
            ? old.messages.filter((x) => x.id !== vars.tempId)
            : old.messages.map((x) => (x.id === vars.tempId ? msg : x)),
        };
      });
    },
    onError: (err, vars) => {
      qc.setQueryData<WaThread>(['wa-thread', base], (old) =>
        old ? { ...old, messages: old.messages.filter((x) => x.id !== vars.tempId) } : old,
      );
      setText(vars.body); // devolver el texto al campo para reintentar
      toast.error(err instanceof ApiError ? err.message : 'No se pudo enviar el mensaje');
    },
  });

  // Plantillas de la WABA: se cargan la primera vez que se escribe "/".
  const { data: tplList, isLoading: tplLoading } = useQuery({
    queryKey: ['wa-templates', base],
    queryFn: () => api.get<WaTemplateList>(`${base}/templates`),
    enabled: active && (slashMode || Boolean(tpl)),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const sendTemplate = useMutation({
    mutationFn: (vars: { tpl: WaTemplate; params: string[]; tempId: string }) =>
      api.post<WaMessage>(`${base}/template`, {
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
      // Si el SSE ya trajo el mensaje real, solo se quita la burbuja temporal.
      qc.setQueryData<WaThread>(['wa-thread', base], (old) => {
        if (!old) return old;
        const already = old.messages.some((x) => x.id === msg.id);
        return {
          ...old,
          messages: already
            ? old.messages.filter((x) => x.id !== vars.tempId)
            : old.messages.map((x) => (x.id === vars.tempId ? msg : x)),
        };
      });
    },
    onError: (err, vars) => {
      qc.setQueryData<WaThread>(['wa-thread', base], (old) =>
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
      return api.upload<WaMessage>(`${base}/file`, fd);
    },
    onSuccess: (msg) => appendMessage(msg),
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudo enviar el archivo'),
  });

  // ===== Estado del composer estilo WhatsApp =====
  const [replyTo, setReplyTo] = useState<WaMessage | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [forwardMsg, setForwardMsg] = useState<WaMessage | null>(null);
  const [viewSticker, setViewSticker] = useState<WaMessage | null>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const audioPickRef = useRef<HTMLInputElement>(null);
  const stickerFileRef = useRef<HTMLInputElement>(null);

  // Telefono del hilo (las acciones de mensaje son SIEMPRE por telefono).
  const opPhone = thread?.phone ?? chatPhone ?? null;
  const opBase = `/v1/whatsapp/chats/${opPhone}`;

  // ===== LECTURA sincronizada (bandeja <-> pedidos): ver el chat lo marca leido. =====
  useEffect(() => {
    if (!active || !opPhone || count === 0) return;
    const t = setTimeout(() => {
      void api.post(orderId ? `${base}/read` : `${opBase}/read`, {}).catch(() => null);
      qc.setQueryData<{ chats: Array<{ phone: string; unread: number } & Record<string, unknown>>; labels: string[] }>(
        ['wa-inbox'],
        (old) =>
          old
            ? { ...old, chats: old.chats.map((c) => (c.phone === opPhone ? { ...c, unread: 0 } : c)) }
            : old,
      );
    }, 500);
    return () => clearTimeout(t);
  }, [active, opPhone, count, base, opBase, orderId, qc]);

  // ===== Divisor "N mensajes no leidos": VERDAD del servidor (primer no
  // leido segun la marca de lectura de ESTE usuario), fijado UNA sola vez al
  // abrir (los refetch posteriores ya vienen "leidos" y no lo mueven).
  const [dividerId, setDividerId] = useState<string | null>(null);
  const [dividerCount, setDividerCount] = useState(0);
  const [dividerDone, setDividerDone] = useState(false);
  useEffect(() => {
    // Solo con datos FRESCOS: respuesta post-montaje o precarga reciente
    // (<20s). La cache vieja ya venia "leida" y borraria el divisor.
    const fresh = isFetchedAfterMount || Date.now() - dataUpdatedAt < 20_000;
    if (dividerDone || !thread || !fresh) return;
    setDividerId(thread.firstUnreadId);
    setDividerCount(thread.unreadCount);
    setDividerDone(true);
  }, [thread, dividerDone, isFetchedAfterMount, dataUpdatedAt]);

  // Posicionamiento INSTANTANEO (antes de pintar): apenas hay mensajes
  // (cache incluida) el chat ya nace ABAJO — sin "pensar y bajar". El bucle
  // de ~1.5s lo mantiene abajo mientras las fotos/stickers estiran el
  // contenido, hasta que el usuario interactue (rueda/tacto).
  const userMovedRef = useRef(false);
  useLayoutEffect(() => {
    if (!active || count === 0 || initialScrollDoneRef.current) return;
    initialScrollDoneRef.current = true;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    const markMoved = () => {
      userMovedRef.current = true;
    };
    el.addEventListener('wheel', markMoved, { passive: true });
    el.addEventListener('touchstart', markMoved, { passive: true });
    const until = Date.now() + 1500;
    const pin = () => {
      if (userMovedRef.current) return;
      // Si ya aparecio el divisor de no leidos, ese manda (efecto de abajo).
      if (!el.querySelector('[data-unread-divider]')) el.scrollTop = el.scrollHeight;
      if (Date.now() < until) requestAnimationFrame(pin);
    };
    requestAnimationFrame(pin);
    return () => {
      el.removeEventListener('wheel', markMoved);
      el.removeEventListener('touchstart', markMoved);
    };
  }, [active, count]);

  // Divisor de no leidos (llega con la respuesta fresca): centrarlo — salvo
  // que el usuario ya este navegando.
  useEffect(() => {
    if (!dividerId || userMovedRef.current) return;
    requestAnimationFrame(() => {
      const d = scrollRef.current?.querySelector<HTMLElement>('[data-unread-divider]');
      if (d && !userMovedRef.current) {
        stickBottomRef.current = false;
        d.scrollIntoView({ block: 'center' });
      }
    });
  }, [dividerId]);

  // Mensajes NUEVOS: bajar solo si ya estabamos pegados abajo.
  useEffect(() => {
    if (!active || count === 0 || !initialScrollDoneRef.current || !stickBottomRef.current) return;
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [active, count]);

  // Fotos/stickers cargan y CRECEN el hilo: mantener el fondo pegado.
  const hasThread = Boolean(thread && count > 0);
  useEffect(() => {
    const el = contentRef.current;
    const scroller = scrollRef.current;
    if (!hasThread || !el || !scroller || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (stickBottomRef.current) scroller.scrollTop = scroller.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasThread]);

  // ===== Acciones de mensaje (menu contextual) =====
  const react = useMutation({
    mutationFn: (vars: { messageId: string; emoji: string }) =>
      api.post<{ ok: true }>(`${opBase}/reaction`, vars),
    onMutate: (vars) => {
      qc.setQueryData<WaThread>(['wa-thread', base], (old) =>
        old
          ? {
              ...old,
              messages: old.messages.map((m) =>
                m.id === vars.messageId
                  ? {
                      ...m,
                      reactions: [
                        ...m.reactions.filter((r) => !r.mine),
                        ...(vars.emoji ? [{ emoji: vars.emoji, mine: true }] : []),
                      ],
                    }
                  : m,
              ),
            }
          : old,
      );
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudo enviar la reacción'),
  });

  const star = useMutation({
    mutationFn: (vars: { messageId: string; starred: boolean }) =>
      api.post<{ ok: true }>(`${opBase}/star`, vars),
    onMutate: (vars) => {
      qc.setQueryData<WaThread>(['wa-thread', base], (old) =>
        old
          ? {
              ...old,
              messages: old.messages.map((m) =>
                m.id === vars.messageId ? { ...m, starred: vars.starred } : m,
              ),
            }
          : old,
      );
    },
  });

  const removeMsg = useMutation({
    mutationFn: (messageId: string) =>
      api.delete<{ ok: true }>(`${opBase}/messages/${messageId}`),
    onMutate: (messageId) => {
      qc.setQueryData<WaThread>(['wa-thread', base], (old) =>
        old ? { ...old, messages: old.messages.filter((m) => m.id !== messageId) } : old,
      );
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudo eliminar'),
  });

  const favSticker = useMutation({
    mutationFn: (messageId: string) => api.post<{ ok: true }>(`/v1/whatsapp/stickers`, { messageId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wa-stickers'] });
      toast.success('Sticker agregado a Favoritos');
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudo agregar a Favoritos'),
  });

  const sendSticker = useMutation({
    mutationFn: (vars: { stickerId?: string; messageId?: string }) =>
      api.post<WaMessage>(`${opBase}/sticker`, vars),
    onSuccess: (msg) => appendMessage(msg),
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudo enviar el sticker'),
  });

  const sendStickerFile = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file, file.name);
      return api.upload<WaMessage>(`${opBase}/sticker-upload`, fd);
    },
    onSuccess: (msg) => {
      appendMessage(msg);
      void qc.invalidateQueries({ queryKey: ['wa-stickers'] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudo crear el sticker'),
  });

  const sendContact = useMutation({
    mutationFn: (vars: { name: string; phone: string }) =>
      api.post<WaMessage>(`${opBase}/contact`, vars),
    onSuccess: (msg) => appendMessage(msg),
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudo enviar el contacto'),
  });

  // ===== Grabacion de NOTA DE VOZ (microfono -> archivo -> WhatsApp). =====
  const [recording, setRecording] = useState(false);
  const [recPaused, setRecPaused] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [recStream, setRecStream] = useState<MediaStream | null>(null);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recCancelRef = useRef(false);
  const recTimerRef = useRef<number | undefined>(undefined);

  const startRecTimer = () => {
    recTimerRef.current = window.setInterval(() => setRecSecs((s) => s + 1), 1000);
  };

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime =
        ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((m) =>
          typeof MediaRecorder !== 'undefined' ? MediaRecorder.isTypeSupported(m) : false,
        ) ?? '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recChunksRef.current = [];
      recCancelRef.current = false;
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) recChunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecStream(null);
        if (recCancelRef.current) return;
        const type = rec.mimeType || 'audio/webm';
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        const file = new File([new Blob(recChunksRef.current, { type })], `nota-de-voz.${ext}`, { type });
        sendFile.mutate(file);
      };
      mediaRecRef.current = rec;
      rec.start(250);
      setRecStream(stream);
      setRecording(true);
      setRecPaused(false);
      setRecSecs(0);
      startRecTimer();
    } catch (err) {
      // El navegador PIDE el permiso solo cuando esta en "preguntar"; si el
      // estado quedo en "denegado" no vuelve a preguntar jamas — ahi el unico
      // camino es el candado. Distinguimos con la Permissions API.
      const name = err instanceof DOMException ? err.name : '';
      const msg = err instanceof Error ? err.message : '';
      let state: string | null = null;
      try {
        const p = await navigator.permissions?.query?.({ name: 'microphone' as PermissionName });
        state = p?.state ?? null;
      } catch {
        /* sin Permissions API */
      }
      if (state === 'prompt') {
        toast.error('El navegador no mostró la solicitud de micrófono. Intenta de nuevo.');
      } else if (name === 'NotAllowedError' || name === 'SecurityError' || state === 'denied') {
        toast.error(
          'El navegador tiene DENEGADO el micrófono para este sitio (una vez negado, no vuelve a preguntar). Actívalo en el candado de la barra de direcciones y recarga la página.',
        );
      } else if (name === 'NotFoundError') {
        toast.error('No se encontró ningún micrófono en este equipo.');
      } else if (name === 'NotReadableError') {
        toast.error('Otro programa está usando el micrófono (ciérralo y reintenta).');
      } else {
        toast.error(`No se pudo acceder al micrófono${name ? ` (${name}${msg ? `: ${msg}` : ''})` : ''}.`);
      }
    }
  };
  const togglePauseRec = () => {
    const rec = mediaRecRef.current;
    if (!rec) return;
    if (recPaused) {
      try {
        rec.resume();
      } catch {
        /* no-op */
      }
      startRecTimer();
      setRecPaused(false);
    } else {
      try {
        rec.pause();
      } catch {
        /* no-op */
      }
      window.clearInterval(recTimerRef.current);
      setRecPaused(true);
    }
  };
  const stopRec = (cancel: boolean) => {
    recCancelRef.current = cancel;
    window.clearInterval(recTimerRef.current);
    try {
      mediaRecRef.current?.stop();
    } catch {
      /* ya detenido */
    }
    setRecording(false);
    setRecPaused(false);
  };

  /** Imagen cualquiera -> sticker webp 512x512 con transparencia (canvas). */
  const toStickerWebp = (f: File): Promise<File> =>
    new Promise((resolve, reject) => {
      const img = new window.Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = 512;
        c.height = 512;
        const ctx = c.getContext('2d');
        if (!ctx) return reject(new Error('canvas'));
        const scale = Math.min(512 / img.width, 512 / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (512 - w) / 2, (512 - h) / 2, w, h);
        // Meta exige stickers webp de MENOS de 100KB: bajar calidad hasta caber.
        const tryQuality = (qualities: number[]): void => {
          const quality = qualities[0] ?? 0.45;
          const rest = qualities.slice(1);
          c.toBlob(
            (b) => {
              if (!b) return reject(new Error('webp'));
              if (b.size <= 95 * 1024 || rest.length === 0) {
                resolve(new File([b], 'sticker.webp', { type: 'image/webp' }));
              } else {
                tryQuality(rest);
              }
            },
            'image/webp',
            quality,
          );
        };
        tryQuality([0.9, 0.75, 0.6, 0.45]);
      };
      img.onerror = () => reject(new Error('img'));
      img.src = URL.createObjectURL(f);
    });

  const bubbleActions: BubbleActions = {
    reply: (m) => {
      setReplyTo(m);
      inputRef.current?.focus();
    },
    react: (m, emoji) => react.mutate({ messageId: m.id, emoji }),
    forward: (m) => setForwardMsg(m),
    star: (m) => star.mutate({ messageId: m.id, starred: !m.starred }),
    remove: (m) => {
      if (confirm('¿Eliminar este mensaje de la plataforma? (en el WhatsApp del cliente no se borra)')) {
        removeMsg.mutate(m.id);
      }
    },
    favSticker: (m) => favSticker.mutate(m.id),
    openSticker: (m) => setViewSticker(m),
  };

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
    const quoted = replyTo;
    setReplyTo(null);
    sendText.mutate({ body, tempId: `temp-${crypto.randomUUID()}`, replyToId: quoted?.id });
  };

  if (isLoading) {
    // SIN spinner: se pinta el lienzo del chat (fondo doodle + barra) y los
    // mensajes aparecen en cuanto llegan — se siente instantaneo.
    return (
      <div className="flex h-full flex-col">
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
        </div>
        <div className="bg-[#f0f2f5] px-2 py-2 dark:bg-[#202c33] md:px-3">
          <div className="h-10" />
        </div>
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
      {/* Cabecera del hilo, estilo WhatsApp (la bandeja pinta la suya). */}
      {showHeader ? (
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
      ) : null}

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
        <div
          ref={scrollRef}
          onScroll={onThreadScroll}
          className="absolute inset-0 flex flex-col overflow-y-auto px-4 py-2 md:px-[6%]"
        >
          <div className="mt-auto" aria-hidden />
          <div ref={contentRef} className="flex flex-col">
          {thread.messages.length === 0 ? (
            <div className="py-8 text-center">
              <span className="inline-block rounded-lg bg-[#ffeecd] px-3 py-2 text-[12.5px] text-[#54656f] shadow-sm dark:bg-[#182229] dark:text-[#8696a0]">
                Aún no hay historial para este teléfono. Aquí queda todo lo que se envíe y todo lo
                que llegue o salga por el número.
              </span>
            </div>
          ) : (
            thread.messages.map((m, i) => (
              <div key={m.id} className="contents">
                {m.id === dividerId ? (
                  /* BANDA de borde a borde (oscurecida) + pastilla en negrita,
                     calcada al divisor de WhatsApp. */
                  <div
                    data-unread-divider
                    className="-mx-4 my-2 flex justify-center bg-[#00000010] py-2 dark:bg-[#ffffff0d] md:-mx-[6.82%]"
                  >
                    <span className="rounded-full bg-white px-3.5 py-[5px] text-[12.5px] font-semibold text-[#111b21] shadow-sm dark:bg-[#182229] dark:text-[#e9edef]">
                      {dividerCount === 1 ? '1 mensaje no leído' : `${dividerCount} mensajes no leídos`}
                    </span>
                  </div>
                ) : null}
                <WaBubble message={m} prev={thread.messages[i - 1]} base={base} actions={bubbleActions} />
              </div>
            ))
          )}
          </div>
        </div>
      </div>

      {/* Modales: reenviar, ver sticker, enviar contacto */}
      {forwardMsg ? (
        <ForwardModal
          message={forwardMsg}
          onClose={() => setForwardMsg(null)}
          onDone={() => {
            setForwardMsg(null);
            toast.success('Mensaje reenviado');
          }}
        />
      ) : null}
      {viewSticker ? (
        <StickerViewer
          message={viewSticker}
          onClose={() => setViewSticker(null)}
          onFav={() => {
            favSticker.mutate(viewSticker.id);
            setViewSticker(null);
          }}
          onForward={() => {
            setForwardMsg(viewSticker);
            setViewSticker(null);
          }}
        />
      ) : null}
      {contactOpen ? (
        <ContactModal
          onClose={() => setContactOpen(false)}
          onSend={(name, phone) => {
            setContactOpen(false);
            sendContact.mutate({ name, phone });
          }}
        />
      ) : null}

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

      {/* Picker de EMOJIS y STICKERS (como WhatsApp Web). */}
      {pickerOpen && opPhone ? (
        <EmojiStickerPicker
          thread={thread}
          onEmoji={(e) => {
            setText((t) => t + e);
            inputRef.current?.focus();
          }}
          onSticker={(vars) => sendSticker.mutate(vars)}
          onCreateSticker={() => stickerFileRef.current?.click()}
        />
      ) : null}

      {/* CITA al responder (encima del campo, como WhatsApp). */}
      {replyTo ? (
        <div className="flex items-center gap-2 bg-[#f0f2f5] px-3 pt-2 dark:bg-[#202c33]">
          <div className="flex min-w-0 flex-1 overflow-hidden rounded-[6px] bg-white dark:bg-[#2a3942]">
            <span className="w-1 shrink-0" style={{ backgroundColor: replyTo.direction === 'out' ? '#06cf9c' : '#e17bb5' }} />
            <div className="min-w-0 px-2 py-1">
              <p className="truncate text-[12.5px] font-semibold" style={{ color: replyTo.direction === 'out' ? '#06cf9c' : '#e17bb5' }}>
                {replyTo.direction === 'out' ? (replyTo.authorName ?? 'Tú') : (thread.contactName ?? 'Cliente')}
              </p>
              <p className="line-clamp-1 text-[12.5px] text-[#667781] dark:text-[#8696a0]">
                {replyTo.kind === 'text' ? (replyTo.body ?? '') : replyTo.kind === 'image' ? '📷 Foto' : replyTo.kind === 'video' ? '🎬 Video' : replyTo.kind === 'audio' ? '🎙️ Audio' : replyTo.kind === 'sticker' ? '🩵 Sticker' : `📎 ${replyTo.body ?? 'Archivo'}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setReplyTo(null)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#54656f] hover:bg-black/5 dark:text-[#8696a0] dark:hover:bg-white/5"
            aria-label="Cancelar respuesta"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {/* Composer estilo WhatsApp: + | emoji | campo | mic/enviar */}
      <div className="relative bg-[#f0f2f5] px-2 py-2 dark:bg-[#202c33] md:px-3">
        {/* Inputs ocultos del menu "+" */}
        <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) sendFile.mutate(f); e.target.value = ''; }} />
        <input ref={docRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip,.rar" onChange={(e) => { const f = e.target.files?.[0]; if (f) sendFile.mutate(f); e.target.value = ''; }} />
        <input ref={mediaRef} type="file" className="hidden" accept="image/*,video/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) sendFile.mutate(f); e.target.value = ''; }} />
        <input ref={cameraRef} type="file" className="hidden" accept="image/*" capture="environment" onChange={(e) => { const f = e.target.files?.[0]; if (f) sendFile.mutate(f); e.target.value = ''; }} />
        <input ref={audioPickRef} type="file" className="hidden" accept="audio/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) sendFile.mutate(f); e.target.value = ''; }} />
        <input
          ref={stickerFileRef}
          type="file"
          className="hidden"
          accept="image/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            void toStickerWebp(f)
              .then((s) => sendStickerFile.mutate(s))
              .catch(() => toast.error('No se pudo convertir la imagen a sticker'));
          }}
        />

        {/* Menu del "+" (Documento / Fotos y videos / Camara / Audio / Contacto / Nuevo sticker) */}
        {attachOpen ? (
          <>
            <button type="button" className="fixed inset-0 z-20 cursor-default" onClick={() => setAttachOpen(false)} aria-label="Cerrar menú" />
            <div className="shadow-float absolute bottom-14 left-2 z-30 w-56 rounded-2xl border border-border bg-white py-1.5 dark:bg-[#233138]">
              {[
                { icon: FileText, color: '#7f66ff', label: 'Documento', act: () => docRef.current?.click() },
                { icon: ImageIcon, color: '#007bfc', label: 'Fotos y videos', act: () => mediaRef.current?.click() },
                { icon: Camera, color: '#ff2e74', label: 'Cámara', act: () => cameraRef.current?.click() },
                { icon: Headphones, color: '#fa6533', label: 'Audio', act: () => audioPickRef.current?.click() },
                { icon: UserRound, color: '#009de2', label: 'Contacto', act: () => setContactOpen(true) },
                { icon: StickerIcon, color: '#02a698', label: 'Nuevo sticker', act: () => stickerFileRef.current?.click() },
              ].map((it) => (
                <button
                  key={it.label}
                  type="button"
                  onClick={() => {
                    setAttachOpen(false);
                    it.act();
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[14.5px] text-[#111b21] transition-colors hover:bg-[#f5f6f6] dark:text-[#e9edef] dark:hover:bg-white/5"
                >
                  <it.icon className="h-5 w-5" style={{ color: it.color }} />
                  {it.label}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {recording ? (
          /* Barra de GRABACION calcada a WhatsApp Web: pastilla blanca con
             papelera | punto rojo + contador | ONDA EN VIVO | pausa | enviar. */
          <div className="flex h-11 items-center gap-2 rounded-full bg-white px-2.5 dark:bg-[#2a3942]">
            <button
              type="button"
              onClick={() => stopRec(true)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#54656f] hover:bg-black/5 dark:text-[#8696a0] dark:hover:bg-white/5"
              aria-label="Cancelar grabación"
              title="Descartar"
            >
              <Trash2 className="h-[18px] w-[18px]" />
            </button>
            <span className="flex shrink-0 items-center gap-1.5 text-[14px] tabular-nums text-[#3b4a54] dark:text-[#e9edef]">
              <span className={cn('h-2.5 w-2.5 rounded-full bg-[#f15c6d]', !recPaused && 'animate-pulse')} />
              {fmtSecs(recSecs)}
            </span>
            <LiveWave stream={recStream} paused={recPaused} />
            <button
              type="button"
              onClick={togglePauseRec}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#f15c6d] hover:bg-black/5 dark:hover:bg-white/5"
              aria-label={recPaused ? 'Reanudar' : 'Pausar'}
              title={recPaused ? 'Reanudar' : 'Pausar'}
            >
              {recPaused ? <Mic className="h-5 w-5" /> : <Pause className="h-5 w-5 fill-current" />}
            </button>
            <button
              type="button"
              onClick={() => stopRec(false)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white hover:bg-[#029377]"
              aria-label="Enviar nota de voz"
            >
              <Send className="h-[18px] w-[18px]" />
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-0.5">
            <button
              type="button"
              onClick={() => setAttachOpen((v) => !v)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#54656f] transition-transform hover:bg-black/5 dark:text-[#8696a0] dark:hover:bg-white/5"
              aria-label="Adjuntar"
            >
              <Plus className={cn('h-6 w-6 transition-transform', attachOpen && 'rotate-45')} />
            </button>
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-black/5 dark:hover:bg-white/5',
                pickerOpen ? 'text-[#00a884]' : 'text-[#54656f] dark:text-[#8696a0]',
              )}
              aria-label="Emojis y stickers"
            >
              <Smile className="h-6 w-6" />
            </button>
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && slashMode) {
                  e.preventDefault();
                  e.stopPropagation(); // no cerrar el chat: solo salir del modo "/"
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
              className="mx-1 h-10 min-w-0 flex-1 rounded-lg bg-white px-4 text-[16px] text-[#111b21] outline-none placeholder:text-[#667781] dark:bg-[#2a3942] dark:text-[#e9edef] dark:placeholder:text-[#8696a0] md:text-[14.5px]"
            />
            {text.trim() ? (
              /* Con texto: ENVIAR (boton verde como WhatsApp). */
              <button
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onClick={submit}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white transition-colors hover:bg-[#029377]"
                aria-label="Enviar"
              >
                <Send className="h-5 w-5" />
              </button>
            ) : (
              /* Sin texto: MICROFONO (mantener el flujo de nota de voz). */
              <button
                type="button"
                onClick={() => void startRec()}
                disabled={sendFile.isPending}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#54656f] transition-colors hover:bg-black/5 disabled:opacity-50 dark:text-[#8696a0] dark:hover:bg-white/5"
                aria-label="Grabar nota de voz"
              >
                {sendFile.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mic className="h-6 w-6" />}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================== Burbujas ============================== */

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
function useSinglePopover(open: boolean, onClose: () => void): void {
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

function MsgMenu({
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
function AnchoredReactionBar({
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
function HoverActions({
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
function anchorAtPoint(e: React.MouseEvent, el: HTMLElement | null): MsgMenuAnchor | null {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const below = window.innerHeight - e.clientY;
  const up = below < 440 && e.clientY > below;
  const left = Math.min(Math.max(0, e.clientX - rect.left), Math.max(0, rect.width - 264));
  return up
    ? { up, left, bottom: rect.height - (e.clientY - rect.top) }
    : { up, left, top: e.clientY - rect.top };
}

function WaBubble({
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
        // DOBLE CLIC en el mensaje o su espacio lateral: responder (con
        // destello verde de medio segundo, como WhatsApp).
        onDoubleClick={() => {
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
            <FailBanner m={m} mine={mine} />
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
      <FailBanner m={m} mine={mine} />
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
        {mine ? <Ticks status={m.status} pending={pending} /> : null}
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
      {timeOf(m.createdAt)}
      {mine ? (
        <Ticks status={m.status} pending={pending} onMedia={onMedia} />
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
            className={cn('inline-block h-0', mine ? 'w-[88px]' : 'w-[62px]')}
            aria-hidden
          />
        </p>
        <span className="absolute bottom-[3px] right-[7px]">{timeRow()}</span>
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

/* ===================== Nota de voz (estilo WhatsApp) ===================== */

/**
 * Onda EN VIVO de la grabacion: AnalyserNode sobre el microfono + canvas a
 * 60fps (requestAnimationFrame). Las barras son la amplitud REAL y se
 * desplazan fluidas como en WhatsApp Web.
 */
function LiveWave({ stream, paused }: { stream: MediaStream | null; paused: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barsRef = useRef<number[]>([]);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!stream || !canvas) return;
    type AC = typeof AudioContext;
    const Ctx: AC | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: AC }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    // Canvas nitido (dpr) al tamaño real del hueco.
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth * dpr;
    const h = canvas.clientHeight * dpr;
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    barsRef.current = [];

    const BAR_W = 2 * dpr;
    const GAP = 2 * dpr;
    const maxBars = Math.max(8, Math.floor(w / (BAR_W + GAP)));
    let raf = 0;
    let frame = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!g) return;
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs((data[i] ?? 128) - 128) / 128;
        if (v > peak) peak = v;
      }
      // Nueva barra cada ~50ms (el DIBUJO va a 60fps igual).
      if (!pausedRef.current && frame++ % 3 === 0) {
        barsRef.current.push(Math.min(1, peak * 1.6));
        if (barsRef.current.length > maxBars) barsRef.current.shift();
      }
      g.clearRect(0, 0, w, h);
      g.fillStyle = '#8696a0';
      const bars = barsRef.current;
      // Ancladas a la DERECHA, desplazandose a la izquierda (como WhatsApp).
      for (let i = 0; i < bars.length; i++) {
        const v = bars[bars.length - 1 - i] ?? 0;
        const bh = Math.max(2 * dpr, v * h * 0.86);
        const x = w - (i + 1) * (BAR_W + GAP);
        if (x < 0) break;
        g.fillRect(x, (h - bh) / 2, BAR_W, bh);
      }
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      void ctx.close();
    };
  }, [stream]);

  return <canvas ref={canvasRef} className="h-8 min-w-0 flex-1" />;
}

const BAR_COUNT = 40;

/** Barras de respaldo (si el audio no se puede decodificar): onda suave estable. */
const fallbackBars = (seed: string): number[] => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Array.from({ length: BAR_COUNT }, (_, i) => {
    const v = Math.abs(Math.sin(i * 0.55 + (h % 17)) * 0.7 + Math.sin(i * 1.7 + h) * 0.3);
    return 0.2 + v * 0.8;
  });
};

const fmtSecs = (s: number): string => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

/**
 * Reproductor de nota de voz CALCADO a WhatsApp: avatar con microfono, play,
 * ONDAS REALES del audio (Web Audio API decodifica y saca los picos; si el
 * navegador no puede, onda de respaldo), punto de progreso, duracion y hora.
 */
function WaAudio({
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
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [dur, setDur] = useState<number | null>(null);
  const [t, setT] = useState(0);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  // Primero por NUESTRA API (misma origen: la onda se puede decodificar sin
  // CORS); si el audio viejo solo tiene URL externa, se cae a esa.
  const apiSrc = `${base}/audio/${m.id}`;
  const [src, setSrc] = useState(apiSrc);

  // Ondas REALES: decodificar el audio y muestrear los picos por bloque.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        let res = await fetch(apiSrc, { credentials: 'include' });
        if (!res.ok && m.mediaUrl) res = await fetch(m.mediaUrl);
        if (!res.ok) return;
        const buf = await res.arrayBuffer();
        type AC = typeof AudioContext;
        const Ctx: AC | undefined =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: AC }).webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        const decoded = await ctx.decodeAudioData(buf);
        const ch = decoded.getChannelData(0);
        const block = Math.max(1, Math.floor(ch.length / BAR_COUNT));
        const p: number[] = [];
        for (let i = 0; i < BAR_COUNT; i++) {
          let peak = 0;
          for (let j = 0; j < block; j += 32) peak = Math.max(peak, Math.abs(ch[i * block + j] ?? 0));
          p.push(peak);
        }
        const max = Math.max(...p, 0.01);
        if (alive) {
          setPeaks(p.map((v) => Math.max(0.18, v / max)));
          if (Number.isFinite(decoded.duration)) setDur(decoded.duration);
        }
        void ctx.close();
      } catch {
        /* CORS o formato raro: quedan las barras de respaldo */
      }
    })();
    return () => {
      alive = false;
    };
  }, [apiSrc, m.mediaUrl]);

  const bars = peaks ?? fallbackBars(m.id);
  const progress = dur && dur > 0 ? Math.min(1, t / dur) : 0;

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) a.pause();
    else void a.play();
  };
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !dur) return;
    const rect = e.currentTarget.getBoundingClientRect();
    a.currentTime = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1) * dur;
  };

  const barPlayed = mine ? 'bg-[#4f7d68] dark:bg-[#94b8ab]' : 'bg-[#7a8a93] dark:bg-[#8696a0]';
  const barIdle = mine ? 'bg-[#a9cbb7] dark:bg-[#1d5c4d]' : 'bg-[#cdd4d8] dark:bg-[#3b4a54]';

  return (
    <div className="flex w-[300px] max-w-full items-center gap-2.5 px-2 pb-1 pt-2">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        className="hidden"
        onError={() => {
          if (m.mediaUrl && src !== m.mediaUrl) setSrc(m.mediaUrl);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setT(0);
        }}
        onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d)) setDur(d);
        }}
      />
      {/* Avatar con microfono (la Cloud API no expone la foto del contacto). */}
      <span className="relative h-[45px] w-[45px] shrink-0">
        <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-[#dfe5e7] text-[#9aa8b0] dark:bg-[#2a3942] dark:text-[#667781]">
          <User className="h-7 w-7 translate-y-1" strokeWidth={1.6} fill="currentColor" />
        </span>
        <Mic className={cn('absolute -left-1 bottom-0 h-4 w-4', mine ? 'text-[#00a884]' : 'text-[#53bdeb]')} />
      </span>
      <button
        type="button"
        onClick={toggle}
        className="shrink-0 text-[#667781] transition-colors hover:text-[#54656f] dark:text-[#8696a0]"
        aria-label={playing ? 'Pausar' : 'Reproducir'}
      >
        {playing ? <Pause className="h-7 w-7 fill-current" /> : <Play className="h-7 w-7 fill-current" />}
      </button>
      <div className="min-w-0 flex-1">
        {/* Onda + punto de progreso */}
        <div className="relative flex h-[26px] cursor-pointer items-center gap-[2px]" onClick={seek}>
          {bars.map((v, i) => (
            <span
              key={i}
              className={cn(
                'w-[2.5px] shrink-0 rounded-full',
                i / BAR_COUNT <= progress && (playing || t > 0) ? barPlayed : barIdle,
              )}
              style={{ height: `${Math.round(4 + v * 20)}px` }}
            />
          ))}
          {playing || t > 0 ? (
            <span
              className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-[#4fc3f7] shadow"
              style={{ left: `calc(${(progress * 100).toFixed(2)}% - 6px)` }}
            />
          ) : null}
        </div>
        <div className="mt-0.5 flex items-center justify-between text-[11px] text-[#667781] dark:text-[#8696a0]">
          <span>{fmtSecs(playing || t > 0 ? t : (dur ?? 0))}</span>
          <span className="flex items-center gap-1">
            {timeOf(m.createdAt)}
            {mine ? <Ticks status={m.status} pending={pending} /> : null}
          </span>
        </div>
      </div>
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

/* ==================== Picker de emojis y stickers ==================== */

/** Categorias como WhatsApp (pestañas arriba con icono + Recientes). */
const EMOJI_GROUPS: Array<{ icon: string; label: string; list: string }> = [
  {
    icon: '😀',
    label: 'Emoticonos y personas',
    list:
      '😀😃😄😁😆😅😂🤣😊😇🙂🙃😉😌😍🥰😘😗😙😚😋😛😝😜🤪🤨🧐🤓😎🥸🤩🥳😏😒😞😔😟😕🙁😣😖😫😩🥺😢😭😤😠😡🤬🤯😳🥵🥶😱😨😰😥😓🤗🤔🤭🤫🤥😶😐😑😬🙄😯😦😧😮😲🥱😴🤤😪🤐🥴🤢🤮🤧😷🤒🤕🤑🤠😈👿💀👻👽🤖💩' +
      '👍👎👌🤌🤏✌️🤞🤟🤘🤙👈👉👆👇☝️✋🤚🖐️🖖👋🤝🙏✍️💪🖕✊👊🤛🤜👏🙌👐🤲🤳💅👀👁️👄🦷👅👂👃🧠',
  },
  {
    icon: '🐻',
    label: 'Animales y naturaleza',
    list:
      '🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🙈🙉🙊🐔🐧🐦🐤🦆🦅🦉🐺🐗🐴🦄🐝🐛🦋🐌🐞🐜🦂🐢🐍🦎🐙🦑🦐🦞🦀🐡🐠🐟🐬🐳🐋🦈🐊🦓🦍🐘🦒🐄🐎🐖🐑🦙🐐🦌🐕🐩🐈🐓🦃🦚🦜🦢🦩🐇🦝🦨🦥🐿️🦔' +
      '🌵🎄🌲🌳🌴🌱🌿🍀🎍🎋🍃🍂🍁🍄🌾💐🌷🌹🥀🌺🌸🌼🌻🌞🌝🌛🌜🌚🌕🌙⭐🌟💫✨☀️⛅☁️🌧️⛈️🌩️❄️⛄💨💧💦☔🌊🌈🌍🌎🌏',
  },
  {
    icon: '🍔',
    label: 'Comida y bebidas',
    list: '🍏🍎🍐🍊🍋🍌🍉🍇🍓🫐🍈🍒🍑🥭🍍🥥🥝🍅🍆🥑🥦🥬🥒🌶️🌽🥕🧄🧅🥔🍠🥐🥯🍞🥖🥨🧀🥚🍳🥞🧇🥓🥩🍗🍖🌭🍔🍟🍕🥪🥙🧆🌮🌯🥗🥘🍝🍜🍲🍛🍣🍱🥟🍤🍙🍚🍘🥠🍢🍡🍧🍨🍦🥧🧁🍰🎂🍮🍭🍬🍫🍿🍩🍪🌰🥜🍯🥛🍼☕🍵🧃🥤🧋🍶🍺🍻🥂🍷🥃🍸🍹🍾🧊',
  },
  {
    icon: '⚽',
    label: 'Actividades',
    list: '⚽🏀🏈⚾🎾🏐🎱🏓🏸⛳🏹🎣🥊🥋🎽🛹⛸️🎿🛷🥌🏆🥇🥈🥉🏅🎖️🎮🕹️🎰🎲🧩🎭🎨🧵🧶🎯🎳🎪🎤🎧🎼🎹🥁🎷🎺🎸🎻🎬🏹',
  },
  {
    icon: '🚗',
    label: 'Viajes y lugares',
    list: '🚗🚕🚙🚌🚎🏎️🚓🚑🚒🚐🚚🚛🚜🏍️🛵🚲🛴🚨🚔🚖✈️🛫🛬🛩️🚀🛸🚁⛵🚤🛳️⛴️🚢⚓⛽🚧🚦🚥🚏🗺️🗿🗽🗼🏰🏯🏟️🎡🎢🎠⛲⛱️🏖️🏝️🏜️🌋⛰️🏔️🗻🏕️⛺🏠🏡🏘️🏗️🏭🏢🏬🏣🏤🏥🏦🏨🏪🏫💒⛪🕌🛕🕋⛩️🚄🚅🚂🚉🚊🚝🚞🚋🚃🚟🚠🚡',
  },
  {
    icon: '💡',
    label: 'Objetos',
    list: '📱💻⌨️🖥️🖨️🖱️💽💾💿📀📷📸📹🎥📞☎️📺📻⏰⌚⏳⌛💡🔦🕯️💸💵💰💳💎🪜🧰🔧🔨🛠️⚙️🧲🧨🔪🏺🔮🧿🔭🔬💊💉🩸🧬🧹🧺🧻🚽🚿🛁🧼🧽🛎️🔑🗝️🚪🪑🛋️🛏️🧸🖼️🛍️🎁🎈🎀🎊🎉📦📫📜📃📊📈📉📆📅📇📋📁📂📰📓📚📖🔖📎📐📏📌📍✂️🖊️✒️📝✏️🔍🔎🔐🔒🔓',
  },
  {
    icon: '🔣',
    label: 'Símbolos',
    list: '❤️🧡💛💚💙💜🖤🤍🤎💔💕💞💓💗💖💘💝💟💋✅❌❓❗‼️⁉️💯🔥✨🎵🎶➕➖➗✖️💲™️©️®️🔴🟠🟡🟢🔵🟣⚫⚪🟤🔺🔻🔸🔹🔶🔷⚠️🚫♻️🔞📵🚭🚱🚳🚷🛑💤♠️♥️♦️♣️🃏🀄🎴🔔🔕📣📢💬💭🗯️♨️💈🛐⚛️✝️☪️☮️🕎🔯♈♉♊♋♌♍♎♏♐♑♒♓⛎',
  },
  {
    icon: '🏳️',
    label: 'Banderas',
    list: '🏳️🏴🏁🚩🏳️‍🌈🇨🇴🇺🇸🇲🇽🇪🇸🇦🇷🇧🇷🇨🇱🇵🇪🇪🇨🇻🇪🇵🇦🇨🇷🇬🇹🇭🇳🇸🇻🇳🇮🇩🇴🇨🇺🇵🇷🇧🇴🇵🇾🇺🇾🇨🇦🇬🇧🇫🇷🇩🇪🇮🇹🇵🇹🇳🇱🇨🇭🇸🇪🇳🇴🇩🇰🇯🇵🇰🇷🇨🇳🇮🇳🇷🇺🇦🇺🇹🇷🇬🇷🇮🇱🇸🇦🇦🇪🇪🇬🇿🇦🇳🇬',
  },
];

/** Busqueda basica en español (palabra -> emojis). */
const EMOJI_KEYWORDS: Record<string, string> = {
  corazon: '❤️🧡💛💚💙💜🖤🤍💔💕💖💘', amor: '❤️😍🥰😘💕💋', risa: '😂🤣😆😅😄', jaja: '😂🤣',
  feliz: '😀😃😄😊🙂', triste: '😢😭😞🙁', llorar: '😢😭', enojo: '😠😡🤬', rabia: '😠😡🤬',
  fuego: '🔥', ok: '👌👍✅', bien: '👍✅💯', mal: '👎❌', gracias: '🙏', porfavor: '🙏',
  mano: '👋🤝👏🙌✋', saludo: '👋🤗', fiesta: '🥳🎉🎊🎈', musica: '🎵🎶🎧🎸🎹', baile: '💃🕺',
  dinero: '💰💵💸💳', plata: '💰💵💸', comida: '🍔🍕🌭🍟🍗', cafe: '☕', cerveza: '🍺🍻',
  perro: '🐶🐕', gato: '🐱🐈', casa: '🏠🏡', carro: '🚗🏎️🚙', moto: '🏍️🛵', avion: '✈️🛫',
  telefono: '📱☎️📞', celular: '📱', foto: '📷📸', video: '🎥📹', regalo: '🎁🎀',
  estrella: '⭐🌟✨', sol: '☀️🌞', luna: '🌙🌛', lluvia: '🌧️☔⛈️', frio: '🥶❄️⛄', calor: '🥵☀️',
  check: '✅✔️', chulo: '✅', equis: '❌', pregunta: '❓', alerta: '⚠️🚨', prohibido: '🚫⛔',
  cohete: '🚀', cien: '💯', bandera: '🏁🚩🏳️', colombia: '🇨🇴', dormir: '😴🥱💤',
  beso: '😘😗💋', guiño: '😉', pensar: '🤔🧐', ojos: '👀', paquete: '📦', caja: '📦',
  envio: '📦🚚✈️', camion: '🚚🚛', reloj: '⏰⌚⏳', tiempo: '⏰⌛', fantasma: '👻',
  calavera: '💀', diablo: '😈', payaso: '🤡', robot: '🤖', unicornio: '🦄', flor: '🌹🌷🌸💐',
  arbol: '🌳🎄🌴', libro: '📚📖', lapiz: '✏️🖊️', tijeras: '✂️', llave: '🔑🗝️', candado: '🔒🔐',
  medalla: '🏅🥇🏆', trofeo: '🏆', balon: '⚽🏀', futbol: '⚽', gol: '⚽🥅🎉',
};

/** Recientes (localStorage), como la pestaña Recientes de WhatsApp. */
const RECENT_EMOJI_KEY = 'wa-recent-emojis';
const getRecentEmojis = (): string[] => {
  try {
    const raw = JSON.parse(window.localStorage.getItem(RECENT_EMOJI_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.map(String).slice(0, 24) : [];
  } catch {
    return [];
  }
};
const pushRecentEmoji = (e: string): void => {
  try {
    const cur = getRecentEmojis().filter((x) => x !== e);
    window.localStorage.setItem(RECENT_EMOJI_KEY, JSON.stringify([e, ...cur].slice(0, 24)));
  } catch {
    /* sin storage */
  }
};

/** Trocea una tira de emojis en emojis completos (ZWJ/VS16/tonos/banderas). */
const splitEmojis = (list: string): string[] =>
  list.match(
    /[\u{1F1E6}-\u{1F1FF}]{2}|\p{Extended_Pictographic}(‍\p{Extended_Pictographic}|️|[\u{1F3FB}-\u{1F3FF}])*/gu,
  ) ?? [];

/** Panel de emojis y stickers, estilo WhatsApp Web (pestañas abajo). */
function EmojiStickerPicker({
  thread,
  onEmoji,
  onSticker,
  onCreateSticker,
}: {
  thread: WaThread;
  onEmoji: (emoji: string) => void;
  onSticker: (vars: { stickerId?: string; messageId?: string }) => void;
  onCreateSticker: () => void;
}) {
  const [tab, setTab] = useState<'emoji' | 'sticker'>('emoji');
  const [q, setQ] = useState('');
  const [recents, setRecents] = useState<string[]>([]);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  useEffect(() => setRecents(getRecentEmojis()), []);

  const pickEmoji = (e: string) => {
    onEmoji(e);
    pushRecentEmoji(e);
    setRecents(getRecentEmojis());
  };
  const jumpTo = (key: string) => sectionRefs.current[key]?.scrollIntoView({ block: 'start' });

  // Busqueda basica en español (diccionario de palabras clave).
  const query = q.trim().toLowerCase();
  const results = useMemo(() => {
    if (!query) return [];
    const out = new Set<string>();
    for (const [word, emojis] of Object.entries(EMOJI_KEYWORDS)) {
      if (word.includes(query)) splitEmojis(emojis).forEach((e) => out.add(e));
    }
    return [...out];
  }, [query]);

  const { data: favs = [] } = useQuery({
    queryKey: ['wa-stickers'],
    queryFn: () => api.get<WaStickerFav[]>('/v1/whatsapp/stickers'),
    staleTime: 60_000,
    enabled: tab === 'sticker',
  });

  // Stickers RECIENTES del hilo (los que ya pasaron por el chat).
  const recentStickers = useMemo(() => {
    const seen = new Set<string>();
    const out: WaMessage[] = [];
    for (let i = thread.messages.length - 1; i >= 0 && out.length < 18; i--) {
      const m = thread.messages[i]!;
      if (m.kind === 'sticker' && m.mediaUrl && !seen.has(m.mediaUrl)) {
        seen.add(m.mediaUrl);
        out.push(m);
      }
    }
    return out;
  }, [thread.messages]);

  return (
    <div className="border-t border-border bg-[#f0f2f5] dark:bg-[#202c33]">
      {tab === 'emoji' ? (
        <>
          {/* Pestañas ARRIBA por categoria (con Recientes), como WhatsApp. */}
          <div className="flex items-center justify-around border-b border-border/60 px-1">
            <button
              type="button"
              onClick={() => jumpTo('recientes')}
              className="px-1.5 py-1.5 text-[#54656f] dark:text-[#8696a0]"
              title="Recientes"
              aria-label="Recientes"
            >
              <Clock3 className="h-5 w-5" />
            </button>
            {EMOJI_GROUPS.map((g) => (
              <button
                key={g.label}
                type="button"
                onClick={() => jumpTo(g.label)}
                className="px-1 py-1 text-[19px] leading-[24px] opacity-60 grayscale transition-all hover:opacity-100 hover:grayscale-0"
                title={g.label}
                aria-label={g.label}
              >
                {g.icon}
              </button>
            ))}
          </div>
          {/* Buscador */}
          <div className="px-3 pb-1 pt-2">
            <div className="flex h-9 items-center gap-2 rounded-full border border-[#00a884]/60 bg-white px-3 dark:bg-[#2a3942]">
              <span className="text-[#667781] dark:text-[#8696a0]">🔍</span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar emoji"
                className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-[#667781] dark:text-[#e9edef] dark:placeholder:text-[#8696a0]"
              />
              {q ? (
                <button type="button" onClick={() => setQ('')} aria-label="Limpiar">
                  <X className="h-3.5 w-3.5 text-[#667781]" />
                </button>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
      <div className={cn('overflow-y-auto px-3 py-2', tab === 'emoji' ? 'h-[220px]' : 'h-[264px]')}>
        {tab === 'emoji' ? (
          query ? (
            <div className="flex flex-wrap">
              {results.length === 0 ? (
                <p className="w-full py-6 text-center text-[12.5px] text-[#667781] dark:text-[#8696a0]">
                  Sin resultados para «{q}».
                </p>
              ) : (
                results.map((e, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => pickEmoji(e)}
                    className="rounded-lg p-1 text-[24px] leading-[30px] transition-transform hover:scale-110"
                  >
                    {e}
                  </button>
                ))
              )}
            </div>
          ) : (
            <>
              {recents.length > 0 ? (
                <div
                  ref={(el) => {
                    sectionRefs.current['recientes'] = el;
                  }}
                >
                  <p className="px-1 pb-1 pt-1 text-[13px] text-[#667781] dark:text-[#8696a0]">Recientes</p>
                  <div className="flex flex-wrap">
                    {recents.map((e, i) => (
                      <button
                        key={`rec-${i}`}
                        type="button"
                        onClick={() => pickEmoji(e)}
                        className="rounded-lg p-1 text-[24px] leading-[30px] transition-transform hover:scale-110"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {EMOJI_GROUPS.map((g) => (
                <div
                  key={g.label}
                  ref={(el) => {
                    sectionRefs.current[g.label] = el;
                  }}
                >
                  <p className="px-1 pb-1 pt-3 text-[13px] text-[#667781] dark:text-[#8696a0]">{g.label}</p>
                  <div className="flex flex-wrap">
                    {splitEmojis(g.list).map((e, i) => (
                      <button
                        key={`${g.label}-${i}`}
                        type="button"
                        onClick={() => pickEmoji(e)}
                        className="rounded-lg p-1 text-[24px] leading-[30px] transition-transform hover:scale-110"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )
        ) : (
          <div>
            <p className="px-1 pb-1 pt-2 text-[11.5px] font-semibold uppercase tracking-wide text-[#667781] dark:text-[#8696a0]">
              Favoritos
            </p>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
              <button
                type="button"
                onClick={onCreateSticker}
                className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border text-[#667781] transition-colors hover:bg-black/5 dark:text-[#8696a0] dark:hover:bg-white/5"
              >
                <Plus className="h-6 w-6" />
                <span className="text-[11px]">Crear</span>
              </button>
              {favs.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSticker({ stickerId: s.id })}
                  className="aspect-square overflow-hidden rounded-xl p-1 transition-transform hover:scale-105"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.url} alt="Sticker favorito" className="h-full w-full object-contain" />
                </button>
              ))}
            </div>
            {recentStickers.length > 0 ? (
              <>
                <p className="px-1 pb-1 pt-3 text-[11.5px] font-semibold uppercase tracking-wide text-[#667781] dark:text-[#8696a0]">
                  Recientes del chat
                </p>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                  {recentStickers.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onSticker({ messageId: m.id })}
                      className="aspect-square overflow-hidden rounded-xl p-1 transition-transform hover:scale-105"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={m.mediaUrl ?? ''} alt="Sticker" className="h-full w-full object-contain" />
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            {favs.length === 0 && recentStickers.length === 0 ? (
              <p className="px-2 py-6 text-center text-[12.5px] text-[#667781] dark:text-[#8696a0]">
                Aún no hay stickers: crea uno con «Crear» o agrega a Favoritos los que lleguen al
                chat (clic en el sticker → Añadir a Favoritos).
              </p>
            ) : null}
          </div>
        )}
      </div>
      {/* Pestañas abajo, como WhatsApp Web */}
      <div className="flex justify-center gap-1 border-t border-border py-1.5">
        <button
          type="button"
          onClick={() => setTab('emoji')}
          className={cn(
            'flex items-center gap-1.5 rounded-full px-4 py-1 text-[12.5px] transition-colors',
            tab === 'emoji'
              ? 'bg-white font-medium text-[#111b21] shadow-sm dark:bg-[#2a3942] dark:text-[#e9edef]'
              : 'text-[#667781] hover:bg-black/5 dark:text-[#8696a0] dark:hover:bg-white/5',
          )}
        >
          <Smile className="h-4 w-4" />
          Emoji
        </button>
        <button
          type="button"
          onClick={() => setTab('sticker')}
          className={cn(
            'flex items-center gap-1.5 rounded-full px-4 py-1 text-[12.5px] transition-colors',
            tab === 'sticker'
              ? 'bg-white font-medium text-[#111b21] shadow-sm dark:bg-[#2a3942] dark:text-[#e9edef]'
              : 'text-[#667781] hover:bg-black/5 dark:text-[#8696a0] dark:hover:bg-white/5',
          )}
        >
          <StickerIcon className="h-4 w-4" />
          Stickers
        </button>
      </div>
    </div>
  );
}

/* ==================== Modales (reenviar / sticker / contacto) ==================== */

/** Reenviar un mensaje a OTRO chat (lista de la bandeja). */
function ForwardModal({
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
function StickerViewer({
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
function ContactModal({
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
