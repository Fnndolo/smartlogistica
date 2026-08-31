'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  Megaphone,
  MessageCircle,
  MessageSquare,
  Paperclip,
  PlusCircle,
  ReceiptText,
  Reply,
  ScanBarcode,
  ScanLine,
  Send,
  Smartphone,
  SmilePlus,
  Trash2,
  Truck,
  Undo2,
  User,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { DEFAULT_VTEX_FEES, vtexNetValue, type VtexFees } from '@smartlogistica/shared';
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
import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api-client';
import { canManageOrders, canModerateChat, canUseWhatsapp, isAdmin } from '@/lib/rbac';
import { cn, titleCaseName } from '@/lib/utils';

import { setActiveChat } from './active-chat';
import { ClaimChip } from './claim-chip';
import { GuidePanel } from './guide-panel';
import { InvoicePanel } from './invoice-panel';
import { BADGE_COLOR_CLASSES, platformOf, usePlatforms } from './platform-badge';
import { useOrderActions } from './use-order-actions';
import { WhatsappPanel } from './whatsapp-panel';
import { compressImage } from '@/lib/compress-image';

import { EmojiPicker } from './emoji-picker';
import { ImageLightbox, type LightboxImage } from './image-lightbox';
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

type Tab = 'detalle' | 'conversacion' | 'facturar' | 'guia' | 'actividad' | 'whatsapp';

/* Ids que amarran cada pestaña con su panel (role=tab / role=tabpanel): un
   lector de pantalla anuncia "pestaña 2 de 6, seleccionada" y salta al panel
   correcto. Solo hay UN drawer abierto a la vez, asi que no colisionan. */
const tabId = (t: Tab) => `drawer-tab-${t}`;
const paneId = (t: Tab) => `drawer-pane-${t}`;

/** Adjunto en STAGING: elegido/pegado/arrastrado, aun sin enviar. */
interface StagedFile {
  id: string;
  file: File;
  url: string;
  // Pre-compresion en segundo plano (arranca al cargar en la barra): al enviar
  // ya esta lista -> la burbuja pinta la version liviana AL INSTANTE (una foto
  // de camara de 10MB tarda segundos en decodificar; la comprimida, nada).
  compact?: File;
  compactUrl?: string;
}
/** Burbuja optimista de un adjunto subiendo (progress 0..100). */
type PendingMsg = OrderMessage & { progress?: number };

/**
 * Vista previa LOCAL de los adjuntos que YO acabo de subir (id real -> object
 * URL). Al confirmarse el mensaje, la imagen sigue mostrando el MISMO src
 * local: cambiarlo a la URL firmada de storage hacia "parpadear" la foto (un
 * frame en blanco mientras el navegador descargaba/decodificaba la remota).
 * A nivel de modulo: sobrevive remontajes del drawer durante la sesion.
 */
const localPreviews = new Map<string, string>();

/** Espera a que el navegador PINTE (2 frames): la burbuja optimista queda en
 *  pantalla ANTES de arrancar trabajo pesado (comprimir una foto de camara
 *  puede congelar el hilo principal un instante). */
