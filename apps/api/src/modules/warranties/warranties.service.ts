import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  WARRANTY_RESOLUTION_LABEL,
  WARRANTY_STATUS_LABEL,
  WARRANTY_TRANSITIONS,
  warrantyFileTagSchema,
  type ListWarrantiesQuery,
  type WarrantyDetail,
  type WarrantyEvent as WarrantyEventDto,
  type WarrantyFileTag,
  type WarrantyInput,
  type WarrantyListResponse,
  type WarrantyMessage as WarrantyMessageDto,
  type WarrantyResolution,
  type WarrantyStatus,
  type WarrantySuggestions,
  type WarrantySummary,
} from '@smartlogistica/shared';
import { Prisma } from '.prisma/tenant-client';

import { isAdmin } from '../../common/rbac';
import type { AuthContext } from '../../common/types/authenticated-request';
import { ControlPlaneService } from '../../infrastructure/prisma/control-plane.service';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { getTenantContext } from '../../infrastructure/tenant-context';

type WarrantyRow = Prisma.WarrantyGetPayload<Record<string, never>>;
type WarrantyMessageRow = Prisma.WarrantyMessageGetPayload<Record<string, never>>;
type WarrantyEventRow = Prisma.WarrantyEventGetPayload<Record<string, never>>;

/** Campos que se pueden editar despues de crear (los que vienen de la hoja). */
const EDITABLE_FIELDS = [
  'receivedAt',
  'store',
  'customerName',
  'customerDocument',
  'customerPhone',
  'customerEmail',
  'city',
  'deviceType',
  'brand',
  'model',
  'serial',
  'purchaseDate',
  'invoiceNumber',
  'physicalCondition',
  'reason',
  'accessories',
  'comments',
  'assigneeId',
  'supplier',
] as const;

const DATE_FIELDS = new Set(['receivedAt', 'purchaseDate']);

/** Nombre visible del usuario (cae al correo si no tiene nombre). */
function displayName(auth: AuthContext): string {
  return auth.name?.trim() || auth.email;
}

/**
 * Una fecha sin hora se guarda a MEDIODIA UTC: asi ninguna zona horaria la
 * corre al dia anterior al leerla (Colombia es UTC-5).
 */
