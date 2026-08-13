import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isAxiosError, type AxiosInstance } from 'axios';
import type {
  SendWaTextInput,
  WaInboundInput,
  WaMessage as WaMessageDto,
  WaThread,
  WhapifyConnectionSummary,
  WhapifyCredentialsInput,
  WhapifyTestResult,
} from '@smartlogistica/shared';
import type { Prisma, PrismaClient } from '.prisma/tenant-client';

import { isAdmin } from '../../common/rbac';
import type { AuthContext } from '../../common/types/authenticated-request';
import { EnvelopeService } from '../../infrastructure/crypto/envelope.service';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { getTenantContext } from '../../infrastructure/tenant-context';
import { WhapifyClient } from './whapify-client.service';

/** Ultimos mensajes que carga el hilo (el historial completo queda guardado). */
const THREAD_TAKE = 500;

/**
 * CONFIRMACION DE PEDIDO (calcada del workflow "Confirmador de pedidos" de n8n,
 * ahora nativa): cuando llega un pedido NUEVO de VTEX en ready-for-handling se
 * crea/actualiza el contacto en Whapify, se le setean la direccion y los
 * productos (custom fields del flujo) y se dispara el flow de confirmacion.
 * Ids de la cuenta Whapify del negocio (los mismos que usaba n8n).
 */
const CONFIRMATION_FLOW_ID = '1765216079186'; // flow "order_confirmation"
const CF_ADDRESS_ID = '942316'; // custom field: direccion de envio
const CF_PRODUCTS_ID = '557415'; // custom field: productos y cantidades
/** Solo pedidos RECIENTES: un backfill de pedidos viejos JAMAS debe escribirle a nadie. */
const CONFIRMATION_MAX_AGE_MS = 48 * 3_600_000;

/** Archivo entrante/saliente: tope 50MB (igual que los adjuntos del chat). */
export const WA_FILE_MAX_BYTES = 50 * 1024 * 1024;

interface UploadedWaFile {
  buffer: Buffer;
  mimetype: string;
  originalname?: string;
}

interface WaMessageRow {
  id: string;
  direction: string;
  kind: string;
  body: string | null;
  attachmentKey: string | null;
  mediaUrl: string | null;
  authorName: string | null;
  createdAt: Date;
}

/** Ultimos 10 digitos (CO): "+57 300 123 4567" -> "3001234567". */
function tenDigits(phone: string): string {
  const d = phone.replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

/** Nombre partido para crear el contacto en Whapify. */
function splitName(full: string): { firstName: string | null; lastName: string | null } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  const mid = Math.max(1, parts.length - 2);
  return { firstName: parts.slice(0, mid).join(' '), lastName: parts.slice(mid).join(' ') || null };
}

/** Tipo de envio de Whapify segun el mime del archivo. */
function waTypeOf(mime: string): 'image' | 'video' | 'audio' | 'file' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

