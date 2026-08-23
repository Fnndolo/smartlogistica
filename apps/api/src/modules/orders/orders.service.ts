import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isAxiosError } from 'axios';
import type {
  AlegraItem,
  AlegraPaymentAccount,
  AssignOrdersInput,
  CatalogMatch,
  CreateInvoiceInput,
  CoordinadoraCity,
  CreateGuideInput,
  CreateSkydropxGuideInput,
  SkydropxQuoteInput,
  SkydropxQuoteResponse,
  CreateManualOrderInput,
  CreateOrderMessageInput,
  DevicePhotoKind,
  DevicePhotoResponse,
  ExistingInvoice,
  Guide,
  GuidePreview,
  GuideTracking,
  InvoicePreview,
  InvoiceResult,
  ListOrdersQuery,
  ListOrdersResponse,
  OrderDetail,
  OrderEvent as OrderEventDto,
  OrderMessage as OrderMessageDto,
  OrderSummary,
  OrdersPulse,
  SuperMentionAlert as SuperMentionAlertDto,
  ProcessAllInput,
  ProcessAllResult,
  Inbox,
  InboxItem,
  MentionItem,
  OrderSearchResult,
} from '@smartlogistica/shared';
import type { Prisma } from '.prisma/tenant-client';

import { isAdmin } from '../../common/rbac';
import type { AuthContext } from '../../common/types/authenticated-request';
import { getTenantContext } from '../../infrastructure/tenant-context';
import { ControlPlaneService } from '../../infrastructure/prisma/control-plane.service';
import { PushService } from '../../infrastructure/push/push.service';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service';
import { CatalogService } from '../../infrastructure/catalog/catalog.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { AiConnectionService } from '../ai/ai-connection.service';
import { type ImageMime } from '../ai/ai-vision-client.service';
import { AlegraService, type InvoiceClient } from '../marketplaces/alegra/alegra.service';
import { WarrantyService } from '../marketplaces/alegra/warranty.service';
import { CoordinadoraService, postalCodeByCity } from '../marketplaces/coordinadora/coordinadora.service';
import type { RastreoResult } from '../marketplaces/coordinadora/coordinadora-client.service';
import { MktDocumentService } from '../marketplaces/vtex/mkt-document.service';
import { VtexClient } from '../marketplaces/vtex/vtex-client.service';
import { SkydropxService } from '../marketplaces/skydropx/skydropx.service';
import { WaUpsellService } from '../whatsapp/wa-upsell.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import { loadPlatforms } from './platforms.store';

const IMAGE_EXT: Record<ImageMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/**
 * Eventos que marcan un pedido como FINALIZADO (pasa a "Facturados" de la sede):
 * - vtex_invoiced: cerrado en VTEX (guia + MKT + factura VTEX), pedidos de marketplace.
 * - manual_completed: pedido MONTADO a mano completado (factura + guia; sin VTEX ni MKT).
 */
const FINALIZED_EVENTS = ['vtex_invoiced', 'manual_completed'];

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;
type OrderMessageRow = Prisma.OrderMessageGetPayload<Record<string, never>>;
type OrderEventRow = Prisma.OrderEventGetPayload<Record<string, never>>;
type MessageReactionRow = Prisma.MessageReactionGetPayload<Record<string, never>>;

/** Nombre visible del usuario para chat/actividad (cae al correo si no tiene). */
function displayName(auth: AuthContext): string {
  return auth.name?.trim() || auth.email;
}

/** Filas de reaccion -> resumen por emoji (conteo, si el viewer reacciono, quienes). */
function groupReactions(
  rows: MessageReactionRow[],
  viewerId: string | undefined,
): OrderMessageDto['reactions'] {
  if (rows.length === 0) return [];
  const byEmoji = new Map<string, { count: number; mine: boolean; users: string[] }>();
  for (const r of rows) {
    const g = byEmoji.get(r.emoji) ?? { count: 0, mine: false, users: [] };
    g.count += 1;
    if (r.userId === viewerId) g.mine = true;
    if (g.users.length < 12) g.users.push(r.userName);
    byEmoji.set(r.emoji, g);
  }
  return [...byEmoji.entries()].map(([emoji, g]) => ({ emoji, ...g }));
}

/** No leidos de un pedido: total + si me mencionan + ultimo mensaje (preview). */
interface UnreadInfo {
  count: number;
  mentioned: boolean;
  lastAt: Date;
  preview: string;
  lastAuthor: string;
}

@Injectable()
export class OrdersService {
  /**
   * Candado en memoria contra dobles operaciones: dos clicks seguidos a
   * "Facturar" (o dos pestañas) creaban DOS facturas porque ambas requests
   * pasaban el chequeo de existingInvoice antes de que la primera terminara.
   */
  private readonly opLocks = new Set<string>();
  // Veredictos de la IA "producto de la compra vs pedido" (por linea, evita
  // re-pagar el LLM en cada refetch del preview).
  private readonly productMatchCache = new Map<
    string,
    { expected: string; found: string; note: string } | null
  >();

  private acquireLock(key: string, busyMessage: string): void {
    if (this.opLocks.has(key)) throw new ConflictException(busyMessage);
    this.opLocks.add(key);
  }

  constructor(
    private readonly realtime: RealtimeService,
    private readonly push: PushService,
    private readonly warehouses: WarehousesService,
    private readonly storage: StorageService,
    private readonly ai: AiConnectionService,
    private readonly catalog: CatalogService,
    private readonly alegra: AlegraService,
    private readonly warranty: WarrantyService,
    private readonly coordinadora: CoordinadoraService,
    private readonly vtex: VtexClient,
    private readonly mkt: MktDocumentService,
    private readonly control: ControlPlaneService,
    private readonly whatsapp: WhatsappService,
    private readonly upsell: WaUpsellService,
    private readonly skydropx: SkydropxService,
  ) {}