function dateOnlyToDb(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`);
}

function dateOnlyFromDb(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function todayBogota(): string {
  return new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
}

/** "26 nov" para los avisos de la conversacion. */
function shortDate(value: string): string {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

function extFromNameOrMime(name: string, mime: string): string {
  const fromName = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1];
  if (fromName) return `.${fromName.toLowerCase()}`;
  const sub = mime.split('/')[1];
  return sub ? `.${sub.split(';')[0].trim()}` : '';
}

function slugForKey(fileName: string): string {
  return (
    fileName
      .replace(/\.[a-z0-9]+$/i, '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'archivo'
  );
}

/** Content-Disposition `inline` con el nombre original (acentos incluidos). */
function contentDisposition(fileName: string): string {
  const ascii = fileName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/"/g, '');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * GARANTIAS: radicado, ciclo de estados, conversacion con archivos y linea de
 * tiempo. Todo el equipo las ve y las trabaja (no dependen de la sede de los
 * pedidos); solo reabrir una cerrada es de administradores.
 */
@Injectable()
export class WarrantiesService {
  private readonly logger = new Logger(WarrantiesService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly realtime: RealtimeService,
    private readonly control: ControlPlaneService,
  ) {}

  // === Lista ===

  async list(query: ListWarrantiesQuery): Promise<WarrantyListResponse> {
    const { prisma } = getTenantContext();

    const base: Prisma.WarrantyWhereInput = {};
    if (query.store) base.store = query.store;
    if (query.q) {
      const q = query.q;
      const contains = { contains: q, mode: 'insensitive' as const };
      base.OR = [
        { customerName: contains },
        { customerDocument: contains },
        { customerPhone: contains },
        { serial: contains },
        { invoiceNumber: contains },
        { brand: contains },
        { model: contains },
        // "#198" o "198" = el radicado.
        ...(/^#?\d{1,7}$/.test(q) ? [{ number: Number(q.replace('#', '')) }] : []),
      ];
    }

    const statusWhere: Prisma.WarrantyWhereInput =
      query.status === 'open'
        ? { status: { not: 'closed' } }
        : query.status === 'all'
          ? {}
          : { status: query.status };
    const where: Prisma.WarrantyWhereInput = { ...base, ...statusWhere };

    // Las abiertas, de la MAS VIEJA a la mas nueva: la que lleva mas dias es la
    // que hay que mover primero. Cerradas (o todas), la mas reciente arriba.
    const orderBy: Prisma.WarrantyOrderByWithRelationInput[] =
      query.status === 'closed'
        ? [{ closedAt: 'desc' }, { number: 'desc' }]
        : query.status === 'all'
          ? [{ receivedAt: 'desc' }, { number: 'desc' }]
          : [{ receivedAt: 'asc' }, { number: 'asc' }];

    const skip = (query.page - 1) * query.limit;
    const [rows, total, grouped] = await Promise.all([
      prisma.warranty.findMany({
        where,
        orderBy,
        skip,
        take: query.limit,
        include: { _count: { select: { messages: { where: { kind: 'file' } } } } },
      }),
      prisma.warranty.count({ where }),
      prisma.warranty.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    ]);

    const counts: Record<WarrantyStatus, number> = {
      received: 0,
      at_supplier: 0,
      ready: 0,
      closed: 0,
    };
    for (const g of grouped) {
      if (g.status in counts) counts[g.status as WarrantyStatus] = g._count._all;
    }

    return {
      items: rows.map((r) => this.toSummary(r, r._count.messages)),
      total,
      page: query.page,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
      counts,
    };
  }

  /** Valores ya usados (los mas frecuentes primero) para sugerir al escribir. */
  async suggestions(): Promise<WarrantySuggestions> {
    const { prisma } = getTenantContext();
    const top = async (field: 'store' | 'brand' | 'supplier' | 'city'): Promise<string[]> => {
      const rows = await prisma.warranty.groupBy({
        by: [field],
        _count: { _all: true },
        orderBy: { _count: { [field]: 'desc' } },
        take: 60,
      });
      return rows
        .map((r) => (r as Record<string, unknown>)[field])
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    };
    const [stores, brands, suppliers, cities] = await Promise.all([
      top('store'),
      top('brand'),
      top('supplier'),
      top('city'),
    ]);
    return { stores, brands, suppliers, cities };
  }

  // === Una garantia ===

  async detail(id: string): Promise<WarrantyDetail> {
    const { prisma } = getTenantContext();
    const row = await prisma.warranty.findUnique({
      where: { id },
      include: {
        events: { orderBy: { createdAt: 'asc' } },
        _count: { select: { messages: { where: { kind: 'file' } } } },
      },
    });
    if (!row) throw new NotFoundException('Garantía no encontrada');
    return this.toDetail(row, row.events, row._count.messages);
  }

  async create(input: WarrantyInput, auth: AuthContext): Promise<WarrantyDetail> {
    const { prisma } = getTenantContext();
    const assignee = await this.resolveAssignee(input.assigneeId ?? auth.userId, auth);

    // RADICADO consecutivo a partir del MAYOR (no del conteo: si algun dia se
    // borra una, el conteo se queda atras y choca). Reintenta si dos personas
    // radican a la vez y chocan en el unique.
    let created: WarrantyRow | null = null;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      const max = await prisma.warranty.aggregate({ _max: { number: true } });
      const number = (max._max.number ?? 0) + 1 + attempt;
      try {
        created = await prisma.warranty.create({
          data: {
            number,
            status: 'received',
            receivedAt: dateOnlyToDb(input.receivedAt),
            store: input.store.toUpperCase(),
            customerName: input.customerName.toUpperCase(),
            customerDocument: input.customerDocument,
            customerPhone: input.customerPhone,
            customerEmail: input.customerEmail?.toLowerCase() ?? null,
            city: input.city.toUpperCase(),
            deviceType: input.deviceType,
            brand: input.brand.toUpperCase(),
            model: input.model.toUpperCase(),
            serial: input.serial.toUpperCase(),
            purchaseDate: input.purchaseDate ? dateOnlyToDb(input.purchaseDate) : null,
            invoiceNumber: input.invoiceNumber?.toUpperCase() ?? null,
            physicalCondition: input.physicalCondition,
            reason: input.reason,
            accessories: input.accessories,
            comments: input.comments,
            assigneeId: assignee?.id ?? null,
            assigneeName: assignee?.name ?? null,
            supplier: input.supplier?.toUpperCase() ?? null,
            createdById: auth.userId,
            createdByName: displayName(auth),
          },
        });
      } catch (err) {
        const conflict =
          err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
        if (!conflict || attempt === 4) throw err;
      }
    }
    if (!created) throw new BadRequestException('No se pudo radicar la garantía, intenta de nuevo');

    await Promise.all([
      prisma.warrantyEvent.create({
        data: {
          warrantyId: created.id,
          type: 'created',
          toStatus: 'received',
          actorId: auth.userId,
          actorName: displayName(auth),
        },
      }),
      this.systemMessage(
        created.id,
        auth,
        `Garantía #${created.number} recibida en ${created.store}` +
          (assignee ? ` · seguimiento: ${assignee.name}` : '') +
          '.',
      ),
    ]);
    await this.announce(created.id);
    return this.detail(created.id);
  }

  async update(
    id: string,
    input: Partial<WarrantyInput>,
    auth: AuthContext,
  ): Promise<WarrantyDetail> {
    const { prisma } = getTenantContext();
    const current = await prisma.warranty.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Garantía no encontrada');

    const data: Prisma.WarrantyUpdateInput = {};
    const changes: Record<string, [unknown, unknown]> = {};
    const upper = new Set([
      'store',
      'customerName',
      'city',
      'brand',
      'model',
      'serial',
      'invoiceNumber',
      'supplier',
    ]);

    for (const field of EDITABLE_FIELDS) {
      if (!(field in input) || field === 'assigneeId') continue;
      const raw = input[field];
      if (raw === undefined) continue;
      let next: unknown = raw;
      if (typeof next === 'string' && upper.has(field)) next = next.toUpperCase();
      if (field === 'customerEmail' && typeof next === 'string') next = next.toLowerCase();
      const before = (current as Record<string, unknown>)[field];
      const beforeCmp = DATE_FIELDS.has(field) ? dateOnlyFromDb(before as Date | null) : before;
      if (JSON.stringify(beforeCmp ?? null) === JSON.stringify(next ?? null)) continue;
      changes[field] = [beforeCmp ?? null, next ?? null];
      (data as Record<string, unknown>)[field] = DATE_FIELDS.has(field)
        ? next
          ? dateOnlyToDb(next as string)
          : null
        : next;
    }

    // Responsable: se guarda tambien su nombre (la lista no consulta usuarios).
    let assigneeNote: string | null = null;
    if ('assigneeId' in input && (input.assigneeId ?? null) !== current.assigneeId) {
      const assignee = input.assigneeId ? await this.resolveAssignee(input.assigneeId, auth) : null;
      data.assigneeId = assignee?.id ?? null;
      data.assigneeName = assignee?.name ?? null;
      changes.assigneeName = [current.assigneeName, assignee?.name ?? null];
      assigneeNote = assignee
        ? `${displayName(auth)} asignó el seguimiento a ${assignee.name}.`
        : `${displayName(auth)} quitó el responsable del seguimiento.`;
    }

    if (Object.keys(changes).length === 0) return this.detail(id);

    await prisma.warranty.update({ where: { id }, data });
    await prisma.warrantyEvent.create({
      data: {
        warrantyId: id,
        type: 'updated',
        data: changes as Prisma.InputJsonValue,
        actorId: auth.userId,
        actorName: displayName(auth),
      },
    });
    if (assigneeNote) await this.systemMessage(id, auth, assigneeNote);
    await this.announce(id);
    return this.detail(id);
  }

  /**
   * Mueve la garantia en su ciclo. Cada destino pide lo suyo: el proveedor al
   * enviarla, como se resolvio al tenerla lista o cerrarla, y el motivo al
   * devolverla un paso o reabrirla.
   */
  async changeStatus(
    id: string,
    input: {
      to: WarrantyStatus;
      supplier: string | null;
      supplierSentAt: string | null;
      resolution: WarrantyResolution | null;
      note: string | null;
    },
    auth: AuthContext,
  ): Promise<WarrantyDetail> {
    const { prisma } = getTenantContext();
    const current = await prisma.warranty.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Garantía no encontrada');
    const from = current.status as WarrantyStatus;
    const to = input.to;

    if (from === to)
      throw new BadRequestException(
        `La garantía ya está ${WARRANTY_STATUS_LABEL[to].toLowerCase()}.`,
      );
    if (!WARRANTY_TRANSITIONS[from]?.includes(to)) {
      throw new BadRequestException(
        `No se puede pasar de «${WARRANTY_STATUS_LABEL[from]}» a «${WARRANTY_STATUS_LABEL[to]}».`,
      );
    }
    if (from === 'closed' && !isAdmin(auth)) {
      throw new ForbiddenException('Solo un administrador puede reabrir una garantía cerrada.');
    }

    const data: Prisma.WarrantyUpdateInput = { status: to };
    let message: string;
    const resolution = input.resolution ?? (current.resolution as WarrantyResolution | null);

    if (to === 'at_supplier') {
      const supplier = (input.supplier ?? current.supplier ?? '').trim().toUpperCase();
      if (!supplier) throw new BadRequestException('Escribe a qué proveedor se envía.');
      const sentAt = input.supplierSentAt ?? todayBogota();
      data.supplier = supplier;
      data.supplierSentAt = dateOnlyToDb(sentAt);
      message = `Enviada al proveedor ${supplier} (${shortDate(sentAt)}).`;
    } else if (to === 'ready') {
      if (!resolution) throw new BadRequestException('Elige cómo se resolvió la garantía.');
      data.resolution = resolution;
      message = `Lista para entregar al cliente · ${WARRANTY_RESOLUTION_LABEL[resolution]}.`;
    } else if (to === 'closed') {
      if (!resolution) throw new BadRequestException('Elige cómo se resolvió la garantía.');
      if (!input.note) throw new BadRequestException('Escribe la nota de cierre.');
      data.resolution = resolution;
      data.closureNote = input.note;
      data.closedAt = new Date();
      message =
        resolution === 'denied'
          ? `Cerrada · No procede.`
          : `Cerrada · ${WARRANTY_RESOLUTION_LABEL[resolution]}.`;
    } else {
      // Devolver a Recibida (o reabrir): el motivo es obligatorio.
      if (!input.note) throw new BadRequestException('Escribe el motivo del cambio.');
      if (from === 'closed') {
        data.closedAt = null;
        data.closureNote = null;
        data.resolution = null;
      }
      message =
        from === 'closed'
          ? `Reabierta por ${displayName(auth)}.`
          : `Devuelta a «${WARRANTY_STATUS_LABEL.received}».`;
    }

    await prisma.warranty.update({ where: { id }, data });
    await prisma.warrantyEvent.create({
      data: {
        warrantyId: id,
        type: 'status',
        fromStatus: from,
        toStatus: to,
        note: input.note,
        data: {
          ...(data.resolution !== undefined ? { resolution: data.resolution } : {}),
          ...(to === 'at_supplier' ? { supplier: data.supplier } : {}),
        } as Prisma.InputJsonValue,
        actorId: auth.userId,
        actorName: displayName(auth),
      },
    });
    await this.systemMessage(id, auth, input.note ? `${message}\n${input.note}` : message);
    await this.announce(id);
    return this.detail(id);
  }

  // === Conversacion ===

  async listMessages(id: string): Promise<WarrantyMessageDto[]> {
    const { prisma } = getTenantContext();
    await this.assertExists(id);
    const rows = await prisma.warrantyMessage.findMany({
      where: { warrantyId: id },
      orderBy: { createdAt: 'asc' },
    });
    return Promise.all(rows.map((r) => this.toMessage(r)));
  }

  async postMessage(id: string, body: string, auth: AuthContext): Promise<WarrantyMessageDto> {
    const { prisma } = getTenantContext();
    await this.assertExists(id);
    const msg = await prisma.warrantyMessage.create({
      data: {
        warrantyId: id,
        kind: 'text',
        body: body.trim().slice(0, 4000),
        authorId: auth.userId,
        authorName: displayName(auth),
      },
    });
    await prisma.warranty.update({ where: { id }, data: { updatedAt: new Date() } });
    await this.announce(id);
    return this.toMessage(msg);
  }

  /**
   * Un archivo a la conversacion (foto, video, PDF...). `tag` dice para que es
   * (recepcion, entrega al proveedor, soporte de cierre): reemplaza las
   * columnas de archivos de la hoja, y aqui cada una admite VARIOS.
   */
  async addAttachment(
    id: string,
    file: { buffer: Buffer; mimetype: string; originalname?: string },
    tagRaw: string | undefined,
    caption: string | undefined,
    auth: AuthContext,
  ): Promise<WarrantyMessageDto> {
    const { tenantId, prisma } = getTenantContext();
    await this.assertExists(id);
    if (!this.storage.isConfigured()) {
      throw new BadRequestException('El almacenamiento de archivos no está configurado.');
    }
    if (!file?.buffer?.length) throw new BadRequestException('El archivo llegó vacío.');
    const parsedTag = warrantyFileTagSchema.safeParse(tagRaw);
    const tag: WarrantyFileTag | null = parsedTag.success ? parsedTag.data : null;

    const mime = (file.mimetype || 'application/octet-stream').toLowerCase();
    const originalName = (file.originalname ?? '').trim() || `archivo-${Date.now()}`;
    const key = `tenants/${tenantId}/warranties/${id}/${slugForKey(originalName)}-${randomUUID()}${extFromNameOrMime(originalName, mime)}`;
    await this.storage.put(key, file.buffer, mime, contentDisposition(originalName));

    const msg = await prisma.warrantyMessage.create({
      data: {
        warrantyId: id,
        kind: 'file',
        body: caption?.trim().slice(0, 2000) || null,
        tag,
        attachmentKey: key,
        attachmentMime: mime,
        attachmentName: originalName.slice(0, 200),
        authorId: auth.userId,
        authorName: displayName(auth),
      },
    });
    await prisma.warranty.update({ where: { id }, data: { updatedAt: new Date() } });
    await this.announce(id);
    return this.toMessage(msg);
  }

  // === Helpers ===

  private async assertExists(id: string): Promise<void> {
    const { prisma } = getTenantContext();
    const found = await prisma.warranty.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException('Garantía no encontrada');
  }

  /** El responsable tiene que ser del equipo de este tenant. */
  private async resolveAssignee(
    userId: string,
    auth: AuthContext,
  ): Promise<{ id: string; name: string } | null> {
    if (userId === auth.userId) return { id: auth.userId, name: displayName(auth) };
    const { tenantId } = getTenantContext();
    const m = await this.control.membership.findFirst({
      where: { tenantId, userId },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!m) throw new BadRequestException('El responsable no es del equipo.');
    return { id: userId, name: m.user.name?.trim() || m.user.email };
  }

  private async systemMessage(id: string, auth: AuthContext, body: string): Promise<void> {
    const { prisma } = getTenantContext();
    await prisma.warrantyMessage.create({
      data: {
        warrantyId: id,
        kind: 'system',
        body,
        authorId: auth.userId,
        authorName: displayName(auth),
      },
    });
  }

  /** Aviso en vivo: solo la pagina de garantias lo escucha. */
  private async announce(warrantyId: string): Promise<void> {
    const { tenantId } = getTenantContext();
    await this.realtime.publish(tenantId, { kind: 'warranty.changed', warrantyId });
  }

  private toSummary(r: WarrantyRow, fileCount: number): WarrantySummary {
    return {
      id: r.id,
      number: r.number,
      status: r.status as WarrantyStatus,
      resolution: (r.resolution as WarrantyResolution | null) ?? null,
      receivedAt: dateOnlyFromDb(r.receivedAt) ?? '',
      store: r.store,
      customerName: r.customerName,
      customerDocument: r.customerDocument,
      customerPhone: r.customerPhone,
      city: r.city,
      deviceType: r.deviceType as WarrantySummary['deviceType'],
      brand: r.brand,
      model: r.model,
      serial: r.serial,
      reason: r.reason,
      assigneeId: r.assigneeId,
      assigneeName: r.assigneeName,
      supplier: r.supplier,
      closedAt: r.closedAt ? r.closedAt.toISOString() : null,
      updatedAt: r.updatedAt.toISOString(),
      fileCount,
    };
  }

  private toDetail(r: WarrantyRow, events: WarrantyEventRow[], fileCount: number): WarrantyDetail {
    return {
      ...this.toSummary(r, fileCount),
      customerEmail: r.customerEmail,
      purchaseDate: dateOnlyFromDb(r.purchaseDate),
      invoiceNumber: r.invoiceNumber,
      physicalCondition: r.physicalCondition,
      accessories: r.accessories as WarrantyDetail['accessories'],
      comments: r.comments,
      supplierSentAt: dateOnlyFromDb(r.supplierSentAt),
      closureNote: r.closureNote,
      createdByName: r.createdByName,
      createdAt: r.createdAt.toISOString(),
      events: events.map(
        (e): WarrantyEventDto => ({
          id: e.id,
          type: e.type as WarrantyEventDto['type'],
          fromStatus: (e.fromStatus as WarrantyStatus | null) ?? null,
          toStatus: (e.toStatus as WarrantyStatus | null) ?? null,
          note: e.note,
          data: (e.data as Record<string, unknown> | null) ?? null,
          actorName: e.actorName,
          createdAt: e.createdAt.toISOString(),
        }),
      ),
    };
  }

  private async toMessage(m: WarrantyMessageRow): Promise<WarrantyMessageDto> {
    const url = m.attachmentKey
      ? await this.storage.getSignedUrl(m.attachmentKey).catch((err: unknown) => {
          this.logger.warn(
            `No se pudo firmar ${m.attachmentKey}: ${err instanceof Error ? err.message : err}`,
          );
          return null;
        })
      : null;
    return {
      id: m.id,
      kind: m.kind as WarrantyMessageDto['kind'],
      body: m.body,
      tag: (m.tag as WarrantyFileTag | null) ?? null,
      attachmentUrl: url,
      attachmentMime: m.attachmentMime,
      attachmentName: m.attachmentName,
      authorId: m.authorId,
      authorName: m.authorName,
      createdAt: m.createdAt.toISOString(),
    };
  }
}