const nextPaint = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

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

  // ===== Ancho REDIMENSIONABLE (solo escritorio) =====
  // Minimo = que las pestañas quepan SIN scroll lateral (se mide el nav real).
  // Maximo = toda la pantalla. Se arrastra desde el borde izquierdo y el ancho
  // elegido queda guardado (localStorage) para las proximas veces.
  const asideRef = useRef<HTMLElement>(null);
  const minWRef = useRef(0);
  const [width, setWidth] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    const saved = Number(window.localStorage.getItem('order-drawer-width'));
    return Number.isFinite(saved) && saved > 0 ? saved : null;
  });
  /**
   * Ancho minimo REAL = lo que ocupan las pestañas + el padding del nav, y
   * nada mas (el numero de pestañas cambia segun el rol y el pedido).
   *
   * OJO: NO sirve `nav.scrollWidth`. El nav tiene overflow-x-auto, asi que
   * cuando las pestañas SI caben su scrollWidth es el ancho del contenedor,
   * o sea el ancho actual del drawer: el minimo se pegaba al ancho de ese
   * momento y ya no se podia encoger nunca mas. Se suman los hijos (que
   * llevan shrink-0, asi que su ancho es el natural) + los gaps.
   */
  const measureMinWidth = (): number | null => {
    const nav = asideRef.current?.querySelector<HTMLElement>('[data-drawer-tabs]');
    if (!nav) return null;
    const kids = Array.from(nav.children) as HTMLElement[];
    if (kids.length === 0) return null;
    const cs = window.getComputedStyle(nav);
    const gap = parseFloat(cs.columnGap) || 0;
    const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const tabs = kids.reduce((sum, el) => sum + el.getBoundingClientRect().width, 0);
    return Math.min(Math.ceil(tabs + gap * (kids.length - 1) + pad), window.innerWidth);
  };
  useEffect(() => {
    if (!rendered) return;
    // Medir DESPUES de pintar (los hijos ya tienen su ancho definitivo).
    const raf = requestAnimationFrame(() => {
      const min = measureMinWidth();
      if (min === null) return;
      minWRef.current = min;
      // Se respeta el ancho guardado; solo se sube si quedo por debajo del
      // minimo, o se baja si ya no cabe en la ventana.
      setWidth((w) => Math.min(Math.max(w ?? min, min), window.innerWidth));
    });
    return () => cancelAnimationFrame(raf);
  }, [rendered]);
  // Si la ventana se achica, el drawer se achica con ella (nunca mas ancho
  // que la pantalla, nunca por debajo del minimo de las pestañas).
  useEffect(() => {
    if (!rendered) return;
    const onResize = () => {
      const min = measureMinWidth() ?? minWRef.current;
      minWRef.current = min;
      setWidth((w) => (w === null ? null : Math.min(Math.max(w, min), window.innerWidth)));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [rendered]);
  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const next = Math.min(
        Math.max(window.innerWidth - ev.clientX, minWRef.current),
        window.innerWidth,
      );
      setWidth(next);
    };
    const up = (ev: PointerEvent) => {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      const finalW = Math.min(
        Math.max(window.innerWidth - ev.clientX, minWRef.current),
        window.innerWidth,
      );
      window.localStorage.setItem('order-drawer-width', String(Math.round(finalW)));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  };

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
          'absolute inset-0 bg-scrim/55 backdrop-blur-[2px] transition-opacity duration-200',
          shown ? 'opacity-100' : 'opacity-0',
        )}
        onClick={onClose}
      />
      <aside
        ref={asideRef}
        role="dialog"
        aria-modal="true"
        className={cn(
          // Movil: pantalla completa. Escritorio (md+): panel lateral con ancho
          // AJUSTABLE (arrastrando el borde izquierdo); por defecto, el minimo
          // que deja ver TODAS las pestañas sin scroll.
          // bg-card: el drawer es una SUPERFICIE blanca (el lienzo es gris).
          'shadow-pop absolute right-0 top-0 flex h-full w-full max-w-none flex-col bg-card transition-transform duration-200 ease-out md:w-[var(--drawer-w,640px)] md:border-l md:border-border',
          shown ? 'translate-x-0' : 'translate-x-full',
        )}
        style={width ? ({ '--drawer-w': `${width}px` } as React.CSSProperties) : undefined}
      >
        {/* Agarradera para redimensionar (solo escritorio). */}
        <div
          onPointerDown={onResizeStart}
          className="group absolute left-0 top-0 z-20 hidden h-full w-2 cursor-col-resize touch-none md:block"
          aria-label="Ajustar ancho"
          title="Arrastra para ajustar el ancho"
        >
          {/* El agarre se tiñe de COBALTO (--accent), no de la tinta casi negra
              de --primary: al arrastrar, la linea debe leerse como el acento. */}
          <div className="mx-auto h-full w-[3px] bg-transparent transition-colors group-hover:bg-accent/35 group-active:bg-accent/55" />
        </div>
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
  // chatea). Facturar, guia y actividad son de quien gestiona pedidos
  // (administradores y gestores).
  const canManage = canManageOrders(me?.role);
  // WhatsApp va aparte: el API lo reserva a administradores, asi que al gestor
  // ni se le ofrece la pestaña (seria un 403).
  const canWhatsapp = canUseWhatsapp(me?.role);

  const { data: detail } = useQuery(orderDetailQuery(order.id));

  // Nombre + color de la plataforma contra el CATALOGO (igual que el badge de
  // la tabla): la pastilla de la cabecera (.pill-vtex del mockup).
  const { data: platforms = [] } = usePlatforms();
  const platform = platformOf(order, platforms);

  // Facturado POR FUERA de SmartLogistica (cerrado directo en VTEX, sin sede):
  // solo trazabilidad — sin Facturar ni Guia.
  const external = !order.warehouseId && order.status !== 'ready-for-handling';

  // PRECARGAR Facturar y Guia apenas se abre el pedido: cuando el usuario
  // entra a esas pestañas, el contenido ya esta en cache (antes esperaba
  // 4-6s el fetch de Alegra/Coordinadora al abrir la pestaña).
  useEffect(() => {
    if (!canManage || external) return;
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
  }, [order.id, canManage, external, qc]);

  const tabs: { id: Tab; label: string; icon: typeof Info }[] = [
    { id: 'conversacion', label: 'Conversación', icon: MessageSquare },
    { id: 'detalle', label: 'Detalle', icon: Info },
    ...(canManage && !external
      ? ([
          { id: 'facturar', label: 'Facturar', icon: ReceiptText },
          { id: 'guia', label: 'Guía', icon: Truck },
        ] as { id: Tab; label: string; icon: typeof Info }[])
      : []),
    // Actividad para quien gestiona pedidos (admins y gestores) (en los facturados por fuera es la
    // trazabilidad misma).
    ...(canManage
      ? ([{ id: 'actividad', label: 'Actividad', icon: Activity }] as {
          id: Tab;
          label: string;
          icon: typeof Info;
        }[])
      : []),
    // WhatsApp de ULTIMA, para todos los administradores.
    ...(canWhatsapp
      ? ([{ id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle }] as {
          id: Tab;
          label: string;
          icon: typeof Info;
        }[])
      : []),
  ];

  return (
    <>
      {/* Cabecera COMPLETA (.dhead del mockup): identidad + pestañas viven en
          la MISMA superficie, con un solo lavado cobalto que baja de arriba
          (7% -> transparente al 85%) y UNA sola hairline al final. */}
      <div className="border-b border-border bg-[linear-gradient(to_bottom,hsl(var(--accent)/0.07),transparent_85%)]">
        {/* Header */}
        <header className="flex items-start justify-between gap-3 px-4 pb-0 pt-3 md:px-[22px] md:pt-[18px]">
          {/* Cel: flecha de volver (equivale al boton atras del sistema). */}
          <button
            type="button"
            onClick={onClose}
            className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-wash active:text-accent-ink max-md:h-10 max-md:w-10 md:hidden"
            aria-label="Volver a los pedidos"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            {/* Cel: el N° y el estado usan TODO el ancho, centrados (sin partirse
                en dos lineas por culpa del boton). En pc, a la izquierda. */}
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 md:justify-start">
              <span className="min-w-0 max-w-full truncate whitespace-nowrap text-[19px] font-extrabold tracking-[-0.02em]">
                <span className="font-semibold text-hint">Pedido</span> {order.externalId}
              </span>
              {/* Pastilla de plataforma (.pill-vtex del mockup): va pegada al
                  numero del pedido; el tinte sale del catalogo (VTEX = rosa). */}
              <span
                className={cn(
                  'inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11.5px] font-bold tracking-[0.01em]',
                  BADGE_COLOR_CLASSES[platform.color],
                )}
              >
                {platform.name}
              </span>
              <StatusPill status={order.status} />
              {order.addressStatus === 'confirmed' ? (
                <span className="inline-flex shrink-0 items-center gap-[5px] whitespace-nowrap rounded-full bg-emerald-500/10 px-2.5 py-[3px] text-[11.5px] font-bold tracking-[0.01em] text-emerald-600 dark:text-emerald-400">
                  <Check className="h-3 w-3" />
                  Dirección confirmada
                </span>
              ) : null}
            </div>
            {/* Cel: el boton de tomar/soltar CENTRADO verticalmente contra la
                tira de datos (.dhead-sub). */}
            <div className="mt-1.5 flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px] text-muted-foreground">
                <span className="min-w-0 break-words">
                  <b className="font-bold text-foreground">{titleCaseName(order.customerName)}</b>
                  {order.customerDocument ? (
                    <>
                      {' · CC '}
                      <span className="font-mono text-[0.92em] tracking-[0.02em]">
                        {order.customerDocument}
                      </span>
                    </>
                  ) : null}
                </span>
                <span className="whitespace-nowrap tabular-nums">
                  <b className="font-bold text-foreground">
                    {formatCurrency(order.totalValue, order.currency)}
                  </b>{' '}
                  · {order.totalUnits} u.
                </span>
                {/* Creado: vivia en una casilla del Detalle; el mockup lo pone
                    aqui, en la tira de datos de la cabecera. */}
                <span className="whitespace-nowrap tabular-nums">
                  Creado{' '}
                  <b className="font-bold text-foreground">
                    {format(new Date(order.marketplaceCreatedAt), "d MMM yyyy '·' HH:mm", {
                      locale: es,
                    })}
                  </b>
                </span>
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
              className="ml-1.5 flex h-9 w-9 items-center justify-center rounded-[11px] border border-transparent text-muted-foreground transition-colors hover:border-input hover:bg-wash hover:text-accent-ink max-md:h-10 max-md:w-10"
              aria-label="Cerrar"
            >
              <X className="h-[18px] w-[18px]" />
            </button>
          </div>
        </header>

        {/* Tabs */}
        {/* overflow-y-hidden: NUNCA scroll vertical aqui (aparecia una barrita
            sin sentido). El lateral (auto) solo sale si las tabs no caben. */}
        <nav
          data-drawer-tabs
          role="tablist"
          aria-label="Secciones del pedido"
          className="scrollbar-none flex items-center gap-1 overflow-x-auto overflow-y-hidden px-4 pb-2.5 pt-3.5 md:px-[22px]"
        >
          {tabs.map((t) => {
            const active = tab === t.id;
            const unread = t.id === 'conversacion' ? (order.unreadCount ?? 0) : 0;
            return (
              <button
                key={t.id}
                type="button"
                id={tabId(t.id)}
                role="tab"
                aria-selected={active}
                aria-controls={paneId(t.id)}
                onClick={() => setTab(t.id)}
                className={cn(
                  // Pastilla cobalto para la activa; inactivas grisaceas con
                  // hover al lavado (texto = --cobalt-ink, la tinta profunda del
                  // mockup). En cel todo un punto mas grande y con 40px de toque.
                  'relative flex shrink-0 items-center gap-[7px] whitespace-nowrap rounded-[10px] px-3.5 py-2 text-[14px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-card max-md:min-h-[40px] md:px-3.5 md:py-[7px] md:text-[13px]',
                  active
                    ? 'bg-accent text-accent-foreground shadow-[0_4px_14px_-4px_hsl(var(--accent)/0.35)]'
                    : 'text-muted-foreground hover:bg-wash hover:text-accent-ink',
                )}
              >
                <t.icon className="h-4 w-4 md:h-[15px] md:w-[15px]" />
                {t.label}
                {unread > 0 ? (
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-px text-[10px] font-extrabold tabular-nums',
                      active
                        ? 'bg-white/25 text-accent-foreground'
                        : 'bg-destructive text-destructive-foreground',
                    )}
                  >
                    {unread}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Content: TODAS las pestañas quedan montadas (apiladas, las inactivas
          invisibles). Asi al cambiar de pestaña no se pierde nada: scroll del
          chat, items editados en Facturar, direccion/paquete en Guia, y las
          operaciones en curso siguen mostrando su estado al volver. */}
      <div className="relative min-h-0 flex-1">
        <TabPane tab="conversacion" active={tab === 'conversacion'}>
          <ConversacionTab
            orderId={order.id}
            initialUnread={order.unreadCount ?? 0}
            active={tab === 'conversacion'}
            focusMessageId={focusMessageId}
          />
        </TabPane>
        <TabPane tab="detalle" active={tab === 'detalle'} scroll>
          <DetalleTab order={order} detail={detail} onDeleted={onClose} />
        </TabPane>
        {canManage && !external ? (
          <>
            <TabPane tab="facturar" active={tab === 'facturar'} scroll>
              <InvoicePanel orderId={order.id} manual={order.provider === 'manual'} />
            </TabPane>
            <TabPane tab="guia" active={tab === 'guia'} scroll>
              <GuidePanel
                orderId={order.id}
                manual={order.provider === 'manual'}
                orderTotal={order.totalValue}
              />
            </TabPane>
          </>
        ) : null}
        {canManage ? (
          <TabPane tab="actividad" active={tab === 'actividad'} scroll>
            <ActividadTab orderId={order.id} />
          </TabPane>
        ) : null}
        {canWhatsapp ? (
          <TabPane tab="whatsapp" active={tab === 'whatsapp'}>
            <WhatsappPanel orderId={order.id} active={tab === 'whatsapp'} />
          </TabPane>
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
        className="flex h-8 items-center gap-1.5 rounded-[11px] border border-input bg-card px-3 text-[12.5px] font-extrabold text-muted-foreground transition-colors hover:border-accent hover:text-accent max-md:h-10 max-md:px-3.5"
      >
        <Hand className="h-3.5 w-3.5" />
        Tomar pedido
      </button>
    );
  }
  return (
    /* .claim del mockup: ficha + texto DENTRO de una sola pastilla. */
    <span className="ml-auto inline-flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-3 text-[12px] font-semibold text-muted-foreground">
      <ClaimChip userId={c.userId} name={c.name} mine={c.mine} />
      {c.mine ? (
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          Lo tienes tú
          <button
            type="button"
            onClick={() => unclaim(order.id)}
            className="inline-flex items-center text-[11px] underline underline-offset-2 hover:text-destructive max-md:min-h-[40px] max-md:px-1"
          >
            Soltar
          </button>
        </span>
      ) : (
        <span className="max-w-[110px] truncate whitespace-nowrap">{c.name} lo tiene</span>
      )}
    </span>
  );
}

/**
 * Panel de pestaña que NUNCA se desmonta: las inactivas quedan con
 * visibility:hidden (conserva scroll y estado, no intercepta clicks).
 */
function TabPane({
  tab,
  active,
  scroll,
  children,
}: {
  /** Pestaña a la que pertenece: amarra id/aria-labelledby con su boton. */
  tab: Tab;
  active: boolean;
  scroll?: boolean;
  children: React.ReactNode;
}) {
  return (
    /* .pane.on del mockup: la que pasa al frente ENTRA (sube 6px y aparece).
       La clase solo existe mientras la pestaña esta activa, asi que al volver a
       ella la animacion se dispara de nuevo — sin desmontar nada. */
    <div
      id={paneId(tab)}
      role="tabpanel"
      aria-labelledby={tabId(tab)}
      className={cn(
        'absolute inset-0',
        scroll && 'overflow-y-auto',
        active ? 'pane-rise' : 'invisible',
      )}
      aria-hidden={!active}
    >
      {children}
    </div>
  );
}

// === Tab: Detalle ===

/**
 * Pastilla en linea de una fila del kv (.pill del mockup, a 10.5px): el estado
 * viaja PEGADO al dato al que pertenece (teléfono / dirección).
 */
function KvPill({
  tone,
  icon: Icon,
  children,
}: {
  tone: 'ok' | 'warn' | 'muted';
  icon?: typeof Mail;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-[4px] whitespace-nowrap rounded-full px-2 py-[2px] text-[10.5px] font-extrabold tracking-[0.01em]',
        tone === 'ok' && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
        tone === 'warn' && 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
        tone === 'muted' && 'bg-wash text-hint',
      )}
    >
      {Icon ? <Icon className="h-[11px] w-[11px]" /> : null}
      {children}
    </span>
  );
}

/**
 * Detalle de la confirmacion de direccion por WhatsApp: la FRASE (y la
 * dirección nueva si la modificó). El ESTADO en si lo lleva la pastilla en
 * linea de la fila «Dirección» (mockup) — aqui no se repite.
 */
function AddressConfirmation({ order }: { order: OrderSummary }) {
  if (!order.addressStatus) {
    return (
      <p className="text-[12.5px] text-muted-foreground">
        El cliente aún no confirma su dirección (WhatsApp).
      </p>
    );
  }
  if (order.addressStatus === 'confirmed') {
    return (
      <p className="text-[12.5px] text-muted-foreground">
        El cliente confirmó que su dirección es correcta.
      </p>
    );
  }
  return (
    <div className="text-[12.5px]">
      <p className="min-w-0 break-words text-muted-foreground">
        El cliente MODIFICÓ su dirección — verifícala antes de generar la guía.
      </p>
      {order.confirmedAddress ? (
        <p className="mt-1.5 whitespace-pre-wrap break-words font-semibold text-foreground">
          {order.confirmedAddress}
        </p>
      ) : null}
    </div>
  );
}

function DetalleTab({
  order,
  detail,
  onDeleted,
}: {
  order: OrderSummary;
  detail: OrderDetail | undefined;
  /** Cerrar el drawer tras eliminar el pedido (montados a mano). */
  onDeleted?: () => void;
}) {
  const items = detail?.items ?? order.items;
  // Comisiones de VTEX (globales, configurables en Ajustes): alimentan el
  // "neto" que se despliega al tocar un precio unitario.
  const { data: fees = DEFAULT_VTEX_FEES } = useQuery({
    queryKey: ['vtex-fees'],
    queryFn: () => api.get<VtexFees>('/v1/vtex-fees'),
    staleTime: 5 * 60_000,
    enabled: order.provider === 'vtex',
  });
  const external = !order.warehouseId && order.status !== 'ready-for-handling';
  const me = useCurrentUser();
  const isAdminRole = isAdmin(me?.role);
  return (
    <div className="space-y-5 p-[22px]">
      {external ? (
        <div className="flex items-start gap-2.5 rounded-[12px] bg-amber-500/10 px-3.5 py-[11px] text-[12.5px] text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-px h-[15px] w-[15px] shrink-0" />
          <span className="min-w-0 break-words">
            Este pedido fue facturado <b>por fuera de SmartLogística</b> (cerrado directamente en
            VTEX). Queda como trazabilidad: no permite facturar ni generar guía y no tiene
            seguimiento de envío.
          </span>
        </div>
      ) : null}
      {/* Cliente (el mockup abre el Detalle DIRECTO con esta sección: unidades,
          total, creado y plataforma viven ahora en la cabecera y en el total
          del pedido, no en casillas). */}
      <section className="space-y-2.5">
        <SectionTitle icon={User} hint="de VTEX + confirmación WhatsApp">
          Cliente
        </SectionTitle>
        <div className="rounded-[14px] border border-border bg-surface px-4 py-3.5">
          {/* .kv del mockup. La columna fija de etiquetas se APILA por debajo de
              ~400px: en un panel angosto dejaba al valor sin ancho util. */}
          <dl className="grid grid-cols-1 text-[13.5px] [&>dd:last-of-type]:pb-0 [&>dd]:pb-2.5 min-[400px]:grid-cols-[110px_minmax(0,1fr)] min-[400px]:gap-y-[9px] min-[400px]:[&>dd]:pb-0 md:grid-cols-[130px_minmax(0,1fr)]">
            <InfoRow label="Email" value={detail?.customerEmail} placeholder="Sin email" />
            <InfoRow
              label="Teléfono"
              value={detail?.customerPhone}
              placeholder="Sin teléfono"
              /* «WhatsApp activo» solo cuando consta que el cliente RESPONDIÓ
                 por ahi (hay confirmación de dirección): la pastilla afirma
                 algo cierto, no una suposicion por tener numero. */
              pill={
                detail?.customerPhone && order.addressStatus ? (
                  <KvPill tone="ok" icon={MessageCircle}>
                    WhatsApp activo
                  </KvPill>
                ) : null
              }
            />
            <InfoRow
              label="Dirección"
              value={detail?.shippingAddress}
              placeholder="Sin dirección de envío"
              pill={
                order.addressStatus === 'confirmed' ? (
                  <KvPill tone="ok" icon={Check}>
                    Confirmada
                  </KvPill>
                ) : order.addressStatus === 'modified' ? (
                  <KvPill tone="warn" icon={AlertTriangle}>
                    Modificada
                  </KvPill>
                ) : (
                  <KvPill tone="muted" icon={MessageSquare}>
                    Sin responder
                  </KvPill>
                )
              }
            />
          </dl>
          <div className="mt-3 border-t border-dashed border-input pt-3">
            <AddressConfirmation order={order} />
          </div>
        </div>
      </section>

      {/* Productos */}
      <section className="space-y-2.5">
        <SectionTitle
          icon={Smartphone}
          hint={items.length > 1 ? `${items.length} artículos` : undefined}
        >
          Productos
        </SectionTitle>
        <div className="rounded-[14px] border border-border bg-surface px-4 py-3.5">
          {items.map((item, idx) => (
            <div
              key={`${item.sku}-${idx}`}
              className={cn(
                // flex-wrap: en un panel angosto el precio baja a su propia
                // linea (alineado a la derecha) en vez de estrujar el nombre.
                'flex flex-wrap items-center gap-x-3.5 gap-y-1.5 py-3',
                idx > 0 && 'border-t border-dashed border-input',
              )}
            >
              <ProductThumb src={item.imageUrl} />
              <div className="min-w-[min(100%,150px)] flex-1">
                <p className="break-words text-[14px] font-extrabold leading-snug">{item.name}</p>
                <p className="mt-0.5 flex flex-wrap gap-x-2.5 text-[12px] text-hint">
                  <span>Cant. {item.quantity}</span>
                  <span className="break-all font-mono text-[0.92em] tracking-[0.02em]">
                    {item.sku}
                  </span>
                </p>
              </div>
              <div className="ml-auto shrink-0 text-right">
                <p className="text-[15px] font-extrabold tabular-nums tracking-[-0.01em]">
                  {formatCurrency(lineTotal(item.unitPrice, item.quantity), order.currency)}
                </p>
                <UnitPrice
                  unitPrice={item.unitPrice}
                  quantity={item.quantity}
                  currency={order.currency}
                  // El neto solo tiene sentido en VTEX: es su comision.
                  fees={order.provider === 'vtex' ? fees : null}
                />
              </div>
            </div>
          ))}
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border pt-3 text-[15px]">
            <span className="text-muted-foreground">Total del pedido</span>
            <b className="text-[17px] font-extrabold tabular-nums tracking-[-0.01em]">
              {formatCurrency(order.totalValue, order.currency)}
            </b>
          </div>
        </div>
      </section>

      {/* Ruta del envío: el recorrido de 6 tramos del mockup (.route). Los
          facturados POR FUERA no tienen seguimiento — ahí no se pinta. */}
      {!external ? (
        <section className="space-y-2.5">
          <SectionTitle
            icon={Truck}
            hint={
              order.shippingProvider === 'domicilio' ? (
                'entrega a domicilio · sin rastreo'
              ) : order.guideNumber ? (
                <>
                  rastreo Coordinadora · guía{' '}
                  <span className="font-mono text-[0.92em] tracking-[0.02em]">
                    {order.guideNumber}
                  </span>
                </>
              ) : (
                'aún sin guía'
              )
            }
          >
            Ruta del envío
          </SectionTitle>
          <div className="rounded-[14px] border border-border bg-surface px-4 py-3.5">
            <ShipRoute order={order} />
          </div>
        </section>
      ) : null}

      {/* Eliminar (solo pedidos MONTADOS a mano): se borra TODO el pedido.
          Un pedido ya COMPLETADO (factura + guia) solo lo elimina un admin —
          a un operador ni se le ofrece (el server igual lo bloquearia). */}
      {order.provider === 'manual' && (isAdminRole || order.status !== 'invoiced') ? (
        <DeleteOrderZone order={order} onDeleted={onDeleted} />
      ) : null}
    </div>
  );
}

/**
 * Casilla 44x44 del producto (.product-ico): la FOTO que trae el marketplace y,
 * si no hay o no carga, el chip de icono con el lavado cobalto.
 * `broken` es estado puramente visual del <img>.
 */
function ProductThumb({ src }: { src: string | null }) {
  const [broken, setBroken] = useState(false);
  // MISMA silueta en las dos variantes (44px, rounded-xl, sin borde): la foto
  // solo tapa el degradado diagonal del lavado cobalto (.product-ico).
  const shell =
    'grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-[linear-gradient(135deg,hsl(var(--wash)),hsl(var(--wash-strong)))]';
  if (src && !broken) {
    return (
      <span className={shell}>
        {/* <img> a proposito: la foto viene del CDN del marketplace y no hay
            dominios remotos configurados para next/image. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      </span>
    );
  }
  return (
    <span className={cn(shell, 'text-accent')}>
      <Smartphone className="h-[22px] w-[22px]" />
    </span>
  );
}

/** Los 6 tramos del recorrido del pedido (mockup .route). */
const ROUTE_LEGS = ['Pedido', 'Facturado', 'Guía', 'Origen', 'Reparto', 'Entregado'] as const;
/** Mismos 6 tramos para el DOMICILIO propio, donde no hay guía ni terminales:
 *  el documento es el soporte y el trayecto lo hace el mensajero. */
const ROUTE_LEGS_DOM = [
  'Pedido',
  'Facturado',
  'Soporte',
  'Despacho',
  'Reparto',
  'Entregado',
] as const;

/**
 * Tramo ACTUAL (1..6): se lee del rastreo de Coordinadora cuando lo hay y, si
 * no, de lo que ya se hizo en la plataforma (factura / guía).
 */
function routeStep(order: OrderSummary): number {
  const t = (order.shippingStatus ?? '').toUpperCase();
  if (/ENTREGAD/.test(t) || order.shippingState === 'entregado') return 6;
  if (/REPARTO/.test(t) || /TERMINAL\s+(DE\s+)?DESTINO/.test(t)) return 5;
  if (
    /TRANSPORTE/.test(t) ||
    /TERMINAL\s+(DE\s+)?ORIGEN/.test(t) ||
    order.shippingState === 'en_transito' ||
    order.shippingState === 'novedad'
  ) {
    return 4;
  }
  if (order.guideNumber) return 3;
  if (order.status === 'invoiced') return 2;
  return 1;
}

/**
 * Ruta del envío: linea de 3px entre tramos, punto de 17px (relleno = hecho,
 * hueco con pulso = donde va ahora) y etiqueta de 10.5px.
 */
function ShipRoute({ order }: { order: OrderSummary }) {
  const step = routeStep(order);
  const legs = order.shippingProvider === 'domicilio' ? ROUTE_LEGS_DOM : ROUTE_LEGS;
  const delivered = step === legs.length;
  return (
    /* Los 6 tramos necesitan ~55px cada uno para que la etiqueta («Entregado»)
       quepa en una linea. Por debajo de eso NO se estrujan ni se salen de la
       tarjeta: el recorrido scrollea horizontalmente dentro de su propia caja. */
    <div className="-mx-1 overflow-x-auto px-1 scrollbar-none">
      <div
        className="flex min-w-[330px] items-start px-[2px] pb-[2px] pt-1.5"
        title={order.shippingStatus ?? undefined}
      >
        {legs.map((label, i) => {
          const n = i + 1;
          const done = n < step || delivered;
          const now = n === step && !delivered;
          return (
            <div
              key={label}
              className="relative flex min-w-0 flex-1 flex-col items-center gap-[7px]"
            >
              {n > 1 ? (
                <span
                  aria-hidden
                  className={cn(
                    'absolute left-[-50%] top-2 h-[3px] w-full rounded-[2px]',
                    done ? 'bg-accent' : 'bg-input',
                  )}
                />
              ) : null}
              <span
                aria-hidden
                className={cn(
                  'relative z-[1] h-[17px] w-[17px] rounded-full border-[3px] bg-card',
                  done && 'ring-halo border-accent bg-accent',
                  now && 'animate-route-pulse border-accent',
                  !done && !now && 'border-input',
                )}
              />
              <span
                className={cn(
                  'whitespace-nowrap text-center text-[10.5px] font-bold',
                  // .route .leg.done/.now .lbl del mockup: --cobalt-ink.
                  done || now ? 'text-accent-ink' : 'text-hint',
                )}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Zona de peligro del pedido montado a mano: eliminarlo DEL TODO (chat, fotos,
 * documentos y actividad). Con confirmacion explicita — no hay deshacer.
 */
function DeleteOrderZone({ order, onDeleted }: { order: OrderSummary; onDeleted?: () => void }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const del = useMutation({
    mutationFn: () => api.delete(`/v1/orders/${order.id}`),
    onSuccess: () => {
      toast.success(`Pedido ${order.externalId} eliminado`);
      setConfirming(false);
      onDeleted?.();
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['orders-pulse'] });
      qc.invalidateQueries({ queryKey: ['warehouses'] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'No se pudo eliminar el pedido'),
  });

  return (
    <section className="space-y-2.5">
      <SectionTitle icon={AlertTriangle} tone="destructive">
        Zona de peligro
      </SectionTitle>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-destructive/25 bg-destructive/[0.04] px-4 py-3.5">
        <p className="min-w-[min(100%,180px)] flex-1 text-[12.5px] text-muted-foreground">
          Este pedido fue montado a mano: puedes eliminarlo del todo.
        </p>
        {/* .btn-ghost del mockup, tintado de peligro (vive en la zona roja). */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setConfirming(true)}
          className="h-auto shrink-0 rounded-[11px] border-destructive/40 bg-card px-[18px] py-2.5 text-[13.5px] font-extrabold text-destructive shadow-none hover:border-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Eliminar pedido
        </Button>
      </div>

      {confirming && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="fixed inset-0 z-[120] flex items-center justify-center bg-scrim/55 p-4 backdrop-blur-[2px]"
              onClick={() => (del.isPending ? null : setConfirming(false))}
            >
              <div
                className="shadow-pop w-full max-w-sm rounded-2xl border border-border bg-card p-5"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                    <AlertTriangle className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-semibold leading-tight">
                      ¿Eliminar el pedido {order.externalId}?
                    </h3>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
                      Se perderá <b className="text-foreground">todo</b>: la conversación, las
                      fotos, los documentos y la actividad. Esta acción{' '}
                      <b className="text-foreground">no se puede deshacer</b>.
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  {/* .btn-ghost */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirming(false)}
                    disabled={del.isPending}
                    className="h-auto rounded-[11px] border-input bg-card px-[18px] py-2.5 text-[13.5px] font-extrabold text-muted-foreground shadow-none hover:border-accent hover:bg-card hover:text-accent"
                  >
                    Cancelar
                  </Button>
                  {/* Geometria del .btn-primary con el color y el halo de peligro. */}
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => del.mutate()}
                    loading={del.isPending}
                    className="h-auto rounded-[11px] px-[18px] py-2.5 text-[13.5px] font-extrabold shadow-[0_6px_18px_-6px_hsl(var(--destructive)/0.55),inset_0_1px_0_rgba(255,255,255,0.18)] transition-[transform,box-shadow,background] [transition-duration:120ms] hover:-translate-y-px hover:shadow-[0_10px_24px_-8px_hsl(var(--destructive)/0.6),inset_0_1px_0_rgba(255,255,255,0.18)]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Sí, eliminar
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
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
  const [pickerFor, setPickerFor] = useState<{ messageId: string; x: number; y: number } | null>(
    null,
  );
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
  // Camara como adjunto normal (staging), distinta de la foto IMEI/serial.
  const cameraRef = useRef<HTMLInputElement>(null);
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
  useEffect(
    () => () => {
      if (reconcileTimer.current) clearTimeout(reconcileTimer.current);
    },
    [],
  );

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
              caption: null,
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
    queryFn: () =>
      api.post<CatalogMatch[]>(`/v1/orders/${orderId}/catalog-lookup`, { codes: photoCodes }),
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
  useEffect(
    () => () => {
      if (jumpIdleTimer.current) clearTimeout(jumpIdleTimer.current);
    },
    [],
  );

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
    mutationFn: ({
      body,
      mentions,
      replyToId,
      mentionAll,
    }: {
      body: string;
      mentions: string[];
      replyToId?: string;
      mentionAll?: boolean;
    }) =>
      api.post<OrderMessage>(`/v1/orders/${orderId}/messages`, {
        body,
        mentions,
        ...(replyToId ? { replyToId } : {}),
        ...(mentionAll ? { mentionAll: true } : {}),
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
        caption: null,
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
    // Con adjuntos en staging, el texto viaja como CAPTION del ultimo adjunto
    // (estilo WhatsApp): UNA sola burbuja imagen+texto, que llega junta cuando
    // la imagen termina de subir. Sin adjuntos, mensaje de texto normal.
    if (staged.length > 0) {
      const toSend = staged;
      setStaged([]);
      toSend.forEach((sf, i) => {
        void sendAttachment(sf, i === toSend.length - 1 && body ? body : undefined);
      });
      setText('');
      setMention(null);
      setReplyTo(null);
    } else {
      if (!body) return;
      send.mutate({
        body,
        mentions: mentionsInText(body, members),
        replyToId: replyTo?.id,
        // "@todos" en el texto = SUPER MENCION (alerta a todo el equipo).
        mentionAll: /(^|\s)@todos(?=\s|$|[.,!?])/i.test(body),
      });
    }
    // El teclado NO se baja al enviar (como WhatsApp): el campo sigue enfocado.
    textareaRef.current?.focus();
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
                  ? {
                      ...r,
                      count: r.count - 1,
                      mine: false,
                      users: r.users.filter((u) => u !== myName),
                    }
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

  // SUPER MENCION: inserta "@todos " (alerta a todo el equipo al enviar).
  const pickMentionAll = () => {
    if (!mention) return;
    const before = text.slice(0, mention.start);
    const after = text.slice(mention.start + 1 + mention.query.length);
    const inserted = '@todos ';
    const next = `${before}${inserted}${after}`;
    setText(next);
    setMention(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        const pos = before.length + inserted.length;
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  };

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

  // Borrar mensajes de OTROS es moderacion: solo administradores (el gestor,
  // como cualquiera, borra los suyos).
  const canModerate = canModerateChat(me?.role);

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

  // "Camara": toma una foto que queda en la barra (staging), NO se envia sola.
  const pickCamera = () => {
    setAttachOpen(false);
    setTimeout(() => cameraRef.current?.click(), 0);
  };

  // ============ Adjuntos estilo Google Chat/WhatsApp ============
  // 1) Elegir de galeria / camara / archivo / pegar / arrastrar NO envia: el
  //    adjunto queda CARGADO en la barra (staging) y sale junto con el texto.
  // 2) Al enviar (y en Foto IMEI/serial, al tomar la foto), la burbuja aparece
  //    AL INSTANTE con la vista previa local; la subida y la IA corren "dentro"
  //    de esa burbuja (barra de progreso). Nunca hay un vacio en el chat.
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [pendingMsgs, setPendingMsgs] = useState<PendingMsg[]>([]);

  const stageFiles = useCallback((files: FileList | File[] | null) => {
    if (!files) return;
    const arr = Array.from(files).filter(Boolean);
    if (arr.length === 0) return;
    const items: StagedFile[] = arr.map((file) => ({
      id: crypto.randomUUID(),
      file,
      url: URL.createObjectURL(file),
    }));
    setStaged((s) => [...s, ...items].slice(0, 8));
    // Pre-comprimir imagenes YA (en segundo plano): al darle enviar, la subida
    // arranca sin esperar y la vista previa pesa poco (pinta instantaneo).
    for (const it of items) {
      if (!it.file.type.startsWith('image/')) continue;
      void compressImage(it.file)
        .then((compact) => {
          const compactUrl = URL.createObjectURL(compact);
          setStaged((s) => s.map((x) => (x.id === it.id ? { ...x, compact, compactUrl } : x)));
        })
        .catch(() => undefined);
    }
  }, []);

  const unstage = (id: string) =>
    setStaged((s) => {
      const found = s.find((x) => x.id === id);
      if (found) {
        URL.revokeObjectURL(found.url);
        if (found.compactUrl) URL.revokeObjectURL(found.compactUrl);
      }
      return s.filter((x) => x.id !== id);
    });

  const pushPending = useCallback((msg: PendingMsg) => {
    setPendingMsgs((p) => [...p, msg]);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  }, []);
  const bumpPending = (id: string, patch: Partial<PendingMsg>) =>
    setPendingMsgs((p) => p.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const removePending = (id: string) => setPendingMsgs((p) => p.filter((m) => m.id !== id));

  /** Mete el mensaje REAL del server directo a la cache (sin esperar refetch). */
  const injectReal = useCallback(
    (msg: OrderMessage) => {
      qc.setQueryData<OrderMessage[]>(['order-messages', orderId], (old = []) =>
        old.some((m) => m.id === msg.id) ? old : [...old, msg],
      );
    },
    [qc, orderId],
  );

  const tempBase = () => ({
    orderId,
    authorId: me?.id ?? '',
    authorName: me?.name ?? me?.email ?? '',
    caption: null as string | null,
    imeis: [] as string[],
    mentions: [] as string[],
    replyToId: null,
    reactions: [] as OrderMessage['reactions'],
    createdAt: new Date().toISOString(),
  });

  /** Adjunto normal: burbuja optimista + subida con progreso en la burbuja. */
  const sendAttachment = async (sf: StagedFile, caption?: string) => {
    const tempId = `temp-${sf.id}`;
    // Vista previa LIVIANA si la pre-compresion ya termino (decode al instante).
    const previewUrl = sf.compactUrl ?? sf.url;
    pushPending({
      ...tempBase(),
      id: tempId,
      kind: 'file',
      body: sf.file.name,
      caption: caption ?? null,
      attachmentUrl: previewUrl,
      attachmentMime: sf.file.type || 'application/octet-stream',
      progress: 0,
    });
    try {
      // Que la burbuja quede PINTADA antes de comprimir (si aun no lo esta).
      await nextPaint();
      const compact = sf.compact ?? (await compressImage(sf.file));
      const fd = new FormData();
      fd.append('file', compact, compact.name);
      if (caption) fd.append('caption', caption);
      const msg = await api.uploadWithProgress<OrderMessage>(
        `/v1/orders/${orderId}/attachment`,
        fd,
        (p) => bumpPending(tempId, { progress: p }),
      );
      // La preview LOCAL queda asociada al mensaje real: el <img> conserva el
      // mismo src (cero parpadeo al confirmar y en los refetch posteriores).
      localPreviews.set(msg.id, previewUrl);
      injectReal(msg);
      removePending(tempId);
      // Se conserva SOLO la preview que quedo en uso; la otra se libera.
      if (sf.compactUrl && sf.compactUrl !== previewUrl) URL.revokeObjectURL(sf.compactUrl);
      if (sf.url !== previewUrl) URL.revokeObjectURL(sf.url);
    } catch (err) {
      removePending(tempId);
      toast.error(err instanceof ApiError ? err.message : 'No se pudo subir el archivo');
      // Fallo: ninguna preview quedo en uso, liberar ambas.
      setTimeout(() => {
        URL.revokeObjectURL(sf.url);
        if (sf.compactUrl) URL.revokeObjectURL(sf.compactUrl);
      }, 1_000);
    }
  };

  /** Foto IMEI/serial: la burbuja sale YA; subida + lectura de IA, en el chat. */
  const sendDevicePhoto = async (file: File, kind: DevicePhotoKind) => {
    const localUrl = URL.createObjectURL(file);
    const tempId = `temp-${crypto.randomUUID()}`;
    pushPending({
      ...tempBase(),
      id: tempId,
      kind: kind === 'imei' ? 'imei_photo' : 'serial_photo',
      body: null,
      attachmentUrl: localUrl,
      attachmentMime: file.type || 'image/jpeg',
      progress: 0,
    });
    let compactUrl: string | null = null;
    try {
      // Que la burbuja quede PINTADA antes del trabajo pesado.
      await nextPaint();
      // Comprimir ANTES de subir: sube en una fraccion y la IA lee mas rapido.
      const compact = await compressImage(file);
      // Cambiar la preview a la version liviana: la foto cruda de camara puede
      // tardar segundos en decodificar; la comprimida pinta al toque.
      compactUrl = URL.createObjectURL(compact);
      bumpPending(tempId, { attachmentUrl: compactUrl });
      const fd = new FormData();
      fd.append('file', compact, compact.name);
      const res = await api.uploadWithProgress<DevicePhotoResponse>(
        `/v1/orders/${orderId}/device-photo?kind=${kind}`,
        fd,
        (p) => bumpPending(tempId, { progress: p }),
      );
      // El mensaje real conserva la preview LOCAL como src (cero parpadeo).
      localPreviews.set(res.message.id, compactUrl ?? localUrl);
      injectReal(res.message);
      removePending(tempId);
      toast.success(
        `${kind === 'imei' ? 'IMEI' : 'Serial'} detectado: ${res.message.imeis.join(', ')}`,
      );
      qc.invalidateQueries({ queryKey: ['catalog', orderId] });
      // Las lineas de facturar dependen de los codigos: refrescar el preview.
      qc.invalidateQueries({ queryKey: ['invoice-preview', orderId] });
      // Se conserva la preview en uso (compacta); la cruda se libera.
      if (compactUrl) URL.revokeObjectURL(localUrl);
    } catch (err) {
      removePending(tempId);
      toast.error(err instanceof ApiError ? err.message : 'No se pudo procesar la foto');
      setTimeout(() => {
        URL.revokeObjectURL(localUrl);
        if (compactUrl) URL.revokeObjectURL(compactUrl);
      }, 1_000);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onAttachmentFile = (files: FileList | null) => {
    stageFiles(files);
    if (attachRef.current) attachRef.current.value = '';
  };

  const onFile = (file: File | null) => {
    if (!file) return;
    void sendDevicePhoto(file, pendingKind.current);
  };

  // Mensajes del server + burbujas optimistas (siempre al final).
  const allMessages = useMemo(
    () => (pendingMsgs.length ? [...messages, ...pendingMsgs] : messages),
    [messages, pendingMsgs],
  );

  // Visor embebido: TODAS las imagenes de la conversacion, en orden, para
  // navegar con flechas dentro del lightbox.
  const gallery = useMemo<LightboxImage[]>(
    () =>
      allMessages
        .filter(
          (m) =>
            m.attachmentUrl &&
            (m.kind === 'imei_photo' ||
              m.kind === 'serial_photo' ||
              (m.kind === 'file' && (m.attachmentMime ?? '').startsWith('image/'))),
        )
        .map((m) => ({ url: m.attachmentUrl!, name: m.body, caption: m.caption })),
    [allMessages],
  );
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const openPreview = useCallback(
    (url: string) => {
      const i = gallery.findIndex((g) => g.url === url);
      if (i >= 0) setLightboxIndex(i);
    },
    [gallery],
  );

  return (
    <div
      className="relative flex h-full flex-col"
      // Arrastrar una imagen/video/archivo al chat -> queda en la barra.
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer?.files?.length) stageFiles(e.dataTransfer.files);
      }}
    >
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
        {isLoading && allMessages.length === 0 ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : allMessages.length === 0 ? (
          // OJO: allMessages (server + optimistas), NO messages. Con messages,
          // la PRIMERA foto de un chat vacio no pintaba su burbuja optimista
          // (el estado "sin mensajes" la tapaba hasta que llegaba la real).
          <div className="py-10 text-center">
            <MessageSquare className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              Sin mensajes todavía. Coordina aquí, menciona con @ y adjunta fotos, videos o archivos
              con el clip.
            </p>
          </div>
        ) : (
          allMessages.map((m, i) => {
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
            // Burbuja optimista (subiendo): sin acciones hasta confirmarse.
            const isTemp = m.id.startsWith('temp-');
            // El separador "No leidos" rompe el conjunto: ese mensaje muestra
            // su cabecera (nombre/hora) aunque viniera agrupado.
            const grouped = !isUnreadBoundary && joins(allMessages[i - 1], m);
            const groupedWithNext = joins(m, allMessages[i + 1]);
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
                  canDelete={
                    !isTemp && m.kind !== 'system' && (m.authorId === me?.id || canModerate)
                  }
                  onDelete={() => setConfirmDelete([m.id])}
                  onReply={
                    !isTemp && m.kind !== 'system'
                      ? () => {
                          setReplyTo(m);
                          closeActions();
                        }
                      : undefined
                  }
                  onReact={
                    !isTemp && m.kind !== 'system'
                      ? (e) => setPickerFor({ messageId: m.id, x: e.clientX, y: e.clientY })
                      : undefined
                  }
                  onToggleReaction={(emoji) => {
                    react.mutate({ messageId: m.id, emoji });
                    closeActions();
                  }}
                  onLongPress={
                    !isTemp && m.kind !== 'system' ? () => onBubbleLongPress(m) : undefined
                  }
                  actionsOpen={mobileActionsFor === m.id}
                  hoverActions={hoverCapable}
                  flash={flashId === m.id}
                  onDoubleTap={
                    !isTemp && m.kind === 'text'
                      ? () => react.mutate({ messageId: m.id, emoji: '👍' })
                      : undefined
                  }
                  onPreview={openPreview}
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

      {/* bg-card SOLIDO + safe-area: en iPhone no se ve la franja de atras
          entre la barra y el teclado; en celus sin barra de navegacion la
          barra no queda pegada al borde. Mas alto en cel. */}
      <div className="border-t border-border bg-card px-3 pb-[max(env(safe-area-inset-bottom),14px)] pt-3.5 md:p-3">
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
        {/* Adjuntos en STAGING: quedan cargados aqui (como Google Chat) y
            salen junto con el mensaje al enviar. X para quitarlos. */}
        {staged.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-2.5">
            {staged.map((s) => (
              <div key={s.id} className="relative">
                {s.file.type.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={s.compactUrl ?? s.url}
                    alt={s.file.name}
                    decoding="async"
                    className="h-20 w-20 rounded-xl border border-border bg-muted object-cover"
                  />
                ) : s.file.type.startsWith('video/') ? (
                  <video
                    src={s.url}
                    className="h-20 w-20 rounded-xl border border-border bg-black object-cover"
                  />
                ) : (
                  <div className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-xl border border-border bg-muted px-1.5 text-center">
                    <Paperclip className="h-4 w-4 text-muted-foreground" />
                    <span className="line-clamp-2 break-all text-[9px] leading-tight text-muted-foreground">
                      {s.file.name}
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => unstage(s.id)}
                  aria-label={`Quitar ${s.file.name}`}
                  className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-background shadow-md"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
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
              // Sin spinner aqui: el progreso vive en la burbuja del chat.
              // Se pueden adjuntar mas cosas mientras otras suben.
              aria-label="Adjuntar foto"
              className="h-10 w-10 rounded-full text-muted-foreground hover:text-foreground md:h-9 md:w-9"
            >
              <Paperclip className="h-[18px] w-[18px] md:h-4 md:w-4" />
            </Button>
            {attachOpen && isDesktop ? (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setAttachOpen(false)} />
                <div className="absolute bottom-full left-0 z-20 mb-2 w-52 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-lg">
                  <p className="px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Leer código
                  </p>
                  <AttachOption
                    icon={ScanBarcode}
                    label="Foto IMEI"
                    onClick={() => pickPhoto('imei')}
                  />
                  <AttachOption
                    icon={ScanLine}
                    label="Foto serial"
                    onClick={() => pickPhoto('serial')}
                  />
                  <div className="my-1 h-px bg-border" />
                  <p className="px-2 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Adjuntar
                  </p>
                  <AttachOption icon={Camera} label="Cámara" onClick={pickCamera} />
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
            {/* Cel: hoja inferior estilo Google Chat (opciones grandes). */}
            {attachOpen && !isDesktop && typeof document !== 'undefined'
              ? createPortal(
                  <div className="fixed inset-0 z-[75]">
                    <div
                      className="absolute inset-0 bg-scrim/50"
                      onClick={() => setAttachOpen(false)}
                    />
                    <div className="shadow-pop absolute inset-x-0 bottom-0 rounded-t-2xl bg-popover pb-[max(env(safe-area-inset-bottom),10px)] pt-2">
                      <div className="mx-auto mb-1.5 h-1.5 w-12 rounded-full bg-muted-foreground/25" />
                      <SheetOption
                        icon={ScanBarcode}
                        label="Foto IMEI"
                        hint="Toma la foto y la IA lee el código"
                        onClick={() => pickPhoto('imei')}
                      />
                      <SheetOption
                        icon={ScanLine}
                        label="Foto serial"
                        hint="Toma la foto y la IA lee el serial"
                        onClick={() => pickPhoto('serial')}
                      />
                      <div className="mx-5 my-1 h-px bg-border" />
                      <SheetOption icon={Camera} label="Cámara" onClick={pickCamera} />
                      <SheetOption
                        icon={ImageIcon}
                        label="Foto o video"
                        onClick={() => pickAttachment('image/*,video/*')}
                      />
                      <SheetOption
                        icon={Paperclip}
                        label="Archivo"
                        onClick={() => pickAttachment('*')}
                      />
                    </div>
                  </div>,
                  document.body,
                )
              : null}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          />
          {/* Camara como adjunto normal: la foto queda en la barra (staging). */}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              stageFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={attachRef}
            type="file"
            accept={attachAccept}
            multiple
            className="hidden"
            onChange={(e) => onAttachmentFile(e.target.files)}
          />
          <div className="relative flex-1">
            {mention &&
            (mentionMatches.length > 0 || 'todos'.startsWith(mention.query.toLowerCase())) ? (
              <div className="absolute bottom-full left-0 z-20 mb-2 w-64 max-w-full overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-lg">
                <p className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Mencionar
                </p>
                {/* SUPER MENCION: alerta modal + sonido a TODO el equipo. */}
                {'todos'.startsWith(mention.query.toLowerCase()) ? (
                  <button
                    type="button"
                    onClick={pickMentionAll}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-amber-500/10"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400">
                      <Megaphone className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">@todos</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        Súper mención: alerta a todo el equipo
                      </span>
                    </span>
                  </button>
                ) : null}
                {mentionMatches.map((m) => (
                  <button
                    key={m.userId}
                    type="button"
                    onClick={() => pickMention(m)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[11px] font-semibold text-accent-ink">
                      {initialsOf(mentionName(m))}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{mentionName(m)}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {m.email}
                      </span>
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
              // Pegar una imagen copiada (Ctrl+V): queda cargada en la barra.
              onPaste={(e) => {
                if (e.clipboardData?.files && e.clipboardData.files.length > 0) {
                  e.preventDefault();
                  stageFiles(e.clipboardData.files);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && mention) {
                  setMention(null);
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  // Con el dropdown abierto, Enter elige el primer miembro
                  // (o @todos si es lo unico que matchea).
                  const first = mentionMatches[0];
                  if (mention && first) {
                    e.preventDefault();
                    pickMention(first);
                    return;
                  }
                  if (mention && 'todos'.startsWith(mention.query.toLowerCase())) {
                    e.preventDefault();
                    pickMentionAll();
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
            // Que el boton no ROBE el foco del campo (bajaba el teclado en cel).
            onPointerDown={(e) => e.preventDefault()}
            disabled={!text.trim() && staged.length === 0}
            aria-label="Enviar"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground transition-[filter] hover:brightness-110 disabled:pointer-events-none disabled:opacity-40 md:h-9 md:w-9"
          >
            <Send className="h-[18px] w-[18px] md:h-4 md:w-4" />
          </button>
        </div>
      </div>

      {/* Visor de imagenes embebido (estilo Google) */}
      {lightboxIndex !== null ? (
        <ImageLightbox
          images={gallery}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      ) : null}

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

/** Barra de progreso de subida (dentro de la burbuja optimista). */
function UploadBar({ value, inverted = false }: { value?: number; inverted?: boolean }) {
  return (
    <div
      className={cn(
        'h-1 w-full overflow-hidden rounded-full',
        inverted ? 'bg-accent-foreground/25' : 'bg-muted-foreground/20',
      )}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-200',
          inverted ? 'bg-accent-foreground' : 'bg-accent',
        )}
        style={{ width: `${Math.min(100, Math.max(6, value ?? 6))}%` }}
      />
    </div>
  );
}

/** Fila grande de la hoja inferior de adjuntar (cel, estilo Google Chat). */
function SheetOption({
  icon: Icon,
  label,
  hint,
  onClick,
}: {
  icon: typeof Camera;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-4 px-5 py-3 text-left active:bg-muted"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-medium">{label}</span>
        {hint ? <span className="block text-[12px] text-muted-foreground">{hint}</span> : null}
      </span>
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
                : 'bg-accent/10 text-accent-ink',
            )}
          >
            {part.value}
          </span>
        ) : (
          // "@todos" (super mencion) se resalta con su chip ambar propio.
          part.value.split(/(@todos)/gi).map((piece, j) =>
            /^@todos$/i.test(piece) ? (
              <span
                key={`${i}-${j}`}
                className={cn(
                  'inline-block max-w-full truncate rounded-[5px] px-[5px] align-bottom font-semibold',
                  mine
                    ? 'bg-accent-foreground/25 text-accent-foreground'
                    : 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
                )}
              >
                📢 {piece}
              </span>
            ) : (
              <span key={`${i}-${j}`}>{piece}</span>
            ),
          )
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
  onPreview,
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
  /** Abre el visor embebido con esta imagen (lightbox). */
  onPreview?: (url: string) => void;
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
    <PhotoCard message={message} mine={mine} matchByCode={matchByCode} onPreview={onPreview} />
  ) : isDoc ? (
    <DocumentCard message={message} mine={mine} />
  ) : isFile ? (
    <AttachmentCard message={message} mine={mine} onPreview={onPreview} />
  ) : (
    <div
      className={cn(
        // En cel el texto va un punto mas grande (15px); en escritorio text-sm.
        'px-3.5 py-2 text-[16px] leading-[1.4] md:text-[13.5px] md:leading-[1.45]',
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
          los mensajes se estrechaban en cascada hasta cortarse.
          El tope duro (640px) evita que con el drawer arrastrado a pantalla
          completa una burbuja de texto cruce 1500px de ancho. */}
      <div className="relative max-w-[min(85%,640px)]">
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
                  aria-label="Más emojis"
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
                // Chips con tinte de acento, proporcionales al nuevo tamano de
                // mensaje (emoji legible sin lupa).
                'flex items-center gap-1 rounded-full border px-2.5 py-[3px] text-[14px] transition-all hover:-translate-y-px md:py-[2px] md:text-[12.5px]',
                r.mine
                  ? 'border-accent/60 bg-accent/15 text-accent-ink'
                  : 'border-accent/30 bg-accent/10 hover:border-accent/50',
              )}
            >
              <span className="text-[14px] leading-none md:text-[12.5px]">{r.emoji}</span>
              <span className="font-mono text-[12px] tabular-nums text-accent-ink md:text-[11px]">
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
function AttachmentCard({
  message,
  mine,
  onPreview,
}: {
  message: OrderMessage;
  mine: boolean;
  onPreview?: (url: string) => void;
}) {
  const url = message.attachmentUrl;
  // Para MEDIOS que yo acabo de subir: mantener la preview local como src
  // (misma imagen ya decodificada) — cambiar a la URL firmada parpadeaba.
  const displayUrl = localPreviews.get(message.id) ?? url;
  const mime = message.attachmentMime ?? '';
  const name = message.body ?? 'archivo';

  // TODOS los medios comparten el mismo ancho (230px, como la Foto IMEI): la
  // columna de adjuntos queda alineada y ordenada, nada de anchos dispares.
  const pending = message.id.startsWith('temp-');
  const progress = (message as PendingMsg).progress;
  // MISMO color que un mensaje normal: mia = cobalto con texto claro; de otro
  // = gris. La imagen va arriba y el texto (caption) debajo, una sola burbuja.
  const tone = mine
    ? 'rounded-br-sm border-transparent bg-accent text-accent-foreground'
    : 'rounded-bl-sm border-transparent bg-muted text-foreground';
  const caption = message.caption ? (
    <p className="whitespace-pre-wrap break-words px-3 py-2 text-[15px] leading-snug md:text-[13px]">
      {message.caption}
    </p>
  ) : null;

  if (url && mime.startsWith('image/')) {
    return (
      <div className={cn('w-[230px] max-w-full overflow-hidden rounded-[14px] border', tone)}>
        <a
          href={onPreview || pending ? undefined : url}
          target="_blank"
          rel="noreferrer"
          onClick={
            onPreview
              ? (e) => {
                  // Visor EMBEBIDO (lightbox), nada de abrir otra pestaña.
                  e.preventDefault();
                  e.stopPropagation();
                  onPreview(url);
                }
              : undefined
          }
          // bg-muted: las fotos blancas no se funden con el fondo blanco del chat.
          className={cn('relative block bg-muted', onPreview && 'cursor-zoom-in')}
          title={name}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={displayUrl ?? url}
            alt={name}
            decoding="async"
            className="h-auto max-h-64 w-full object-cover"
          />
          {pending ? (
            <span className="absolute inset-x-2.5 bottom-2.5">
              <UploadBar value={progress} />
            </span>
          ) : null}
        </a>
        {caption}
      </div>
    );
  }

  if (url && mime.startsWith('video/')) {
    return (
      <div className={cn('w-[230px] max-w-full overflow-hidden rounded-[14px] border', tone)}>
        <div className="bg-black">
          <video src={displayUrl ?? url} controls preload="metadata" className="max-h-64 w-full" />
          {pending ? (
            <div className="px-2.5 pb-2.5">
              <UploadBar value={progress} />
            </div>
          ) : null}
        </div>
        {caption}
      </div>
    );
  }

  // Cualquier otro archivo: tarjeta de descarga.
  const ext = (/\.([a-z0-9]{1,6})$/i.exec(name)?.[1] ?? 'file').toUpperCase();
  return (
    <div className={cn('w-[230px] max-w-full overflow-hidden rounded-[14px] border', tone)}>
      <a
        href={url ?? undefined}
        target="_blank"
        rel="noreferrer"
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 transition',
          url
            ? mine
              ? 'hover:brightness-110'
              : 'hover:bg-muted-foreground/10'
            : 'pointer-events-none opacity-70',
        )}
      >
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[9px] font-bold tracking-wide',
            mine
              ? 'bg-accent-foreground/20 text-accent-foreground'
              : 'bg-muted-foreground/15 text-muted-foreground',
          )}
        >
          {ext.slice(0, 4)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{name}</p>
          {pending ? (
            <div className="mt-1.5">
              <UploadBar value={progress} inverted={mine} />
            </div>
          ) : (
            <p
              className={cn(
                'text-[11px]',
                mine ? 'text-accent-foreground/70' : 'text-muted-foreground',
              )}
            >
              Toca para abrir
            </p>
          )}
        </div>
        {pending ? (
          <Loader2
            className={cn(
              'h-4 w-4 shrink-0 animate-spin',
              mine ? 'text-accent-foreground/80' : 'text-muted-foreground',
            )}
          />
        ) : (
          <Download
            className={cn(
              'h-4 w-4 shrink-0',
              mine ? 'text-accent-foreground/80' : 'text-muted-foreground',
            )}
          />
        )}
      </a>
      {caption}
    </div>
  );
}

function PhotoCard({
  message,
  mine = false,
  className,
  matchByCode,
  onPreview,
}: {
  message: OrderMessage;
  mine?: boolean;
  className?: string;
  matchByCode?: Map<string, CatalogMatch>;
  onPreview?: (url: string) => void;
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
        <a
          href={onPreview ? undefined : message.attachmentUrl}
          target="_blank"
          rel="noreferrer"
          onClick={
            onPreview
              ? (e) => {
                  // Visor EMBEBIDO (lightbox), nada de abrir otra pestaña.
                  e.preventDefault();
                  e.stopPropagation();
                  onPreview(message.attachmentUrl!);
                }
              : undefined
          }
          className={cn(onPreview && 'cursor-zoom-in')}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            // Recien subida por mi: conservar la preview local (cero parpadeo).
            src={localPreviews.get(message.id) ?? message.attachmentUrl}
            alt={isSerial ? 'Foto serial' : 'Foto IMEI'}
            decoding="async"
            className="h-[140px] w-full bg-muted object-cover md:h-[120px]"
          />
        </a>
      ) : null}
      <div className="space-y-2 p-2.5">
        <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {isSerial ? <ScanLine className="h-3 w-3" /> : <Camera className="h-3 w-3" />}
          {isSerial ? 'Foto serial' : 'Foto IMEI'}
        </p>
        {message.id.startsWith('temp-') ? (
          // Burbuja optimista: la subida y la lectura de IA corren AQUI.
          <div className="space-y-1.5">
            <UploadBar value={(message as PendingMsg).progress} />
            <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground md:text-[11px]">
              <Loader2 className="h-3 w-3 animate-spin" />
              {((message as PendingMsg).progress ?? 0) < 100
                ? 'Subiendo foto…'
                : 'Leyendo códigos con IA…'}
            </p>
          </div>
        ) : (
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
        )}
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
          <p className="text-[12px] text-muted-foreground md:text-[11px]">
            Sin coincidencia en compras
          </p>
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

  // Mismo cargando que Facturar/Guía (spinner de 20px en tinte --hint).
  if (isLoading) {
    return (
      <div className="flex justify-center py-14">
        <Loader2 className="h-5 w-5 animate-spin text-hint motion-reduce:animate-none" />
      </div>
    );
  }
  if (events.length === 0) {
    return (
      <div className="space-y-2.5 p-[22px]">
        <SectionTitle icon={Activity} hint="registro del pedido">
          Actividad
        </SectionTitle>
        <div className="rounded-[14px] border border-border bg-surface px-4 py-10 text-center">
          <Activity className="mx-auto h-6 w-6 text-hint" />
          <p className="mt-2 text-[13.5px] text-muted-foreground">Sin actividad registrada.</p>
        </div>
      </div>
    );
  }

  return (
    /* Mismo lenguaje Cobalto que Detalle: encabezado de sección + tarjeta, y
       cada hito con su chip de lavado cobalto unido por el riel (.step). */
    <div className="space-y-2.5 p-[22px]">
      <SectionTitle
        icon={Activity}
        hint={events.length > 1 ? `${events.length} movimientos` : undefined}
      >
        Actividad
      </SectionTitle>
      <ol className="rounded-[14px] border border-border bg-surface px-4 py-3.5">
        {events.map((e) => (
          <li key={e.id} className="group flex gap-3.5">
            <div className="flex flex-col items-center">
              <span className="grid h-[28px] w-[28px] shrink-0 place-items-center rounded-[9px] bg-wash text-accent-ink">
                <EventIcon type={e.type} />
              </span>
              {/* Riel entre hitos: se corta en el último. */}
              <span
                aria-hidden
                className="my-1 w-[2px] flex-1 rounded-[1px] bg-input group-last:hidden"
              />
            </div>
            <div className="min-w-0 pb-4 pt-[5px] group-last:pb-0">
              <p className="min-w-0 break-words text-[13.5px] font-semibold leading-snug">
                {describeEvent(e)}
              </p>
              {/* SIEMPRE quien lo hizo: persona, o Sistema/VTEX si fue automatico. */}
              <p className="mt-1 min-w-0 break-words text-[11.5px] tabular-nums text-hint">
                <span className="font-bold">
                  {e.actorName ?? (e.type === 'created' ? 'VTEX' : 'Sistema')}
                </span>
                {' · '}
                {format(new Date(e.createdAt), "d MMM yyyy '·' HH:mm", { locale: es })}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
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
  if (type === 'vtex_invoiced' || type === 'vtex_invoiced_external' || type === 'manual_completed')
    return <ReceiptText className={cls} />;
  if (type === 'wa_confirmation') return <MessageCircle className={cls} />;
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
      // Los pedidos MONTADOS a mano nacen dentro de SmartLogistica (no de VTEX).
      return e.data.manual === true
        ? 'Pedido montado a mano (externo a las plataformas)'
        : 'Pedido recibido';
    case 'invoiced':
      return `Factura ${(e.data.number as string | undefined) ?? ''} emitida en Alegra`.trim();
    case 'guide_generated': {
      const number = (e.data.number as string | undefined) ?? '';
      // El evento es el mismo para las tres formas de despachar; `via` dice
      // cual fue (null = legado, es decir Coordinadora). Sin esto un domicilio
      // quedaba en la bitacora como "generada en Coordinadora", que es falso.
      if (e.data.via === 'domicilio') {
        return `Soporte de entrega ${number} emitido · domicilio propio`.trim();
      }
      const carrier =
        e.data.via === 'skydropx'
          ? ((e.data.carrier as string | undefined) ?? 'Skydropx')
          : 'Coordinadora';
      const base = `Guía ${number} generada en ${carrier}`.trim();
      return typeof e.data.cod === 'number' && e.data.cod > 0
        ? `${base} · con recaudo contraentrega`
        : base;
    }
    case 'vtex_invoiced':
      return `Facturado en VTEX · MKT ${(e.data.invoiceNumber as string | undefined) ?? ''}`.trim();
    case 'vtex_invoiced_external':
      return 'Facturado POR FUERA de SmartLogística (cerrado directamente en VTEX)';
    case 'manual_completed':
      return `Pedido completado · Factura ${(e.data.invoiceNumber as string | undefined) ?? ''} + guía ${(e.data.tracking as string | undefined) ?? ''} (sin MKT)`.trim();
    case 'wa_confirmation':
      return 'Confirmación del pedido enviada por WhatsApp';
    case 'wa_confirmation_failed':
      return `La confirmación de WhatsApp NO se entregó (Meta: ${(e.data.error as string | undefined) ?? 'bloqueo de entrega'})`;
    case 'wa_guide':
      return 'Guía enviada al cliente por WhatsApp 📲';
    case 'wa_guide_failed':
      return `La guía NO se entregó por WhatsApp (Meta: ${(e.data.error as string | undefined) ?? 'bloqueo de entrega'})`;
    default:
      return e.type;
  }
}

// === UI helpers ===

/**
 * Encabezado de sección estilo Cobalto (.sec-h): chip de icono tintado +
 * título en negrilla + nota opcional a la derecha. Sin icono conserva la
 * versión compacta (label en mayúsculas).
 */
function SectionTitle({
  icon: Icon,
  tone = 'accent',
  hint,
  children,
}: {
  icon?: typeof Mail;
  tone?: 'accent' | 'success' | 'destructive';
  /** Nota al final de la fila (.sec-h .hint): de dónde salen los datos. */
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (!Icon) {
    return (
      <h3 className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
        {children}
      </h3>
    );
  }
  return (
    /* flex-wrap: en un panel angosto la pista salta a su propia linea en vez de
       estrujar (o desbordar) el titulo. */
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <span
        className={cn(
          'grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px]',
          tone === 'accent' && 'bg-wash text-accent',
          tone === 'success' && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
          tone === 'destructive' && 'bg-destructive/10 text-destructive',
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <h3 className="min-w-0 break-words text-sm font-extrabold tracking-[-0.01em]">{children}</h3>
      {hint ? (
        <span className="ml-auto min-w-0 break-words text-right text-xs text-hint">{hint}</span>
      ) : null}
    </div>
  );
}

function InfoRow({
  label,
  value,
  placeholder,
  pill,
}: {
  label: string;
  value: string | null | undefined;
  placeholder: string;
  /** Pastilla de estado pegada al dato (.kv dd .pill del mockup). */
  pill?: React.ReactNode;
}) {
  return (
    <>
      <dt className="min-w-0 self-start break-words font-semibold text-hint">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-2 break-words font-semibold">
        {value ? value : <span className="font-normal text-muted-foreground">{placeholder}</span>}
        {pill}
      </dd>
    </>
  );
}

const STATUS_LABELS: Record<
  string,
  { label: string; variant: 'warning' | 'success' | 'secondary' }
> = {
  'ready-for-handling': { label: 'Listo para preparar', variant: 'warning' },
  handling: { label: 'Preparando', variant: 'success' },
  invoiced: { label: 'Facturado', variant: 'secondary' },
  'window-to-cancel': { label: 'En ventana de cancelación', variant: 'secondary' },
  canceled: { label: 'Cancelado', variant: 'secondary' },
};

function StatusPill({ status }: { status: string }) {
  const mapped = STATUS_LABELS[status];
  const variant = mapped?.variant ?? 'secondary';
  // "Facturado" es el estado de envío en curso: tinte cobalto con puntico.
  const shipping = status === 'invoiced';
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-[5px] whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11.5px] font-bold tracking-[0.01em]',
        variant === 'warning' && 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
        variant === 'success' && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
        variant === 'secondary' &&
          // .pill-ship del mockup: lavado cobalto + texto --cobalt-ink.
          (shipping ? 'bg-wash text-accent-ink' : 'bg-muted text-muted-foreground'),
      )}
    >
      {shipping ? <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden /> : null}
      {mapped?.label ?? status}
    </span>
  );
}

/**
 * Precio UNITARIO del producto con el neto de VTEX desplegable: un toque
 * muestra debajo, entre parentesis, lo que de verdad queda tras la comision
 * del marketplace + su IVA + el valor fijo (todo configurable en Ajustes).
 * Antes esto vivia en la columna Precio de la tabla; ahi el clic ahora solo
 * abre el pedido, y el neto quedo donde se mira el producto — y por linea,
 * que es lo util cuando el pedido trae varios.
 */
function UnitPrice({
  unitPrice,
  quantity,
  currency,
  fees,
}: {
  unitPrice: string;
  quantity: number;
  currency: string;
  /** null = el pedido no es de VTEX: no hay comision que descontar. */
  fees: VtexFees | null;
}) {
  const [open, setOpen] = useState(false);
  const line = (
    <>
      {quantity} &times; {formatCurrency(unitPrice, currency)}
    </>
  );
  if (!fees) return <p className="text-[11px] tabular-nums text-hint">{line}</p>;

  const net = vtexNetValue(Number(unitPrice) || 0, fees);
  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      title={`Ver neto tras comisión ${fees.commissionPct}% + IVA ${fees.vatPct}% de la comisión + ${formatCurrency(String(fees.fixed), currency)} (configurable en Ajustes)`}
      aria-expanded={open}
      className={cn(
        'block rounded-[5px] text-right text-[11px] tabular-nums text-hint transition-colors [transition-duration:140ms] hover:text-accent-ink',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
      )}
    >
      <span className={cn(open && 'underline decoration-dotted underline-offset-2')}>{line}</span>
      {open ? (
        <span className="block text-[11px] text-muted-foreground">
          neto {formatCurrency(String(net), currency)} c/u
        </span>
      ) : null}
    </button>
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
