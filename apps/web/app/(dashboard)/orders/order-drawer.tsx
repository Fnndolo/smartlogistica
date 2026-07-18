'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns/format';
import { es } from 'date-fns/locale/es';
import {
  Activity,
  ArrowRightLeft,
  Camera,
  Download,
  Image as ImageIcon,
  Info,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Package,
  Paperclip,
  Phone,
  PlusCircle,
  ReceiptText,
  ScanLine,
  Send,
  Trash2,
  Truck,
  Undo2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  CatalogMatch,
  DevicePhotoKind,
  DevicePhotoResponse,
  MemberSummary,
  OrderDetail,
  OrderEvent,
  OrderMessage,
  OrderSummary,
} from '@smartlogistica/shared';

import { useCurrentUser } from '@/components/providers/current-user-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import { GuidePanel } from './guide-panel';
import { InvoicePanel } from './invoice-panel';
import { activeMention, handleOf, mentionsInText } from './mention-utils';
import { orderDetailQuery, orderMessagesQuery } from './order-queries';
import { useOrdersStream } from './use-orders-stream';

type Tab = 'detalle' | 'conversacion' | 'facturar' | 'guia' | 'actividad';

const CLOSE_MS = 200;

/**
 * Drawer lateral de un pedido: se abre al clickear una fila. Contiene el
 * "chat con todos los detalles" (Detalle / Conversacion / Foto IMEI / Actividad).
 * La Foto IMEI queda visible pero se enciende en el siguiente incremento (storage).
 */
export function OrderDrawer({
  order,
  onClose,
  initialTab,
}: {
  order: OrderSummary | null;
  onClose: () => void;
  initialTab?: Tab;
}) {
  // Mantener el contenido montado durante la animacion de salida.
  const [rendered, setRendered] = useState<OrderSummary | null>(order);
  const [shown, setShown] = useState(false);
  // Portal a <body>: evita que el drawer herede margenes/containing-block de sus
  // contenedores (el `space-y-6` de la pagina le metia margin-top:24px y por eso
  // el overlay `fixed inset-0` arrancaba 24px mas abajo, dejando ver el fondo).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (order) {
      setRendered(order);
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const t = setTimeout(() => setRendered(null), CLOSE_MS);
    return () => clearTimeout(t);
  }, [order]);

  useEffect(() => {
    if (!rendered) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [rendered, onClose]);

  if (!rendered || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-40">
      <div
        className={cn(
          'absolute inset-0 bg-black/50 transition-opacity duration-200',
          shown ? 'opacity-100' : 'opacity-0',
        )}
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        className={cn(
          // Movil: pantalla completa. Escritorio (md+): panel lateral de max-w-xl.
          'absolute right-0 top-0 flex h-full w-full max-w-none flex-col bg-background shadow-2xl transition-transform duration-200 ease-out md:max-w-xl md:border-l md:border-border',
          shown ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <DrawerContent
          key={rendered.id}
          order={rendered}
          onClose={onClose}
          initialTab={initialTab ?? 'detalle'}
        />
      </aside>
    </div>,
    document.body,
  );
}

function DrawerContent({
  order,
  onClose,
  initialTab,
}: {
  order: OrderSummary;
  onClose: () => void;
  initialTab: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);

  const { data: detail } = useQuery(orderDetailQuery(order.id));

  const tabs: { id: Tab; label: string; icon: typeof Info }[] = [
    { id: 'detalle', label: 'Detalle', icon: Info },
    { id: 'conversacion', label: 'Conversacion', icon: MessageSquare },
    { id: 'facturar', label: 'Facturar', icon: ReceiptText },
    { id: 'guia', label: 'Guia', icon: Truck },
    { id: 'actividad', label: 'Actividad', icon: Activity },
  ];

  return (
    <>
      {/* Header */}
      <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">#{order.externalId}</span>
            <StatusPill status={order.status} />
          </div>
          <h2 className="mt-1 truncate text-lg font-semibold tracking-tight">{order.customerName}</h2>
          {order.customerDocument ? (
            <p className="text-xs text-muted-foreground">CC {order.customerDocument}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Cerrar"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {/* Tabs */}
      <nav className="flex gap-1 overflow-x-auto border-b border-border px-3">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 py-2.5 text-sm font-medium transition-colors',
                active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
              {active ? (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-foreground" />
              ) : null}
            </button>
          );
        })}
      </nav>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'detalle' ? <DetalleTab order={order} detail={detail} /> : null}
        {tab === 'conversacion' ? <ConversacionTab orderId={order.id} /> : null}
        {tab === 'facturar' ? <InvoicePanel orderId={order.id} /> : null}
        {tab === 'guia' ? <GuidePanel orderId={order.id} /> : null}
        {tab === 'actividad' ? <ActividadTab orderId={order.id} /> : null}
      </div>
    </>
  );
}

