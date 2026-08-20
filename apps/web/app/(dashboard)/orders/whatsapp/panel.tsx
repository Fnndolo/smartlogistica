'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Camera,
  FileText,
  Headphones,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  Mic,
  Pause,
  Phone,
  Plug,
  Plus,
  Send,
  Smile,
  Sticker as StickerIcon,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { WaMessage, WaTemplate, WaTemplateList, WaThread } from '@smartlogistica/shared';

import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/components/providers/current-user-provider';
import { ApiError, api } from '@/lib/api-client';
import { cn, titleCaseName } from '@/lib/utils';

import { useOrdersStream } from '../use-orders-stream';

import { LiveWave } from './audio';
import { WaBubble } from './bubbles';
import { EmojiStickerPicker } from './emoji-picker';
import { VAR_HINTS, fmtSecs, renderTpl } from './helpers';
import { WA_BG_DARK, WA_BG_LIGHT } from './icons';
import type { BubbleActions } from './menus';
import { ContactModal, ForwardModal, StickerViewer } from './modals';

/* =====================================================================
 * Chat del pedido CALCADO a WhatsApp Web: fondo doodle, burbujas con cola,
 * citas, reacciones, emojis grandes sin burbuja, stickers, media con hora
 * encima, documentos con tarjeta y chulitos de entrega/lectura.
 * El historial vive en la plataforma (webhook de la Cloud API, 360dialog).
 * ===================================================================== */

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
  // "Escribiendo..." de OTRO admin en este chat (burbujita de puntitos).
  const me = useCurrentUser();
  const [typingBy, setTypingBy] = useState<string | null>(null);
  const typingHideRef = useRef<number | undefined>(undefined);
  useOrdersStream(
    useCallback(
      (event) => {
        if (event?.kind === 'wa.typing') {
          if (event.phone !== phoneRef.current) return;
          if (me?.id && (event as { userId?: string }).userId === me.id) return;
          setTypingBy(String((event as { name?: string }).name ?? 'Alguien'));
          if (typingHideRef.current) window.clearTimeout(typingHideRef.current);
          typingHideRef.current = window.setTimeout(() => setTypingBy(null), 3500);
          return;
        }
        if (event?.kind !== 'wa.message') return;
        if (event.phone && phoneRef.current && event.phone !== phoneRef.current) return;
        // INSTANTANEO: si el evento trae el mensaje completo, se pinta YA
        // (cero refetch). El evento generico {phone} queda como respaldo.
        const msg = (event as { message?: WaMessage }).message;
        if (msg?.id) {
          setTypingBy(null); // llego el mensaje: fuera puntitos
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
      [qc, base, me?.id],
    ),
  );

  // Avisar "escribiendo..." (throttled 3s; el primero sale con la 1ra letra).
  const typingPingRef = useRef(0);
  const pingTyping = () => {
    const now = Date.now();
    if (now - typingPingRef.current < 3000) return;
    typingPingRef.current = now;
    void api.post(`${opBase}/typing`, {}).catch(() => null);
  };

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

  // CADENA de notas de voz (como WhatsApp): cuando un audio termina, WaAudio
  // avisa con 'wa-audio-next'; si el SIGUIENTE mensaje del hilo tambien es un
  // audio, se le ordena reproducirse ('wa-audio-play-id').
  useEffect(() => {
    const h = (ev: Event) => {
      const afterId = (ev as CustomEvent<{ afterId?: string }>).detail?.afterId;
      const list = thread?.messages ?? [];
      if (!afterId || !list.length) return;
      const idx = list.findIndex((x) => x.id === afterId);
      const next = idx >= 0 ? list[idx + 1] : undefined;
      if (next && next.kind === 'audio' && next.mediaUrl) {
        window.dispatchEvent(new CustomEvent('wa-audio-play-id', { detail: { id: next.id } }));
      }
    };
    window.addEventListener('wa-audio-next', h);
    return () => window.removeEventListener('wa-audio-next', h);
  }, [thread]);

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
    edited: false,
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
    mutationFn: (vars: { file: File; tempId: string }) => {
      const fd = new FormData();
      fd.append('file', vars.file, vars.file.name);
      return api.upload<WaMessage>(`${base}/file`, fd);
    },
    // OPTIMISTA: la foto/video/audio/archivo aparece AL INSTANTE con el
    // archivo LOCAL (blob) y relojito; la subida corre por detras.
    onMutate: (vars) => {
      const t = vars.file.type;
      const kind = t.startsWith('image/')
        ? ('image' as const)
        : t.startsWith('video/')
          ? ('video' as const)
          : t.startsWith('audio/')
            ? ('audio' as const)
            : ('file' as const);
      appendMessage({
        ...optimistic(''),
        id: vars.tempId,
        kind,
        body: kind === 'file' ? vars.file.name : null,
        mediaUrl: URL.createObjectURL(vars.file),
      });
    },
    onSuccess: (msg, vars) => {
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
      toast.error(err instanceof ApiError ? err.message : 'No se pudo enviar el archivo');
    },
  });
  const sendFileNow = (file: File) => sendFile.mutate({ file, tempId: `temp-${crypto.randomUUID()}` });

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
  // Segundos REALES grabados (ref: el closure de onstop no ve el estado).
  const recSecsRef = useRef(0);

  const startRecTimer = () => {
    recTimerRef.current = window.setInterval(() => {
      recSecsRef.current += 1;
      setRecSecs((s) => s + 1);
    }, 1000);
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
        // Minimo 1 segundo (como WhatsApp): los audios de menos de ~1s los
        // rechaza Meta en la ENTREGA (131053) aunque el envio de OK.
        if (recSecsRef.current < 1) {
          toast.error('La nota de voz es muy corta: graba al menos 1 segundo.');
          return;
        }
        const type = rec.mimeType || 'audio/webm';
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        const file = new File([new Blob(recChunksRef.current, { type })], `nota-de-voz.${ext}`, { type });
        sendFileNow(file);
      };
      mediaRecRef.current = rec;
      rec.start(250);
      setRecStream(stream);
      setRecording(true);
      setRecPaused(false);
      setRecSecs(0);
      recSecsRef.current = 0;
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
            {typingBy ? (
              /* Burbujita "escribiendo..." (otro admin), con los 3 puntitos. */
              <div className="mt-2 flex justify-start">
                <div
                  className="flex items-center gap-[4px] rounded-[7.5px] rounded-tl-none bg-white px-3.5 py-[11px] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] dark:bg-[#202c33]"
                  title={`${typingBy} está escribiendo…`}
                >
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-[7px] w-[7px] animate-bounce rounded-full bg-[#8696a0]"
                      style={{ animationDelay: `${i * 150}ms`, animationDuration: '0.9s' }}
                    />
                  ))}
                </div>
              </div>
            ) : null}
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
        <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) sendFileNow(f); e.target.value = ''; }} />
        <input ref={docRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip,.rar" onChange={(e) => { const f = e.target.files?.[0]; if (f) sendFileNow(f); e.target.value = ''; }} />
        <input ref={mediaRef} type="file" className="hidden" accept="image/*,video/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) sendFileNow(f); e.target.value = ''; }} />
        <input ref={cameraRef} type="file" className="hidden" accept="image/*" capture="environment" onChange={(e) => { const f = e.target.files?.[0]; if (f) sendFileNow(f); e.target.value = ''; }} />
        <input ref={audioPickRef} type="file" className="hidden" accept="audio/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) sendFileNow(f); e.target.value = ''; }} />
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
              onChange={(e) => {
                setText(e.target.value);
                // Desde la PRIMERA letra: "escribiendo..." a los demas admins
                // y al celular del cliente (throttled).
                if (e.target.value) pingTyping();
              }}
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
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#54656f] transition-colors hover:bg-black/5 dark:text-[#8696a0] dark:hover:bg-white/5"
                aria-label="Grabar nota de voz"
              >
                <Mic className="h-6 w-6" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