  async list(query: ListOrdersQuery, auth: AuthContext): Promise<ListOrdersResponse> {
    const { prisma } = getTenantContext();

    const where: Prisma.OrderWhereInput = {};

    if (query.warehouse) {
      // Vista de una sede: el operador debe tener acceso a ella.
      const allowed = await this.warehouses.accessibleWarehouseIds(auth);
      if (allowed && !allowed.includes(query.warehouse)) {
        throw new ForbiddenException('Sin acceso a esta sede');
      }
      where.warehouseId = query.warehouse;
      // En la sede mostramos todos los pedidos asignados (ya no son espejo de VTEX).
    } else {
      // Pedidos generales (sin asignar). Solo admins.
      if (!isAdmin(auth)) throw new ForbiddenException('Sin acceso a pedidos generales');
      where.warehouseId = null;
      if (query.state === 'invoiced') {
        // Trazabilidad TOTAL de lo que se procesa POR FUERA de SmartLogistica:
        // TODO pedido sin asignar que avanzo mas alla de ready-for-handling
        // (handling, invoiced, lo que sea) vive aqui — nada se borra.
        where.status = { not: 'ready-for-handling' };
      } else {
        // Espejo de VTEX en ready-for-handling.
        where.status = 'ready-for-handling';
      }
    }

    // Etapa (solo en sede): un pedido pasa a "Facturados" cuando se FINALIZA
    // (vtex_invoiced para marketplace; manual_completed para montados a mano),
    // NO con solo facturar en Alegra. Asi, un pedido facturado en Alegra pero
    // sin guia sigue en "Por preparar" hasta completar el flujo.
    if (query.warehouse && query.state) {
      where.events =
        query.state === 'invoiced'
          ? { some: { type: { in: FINALIZED_EVENTS } } }
          : { none: { type: { in: FINALIZED_EVENTS } } };
    }

    // Filtro por estado del envio (Facturados). 'sin_movimientos' incluye los que
    // aun no se han rastreado (shippingState null). Se usa AND para no chocar con
    // el OR de la busqueda (q).
    if (query.warehouse && query.shipping) {
      if (query.shipping === 'sin_movimientos') {
        where.AND = [{ OR: [{ shippingState: 'sin_movimientos' }, { shippingState: null }] }];
      } else {
        where.shippingState = query.shipping;
      }
    }

    // Filtro por confirmacion de direccion (WhatsApp). Aplica en General y Por
    // preparar (no en Facturados). Multiselect: "confirmed,pending" -> OR de
    // estados; 'pending' = el cliente aun no responde (null). Va dentro de AND
    // para no chocar con el OR de la busqueda (q).
    if (query.address && query.state !== 'invoiced') {
      const parts = new Set(query.address.split(','));
      const statuses = [...parts].filter((p) => p !== 'pending');
      const or: Prisma.OrderWhereInput[] = [];
      if (statuses.length > 0) or.push({ addressStatus: { in: statuses } });
      if (parts.has('pending')) or.push({ addressStatus: null });
      if (or.length > 0) {
        where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), { OR: or }];
      }
    }

    // Filtro por PRODUCTO. Va en AND para no chocar con el OR de la busqueda (q).
    if (query.product) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        { items: { some: { name: { contains: query.product, mode: 'insensitive' } } } },
      ];
    }

    if (query.from || query.to) {
      where.marketplaceCreatedAt = {};
      if (query.from) (where.marketplaceCreatedAt as Prisma.DateTimeFilter).gte = new Date(query.from);
      if (query.to) (where.marketplaceCreatedAt as Prisma.DateTimeFilter).lte = new Date(query.to);
    }
    if (query.q) {
      const q = query.q;
      where.OR = this.searchConditions(q);
    }

    const orderBy = this.buildOrderBy(query.sort, query.dir);
    const skip = (query.page - 1) * query.limit;

    const [rows, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy,
        skip,
        take: query.limit,
        include: { items: { orderBy: { name: 'asc' } } },
      }),
      prisma.order.count({ where }),
    ]);

    // Que pedidos de esta pagina ya tienen foto IMEI/serial (indicador en la tabla)
    // + mensajes sin leer por pedido (badge) + reacciones agregadas por pedido
    // + estado del MENSAJE de confirmacion de WhatsApp (enviado / sin enviar).
    const ids = rows.map((r) => r.id);
    const [withPhoto, unread, reactions, waSent, waConn] =
      rows.length === 0
        ? [
            new Set<string>(),
            new Map<string, UnreadInfo>(),
            new Map<string, OrderSummary['reactions']>(),
            new Set<string>(),
            { d360: null } as { d360: { createdAt: Date; mode: string } | null },
          ]
        : await Promise.all([
            prisma.orderMessage
              .groupBy({
                by: ['orderId'],
                where: { orderId: { in: ids }, kind: { in: ['imei_photo', 'serial_photo'] } },
              })
              .then((g) => new Set(g.map((x) => x.orderId))),
            this.unreadMap(auth.userId, { orderIds: ids }),
            this.reactionsMap(ids, auth.userId),
            prisma.orderEvent
              .findMany({
                where: { orderId: { in: ids }, type: 'wa_confirmation' },
                select: { orderId: true },
                distinct: ['orderId'],
              })
              .then((g) => new Set(g.map((x) => x.orderId))),
            // Conexion de WhatsApp (360dialog, con su modo).
            prisma.dialog360Connection
              .findFirst({ select: { createdAt: true, mode: true } })
              .then((d360) => ({ d360 })),
          ]);

    // 'unsent' SOLO desde que la PLATAFORMA esta a cargo de las confirmaciones
    // (los pedidos de la era n8n no tienen evento aca aunque SI se les envio).
    // El corte es la fecha de la conexion Whapify original (ya purgada): desde
    // ahi todo pedido sin evento realmente quedo sin mensaje.
    // El SANDBOX solo gobierna pedidos MONTADOS a mano (los de ensayo).
    const WA_CONFIRMATION_SINCE = new Date('2026-08-14T01:32:33Z');
    const waStateOf = (o: OrderWithItems): OrderSummary['waConfirmation'] => {
      if (!o.customerPhone) return null;
      if (o.provider !== 'vtex' && o.provider !== 'manual') return null;
      const governs = waConn.d360 && (o.provider === 'manual' || waConn.d360.mode === 'production');
      if (!governs) return null;
      if (waSent.has(o.id)) return 'sent';
      const since =
        waConn.d360!.createdAt < WA_CONFIRMATION_SINCE ? waConn.d360!.createdAt : WA_CONFIRMATION_SINCE;
      return o.status === 'ready-for-handling' && o.marketplaceCreatedAt >= since ? 'unsent' : null;
    };

    return {
      items: rows.map((o) =>
        this.toSummary(
          o,
          withPhoto.has(o.id),
          unread.get(o.id)?.count ?? 0,
          auth.userId,
          reactions.get(o.id) ?? [],
          waStateOf(o),
        ),
      ),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  /**
   * Nombres de producto DISTINTOS de la vista actual (sugerencias del filtro
   * "Producto"). Mismo scope que list(): seguridad (sede/generales) Y etapa
   * (Por preparar vs Facturados) — sugerir un producto que en esa pestaña da
   * 0 resultados solo confunde.
   */
  async productOptions(
    warehouseId: string | null,
    state: 'pending' | 'invoiced',
    q: string,
    auth: AuthContext,
  ): Promise<string[]> {
    const { prisma } = getTenantContext();
    if (warehouseId) {
      const allowed = await this.warehouses.accessibleWarehouseIds(auth);
      if (allowed && !allowed.includes(warehouseId)) {
        throw new ForbiddenException('Sin acceso a esta sede');
      }
    } else if (!isAdmin(auth)) {
      throw new ForbiddenException('Sin acceso a pedidos generales');
    }

    const orderWhere: Prisma.OrderWhereInput = warehouseId
      ? {
          warehouseId,
          events:
            state === 'invoiced'
              ? { some: { type: { in: FINALIZED_EVENTS } } }
              : { none: { type: { in: FINALIZED_EVENTS } } },
        }
      : {
          warehouseId: null,
          status: state === 'invoiced' ? { not: 'ready-for-handling' } : 'ready-for-handling',
        };

    // groupBy, NO findMany+distinct: sin el preview nativeDistinct, Prisma
    // deduplica `distinct` EN MEMORIA y el take no limita el SQL (traeria
    // TODOS los items del scope en cada tecla). groupBy si empuja
    // GROUP BY + LIMIT a Postgres.
    const rows = await prisma.orderItem.groupBy({
      by: ['name'],
      where: {
        ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
        order: orderWhere,
      },
      orderBy: { name: 'asc' },
      take: 20,
    });
    return rows.map((r) => r.name);
  }

  /** Reacciones por pedido, agregadas: [{emoji, count, mine}] en orden de llegada. */
  private async reactionsMap(
    orderIds: string[],
    viewerId: string,
  ): Promise<Map<string, OrderSummary['reactions']>> {
    const { prisma } = getTenantContext();
    const rows = await prisma.orderReaction.findMany({
      where: { orderId: { in: orderIds } },
      orderBy: { createdAt: 'asc' },
      select: { orderId: true, emoji: true, userId: true },
    });
    const out = new Map<string, OrderSummary['reactions']>();
    for (const r of rows) {
      const list = out.get(r.orderId) ?? [];
      if (!out.has(r.orderId)) out.set(r.orderId, list);
      const agg = list.find((x) => x.emoji === r.emoji);
      if (agg) {
        agg.count += 1;
        if (r.userId === viewerId) agg.mine = true;
      } else {
        list.push({ emoji: r.emoji, count: 1, mine: r.userId === viewerId });
      }
    }
    return out;
  }

  /** "Tomar pedido": queda a cargo de quien lo toma; nadie mas puede tomarlo. */
  async claimOrder(orderId: string, auth: AuthContext): Promise<{ ok: true }> {
    await this.loadAccessibleOrder(orderId, auth);
    const { tenantId, prisma } = getTenantContext();
    const name = displayName(auth);
    // Guard atomico: solo si esta libre (dos clicks a la vez -> uno gana).
    const res = await prisma.order.updateMany({
      where: { id: orderId, claimedById: null },
      data: { claimedById: auth.userId, claimedByName: name, claimedAt: new Date() },
    });
    if (res.count === 0) {
      const cur = await prisma.order.findUnique({
        where: { id: orderId },
        select: { claimedById: true, claimedByName: true },
      });
      if (cur?.claimedById === auth.userId) return { ok: true }; // ya era mio
      throw new ConflictException(`Ya lo tomó ${cur?.claimedByName ?? 'otra persona'}`);
    }
    await prisma.orderEvent.create({
      data: { orderId, type: 'claimed', actorId: auth.userId, actorName: name },
    });
    await this.realtime.publish(tenantId, { kind: 'orders.refresh' });
    return { ok: true };
  }

  /** Soltar un pedido tomado. Solo quien lo tomo (o un admin, por si acaso). */
  async unclaimOrder(orderId: string, auth: AuthContext): Promise<{ ok: true }> {
    const order = await this.loadAccessibleOrder(orderId, auth);
    const { tenantId, prisma } = getTenantContext();
    if (!order.claimedById) return { ok: true };
    if (order.claimedById !== auth.userId && !isAdmin(auth)) {
      throw new ForbiddenException(`Solo ${order.claimedByName ?? 'quien lo tomó'} puede soltarlo`);
    }
    await prisma.order.update({
      where: { id: orderId },
      data: { claimedById: null, claimedByName: null, claimedAt: null },
    });
    await prisma.orderEvent.create({
      data: { orderId, type: 'unclaimed', actorId: auth.userId, actorName: displayName(auth) },
    });
    await this.realtime.publish(tenantId, { kind: 'orders.refresh' });
    return { ok: true };
  }

  /** Reaccion al PEDIDO (toggle, como en los mensajes): cualquiera puede. */
  async toggleOrderReaction(
    orderId: string,
    emoji: string,
    auth: AuthContext,
  ): Promise<{ removed: boolean }> {
    await this.loadAccessibleOrder(orderId, auth);
    const { tenantId, prisma } = getTenantContext();
    const key = { orderId, userId: auth.userId, emoji };
    const existing = await prisma.orderReaction.findUnique({
      where: { orderId_userId_emoji: key },
    });
    if (existing) {
      await prisma.orderReaction.delete({ where: { id: existing.id } });
    } else {
      await prisma.orderReaction.create({ data: { ...key, userName: displayName(auth) } });
    }
    await this.realtime.publish(tenantId, { kind: 'orders.refresh' });
    return { removed: Boolean(existing) };
  }

  /**
   * "Pulso" de la vista: 4 metricas segun donde estes (generales / por
   * preparar de una sede / facturados de una sede).
   */
  async pulse(
    scope: 'general' | 'pending' | 'invoiced',
    warehouseId: string | null,
    auth: AuthContext,
  ): Promise<OrdersPulse> {
    const { prisma } = getTenantContext();

    if (scope === 'general') {
      if (!isAdmin(auth)) throw new ForbiddenException('Solo administradores');
      // "Hoy" en horario de Colombia (GMT-5, sin DST).
      const now = new Date();
      const bogota = new Date(now.getTime() - 5 * 3_600_000);
      const startToday = new Date(
        Date.UTC(bogota.getUTCFullYear(), bogota.getUTCMonth(), bogota.getUTCDate(), 5, 0, 0),
      );
      const startYesterday = new Date(startToday.getTime() - 24 * 3_600_000);
      // OJO: la vista de generales es el espejo en 'ready-for-handling'. Los
      // facturados POR FUERA (status invoiced, trazabilidad) tambien tienen
      // warehouseId null — sin el filtro de status inflaban "sin asignar" a
      // miles cuando la tabla mostraba unos cientos.
      const mirror = { warehouseId: null, status: 'ready-for-handling' } as const;
      const [today, yesterday, unassigned, addrPending, unclaimed] = await Promise.all([
        prisma.order.count({ where: { marketplaceCreatedAt: { gte: startToday } } }),
        prisma.order.count({
          where: { marketplaceCreatedAt: { gte: startYesterday, lt: startToday } },
        }),
        prisma.order.count({ where: mirror }),
        prisma.order.count({ where: { ...mirror, addressStatus: null } }),
        prisma.order.count({ where: { ...mirror, claimedById: null } }),
      ]);
      return { scope, a: today, b: unassigned, c: addrPending, d: unclaimed, deltaToday: today - yesterday };
    }

    if (!warehouseId) throw new BadRequestException('Falta la sede');
    const allowed = await this.warehouses.accessibleWarehouseIds(auth);
    if (allowed && !allowed.includes(warehouseId)) {
      throw new ForbiddenException('No tienes acceso a esta sede');
    }

    if (scope === 'pending') {
      const base: Prisma.OrderWhereInput = {
        warehouseId,
        events: { none: { type: { in: FINALIZED_EVENTS } } },
      };
      const [total, withPhoto, addrPending, unclaimed] = await Promise.all([
        prisma.order.count({ where: base }),
        prisma.order.count({
          where: { ...base, messages: { some: { kind: { in: ['imei_photo', 'serial_photo'] } } } },
        }),
        prisma.order.count({ where: { ...base, addressStatus: null } }),
        prisma.order.count({ where: { ...base, claimedById: null } }),
      ]);
      return { scope, a: total, b: withPhoto, c: addrPending, d: unclaimed, deltaToday: null };
    }

    const base: Prisma.OrderWhereInput = {
      warehouseId,
      events: { some: { type: { in: FINALIZED_EVENTS } } },
    };
    const [total, transit, issues, delivered] = await Promise.all([
      prisma.order.count({ where: base }),
      prisma.order.count({ where: { ...base, shippingState: 'en_transito' } }),
      prisma.order.count({ where: { ...base, shippingState: 'novedad' } }),
      prisma.order.count({ where: { ...base, shippingState: 'entregado' } }),
    ]);
    return { scope, a: total, b: transit, c: issues, d: delivered, deltaToday: null };
  }

  /** Asigna / transfiere / devuelve (warehouseId null) pedidos. Solo admins. */
  async assign(input: AssignOrdersInput, auth: AuthContext): Promise<{ count: number }> {
    if (!isAdmin(auth)) throw new ForbiddenException('Solo administradores pueden asignar pedidos');
    const { tenantId, prisma } = getTenantContext();

    // Validaciones EN PARALELO (eran 3-4 esperas encadenadas que retrasaban el
    // aviso en vivo a la sede destino): sede destino + pedidos finalizados +
    // estado previo (sede origen y si es montado a mano).
    const [wh, finalized, prior] = await Promise.all([
      input.warehouseId
        ? prisma.warehouse.findUnique({ where: { id: input.warehouseId } })
        : Promise.resolve(null),
      // No mover pedidos ya FINALIZADOS (cerrados en VTEX o completados a mano).
      // Uno solo facturado en Alegra sin cerrar todavia se puede mover.
      prisma.orderEvent.findMany({
        where: {
          orderId: { in: input.orderIds },
          type: { in: [...FINALIZED_EVENTS, 'vtex_invoiced_external'] },
        },
        select: { orderId: true },
        distinct: ['orderId'],
      }),
      prisma.order.findMany({
        where: { id: { in: input.orderIds } },
        select: { id: true, warehouseId: true, provider: true, status: true },
      }),
    ]);
    // Los EXTERNOS (sin asignar y ya avanzados en VTEX) son solo trazabilidad:
    // no se asignan a sedes.
    if (prior.some((p) => !p.warehouseId && p.provider === 'vtex' && p.status !== 'ready-for-handling')) {
      throw new BadRequestException('Ese pedido se procesó por fuera: es solo trazabilidad, no se puede asignar');
    }

    if (input.warehouseId && (!wh || wh.archived)) {
      throw new NotFoundException('Sede no encontrada o archivada');
    }
    const toName = wh?.name ?? null;
    if (finalized.length > 0) {
      throw new BadRequestException(
        `No se pueden mover ${finalized.length} pedido(s) ya facturados (finalizados). ` +
          'Estos pedidos ya estan cerrados.',
      );
    }
    // Los pedidos MONTADOS a mano nacen en una sede y no tienen espejo en VTEX:
    // no pueden "devolverse a generales" (esa vista es el espejo del marketplace).
    if (input.warehouseId === null && prior.some((o) => o.provider === 'manual')) {
      throw new BadRequestException(
        'Los pedidos montados a mano no van a generales. Si hace falta, transfiérelos a otra sede.',
      );
    }

    const result = await prisma.order.updateMany({
      where: { id: { in: input.orderIds } },
      data: {
        warehouseId: input.warehouseId,
        assignedAt: input.warehouseId ? new Date() : null,
      },
    });

    // INMEDIATEZ: el cambio ya esta en la base -> avisar YA a todas las vistas
    // (la sede destino lo pinta al instante). La actividad se registra despues:
    // no cambia la lista y no tiene por que retrasar el aviso.
    await this.realtime.publish(tenantId, { kind: 'orders.refresh' });

    // Registrar actividad por pedido, con NOMBRES de sede (la Actividad debe
    // decir a cual sede se asigno/transfirio y desde cual venia).
    const to = input.warehouseId;
    const fromIds = [...new Set(prior.map((o) => o.warehouseId).filter((x): x is string => !!x))];
    const fromNames = new Map(
      (
        await prisma.warehouse.findMany({ where: { id: { in: fromIds } }, select: { id: true, name: true } })
      ).map((w) => [w.id, w.name]),
    );
    await prisma.orderEvent.createMany({
      data: prior.map((o) => ({
        orderId: o.id,
        type: to === null ? 'returned' : o.warehouseId === null ? 'assigned' : 'transferred',
        actorId: auth.userId,
        actorName: displayName(auth),
        data: {
          from: o.warehouseId,
          to,
          fromName: o.warehouseId ? (fromNames.get(o.warehouseId) ?? null) : null,
          toName,
        } as Prisma.InputJsonValue,
      })),
    });

    return { count: result.count };
  }

  /**
   * "MONTAR PEDIDO": crea un pedido EXTERNO a las plataformas directo en una
   * sede (lo que antes se escribia a mano en Google Chat). El producto viene del
   * catalogo de Alegra de la sede y la ciudad del catalogo DANE (asi factura y
   * guia salen sin re-digitar nada). Lo puede montar cualquier miembro con
   * acceso a la sede. No genera MKT ni toca VTEX: su cierre es manual_completed.
   */
  async createManualOrder(input: CreateManualOrderInput, auth: AuthContext): Promise<OrderSummary> {
    const { tenantId, prisma } = getTenantContext();

    // Acceso: la sede existe y el usuario puede trabajar en ella.
    const wh = await prisma.warehouse.findUnique({ where: { id: input.warehouseId } });
    if (!wh || wh.archived) throw new NotFoundException('Sede no encontrada');
    const allowed = await this.warehouses.accessibleWarehouseIds(auth);
    if (allowed && !allowed.includes(input.warehouseId)) {
      throw new ForbiddenException('Sin acceso a esta sede');
    }

    // Plataforma de origen (Krediya, Mercado Libre...): debe existir en el
    // catalogo. VTEX no es elegible aqui — esos pedidos llegan solos.
    const platforms = await loadPlatforms();
    const platform = platforms.find((pl) => pl.id === input.platformId && pl.id !== 'vtex');
    if (!platform) {
      throw new BadRequestException('Plataforma no valida. Elige una del catalogo (o creala en Ajustes).');
    }

    const c = input.customer;
    const p = input.product;
    const phone = c.phone.replace(/\D/g, '') || c.phone;
    const total = p.price * p.quantity;
    const nameParts = c.name.trim().split(/\s+/).filter(Boolean);
    // El rawPayload IMITA la forma de VTEX que ya leen extractInvoiceClient /
    // extractShippingAddress / extractRealEmail: cero ramas nuevas en factura y
    // guia. `manual` guarda ademas la ciudad DANE elegida (sin re-resolver) y
    // la plataforma de origen (el color del badge vive en el catalogo).
    const rawPayload = {
      manual: {
        platform: { id: platform.id, name: platform.name },
        cityCode: c.cityCode,
        cityName: c.cityName ?? null,
        createdBy: displayName(auth),
      },
      clientProfileData: {
        firstName: nameParts.slice(0, Math.max(1, nameParts.length - 2)).join(' ') || c.name,
        lastName: nameParts.slice(Math.max(1, nameParts.length - 2)).join(' '),
        document: c.document,
        phone,
        email: c.email ?? null,
      },
      shippingData: {
        address: {
          street: c.address,
          city: c.cityName ?? null,
          state: c.cityDepartment ?? null,
        },
      },
    } as Prisma.InputJsonValue;

    // Nº propio y legible: MP-0001, MP-0002... (reintenta si dos personas montan
    // a la vez y chocan en el unique provider+externalId).
    let order: OrderWithItems | null = null;
    const base = await prisma.order.count({ where: { provider: 'manual' } });
    for (let attempt = 0; attempt < 5 && !order; attempt++) {
      const externalId = `MP-${String(base + 1 + attempt).padStart(4, '0')}`;
      try {
        order = await prisma.order.create({
          data: {
            externalId,
            provider: 'manual',
            accountName: 'manual',
            customerName: c.name.trim().toUpperCase(),
            customerEmail: c.email ?? null,
            customerDocument: c.document,
            customerPhone: phone,
            status: 'ready-for-handling',
            totalValue: total,
            currency: 'COP',
            totalUnits: p.quantity,
            warehouseId: input.warehouseId,
            assignedAt: new Date(),
            // La direccion la dicto el cliente al montar el pedido: nace
            // CONFIRMADA (no pasa por la confirmacion de WhatsApp).
            addressStatus: 'confirmed',
            addressConfirmedAt: new Date(),
            marketplaceCreatedAt: new Date(),
            rawPayload,
            items: {
              // sku = id del item de Alegra: el preview de factura lo usa para
              // sembrar la linea sin foto IMEI de por medio.
              create: [{ sku: p.itemId, name: p.name, quantity: p.quantity, unitPrice: p.price }],
            },
          },
          include: { items: { orderBy: { name: 'asc' } } },
        });
      } catch (err) {
        // P2002 = choco el unique provider+externalId (dos montando a la vez).
        const conflict =
          typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
        if (!conflict || attempt === 4) throw err;
      }
    }
    if (!order) throw new BadRequestException('No se pudo crear el pedido, intenta de nuevo');

    await Promise.all([
      prisma.orderEvent.create({
        data: {
          orderId: order.id,
          type: 'created',
          actorId: auth.userId,
          actorName: displayName(auth),
          data: {
            manual: true,
            warehouseName: wh.name,
            platform: platform.name,
          } as Prisma.InputJsonValue,
        },
      }),
      this.systemMessage(
        order.id,
        auth,
        `Pedido montado a mano (${platform.name}): ${p.quantity} × ${p.name} · ${formatCop(total)}.`,
      ),
    ]);

    await this.realtime.publish(tenantId, { kind: 'orders.refresh' });
    return this.toSummary(order, false, 0, auth.userId, []);
  }

  /**
   * ELIMINA del todo un pedido MONTADO a mano (chat, fotos, actividad — todo).
   * Los de marketplace no se tocan (son el espejo de VTEX). Si ya tiene factura
   * o guia, solo un admin puede eliminarlo (esos documentos existen en Alegra/
   * Coordinadora: eliminar aqui no los anula). Los adjuntos de storage se
   * borran en background (best-effort).
   */
  async deleteOrder(orderId: string, auth: AuthContext): Promise<void> {
    // Tomar los MISMOS candados de facturar/guia: si hay una factura o guia EN
    // CURSO (la llamada a Alegra/Coordinadora tarda segundos y su evento se
    // escribe al final), borrar en esa ventana dejaria el documento emitido
    // afuera sin ningun rastro aca. Con los locks, el borrado espera su turno
    // (o falla claro) y el chequeo de eventos de abajo ya ve la realidad.
    this.acquireLock(`${orderId}:invoice`, 'Hay una facturación en curso: espera a que termine.');
    try {
      // Si este segundo candado falla, el finally de afuera libera el primero.
      this.acquireLock(`${orderId}:guide`, 'Hay una guía en curso: espera a que termine.');
      try {
        await this.deleteOrderLocked(orderId, auth);
      } finally {
        this.opLocks.delete(`${orderId}:guide`);
      }
    } finally {
      this.opLocks.delete(`${orderId}:invoice`);
    }
  }

  private async deleteOrderLocked(orderId: string, auth: AuthContext): Promise<void> {
    const order = await this.loadAccessibleOrder(orderId, auth);
    if (order.provider !== 'manual') {
      throw new BadRequestException('Solo los pedidos montados a mano se pueden eliminar.');
    }

    const { tenantId, prisma } = getTenantContext();
    const hasDocs = await prisma.orderEvent.findFirst({
      where: { orderId, type: { in: ['invoiced', 'guide_generated', 'manual_completed'] } },
      select: { id: true },
    });
    if (hasDocs && !isAdmin(auth)) {
      throw new ForbiddenException(
        'Este pedido ya tiene factura o guía: solo un administrador puede eliminarlo (y debe anularlas en Alegra/Coordinadora aparte).',
      );
    }

    // Keys de adjuntos ANTES de borrar (la cascada se lleva los mensajes).
    const attachments = await prisma.orderMessage.findMany({
      where: { orderId, attachmentKey: { not: null } },
      select: { attachmentKey: true },
    });

    // La cascada de FKs borra items, mensajes, eventos, lecturas, reacciones y
    // alertas de super mencion. P2025 = otro lo borro primero -> 404, no 500.
    try {
      await prisma.order.delete({ where: { id: orderId } });
    } catch (err) {
      if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2025') {
        throw new NotFoundException('El pedido ya fue eliminado');
      }
      throw err;
    }

    if (this.storage.isConfigured()) {
      void (async () => {
        for (const a of attachments) {
          if (a.attachmentKey) await this.storage.delete(a.attachmentKey).catch(() => null);
        }
      })();
    }

    await this.realtime.publish(tenantId, { kind: 'orders.refresh' });
  }

  // === Drawer por pedido: detalle + conversacion + actividad ===

  async getDetail(orderId: string, auth: AuthContext): Promise<OrderDetail> {
    const order = await this.loadAccessibleOrder(orderId, auth);
    const { prisma } = getTenantContext();
    // unreadMap REAL para este usuario: el separador "No leidos" del chat lo
    // necesita tambien al entrar por notificacion/deep-link (antes iba en 0).
    const [photoCount, unread, reactions] = await Promise.all([
      prisma.orderMessage.count({
        where: { orderId, kind: { in: ['imei_photo', 'serial_photo'] } },
      }),
      this.unreadMap(auth.userId, { orderIds: [orderId] }),
      this.reactionsMap([orderId], auth.userId),
    ]);
    return this.toDetail(
      order,
      photoCount > 0,
      unread.get(orderId)?.count ?? 0,
      auth.userId,
      reactions.get(orderId) ?? [],
    );
  }

  async listMessages(orderId: string, auth: AuthContext): Promise<OrderMessageDto[]> {
    await this.loadAccessibleOrder(orderId, auth);
    const { prisma } = getTenantContext();
    const rows = await prisma.orderMessage.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
      include: { reactions: true },
    });
    return Promise.all(rows.map((m) => this.toMessage(m, auth.userId)));
  }

  async postMessage(
    orderId: string,
    input: CreateOrderMessageInput,
    auth: AuthContext,
  ): Promise<OrderMessageDto> {
    const order = await this.loadAccessibleOrder(orderId, auth);
    const { tenantId, prisma } = getTenantContext();
    let mentions = await this.validMentions(tenantId, input.mentions);

    // SUPER MENCION (@todos): destinatarios = todos los admins + los operadores
    // con acceso a la sede del pedido (nunca el autor). Se agregan a mentions
    // (asi cuentan en /mentions y no-leidos) y se crean alertas persistentes.
    let superRecipients: string[] = [];
    if (input.mentionAll) {
      const memberships = await this.control.membership.findMany({
        where: { tenantId },
        select: { userId: true, role: true },
      });
      const operatorIds = memberships.filter((m) => m.role === 'OPERATOR').map((m) => m.userId);
      let allowedOperators = new Set<string>();
      if (order.warehouseId && operatorIds.length > 0) {
        const links = await prisma.warehouseMember.findMany({
          where: { warehouseId: order.warehouseId, userId: { in: operatorIds } },
          select: { userId: true },
        });
        allowedOperators = new Set(links.map((l) => l.userId));
      }
      superRecipients = memberships
        .filter(
          (m) => m.userId !== auth.userId && (m.role !== 'OPERATOR' || allowedOperators.has(m.userId)),
        )
        .map((m) => m.userId);
      mentions = [...new Set([...mentions, ...superRecipients])];
    }

    // La cita solo vale si el mensaje citado es de ESTE pedido.
    const replyTo = input.replyToId
      ? await prisma.orderMessage.findFirst({
          where: { id: input.replyToId, orderId },
          select: { id: true, authorId: true },
        })
      : null;
    const msg = await prisma.orderMessage.create({
      data: {
        orderId,
        authorId: auth.userId,
        authorName: displayName(auth),
        kind: 'text',
        body: input.body,
        mentions,
        replyToId: replyTo?.id ?? null,
      },
    });
    // Alertas de SUPER MENCION: una fila por destinatario. Persisten hasta que
    // cada quien la cierre — el que no esta en la plataforma la ve al volver.
    if (input.mentionAll && superRecipients.length > 0) {
      await prisma.superMentionAlert.createMany({
        data: superRecipients.map((userId) => ({
          orderId,
          messageId: msg.id,
          userId,
          authorName: displayName(auth),
          preview: (input.body ?? '').slice(0, 140),
        })),
      });
    }

    // AL PESTAÑEO: chat.message se publica PRIMERO (es lo que pinta el mensaje
    // en el chat abierto del receptor); lo secundario (marcar leido, refresh de
    // listas) va despues y no puede retrasarlo.
    const participants = (
      await prisma.orderMessage.findMany({
        where: { orderId, kind: { not: 'system' } },
        select: { authorId: true },
        distinct: ['authorId'],
      })
    ).map((p) => p.authorId);
    if (!participants.includes(auth.userId)) participants.push(auth.userId);
    await this.realtime.publish(tenantId, {
      kind: 'chat.message',
      orderId,
      externalId: order.externalId,
      customerName: order.customerName,
      warehouseId: order.warehouseId,
      messageId: msg.id,
      authorId: auth.userId,
      authorName: displayName(auth),
      // Cuerpo COMPLETO: el chat abierto del receptor lo inyecta directo a su
      // cache (aparece al instante, sin refetch).
      body: input.body ?? '',
      mentions,
      replyToId: replyTo?.id ?? null,
      replyToAuthorId: replyTo?.authorId ?? null,
      participantIds: participants,
      superMention: input.mentionAll === true,
      createdAt: msg.createdAt.toISOString(),
    });
    // Quien escribe obviamente ya "leyo" el hilo -> marcar leido para no contarse a si mismo.
    await this.touchRead(orderId, auth.userId);
    await this.realtime.publish(tenantId, { kind: 'orders.refresh' });

    // WEB PUSH (app CERRADA): mencionados con titulo especial; respondido y
    // demas participantes con el generico. Nunca al propio autor. El titulo
    // lleva el NOMBRE DEL CLIENTE del pedido (no el MKT).
    const url = order.warehouseId
      ? `/warehouses/${order.warehouseId}?order=${orderId}`
      : `/orders?order=${orderId}`;
    const preview = (input.body ?? '').slice(0, 120);
    const sede = order.warehouseId
      ? ((
          await prisma.warehouse.findUnique({
            where: { id: order.warehouseId },
            select: { name: true },
          })
        )?.name ?? 'PEDIDOS GENERALES')
      : 'PEDIDOS GENERALES';
    const mentioned = new Set(mentions.filter((id) => id !== auth.userId));
    const others = new Set(
      [...participants, replyTo?.authorId ?? '']
        .filter(Boolean)
        .filter((id) => id !== auth.userId && !mentioned.has(id)),
    );
    void Promise.all([
      this.push.sendToUsers([...mentioned], {
        title: input.mentionAll
          ? `📢 SÚPER MENCIÓN · ${sede} · ${order.customerName}`
          : `${sede} · ${order.customerName}`,
        body: preview,
        url,
        author: displayName(auth),
        msg: preview,
        customer: order.customerName,
        sede,
      }),
      this.push.sendToUsers([...others], {
        title: `${sede} · ${order.customerName}`,
        body: preview,
        url,
        author: displayName(auth),
        msg: preview,
        customer: order.customerName,
        sede,
      }),
    ]).catch(() => undefined);

    return this.toMessage(msg, auth.userId);
  }

  /**
   * Señal "esta escribiendo" (efimera, sin DB): se publica por SSE y los chats
   * abiertos de ese pedido la muestran unos segundos. El cliente la manda
   * throttled desde la primera letra.
   */
  async typing(orderId: string, auth: AuthContext): Promise<void> {
    await this.loadAccessibleOrder(orderId, auth);
    const { tenantId } = getTenantContext();
    await this.realtime.publish(tenantId, {
      kind: 'chat.typing',
      orderId,
      userId: auth.userId,
      userName: displayName(auth),
    });
  }

  /** Alterna MI reaccion con un emoji sobre un mensaje. Devuelve el mensaje actualizado. */
  async toggleReaction(
    orderId: string,
    messageId: string,
    emoji: string,
    auth: AuthContext,
  ): Promise<OrderMessageDto> {
    const order = await this.loadAccessibleOrder(orderId, auth);
    const { tenantId, prisma } = getTenantContext();
    const msg = await prisma.orderMessage.findUnique({ where: { id: messageId } });
    if (!msg || msg.orderId !== orderId) throw new NotFoundException('Mensaje no encontrado');
    if (msg.kind === 'system') {
      throw new ForbiddenException('Los mensajes de sistema no admiten reacciones.');
    }

    const key = { messageId_userId_emoji: { messageId, userId: auth.userId, emoji } };
    const existing = await prisma.messageReaction.findUnique({ where: key });
    if (existing) {
      await prisma.messageReaction.delete({ where: key });
      // Evento tambien al QUITAR (removed: true): los chats abiertos actualizan
      // el chip al instante. No genera sonido/notificacion en el cliente.
      await this.realtime.publish(tenantId, {
        kind: 'chat.reaction',
        removed: true,
        orderId,
        externalId: order.externalId,
        customerName: order.customerName,
        warehouseId: order.warehouseId,
        messageId,
        emoji,
        reactorId: auth.userId,
        reactorName: displayName(auth),
        messageAuthorId: msg.authorId,
      });
    } else {
      await prisma.messageReaction.create({
        data: { messageId, userId: auth.userId, userName: displayName(auth), emoji },
      });
      // Notificar SOLO al reaccionar (no al quitar): el autor del mensaje
      // recibe sonido/notificacion en su cliente.
      await this.realtime.publish(tenantId, {
        kind: 'chat.reaction',
        removed: false,
        orderId,
        externalId: order.externalId,
        customerName: order.customerName,
        warehouseId: order.warehouseId,
        messageId,
        emoji,
        reactorId: auth.userId,
        reactorName: displayName(auth),
        messageAuthorId: msg.authorId,
      });
      if (msg.authorId !== auth.userId) {
        // WEB PUSH al autor del mensaje (aunque tenga la app cerrada).
        const sede = order.warehouseId
          ? ((
              await prisma.warehouse.findUnique({
                where: { id: order.warehouseId },
                select: { name: true },
              })
            )?.name ?? 'PEDIDOS GENERALES')
          : 'PEDIDOS GENERALES';
        void this.push
          .sendToUsers([msg.authorId], {
            title: `${sede} · ${order.customerName}`,
            body: msg.body ? `A: "${msg.body.slice(0, 100)}"` : 'A tu mensaje',
            url: order.warehouseId
              ? `/warehouses/${order.warehouseId}?order=${orderId}`
              : `/orders?order=${orderId}`,
            author: displayName(auth),
            msg: `reaccionó ${emoji}`,
            customer: order.customerName,
            sede,
          })
          .catch(() => undefined);
      }
    }

    await this.realtime.publish(tenantId, { kind: 'orders.refresh' });
    const fresh = await prisma.orderMessage.findUniqueOrThrow({
      where: { id: messageId },
      include: { reactions: true },
    });
    return this.toMessage(fresh, auth.userId);
  }

  /** Alertas de SUPER MENCION sin cerrar para el usuario (se muestran al volver). */
  async pendingSuperMentions(auth: AuthContext): Promise<SuperMentionAlertDto[]> {
    const { prisma } = getTenantContext();
    const rows = await prisma.superMentionAlert.findMany({
      where: { userId: auth.userId, seenAt: null },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        order: { select: { externalId: true, customerName: true, warehouseId: true } },
      },
    });
    if (rows.length === 0) return [];
    const orderIds = [...new Set(rows.map((r) => r.orderId))];
    const invoiced = new Set(
      (
        await prisma.orderEvent.findMany({
          where: {
            orderId: { in: orderIds },
            type: { in: [...FINALIZED_EVENTS, 'vtex_invoiced_external'] },
          },
          select: { orderId: true },
          distinct: ['orderId'],
        })
      ).map((e) => e.orderId),
    );
    return rows.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      messageId: r.messageId,
      externalId: r.order.externalId,
      customerName: r.order.customerName,
      warehouseId: r.order.warehouseId,
      stage: r.order.warehouseId
        ? invoiced.has(r.orderId)
          ? ('invoiced' as const)
          : ('pending' as const)
        : ('general' as const),
      authorName: r.authorName,
      preview: r.preview,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Cierra (ack) las alertas de super mencion del usuario para esos mensajes. */
  async ackSuperMentions(messageIds: string[], auth: AuthContext): Promise<{ ok: true }> {
    const { prisma } = getTenantContext();
    if (messageIds.length > 0) {
      await prisma.superMentionAlert.updateMany({
        where: { userId: auth.userId, messageId: { in: messageIds }, seenAt: null },
        data: { seenAt: new Date() },
      });
    }
    return { ok: true };
  }

  /** Filtra las menciones a userIds que de verdad son miembros del workspace. */
  private async validMentions(tenantId: string, mentions?: string[]): Promise<string[]> {
    const ids = [...new Set((mentions ?? []).filter(Boolean))];
    if (ids.length === 0) return [];
    const members = await this.control.membership.findMany({
      where: { tenantId, userId: { in: ids } },
      select: { userId: true },
    });
    return members.map((m) => m.userId);
  }

  /** Upsert del estado de lectura del hilo de un pedido para un usuario (lastReadAt = ahora). */
  private async touchRead(orderId: string, userId: string): Promise<void> {
    const { prisma } = getTenantContext();
    await prisma.orderRead.upsert({
      where: { orderId_userId: { orderId, userId } },
      create: { orderId, userId, lastReadAt: new Date() },
      update: { lastReadAt: new Date() },
    });
  }

  /**
   * Marca como leido el hilo del pedido (al abrir la conversacion). No publica
   * por SSE a proposito: es un cambio del propio usuario, y publicar haria que
   * TODOS refresquen el chat sin motivo. El cliente invalida sus vistas local.
   */
  async markRead(orderId: string, auth: AuthContext): Promise<void> {
    await this.loadAccessibleOrder(orderId, auth);
    await this.touchRead(orderId, auth.userId);
  }

  /**
   * No leidos por pedido para un usuario: mensajes de OTROS (no de sistema)
   * creados despues de su `lastReadAt` de cada hilo. Un solo par de queries.
   *  - `orderIds`: acota a esos pedidos (badge de la lista).
   *  - `scopeWarehouseIds`: null = admin (todo); si no, solo pedidos de esas sedes.
   *  - `since`: piso temporal (para la bandeja, evita escanear todo el historial).
   */
  private async unreadMap(
    userId: string,
    opts: { orderIds?: string[]; scopeWarehouseIds?: string[] | null; since?: Date } = {},
  ): Promise<Map<string, UnreadInfo>> {
    const { prisma } = getTenantContext();
    const result = new Map<string, UnreadInfo>();

    const messageWhere: Prisma.OrderMessageWhereInput = {
      authorId: { not: userId },
      kind: { not: 'system' },
    };
    if (opts.orderIds) {
      if (opts.orderIds.length === 0) return result;
      messageWhere.orderId = { in: opts.orderIds };
    }
    if (opts.since) messageWhere.createdAt = { gte: opts.since };
    if (opts.scopeWarehouseIds) messageWhere.order = { warehouseId: { in: opts.scopeWarehouseIds } };

    const [reads, messages] = await Promise.all([
      prisma.orderRead.findMany({
        where: { userId, ...(opts.orderIds ? { orderId: { in: opts.orderIds } } : {}) },
        select: { orderId: true, lastReadAt: true },
      }),
      prisma.orderMessage.findMany({
        where: messageWhere,
        select: {
          orderId: true,
          createdAt: true,
          mentions: true,
          kind: true,
          body: true,
          authorName: true,
        },
        orderBy: { createdAt: 'asc' },
        take: 5000, // guardarril; a escala de PyME no se alcanza
      }),
    ]);

    const lastRead = new Map(reads.map((r) => [r.orderId, r.lastReadAt.getTime()]));
    for (const m of messages) {
      // Sin fila de lectura => nunca abrio el hilo => todo cuenta como no leido.
      if (m.createdAt.getTime() <= (lastRead.get(m.orderId) ?? 0)) continue;
      const prev = result.get(m.orderId);
      const mentioned = m.mentions.includes(userId);
      if (prev) {
        prev.count += 1;
        prev.mentioned = prev.mentioned || mentioned;
        prev.lastAt = m.createdAt;
        prev.preview = messagePreview(m.kind, m.body);
        prev.lastAuthor = m.authorName;
      } else {
        result.set(m.orderId, {
          count: 1,
          mentioned,
          lastAt: m.createdAt,
          preview: messagePreview(m.kind, m.body),
          lastAuthor: m.authorName,
        });
      }
    }
    return result;
  }

  /**
   * Bandeja de la campana: pedidos con mensajes sin leer para el usuario, mas
   * recientes primero. Respeta el alcance por sede del operador.
   */
  async inbox(auth: AuthContext): Promise<Inbox> {
    const { prisma } = getTenantContext();
    const scope = await this.warehouses.accessibleWarehouseIds(auth);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60_000); // ultimos 30 dias
    const unread = await this.unreadMap(auth.userId, { scopeWarehouseIds: scope, since });
    if (unread.size === 0) return { items: [], totalUnread: 0, mentions: 0 };

    const orders = await prisma.order.findMany({
      where: { id: { in: [...unread.keys()] } },
      select: { id: true, externalId: true, customerName: true, warehouseId: true },
    });
    const byId = new Map(orders.map((o) => [o.id, o]));

    const items: InboxItem[] = [];
    let totalUnread = 0;
    let mentions = 0;
    for (const [orderId, info] of unread) {
      const o = byId.get(orderId);
      if (!o) continue; // el pedido pudo borrarse
      totalUnread += info.count;
      if (info.mentioned) mentions += 1;
      items.push({
        orderId,
        externalId: o.externalId,
        customerName: o.customerName,
        warehouseId: o.warehouseId,
        unreadCount: info.count,
        mentioned: info.mentioned,
        lastMessageAt: info.lastAt.toISOString(),
        preview: info.preview,
        lastAuthor: info.lastAuthor,
      });
    }
    items.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
    return { items, totalUnread, mentions };
  }

  /**
   * Menciones a mi (pagina "Menciones", tipo Google Chat): cada mensaje donde me
   * mencionaron, mas reciente primero, con el pedido y si sigue sin leer.
   */
  async mentionsFeed(auth: AuthContext): Promise<MentionItem[]> {
    const { prisma } = getTenantContext();
    const scope = await this.warehouses.accessibleWarehouseIds(auth);

    const messages = await prisma.orderMessage.findMany({
      where: {
        mentions: { has: auth.userId },
        ...(scope ? { order: { warehouseId: { in: scope } } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        orderId: true,
        authorName: true,
        kind: true,
        body: true,
        createdAt: true,
        order: {
          select: {
            externalId: true,
            customerName: true,
            warehouseId: true,
            warehouse: { select: { name: true } },
          },
        },
      },
    });
    if (messages.length === 0) return [];

    const orderIds = [...new Set(messages.map((m) => m.orderId))];
    const [reads, invoicedEvents] = await Promise.all([
      prisma.orderRead.findMany({
        where: { userId: auth.userId, orderId: { in: orderIds } },
        select: { orderId: true, lastReadAt: true },
      }),
      prisma.orderEvent.findMany({
        where: { orderId: { in: orderIds }, type: { in: FINALIZED_EVENTS } },
        select: { orderId: true },
        distinct: ['orderId'],
      }),
    ]);
    const lastRead = new Map(reads.map((r) => [r.orderId, r.lastReadAt.getTime()]));
    const invoiced = new Set(invoicedEvents.map((e) => e.orderId));

    return messages.map((m) => ({
      messageId: m.id,
      orderId: m.orderId,
      externalId: m.order.externalId,
      customerName: m.order.customerName,
      warehouseId: m.order.warehouseId,
      warehouseName: m.order.warehouse?.name ?? null,
      stage: !m.order.warehouseId ? 'general' : invoiced.has(m.orderId) ? 'invoiced' : 'pending',
      author: m.authorName,
      body: m.body ?? messagePreview(m.kind, m.body),
      createdAt: m.createdAt.toISOString(),
      unread: m.createdAt.getTime() > (lastRead.get(m.orderId) ?? 0),
    }));
  }

  /**
   * Busqueda GLOBAL: pedidos en generales y en TODAS las sedes (por preparar y
   * facturados) por cliente, N.º, cedula o producto. Un operador solo busca en
   * sus sedes. Devuelve lo minimo para abrir el pedido donde corresponde.
   */
  /**
   * Condiciones del buscador (lista + buscador global): nombre, N° de pedido,
   * cedula, producto y TELEFONO. Para el telefono se busca tambien solo con
   * los digitos (los VTEX guardan "+57..." y los manuales los 10 digitos).
   */
  private searchConditions(q: string): Prisma.OrderWhereInput[] {
    const conditions: Prisma.OrderWhereInput[] = [
      { customerName: { contains: q, mode: 'insensitive' } },
      { externalId: { contains: q, mode: 'insensitive' } },
      { customerDocument: { contains: q, mode: 'insensitive' } },
      { customerPhone: { contains: q, mode: 'insensitive' } },
      { items: { some: { name: { contains: q, mode: 'insensitive' } } } },
    ];
    const digits = q.replace(/\D/g, '');
    if (digits.length >= 4 && digits !== q) {
      conditions.push({ customerPhone: { contains: digits } });
    }
    return conditions;
  }

  async globalSearch(q: string, auth: AuthContext): Promise<OrderSearchResult[]> {
    const { prisma } = getTenantContext();
    const scope = await this.warehouses.accessibleWarehouseIds(auth);

    const rows = await prisma.order.findMany({
      where: {
        ...(scope ? { warehouseId: { in: scope } } : {}),
        OR: this.searchConditions(q),
      },
      orderBy: { marketplaceCreatedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        externalId: true,
        customerName: true,
        customerDocument: true,
        warehouseId: true,
        marketplaceCreatedAt: true,
        warehouse: { select: { name: true } },
        items: { select: { name: true }, orderBy: { name: 'asc' }, take: 1 },
      },
    });
    if (rows.length === 0) return [];

    const invoiced = new Set(
      (
        await prisma.orderEvent.findMany({
          where: { orderId: { in: rows.map((r) => r.id) }, type: { in: FINALIZED_EVENTS } },
          select: { orderId: true },
          distinct: ['orderId'],
        })
      ).map((e) => e.orderId),
    );

    return rows.map((r) => ({
      orderId: r.id,
      externalId: r.externalId,
      customerName: r.customerName,
      customerDocument: r.customerDocument,
      productName: r.items[0]?.name ?? null,
      warehouseId: r.warehouseId,
      warehouseName: r.warehouse?.name ?? null,
      stage: !r.warehouseId ? 'general' : invoiced.has(r.id) ? 'invoiced' : 'pending',
      createdAt: r.marketplaceCreatedAt.toISOString(),
    }));
  }

  /**
   * Elimina un mensaje del chat (incluidas las fotos). Puede hacerlo el autor del
   * mensaje o un administrador. Si tiene adjunto en storage, tambien lo borra.
   * No se permite borrar mensajes de sistema.
   */
  async deleteMessage(orderId: string, messageId: string, auth: AuthContext): Promise<void> {
    await this.loadAccessibleOrder(orderId, auth);
    const { tenantId, prisma } = getTenantContext();
    const msg = await prisma.orderMessage.findUnique({ where: { id: messageId } });
    if (!msg || msg.orderId !== orderId) {
      throw new NotFoundException('Mensaje no encontrado');
    }
    if (msg.kind === 'system') {
      throw new ForbiddenException('Los mensajes de sistema no se pueden eliminar.');
    }
    if (!isAdmin(auth) && msg.authorId !== auth.userId) {
      throw new ForbiddenException('Solo el autor o un administrador puede eliminar el mensaje.');
    }

    if (msg.attachmentKey && this.storage.isConfigured()) {
      await this.storage.delete(msg.attachmentKey).catch(() => null);
    }
    await prisma.orderMessage.delete({ where: { id: messageId } });
    await this.realtime.publish(tenantId, { kind: 'orders.refresh' });
  }

  async listEvents(orderId: string, auth: AuthContext): Promise<OrderEventDto[]> {
    await this.loadAccessibleOrder(orderId, auth);
    const { prisma } = getTenantContext();
    const rows = await prisma.orderEvent.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((e) => this.toEvent(e));
  }

  /**
   * Sube la foto de un dispositivo (kind=imei|serial): lee el/los codigo(s) con IA
   * (IMEI valida Luhn; serial no). SOLO si hay al menos uno guarda la imagen en
   * storage y crea el mensaje (imei_photo/serial_photo). Ademas busca cada codigo
   * en el catalogo de compras y devuelve los matches (producto/costo/proveedor).
   * Si la imagen no contiene ningun codigo -> error (no se guarda nada).
   */
  async addDevicePhoto(
    orderId: string,
    file: { buffer: Buffer; mimetype: string },
    kind: DevicePhotoKind,
    auth: AuthContext,
  ): Promise<DevicePhotoResponse> {
    await this.loadAccessibleOrder(orderId, auth);
    const { tenantId, prisma } = getTenantContext();

    const mime = file.mimetype as ImageMime;
    if (!(mime in IMAGE_EXT)) {
      throw new BadRequestException('Formato no soportado. Sube una imagen JPG, PNG, WEBP o GIF.');
    }

    // 1+2 EN PARALELO: la IA lee el codigo mientras la imagen sube al storage
    // (antes iban en serie y se sumaban los tiempos). Si la IA no encuentra
    // nada, la imagen recien subida se borra (best-effort) y se corta.
    const base64 = file.buffer.toString('base64');
    const key = `tenants/${tenantId}/orders/${orderId}/${randomUUID()}.${IMAGE_EXT[mime]}`;
    const [codes] = await Promise.all([
      kind === 'imei' ? this.ai.extractImeis(base64, mime) : this.ai.extractSerials(base64, mime),
      this.storage.put(key, file.buffer, mime),
    ]);
    if (codes.length === 0) {
      void this.storage.delete(key).catch(() => undefined);
      throw new BadRequestException(
        kind === 'imei'
          ? 'No se detecto ningun IMEI valido en la imagen. Sube una foto nitida del IMEI.'
          : 'No se detecto ningun serial en la imagen. Sube una foto nitida del serial.',
      );
    }

    // 3. Registrar el mensaje en la conversacion del pedido.
    const msg = await prisma.orderMessage.create({
      data: {
        orderId,
        authorId: auth.userId,
        authorName: displayName(auth),
        kind: kind === 'imei' ? 'imei_photo' : 'serial_photo',
        body: null,
        attachmentKey: key,
        attachmentMime: mime,
        imeis: codes,
      },
    });
    await this.realtime.publish(tenantId, { kind: 'orders.refresh' });

    // 4. Buscar cada codigo en el catalogo de compras (best-effort).
    const matches = await this.catalog.findByCodes(codes).catch(() => [] as CatalogMatch[]);
    return { message: await this.toMessage(msg), matches };
  }

  /**
   * Sube un adjunto NORMAL al chat (foto / video / archivo) — sin lectura de
   * IMEI/serial ni catalogo: solo se guarda y se muestra en la conversacion. El
   * nombre original queda en `body` (para descargar/rotular). kind='file'; el
   * front decide como pintarlo segun el mime (imagen inline, video, o tarjeta).
   */
  async addAttachment(
    orderId: string,
    file: { buffer: Buffer; mimetype: string; originalname?: string },
    auth: AuthContext,
    caption?: string,
  ): Promise<OrderMessageDto> {
    await this.loadAccessibleOrder(orderId, auth);
    const { tenantId, prisma } = getTenantContext();

    if (!this.storage.isConfigured()) {
      throw new BadRequestException('El almacenamiento de archivos no esta configurado.');
    }
    if (!file?.buffer?.length) {
      throw new BadRequestException('El archivo llego vacio.');
    }

    const mime = (file.mimetype || 'application/octet-stream').toLowerCase();
    const originalName = (file.originalname ?? '').trim() || `archivo-${Date.now()}`;
    const ext = extFromNameOrMime(originalName, mime);
    const key = `tenants/${tenantId}/orders/${orderId}/${slugForKey(originalName)}-${randomUUID()}${ext}`;

    await this.storage.put(key, file.buffer, mime, contentDisposition(originalName));

    const msg = await prisma.orderMessage.create({
      data: {
        orderId,
        authorId: auth.userId,
        authorName: displayName(auth),
        kind: 'file',
        body: originalName,
        // Texto que acompaña al adjunto (estilo WhatsApp): mismo mensaje.
        caption: caption?.trim().slice(0, 2000) || null,
        attachmentKey: key,
        attachmentMime: mime,
        imeis: [],
      },
    });
    await this.realtime.publish(tenantId, { kind: 'orders.refresh' });
    return this.toMessage(msg);
  }

  /** Busca codigos (IMEI/serial) en el catalogo — para re-mostrar los matches. */
  async lookupCodes(orderId: string, codes: string[], auth: AuthContext): Promise<CatalogMatch[]> {
    await this.loadAccessibleOrder(orderId, auth);
    return this.catalog.findByCodes(codes).catch(() => [] as CatalogMatch[]);
  }

  // === Facturacion ===

  /** Grupos de codigos por FOTO: cada foto (message) es un grupo (una linea/producto). */
  private async orderCodeGroups(orderId: string): Promise<string[][]> {
    const { prisma } = getTenantContext();
    const rows = await prisma.orderMessage.findMany({
      where: { orderId, kind: { in: ['imei_photo', 'serial_photo'] } },
      select: { imeis: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => r.imeis).filter((codes) => codes.length > 0);
  }

  /** Si el pedido ya fue facturado, devuelve la factura (del evento 'invoiced'); si no, null. */
  private async existingInvoice(orderId: string): Promise<ExistingInvoice | null> {
    const { prisma } = getTenantContext();
    const ev = await prisma.orderEvent.findFirst({
      where: { orderId, type: 'invoiced' },
      orderBy: { createdAt: 'desc' },
    });
    if (!ev) return null;
    const d = (ev.data ?? {}) as Record<string, unknown>;
    const asStr = (v: unknown): string => (v == null ? '' : String(v));
    return {
      id: asStr(d.id),
      number: asStr(d.number),
      status: asStr(d.status) || 'closed',
      total: asStr(d.total),
      createdAt: ev.createdAt.toISOString(),
    };
  }

  /**
   * Facturado POR FUERA de SmartLogistica (cerrado directo en VTEX): no se
   * factura ni se genera guia desde aqui — solo trazabilidad.
   */
  private async ensureNotExternallyInvoiced(orderId: string): Promise<void> {
    const { prisma } = getTenantContext();
    const ev = await prisma.orderEvent.findFirst({
      where: { orderId, type: 'vtex_invoiced_external' },
      select: { id: true },
    });
    if (ev) {
      throw new BadRequestException(
        'Este pedido fue facturado POR FUERA de SmartLogística: no permite facturar ni generar guía.',
      );
    }
  }

  /** Preview: cliente completo (del pedido) + una linea por FOTO (producto + precio). */
  async invoicePreview(orderId: string, auth: AuthContext): Promise<InvoicePreview> {
    const order = await this.loadAccessibleOrder(orderId, auth);
    await this.ensureNotExternallyInvoiced(orderId);
    if (!order.warehouseId) {
      throw new BadRequestException('Asigna el pedido a una sede para poder facturar.');
    }

    // Si ya se facturo, no preparamos lineas: el front muestra la factura emitida.
    const invoice = await this.existingInvoice(orderId);
    if (invoice) {
      const c = extractInvoiceClient(order);
      return {
        invoice,
        lines: [],
        client: {
          name: c.name,
          identification: c.identification,
          email: c.email,
          phone: c.phone,
          address: c.address?.street ?? null,
        },
      };
    }

    const groups = await this.orderCodeGroups(orderId);

    // Pedido MONTADO a mano sin fotos aun: la linea se siembra directo del
    // producto elegido al montarlo (sku = id del item de Alegra). Ya es exacta:
    // sin prorrateo ni veredicto de IA (el producto ES el del pedido).
    if (order.provider === 'manual' && groups.length === 0) {
      const client = extractInvoiceClient(order);
      return {
        invoice: null,
        lines: order.items.map((i) => ({
          codes: [],
          itemId: i.sku,
          productName: i.name,
          suggestedPrice: i.unitPrice.toString(),
          quantity: i.quantity,
          matched: true,
          mismatch: null,
        })),
        client: {
          name: client.name,
          identification: client.identification,
          email: client.email,
          phone: client.phone,
          address: client.address?.street ?? null,
        },
      };
    }

    const lines = await this.alegra.invoicePreviewLines(order.warehouseId, groups, auth);

    // El precio de venta viene del PEDIDO (VTEX), no del precio de lista de Alegra.
    const vtexItems = order.items.map((i) => ({ name: i.name, unitPrice: i.unitPrice.toString() }));
    const priced = lines.map((l) => ({
      ...l,
      suggestedPrice: vtexPriceForProduct(l.productName, vtexItems) ?? l.suggestedPrice,
    }));

    // IA experta en celulares: ¿el producto de la COMPRA (por el IMEI leido)
    // corresponde a ALGUN producto del PEDIDO (modelo + almacenamiento + RAM)?
    // Solo un AVISO (no bloquea facturar). Best-effort con cache por linea.
    const orderNames = order.items.map((i) => i.name).filter(Boolean);
    const withVerdict = await Promise.all(
      priced.map(async (l) => {
        if (!l.productName || orderNames.length === 0) return { ...l, mismatch: null };
        const cacheKey = `${orderId}:${l.productName}`;
        if (this.productMatchCache.has(cacheKey)) {
          return { ...l, mismatch: this.productMatchCache.get(cacheKey) ?? null };
        }
        const verdict = await this.ai.verifyProductMatch(orderNames, l.productName);
        const mismatch =
          verdict && !verdict.match
            ? { expected: verdict.expected, found: l.productName, note: verdict.note }
            : null;
        this.productMatchCache.set(cacheKey, mismatch);
        return { ...l, mismatch };
      }),
    );

    const client = extractInvoiceClient(order);
    return {
      invoice: null,
      // Se factura el TOTAL del pedido (envio/recargos incluidos), no solo el
      // valor de los productos: el excedente se reparte entre las lineas.
      lines: prorateToOrderTotal(withVerdict, Number(order.totalValue)),
      client: {
        name: client.name,
        identification: client.identification,
        email: client.email,
        phone: client.phone,
        address: client.address?.street ?? null,
      },
    };
  }

  /** Busca items de Alegra (selector manual de producto) usando el Alegra de la sede del pedido. */
  async searchAlegraItems(orderId: string, query: string, auth: AuthContext): Promise<AlegraItem[]> {
    const order = await this.loadAccessibleOrder(orderId, auth);
    if (!order.warehouseId) throw new BadRequestException('Asigna el pedido a una sede.');
    return this.alegra.searchItems(order.warehouseId, query, auth);
  }

  /**
   * Cuentas de banco de Alegra de la sede del pedido — para elegir los pagos de
   * la factura de un pedido MONTADO a mano.
   */
  async listPaymentAccounts(orderId: string, auth: AuthContext): Promise<AlegraPaymentAccount[]> {
    const order = await this.loadAccessibleOrder(orderId, auth);
    if (!order.warehouseId) throw new BadRequestException('Asigna el pedido a una sede.');
    return this.alegra.listPaymentAccounts(order.warehouseId, auth);
  }

  /** Emite la factura de venta en Alegra y la registra en el pedido. */
  async createInvoice(
    orderId: string,
    input: CreateInvoiceInput,
    auth: AuthContext,
  ): Promise<InvoiceResult> {
    this.acquireLock(`${orderId}:invoice`, 'Ya hay una facturación en curso para este pedido.');
    try {
      return await this.createInvoiceLocked(orderId, input, auth);
    } finally {
      this.opLocks.delete(`${orderId}:invoice`);
    }
  }

  private async createInvoiceLocked(
    orderId: string,
    input: CreateInvoiceInput,
    auth: AuthContext,
  ): Promise<InvoiceResult> {
    await this.ensureNotExternallyInvoiced(orderId);
    const order = await this.loadAccessibleOrder(orderId, auth);
    if (!order.warehouseId) {
      throw new BadRequestException('Asigna el pedido a una sede para facturar.');
    }

    // Evitar doble facturacion: si ya hay una factura para este pedido, cortar.
    const already = await this.existingInvoice(orderId);
    if (already) {
      throw new ConflictException(
        `Este pedido ya fue facturado (Factura ${already.number}). Anula esa factura en Alegra antes de volver a facturar.`,
      );
    }

    const { tenantId, prisma } = getTenantContext();

    // Pagos elegidos: SOLO para pedidos montados a mano. Los de marketplace
    // siguen saliendo pagados con MARKETPLACE ADDI, como siempre.
    const manual = order.provider === 'manual';
    if (!manual && input.payments && input.payments.length > 0) {
      throw new BadRequestException(
        'Los pagos personalizados solo aplican a pedidos montados a mano.',
      );
    }
    if (manual && !input.payments) {
      throw new BadRequestException('Elige el/los medios de pago de la factura.');
    }

    const client = extractInvoiceClient(order);
    const { result, payment } = await this.alegra.createInvoiceForWarehouse(
      order.warehouseId,
      client,
      input.lines,
      auth,
      manual ? { manualPayments: input.payments ?? [] } : undefined,
    );

    // Registrar en el pedido: mensaje de sistema + evento en la actividad.
    // Si Alegra registro un total DISTINTO al enviado (el "peso perdido"),
    // que quede visible en el chat en vez de descubrirse despues.
    const sentTotal = input.lines.reduce((s, l) => s + Math.round(l.price) * l.quantity, 0);
    const emittedTotal = Number(result.total);
    const totalMismatch =
      Number.isFinite(emittedTotal) && Math.abs(emittedTotal - sentTotal) >= 0.5;
    await prisma.orderMessage.create({
      data: {
        orderId,
        authorId: auth.userId,
        authorName: displayName(auth),
        kind: 'system',
        body:
          `Factura ${result.number} emitida en Alegra (${result.status}).` +
          (totalMismatch
            ? ` ⚠️ OJO: Alegra la registró por $${emittedTotal} y se enviaron $${sentTotal} — revisar en Alegra.`
            : ''),
        imeis: [],
      },
    });

    // PDF + Certificado de Garantia + adjunto al chat: EN BACKGROUND. La
    // factura ya quedo emitida; descargar el PDF de Alegra, transformarlo y
    // subirlo agregaba 2-4s al boton sin aportar nada a la respuesta. El
    // documento aparece en el chat segundos despues via SSE.
    const warehouseId = order.warehouseId;
    void (async () => {
      try {
        const pdf = await this.alegra.invoicePdf(warehouseId, result.id);
        if (!pdf || !this.storage.isConfigured()) return;
        // Certificado: si la sede tiene plantilla, la factura se transforma
        // (nunca se envia la factura cruda). Si no hay plantilla, va la original.
        const clientNameRaw = (client.name ?? '').trim().toUpperCase();
        const certificate = await this.warranty
          .certificateFor(warehouseId, pdf, {
            moneda: 'COP',
            fecha: new Date().toISOString().slice(0, 10),
            cliente: clientNameRaw,
            numeroFactura: result.number,
            // Forma/medio de pago REALES de la factura de Alegra.
            formaPago: payment.formaPago,
            medioPago: payment.medioPago,
          })
          .catch(() => null);
        const finalPdf = certificate ?? pdf;

        // Nombre del archivo: FACTURA-<NOMBRE CLIENTE EN MAYUSCULA>.
        const clientName = clientNameRaw || `FACTURA ${result.number}`;
        const fileName = `FACTURA-${clientName}.pdf`;
        const key = `tenants/${tenantId}/orders/${orderId}/${slugForKey(fileName)}-${randomUUID()}.pdf`;
        await this.storage.put(key, finalPdf, 'application/pdf', contentDisposition(fileName));
        await prisma.orderMessage.create({
          data: {
            orderId,
            authorId: auth.userId,
            authorName: displayName(auth),
            kind: 'document',
            body: fileName,
            attachmentKey: key,
            attachmentMime: 'application/pdf',
            imeis: [],
          },
        });
        await this.realtime.publish(tenantId, { kind: 'orders.refresh' });
      } catch {
        // best-effort: la facturacion nunca se bloquea por el adjunto
      }
    })();
    await prisma.orderEvent.create({
      data: {
        orderId,
        type: 'invoiced',
        actorId: auth.userId,
        actorName: displayName(auth),
        data: {
          number: result.number,
          id: result.id,
          status: result.status,
          total: result.total,
        } as Prisma.InputJsonValue,
      },
    });
    // Pedido montado a mano: si la guia ya existia, con la factura queda COMPLETO
    // (pasa a Facturados). Best-effort: la factura ya quedo emitida igual.
    if (manual) await this.finalizeManual(order, auth).catch(() => null);
    await this.realtime.publish(tenantId, { kind: 'orders.refresh' });
    return result;
  }

  // === Guias (Coordinadora) ===

  /** Si el pedido ya tiene guia (evento 'guide_generated'), la devuelve; si no, null. */
  private async existingGuide(orderId: string): Promise<Guide | null> {
    const { prisma } = getTenantContext();
    const ev = await prisma.orderEvent.findFirst({
      where: { orderId, type: 'guide_generated' },
      orderBy: { createdAt: 'desc' },
    });
    if (!ev) return null;
    const d = (ev.data ?? {}) as Record<string, unknown>;
    const asStr = (v: unknown): string => (v == null ? '' : String(v));
    return {
      id: asStr(d.id),
      number: asStr(d.number),
      url: d.url != null ? String(d.url) : null,
      createdAt: ev.createdAt.toISOString(),
    };
  }

  /**
   * Preview de guia: destinatario (de VTEX, editable), remitente (de la sede) y
   * paquete (defaults editables). Si ya se genero, devuelve la guia (bloquea).
   */
  async guidePreview(orderId: string, auth: AuthContext): Promise<GuidePreview> {
    const order = await this.loadAccessibleOrder(orderId, auth);
    await this.ensureNotExternallyInvoiced(orderId);
    if (!order.warehouseId) {
      throw new BadRequestException('Asigna el pedido a una sede para generar guia.');
    }

    const sender = await this.coordinadora.senderFor(order.warehouseId);
    const client = extractInvoiceClient(order);
    // Pedido montado a mano: la ciudad se eligio del catalogo DANE al montarlo
    // (guardada en rawPayload.manual) — no hay nada que resolver.
    const manualCity = manualCityOf(order);
    const [city, packagePresets] = await Promise.all([
      manualCity
        ? Promise.resolve(manualCity)
        : this.coordinadora
            .resolveCity(order.warehouseId, client.address?.city ?? null, client.address?.department ?? null)
            .catch(() => null),
      this.warehouses.getGlobalPackagePresets(),
    ]);

    const { rotuloId, ...senderData } = sender;
    return {
      guide: await this.existingGuide(orderId),
      packagePresets,
      recipient: {
        name: client.name,
        document: client.identification,
        // Si el cliente MODIFICO su direccion por WhatsApp, la guia arranca con esa
        // (editable/verificable antes de generar). Si no, la de VTEX.
        address:
          order.addressStatus === 'modified' && order.confirmedAddress
            ? order.confirmedAddress
            : (client.address?.street ?? extractShippingAddress(order.rawPayload) ?? ''),
        cityCode: city?.code ?? null,
        cityName: city?.name ?? client.address?.city ?? null,
        phone: client.phone,
      },
      sender: senderData,
      rotuloId,
      package: {
        weight: 1,
        height: 10,
        width: 15,
        length: 20,
        units: 1,
        content: 'CELULAR',
        // Regla del negocio: se declara LA MITAD del total de la compra
        // (editable antes de generar si un envio necesita otro monto).
        declaredValue: Math.round((Number(order.totalValue) || 0) / 2),
        observations: '',
      },
    };
  }

  /**
   * Refresca el ESTADO DE ENVIO de los pedidos de una sede que tienen guia y aun
   * no estan entregados. Usa el rastreo por LOTES (una llamada por tanda), asi que
   * no hace N peticiones a Coordinadora. Devuelve cuantos se actualizaron.
   */
  async refreshShipping(warehouseId: string, auth: AuthContext): Promise<{ updated: number }> {
    const allowed = await this.warehouses.accessibleWarehouseIds(auth);
    if (allowed && !allowed.includes(warehouseId)) {
      throw new ForbiddenException('Sin acceso a esta sede');
    }
    return this.refreshShippingForWarehouse(warehouseId);
  }

  /**
   * Nucleo del refresco de envio de una sede, SIN control de acceso. Lo usa el
   * camino con auth (arriba) y tambien el job de fondo que consulta Coordinadora
   * en tiempo real (ShippingRefreshProcessor), que corre dentro de
   * `tenantContext.run(...)` — por eso aqui basta con getTenantContext().
   */
  async refreshShippingForWarehouse(warehouseId: string): Promise<{ updated: number }> {
    const { tenantId, prisma } = getTenantContext();

    const pending = await prisma.order.findMany({
      where: {
        warehouseId,
        guideNumber: { not: null },
        // Las guias de SKYDROPX van por su propio rastreo (abajo).
        AND: [{ OR: [{ shippingProvider: null }, { shippingProvider: { not: 'skydropx' } }] }],
        // Todo lo que NO esta entregado (los entregados ya no cambian). Incluye
        // shippingState null: en Prisma `NOT: {x:'entregado'}` excluiria los null
        // (NULL <> 'entregado' no es true en SQL), y esos justamente son los que
        // nunca se han rastreado.
        OR: [{ shippingState: null }, { shippingState: { not: 'entregado' } }],
      },
      select: { id: true, guideNumber: true, shippingState: true, shippingStatus: true },
    });

    let updated = 0;

    // SKYDROPX: rastreo por shipment id, secuencial (su API limita 2 req/s).
    const skyPending = await prisma.order.findMany({
      where: {
        warehouseId,
        skydropxShipmentId: { not: null },
        OR: [{ shippingState: null }, { shippingState: { not: 'entregado' } }],
      },
      select: { id: true, skydropxShipmentId: true, shippingState: true, shippingStatus: true },
    });
    for (const o of skyPending) {
      const t = await this.skydropx.tracking(o.skydropxShipmentId as string);
      if (!t) continue;
      const statusText = t.carrier ? `${t.carrier} · ${t.statusText}` : t.statusText;
      if (t.state !== o.shippingState || statusText !== o.shippingStatus) {
        await prisma.order.update({
          where: { id: o.id },
          data: { shippingState: t.state, shippingStatus: statusText, shippingUpdatedAt: new Date() },
        });
        updated++;
        // TRANSICION a ENTREGADO: toque 3 del flujo del respaldo, igual que
        // con Coordinadora.
        if (t.state === 'entregado' && o.shippingState !== 'entregado') {
          this.upsell.triggerDelivered(tenantId, prisma, o.id);
        }
      }
      await new Promise((r) => setTimeout(r, 600));
    }

    if (pending.length === 0) {
      if (updated > 0) await this.realtime.publish(tenantId, { kind: 'orders.refresh' });
      return { updated };
    }
    for (let i = 0; i < pending.length; i += SHIPPING_BATCH) {
      const chunk = pending.slice(i, i + SHIPPING_BATCH);
      const codigos = chunk.map((o) => o.guideNumber as string);
      let results;
      try {
        results = await this.coordinadora.trackGuidesBatch(warehouseId, codigos);
      } catch {
        continue; // best-effort: si una tanda falla, seguimos con las demas
      }
      const byCode = new Map(results.map((r) => [r.codigoRemision, r]));
      for (let k = 0; k < chunk.length; k++) {
        const order = chunk[k];
        const r = byCode.get(order.guideNumber as string) ?? results[k];
        if (!r) continue;
        const { state, status } = deriveShipping(r);
        // Solo escribir cuando el estado REALMENTE cambio. Como el job corre en
        // bucle, actualizar sin cambios generaria un SSE (y un refetch en el
        // navegador) inutil cada ciclo, ademas de writes de mas.
        if (state === order.shippingState && status === order.shippingStatus) continue;
        await prisma.order.update({
          where: { id: order.id },
          data: { shippingState: state, shippingStatus: status, shippingUpdatedAt: new Date() },
        });
        updated++;
        // TRANSICION a ENTREGADO: dispara el toque 3 del flujo del respaldo
        // (plantilla; el sender re-verifica celular/interes/duplicado).
        if (state === 'entregado' && order.shippingState !== 'entregado') {
          this.upsell.triggerDelivered(tenantId, prisma, order.id);
        }
      }
    }
    if (updated > 0) await this.realtime.publish(tenantId, { kind: 'orders.refresh' });
    return { updated };
  }

  /** Seguimiento detallado del pedido (Coordinadora o Skydropx). null si no tiene guia. */
  async orderTracking(orderId: string, auth: AuthContext): Promise<GuideTracking | null> {
    const order = await this.loadAccessibleOrder(orderId, auth);
    if (!order.warehouseId) return null;
    const guide = await this.existingGuide(orderId);
    if (!guide) return null;
    // Guia hecha por SKYDROPX: el rastreo va por su API e indica la
    // TRANSPORTADORA real por la que salio el envio.
    if (order.shippingProvider === 'skydropx' && order.skydropxShipmentId) {
      const t = await this.skydropx.tracking(order.skydropxShipmentId);
      const events = (t?.events ?? []).map((e, i) => ({
        codigo: i,
        descripcion: [e.description, e.location].filter(Boolean).join(' · '),
        fecha: e.date.slice(0, 10),
        hora: e.date.slice(11, 16),
      }));
      return {
        guideNumber: guide.number,
        carrier: t?.carrier ?? order.shippingStatus ?? 'Skydropx',
        codigoEstado: 0,
        descripcionEstado: t?.statusText ?? order.shippingStatus ?? 'Sin movimientos',
        fechaRecogida: '',
        fechaEntrega: t?.state === 'entregado' ? (events[0]?.fecha ?? '') : '',
        horaEntrega: '',
        nombreOrigen: '',
        nombreDestino: order.customerName ?? '',
        trackingUrl: '',
        estados: events,
        novedades: [],
      };
    }
    return this.coordinadora.trackGuide(order.warehouseId, guide.number, auth);
  }

  // === SKYDROPX: segunda transportadora (Coordinadora sigue de default) ===

  /** Departamento por ciudad de origen (las sedes del negocio). */
  private static readonly DEPT_BY_CITY: Record<string, string> = {
    medellin: 'Antioquia',
    pasto: 'Nariño',
    bogota: 'Bogotá D.C.',
    cali: 'Valle del Cauca',
  };

  /**
   * Parte el nombre de sede formato Coordinadora: "MEDELLIN (ANT) — Antioquia"
   * -> { city: 'MEDELLIN', dept: 'Antioquia' }. Con respaldo del mapa por
   * ciudad (contiene, no igualdad) — un departamento VACIO es 4xx en Skydropx.
   */
  private parseCityDept(cityName: string | null): { city: string; dept: string } {
    const raw = (cityName ?? '').trim();
    const [cityPart, deptPart] = raw.split('—');
    const city = (cityPart ?? '').replace(/\(.*?\)/g, '').trim() || raw;
    let dept = (deptPart ?? '').trim();
    if (!dept) {
      const norm = city
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .trim();
      for (const [key, d] of Object.entries(OrdersService.DEPT_BY_CITY)) {
        if (norm.includes(key)) {
          dept = d;
          break;
        }
      }
    }
    return { city, dept: dept || city };
  }

  /** Cotiza el envio del pedido en TODAS las transportadoras de Skydropx. */
  async skydropxQuote(
    orderId: string,
    input: SkydropxQuoteInput,
    auth: AuthContext,
  ): Promise<SkydropxQuoteResponse> {
    await this.ensureNotExternallyInvoiced(orderId);
    const order = await this.loadAccessibleOrder(orderId, auth);
    if (!order.warehouseId) throw new BadRequestException('Asigna el pedido a una sede para cotizar.');
    // Remitente: la PLANTILLA Skydropx fijada en la sede manda (verificada:
    // habilita paqueterias que exigen origen verificado, ej. Inter); sin
    // plantilla, direccion cruda de la conexion Coordinadora.
    const { prisma: db } = getTenantContext();
    const sedeCfg = await db.skydropxSedeConfig
      .findUnique({ where: { warehouseId: order.warehouseId } })
      .catch(() => null);
    const sender = await this.coordinadora.senderFor(order.warehouseId);
    const cpFrom = sender.postalCode ?? postalCodeByCity(sender.cityName);
    if (!sedeCfg && !cpFrom) {
      throw new BadRequestException(
        'La sede no tiene remitente Skydropx fijado ni código postal de origen (Ajustes de la sede).',
      );
    }
    const client = extractInvoiceClient(order);
    const cpTo = (input.postalCodeTo ?? client.address?.zipCode ?? '').trim();
    let cityTo = (input.cityTo ?? '').trim();
    let deptTo = (input.departmentTo ?? '').trim();
    if (!cityTo) {
      // Ciudad AUTOMATICA como en el modo Coordinadora: se resuelve contra su
      // catalogo con la ciudad del pedido (trae el departamento completo).
      const resolved = await this.coordinadora
        .resolveCity(order.warehouseId, client.address?.city ?? null, client.address?.department ?? null)
        .catch(() => null);
      cityTo = resolved
        ? resolved.name.replace(/\s*\(.*?\)\s*/g, '').trim()
        : (client.address?.city ?? '').trim();
      deptTo = deptTo || resolved?.department || (client.address?.department ?? '').trim();
    }
    deptTo = deptTo || cityTo;
    if (!cpTo && !cityTo) {
      throw new BadRequestException(
        'El pedido no trae código postal ni ciudad de destino: completa al menos uno para cotizar.',
      );
    }
    const senderCity = this.parseCityDept(sender.cityName);
    const { quotationId, rates } = await this.skydropx.quote({
      from: sedeCfg
        ? { address_template_id: sedeCfg.addressTemplateId }
        : {
            country_code: 'CO',
            postal_code: cpFrom as string,
            area_level1: senderCity.dept,
            area_level2: senderCity.city,
            area_level3: '',
          },
      to: {
        country_code: 'CO',
        postal_code: cpTo,
        area_level1: deptTo,
        area_level2: cityTo,
        area_level3: '',
      },
      parcel: {
        length: input.package.length,
        width: input.package.width,
        height: input.package.height,
        weight: input.package.weight,
        declared_amount: input.package.declaredValue,
      },
    });
    return { quotationId, postalCodeTo: cpTo, cityTo, rates };
  }

  /** Genera la guia por SKYDROPX con la tarifa elegida (mismo pipeline). */
  async generateGuideSkydropx(
    orderId: string,
    input: CreateSkydropxGuideInput,
    auth: AuthContext,
  ): Promise<Guide> {
    this.acquireLock(`${orderId}:guide`, 'Ya hay una guía en curso para este pedido.');
    try {
      return await this.generateGuideSkydropxLocked(orderId, input, auth);
    } finally {
      this.opLocks.delete(`${orderId}:guide`);
    }
  }

  private async generateGuideSkydropxLocked(
    orderId: string,
    input: CreateSkydropxGuideInput,
    auth: AuthContext,
  ): Promise<Guide> {
    await this.ensureNotExternallyInvoiced(orderId);
    const order = await this.loadAccessibleOrder(orderId, auth);
    if (!order.warehouseId) {
      throw new BadRequestException('Asigna el pedido a una sede para generar guia.');
    }
    const already = await this.existingGuide(orderId);
    if (already) {
      throw new ConflictException(
        `Este pedido ya tiene guia (${already.number}). Anulala antes de generar otra.`,
      );
    }
    const { tenantId, prisma } = getTenantContext();
    // La plantilla Skydropx fijada en la sede MANDA (origen verificado).
    const sedeCfg = await prisma.skydropxSedeConfig
      .findUnique({ where: { warehouseId: order.warehouseId } })
      .catch(() => null);
    const sender = await this.coordinadora.senderFor(order.warehouseId);
    const cpFrom = sender.postalCode ?? postalCodeByCity(sender.cityName);
    if (!sedeCfg && !cpFrom) {
      throw new BadRequestException(
        'La sede no tiene remitente Skydropx fijado ni código postal de origen (Ajustes de la sede).',
      );
    }
    const client = extractInvoiceClient(order);
    const senderCity = this.parseCityDept(sender.cityName);

    // Skydropx EXIGE email en ambas direcciones (422 verificado): el del
    // remitente es el correo de envios del negocio (fijo para TODAS las
    // sedes); el del destinatario, el real del pedido o el mismo de respaldo.
    const senderEmail = process.env.SKYDROPX_SENDER_EMAIL ?? 'smartg.envios@gmail.com';
    const ship = await this.skydropx.createShipment({
      rateId: input.rateId,
      quotationId: input.quotationId,
      carrierName: input.carrierCode,
      packagingCode: input.packagingCode,
      from: sedeCfg
        ? { address_template_id: sedeCfg.addressTemplateId }
        : {
            country_code: 'CO',
            postal_code: cpFrom as string,
            area_level1: senderCity.dept,
            area_level2: senderCity.city,
            area_level3: '',
            street1: sender.address,
            name: sender.name,
            company: sender.name,
            phone: sender.phone,
            email: senderEmail,
          },
      to: {
        country_code: 'CO',
        postal_code: input.postalCodeTo,
        area_level1:
          (input.departmentTo ?? client.address?.department ?? '').trim() ||
          (input.cityTo ?? client.address?.city ?? '').trim(),
        area_level2: (input.cityTo ?? client.address?.city ?? '').trim(),
        area_level3: '',
        street1: input.recipient.address,
        name: input.recipient.name,
        phone: input.recipient.phone,
        email: input.recipient.email?.trim() || client.email?.trim() || senderEmail,
      },
      parcel: {
        length: input.package.length,
        width: input.package.width,
        height: input.package.height,
        weight: input.package.weight,
        declared_amount: input.package.declaredValue,
      },
      packageContent: input.packageContent,
    });
    const carrier = ship.carrier || input.carrier || 'Skydropx';

    // Pipeline identico al de Coordinadora: aviso + evento + denormalizado.
    await Promise.all([
      prisma.orderMessage.create({
        data: {
          orderId,
          authorId: auth.userId,
          authorName: displayName(auth),
          kind: 'system',
          body: `Guia ${ship.trackingNumber} generada via Skydropx (${carrier}).`,
          imeis: [],
        },
      }),
      prisma.orderEvent.create({
        data: {
          orderId,
          type: 'guide_generated',
          actorId: auth.userId,
          actorName: displayName(auth),
          data: {
            number: ship.trackingNumber,
            id: ship.shipmentId,
            url: ship.labelUrl,
            cod: null,
            via: 'skydropx',
            carrier,
          } as Prisma.InputJsonValue,
        },
      }),
      prisma.order.update({
        where: { id: orderId },
        data: {
          guideNumber: ship.trackingNumber,
          shippingState: 'sin_movimientos',
          shippingStatus: `${carrier} · Guia creada`,
          shippingUpdatedAt: new Date(),
          shippingProvider: 'skydropx',
          skydropxShipmentId: ship.shipmentId || null,
        },
      }),
    ]);

    // Etiqueta -> chat interno + WhatsApp; cierre segun el origen. Best-effort.
    const label = ship.labelUrl ? await this.skydropx.downloadLabel(ship.labelUrl) : null;
    const [rotuloKey] = await Promise.all([
      this.attachRotulo(orderId, order, { number: ship.trackingNumber }, label, auth),
      order.provider === 'manual'
        ? this.finalizeManual(order, auth).catch(() => null)
        : this.finalizeVtex(order, auth).catch(() => null),
    ]);
    if (label) {
      void this.whatsapp
        .sendGuideByWhatsApp(
          tenantId,
          prisma,
          { id: orderId, customerPhone: order.customerPhone, customerName: order.customerName },
          label,
          rotuloKey,
        )
        .catch(() => null);
    }
    await this.realtime.publish(tenantId, { kind: 'orders.refresh' });
    return {
      id: ship.shipmentId || ship.trackingNumber,
      number: ship.trackingNumber,
      url: ship.labelUrl ?? '',
      createdAt: new Date().toISOString(),
    };
  }

  /** Busca ciudades (selector de destino) via la conexion de la sede del pedido. */
  async searchGuideCities(orderId: string, query: string, auth: AuthContext): Promise<CoordinadoraCity[]> {
    const order = await this.loadAccessibleOrder(orderId, auth);
    if (!order.warehouseId) throw new BadRequestException('Asigna el pedido a una sede.');
    return this.coordinadora.searchCities(order.warehouseId, query);
  }

  /**
   * Flujo completo en un paso: factura de Alegra -> guia de Coordinadora (que ya
   * cierra el pedido en VTEX y genera el MKT). Alternativa al flujo por pasos,
   * que sigue existiendo igual.
   *
   * Es secuencial a proposito: el cierre en VTEX necesita el Nº de factura de
   * Alegra, asi que la guia no puede arrancar antes. Reusa createInvoice/
   * generateGuide, de modo que hereda sus validaciones (no re-facturar, no
   * duplicar guia) y sus mensajes en el chat.
   */
  async processAll(
    orderId: string,
    input: ProcessAllInput,
    auth: AuthContext,
  ): Promise<ProcessAllResult> {
    const invoice = await this.createInvoice(orderId, input.invoice, auth);
    const guide = await this.generateGuide(orderId, input.guide, auth);
    return { invoice, guide };
  }

  /** Genera la guia en Coordinadora, adjunta el rotulo al chat y registra el evento. */
  async generateGuide(orderId: string, input: CreateGuideInput, auth: AuthContext): Promise<Guide> {
    this.acquireLock(`${orderId}:guide`, 'Ya hay una guía en curso para este pedido.');
    try {
      return await this.generateGuideLocked(orderId, input, auth);
    } finally {
      this.opLocks.delete(`${orderId}:guide`);
    }
  }

  private async generateGuideLocked(
    orderId: string,
    input: CreateGuideInput,
    auth: AuthContext,
  ): Promise<Guide> {
    await this.ensureNotExternallyInvoiced(orderId);
    const order = await this.loadAccessibleOrder(orderId, auth);
    if (!order.warehouseId) {
      throw new BadRequestException('Asigna el pedido a una sede para generar guia.');
    }

    // Evitar doble generacion.
    const already = await this.existingGuide(orderId);
    if (already) {
      throw new ConflictException(
        `Este pedido ya tiene guia (${already.number}). Anulala en Coordinadora antes de generar otra.`,
      );
    }

    const { tenantId, prisma } = getTenantContext();

    // Recaudo CONTRAENTREGA: disponible para TODOS los pedidos (manuales y de
    // marketplace). Referencia del recaudo = Nº de factura de Alegra si ya
    // existe; si no, el Nº del pedido.
    let recaudo: { referencia: string; valor: number } | undefined;
    if (input.codValue != null) {
      const inv = await this.existingInvoice(orderId);
      recaudo = { referencia: inv?.number || order.externalId, valor: input.codValue };
    }

    // referencia = null: en el portal de Coordinadora esa columna va vacia (el
    // numero de guia ya identifica el envio; el user no quiere el MKT ahi).
    const { guide, rotulo } = await this.coordinadora.generateGuideForWarehouse(
      order.warehouseId,
      input.recipient,
      input.package,
      null,
      input.rotuloId,
      auth,
      recaudo,
    );

    // Mensaje de sistema + evento + denormalizado del envio: tres escrituras
    // independientes -> juntas (antes eran tres esperas encadenadas). Va primero
    // para que el aviso de la guia quede antes que el rotulo en el chat.
    await Promise.all([
      prisma.orderMessage.create({
        data: {
          orderId,
          authorId: auth.userId,
          authorName: displayName(auth),
          kind: 'system',
          body: recaudo
            ? `Guia ${guide.number} generada en Coordinadora · recaudo contraentrega ${formatCop(recaudo.valor)}.`
            : `Guia ${guide.number} generada en Coordinadora.`,
          imeis: [],
        },
      }),
      prisma.orderEvent.create({
        data: {
          orderId,
          type: 'guide_generated',
          actorId: auth.userId,
          actorName: displayName(auth),
          data: {
            number: guide.number,
            id: guide.id,
            url: guide.url,
            cod: recaudo?.valor ?? null,
          } as Prisma.InputJsonValue,
        },
      }),
      // Denormalizar el Nº de guia + estado inicial (para listar/filtrar el envio).
      prisma.order.update({
        where: { id: orderId },
        data: {
          guideNumber: guide.number,
          shippingState: 'sin_movimientos',
          shippingStatus: 'Sin movimientos',
          shippingUpdatedAt: new Date(),
        },
      }),
    ]);

    // Adjuntar el rotulo al chat y CERRAR el pedido solo dependen de la guia y
    // no entre si -> en paralelo. El cierre segun el origen: marketplace = VTEX
    // (start-handling + invoice + tracking + MKT); montado a mano = cierre local
    // (sin VTEX ni MKT). Ambos best-effort: si fallan, la guia ya quedo.
    const [rotuloKey] = await Promise.all([
      this.attachRotulo(orderId, order, guide, rotulo, auth),
      order.provider === 'manual'
        ? this.finalizeManual(order, auth).catch(() => null)
        : this.finalizeVtex(order, auth).catch(() => null),
    ]);

    // GUIA AL CLIENTE por WhatsApp (plantilla con el PDF del rotulo adjunto:
    // llega SIEMPRE, con o sin ventana de 24h). Fire-and-forget: la guia ya
    // quedo y esto jamas la bloquea; un fallo de entrega avisa al chat interno.
    if (rotulo) {
      void this.whatsapp
        .sendGuideByWhatsApp(
          tenantId,
          prisma,
          { id: orderId, customerPhone: order.customerPhone, customerName: order.customerName },
          rotulo,
          rotuloKey,
        )
        .catch(() => null);
    }

    await this.realtime.publish(tenantId, { kind: 'orders.refresh' });

    return { id: guide.id, number: guide.number, url: guide.url, createdAt: new Date().toISOString() };
  }

  /** Sube el rotulo (sticker) a storage y lo adjunta al chat. Best-effort.
   * Devuelve la KEY del PDF en storage (la reutiliza la guia por WhatsApp). */
  private async attachRotulo(
    orderId: string,
    order: OrderWithItems,
    guide: { number: string },
    rotulo: Buffer | null,
    auth: AuthContext,
  ): Promise<string | null> {
    if (!rotulo || !this.storage.isConfigured()) return null;
    const { tenantId, prisma } = getTenantContext();
    try {
      const clientName = (order.customerName ?? '').trim().toUpperCase() || guide.number;
      const fileName = `GUIA-${clientName}.pdf`;
      const key = `tenants/${tenantId}/orders/${orderId}/${slugForKey(fileName)}-${randomUUID()}.pdf`;
      await this.storage.put(key, rotulo, 'application/pdf', contentDisposition(fileName));
      await prisma.orderMessage.create({
        data: {
          orderId,
          authorId: auth.userId,
          authorName: displayName(auth),
          kind: 'document',
          body: fileName,
          attachmentKey: key,
          attachmentMime: 'application/pdf',
          imeis: [],
        },
      });
      return key;
    } catch {
      // no bloquear la guia por un fallo al adjuntar el rotulo
      return null;
    }
  }

  /**
   * Automatico tras la guia: factura el pedido en VTEX (start-handling + invoice
   * con tracking = numero de guia) y lo deja en `invoiced`. Best-effort e
   * idempotente. Requiere factura de Alegra (para el numero) + guia.
   */
  private async finalizeVtex(order: OrderWithItems, auth: AuthContext): Promise<void> {
    if (!order.warehouseId) return;
    const { tenantId, prisma } = getTenantContext();

    // Idempotente: no re-facturar en VTEX.
    const done = await prisma.orderEvent.findFirst({
      where: { orderId: order.id, type: 'vtex_invoiced' },
    });
    if (done) return;

    const invoice = await this.existingInvoice(order.id);
    const guide = await this.existingGuide(order.id);
    if (!invoice || !guide) {
      await this.systemMessage(
        order.id,
        auth,
        'No se facturo en VTEX: falta la factura de Alegra o la guia de Coordinadora.',
      );
      return;
    }

    const wh = await prisma.warehouse.findUnique({
      where: { id: order.warehouseId },
      select: { invoicePrefix: true },
    });
    // invoiceNumber = prefijo de la sede + numero de factura de Alegra (ej. "PA25879").
    const invoiceNumber = `${wh?.invoicePrefix ?? ''}${invoice.number}`;
    const invoiceValue = vtexValueCents(order.rawPayload) ?? Math.round(Number(order.totalValue) * 100);

    let mktPdf: Buffer | null = null;
    try {
      const http = await this.vtex.forTenant(tenantId, order.accountName);
      // start-handling solo aplica desde ready-for-handling; si ya esta en handling
      // devuelve error -> best-effort (lo ignoramos y seguimos con la factura).
      await this.vtex.startHandling(http, order.externalId).catch(() => null);
      await this.vtex.notifyInvoice(http, order.externalId, {
        type: 'Output',
        issuanceDate: new Date().toISOString(),
        invoiceNumber,
        invoiceValue,
        trackingNumber: guide.number,
        trackingUrl: 'https://coordinadora.com/rastreo/rastreo-de-guia/',
        courier: 'Transportadora estándar',
      });
      // Re-traer el pedido (ya con la factura/tracking cargados) y generar el MKT.
      const detail = await this.vtex.getOrder(http, order.externalId);
      mktPdf = await this.mkt.build(detail).catch(() => null);
    } catch (err) {
      const msg = vtexErrorMessage(err);
      await this.systemMessage(order.id, auth, `No se pudo facturar en VTEX: ${msg}`.slice(0, 400));
      return;
    }

    // Estado local -> invoiced (inmediato, sin depender del webhook de VTEX).
    await prisma.order.update({ where: { id: order.id }, data: { status: 'invoiced' } });
    await prisma.orderEvent.create({
      data: {
        orderId: order.id,
        type: 'vtex_invoiced',
        actorId: auth.userId,
        actorName: displayName(auth),
        data: { invoiceNumber, tracking: guide.number } as Prisma.InputJsonValue,
      },
    });
    await this.systemMessage(order.id, auth, `Facturado en VTEX · MKT ${invoiceNumber}.`);

    // Adjuntar el MKT (identico al Print order de VTEX) al chat como archivo.
    if (mktPdf && this.storage.isConfigured()) {
      try {
        const fileName = `${order.externalId}.pdf`; // ej. MKT-1567202541865-01.pdf
        const key = `tenants/${tenantId}/orders/${order.id}/${slugForKey(fileName)}-${randomUUID()}.pdf`;
        await this.storage.put(key, mktPdf, 'application/pdf', contentDisposition(fileName));
        await prisma.orderMessage.create({
          data: {
            orderId: order.id,
            authorId: auth.userId,
            authorName: displayName(auth),
            kind: 'document',
            body: fileName,
            attachmentKey: key,
            attachmentMime: 'application/pdf',
            imeis: [],
          },
        });
      } catch {
        // no bloquear por un fallo al adjuntar el MKT
      }
    }
    await this.realtime.publish(tenantId, { kind: 'orders.refresh' });
  }

  /**
   * Cierre de un pedido MONTADO a mano: cuando ya tiene factura de Alegra y guia
   * de Coordinadora, pasa a "Facturados" (evento manual_completed + status
   * invoiced). Sin VTEX y sin MKT — este pedido no existe en el marketplace.
   * Idempotente y best-effort (se llama tras facturar y tras generar la guia).
   */
  private async finalizeManual(order: OrderWithItems, auth: AuthContext): Promise<void> {
    if (!order.warehouseId) return;
    const { tenantId, prisma } = getTenantContext();

    const done = await prisma.orderEvent.findFirst({
      where: { orderId: order.id, type: 'manual_completed' },
    });
    if (done) return;

    const [invoice, guide] = await Promise.all([
      this.existingInvoice(order.id),
      this.existingGuide(order.id),
    ]);
    // Aun falta una de las dos patas: se completara en el otro paso.
    if (!invoice || !guide) return;

    await prisma.order.update({ where: { id: order.id }, data: { status: 'invoiced' } });
    await prisma.orderEvent.create({
      data: {
        orderId: order.id,
        type: 'manual_completed',
        actorId: auth.userId,
        actorName: displayName(auth),
        data: { invoiceNumber: invoice.number, tracking: guide.number } as Prisma.InputJsonValue,
      },
    });
    await this.systemMessage(
      order.id,
      auth,
      `Pedido completado · Factura ${invoice.number} + guia ${guide.number} (montado a mano, sin MKT).`,
    );
    await this.realtime.publish(tenantId, { kind: 'orders.refresh' });
  }

  private async systemMessage(orderId: string, auth: AuthContext, body: string): Promise<void> {
    const { prisma } = getTenantContext();
    await prisma.orderMessage.create({
      data: { orderId, authorId: auth.userId, authorName: displayName(auth), kind: 'system', body, imeis: [] },
    });
  }

  /**
   * Carga un pedido verificando acceso: los generales (warehouseId null) solo los
   * ve un admin; los de una sede, quien tenga acceso a esa sede.
   */
  private async loadAccessibleOrder(orderId: string, auth: AuthContext): Promise<OrderWithItems> {
    const { prisma } = getTenantContext();
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { orderBy: { name: 'asc' } } },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');

    if (order.warehouseId === null) {
      if (!isAdmin(auth)) throw new ForbiddenException('Sin acceso a este pedido');
    } else {
      const allowed = await this.warehouses.accessibleWarehouseIds(auth);
      if (allowed && !allowed.includes(order.warehouseId)) {
        throw new ForbiddenException('Sin acceso a este pedido');
      }
    }
    return order;
  }

  async stats(): Promise<{ readyForHandling: number; handling: number; connections: number }> {
    const { prisma } = getTenantContext();
    const [readyForHandling, handling, connections] = await Promise.all([
      prisma.order.count({ where: { status: 'ready-for-handling', warehouseId: null } }),
      prisma.order.count({ where: { status: 'handling' } }),
      prisma.marketplaceConnection.count({ where: { status: 'connected' } }),
    ]);
    return { readyForHandling, handling, connections };
  }

  private buildOrderBy(
    sort: ListOrdersQuery['sort'],
    dir: ListOrdersQuery['dir'],
  ): Prisma.OrderOrderByWithRelationInput {
    switch (sort) {
      case 'quantity':
        return { totalUnits: dir };
      case 'price':
        return { totalValue: dir };
      case 'date':
      default:
        return { marketplaceCreatedAt: dir };
    }
  }

  private toSummary(
    o: OrderWithItems,
    hasDevicePhoto = false,
    unreadCount = 0,
    viewerId?: string,
    reactions: OrderSummary['reactions'] = [],
    waConfirmation: OrderSummary['waConfirmation'] = null,
  ): OrderSummary {
    return {
      unreadCount,
      waConfirmation,
      // Plataforma de origen (solo montados a mano; en VTEX el provider basta).
      platform: manualPlatformOf(o),
      claimedBy: o.claimedById
        ? { userId: o.claimedById, name: o.claimedByName ?? '', mine: o.claimedById === viewerId }
        : null,
      reactions,
      id: o.id,
      externalId: o.externalId,
      provider: o.provider as OrderSummary['provider'],
      accountName: o.accountName,
      customerName: o.customerName,
      customerDocument: o.customerDocument,
      status: o.status,
      totalValue: o.totalValue.toString(),
      currency: o.currency,
      totalUnits: o.totalUnits,
      items: o.items.map((i) => ({
        sku: i.sku,
        name: i.name,
        quantity: i.quantity,
        unitPrice: i.unitPrice.toString(),
      })),
      warehouseId: o.warehouseId,
      assignedAt: o.assignedAt ? o.assignedAt.toISOString() : null,
      hasDevicePhoto,
      guideNumber: o.guideNumber,
      shippingState: (o.shippingState as OrderSummary['shippingState']) ?? null,
      shippingStatus: o.shippingStatus,
      shippingUpdatedAt: o.shippingUpdatedAt ? o.shippingUpdatedAt.toISOString() : null,
      addressStatus: (o.addressStatus as OrderSummary['addressStatus']) ?? null,
      confirmedAddress: o.confirmedAddress,
      addressConfirmedAt: o.addressConfirmedAt ? o.addressConfirmedAt.toISOString() : null,
      marketplaceCreatedAt: o.marketplaceCreatedAt.toISOString(),
      receivedAt: o.receivedAt.toISOString(),
    };
  }

  private toDetail(
    o: OrderWithItems,
    hasDevicePhoto = false,
    unreadCount = 0,
    viewerId?: string,
    reactions: OrderSummary['reactions'] = [],
  ): OrderDetail {
    return {
      ...this.toSummary(o, hasDevicePhoto, unreadCount, viewerId, reactions),
      // El correo REAL (el de facturar), nunca el enmascarado @ct.vtex.com.br.
      customerEmail: extractRealEmail(o.rawPayload) ?? pickRealEmail(o.customerEmail),
      customerPhone: o.customerPhone,
      shippingAddress: extractShippingAddress(o.rawPayload),
      updatedAt: o.updatedAt.toISOString(),
    };
  }

  private async toMessage(
    m: OrderMessageRow & { reactions?: MessageReactionRow[] },
    viewerId?: string,
  ): Promise<OrderMessageDto> {
    // La URL del adjunto se firma al vuelo (nunca se persiste una URL que expira).
    const attachmentUrl =
      m.attachmentKey && this.storage.isConfigured()
        ? await this.storage.getSignedUrl(m.attachmentKey)
        : null;
    return {
      id: m.id,
      orderId: m.orderId,
      authorId: m.authorId,
      authorName: m.authorName,
      kind: m.kind as OrderMessageDto['kind'],
      body: m.body,
      caption: m.caption ?? null,
      attachmentUrl,
      attachmentMime: m.attachmentMime,
      imeis: m.imeis,
      mentions: m.mentions,
      replyToId: m.replyToId ?? null,
      reactions: groupReactions(m.reactions ?? [], viewerId),
      createdAt: m.createdAt.toISOString(),
    };
  }

  private toEvent(e: OrderEventRow): OrderEventDto {
    return {
      id: e.id,
      type: e.type,
      actorName: e.actorName,
      data: (e.data ?? {}) as Record<string, unknown>,
      createdAt: e.createdAt.toISOString(),
    };
  }
}

/**
 * Extrae una direccion de envio legible del rawPayload de VTEX. Defensivo: la
 * forma del payload varia, devolvemos null si no hay datos utiles.
 */
function extractShippingAddress(rawPayload: unknown): string | null {
  if (!rawPayload || typeof rawPayload !== 'object') return null;
  const shippingData = (rawPayload as Record<string, unknown>).shippingData;
  const address =
    shippingData && typeof shippingData === 'object'
      ? (shippingData as Record<string, unknown>).address
      : undefined;
  if (!address || typeof address !== 'object') return null;
  const a = address as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

  const line1 = [str(a.street), str(a.number)].filter(Boolean).join(' ');
  const parts = [
    line1,
    str(a.complement),
    str(a.neighborhood),
    str(a.city),
    str(a.state),
    str(a.postalCode),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * Extrae los datos del cliente para facturar del rawPayload de VTEX. OJO con el
 * email: el de clientProfileData suele ser el ENMASCARADO (...@ct.vtex.com.br);
 * el real viene en openTextField.value (las "notas" del marketplace).
 */
function extractInvoiceClient(order: OrderWithItems): InvoiceClient {
  const raw = (order.rawPayload ?? {}) as Record<string, unknown>;
  const cpd = (raw.clientProfileData ?? {}) as Record<string, unknown>;
  const notes = (raw.openTextField as { value?: unknown } | undefined)?.value;
  const email = pickRealEmail(notes, cpd.email);
  const phone = normalizeCoPhone(
    order.customerPhone ?? (typeof cpd.phone === 'string' ? cpd.phone : null),
  );

  const addr = ((raw.shippingData as { address?: unknown } | undefined)?.address ?? {}) as Record<
    string,
    unknown
  >;
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const base = [str(addr.street), str(addr.number), str(addr.complement)].filter(Boolean).join(' ');
  const hood = str(addr.neighborhood);
  const street = base ? (hood ? `${base}, ${hood}` : base) : null;
  const city = str(addr.city) || null;
  const department = str(addr.state) || null;
  const zipCode = str(addr.postalCode) || null;

  return {
    name: order.customerName,
    firstName: typeof cpd.firstName === 'string' ? cpd.firstName : null,
    lastName: typeof cpd.lastName === 'string' ? cpd.lastName : null,
    identification: order.customerDocument,
    email,
    phone,
    address: street || city ? { street, city, department, zipCode } : null,
  };
}

/** Guias por llamada de rastreo (el rastreo acepta varias en una sola peticion). */
const SHIPPING_BATCH = 40;

/**
 * Estado normalizado del envio desde el rastreo de Coordinadora:
 * entregado > novedad > en_transito > sin_movimientos.
 */
function deriveShipping(r: RastreoResult): { state: string; status: string } {
  if (r.fechaEntrega.trim()) {
    return { state: 'entregado', status: r.descripcionEstado.trim() || 'Entregado' };
  }
  if (r.novedades.length > 0) {
    const last = r.novedades[r.novedades.length - 1];
    return { state: 'novedad', status: last?.descripcion?.trim() || 'Novedad' };
  }
  const desc = r.descripcionEstado.trim() || r.estados[0]?.descripcion?.trim() || '';
  if (desc || r.estados.length > 0) return { state: 'en_transito', status: desc || 'En transito' };
  return { state: 'sin_movimientos', status: 'Sin movimientos' };
}

/** Valor del pedido en CENTAVOS desde el rawPayload de VTEX (detail.value ya viene en centavos). */
function vtexValueCents(rawPayload: unknown): number | null {
  const v = (rawPayload as { value?: unknown } | null)?.value;
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
}

/** Mensaje util de un error de VTEX (extrae el detalle del body de la respuesta). */
function vtexErrorMessage(err: unknown): string {
  if (isAxiosError(err)) {
    const status = err.response?.status;
    const data = err.response?.data as
      | { error?: { message?: string; code?: string }; message?: string }
      | string
      | undefined;
    let detail: string | undefined;
    if (typeof data === 'string') detail = data;
    else if (data && typeof data === 'object') detail = data.error?.message ?? data.message;
    return `${status ?? ''} ${detail ?? err.message}`.trim();
  }
  return err instanceof Error ? err.message : 'error desconocido';
}

/**
 * Plataforma de origen de un pedido MONTADO a mano (rawPayload.manual.platform).
 * null para los de marketplace y para manuales viejos sin plataforma guardada.
 */
function manualPlatformOf(order: OrderWithItems): { id: string; name: string } | null {
  if (order.provider !== 'manual') return null;
  const p = (
    order.rawPayload as { manual?: { platform?: { id?: unknown; name?: unknown } } } | null
  )?.manual?.platform;
  if (!p || typeof p.id !== 'string' || typeof p.name !== 'string' || !p.id || !p.name) return null;
  return { id: p.id, name: p.name };
}

/**
 * Ciudad DANE elegida al MONTAR el pedido a mano (guardada en rawPayload.manual).
 * null para pedidos de marketplace (su ciudad se resuelve contra el catalogo).
 */
function manualCityOf(order: OrderWithItems): CoordinadoraCity | null {
  if (order.provider !== 'manual') return null;
  const m = (order.rawPayload as { manual?: { cityCode?: unknown; cityName?: unknown } } | null)
    ?.manual;
  if (!m || typeof m.cityCode !== 'string' || !m.cityCode) return null;
  return {
    code: m.cityCode,
    name: typeof m.cityName === 'string' ? m.cityName : '',
    department: '',
  };
}

/** "$1.600.000" para mensajes de sistema (es-CO, sin decimales). */
function formatCop(value: number): string {
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `$${Math.round(value)}`;
  }
}

/** Telefono colombiano sin el prefijo +57 (para la factura). "+573137097919" -> "3137097919". */
function normalizeCoPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '').replace(/^57(?=\d{10}$)/, '');
  return digits || null;
}

/**
 * Email REAL del cliente desde el rawPayload de VTEX (el mismo que se usa para
 * facturar): el de clientProfileData es el enmascarado (...@ct.vtex.com.br); el
 * real viene en openTextField.value (las notas del marketplace). null si no hay.
 */
function extractRealEmail(rawPayload: unknown): string | null {
  const raw = (rawPayload ?? {}) as Record<string, unknown>;
  const cpd = (raw.clientProfileData ?? {}) as Record<string, unknown>;
  const notes = (raw.openTextField as { value?: unknown } | undefined)?.value;
  return pickRealEmail(notes, cpd.email);
}

/** Devuelve el primer candidato que sea un email real (no el enmascarado de VTEX). */
function pickRealEmail(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === 'string') {
      const e = c.trim();
      if (/@/.test(e) && !/ct\.vtex\.com\.br/i.test(e) && e.length < 120) return e;
    }
  }
  return null;
}

