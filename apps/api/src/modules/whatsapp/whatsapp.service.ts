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
  Dialog360ConnectionSummary,
  Dialog360CredentialsInput,
  Dialog360Mode,
  Dialog360TestResult,
  SendWaTextInput,
  WaInboundInput,
  WaMessage as WaMessageDto,
  WaThread,
  WhapifyConnectionSummary,
  WhapifyCredentialsInput,
  WhapifyTestResult,
} from '@smartlogistica/shared';
import type { Prisma, PrismaClient } from '.prisma/tenant-client';

import type { AuthContext } from '../../common/types/authenticated-request';
import { EnvelopeService } from '../../infrastructure/crypto/envelope.service';
import { ControlPlaneService } from '../../infrastructure/prisma/control-plane.service';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { getTenantContext } from '../../infrastructure/tenant-context';
import { Dialog360Client } from './dialog360-client.service';
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

// ============ Confirmacion NATIVA por Cloud API (360dialog) ============
// El "flujo" de Whapify calcado textual: la plantilla inicial (aprobada en la
// WABA; en sandbox se emula con texto + botones de sesion) y las ramas que
// nuestra plataforma responde sola segun el boton / la direccion que escriban.

/** Nombre/idioma de la plantilla aprobada (ajustar el dia de la migracion). */
const D360_TEMPLATE_NAME = process.env.D360_CONFIRMATION_TEMPLATE ?? 'order_confirmation';
const D360_TEMPLATE_LANG = process.env.D360_CONFIRMATION_LANG ?? 'es';

/** Cuerpo de la plantilla ({{1}} nombre, {{2}} productos, {{3}} direccion). */
const tplBody = (nombre: string, productos: string, direccion: string): string =>
  `¡Hola ${nombre}! 👋 Es un gusto saludarle 😄 Le escribimos de Smart Gadgets para ` +
  `confirmar su compra de: 📱 ${productos} Por nuestra plataforma de ADDI 💙 📍 A la ` +
  `dirección: ${direccion} Si desea agregar alguna información adicional o más específica, ` +
  `quedamos atentos para incluirla en la guía 😉 🔍 ¿Me confirma si sus datos son correctos? ‼️`;

const MSG_CONFIRMED =
  '¡Muchas gracias por confirmar 🙌 Su pedido ya quedó en alistamiento. Puede seguir el ' +
  'estado de su pedido desde la app de ADDI. Si hay alguna novedad con su pedido, le ' +
  'avisamos enseguida. 😊';
const MSG_ASK_ADDRESS =
  '¡Claro! 😊 Para modificar tu dirección de entrega, escríbela completa en un solo mensaje ' +
  'y sin agregar palabras adicionales.\n\nEjemplo:\nCalle 123 # 1-2, barrio San José, Medellín, ' +
  'Antioquia\n\nPor favor, envía únicamente la dirección con ese formato para poder actualizarla ' +
  'correctamente';
const MSG_RETRY_ADDRESS = 'Por favor vuelve a enviar tu dirección, en un ÚNICO mensaje.';
const msgConfirmDraft = (direccion: string): string =>
  `Le confirmo, su nueva dirección es:\n${direccion}\n\n¿Es correcto?`;

/** Estados del flujo por telefono (WaContact.flowState). */
type FlowState = 'awaiting_address' | 'awaiting_address_retry' | 'confirming' | 'confirming_retry';

