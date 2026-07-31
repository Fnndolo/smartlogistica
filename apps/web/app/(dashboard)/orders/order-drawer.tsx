'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  keepPreviousData,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { format } from 'date-fns/format';
import { es } from 'date-fns/locale/es';
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  ArrowLeft,
  Camera,
  Check,
  ChevronDown,
  Download,
  Hand,
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
  Reply,
  ScanLine,
  Send,
  SmilePlus,
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
  Inbox,
  ListOrdersResponse,
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
import { cn, titleCaseName } from '@/lib/utils';

import { setActiveChat } from './active-chat';
import { ClaimChip } from './claim-chip';
import { GuidePanel } from './guide-panel';
import { InvoicePanel } from './invoice-panel';
import { useOrderActions } from './use-order-actions';
import { compressImage } from '@/lib/compress-image';

import { EmojiPicker } from './emoji-picker';
import { bumpReaction, topReactions } from './reaction-frequents';
import {
  activeMention,
  initialsOf,
  matchMembers,
  mentionName,
  mentionsInText,
  splitMentions,
} from './mention-utils';
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
  focusMessageId,
}: {
  order: OrderSummary | null;
  onClose: () => void;
  initialTab?: Tab;
  /** Mensaje al que saltar al abrir la conversacion (deep-link de mencion). */
  focusMessageId?: string | null;
}) {
  // Mantener el contenido montado durante la animacion de salida.
  const [rendered, setRendered] = useState<OrderSummary | null>(order);
  const [shown, setShown] = useState(false);

  // BOTON ATRAS (cel): al abrir el drawer se agrega una entrada al historial;
  // "atras" cierra la conversacion y te deja EN la lista de pedidos (antes te
  // sacaba a Sedes/Resumen). Cerrar por otra via consume esa entrada.
  const historyOpenRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (order && !historyOpenRef.current) {
      historyOpenRef.current = true;
      window.history.pushState({ slDrawer: true }, '');
    } else if (!order && historyOpenRef.current) {
      historyOpenRef.current = false;
      if (window.history.state?.slDrawer) window.history.back();
    }
  }, [order]);
  useEffect(() => {
    const onPop = () => {
      if (historyOpenRef.current) {
        historyOpenRef.current = false;
        onCloseRef.current();
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
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
          'absolute inset-0 bg-[rgba(5,8,14,0.55)] backdrop-blur-[2px] transition-opacity duration-200',
          shown ? 'opacity-100' : 'opacity-0',
        )}
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        className={cn(
          // Movil: pantalla completa. Escritorio (md+): panel lateral de max-w-xl.
          // bg-card: el drawer es una SUPERFICIE blanca (el lienzo es gris).
          'shadow-pop absolute right-0 top-0 flex h-full w-full max-w-none flex-col bg-card transition-transform duration-200 ease-out md:max-w-[560px] md:border-l md:border-border',
          shown ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <DrawerContent
          key={rendered.id}
          order={rendered}
          onClose={onClose}
          initialTab={initialTab ?? 'conversacion'}
          focusMessageId={focusMessageId ?? null}
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
  focusMessageId,
}: {
  order: OrderSummary;
  onClose: () => void;
  initialTab: Tab;
  focusMessageId: string | null;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const me = useCurrentUser();
  const qc = useQueryClient();
  // El OPERADOR solo trabaja el pedido: detalle + conversacion (sube fotos,
  // chatea). Facturar, guia y actividad son de administradores.
  const canManage = me?.role === 'OWNER' || me?.role === 'ADMIN';

  const { data: detail } = useQuery(orderDetailQuery(order.id));

  // PRECARGAR Facturar y Guia apenas se abre el pedido: cuando el usuario
  // entra a esas pestañas, el contenido ya esta en cache (antes esperaba
  // 4-6s el fetch de Alegra/Coordinadora al abrir la pestaña).
  useEffect(() => {
    if (!canManage) return;
    void qc.prefetchQuery({
      queryKey: ['invoice-preview', order.id],
      queryFn: () => api.get(`/v1/orders/${order.id}/invoice-preview`),
      staleTime: 20_000,
    });
    void qc.prefetchQuery({
      queryKey: ['guide-preview', order.id],
      queryFn: () => api.get(`/v1/orders/${order.id}/guide-preview`),
      staleTime: 20_000,
    });
  }, [order.id, canManage, qc]);

  const tabs: { id: Tab; label: string; icon: typeof Info }[] = [
    { id: 'conversacion', label: 'Conversación', icon: MessageSquare },
    { id: 'detalle', label: 'Detalle', icon: Info },
    ...(canManage
      ? ([
          { id: 'facturar', label: 'Facturar', icon: ReceiptText },
          { id: 'guia', label: 'Guía', icon: Truck },
          { id: 'actividad', label: 'Actividad', icon: Activity },
        ] as { id: Tab; label: string; icon: typeof Info }[])
      : []),
  ];

  return (
    <>
      {/* Header */}
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 pb-3 pt-3 md:px-5 md:pt-4">
        {/* Cel: flecha de volver (equivale al boton atras del sistema). */}
        <button
          type="button"
          onClick={onClose}
          className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground active:bg-muted md:hidden"
          aria-label="Volver a los pedidos"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          {/* Cel: el N° y el estado usan TODO el ancho, centrados (sin partirse
              en dos lineas por culpa del boton). En pc, a la izquierda. */}
          <div className="flex items-center justify-center gap-2 md:justify-start">
            <span className="truncate whitespace-nowrap font-mono text-[12.5px] text-muted-foreground md:text-[11px]">
              #{order.externalId}
            </span>
            <StatusPill status={order.status} />
          </div>
          {/* Cel: el boton de tomar/soltar CENTRADO verticalmente contra el
              bloque nombre + cedula (las filas que haya). */}
          <div className="mt-1.5 flex items-center justify-between gap-3 md:mt-1">
            <div className="min-w-0">
              <h2 className="truncate text-[19px] font-semibold tracking-tight md:text-[17px]">
                {titleCaseName(order.customerName)}
              </h2>
              {order.customerDocument ? (
                <p className="font-mono text-[12px] text-muted-foreground/80 md:text-[11px]">
                  CC {order.customerDocument}
                </p>
              ) : null}
            </div>
            <span className="shrink-0 md:hidden">
              <DrawerClaim order={detail ?? order} />
            </span>
          </div>
        </div>
        {/* Escritorio: tomar/soltar + X grande, separadas para no equivocarse. */}
        <div className="hidden shrink-0 items-center gap-2 md:flex">
          <DrawerClaim order={detail ?? order} />
          <button
            type="button"
            onClick={onClose}
            className="ml-1.5 flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground"
            aria-label="Cerrar"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>
      </header>

      {/* Tabs */}
      {/* overflow-y-hidden: NUNCA scroll vertical aqui (aparecia una barrita
          sin sentido). El lateral (auto) solo sale si las tabs no caben. */}
      <nav className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border px-3">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                // Inactivas grisaceas y finas; la activa en negrilla suave.
                // En cel todo un punto mas grande (proporcional a la pantalla).
                'relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-3 text-[14.5px] transition-colors md:px-2.5 md:py-2.5 md:text-[12.5px]',
                active
                  ? 'font-semibold text-foreground'
                  : 'font-normal text-muted-foreground/75 hover:text-foreground',
              )}
            >
              <t.icon className="h-4 w-4 md:h-3.5 md:w-3.5" />
              {t.label}
              {active ? (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />
              ) : null}
            </button>
          );
        })}
      </nav>

      {/* Content: TODAS las pestañas quedan montadas (apiladas, las inactivas
          invisibles). Asi al cambiar de pestaña no se pierde nada: scroll del
          chat, items editados en Facturar, direccion/paquete en Guia, y las
          operaciones en curso siguen mostrando su estado al volver. */}
      <div className="relative min-h-0 flex-1">
        <TabPane active={tab === 'conversacion'}>
          <ConversacionTab
            orderId={order.id}
            initialUnread={order.unreadCount ?? 0}
            active={tab === 'conversacion'}
            focusMessageId={focusMessageId}
          />
        </TabPane>
        <TabPane active={tab === 'detalle'} scroll>
          <DetalleTab order={order} detail={detail} />
        </TabPane>
        {canManage ? (
          <>
            <TabPane active={tab === 'facturar'} scroll>
              <InvoicePanel orderId={order.id} />
            </TabPane>
            <TabPane active={tab === 'guia'} scroll>
              <GuidePanel orderId={order.id} />
            </TabPane>
            <TabPane active={tab === 'actividad'} scroll>
              <ActividadTab orderId={order.id} />
            </TabPane>
          </>
        ) : null}
      </div>
    </>
  );
}