// === Tab: Detalle ===

function DetalleTab({ order, detail }: { order: OrderSummary; detail: OrderDetail | undefined }) {
  const items = detail?.items ?? order.items;
  return (
    <div className="space-y-6 p-5">
      <section className="grid grid-cols-2 gap-3">
        <Stat label="Unidades" value={String(order.totalUnits)} />
        <Stat label="Total" value={formatCurrency(order.totalValue, order.currency)} />
        <Stat
          label="Creado"
          value={format(new Date(order.marketplaceCreatedAt), "d MMM yyyy '·' HH:mm", { locale: es })}
        />
        <Stat label="Marketplace" value={order.provider.toUpperCase()} />
      </section>

      {/* Contacto */}
      <section className="space-y-2">
        <SectionTitle>Contacto</SectionTitle>
        <InfoRow icon={Mail} value={detail?.customerEmail} placeholder="Sin email" />
        <InfoRow icon={Phone} value={detail?.customerPhone} placeholder="Sin telefono" />
        <InfoRow icon={MapPin} value={detail?.shippingAddress} placeholder="Sin direccion de envio" />
      </section>

      {/* Productos */}
      <section className="space-y-2">
        <SectionTitle>Productos ({items.length})</SectionTitle>
        <div className="overflow-hidden rounded-lg border border-border">
          {items.map((item, idx) => (
            <div
              key={`${item.sku}-${idx}`}
              className={cn(
                'flex items-start gap-3 px-3 py-2.5 text-sm',
                idx > 0 && 'border-t border-border',
              )}
            >
              <Package className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="break-words font-medium leading-snug">{item.name}</p>
                <p className="font-mono text-[11px] text-muted-foreground">{item.sku}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="tabular-nums">
                  {item.quantity} &times; {formatCurrency(item.unitPrice, order.currency)}
                </p>
                <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
                  {formatCurrency(lineTotal(item.unitPrice, item.quantity), order.currency)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// === Tab: Conversacion ===

function ConversacionTab({ orderId }: { orderId: string }) {
  const qc = useQueryClient();
  const me = useCurrentUser();
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadLabel, setUploadLabel] = useState('Subiendo...');
  const [attachOpen, setAttachOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingKind = useRef<DevicePhotoKind>('imei');
  // Adjunto normal (foto/video/archivo): input aparte con su propio `accept`.
  const attachRef = useRef<HTMLInputElement>(null);
  const [attachAccept, setAttachAccept] = useState('image/*,video/*');
  // Menciones (@usuario): dropdown mientras se escribe.
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);

  const { data: messages = [], isLoading } = useQuery({
    ...orderMessagesQuery(orderId),
    refetchInterval: 15_000, // respaldo; la inmediatez la da el SSE
    placeholderData: keepPreviousData,
  });

  const { data: members = [] } = useQuery({
    queryKey: ['members'],
    queryFn: () => api.get<MemberSummary[]>('/v1/members'),
    staleTime: 60_000,
  });

  // Al abrir la conversacion, marcar el hilo como leido (limpia el badge/campana
  // de ESTE usuario). Se re-marca cuando llegan mensajes nuevos estando abierto.
  useEffect(() => {
    api
      .post(`/v1/orders/${orderId}/read`)
      .then(() => {
        qc.invalidateQueries({ queryKey: ['orders'] });
        qc.invalidateQueries({ queryKey: ['inbox'] });
      })
      .catch(() => {});
  }, [orderId, messages.length, qc]);

  // Realtime: cualquier evento SSE -> refrescar los mensajes de este pedido al
  // instante (asi el otro usuario ve el mensaje/foto en ~medio segundo).
  useOrdersStream(
    useCallback(() => {
      qc.invalidateQueries({ queryKey: ['order-messages', orderId] });
    }, [qc, orderId]),
  );

  // Match de los codigos de las fotos contra el catalogo de compras.
  const photoCodes = [
    ...new Set(
      messages
        .filter((m) => m.kind === 'imei_photo' || m.kind === 'serial_photo')
        .flatMap((m) => m.imeis),
    ),
  ];
  const { data: matchList = [] } = useQuery({
    queryKey: ['catalog', orderId, photoCodes.slice().sort().join(',')],
    queryFn: () => api.post<CatalogMatch[]>(`/v1/orders/${orderId}/catalog-lookup`, { codes: photoCodes }),
    enabled: photoCodes.length > 0,
    staleTime: 60_000,
  });
  const matchByCode = new Map(matchList.map((m) => [m.code, m]));

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, uploading]);

  const send = useMutation({
    mutationFn: ({ body, mentions }: { body: string; mentions: string[] }) =>
      api.post<OrderMessage>(`/v1/orders/${orderId}/messages`, { body, mentions }),
    // Envio estilo WhatsApp: el mensaje aparece de inmediato (optimista) y NO se
    // refetchea al terminar (se reemplaza el temporal por el real en su sitio, sin
    // parpadeo). Asi se pueden mandar mensajes seguidos sin esperar "carga".
    onMutate: async ({ body, mentions }) => {
      await qc.cancelQueries({ queryKey: ['order-messages', orderId] });
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const temp: OrderMessage = {
        id: tempId,
        orderId,
        authorId: me?.id ?? 'me',
        authorName: me?.email ?? 'Yo',
        kind: 'text',
        body,
        attachmentUrl: null,
        attachmentMime: null,
        imeis: [],
        mentions,
        createdAt: new Date().toISOString(),
      };
      qc.setQueryData<OrderMessage[]>(['order-messages', orderId], (old = []) => [...old, temp]);
      setText('');
      setMention(null);
      return { tempId };
    },
    onSuccess: (real, _vars, ctx) => {
      // Reemplaza el temporal por el real (sin refetch -> sin parpadeo).
      qc.setQueryData<OrderMessage[]>(['order-messages', orderId], (old = []) =>
        old.map((m) => (m.id === ctx?.tempId ? real : m)),
      );
    },
    onError: (err, _vars, ctx) => {
      // Solo quita el temporal que fallo (deja intactos otros mensajes en vuelo).
      qc.setQueryData<OrderMessage[]>(['order-messages', orderId], (old = []) =>
        old.filter((m) => m.id !== ctx?.tempId),
      );
      toast.error(err instanceof ApiError ? err.message : 'No se pudo enviar el mensaje');
    },
  });

  const submit = () => {
    const body = text.trim();
    if (!body) return;
    send.mutate({ body, mentions: mentionsInText(body, members) });
  };

  // Recalcula si el cursor esta escribiendo una mencion (para el dropdown).
  const syncMention = () => {
    const el = textareaRef.current;
    if (!el) return;
    setMention(activeMention(el.value, el.selectionStart ?? el.value.length));
  };

  // Inserta el handle del miembro elegido en lugar del token `@...` en curso.
  const pickMention = (member: MemberSummary) => {
    if (!mention) return;
    const before = text.slice(0, mention.start);
    const after = text.slice(mention.start + 1 + mention.query.length);
    const inserted = `@${handleOf(member.email)} `;
    const next = `${before}${inserted}${after}`;
    setText(next);
    setMention(null);
    // Reponer el foco y el cursor tras el handle insertado.
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        const pos = before.length + inserted.length;
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  };

  const mentionMatches = mention
    ? members
        .filter((m) => handleOf(m.email).toLowerCase().includes(mention.query.toLowerCase()))
        .slice(0, 6)
    : [];

  // Eliminar un mensaje (incluidas las fotos). Optimista: desaparece al instante.
  const del = useMutation({
    mutationFn: (messageId: string) => api.delete(`/v1/orders/${orderId}/messages/${messageId}`),
    onMutate: async (messageId: string) => {
      await qc.cancelQueries({ queryKey: ['order-messages', orderId] });
      const prev = qc.getQueryData<OrderMessage[]>(['order-messages', orderId]);
      qc.setQueryData<OrderMessage[]>(['order-messages', orderId], (old = []) =>
        old.filter((m) => m.id !== messageId),
      );
      return { prev };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(['order-messages', orderId], ctx.prev);
      toast.error(err instanceof ApiError ? err.message : 'No se pudo eliminar el mensaje');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['order-messages', orderId] }),
  });

  const isOwner = me?.role === 'OWNER';

  const pickPhoto = (kind: DevicePhotoKind) => {
    pendingKind.current = kind;
    setAttachOpen(false);
    fileRef.current?.click();
  };

  // Adjunto normal: abre el selector con el `accept` correspondiente.
  const pickAttachment = (accept: string) => {
    setAttachAccept(accept);
    setAttachOpen(false);
    // El value de accept se aplica en el proximo tick (tras el re-render).
    setTimeout(() => attachRef.current?.click(), 0);
  };

  const onAttachmentFile = async (file: File | null) => {
    if (!file || uploading) return;
    setUploadLabel('Subiendo archivo...');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.upload<OrderMessage>(`/v1/orders/${orderId}/attachment`, fd);
      qc.invalidateQueries({ queryKey: ['order-messages', orderId] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo subir el archivo');
    } finally {
      setUploading(false);
      if (attachRef.current) attachRef.current.value = '';
    }
  };

  const onFile = async (file: File | null) => {
    if (!file || uploading) return;
    setUploadLabel('Leyendo la foto y buscando en compras...');
    setUploading(true);
    const kind = pendingKind.current;
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.upload<DevicePhotoResponse>(
        `/v1/orders/${orderId}/device-photo?kind=${kind}`,
        fd,
      );
      toast.success(`${kind === 'imei' ? 'IMEI' : 'Serial'} detectado: ${res.message.imeis.join(', ')}`);
      qc.invalidateQueries({ queryKey: ['order-messages', orderId] });
      qc.invalidateQueries({ queryKey: ['catalog', orderId] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo procesar la foto');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="py-10 text-center">
            <MessageSquare className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              Sin mensajes todavia. Coordina aqui, menciona con @ y adjunta fotos, videos o archivos
              con el clip.
            </p>
          </div>
        ) : (
          messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              mine={m.authorId === me?.id}
              matchByCode={matchByCode}
              canDelete={m.kind !== 'system' && (m.authorId === me?.id || isOwner)}
              onDelete={() => setConfirmDeleteId(m.id)}
            />
          ))
        )}
        {uploading ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {uploadLabel}
          </div>
        ) : null}
      </div>

      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          {/* Adjuntar foto (IMEI / serial) */}
          <div className="relative">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setAttachOpen((o) => !o)}
              disabled={uploading}
              aria-label="Adjuntar foto"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
            </Button>
            {attachOpen ? (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setAttachOpen(false)} />
                <div className="absolute bottom-full left-0 z-20 mb-2 w-52 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-lg">
                  <p className="px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Leer codigo
                  </p>
                  <AttachOption icon={Camera} label="Foto IMEI" onClick={() => pickPhoto('imei')} />
                  <AttachOption icon={ScanLine} label="Foto serial" onClick={() => pickPhoto('serial')} />
                  <div className="my-1 h-px bg-border" />
                  <p className="px-2 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Adjuntar
                  </p>
                  <AttachOption
                    icon={ImageIcon}
                    label="Foto o video"
                    onClick={() => pickAttachment('image/*,video/*')}
                  />
                  <AttachOption
                    icon={Paperclip}
                    label="Archivo"
                    onClick={() => pickAttachment('*')}
                  />
                </div>
              </>
            ) : null}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          />
          <input
            ref={attachRef}
            type="file"
            accept={attachAccept}
            className="hidden"
            onChange={(e) => onAttachmentFile(e.target.files?.[0] ?? null)}
          />
          <div className="relative flex-1">
            {mention && mentionMatches.length > 0 ? (
              <div className="absolute bottom-full left-0 z-20 mb-2 w-56 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-lg">
                <p className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Mencionar
                </p>
                {mentionMatches.map((m) => (
                  <button
                    key={m.userId}
                    type="button"
                    onClick={() => pickMention(m)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                      {handleOf(m.email).slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">@{handleOf(m.email)}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{m.email}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                syncMention();
              }}
              onKeyUp={syncMention}
              onClick={syncMention}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && mention) {
                  setMention(null);
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  // Con el dropdown abierto, Enter elige el primer miembro.
                  const first = mentionMatches[0];
                  if (mention && first) {
                    e.preventDefault();
                    pickMention(first);
                    return;
                  }
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              placeholder="Escribe un mensaje... (@ para mencionar)"
              className="max-h-32 min-h-[2.25rem] w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <Button size="icon" onClick={submit} disabled={!text.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Eliminar mensaje"
        description="Se eliminara para todos. Esta accion no se puede deshacer."
        confirmLabel="Eliminar"
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          const id = confirmDeleteId;
          setConfirmDeleteId(null);
          if (id) del.mutate(id);
        }}
      />
    </div>
  );
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Eliminar',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Escape cancela. Capturamos en fase de captura + stopPropagation para que el
  // Escape NO cierre tambien el drawer (que escucha en document).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-xs rounded-2xl border border-border bg-background p-5 shadow-2xl"
      >
        <h3 className="text-base font-semibold">{title}</h3>
        {description ? <p className="mt-1.5 text-sm text-muted-foreground">{description}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AttachOption({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Camera;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted"
    >
      <Icon className="h-4 w-4 text-muted-foreground" />
      {label}
    </button>
  );
}

/** Pinta el cuerpo del mensaje resaltando los tokens de mencion (@usuario). */
function MentionText({ text, mine }: { text: string; mine: boolean }) {
  const parts = text.split(/(@[\w.-]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^@[\w.-]+$/.test(part) ? (
          <span
            key={i}
            className={cn(
              'rounded px-0.5 font-medium',
              mine ? 'bg-primary-foreground/20' : 'text-primary',
            )}
          >
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function MessageBubble({
  message,
  mine,
  matchByCode,
  canDelete = false,
  onDelete,
}: {
  message: OrderMessage;
  mine: boolean;
  matchByCode?: Map<string, CatalogMatch>;
  canDelete?: boolean;
  onDelete?: () => void;
}) {
  const isPhoto = message.kind === 'imei_photo' || message.kind === 'serial_photo';
  const isDoc = message.kind === 'document';
  const isFile = message.kind === 'file';
  if (message.kind === 'system') {
    return (
      <div className="flex justify-center py-1">
        <span className="rounded-full bg-muted px-3 py-1 text-center text-[11px] text-muted-foreground">
          {message.body}
        </span>
      </div>
    );
  }

  const bubble = isPhoto ? (
    <PhotoCard message={message} mine={mine} matchByCode={matchByCode} />
  ) : isDoc ? (
    <DocumentCard message={message} mine={mine} />
  ) : isFile ? (
    <AttachmentCard message={message} mine={mine} />
  ) : (
    <div
      className={cn(
        'max-w-[80%] rounded-2xl px-3.5 py-2 text-sm',
        mine
          ? 'rounded-br-sm bg-primary text-primary-foreground'
          : 'rounded-bl-sm bg-muted text-foreground',
      )}
    >
      <p className="whitespace-pre-wrap break-words">
        <MentionText text={message.body ?? ''} mine={mine} />
      </p>
    </div>
  );

  return (
    <div className={cn('group flex flex-col gap-0.5', mine ? 'items-end' : 'items-start')}>
      {!mine ? (
        <span className="px-1 text-[11px] font-medium text-muted-foreground">{message.authorName}</span>
      ) : null}
      <div className={cn('flex items-center gap-1.5', mine ? 'flex-row' : 'flex-row-reverse')}>
        {canDelete && onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:text-red-400"
            aria-label="Eliminar mensaje"
            title="Eliminar mensaje"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {bubble}
      </div>
      <span className="px-1 text-[10px] text-muted-foreground">
        {format(new Date(message.createdAt), 'd MMM HH:mm', { locale: es })}
      </span>
    </div>
  );
}

/**
 * Tarjeta de un archivo adjunto (p. ej. el PDF de la factura), estilo mensajeria:
 * vista previa de la primera pagina arriba + fila con nombre/descargar abajo.
 * La previa usa un iframe no interactivo; el click (en cualquier parte) abre el PDF.
 */
function DocumentCard({ message, mine }: { message: OrderMessage; mine: boolean }) {
  const url = message.attachmentUrl;
  const isPdf = message.attachmentMime === 'application/pdf';
  const name = message.body ?? 'Documento.pdf';

  return (
    <div
      className={cn(
        'w-64 max-w-[80%] overflow-hidden rounded-2xl border',
        mine ? 'rounded-br-sm border-primary/20 bg-primary/5' : 'rounded-bl-sm border-border bg-card',
      )}
    >
      {url && isPdf ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="relative block h-44 w-full overflow-hidden border-b border-border bg-white"
          title="Abrir factura"
        >
          <iframe
            src={`${url}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
            title={name}
            loading="lazy"
            tabIndex={-1}
            aria-hidden="true"
            className="pointer-events-none h-[420px] w-full border-0"
          />
          {/* Capa transparente: el iframe no recibe clicks; el <a> abre el PDF completo. */}
          <span className="absolute inset-0" />
        </a>
      ) : null}
      <a
        href={url ?? undefined}
        target="_blank"
        rel="noreferrer"
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 transition',
          url ? 'hover:bg-muted/60' : 'pointer-events-none opacity-70',
        )}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-red-500/10 text-[10px] font-bold tracking-wide text-red-600 dark:text-red-400">
          PDF
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="text-[11px] text-muted-foreground">Toca para abrir</p>
        </div>
        <Download className="h-4 w-4 shrink-0 text-muted-foreground" />
      </a>
    </div>
  );
}

/**
 * Adjunto normal (kind='file'): se pinta segun el mime — imagen inline, video con
 * controles, o tarjeta de descarga para cualquier otro archivo. Sin badges de
 * IMEI/serial ni catalogo (eso es exclusivo de las fotos de dispositivo).
 */
function AttachmentCard({ message, mine }: { message: OrderMessage; mine: boolean }) {
  const url = message.attachmentUrl;
  const mime = message.attachmentMime ?? '';
  const name = message.body ?? 'archivo';

  if (url && mime.startsWith('image/')) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className={cn(
          'block max-w-[80%] overflow-hidden rounded-2xl border',
          mine ? 'rounded-br-sm border-primary/20' : 'rounded-bl-sm border-border',
        )}
        title={name}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={name} className="max-h-72 w-auto object-cover" loading="lazy" />
      </a>
    );
  }

  if (url && mime.startsWith('video/')) {
    return (
      <div
        className={cn(
          'max-w-[80%] overflow-hidden rounded-2xl border bg-black',
          mine ? 'rounded-br-sm border-primary/20' : 'rounded-bl-sm border-border',
        )}
      >
        <video src={url} controls preload="metadata" className="max-h-72 w-auto" />
      </div>
    );
  }

  // Cualquier otro archivo: tarjeta de descarga.
  const ext = (/\.([a-z0-9]{1,6})$/i.exec(name)?.[1] ?? 'file').toUpperCase();
  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'flex w-64 max-w-[80%] items-center gap-3 rounded-2xl border px-3 py-2.5 transition',
        mine ? 'rounded-br-sm border-primary/20 bg-primary/5' : 'rounded-bl-sm border-border bg-card',
        url ? 'hover:bg-muted/60' : 'pointer-events-none opacity-70',
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-[9px] font-bold tracking-wide text-muted-foreground">
        {ext.slice(0, 4)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="text-[11px] text-muted-foreground">Toca para abrir</p>
      </div>
      <Download className="h-4 w-4 shrink-0 text-muted-foreground" />
    </a>
  );
}

function PhotoCard({
  message,
  mine = false,
  className,
  matchByCode,
}: {
  message: OrderMessage;
  mine?: boolean;
  className?: string;
  matchByCode?: Map<string, CatalogMatch>;
}) {
  const isSerial = message.kind === 'serial_photo';
  return (
    <div
      className={cn(
        'max-w-[80%] overflow-hidden rounded-2xl border',
        // Mismo lenguaje que las burbujas: mias = tinte primario + esquina derecha;
        // de otro usuario = neutro + esquina izquierda.
        mine ? 'rounded-br-sm border-primary/20 bg-primary/5' : 'rounded-bl-sm border-border bg-card',
        className,
      )}
    >
      {message.attachmentUrl ? (
        <a href={message.attachmentUrl} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={message.attachmentUrl}
            alt={isSerial ? 'Foto serial' : 'Foto IMEI'}
            className="max-h-56 w-full bg-muted object-cover"
          />
        </a>
      ) : null}
      <div className="space-y-2 p-2.5">
        <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
          {isSerial ? <ScanLine className="h-3 w-3" /> : <Camera className="h-3 w-3" />}
          {isSerial ? 'Foto serial' : 'Foto IMEI'}
        </p>
        <div className="space-y-1.5">
          {message.imeis.map((code) => (
            <CodeRow
              key={code}
              code={code}
              match={matchByCode?.get(code) ?? null}
              showMatch={Boolean(matchByCode)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Un codigo (IMEI/serial) + su coincidencia en el catalogo de compras. */
function CodeRow({
  code,
  match,
  showMatch,
}: {
  code: string;
  match: CatalogMatch | null;
  showMatch: boolean;
}) {
  return (
    <div className="space-y-1">
      <span className="inline-block rounded-md border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[11px] text-emerald-700 dark:text-emerald-400">
        {code}
      </span>
      {showMatch ? (
        match ? (
          <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5 text-xs">
            <p className="break-words font-medium leading-snug">
              {match.productName ?? 'Producto sin nombre'}
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {match.unitCost ? `Costo ${formatCurrency(match.unitCost, 'COP')}` : 'Sin costo'}
              {match.providerName ? ` · ${match.providerName}` : ''}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Factura {match.billNumber}
              {match.billDate ? ` · ${format(new Date(match.billDate), 'd MMM yyyy', { locale: es })}` : ''}
              {match.store ? ` · ${match.store}` : ''}
            </p>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">Sin coincidencia en compras</p>
        )
      ) : null}
    </div>
  );
}

// === Tab: Actividad ===

function ActividadTab({ orderId }: { orderId: string }) {
  const { data: events = [], isLoading } = useQuery({
    queryKey: ['order-events', orderId],
    queryFn: () => api.get<OrderEvent[]>(`/v1/orders/${orderId}/events`),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (events.length === 0) {
    return (
      <div className="py-10 text-center">
        <Activity className="mx-auto h-6 w-6 text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">Sin actividad registrada.</p>
      </div>
    );
  }

  return (
    <ol className="space-y-1 p-5">
      {events.map((e) => (
        <li key={e.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className="mt-1 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground">
              <EventIcon type={e.type} />
            </span>
            <span className="my-0.5 w-px flex-1 bg-border last:hidden" />
          </div>
          <div className="pb-3">
            <p className="text-sm">{describeEvent(e)}</p>
            <p className="text-[11px] text-muted-foreground">
              {format(new Date(e.createdAt), "d MMM yyyy '·' HH:mm", { locale: es })}
              {e.actorName ? ` · ${e.actorName}` : ''}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function EventIcon({ type }: { type: string }) {
  const cls = 'h-3.5 w-3.5';
  if (type === 'assigned') return <PlusCircle className={cls} />;
  if (type === 'transferred') return <ArrowRightLeft className={cls} />;
  if (type === 'returned') return <Undo2 className={cls} />;
  if (type === 'invoiced') return <ReceiptText className={cls} />;
  if (type === 'guide_generated') return <Truck className={cls} />;
  if (type === 'vtex_invoiced') return <ReceiptText className={cls} />;
  return <Activity className={cls} />;
}

function describeEvent(e: OrderEvent): string {
  switch (e.type) {
    case 'assigned':
      return 'Asignado a la sede';
    case 'transferred':
      return 'Transferido a otra sede';
    case 'returned':
      return 'Devuelto a pedidos generales';
    case 'status_changed':
      return 'Cambio de estado';
    case 'created':
      return 'Pedido recibido';
    case 'invoiced':
      return `Factura ${(e.data.number as string | undefined) ?? ''} emitida en Alegra`.trim();
    case 'guide_generated':
      return `Guia ${(e.data.number as string | undefined) ?? ''} generada en Coordinadora`.trim();
    case 'vtex_invoiced':
      return `Facturado en VTEX · MKT ${(e.data.invoiceNumber as string | undefined) ?? ''}`.trim();
    default:
      return e.type;
  }
}

// === UI helpers ===

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}

function InfoRow({
  icon: Icon,
  value,
  placeholder,
}: {
  icon: typeof Mail;
  value: string | null | undefined;
  placeholder: string;
}) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      {value ? (
        <span className="break-words">{value}</span>
      ) : (
        <span className="text-muted-foreground">{placeholder}</span>
      )}
    </div>
  );
}

const STATUS_LABELS: Record<string, { label: string; variant: 'warning' | 'success' | 'secondary' }> = {
  'ready-for-handling': { label: 'Listo para preparar', variant: 'warning' },
  handling: { label: 'Preparando', variant: 'success' },
  invoiced: { label: 'Facturado', variant: 'secondary' },
  'window-to-cancel': { label: 'En ventana de cancelacion', variant: 'secondary' },
  canceled: { label: 'Cancelado', variant: 'secondary' },
};

function StatusPill({ status }: { status: string }) {
  const mapped = STATUS_LABELS[status];
  return (
    <Badge variant={mapped?.variant ?? 'secondary'} className="whitespace-nowrap">
      {mapped?.label ?? status}
    </Badge>
  );
}

function lineTotal(unitPrice: string, quantity: number): string {
  const n = Number(unitPrice) * quantity;
  return Number.isNaN(n) ? unitPrice : n.toFixed(2);
}

function formatCurrency(value: string, currency: string): string {
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(num);
  } catch {
    return `${currency} ${num.toLocaleString('es-CO')}`;
  }
}
