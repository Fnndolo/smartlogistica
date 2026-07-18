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
  AssignOrdersInput,
  CatalogMatch,
  CreateInvoiceInput,
  CoordinadoraCity,
  CreateGuideInput,
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
  ProcessAllInput,
  ProcessAllResult,
  Inbox,
  InboxItem,
} from '@smartlogistica/shared';
import type { Prisma } from '.prisma/tenant-client';

import { isAdmin } from '../../common/rbac';
import type { AuthContext } from '../../common/types/authenticated-request';
import { getTenantContext } from '../../infrastructure/tenant-context';
import { ControlPlaneService } from '../../infrastructure/prisma/control-plane.service';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service';
import { CatalogService } from '../../infrastructure/catalog/catalog.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { AiConnectionService } from '../ai/ai-connection.service';
import { type ImageMime } from '../ai/ai-vision-client.service';
import { AlegraService, type InvoiceClient } from '../marketplaces/alegra/alegra.service';
import { WarrantyService } from '../marketplaces/alegra/warranty.service';
import { CoordinadoraService } from '../marketplaces/coordinadora/coordinadora.service';
import type { RastreoResult } from '../marketplaces/coordinadora/coordinadora-client.service';
import { MktDocumentService } from '../marketplaces/vtex/mkt-document.service';
import { VtexClient } from '../marketplaces/vtex/vtex-client.service';
import { WarehousesService } from '../warehouses/warehouses.service';

const IMAGE_EXT: Record<ImageMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;
type OrderMessageRow = Prisma.OrderMessageGetPayload<Record<string, never>>;
type OrderEventRow = Prisma.OrderEventGetPayload<Record<string, never>>;