/** Minusculas sin acentos ni signos, para comparar botones con tolerancia. */
function normBtn(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Archivo entrante/saliente: tope 50MB (igual que los adjuntos del chat). */
export const WA_FILE_MAX_BYTES = 50 * 1024 * 1024;

interface UploadedWaFile {
  buffer: Buffer;
  mimetype: string;
  originalname?: string;
}

// Acceso laxo a los payloads de la Cloud API (forma variable segun el tipo).
type Any = Record<string, any>;

interface WaMessageRow {
  id: string;
  direction: string;
  kind: string;
  body: string | null;
  attachmentKey: string | null;
  mediaUrl: string | null;
  authorName: string | null;
  buttons?: unknown;
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
    private readonly dialog360: Dialog360Client,
    private readonly envelope: EnvelopeService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeService,
    private readonly control: ControlPlaneService,
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

  // === Conexion 360dialog (Cloud API cruda — reemplazo de Whapify) ===

  async getDialog360(auth: AuthContext): Promise<Dialog360ConnectionSummary | null> {
    this.assertAdmin(auth);
    const { prisma } = getTenantContext();
    const conn = await prisma.dialog360Connection.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!conn) return null;
    return {
      mode: (conn.mode === 'sandbox' ? 'sandbox' : 'production') as Dialog360Mode,
      status: conn.status === 'error' ? 'error' : 'connected',
      lastError: conn.lastError,
      webhookUrl: conn.webhookUrl,
      createdAt: conn.createdAt.toISOString(),
    };
  }

  async testDialog360(input: Dialog360CredentialsInput, auth: AuthContext): Promise<Dialog360TestResult> {
    this.assertAdmin(auth);
    try {
      await this.dialog360.getWebhook(this.dialog360.buildHttp(input.apiKey, input.mode));
      return { ok: true };
    } catch (err) {
      throw this.translateError(err, 'No se pudo conectar a 360dialog (¿API key/modo correctos?)');
    }
  }

  /**
   * Conecta 360dialog: valida el key, lo guarda cifrado y AUTO-CONFIGURA el
   * webhook del numero hacia esta plataforma (asi entra TODO: mensajes, medios
   * y, con coexistencia, los enviados desde el celular).
   */
  async connectDialog360(
    input: Dialog360CredentialsInput,
    auth: AuthContext,
    publicBaseUrl: string,
  ): Promise<Dialog360ConnectionSummary> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();

    const secret = process.env.CONFIRMATION_WEBHOOK_SECRET;
    if (!secret) {
      throw new BadRequestException('Falta CONFIRMATION_WEBHOOK_SECRET en el servidor');
    }
    const tenant = await this.control.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new BadRequestException('Tenant no encontrado');

    const http = this.dialog360.buildHttp(input.apiKey, input.mode);
    const webhookUrl = `${publicBaseUrl}/v1/webhooks/dialog360/${tenant.slug}?token=${encodeURIComponent(secret)}`;
    try {
      await this.dialog360.setWebhook(http, webhookUrl);
    } catch (err) {
      throw this.translateError(err, 'El API key de 360dialog es invalido o no se pudo configurar el webhook');
    }

    const encryptedApiKey = await this.envelope.encryptField(tenantId, input.apiKey);
    await prisma.dialog360Connection.deleteMany({});
    const conn = await prisma.dialog360Connection.create({
      data: { encryptedApiKey, mode: input.mode, webhookUrl, status: 'connected', lastError: null },
    });
    return {
      mode: input.mode,
      status: 'connected',
      lastError: null,
      webhookUrl,
      createdAt: conn.createdAt.toISOString(),
    };
  }

  async disconnectDialog360(auth: AuthContext): Promise<void> {
    this.assertAdmin(auth);
    const { prisma } = getTenantContext();
    await prisma.dialog360Connection.deleteMany({});
  }

  /** Cliente 360dialog listo (null si no hay conexion). Prisma explicito: lo usa tambien el webhook. */
  private async dialog360OrNull(
    tenantId: string,
    prisma: PrismaClient,
  ): Promise<{ http: AxiosInstance; mode: Dialog360Mode } | null> {
    const conn = await prisma.dialog360Connection.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!conn) return null;
    const apiKey = await this.envelope.decryptField(tenantId, conn.encryptedApiKey);
    const mode: Dialog360Mode = conn.mode === 'sandbox' ? 'sandbox' : 'production';
    return { http: this.dialog360.buildHttp(apiKey, mode), mode };
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
    // Conectado = CUALQUIERA de los dos proveedores (Whapify o 360dialog).
    const [whapify, d360] = await Promise.all([
      prisma.whapifyConnection.findFirst({ select: { id: true } }),
      prisma.dialog360Connection.findFirst({ select: { id: true } }),
    ]);
    const conn = whapify ?? d360;
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

    // Ruteo: 360dialog SOLO si gobierna este pedido (produccion, o sandbox con
    // pedido de prueba); si no, Whapify (abajo).
    const d360 = await this.dialog360OrNull(tenantId, prisma);
    const { phone: targetPhone360, provider } = await this.orderPhone(orderId);
    if (d360 && this.d360Governs(d360, provider)) {
      const phone = targetPhone360;
      let wamid: string | null = null;
      try {
        wamid = await this.dialog360.sendText(d360.http, d360.mode, `57${phone}`, input.text);
      } catch (err) {
        throw this.translateError(err, '360dialog no pudo enviar el mensaje');
      }
      const row = await prisma.waMessage.create({
        data: {
          phone,
          direction: 'out',
          kind: 'text',
          body: input.text,
          authorId: auth.userId,
          authorName: auth.name?.trim() || auth.email,
          externalId: wamid,
        },
      });
      await this.realtime.publish(tenantId, { kind: 'wa.message', phone });
      return this.toDto(row);
    }

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
    const d360raw = await this.dialog360OrNull(tenantId, prisma);
    const { phone: phone360, provider } = await this.orderPhone(orderId);
    // Mismo ruteo que sendText: sandbox solo gobierna pedidos de prueba.
    const d360 = d360raw && this.d360Governs(d360raw, provider) ? d360raw : null;
    const target = d360 ? null : await this.resolveTarget(orderId);
    const targetPhone = target?.phone ?? phone360;

    const name = file.originalname || 'archivo';
    const ext = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1];
    const key = `tenants/${tenantId}/whatsapp/${targetPhone}/${randomUUID()}${ext ? `.${ext.toLowerCase()}` : ''}`;
    await this.storage.put(key, file.buffer, file.mimetype || 'application/octet-stream');
    const url = await this.storage.getSignedUrl(key);

    let wamid: string | null = null;
    try {
      if (d360) {
        const kind = waTypeOf(file.mimetype || '');
        wamid = await this.dialog360.sendMediaLink(
          d360.http,
          d360.mode,
          `57${targetPhone}`,
          kind === 'file' ? 'document' : kind,
          url,
          kind === 'file' ? name : undefined,
        );
      } else {
        await this.client.sendFile(target!.http, target!.contact.id, url, waTypeOf(file.mimetype || ''));
      }
    } catch (err) {
      await this.storage.delete(key).catch(() => null);
      throw this.translateError(
        err,
        d360 ? '360dialog no pudo enviar el archivo' : 'Whapify no pudo enviar el archivo',
      );
    }

    const row = await prisma.waMessage.create({
      data: {
        phone: targetPhone,
        direction: 'out',
        kind: waTypeOf(file.mimetype || ''),
        body: name,
        attachmentKey: key,
        authorId: auth.userId,
        authorName: auth.name?.trim() || auth.email,
        contactId: target?.contact.id ?? null,
        externalId: wamid,
      },
    });
    await this.realtime.publish(tenantId, { kind: 'wa.message', phone: targetPhone });
    return this.toDto(row);
  }

  /** Telefono (10 digitos) + provider del pedido, o error claro. */
  private async orderPhone(orderId: string): Promise<{ phone: string; provider: string }> {
    const { prisma } = getTenantContext();
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { customerPhone: true, provider: true },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    const phone = order.customerPhone ? tenDigits(order.customerPhone) : '';
    if (!phone) throw new BadRequestException('Este pedido no tiene teléfono del cliente');
    return { phone, provider: order.provider };
  }

  /**
   * ¿Este envio va por 360dialog? El SANDBOX solo alcanza el numero de prueba
   * -> solo pedidos MONTADOS a mano; lo demas va por Whapify hasta produccion.
   */
  private d360Governs(
    d360: { mode: Dialog360Mode } | null,
    provider: string,
  ): boolean {
    return Boolean(d360 && (d360.mode === 'production' || provider === 'manual'));
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
   * Webhook de la CLOUD API (360dialog): mensajes entrantes, medios y — con
   * coexistencia — los ECHOES de lo enviado desde el celular/WhatsApp Web.
   * Corre FUERA del contexto tenant (recibe prisma). Best-effort por mensaje.
   */
  async inboundCloud(tenantId: string, prisma: PrismaClient, payload: unknown): Promise<void> {
    const root = payload as { entry?: Array<{ changes?: Array<{ value?: Any }> }> };
    const touched = new Set<string>();

    for (const entry of root.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const v = change.value;
        if (!v || typeof v !== 'object') continue;
        // Nombre del contacto segun WhatsApp (viene junto a los mensajes).
        const names = new Map<string, string>();
        for (const c of v.contacts ?? []) {
          if (c?.wa_id && c?.profile?.name) names.set(String(c.wa_id), String(c.profile.name));
        }
        for (const m of v.messages ?? []) {
          const phone = await this.storeCloudMessage(tenantId, prisma, m, 'in', names);
          if (phone) {
            touched.add(phone);
            // El "cerebro" del flujo de confirmacion: botones y captura de la
            // direccion nueva. Best-effort — jamas tumba la recepcion.
            await this.handleFlowReply(tenantId, prisma, phone, m).catch((err) =>
              this.logger.warn(`Flujo de confirmacion fallo (${phone}): ${err instanceof Error ? err.message : err}`),
            );
          }
        }
        // Coexistencia: lo que el negocio envia desde la APP se espeja aqui.
        for (const m of v.message_echoes ?? v.smb_message_echoes ?? []) {
          const phone = await this.storeCloudMessage(tenantId, prisma, m, 'out', names);
          if (phone) touched.add(phone);
        }
        // v.statuses (sent/delivered/read): por ahora no se pintan.
      }
    }

    for (const phone of touched) {
      await this.realtime.publish(tenantId, { kind: 'wa.message', phone });
    }

    // El nombre del contacto se refresca con lo que diga WhatsApp.
    // (Se hace al final para no bloquear los mensajes.)
  }

  /**
   * MOTOR del flujo de confirmacion (calcado del de Whapify): interpreta los
   * botones y la direccion que escribe el cliente, responde las ramas y
   * actualiza la columna Direccion. Estado por telefono en WaContact.flowState.
   */
  private async handleFlowReply(
    tenantId: string,
    prisma: PrismaClient,
    phone: string,
    m: Any,
  ): Promise<void> {
    const d360 = await this.dialog360OrNull(tenantId, prisma);
    if (!d360) return; // sin Cloud API, el flujo vive en Whapify

    const contact = await prisma.waContact.findUnique({ where: { phone } });
    const state = (contact?.flowState ?? null) as FlowState | null;

    // Boton tocado (plantilla => type 'button'; sesion => interactive.button_reply).
    const btnTitle = m.interactive?.button_reply?.title ?? m.button?.text ?? null;
    const payload = m.interactive?.button_reply?.id ?? m.button?.payload ?? null;
    const btn = btnTitle ? normBtn(String(btnTitle)) : null;
    const pay = payload ? String(payload) : null;
    const text = m.type === 'text' ? String(m.text?.body ?? '').trim() : '';

    const to = `57${phone}`;
    const say = async (body: string): Promise<void> => {
      const wamid = await this.dialog360.sendText(d360.http, d360.mode, to, body);
      await prisma.waMessage.create({
        data: { phone, direction: 'out', kind: 'text', body, authorName: 'SmartLogística', externalId: wamid },
      });
      await this.realtime.publish(tenantId, { kind: 'wa.message', phone });
    };
    const sayButtons = async (body: string, buttons: Array<{ id: string; title: string }>): Promise<void> => {
      const wamid = await this.dialog360.sendInteractiveButtons(d360.http, d360.mode, to, body, buttons);
      await prisma.waMessage.create({
        data: {
          phone,
          direction: 'out',
          kind: 'text',
          body,
          authorName: 'SmartLogística',
          externalId: wamid,
          buttons: buttons.map((b) => b.title) as Prisma.InputJsonValue,
        },
      });
      await this.realtime.publish(tenantId, { kind: 'wa.message', phone });
    };
    const setState = async (flowState: FlowState | null, draftAddress: string | null): Promise<void> => {
      await prisma.waContact.upsert({
        where: { phone },
        create: { phone, contactId: '', flowState, draftAddress },
        update: { flowState, draftAddress },
      });
    };

    if (btn || pay) {
      // ¿Confirmando el BORRADOR de la direccion nueva?
      if (state === 'confirming' || state === 'confirming_retry') {
        if (pay === 'DRAFT_OK' || btn?.includes('si es correcto')) {
          const addr = contact?.draftAddress?.trim() ?? '';
          await setState(null, null);
          if (addr) await this.applyAddressNative(tenantId, prisma, phone, 'modified', addr);
          await say(MSG_CONFIRMED);
          return;
        }
        if (pay === 'DRAFT_NO' || btn?.includes('no es correcto')) {
          await setState('awaiting_address_retry', null);
          await say(MSG_RETRY_ADDRESS);
          return;
        }
      }
      // Botones de la PLANTILLA inicial.
      if (pay === 'CONFIRMED' || btn?.includes('mis datos son correctos') || btn?.includes('datos correctos')) {
        await setState(null, null);
        await this.applyAddressNative(tenantId, prisma, phone, 'confirmed');
        await say(MSG_CONFIRMED);
        return;
      }
      if (pay === 'MODIFY' || btn?.includes('modificar')) {
        await setState('awaiting_address', null);
        await say(MSG_ASK_ADDRESS);
        return;
      }
      return;
    }

    // Texto libre mientras esperamos la direccion nueva.
    if (text && (state === 'awaiting_address' || state === 'awaiting_address_retry')) {
      const retry = state === 'awaiting_address_retry';
      await setState(retry ? 'confirming_retry' : 'confirming', text);
      await sayButtons(
        msgConfirmDraft(text),
        retry
          ? [{ id: 'DRAFT_OK', title: 'Sí es correcto.' }]
          : [
              { id: 'DRAFT_OK', title: 'Sí es correcto.' },
              { id: 'DRAFT_NO', title: 'No es correcto.' },
            ],
      );
    }
  }

  /**
   * Aplica la confirmacion/modificacion de direccion a los pedidos PENDIENTES
   * del telefono (calcado del webhook de Whapify, pero nativo). Los mensajes ya
   * quedaron en el hilo via el webhook Cloud — aqui solo columna + log.
   */
  private async applyAddressNative(
    tenantId: string,
    prisma: PrismaClient,
    phone: string,
    action: 'confirmed' | 'modified',
    address?: string,
  ): Promise<void> {
    const candidates = await prisma.order.findMany({
      where: {
        customerPhone: { contains: phone },
        provider: { not: 'manual' },
        events: { none: { type: { in: ['vtex_invoiced', 'manual_completed'] } } },
      },
      select: { id: true, customerPhone: true },
    });
    const ids = candidates
      .filter((o) => o.customerPhone && tenDigits(o.customerPhone) === phone)
      .map((o) => o.id);
    if (ids.length > 0) {
      await prisma.order.updateMany({
        where: { id: { in: ids } },
        data: {
          addressStatus: action,
          confirmedAddress: action === 'modified' ? (address?.trim() ?? null) : null,
          addressConfirmedAt: new Date(),
        },
      });
    }
    await prisma.confirmationLog
      .create({
        data: {
          phone,
          action,
          address: address?.trim() || null,
          matched: ids.length,
          note: ids.length > 0 ? 'Cloud API (flujo nativo)' : 'Cloud API: sin pedido pendiente con ese telefono',
        },
      })
      .catch(() => null);
    await this.realtime.publish(tenantId, { kind: 'orders.refresh' });
    this.logger.log(`Direccion ${action} via Cloud API: ...${phone} (${ids.length} pedido(s))`);
  }

  /** Guarda UN mensaje del payload Cloud (con dedup por wamid). Devuelve el telefono. */
  private async storeCloudMessage(
    tenantId: string,
    prisma: PrismaClient,
    m: Any,
    direction: 'in' | 'out',
    names: Map<string, string>,
  ): Promise<string | null> {
    try {
      const rawPhone = direction === 'in' ? m.from : (m.to ?? m.recipient_id ?? m.from);
      if (!rawPhone) return null;
      const phone = tenDigits(String(rawPhone));
      if (phone.length < 7) return null;
      const externalId = typeof m.id === 'string' ? m.id : null;

      // Dedup: la Cloud API reintenta entregas del webhook.
      if (externalId) {
        const dup = await prisma.waMessage.findUnique({ where: { externalId }, select: { id: true } });
        if (dup) return null;
      }

      const type = String(m.type ?? 'text');
      let kind: WaMessageDto['kind'] = 'text';
      let body: string | null = null;
      let attachmentKey: string | null = null;
      let mediaUrl: string | null = null;

      if (type === 'text') {
        body = m.text?.body ?? null;
      } else if (['image', 'video', 'audio', 'document', 'sticker'].includes(type)) {
        const media = m[type] ?? {};
        kind = type === 'document' ? 'file' : type === 'sticker' ? 'image' : (type as WaMessageDto['kind']);
        body = media.caption ?? media.filename ?? null;
        // Bajar el medio YA (la URL de Meta expira en 5 min) y guardarlo nuestro.
        if (media.id) {
          const d360 = await this.dialog360OrNull(tenantId, prisma);
          if (d360 && this.storage.isConfigured()) {
            const bin = await this.dialog360.downloadMedia(d360.http, d360.mode, String(media.id));
            if (bin) {
              const ext = (bin.mime.split('/')[1] ?? 'bin').split(';')[0].trim();
              const key = `tenants/${tenantId}/whatsapp/${phone}/${randomUUID()}.${ext}`;
              await this.storage.put(key, bin.buffer, bin.mime);
              attachmentKey = key;
            } else {
              this.logger.warn(
                `Medio ${type} ${media.id} no se pudo descargar (modo ${d360.mode}); se guarda sin archivo`,
              );
            }
          }
        }
        // Algunos payloads (sandbox) traen la URL directa del medio.
        if (!attachmentKey && typeof media.link === 'string' && /^https?:/.test(media.link)) {
          mediaUrl = media.link;
        }
        if (!attachmentKey && !mediaUrl) body = body ?? `[${type} recibido]`;
        // Diagnostico: si no se pudo bajar, conservar el media id (columna
        // contactId, que los mensajes Cloud no usan) para sondearlo despues.
        if (!attachmentKey && !mediaUrl && media.id) {
          (m as Any).__failedMediaId = String(media.id);
        }
      } else if (type === 'interactive') {
        body = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '[interacción]';
      } else if (type === 'button') {
        body = m.button?.text ?? '[botón]';
      } else if (type === 'location') {
        body = `📍 Ubicación: ${m.location?.latitude ?? '?'}, ${m.location?.longitude ?? '?'}`;
      } else {
        body = `[${type}]`;
      }

      await prisma.waMessage.create({
        data: {
          phone,
          direction,
          kind,
          body,
          attachmentKey,
          mediaUrl,
          // contactId reutilizado como stash de diagnostico del media id fallido.
          contactId: (m as Any).__failedMediaId ? `media:${(m as Any).__failedMediaId}` : null,
          authorName:
            direction === 'out'
              ? 'WhatsApp (celular)'
              : (names.get(String(rawPhone)) ?? null),
          externalId,
        },
      });

      // Refrescar el nombre del contacto si WhatsApp lo trae.
      const name = names.get(String(rawPhone));
      if (direction === 'in' && name) {
        await prisma.waContact
          .upsert({
            where: { phone },
            create: { phone, contactId: '', name },
            update: { name },
          })
          .catch(() => null);
      }
      return phone;
    } catch (err) {
      // P2002 = duplicado que se colo en paralelo — ignorar en silencio.
      if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002') {
        return null;
      }
      this.logger.warn(`Mensaje Cloud no guardado: ${err instanceof Error ? err.message : err}`);
      return null;
    }
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

    const [whapifyConn, d360] = await Promise.all([
      prisma.whapifyConnection.findFirst({ orderBy: { createdAt: 'desc' } }),
      this.dialog360OrNull(tenantId, prisma),
    ]);
    if (!whapifyConn && !d360) {
      // auto: n8n (u nadie) sigue a cargo
      return fail('WhatsApp no está conectado (ni 360dialog ni Whapify). Configúralo en Conexiones.');
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { orderBy: { name: 'asc' } } },
    });
    if (!order) return fail('Pedido no encontrado');
    // VTEX y tambien MONTADOS a mano (su rawPayload imita la forma VTEX, asi
    // que la plantilla se llena igual). El AUTO solo se dispara para VTEX.
    if (order.provider !== 'vtex' && order.provider !== 'manual') {
      return fail('La confirmación no aplica a este pedido');
    }
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

    // ===== Camino CLOUD API (360dialog): plantilla en produccion, emulacion
    // con botones de sesion en sandbox. Las ramas las responde handleFlowReply.
    // REGLA DE RUTEO: el SANDBOX solo puede escribirle al numero de prueba
    // vinculado -> solo toma los pedidos MONTADOS a mano (ensayos). Los VTEX
    // REALES siguen saliendo por WHAPIFY (abajo) hasta tener 360dialog en
    // PRODUCCION — el sandbox JAMAS les roba el turno.
    const viaD360 = Boolean(d360 && (d360.mode === 'production' || order.provider === 'manual'));
    if (viaD360 && d360) {
      const nombre =
        `${cpd.firstName ?? ''} ${cpd.lastName ?? ''}`.trim() || (order.customerName ?? 'cliente');
      const rendered = tplBody(nombre, productos || '—', direccion || '—');
      let wamid: string | null = null;
      try {
        if (d360.mode === 'sandbox') {
          wamid = await this.dialog360.sendInteractiveButtons(d360.http, d360.mode, `57${phone}`, rendered, [
            { id: 'CONFIRMED', title: 'Datos correctos ✅' },
            { id: 'MODIFY', title: 'Modificar dirección' },
          ]);
        } else {
          wamid = await this.dialog360.sendTemplate(
            d360.http,
            d360.mode,
            `57${phone}`,
            D360_TEMPLATE_NAME,
            D360_TEMPLATE_LANG,
            [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: nombre },
                  { type: 'text', text: productos || '—' },
                  { type: 'text', text: direccion || '—' },
                ],
              },
              { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'CONFIRMED' }] },
              { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'MODIFY' }] },
            ],
          );
        }
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
        throw this.translateError(err, '360dialog no pudo enviar la confirmación');
      }

      await Promise.all([
        prisma.orderEvent.create({
          data: {
            orderId,
            type: 'wa_confirmation',
            actorName: 'SmartLogística',
            data: { via: 'dialog360', mode: d360.mode, phone } as Prisma.InputJsonValue,
          },
        }),
        // Con Cloud API el mensaje del hilo es el TEXTO REAL enviado (con botones).
        prisma.waMessage.create({
          data: {
            phone,
            direction: 'out',
            kind: 'text',
            body: rendered,
            authorName: 'SmartLogística',
            externalId: wamid,
            buttons: (d360.mode === 'sandbox'
              ? ['Datos correctos ✅', 'Modificar dirección']
              : ['Mis datos son correctos.', 'Modificar mi dirección.']) as unknown as Prisma.InputJsonValue,
          },
        }),
      ]);
      await this.realtime.publish(tenantId, { kind: 'wa.message', phone });
      this.logger.log(`Confirmacion Cloud enviada: pedido ${order.externalId} -> ${phone}`);
      return;
    }

    // ===== Camino WHAPIFY (flujo) — se mantiene hasta la migracion.
    if (!whapifyConn) {
      return fail(
        'Solo está conectado el SANDBOX de 360dialog y no puede escribirle a clientes reales. Conecta Whapify (o 360dialog en producción).',
      );
    }
    const token = await this.envelope.decryptField(tenantId, whapifyConn.encryptedToken);
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
          // El TEXTO literal del flujo vive en Whapify (su API no lo expone);
          // aqui queda lo que sabemos que se le envio: el pedido y los datos
          // inyectados al flujo (productos + direccion a confirmar).
          body: [
            `📋 Confirmación del pedido ${order.externalId} enviada`,
            productos ? `📦 ${productos}` : null,
            direccion ? `📍 ${direccion}` : null,
          ]
            .filter(Boolean)
            .join('\n'),
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
      buttons: Array.isArray(r.buttons) ? (r.buttons as unknown[]).map(String) : [],
      createdAt: r.createdAt.toISOString(),
    };
  }

  private assertAdmin(auth: AuthContext): void {
    // TEMPORAL (pedido del propietario): mientras la integracion con Whapify
    // madura, TODO WhatsApp es SOLO del OWNER (el primer administrador) — los
    // demas ni lo ven. Para abrirlo al resto de admins: volver a isAdmin(auth).
    if (auth.role !== 'OWNER') {
      throw new ForbiddenException('WhatsApp está en pruebas: solo el propietario puede usarlo');
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