/**
 * Control de "tomar pedido" del header del drawer: boton si esta libre, ficha
 * con "Lo tienes tú · Soltar" si es mio, o "Fulano lo tiene" si es de otro.
 */
function DrawerClaim({ order }: { order: OrderSummary }) {
  const { claim, unclaim } = useOrderActions();
  const c = order.claimedBy;
  if (!c) {
    return (
      <button
        type="button"
        onClick={() => claim(order.id)}
        className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-muted-foreground shadow-card transition-colors hover:border-accent/40 hover:text-foreground"
      >
        <Hand className="h-3.5 w-3.5" />
        Tomar pedido
      </button>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <ClaimChip userId={c.userId} name={c.name} mine={c.mine} />
      {c.mine ? (
        <span className="flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-muted-foreground">
          Lo tienes tú
          <button
            type="button"
            onClick={() => unclaim(order.id)}
            className="text-[11px] underline underline-offset-2 hover:text-destructive"
          >
            Soltar
          </button>
        </span>
      ) : (
        <span className="max-w-[110px] truncate whitespace-nowrap text-[11.5px] text-muted-foreground">
          {c.name} lo tiene
        </span>
      )}
    </span>
  );
}

/**
 * Panel de pestaña que NUNCA se desmonta: las inactivas quedan con
 * visibility:hidden (conserva scroll y estado, no intercepta clicks).
 */
function TabPane({
  active,
  scroll,
  children,
}: {
  active: boolean;
  scroll?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn('absolute inset-0', scroll && 'overflow-y-auto', !active && 'invisible')}
      aria-hidden={!active}
    >
      {children}
    </div>
  );
}

// === Tab: Detalle ===

/** Estado de la confirmacion de direccion por WhatsApp (Whapify). */
function AddressConfirmation({ order }: { order: OrderSummary }) {
  if (!order.addressStatus) {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
        <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        El cliente aún no confirma su dirección (WhatsApp).
      </div>
    );
  }
  if (order.addressStatus === 'confirmed') {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        El cliente confirmó que su dirección es correcta.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2.5 text-xs">
      <div className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        El cliente MODIFICÓ su dirección — verifícala antes de generar la guía.
      </div>
      {order.confirmedAddress ? (
        <p className="mt-1.5 whitespace-pre-wrap break-words text-foreground">
          {order.confirmedAddress}
        </p>
      ) : null}
    </div>
  );
}

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
        <InfoRow icon={Phone} value={detail?.customerPhone} placeholder="Sin teléfono" />
        <InfoRow icon={MapPin} value={detail?.shippingAddress} placeholder="Sin dirección de envío" />
        <AddressConfirmation order={order} />
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