/** No leidos de un pedido: total + si me mencionan + ultimo mensaje (preview). */
interface UnreadInfo {
  count: number;
  mentioned: boolean;
  lastAt: Date;
  preview: string;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly realtime: RealtimeService,
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
      // Pedidos generales (sin asignar) = espejo de VTEX en ready-for-handling.
      // Solo admins ven los generales.
      if (!isAdmin(auth)) throw new ForbiddenException('Sin acceso a pedidos generales');
      where.warehouseId = null;
      where.status = 'ready-for-handling';
    }

    // Etapa (solo en sede): un pedido pasa a "Facturados" cuando se cierra en VTEX
    // (evento 'vtex_invoiced' = ya se hizo la guia + MKT y se facturo en VTEX), NO
    // con solo facturar en Alegra. Asi, un pedido facturado en Alegra pero sin guia
    // sigue en "Por preparar" hasta completar el flujo.
    if (query.warehouse && query.state) {
      where.events =
        query.state === 'invoiced'
          ? { some: { type: 'vtex_invoiced' } }
          : { none: { type: 'vtex_invoiced' } };
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

    if (query.from || query.to) {
      where.marketplaceCreatedAt = {};
      if (query.from) (where.marketplaceCreatedAt as Prisma.DateTimeFilter).gte = new Date(query.from);
      if (query.to) (where.marketplaceCreatedAt as Prisma.DateTimeFilter).lte = new Date(query.to);
    }
    if (query.q) {
      const q = query.q;
      where.OR = [
        { customerName: { contains: q, mode: 'insensitive' } },
        { externalId: { contains: q, mode: 'insensitive' } },
        { customerDocument: { contains: q, mode: 'insensitive' } },
        { items: { some: { name: { contains: q, mode: 'insensitive' } } } },
      ];
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
    // + cuantos mensajes sin leer tiene cada uno para este usuario (badge).
    const ids = rows.map((r) => r.id);
    const [withPhoto, unread] =
      rows.length === 0
        ? [new Set<string>(), new Map<string, UnreadInfo>()]
        : await Promise.all([
            prisma.orderMessage
              .groupBy({
                by: ['orderId'],
                where: { orderId: { in: ids }, kind: { in: ['imei_photo', 'serial_photo'] } },
              })
              .then((g) => new Set(g.map((x) => x.orderId))),
            this.unreadMap(auth.userId, { orderIds: ids }),
          ]);

    return {
      items: rows.map((o) => this.toSummary(o, withPhoto.has(o.id), unread.get(o.id)?.count ?? 0)),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  /** Asigna / transfiere / devuelve (warehouseId null) pedidos. Solo admins. */
  async assign(input: AssignOrdersInput, auth: AuthContext): Promise<{ count: number }> {
    if (!isAdmin(auth)) throw new ForbiddenException('Solo administradores pueden asignar pedidos');
    const { tenantId, prisma } = getTenantContext();

    if (input.warehouseId) {
      const w = await prisma.warehouse.findUnique({ where: { id: input.warehouseId } });
      if (!w || w.archived) throw new NotFoundException('Sede no encontrada o archivada');
    }

    // No mover pedidos ya facturados en Alegra: la factura quedo emitida contra la
    // cuenta de ESA sede, transferirlos o devolverlos la dejaria descuadrada.
    const invoiced = await prisma.orderEvent.findMany({
      where: { orderId: { in: input.orderIds }, type: 'invoiced' },
      select: { orderId: true },
      distinct: ['orderId'],
    });
    if (invoiced.length > 0) {
      throw new BadRequestException(
        `No se pueden mover ${invoiced.length} pedido(s) que ya estan facturados. ` +
          'Anula la factura en Alegra primero si de verdad necesitas moverlos.',
      );
    }

    // Estado previo (para clasificar cada cambio como asignado/transferido/devuelto).
    const prior = await prisma.order.findMany({
      where: { id: { in: input.orderIds } },
      select: { id: true, warehouseId: true },
    });

    const result = await prisma.order.updateMany({
      where: { id: { in: input.orderIds } },
      data: {
        warehouseId: input.warehouseId,
        assignedAt: input.warehouseId ? new Date() : null,
      },
    });

    // Registrar actividad por pedido.
    const to = input.warehouseId;
    await prisma.orderEvent.createMany({
      data: prior.map((o) => ({
        orderId: o.id,
        type: to === null ? 'returned' : o.warehouseId === null ? 'assigned' : 'transferred',
        actorId: auth.userId,
        actorName: auth.email,
        data: { from: o.warehouseId, to } as Prisma.InputJsonValue,
      })),
    });

    await this.realtime.publish(tenantId, { kind: 'orders.refresh' });
    return { count: result.count };
  }

  // === Drawer por pedido: detalle + conversacion + actividad ===

  async getDetail(orderId: string, auth: AuthContext): Promise<OrderDetail> {
    const order = await this.loadAccessibleOrder(orderId, auth);
    const { prisma } = getTenantContext();
    const photoCount = await prisma.orderMessage.count({
      where: { orderId, kind: { in: ['imei_photo', 'serial_photo'] } },
    });
    return this.toDetail(order, photoCount > 0);
  }

  async listMessages(orderId: string, auth: AuthContext): Promise<OrderMessageDto[]> {
    await this.loadAccessibleOrder(orderId, auth);
    const { prisma } = getTenantContext();
    const rows = await prisma.orderMessage.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
    return Promise.all(rows.map((m) => this.toMessage(m)));
  }

  async postMessage(
    orderId: string,
    input: CreateOrderMessageInput,
    auth: AuthContext,
  ): Promise<OrderMessageDto> {
    await this.loadAccessibleOrder(orderId, auth);
    const { tenantId, prisma } = getTenantContext();
    const mentions = await this.validMentions(tenantId, input.mentions);
    const msg = await prisma.orderMessage.create({
      data: {
        orderId,
        authorId: auth.userId,
        authorName: auth.email,
        kind: 'text',
        body: input.body,
        mentions,
      },
    });
    // Quien escribe obviamente ya "leyo" el hilo -> marcar leido para no contarse a si mismo.
    await this.touchRead(orderId, auth.userId);
    await this.realtime.publish(tenantId, { kind: 'orders.refresh' });
    return this.toMessage(msg);
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
        select: { orderId: true, createdAt: true, mentions: true, kind: true, body: true },
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
      } else {
        result.set(m.orderId, {
          count: 1,
          mentioned,
          lastAt: m.createdAt,
          preview: messagePreview(m.kind, m.body),
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
      });
    }
    items.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
    return { items, totalUnread, mentions };
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

    // 1. Leer el/los codigo(s) con IA segun el tipo. Si no hay ninguno, corta aca.
    const base64 = file.buffer.toString('base64');
    const codes =
      kind === 'imei'
        ? await this.ai.extractImeis(base64, mime)
        : await this.ai.extractSerials(base64, mime);
    if (codes.length === 0) {
      throw new BadRequestException(
        kind === 'imei'
          ? 'No se detecto ningun IMEI valido en la imagen. Sube una foto nitida del IMEI.'
          : 'No se detecto ningun serial en la imagen. Sube una foto nitida del serial.',
      );
    }

    // 2. Guardar la imagen en storage (privada, key namespaced por tenant).
    const key = `tenants/${tenantId}/orders/${orderId}/${randomUUID()}.${IMAGE_EXT[mime]}`;
    await this.storage.put(key, file.buffer, mime);

    // 3. Registrar el mensaje en la conversacion del pedido.
    const msg = await prisma.orderMessage.create({
      data: {
        orderId,
        authorId: auth.userId,
        authorName: auth.email,
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
        authorName: auth.email,
        kind: 'file',
        body: originalName,
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

  /** Preview: cliente completo (del pedido) + una linea por FOTO (producto + precio). */
  async invoicePreview(orderId: string, auth: AuthContext): Promise<InvoicePreview> {
    const order = await this.loadAccessibleOrder(orderId, auth);
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
    const lines = await this.alegra.invoicePreviewLines(order.warehouseId, groups, auth);

    // El precio de venta viene del PEDIDO (VTEX), no del precio de lista de Alegra.
    const vtexItems = order.items.map((i) => ({ name: i.name, unitPrice: i.unitPrice.toString() }));
    const priced = lines.map((l) => ({
      ...l,
      suggestedPrice: vtexPriceForProduct(l.productName, vtexItems) ?? l.suggestedPrice,
    }));

    const client = extractInvoiceClient(order);
    return {
      invoice: null,
      lines: priced,
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

  /** Emite la factura de venta en Alegra y la registra en el pedido. */
  async createInvoice(
    orderId: string,
    input: CreateInvoiceInput,
    auth: AuthContext,
  ): Promise<InvoiceResult> {
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

    const client = extractInvoiceClient(order);
    const { result, pdf, payment } = await this.alegra.createInvoiceForWarehouse(
      order.warehouseId,
      client,
      input.lines,
      auth,
    );

    // Registrar en el pedido: mensaje de sistema + evento en la actividad.
    await prisma.orderMessage.create({
      data: {
        orderId,
        authorId: auth.userId,
        authorName: auth.email,
        kind: 'system',
        body: `Factura ${result.number} emitida en Alegra (${result.status}).`,
        imeis: [],
      },
    });

    // Adjuntar el PDF de la factura al chat, como si quien facturo lo hubiera
    // enviado como archivo. Best-effort: si falla, la factura ya quedo emitida.
    if (pdf && this.storage.isConfigured()) {
      try {
        // Certificado de Garantia: si la sede tiene plantilla, la factura se
        // transforma en el certificado (nunca se envia la factura cruda). Si no
        // hay plantilla o falla, va la factura original.
        const clientNameRaw = (client.name ?? '').trim().toUpperCase();
        const certificate = order.warehouseId
          ? await this.warranty
              .certificateFor(order.warehouseId, pdf, {
                moneda: 'COP',
                fecha: new Date().toISOString().slice(0, 10),
                cliente: clientNameRaw,
                numeroFactura: result.number,
                // Forma/medio de pago REALES de la factura de Alegra.
                formaPago: payment.formaPago,
                medioPago: payment.medioPago,
              })
              .catch(() => null)
          : null;
        const finalPdf = certificate ?? pdf;

        // Nombre del archivo: FACTURA-<NOMBRE CLIENTE EN MAYUSCULA> (ej. FACTURA-DAVID CASTRO).
        const clientName = clientNameRaw || `FACTURA ${result.number}`;
        const fileName = `FACTURA-${clientName}.pdf`;
        const key = `tenants/${tenantId}/orders/${orderId}/${slugForKey(fileName)}-${randomUUID()}.pdf`;
        await this.storage.put(key, finalPdf, 'application/pdf', contentDisposition(fileName));
        await prisma.orderMessage.create({
          data: {
            orderId,
            authorId: auth.userId,
            authorName: auth.email,
            kind: 'document',
            body: fileName,
            attachmentKey: key,
            attachmentMime: 'application/pdf',
            imeis: [],
          },
        });
      } catch {
        // no bloquear la facturacion por un fallo al adjuntar el PDF
      }
    }
    await prisma.orderEvent.create({
      data: {
        orderId,
        type: 'invoiced',
        actorId: auth.userId,
        actorName: auth.email,
        data: {
          number: result.number,
          id: result.id,
          status: result.status,
          total: result.total,
        } as Prisma.InputJsonValue,
      },
    });
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
    if (!order.warehouseId) {
      throw new BadRequestException('Asigna el pedido a una sede para generar guia.');
    }

    const sender = await this.coordinadora.senderFor(order.warehouseId);
    const client = extractInvoiceClient(order);
    const city = await this.coordinadora
      .resolveCity(order.warehouseId, client.address?.city ?? null, client.address?.department ?? null)
      .catch(() => null);

    const { rotuloId, ...senderData } = sender;
    return {
      guide: await this.existingGuide(orderId),
      recipient: {
        name: client.name,
        document: client.identification,
        address: client.address?.street ?? extractShippingAddress(order.rawPayload) ?? '',
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
        declaredValue: Number(order.totalValue) || 0,
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
        // Todo lo que NO esta entregado (los entregados ya no cambian). Incluye
        // shippingState null: en Prisma `NOT: {x:'entregado'}` excluiria los null
        // (NULL <> 'entregado' no es true en SQL), y esos justamente son los que
        // nunca se han rastreado.
        OR: [{ shippingState: null }, { shippingState: { not: 'entregado' } }],
      },
      select: { id: true, guideNumber: true, shippingState: true, shippingStatus: true },
    });
    if (pending.length === 0) return { updated: 0 };

    let updated = 0;
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
      }
    }
    if (updated > 0) await this.realtime.publish(tenantId, { kind: 'orders.refresh' });
    return { updated };
  }

  /** Seguimiento detallado del pedido (rastreo de su guia en Coordinadora). null si no tiene guia. */
  async orderTracking(orderId: string, auth: AuthContext): Promise<GuideTracking | null> {
    const order = await this.loadAccessibleOrder(orderId, auth);
    if (!order.warehouseId) return null;
    const guide = await this.existingGuide(orderId);
    if (!guide) return null;
    return this.coordinadora.trackGuide(order.warehouseId, guide.number, auth);
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
    const { guide, rotulo } = await this.coordinadora.generateGuideForWarehouse(
      order.warehouseId,
      input.recipient,
      input.package,
      order.externalId,
      input.rotuloId,
      auth,
    );

    // Mensaje de sistema + evento + denormalizado del envio: tres escrituras
    // independientes -> juntas (antes eran tres esperas encadenadas). Va primero
    // para que el aviso de la guia quede antes que el rotulo en el chat.
    await Promise.all([
      prisma.orderMessage.create({
        data: {
          orderId,
          authorId: auth.userId,
          authorName: auth.email,
          kind: 'system',
          body: `Guia ${guide.number} generada en Coordinadora.`,
          imeis: [],
        },
      }),
      prisma.orderEvent.create({
        data: {
          orderId,
          type: 'guide_generated',
          actorId: auth.userId,
          actorName: auth.email,
          data: { number: guide.number, id: guide.id, url: guide.url } as Prisma.InputJsonValue,
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

    // Adjuntar el rotulo al chat y cerrar en VTEX (start-handling + invoice +
    // tracking + MKT) solo dependen de la guia y no entre si -> en paralelo.
    // Ambos best-effort: si fallan, la guia ya quedo y se avisa en el chat.
    await Promise.all([
      this.attachRotulo(orderId, order, guide, rotulo, auth),
      this.finalizeVtex(order, auth).catch(() => null),
    ]);

    await this.realtime.publish(tenantId, { kind: 'orders.refresh' });

    return { id: guide.id, number: guide.number, url: guide.url, createdAt: new Date().toISOString() };
  }

  /** Sube el rotulo (sticker) a storage y lo adjunta al chat. Best-effort. */
  private async attachRotulo(
    orderId: string,
    order: OrderWithItems,
    guide: { number: string },
    rotulo: Buffer | null,
    auth: AuthContext,
  ): Promise<void> {
    if (!rotulo || !this.storage.isConfigured()) return;
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
          authorName: auth.email,
          kind: 'document',
          body: fileName,
          attachmentKey: key,
          attachmentMime: 'application/pdf',
          imeis: [],
        },
      });
    } catch {
      // no bloquear la guia por un fallo al adjuntar el rotulo
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
        actorName: auth.email,
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
            authorName: auth.email,
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

  private async systemMessage(orderId: string, auth: AuthContext, body: string): Promise<void> {
    const { prisma } = getTenantContext();
    await prisma.orderMessage.create({
      data: { orderId, authorId: auth.userId, authorName: auth.email, kind: 'system', body, imeis: [] },
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

  private toSummary(o: OrderWithItems, hasDevicePhoto = false, unreadCount = 0): OrderSummary {
    return {
      unreadCount,
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
      marketplaceCreatedAt: o.marketplaceCreatedAt.toISOString(),
      receivedAt: o.receivedAt.toISOString(),
    };
  }

  private toDetail(o: OrderWithItems, hasDevicePhoto = false): OrderDetail {
    return {
      ...this.toSummary(o, hasDevicePhoto),
      // El correo REAL (el de facturar), nunca el enmascarado @ct.vtex.com.br.
      customerEmail: extractRealEmail(o.rawPayload) ?? pickRealEmail(o.customerEmail),
      customerPhone: o.customerPhone,
      shippingAddress: extractShippingAddress(o.rawPayload),
      updatedAt: o.updatedAt.toISOString(),
    };
  }

  private async toMessage(m: OrderMessageRow): Promise<OrderMessageDto> {
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
      attachmentUrl,
      attachmentMime: m.attachmentMime,
      imeis: m.imeis,
      mentions: m.mentions,
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