/**
 * WhatsApp por pedido (Whapify). El historial vive en WaMessage (por telefono):
 * los salientes se guardan al enviarlos desde aqui; los entrantes llegan por el
 * webhook (flow de Whapify / espejo de n8n). Solo administradores.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly client: WhapifyClient,
    private readonly envelope: EnvelopeService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeService,
  ) {}

  // === Conexion (token global, cifrado) ===

  async getConnection(auth: AuthContext): Promise<WhapifyConnectionSummary | null> {
    this.assertAdmin(auth);
    const { prisma } = getTenantContext();
    const conn = await prisma.whapifyConnection.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!conn) return null;
    return {
      accountName: conn.accountName,
      totalContacts: conn.totalContacts,
      status: conn.status === 'error' ? 'error' : 'connected',
      lastError: conn.lastError,
      createdAt: conn.createdAt.toISOString(),
    };
  }

  async test(input: WhapifyCredentialsInput, auth: AuthContext): Promise<WhapifyTestResult> {
    this.assertAdmin(auth);
    try {
      const r = await this.client.testToken(input.token);
      return { ok: true, ...r };
    } catch (err) {
      throw this.translateError(err, 'No se pudo conectar a Whapify');
    }
  }

  async connect(input: WhapifyCredentialsInput, auth: AuthContext): Promise<WhapifyConnectionSummary> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();

    let info: { accountName: string | null; totalContacts: number | null };
    try {
      info = await this.client.testToken(input.token);
    } catch (err) {
      throw this.translateError(err, 'El token de Whapify es invalido');
    }

    const encryptedToken = await this.envelope.encryptField(tenantId, input.token);
    // Singleton: se reemplaza la conexion anterior (si existia).
    await prisma.whapifyConnection.deleteMany({});
    const conn = await prisma.whapifyConnection.create({
      data: {
        encryptedToken,
        accountName: info.accountName,
        totalContacts: info.totalContacts,
        status: 'connected',
        lastError: null,
      },
    });
    return {
      accountName: conn.accountName,
      totalContacts: conn.totalContacts,
      status: 'connected',
      lastError: null,
      createdAt: conn.createdAt.toISOString(),
    };
  }

  async disconnect(auth: AuthContext): Promise<void> {
    this.assertAdmin(auth);
    const { prisma } = getTenantContext();
    await prisma.whapifyConnection.deleteMany({});
  }

  /** Axios autenticado con el token guardado (null si no hay conexion). */
  private async httpOrNull(): Promise<AxiosInstance | null> {
    const { tenantId, prisma } = getTenantContext();
    const conn = await prisma.whapifyConnection.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!conn) return null;
    const token = await this.envelope.decryptField(tenantId, conn.encryptedToken);
    return this.client.buildHttp(token);
  }

  // === Hilo por pedido ===

  async thread(orderId: string, auth: AuthContext): Promise<WaThread> {
    this.assertAdmin(auth);
    const { prisma } = getTenantContext();
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { customerPhone: true },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');

    const phone = order.customerPhone ? tenDigits(order.customerPhone) : '';
    const conn = await prisma.whapifyConnection.findFirst({ select: { id: true } });
    if (!phone) {
      return { phone: null, connected: Boolean(conn), contactName: null, messages: [] };
    }

    const [rows, contact] = await Promise.all([
      prisma.waMessage.findMany({
        where: { phone },
        orderBy: { createdAt: 'asc' },
        take: THREAD_TAKE,
      }),
      prisma.waContact.findUnique({ where: { phone } }),
    ]);

    return {
      phone,
      connected: Boolean(conn),
      contactName: contact?.name ?? null,
      messages: await Promise.all(rows.map((r) => this.toDto(r))),
    };
  }

  /** Envia TEXTO al cliente del pedido y lo guarda en el historial. */
  async sendText(orderId: string, input: SendWaTextInput, auth: AuthContext): Promise<WaMessageDto> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();
    const { phone, contact, http } = await this.resolveTarget(orderId);

    try {
      await this.client.sendText(http, contact.id, input.text);
    } catch (err) {
      throw this.translateError(err, 'Whapify no pudo enviar el mensaje');
    }

    const row = await prisma.waMessage.create({
      data: {
        phone,
        direction: 'out',
        kind: 'text',
        body: input.text,
        authorId: auth.userId,
        authorName: auth.name?.trim() || auth.email,
        contactId: contact.id,
      },
    });
    await this.realtime.publish(tenantId, { kind: 'wa.message', phone });
    return this.toDto(row);
  }

  /** Envia un ARCHIVO (imagen/video/audio/documento) y lo guarda en el historial. */
  async sendFile(orderId: string, file: UploadedWaFile, auth: AuthContext): Promise<WaMessageDto> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();
    if (!this.storage.isConfigured()) {
      throw new BadRequestException('El almacenamiento de archivos no esta configurado');
    }
    const { phone, contact, http } = await this.resolveTarget(orderId);

    const name = file.originalname || 'archivo';
    const ext = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1];
    const key = `tenants/${tenantId}/whatsapp/${phone}/${randomUUID()}${ext ? `.${ext.toLowerCase()}` : ''}`;
    await this.storage.put(key, file.buffer, file.mimetype || 'application/octet-stream');
    const url = await this.storage.getSignedUrl(key);

    try {
      await this.client.sendFile(http, contact.id, url, waTypeOf(file.mimetype || ''));
    } catch (err) {
      await this.storage.delete(key).catch(() => null);
      throw this.translateError(err, 'Whapify no pudo enviar el archivo');
    }

    const row = await prisma.waMessage.create({
      data: {
        phone,
        direction: 'out',
        kind: waTypeOf(file.mimetype || ''),
        body: name,
        attachmentKey: key,
        authorId: auth.userId,
        authorName: auth.name?.trim() || auth.email,
        contactId: contact.id,
      },
    });
    await this.realtime.publish(tenantId, { kind: 'wa.message', phone });
    return this.toDto(row);
  }

  /**
   * ENTRANTE (o espejo de n8n) via webhook. Corre FUERA del contexto tenant
   * (el controller resuelve tenant + prisma como el webhook de confirmacion).
   */
  async inbound(tenantId: string, prisma: PrismaClient, input: WaInboundInput): Promise<void> {
    const phone = tenDigits(input.phone);
    if (phone.length < 7) return;

    await prisma.waMessage.create({
      data: {
        phone,
        direction: input.direction,
        kind: input.type ?? (input.mediaUrl ? 'file' : 'text'),
        body: input.text ?? null,
        mediaUrl: input.mediaUrl ?? null,
        authorName: input.direction === 'out' ? (input.authorName ?? 'n8n') : (input.name ?? null),
      } as Prisma.WaMessageUncheckedCreateInput,
    });

    // Nombre del contacto: se refresca con lo que mande el flow.
    if (input.name?.trim()) {
      await prisma.waContact
        .upsert({
          where: { phone },
          create: { phone, contactId: '', name: input.name.trim() },
          update: { name: input.name.trim() },
        })
        .catch(() => null);
    }

    await this.realtime.publish(tenantId, { kind: 'wa.message', phone });
  }

  /**
   * Envio MANUAL de la confirmacion (el boton "Sin enviar" de la columna
   * Direccion): mismo flujo que el automatico pero con errores VISIBLES y sin
   * el limite de frescura (si Whapify estuvo caido dias, igual se puede enviar).
   */
  async sendConfirmationManual(orderId: string, auth: AuthContext): Promise<{ ok: true }> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();
    await this.sendOrderConfirmation(tenantId, prisma, orderId, { manual: true });
    // Refrescar la tabla (el badge pasa de "Sin enviar" a "Sin responder").
    await this.realtime.publish(tenantId, { kind: 'orders.refresh' });
    return { ok: true };
  }

  /**
   * CONFIRMACION del pedido por WhatsApp (reemplaza el workflow de n8n). Se
   * llama desde la ingesta de VTEX cuando el pedido es NUEVO (best-effort:
   * jamas tumba la ingesta; los "skip" son silenciosos) y desde el boton
   * manual (manual=true: los skip se vuelven ERRORES visibles y no aplica el
   * limite de frescura). Corre FUERA del contexto tenant (recibe prisma).
   */
  async sendOrderConfirmation(
    tenantId: string,
    prisma: PrismaClient,
    orderId: string,
    opts: { manual?: boolean } = {},
  ): Promise<void> {
    const manual = opts.manual === true;
    const fail = (msg: string): void => {
      if (manual) throw new BadRequestException(msg);
    };

    const conn = await prisma.whapifyConnection.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!conn) return fail('Whapify no está conectado. Configúralo en Conexiones.'); // auto: n8n sigue a cargo

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { orderBy: { name: 'asc' } } },
    });
    if (!order) return fail('Pedido no encontrado');
    if (order.provider !== 'vtex') return fail('La confirmación aplica a pedidos de VTEX');
    if (manual) {
      // A mano: mientras el pedido siga vivo (no facturado/cancelado) se puede.
      if (order.status === 'invoiced' || order.status === 'canceled') {
        return fail('Este pedido ya está cerrado: la confirmación ya no aplica.');
      }
    } else {
      // Automatico: mismo guard del n8n (SOLO ready-for-handling) + frescura
      // (un backfill de pedidos viejos JAMAS escribe a nadie).
      if (order.status !== 'ready-for-handling') return;
      if (Date.now() - order.marketplaceCreatedAt.getTime() > CONFIRMATION_MAX_AGE_MS) return;
    }
    const phone = order.customerPhone ? tenDigits(order.customerPhone) : '';
    if (!phone) return fail('Este pedido no tiene teléfono del cliente');

    // Idempotente: una sola confirmacion por pedido.
    const already = await prisma.orderEvent.findFirst({
      where: { orderId, type: 'wa_confirmation' },
      select: { id: true },
    });
    if (already) return fail('La confirmación de este pedido ya se había enviado.');

    // Datos del rawPayload de VTEX, igual que el flujo de n8n.
    const raw = (order.rawPayload ?? {}) as Record<string, any>;
    const cpd = raw.clientProfileData ?? {};
    const a = raw.shippingData?.address ?? {};
    const email = typeof raw.openTextField?.value === 'string' ? raw.openTextField.value : null;
    const direccion = [
      [a.street, a.neighborhood, a.city].filter(Boolean).join(', '),
      [a.state, a.complement].filter(Boolean).join(' '),
    ]
      .filter(Boolean)
      .join(', ');
    const productos = order.items.map((i) => `${i.quantity} ${i.name}`).join(', ');

    const token = await this.envelope.decryptField(tenantId, conn.encryptedToken);
    const http = this.client.buildHttp(token);

    let contact;
    try {
      // 1. Crear/actualizar contacto (Whapify hace upsert por telefono).
      contact = await this.client.createContact(http, {
        phone: typeof cpd.phone === 'string' && cpd.phone ? cpd.phone : `+57${phone}`,
        firstName: cpd.firstName ?? null,
        lastName: cpd.lastName ?? null,
        email,
      });
      if (!contact) {
        this.logger.warn(`Confirmacion WA: no se pudo crear el contacto (pedido ${order.externalId})`);
        return fail('Whapify no pudo crear el contacto del cliente');
      }

      // 2. Custom fields del flow (direccion + productos) y 3. disparar el flow.
      if (direccion) await this.client.setCustomField(http, contact.id, CF_ADDRESS_ID, direccion);
      if (productos) await this.client.setCustomField(http, contact.id, CF_PRODUCTS_ID, productos);
      await this.client.sendFlow(http, contact.id, CONFIRMATION_FLOW_ID);
    } catch (err) {
      // Manual: error claro al usuario. Automatico: se propaga al catch del
      // background (queda en el log y el pedido queda "Sin enviar" en la tabla).
      if (err instanceof BadRequestException) throw err;
      throw this.translateError(err, 'Whapify no pudo enviar la confirmación');
    }

    // 4. Registrar: evento del pedido + mensaje en el hilo + cache del contacto.
    await Promise.all([
      prisma.orderEvent.create({
        data: {
          orderId,
          type: 'wa_confirmation',
          actorName: 'SmartLogística',
          data: { flowId: CONFIRMATION_FLOW_ID, phone } as Prisma.InputJsonValue,
        },
      }),
      prisma.waMessage.create({
        data: {
          phone,
          direction: 'out',
          kind: 'text',
          body: `📋 Confirmación del pedido ${order.externalId} enviada (flujo de WhatsApp).`,
          authorName: 'SmartLogística',
          contactId: contact.id,
        },
      }),
      prisma.waContact.upsert({
        where: { phone },
        create: { phone, contactId: contact.id, name: contact.name },
        update: { contactId: contact.id, ...(contact.name ? { name: contact.name } : {}) },
      }),
    ]);
    await this.realtime.publish(tenantId, { kind: 'wa.message', phone });
    this.logger.log(`Confirmacion WA enviada: pedido ${order.externalId} -> ${phone}`);
  }

  // === Helpers ===

  /** Conexion + contacto de Whapify del CLIENTE del pedido (crea el contacto si no existe). */
  private async resolveTarget(orderId: string): Promise<{
    phone: string;
    contact: { id: string; name: string | null };
    http: AxiosInstance;
  }> {
    const { prisma } = getTenantContext();
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { customerPhone: true, customerName: true },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    const phone = order.customerPhone ? tenDigits(order.customerPhone) : '';
    if (!phone) throw new BadRequestException('Este pedido no tiene teléfono del cliente');

    const http = await this.httpOrNull();
    if (!http) {
      throw new BadRequestException('Whapify no esta conectado. Configúralo en Conexiones.');
    }

    // Cache local -> buscar en Whapify -> crear si no existe.
    const cached = await prisma.waContact.findUnique({ where: { phone } });
    if (cached?.contactId) return { phone, contact: { id: cached.contactId, name: cached.name }, http };

    let contact = await this.client.findContactByPhone(http, `57${phone}`).catch(() => null);
    if (!contact) {
      contact = await this.client
        .createContact(http, { phone: `+57${phone}`, ...splitName(order.customerName ?? '') })
        .catch(() => null);
    }
    if (!contact) {
      throw new BadRequestException(
        'No se pudo encontrar ni crear el contacto en Whapify para este teléfono',
      );
    }
    await prisma.waContact.upsert({
      where: { phone },
      create: { phone, contactId: contact.id, name: contact.name },
      update: { contactId: contact.id, ...(contact.name ? { name: contact.name } : {}) },
    });
    return { phone, contact, http };
  }

  private async toDto(r: WaMessageRow): Promise<WaMessageDto> {
    const mediaUrl = r.attachmentKey
      ? await this.storage.getSignedUrl(r.attachmentKey).catch(() => null)
      : r.mediaUrl;
    const kind = ['text', 'image', 'video', 'audio', 'file'].includes(r.kind)
      ? (r.kind as WaMessageDto['kind'])
      : 'text';
    return {
      id: r.id,
      direction: r.direction === 'out' ? 'out' : 'in',
      kind,
      body: r.body,
      mediaUrl,
      authorName: r.authorName,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private assertAdmin(auth: AuthContext): void {
    if (!isAdmin(auth)) {
      throw new ForbiddenException('WhatsApp es solo para administradores');
    }
  }

  private translateError(err: unknown, fallback: string): BadRequestException {
    if (isAxiosError(err)) {
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        return new BadRequestException('Whapify rechazo el token (401/403)');
      }
      const data = err.response?.data as { message?: string } | string | undefined;
      const msg =
        data && typeof data === 'object' && typeof data.message === 'string'
          ? data.message
          : typeof data === 'string'
            ? data.slice(0, 200)
            : null;
      return new BadRequestException(msg ? `Whapify: ${msg}` : `${fallback} (HTTP ${status ?? '?'})`);
    }
    this.logger.warn(`Whapify error: ${err instanceof Error ? err.message : err}`);
    return new BadRequestException(fallback);
  }
}