/**
 * Ajusta los precios sugeridos para que la factura sume el TOTAL del pedido
 * (envio y recargos incluidos): eso es lo que pago el cliente y sobre eso se
 * factura. La diferencia contra la suma de productos se reparte proporcional
 * entre las lineas; cada aporte se redondea a multiplo de la cantidad (precio
 * unitario entero) y la linea mayor absorbe el remanente. Si alguna linea no
 * tiene precio (el usuario la va a llenar a mano) no se toca nada.
 */
function prorateToOrderTotal<T extends { codes: string[]; suggestedPrice: string | null }>(
  lines: T[],
  orderTotal: number,
): T[] {
  if (lines.length === 0 || !Number.isFinite(orderTotal) || orderTotal <= 0) return lines;
  if (lines.some((l) => l.suggestedPrice == null || Number.isNaN(Number(l.suggestedPrice)))) {
    return lines;
  }
  // OJO: cada linea es UN equipo (una foto), cantidad 1 — aunque `codes` traiga
  // 2 IMEIs (dual-SIM). Usar codes.length como cantidad duplicaba la suma y el
  // prorrateo "bajaba" el precio hasta la mitad para cuadrar el total.
  const totals = lines.map((l) => Number(l.suggestedPrice));
  const sum = totals.reduce((a, b) => a + b, 0);
  const diff = Math.round(orderTotal - sum);
  if (sum <= 0 || diff === 0) return lines;

  const maxIdx = totals.indexOf(Math.max(...totals));
  const shares = lines.map((_, i) =>
    i === maxIdx ? 0 : Math.round((diff * (totals[i] ?? 0)) / sum),
  );
  shares[maxIdx] = diff - shares.reduce((a, b) => a + b, 0);

  const adjusted = lines.map((l, i) => ({
    ...l,
    suggestedPrice: String(Number(l.suggestedPrice) + (shares[i] ?? 0)),
  }));
  // Un descuento enorme podria dejar precios negativos: mejor no sugerir nada raro.
  return adjusted.some((l) => Number(l.suggestedPrice) < 0) ? lines : adjusted;
}