function ConversacionTab({
  orderId,
  initialUnread = 0,
  active = true,
  focusMessageId = null,
}: {
  orderId: string;
  initialUnread?: number;
  /** false cuando otra pestaña esta al frente (el chat sigue montado). */
  active?: boolean;
  /** Al abrir, saltar a ESTE mensaje (deep-link de una mencion) y resaltarlo. */
  focusMessageId?: string | null;
}) {
  const qc = useQueryClient();
  const me = useCurrentUser();
  // Cuantos mensajes tenia SIN leer al abrir (congelado: markRead lo pone en 0
  // al instante, pero el separador "No leidos" debe quedarse donde estaba).
  // El prop puede venir VIEJO (el drawer se abrio hace rato y el mensaje llego
  // despues): se toma el maximo contra las caches frescas (lista e inbox).
  const [unreadAtOpen] = useState(() => {
    let max = initialUnread;
    for (const [, data] of qc.getQueriesData<ListOrdersResponse>({ queryKey: ['orders'] })) {
      const found = data?.items?.find((o) => o.id === orderId);
      if (found && found.unreadCount > max) max = found.unreadCount;
    }
    const inbox = qc.getQueryData<Inbox>(['inbox']);
    const item = inbox?.items.find((i) => i.orderId === orderId);
    if (item && item.unreadCount > max) max = item.unreadCount;
    return max;
  });
  const [unreadBoundaryId, setUnreadBoundaryId] = useState<string | null>(null);
  // Mensaje resaltado brevemente tras saltar a el desde una mencion.
  const [flashId, setFlashId] = useState<string | null>(null);
  const didInitialScroll = useRef(false);
  // Scroll inteligente (WhatsApp + Google Chat): si estoy leyendo ARRIBA, un
  // mensaje nuevo NO me arrastra al fondo; aparece el boton "ir al final" con
  // contador. El boton tambien sale al scrollear (y se esconde tras quietud).
  const atBottomRef = useRef(true);
  const prevLenRef = useRef(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [showJump, setShowJump] = useState(false);
  const jumpIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Registrar que este chat esta EN PANTALLA (silencia sonido/toast globales).
  // Solo cuenta si la pestaña Conversacion esta al frente: montada pero tapada
  // por Facturar/Guia NO silencia notificaciones ni marca leidos.
  useEffect(() => {
    if (!active) return;
    setActiveChat(orderId);
    return () => setActiveChat(null);
  }, [orderId, active]);
  const [text, setText] = useState('');
  const [attachOpen, setAttachOpen] = useState(false);
  // Eliminar: uno o VARIOS mensajes (seleccion multiple).
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  // Responder/citar: el mensaje al que voy a responder (barra sobre el composer).
  const [replyTo, setReplyTo] = useState<OrderMessage | null>(null);
  // Picker de emojis abierto para un mensaje (con el punto donde se abrio).
  const [pickerFor, setPickerFor] = useState<{ messageId: string; x: number; y: number } | null>(null);
  // Acciones ancladas al mensaje long-presseado (el hover no existe en tactil).
  const [mobileActionsFor, setMobileActionsFor] = useState<string | null>(null);
  // "Esta escribiendo...": usuarios con señal viva (expira a los 4s).
  const [typingUsers, setTypingUsers] = useState<Map<string, { name: string; until: number }>>(
    new Map(),
  );
  const lastTypingSent = useRef(0);
  // Solo los dispositivos con puntero real (mouse) muestran acciones al hover:
  // en tactil un TAP simula hover y abria las reacciones con solo tocar.
  const [hoverCapable] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches,
  );
  // Placeholder segun pantalla: "Escribe un mensaje" en pc, "Mensaje" en cel.
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingKind = useRef<DevicePhotoKind>('imei');
  // Adjunto normal (foto/video/archivo): input aparte con su propio `accept`.
  const attachRef = useRef<HTMLInputElement>(null);
  const [attachAccept, setAttachAccept] = useState('image/*,video/*');
  // Menciones (@usuario): dropdown mientras se escribe.
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);

  // El campo CRECE con el texto (estilo WhatsApp) hasta 120px; el scrollbar
  // solo aparece pasado ese tope. Al enviar (text vacio) vuelve a una linea.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const max = 120;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [text]);

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
  // Solo cuando la pestaña esta AL FRENTE (montada pero tapada no lee).
  useEffect(() => {
    if (!active) return;
    api
      .post(`/v1/orders/${orderId}/read`)
      .then(() => {
        qc.invalidateQueries({ queryKey: ['orders'] });
        qc.invalidateQueries({ queryKey: ['inbox'] });
      })
      .catch(() => {});
  }, [orderId, messages.length, qc, active]);

  // Realtime AL PESTAÑEO: los eventos de chat traen el contenido completo y se
  // INYECTAN directo a la cache (cero refetch en el camino critico). Un
  // refetch DEBOUNCED reconcilia por detras (orden, adjuntos, carreras).
  const reconcileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconcile = useCallback(() => {
    if (reconcileTimer.current) clearTimeout(reconcileTimer.current);
    // 600ms: coalesce rafagas sin retrasar fotos/documentos (que no viajan
    // completos en el evento y si dependen del refetch).
    reconcileTimer.current = setTimeout(() => {
      void qc.invalidateQueries({ queryKey: ['order-messages', orderId] });
    }, 600);
  }, [qc, orderId]);
  useEffect(() => () => {
    if (reconcileTimer.current) clearTimeout(reconcileTimer.current);
  }, []);

  useOrdersStream(
    useCallback(
      (event) => {
        if (!event || String(event.orderId ?? '') !== orderId) {
          // Eventos de otros pedidos o genericos (fotos, sistema): refetch suave.
          if (event?.kind === 'orders.refresh') reconcile();
          return;
        }

        if (event.kind === 'chat.message') {
          const authorId = String(event.authorId ?? '');
          if (authorId && authorId !== me?.id) {
            const injected: OrderMessage = {
              id: String(event.messageId ?? `evt-${Date.now()}`),
              orderId,
              authorId,
              authorName: String(event.authorName ?? ''),
              kind: 'text',
              body: String(event.body ?? ''),
              attachmentUrl: null,
              attachmentMime: null,
              imeis: [],
              mentions: Array.isArray(event.mentions) ? (event.mentions as string[]) : [],
              replyToId: typeof event.replyToId === 'string' ? event.replyToId : null,
              reactions: [],
              createdAt:
                typeof event.createdAt === 'string' ? event.createdAt : new Date().toISOString(),
            };
            qc.setQueryData<OrderMessage[]>(['order-messages', orderId], (old = []) =>
              old.some((m) => m.id === injected.id) ? old : [...old, injected],
            );
            // Su mensaje llego: se apaga su "esta escribiendo".
            setTypingUsers((prev) => {
              if (!prev.has(authorId)) return prev;
              const next = new Map(prev);
              next.delete(authorId);
              return next;
            });
          }
          reconcile();
          return;
        }

        if (event.kind === 'chat.typing') {
          const userId = String(event.userId ?? '');
          if (!userId || userId === me?.id) return;
          const name = String(event.userName ?? '');
          setTypingUsers((prev) => {
            const next = new Map(prev);
            next.set(userId, { name, until: Date.now() + 4000 });
            return next;
          });
          return;
        }

        if (event.kind === 'chat.reaction') {
          const reactorId = String(event.reactorId ?? '');
          if (reactorId === me?.id) return; // la mia ya fue optimista
          const emoji = String(event.emoji ?? '');
          const name = String(event.reactorName ?? '');
          const messageId = String(event.messageId ?? '');
          const removed = Boolean(event.removed);
          qc.setQueryData<OrderMessage[]>(['order-messages', orderId], (old = []) =>
            old.map((m) => {
              if (m.id !== messageId) return m;
              const existing = m.reactions.find((r) => r.emoji === emoji);
              if (removed) {
                if (!existing) return m;
                const reactions = m.reactions
                  .map((r) =>
                    r.emoji === emoji
                      ? { ...r, count: r.count - 1, users: r.users.filter((u) => u !== name) }
                      : r,
                  )
                  .filter((r) => r.count > 0);
                return { ...m, reactions };
              }
              const reactions = existing
                ? m.reactions.map((r) =>
                    r.emoji === emoji ? { ...r, count: r.count + 1, users: [...r.users, name] } : r,
                  )
                : [...m.reactions, { emoji, count: 1, mine: false, users: [name] }];
              return { ...m, reactions };
            }),
          );
          reconcile();
          return;
        }

        // Otros eventos del pedido (fotos, documentos, sistema): refetch suave.
        reconcile();
      },
      [qc, orderId, me, reconcile],
    ),
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

  // Primera carga: fijar el separador "No leidos" (el N-esimo mensaje ajeno
  // contando desde el final) y llevar el scroll AHI (como Google Chat); si no
  // hay nada sin leer, al fondo. Las llegadas posteriores van al fondo normal.
  useEffect(() => {
    if (didInitialScroll.current || !me || messages.length === 0) return;
    didInitialScroll.current = true;
    let boundary: string | null = null;
    if (unreadAtOpen > 0) {
      let count = 0;
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]!;
        if (m.authorId !== me.id && m.kind !== 'system') {
          count += 1;
          if (count === unreadAtOpen) {
            boundary = m.id;
            break;
          }
        }
      }
    }
    setUnreadBoundaryId(boundary);
    prevLenRef.current = messages.length; // base para detectar llegadas nuevas
    requestAnimationFrame(() => {
      // Si venimos de una MENCION, el destino es ESE mensaje (resaltado breve).
      const target = focusMessageId ? document.getElementById(`msg-${focusMessageId}`) : null;
      if (target) {
        target.scrollIntoView({ block: 'center' });
        setFlashId(focusMessageId);
        setTimeout(() => setFlashId(null), 2600);
        return;
      }
      const el = boundary ? document.getElementById('chat-unread-divider') : null;
      if (el) el.scrollIntoView({ block: 'center' });
      else scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  }, [messages, me, unreadAtOpen, focusMessageId]);

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    setPendingCount(0);
    setShowJump(false);
  }, []);

  // Seguimiento del scroll: al llegar al fondo se limpia el contador; lejos
  // del fondo aparece "ir al final" (se esconde tras 2.5s de quietud, salvo
  // que haya mensajes pendientes).
  const onChatScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    atBottomRef.current = atBottom;
    if (atBottom) {
      setPendingCount(0);
      setShowJump(false);
      return;
    }
    setShowJump(true);
    if (jumpIdleTimer.current) clearTimeout(jumpIdleTimer.current);
    jumpIdleTimer.current = setTimeout(() => {
      // Con mensajes sin ver, el boton se queda (es el aviso).
      setPendingCount((p) => {
        if (p === 0) setShowJump(false);
        return p;
      });
    }, 2500);
  }, []);
  useEffect(() => () => {
    if (jumpIdleTimer.current) clearTimeout(jumpIdleTimer.current);
  }, []);

  // Teclado del celular: cuando el viewport visual cambia (se abre/cierra el
  // teclado) y estaba en el fondo, mantener el ultimo mensaje a la vista.
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const onResize = () => {
      if (atBottomRef.current) {
        requestAnimationFrame(() => {
          scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
        });
      }
    };
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  // Mensajes nuevos: si los mande YO o estoy en el fondo -> bajar; si estoy
  // leyendo arriba -> NO moverse: sumar al contador del boton y fijar el
  // separador "No leidos" en el primero que no he visto.
  useEffect(() => {
    if (!didInitialScroll.current) return;
    const prevLen = prevLenRef.current;
    prevLenRef.current = messages.length;
    if (messages.length <= prevLen) return;

    const fresh = messages.slice(prevLen);
    const mine = fresh.every((m) => m.authorId === me?.id);
    if (mine || atBottomRef.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
      return;
    }
    const incoming = fresh.filter((m) => m.authorId !== me?.id && m.kind !== 'system');
    if (incoming.length === 0) return;
    setPendingCount((p) => p + incoming.length);
    setShowJump(true);
    setUnreadBoundaryId((prev) => prev ?? incoming[0]!.id);
  }, [messages, me]);

  const send = useMutation({
    mutationFn: ({ body, mentions, replyToId }: { body: string; mentions: string[]; replyToId?: string }) =>
      api.post<OrderMessage>(`/v1/orders/${orderId}/messages`, {
        body,
        mentions,
        ...(replyToId ? { replyToId } : {}),
      }),
    // Envio estilo WhatsApp: el mensaje aparece de inmediato (optimista) y NO se
    // refetchea al terminar (se reemplaza el temporal por el real en su sitio, sin
    // parpadeo). Asi se pueden mandar mensajes seguidos sin esperar "carga".
    onMutate: async ({ body, mentions, replyToId }) => {
      await qc.cancelQueries({ queryKey: ['order-messages', orderId] });
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const temp: OrderMessage = {
        id: tempId,
        orderId,
        authorId: me?.id ?? 'me',
        authorName: me?.name ?? me?.email ?? 'Yo',
        kind: 'text',
        body,
        attachmentUrl: null,
        attachmentMime: null,
        imeis: [],
        mentions,
        replyToId: replyToId ?? null,
        reactions: [],
        createdAt: new Date().toISOString(),
      };
      qc.setQueryData<OrderMessage[]>(['order-messages', orderId], (old = []) => [...old, temp]);
      setText('');
      setMention(null);
      setReplyTo(null);
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
    send.mutate({ body, mentions: mentionsInText(body, members), replyToId: replyTo?.id });
  };

  // Alternar una reaccion. OPTIMISTA: el chip cambia AL INSTANTE (como en
  // Google Chat); el server confirma por detras y, si falla, se revierte.
  const react = useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: string; emoji: string }) =>
      api.post<OrderMessage>(`/v1/orders/${orderId}/messages/${messageId}/reactions`, { emoji }),
    onMutate: async ({ messageId, emoji }) => {
      await qc.cancelQueries({ queryKey: ['order-messages', orderId] });
      const prev = qc.getQueryData<OrderMessage[]>(['order-messages', orderId]);
      const myName = me?.name ?? me?.email ?? 'Yo';
      qc.setQueryData<OrderMessage[]>(['order-messages', orderId], (old = []) =>
        old.map((m) => {
          if (m.id !== messageId) return m;
          const existing = m.reactions.find((r) => r.emoji === emoji);
          let reactions: OrderMessage['reactions'];
          if (existing?.mine) {
            // Quitar la mia.
            reactions = m.reactions
              .map((r) =>
                r.emoji === emoji
                  ? { ...r, count: r.count - 1, mine: false, users: r.users.filter((u) => u !== myName) }
                  : r,
              )
              .filter((r) => r.count > 0);
          } else if (existing) {
            reactions = m.reactions.map((r) =>
              r.emoji === emoji
                ? { ...r, count: r.count + 1, mine: true, users: [...r.users, myName] }
                : r,
            );
          } else {
            reactions = [...m.reactions, { emoji, count: 1, mine: true, users: [myName] }];
          }
          if (!existing?.mine) bumpReaction(emoji);
          return { ...m, reactions };
        }),
      );
      return { prev };
    },
    onSuccess: (updated) => {
      qc.setQueryData<OrderMessage[]>(['order-messages', orderId], (old = []) =>
        old.map((m) => (m.id === updated.id ? updated : m)),
      );
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['order-messages', orderId], ctx.prev);
      toast.error(err instanceof ApiError ? err.message : 'No se pudo reaccionar');
    },
  });

  // Recalcula si el cursor esta escribiendo una mencion (para el dropdown).
  const syncMention = () => {
    const el = textareaRef.current;
    if (!el) return;
    setMention(activeMention(el.value, el.selectionStart ?? el.value.length));
  };

  // Inserta el NOMBRE del miembro elegido en lugar del token `@...` en curso.
  const pickMention = (member: MemberSummary) => {
    if (!mention) return;
    const before = text.slice(0, mention.start);
    const after = text.slice(mention.start + 1 + mention.query.length);
    const inserted = `@${mentionName(member)} `;
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

  const mentionMatches = mention ? matchMembers(mention.query, members) : [];

  // Eliminar mensaje(s). Optimista: desaparecen al instante; el invalidate
  // final reconcilia (y restaura los que hayan fallado).
  const deleteMessages = useCallback(
    (ids: string[]) => {
      qc.setQueryData<OrderMessage[]>(['order-messages', orderId], (old = []) =>
        old.filter((m) => !ids.includes(m.id)),
      );
      setMobileActionsFor(null);
      void Promise.allSettled(
        ids.map((id) => api.delete(`/v1/orders/${orderId}/messages/${id}`)),
      ).then((results) => {
        if (results.some((r) => r.status === 'rejected')) {
          toast.error('Algunos mensajes no se pudieron eliminar');
        }
        void qc.invalidateQueries({ queryKey: ['order-messages', orderId] });
      });
    },
    [qc, orderId],
  );

  const closeActions = useCallback(() => setMobileActionsFor(null), []);

  // Long-press (cel): vibra y ancla las acciones del mensaje (reacciones
  // rapidas / responder / eliminar), estilo WhatsApp.
  const onBubbleLongPress = useCallback((m: OrderMessage) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(35);
    setMobileActionsFor(m.id);
  }, []);

  // "Esta escribiendo": señal al server desde la PRIMERA letra. `force` salta
  // el throttle cuando se EMPIEZA a escribir (campo vacio -> primer caracter),
  // para que al otro lado aparezca de inmediato.
  const signalTyping = useCallback(
    (force = false) => {
      const now = Date.now();
      if (!force && now - lastTypingSent.current < 2000) return;
      lastTypingSent.current = now;
      void api.post(`/v1/orders/${orderId}/typing`).catch(() => undefined);
    },
    [orderId],
  );

  // El globito de "escribiendo" aparece al fondo: si estaba en el fondo,
  // mantenerlo a la vista.
  useEffect(() => {
    if (typingUsers.size > 0 && atBottomRef.current) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
      });
    }
  }, [typingUsers.size]);

  // Expirar señales de escritura viejas (4s sin refresco).
  useEffect(() => {
    if (typingUsers.size === 0) return;
    const t = setInterval(() => {
      setTypingUsers((prev) => {
        const now = Date.now();
        let changed = false;
        const next = new Map(prev);
        for (const [k, v] of next) {
          if (v.until < now) {
            next.delete(k);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [typingUsers]);

  const isOwner = me?.role === 'OWNER' || me?.role === 'ADMIN';

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

  // Subidas como mutaciones CON CLAVE: si el usuario cambia de pestaña o
  // cierra el drawer, la subida sigue y al volver el indicador reaparece
  // (useIsMutating cuenta las mutaciones en vuelo aunque esto se remonte).
  const uploadAttachment = useMutation({
    mutationKey: ['op-attach', orderId],
    mutationFn: async (file: File) => {
      const compact = await compressImage(file);
      const fd = new FormData();
      fd.append('file', compact, compact.name);
      return api.upload<OrderMessage>(`/v1/orders/${orderId}/attachment`, fd);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['order-messages', orderId] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudo subir el archivo'),
    onSettled: () => {
      if (attachRef.current) attachRef.current.value = '';
    },
  });

  const uploadPhoto = useMutation({
    mutationKey: ['op-photo', orderId],
    mutationFn: async ({ file, kind }: { file: File; kind: DevicePhotoKind }) => {
      // Comprimir ANTES de subir: sube en una fraccion y la IA lee mas rapido.
      const compact = await compressImage(file);
      const fd = new FormData();
      fd.append('file', compact, compact.name);
      return api.upload<DevicePhotoResponse>(
        `/v1/orders/${orderId}/device-photo?kind=${kind}`,
        fd,
      );
    },
    onSuccess: (res, { kind }) => {
      toast.success(`${kind === 'imei' ? 'IMEI' : 'Serial'} detectado: ${res.message.imeis.join(', ')}`);
      qc.invalidateQueries({ queryKey: ['order-messages', orderId] });
      qc.invalidateQueries({ queryKey: ['catalog', orderId] });
      // Las lineas de facturar dependen de los codigos: refrescar el preview.
      qc.invalidateQueries({ queryKey: ['invoice-preview', orderId] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudo procesar la foto'),
    onSettled: () => {
      if (fileRef.current) fileRef.current.value = '';
    },
  });

  const photoUploading = useIsMutating({ mutationKey: ['op-photo', orderId] }) > 0;
  const attachUploading = useIsMutating({ mutationKey: ['op-attach', orderId] }) > 0;
  const uploading = photoUploading || attachUploading;
  const uploadLabel = photoUploading
    ? 'Leyendo la foto y buscando en compras...'
    : 'Subiendo archivo...';

  // El indicador de subida aparece al fondo: si estaba en el fondo, mantenerlo
  // a la vista.
  useEffect(() => {
    if (!didInitialScroll.current || !uploading) return;
    if (atBottomRef.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [uploading]);

  const onAttachmentFile = (file: File | null) => {
    if (!file || uploading) return;
    uploadAttachment.mutate(file);
  };

  const onFile = (file: File | null) => {
    if (!file || uploading) return;
    uploadPhoto.mutate({ file, kind: pendingKind.current });
  };

  return (
    <div className="relative flex h-full flex-col">
      {/* flex-col + spacer mt-auto: con pocos mensajes el chat NACE DESDE
          ABAJO (como WhatsApp) y va subiendo; con muchos, scrollea normal. */}
      <div
        ref={scrollRef}
        onScroll={onChatScroll}
        onClick={() => {
          // Tocar fuera cierra las acciones ancladas del long-press.
          if (mobileActionsFor) setMobileActionsFor(null);
        }}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-3.5 pb-2 pt-[18px] md:px-[18px]"
      >
        <div className="mt-auto" aria-hidden />
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
          messages.map((m, i) => {
            // Mensajes seguidos del mismo autor (en <5 min) se ven como un
            // conjunto: nombre y hora solo en el primero (estilo Google Chat).
            const joins = (a?: OrderMessage, b?: OrderMessage) =>
              !!a &&
              !!b &&
              a.kind !== 'system' &&
              b.kind !== 'system' &&
              a.authorId === b.authorId &&
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() < 5 * 60_000;
            const isUnreadBoundary = m.id === unreadBoundaryId;
            // El separador "No leidos" rompe el conjunto: ese mensaje muestra
            // su cabecera (nombre/hora) aunque viniera agrupado.
            const grouped = !isUnreadBoundary && joins(messages[i - 1], m);
            const groupedWithNext = joins(m, messages[i + 1]);
            return (
              <Fragment key={m.id}>
                {isUnreadBoundary ? (
                  <div id="chat-unread-divider" className="mt-4 flex items-center gap-3">
                    <span className="h-px flex-1 rounded bg-accent/30" />
                    <span className="text-[12px] font-semibold tracking-[0.06em] text-accent md:text-[11px]">
                      No leídos
                    </span>
                    <span className="h-px flex-1 rounded bg-accent/30" />
                  </div>
                ) : null}
              <MessageBubble
                message={m}
                mine={m.authorId === me?.id}
                grouped={grouped}
                groupedWithNext={groupedWithNext}
                quoted={
                  m.replyToId ? (messages.find((x) => x.id === m.replyToId) ?? null) : undefined
                }
                matchByCode={matchByCode}
                members={members}
                canDelete={m.kind !== 'system' && (m.authorId === me?.id || isOwner)}
                onDelete={() => setConfirmDelete([m.id])}
                onReply={
                  m.kind !== 'system'
                    ? () => {
                        setReplyTo(m);
                        closeActions();
                      }
                    : undefined
                }
                onReact={
                  m.kind !== 'system'
                    ? (e) => setPickerFor({ messageId: m.id, x: e.clientX, y: e.clientY })
                    : undefined
                }
                onToggleReaction={(emoji) => {
                  react.mutate({ messageId: m.id, emoji });
                  closeActions();
                }}
                onLongPress={m.kind !== 'system' ? () => onBubbleLongPress(m) : undefined}
                actionsOpen={mobileActionsFor === m.id}
                hoverActions={hoverCapable}
                flash={flashId === m.id}
                onDoubleTap={
                  m.kind === 'text'
                    ? () => react.mutate({ messageId: m.id, emoji: '👍' })
                    : undefined
                }
              />
              </Fragment>
            );
          })
        )}
        {/* Globito "esta escribiendo" estilo WhatsApp: burbuja con 3 puntos
            rebotando, como un mensaje entrante en camino. */}
        {typingUsers.size > 0 ? (
          <div className="mt-3 flex flex-col items-start">
            <span className="mb-1 px-1 text-[12px] font-semibold text-muted-foreground md:text-[10.5px]">
              {[...typingUsers.values()].map((t) => t.name).join(', ')}
            </span>
            <div className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-muted px-3.5 py-[11px]">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-300ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-150ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
            </div>
          </div>
        ) : null}
        {uploading ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {uploadLabel}
          </div>
        ) : null}
      </div>

      {/* "Ir al final" (WhatsApp + Google Chat): flota sobre el chat cuando
          estas arriba; con mensajes nuevos muestra el contador y se queda. */}
      {showJump ? (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-24 right-5 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-popover shadow-lg transition-transform hover:scale-105"
          aria-label="Ir al final"
        >
          <ChevronDown className="h-5 w-5 text-foreground" />
          {pendingCount > 0 ? (
            <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-emerald-500 px-1 text-[11px] font-bold leading-none text-white">
              {pendingCount > 99 ? '99+' : pendingCount}
            </span>
          ) : null}
        </button>
      ) : null}

      <div className="border-t border-border p-3">
        {/* Barra de respuesta (citar): a quien respondo + fragmento + cancelar. */}
        {replyTo ? (
          <div className="mb-2 flex items-start gap-2 rounded-lg border-l-2 border-accent bg-muted/50 px-3 py-1.5">
            <Reply className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
            <div className="min-w-0 flex-1 text-xs">
              <span className="block font-semibold">
                {members.find((m) => m.userId === replyTo.authorId)?.name ?? replyTo.authorName}
              </span>
              <span className="line-clamp-1 text-muted-foreground">{quotePreview(replyTo)}</span>
            </div>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              className="rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Cancelar respuesta"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
        {/* items-end: si el campo crece a varias lineas, los botones quedan
            abajo (como WhatsApp). */}
        <div className="flex items-end gap-2">
          {/* Adjuntar foto (IMEI / serial) */}
          <div className="relative h-10 md:h-9">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setAttachOpen((o) => !o)}
              disabled={uploading}
              aria-label="Adjuntar foto"
              className="h-10 w-10 rounded-full text-muted-foreground hover:text-foreground md:h-9 md:w-9"
            >
              {uploading ? (
                <Loader2 className="h-[18px] w-[18px] animate-spin md:h-4 md:w-4" />
              ) : (
                <Paperclip className="h-[18px] w-[18px] md:h-4 md:w-4" />
              )}
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
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[11px] font-semibold text-accent">
                      {initialsOf(mentionName(m))}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{mentionName(m)}</span>
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
                const value = e.target.value;
                // Primer caracter tras campo vacio -> señal INMEDIATA.
                if (value.trim()) signalTyping(!text.trim());
                setText(value);
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
              placeholder={isDesktop ? 'Escribe un mensaje' : 'Mensaje'}
              // h-9 EXACTO (igual que los botones) + block (los textarea son
              // inline por defecto y el baseline los descuadra unos pixeles).
              // Pill redonda estilo WhatsApp (como el mockup aprobado).
              // Pill GRIS que resalta sobre el drawer blanco (mockup).
              // 16px en cel (minimo anti auto-zoom). Medidas EXACTAS para una
              // linea (44px cel / 36px pc): sin scrollbar; crece solo (efecto
              // de abajo) hasta 120px y recien ahi aparece el scroll.
              className="scrollbar-none block max-h-[120px] min-h-[44px] w-full resize-none overflow-hidden rounded-[22px] border border-input bg-muted px-4 py-[11px] text-[16px] leading-[22px] outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring md:min-h-9 md:rounded-[18px] md:py-2 md:text-[12.5px] md:leading-5"
            />
          </div>
          {/* Enviar: circulo en acento cobalto (mockup). */}
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim()}
            aria-label="Enviar"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground transition-[filter] hover:brightness-110 disabled:pointer-events-none disabled:opacity-40 md:h-9 md:w-9"
          >
            <Send className="h-[18px] w-[18px] md:h-4 md:w-4" />
          </button>
        </div>
      </div>

      {/* Picker de emojis (reacciones) */}
      {pickerFor ? (
        <EmojiPicker
          anchor={pickerFor}
          onClose={() => setPickerFor(null)}
          onPick={(emoji) => {
            react.mutate({ messageId: pickerFor.messageId, emoji });
            setPickerFor(null);
            closeActions();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={confirmDelete !== null}
        title={
          confirmDelete && confirmDelete.length > 1
            ? `Eliminar ${confirmDelete.length} mensajes`
            : 'Eliminar mensaje'
        }
        description={
          confirmDelete && confirmDelete.length > 1
            ? `Se eliminarán ${confirmDelete.length} mensajes para todos. Esta acción no se puede deshacer.`
            : 'Se eliminará para todos. Esta acción no se puede deshacer.'
        }
        confirmLabel="Eliminar"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const ids = confirmDelete;
          setConfirmDelete(null);
          if (ids?.length) deleteMessages(ids);
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

/**
 * Pinta el cuerpo del mensaje resaltando las menciones (@David Castro) como
 * chips, estilo Google Chat. Reconoce nombres CON espacios (y handles legacy)
 * de los miembros del equipo.
 */
function MentionText({
  text,
  mine,
  members,
}: {
  text: string;
  mine: boolean;
  members: MemberSummary[];
}) {
  const parts = splitMentions(text, members);
  return (
    <>
      {parts.map((part, i) =>
        part.kind === 'mention' ? (
          <span
            key={i}
            // inline-block + nowrap: el chip salta de linea COMPLETO (como en
            // Google Chat), nunca se parte a mitad del nombre.
            className={cn(
              'inline-block max-w-full truncate rounded-[5px] px-[5px] align-bottom font-medium',
              mine
                ? 'bg-accent-foreground/25 text-accent-foreground'
                : 'bg-accent/10 text-accent',
            )}
          >
            {part.value}
          </span>
        ) : (
          <span key={i}>{part.value}</span>
        ),
      )}
    </>
  );
}

function MessageBubble({
  message,
  mine,
  grouped = false,
  groupedWithNext = false,
  quoted,
  matchByCode,
  members = [],
  canDelete = false,
  onDelete,
  onReply,
  onReact,
  onToggleReaction,
  onLongPress,
  actionsOpen = false,
  hoverActions = true,
  onDoubleTap,
  flash = false,
}: {
  message: OrderMessage;
  mine: boolean;
  /** Sigue a otro mensaje del mismo autor (<5 min): sin nombre/hora, pegado. */
  grouped?: boolean;
  /** El siguiente mensaje continua este grupo (afecta los bordes). */
  groupedWithNext?: boolean;
  /** Mensaje citado: undefined = no es respuesta; null = el original se borro. */
  quoted?: OrderMessage | null;
  matchByCode?: Map<string, CatalogMatch>;
  members?: MemberSummary[];
  canDelete?: boolean;
  onDelete?: () => void;
  onReply?: () => void;
  onReact?: (e: { clientX: number; clientY: number }) => void;
  onToggleReaction?: (emoji: string) => void;
  /** Long-press (cel): abre las acciones ancladas a este mensaje. */
  onLongPress?: () => void;
  /** Acciones visibles SIN hover (ancladas por long-press). */
  actionsOpen?: boolean;
  /** Mostrar acciones al hover (solo dispositivos con mouse; en tactil NO). */
  hoverActions?: boolean;
  /** Doble toque / doble click: 👍 al mensaje. */
  onDoubleTap?: () => void;
  /** Resaltado temporal (se acaba de saltar a este mensaje desde una mencion). */
  flash?: boolean;
}) {
  const isPhoto = message.kind === 'imei_photo' || message.kind === 'serial_photo';
  const isDoc = message.kind === 'document';
  const isFile = message.kind === 'file';

  // Long-press tactil: 420ms sin mover el dedo (>10px cancela: es scroll).
  // Doble TOQUE (o doble click en PC): 👍 al mensaje.
  const lp = useRef<{
    x: number;
    y: number;
    timer: ReturnType<typeof setTimeout> | null;
    moved: boolean;
    fired: boolean;
    lastTap: number;
    lastTouchTap: number;
  }>({ x: 0, y: 0, timer: null, moved: false, fired: false, lastTap: 0, lastTouchTap: 0 });
  const cancelLp = () => {
    if (lp.current.timer) {
      clearTimeout(lp.current.timer);
      lp.current.timer = null;
    }
  };
  const touchHandlers =
    onLongPress || onDoubleTap
      ? {
          onTouchStart: (e: React.TouchEvent) => {
            const t = e.touches[0];
            if (!t) return;
            lp.current.x = t.clientX;
            lp.current.y = t.clientY;
            lp.current.moved = false;
            lp.current.fired = false;
            cancelLp();
            if (onLongPress) {
              lp.current.timer = setTimeout(() => {
                lp.current.timer = null;
                lp.current.fired = true;
                onLongPress();
              }, 420);
            }
          },
          onTouchMove: (e: React.TouchEvent) => {
            const t = e.touches[0];
            if (!t) return;
            if (
              Math.abs(t.clientX - lp.current.x) > 10 ||
              Math.abs(t.clientY - lp.current.y) > 10
            ) {
              lp.current.moved = true;
              cancelLp();
            }
          },
          onTouchEnd: () => {
            cancelLp();
            // Marca de "ultimo toque tactil": el navegador dispara ADEMAS un
            // dblclick sintetico tras dos taps; sin esta marca, ese fantasma
            // volvia a togglear el 👍 y lo quitaba al instante.
            lp.current.lastTouchTap = Date.now();
            if (lp.current.moved || lp.current.fired || !onDoubleTap) return;
            const now = Date.now();
            if (now - lp.current.lastTap < 300) {
              lp.current.lastTap = 0;
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                navigator.vibrate?.(15);
              }
              onDoubleTap();
            } else {
              lp.current.lastTap = now;
            }
          },
          onTouchCancel: cancelLp,
          onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
          onDoubleClick: () => {
            // Ignorar el dblclick sintetico que sigue a un doble TOQUE.
            if (Date.now() - lp.current.lastTouchTap < 700) return;
            if (onDoubleTap) onDoubleTap();
          },
        }
      : {};
  if (message.kind === 'system') {
    return (
      <div id={`msg-${message.id}`} className="mt-3 flex justify-center py-1 first:mt-0">
        <span className="rounded-full bg-muted px-3 py-1 text-center text-[12px] text-muted-foreground md:text-[11px]">
          {message.body}
        </span>
      </div>
    );
  }

  // Autor: el NOMBRE del miembro (los mensajes viejos guardaron el correo).
  const nameOf = (userId: string, fallback: string) =>
    members.find((m) => m.userId === userId)?.name ?? fallback;
  const author = nameOf(message.authorId, message.authorName);

  // Bordes estilo Google Chat: dentro de un conjunto, las esquinas que "tocan"
  // al vecino del mismo autor van menos redondeadas; primera y ultima quedan
  // bien redondas hacia afuera.
  const radius = cn(
    'rounded-2xl',
    mine
      ? cn(grouped && 'rounded-tr-md', groupedWithNext && 'rounded-br-md')
      : cn(grouped && 'rounded-tl-md', groupedWithNext && 'rounded-bl-md'),
  );

  // Bloque de cita (respuesta): autor + fragmento del mensaje original.
  const quote =
    quoted !== undefined ? (
      <div
        className={cn(
          'mb-1 rounded-lg border-l-2 px-2.5 py-1.5 text-xs',
          mine
            ? 'border-accent-foreground/50 bg-accent-foreground/10 text-accent-foreground/90'
            : 'border-accent/60 bg-background/60 text-muted-foreground',
        )}
      >
        {quoted === null ? (
          <span className="italic">Mensaje eliminado</span>
        ) : (
          <>
            <span className="block font-semibold">
              {nameOf(quoted.authorId, quoted.authorName)}
            </span>
            <span className="line-clamp-2">{quotePreview(quoted)}</span>
          </>
        )}
      </div>
    ) : null;

  const bubble = isPhoto ? (
    <PhotoCard message={message} mine={mine} matchByCode={matchByCode} />
  ) : isDoc ? (
    <DocumentCard message={message} mine={mine} />
  ) : isFile ? (
    <AttachmentCard message={message} mine={mine} />
  ) : (
    <div
      className={cn(
        // En cel el texto va un punto mas grande (15px); en escritorio text-sm.
        'px-3.5 py-2 text-[16px] leading-[1.4] md:text-[13px] md:leading-[1.45]',
        radius,
        // Mios en AZUL cobalto (pedido del user: nada de negro); otros en gris
        // que resalta sobre el fondo blanco del drawer.
        mine ? 'bg-accent text-accent-foreground' : 'bg-muted text-foreground',
      )}
    >
      {quote}
      <p className="whitespace-pre-wrap break-words">
        <MentionText text={message.body ?? ''} mine={mine} members={members} />
      </p>
    </div>
  );

  return (
    <div
      id={`msg-${message.id}`}
      {...touchHandlers}
      className={cn(
        // touch-manipulation: sin zoom por doble toque (el doble toque es 👍).
        // Sin padding extra: los consecutivos del mismo autor quedan pegaditos
        // (3px) y el inset lateral es solo el del scroll, como el mockup.
        'group flex touch-manipulation select-none flex-col first:mt-0 md:select-auto',
        grouped ? 'mt-[3px]' : 'mt-3.5',
        mine ? 'items-end' : 'items-start',
        // El mensaje long-presseado queda resaltado mientras sus acciones
        // estan abiertas (feedback de "lo tengo agarrado", estilo WhatsApp).
        actionsOpen && 'rounded-xl bg-accent/10',
        // Salto desde una mencion: destello breve para ubicar el mensaje.
        flash && 'rounded-xl bg-accent/15 transition-colors duration-700',
      )}
    >
      {/* Cabecera del grupo: nombre (otros) + hora, UNA vez por conjunto. */}
      {!grouped ? (
        <span className="mb-1 px-1 text-[12.5px] text-muted-foreground md:text-[10.5px]">
          {!mine ? <span className="font-semibold">{author}</span> : null}
          {!mine ? ' · ' : ''}
          {format(new Date(message.createdAt), 'd MMM, HH:mm', { locale: es })}
        </span>
      ) : null}

      {/* La burbuja va sola (sin gutter de botones): TODAS quedan al ras.
          Las acciones flotan encima al pasar el mouse, estilo Google Chat.
          OJO: el tope de ancho (85%) vive AQUI, en el wrapper — si viviera en
          la burbuja seria 85% del propio wrapper (que encoge al contenido) y
          los mensajes se estrechaban en cascada hasta cortarse. */}
      <div className="relative max-w-[85%]">
        {bubble}

        {onReply || onReact || (canDelete && onDelete) ? (
          <div
            data-msg-actions
            className={cn(
              'pointer-events-none absolute -top-4 z-10 flex items-center gap-0.5 rounded-lg border border-border bg-popover px-1 py-0.5 opacity-0 shadow-md transition-opacity duration-100',
              // El hover SOLO en dispositivos con mouse: en tactil un tap simula
              // hover y abria esto con solo tocar (alli: SOLO long-press).
              hoverActions &&
                'group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100',
              actionsOpen && 'pointer-events-auto opacity-100',
              mine ? 'right-1' : 'left-1',
            )}
          >
            {onToggleReaction
              ? topReactions(3).map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => onToggleReaction(e)}
                    className="rounded-md px-1 py-0.5 text-base leading-none transition-transform hover:scale-125 hover:bg-muted"
                    title={`Reaccionar ${e}`}
                  >
                    {e}
                  </button>
                ))
              : null}
            {onReact ? (
              <>
                <span className="mx-0.5 h-4 w-px bg-border" />
                <button
                  type="button"
                  onClick={(e) => onReact({ clientX: e.clientX, clientY: e.clientY })}
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Mas emojis"
                  title="Más emojis"
                >
                  <SmilePlus className="h-3.5 w-3.5" />
                </button>
              </>
            ) : null}
            {onReply ? (
              <button
                type="button"
                onClick={onReply}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Responder"
                title="Responder"
              >
                <Reply className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {canDelete && onDelete ? (
              <button
                type="button"
                onClick={onDelete}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-red-600 dark:hover:text-red-400"
                aria-label="Eliminar mensaje"
                title="Eliminar mensaje"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Reacciones: chips bajo la burbuja (click = alternar la mia). */}
      {message.reactions.length > 0 ? (
        <div className={cn('mt-1 flex flex-wrap gap-1', mine ? 'justify-end' : 'justify-start')}>
          {message.reactions.map((r) => (
            <button
              key={r.emoji}
              type="button"
              onClick={() => onToggleReaction?.(r.emoji)}
              title={r.users.join(', ')}
              className={cn(
                // Chips finos con tinte de acento (mockup), los mios mas marcados.
                'flex items-center gap-1 rounded-full border px-2 py-[2px] text-[13px] transition-all hover:-translate-y-px md:py-px md:text-[11px]',
                r.mine
                  ? 'border-accent/60 bg-accent/15 text-accent'
                  : 'border-accent/30 bg-accent/10 hover:border-accent/50',
              )}
            >
              <span className="text-[13px] leading-none md:text-[11px]">{r.emoji}</span>
              <span className="font-mono text-[11.5px] tabular-nums text-accent md:text-[10.5px]">
                {r.count}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Fragmento con que se cita un mensaje (texto o tipo de adjunto). */
function quotePreview(m: OrderMessage): string {
  if (m.kind === 'imei_photo' || m.kind === 'serial_photo') return '📷 Foto';
  if (m.kind === 'document') return `📄 ${m.body ?? 'Documento'}`;
  if (m.kind === 'file') return `📎 ${m.body ?? 'Archivo'}`;
  return m.body ?? '';
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
        'w-[230px] max-w-full overflow-hidden rounded-[14px] border',
        mine ? 'rounded-br-sm border-accent/25 bg-accent/5' : 'rounded-bl-sm border-border bg-card',
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

  // TODOS los medios comparten el mismo ancho (230px, como la Foto IMEI): la
  // columna de adjuntos queda alineada y ordenada, nada de anchos dispares.
  if (url && mime.startsWith('image/')) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className={cn(
          // bg-muted: las fotos blancas no se funden con el fondo blanco del chat.
          'block w-[230px] max-w-full overflow-hidden rounded-[14px] border bg-muted',
          mine ? 'rounded-br-sm border-accent/25' : 'rounded-bl-sm border-border',
        )}
        title={name}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={name} className="h-auto max-h-64 w-full object-cover" loading="lazy" />
      </a>
    );
  }

  if (url && mime.startsWith('video/')) {
    return (
      <div
        className={cn(
          'w-[230px] max-w-full overflow-hidden rounded-[14px] border bg-black',
          mine ? 'rounded-br-sm border-accent/25' : 'rounded-bl-sm border-border',
        )}
      >
        <video src={url} controls preload="metadata" className="max-h-64 w-full" />
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
        'flex w-[230px] max-w-full items-center gap-3 rounded-[14px] border px-3 py-2.5 transition',
        mine ? 'rounded-br-sm border-accent/25 bg-accent/5' : 'rounded-bl-sm border-border bg-card',
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
        // Tarjeta COMPACTA (230px, mockup): la foto completa se abre al tocarla.
        'w-[230px] max-w-full overflow-hidden rounded-[14px] border',
        // Mismo lenguaje que las burbujas: mias = tinte acento + esquina derecha;
        // de otro usuario = neutro + esquina izquierda.
        mine ? 'rounded-br-sm border-accent/25 bg-accent/5' : 'rounded-bl-sm border-border bg-card',
        className,
      )}
    >
      {message.attachmentUrl ? (
        <a href={message.attachmentUrl} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={message.attachmentUrl}
            alt={isSerial ? 'Foto serial' : 'Foto IMEI'}
            className="h-[140px] w-full bg-muted object-cover md:h-[120px]"
          />
        </a>
      ) : null}
      <div className="space-y-2 p-2.5">
        <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
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
      <span className="inline-block rounded-md border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[12px] text-emerald-700 dark:text-emerald-400 md:text-[11px]">
        {code}
      </span>
      {showMatch ? (
        match ? (
          // Estilo mockup: linea con check verde + factura/fecha/tienda, y el
          // producto+costo debajo en gris (misma info, sin caja pesada).
          <div className="space-y-0.5 text-[12px] md:text-[11px]">
            <p className="flex items-center gap-1 text-muted-foreground">
              <Check className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span className="min-w-0 break-words leading-snug">
                Factura {match.billNumber}
                {match.billDate
                  ? ` · ${format(new Date(match.billDate), 'd MMM', { locale: es })}`
                  : ''}
                {match.store ? ` · ${match.store}` : ''}
              </span>
            </p>
            <p className="break-words pl-4 leading-snug text-muted-foreground/80">
              {match.productName ?? 'Producto sin nombre'}
              {match.unitCost ? ` · Costo ${formatCurrency(match.unitCost, 'COP')}` : ''}
              {match.providerName ? ` · ${match.providerName}` : ''}
            </p>
          </div>
        ) : (
          <p className="text-[12px] text-muted-foreground md:text-[11px]">Sin coincidencia en compras</p>
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
            {/* SIEMPRE quien lo hizo: persona, o Sistema/VTEX si fue automatico. */}
            <p className="text-[11px] text-muted-foreground">
              <span className="font-medium text-muted-foreground">
                {e.actorName ?? (e.type === 'created' ? 'VTEX' : 'Sistema')}
              </span>
              {' · '}
              {format(new Date(e.createdAt), "d MMM yyyy '·' HH:mm", { locale: es })}
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
  if (type === 'claimed' || type === 'unclaimed') return <Hand className={cls} />;
  if (type === 'invoiced') return <ReceiptText className={cls} />;
  if (type === 'guide_generated') return <Truck className={cls} />;
  if (type === 'vtex_invoiced') return <ReceiptText className={cls} />;
  return <Activity className={cls} />;
}

function describeEvent(e: OrderEvent): string {
  const toName = typeof e.data.toName === 'string' ? e.data.toName : null;
  const fromName = typeof e.data.fromName === 'string' ? e.data.fromName : null;
  switch (e.type) {
    case 'assigned':
      return toName ? `Asignado a la sede ${toName}` : 'Asignado a la sede';
    case 'transferred':
      return toName
        ? `Transferido a la sede ${toName}${fromName ? ` (venía de ${fromName})` : ''}`
        : 'Transferido a otra sede';
    case 'returned':
      return fromName
        ? `Devuelto a pedidos generales (estaba en ${fromName})`
        : 'Devuelto a pedidos generales';
    case 'claimed':
      return 'Tomó el pedido (quedó a su cargo)';
    case 'unclaimed':
      return 'Soltó el pedido';
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