/**
 * Precio unitario (desde VTEX) para una linea de factura. El nombre del producto
 * viene de Alegra; lo cruzamos con los items del pedido por coincidencia de tokens.
 * Con un solo item en el pedido, ese es el precio. null si no hay match.
 */
function vtexPriceForProduct(
  productName: string | null,
  items: Array<{ name: string; unitPrice: string }>,
): string | null {
  if (items.length === 0) return null;
  if (items.length === 1) return items[0].unitPrice;
  if (!productName) return null;

  const tokens = tokenizeName(productName);
  let best: { price: string; score: number } | null = null;
  for (const it of items) {
    const itTokens = new Set(tokenizeName(it.name));
    const score = tokens.reduce((n, t) => n + (itTokens.has(t) ? 1 : 0), 0);
    if (score > 0 && (!best || score > best.score)) {
      best = { price: it.unitPrice, score };
    }
  }
  return best?.price ?? null;
}

function tokenizeName(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

/** Slug ASCII para el nombre de archivo dentro de la key de storage. */
/** Texto corto de vista previa de un mensaje para la bandeja de notificaciones. */
function messagePreview(kind: string, body: string | null): string {
  switch (kind) {
    case 'imei_photo':
      return '📷 Foto IMEI';
    case 'serial_photo':
      return '📷 Foto serial';
    case 'document':
      return `📄 ${body ?? 'Documento'}`;
    case 'file':
      return `📎 ${body ?? 'Archivo'}`;
    default:
      return (body ?? '').slice(0, 120) || 'Mensaje';
  }
}

/** Extension para la key del objeto: la del nombre original, o derivada del mime. */
function extFromNameOrMime(name: string, mime: string): string {
  const fromName = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1];
  if (fromName) return `.${fromName.toLowerCase()}`;
  const sub = mime.split('/')[1];
  return sub ? `.${sub.split(';')[0].trim()}` : '';
}

function slugForKey(fileName: string): string {
  return (
    fileName
      .replace(/\.[a-z0-9]+$/i, '') // quitar extension
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'archivo'
  );
}

/**
 * Content-Disposition `inline` con el nombre para descargar. `inline` permite la
 * vista previa (no fuerza descarga); el navegador usa el filename al guardar.
 * Se incluye version ASCII + RFC 5987 (UTF-8) para acentos/espacios (ej. MUÑOZ).
 */
function contentDisposition(fileName: string): string {
  const ascii = fileName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/"/g, '');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
