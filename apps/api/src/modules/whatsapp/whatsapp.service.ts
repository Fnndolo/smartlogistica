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
  SendWaTemplateInput,
  SendWaTextInput,
  WaMessage as WaMessageDto,
  WaTemplateList,
  WaThread,
} from '@smartlogistica/shared';
import type { Prisma, PrismaClient } from '.prisma/tenant-client';

import type { AuthContext } from '../../common/types/authenticated-request';
import { EnvelopeService } from '../../infrastructure/crypto/envelope.service';
import { ControlPlaneService } from '../../infrastructure/prisma/control-plane.service';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { getTenantContext } from '../../infrastructure/tenant-context';
import { Dialog360Client } from './dialog360-client.service';

/** Ultimos mensajes que carga el hilo (el historial completo queda guardado). */
const THREAD_TAKE = 500;

/**
 * CONFIRMACION DE PEDIDO (nativa, por la Cloud API de Meta via 360dialog):
 * cuando llega un pedido NUEVO de VTEX en ready-for-handling se envia la
 * plantilla de confirmacion; los botones/respuestas los procesa
 * handleFlowReply (webhook de la Cloud API).
 */
/** Solo pedidos RECIENTES: un backfill de pedidos viejos JAMAS debe escribirle a nadie. */
const CONFIRMATION_MAX_AGE_MS = 48 * 3_600_000;

// ============ Confirmacion NATIVA por Cloud API (360dialog) ============
// La plantilla inicial (aprobada en la WABA; en sandbox se emula con texto +
// botones de sesion) y las ramas que nuestra plataforma responde sola segun
// el boton / la direccion que escriba el cliente.

// PREDETERMINADA: la plantilla ORIGINAL del negocio (emojis), aprobada como
// UTILITY. OJO: el nombre "order_confirmation" esta VETADO en Meta para este
// negocio (quedo asociado a categoria MARKETING).
const D360_TEMPLATE_NAME = process.env.D360_CONFIRMATION_TEMPLATE ?? 'confirmacion_compra_smart';
const D360_TEMPLATE_LANG = process.env.D360_CONFIRMATION_LANG ?? 'es';
/**
 * Prioridad de plantillas de confirmacion — lista FIJA de nombres (una
 * plantilla nueva en la WABA jamas se cuela aqui): se usa la primera que este
 * APROBADA. La original con emojis es la predeterminada; la sobria
 * (confirmacion_datos_pedido) es solo el respaldo si Meta llegara a
 * pausar/rechazar la principal.
 */
const CONFIRMATION_TEMPLATE_PRIORITY = [
  ...(process.env.D360_CONFIRMATION_TEMPLATE ? [process.env.D360_CONFIRMATION_TEMPLATE] : []),
  'confirmacion_compra_smart',
  'confirmacion_datos_pedido',
];

/**
 * Cuerpo de la plantilla predeterminada ({{1}} nombre, {{2}} productos,
 * {{3}} direccion): la ORIGINAL del negocio, aprobada como UTILITY en la WABA
 * (confirmacion_compra_smart). Es solo el RESPALDO para renderizar el hilo /
 * el sandbox — en produccion el texto se relee de la WABA al enviar.
 */
const tplBody = (nombre: string, productos: string, direccion: string): string =>
  `¡Hola ${nombre}! 👋 Es un gusto saludarle 😃\n\n` +
  `Le escribimos de Smart Gadgets para confirmar su compra de:\n` +
  `📱 ${productos}\n` +
  `Por nuestra plataforma de ADDI 💙\n\n` +
  `📍 A la dirección:\n` +
  `${direccion}\n\n` +
  `Si desea agregar alguna información adicional o más específica, quedamos atentos ` +
  `para incluirla en la guía 😉\n\n` +
  `🔍 ¿Me confirma si sus datos son correctos? ‼️`;

/** Cuantas variables {{n}} usa el cuerpo de una plantilla. */
const templateVarCount = (body: string): number =>
  Math.max(0, ...[...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));

/** Reemplaza {{n}} por los valores — el TEXTO REAL que le llega al cliente. */
const renderTemplateBody = (body: string, params: string[]): string =>
  body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? '');

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
  replyToId?: string | null;
  reactions?: unknown;
  status?: string | null;
  createdAt: Date;
}

const WA_KINDS = ['text', 'image', 'video', 'audio', 'file', 'sticker'] as const;
const waKindOf = (k: string): WaMessageDto['kind'] =>
  (WA_KINDS as readonly string[]).includes(k) ? (k as WaMessageDto['kind']) : 'text';

/** Ultimos 10 digitos (CO): "+57 300 123 4567" -> "3001234567". */
function tenDigits(phone: string): string {
  const d = phone.replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

/** Tipo de mensaje de WhatsApp segun el mime del archivo. */
function waTypeOf(mime: string): 'image' | 'video' | 'audio' | 'file' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

/**
 * WhatsApp por pedido (Cloud API de Meta via 360dialog). El historial vive en
 * WaMessage (por telefono): los salientes se guardan al enviarlos desde aqui;
 * TODO lo demas (entrantes, medios, echoes del celular con coexistencia,
 * estados) llega por el webhook de la Cloud API. Solo administradores.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly dialog360: Dialog360Client,
    private readonly envelope: EnvelopeService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeService,
    private readonly control: ControlPlaneService,
  ) {}

  // === Conexion 360dialog (Cloud API de Meta) ===

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
    const conn = await prisma.dialog360Connection.findFirst({ select: { id: true } });
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

    const byId = new Map(rows.map((r) => [r.id, r] as const));
    return {
      phone,
      connected: Boolean(conn),
      contactName: contact?.name ?? null,
      messages: await Promise.all(rows.map((r) => this.toDto(r, byId))),
    };
  }

  /** Envia TEXTO al cliente del pedido y lo guarda en el historial. */
  async sendText(orderId: string, input: SendWaTextInput, auth: AuthContext): Promise<WaMessageDto> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();

    const d360 = await this.dialog360OrNull(tenantId, prisma);
    const { phone, provider } = await this.orderPhone(orderId);
    this.requireD360(d360, provider);
    let wamid: string | null = null;
    try {
      wamid = await this.dialog360.sendText(d360!.http, d360!.mode, `57${phone}`, input.text);
    } catch (err) {
      throw this.translateError(err, 'No se pudo enviar el mensaje');
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
        status: wamid ? 'sent' : null,
      },
    });
    await this.publishWaMessage(tenantId, prisma, row);
    return this.toDto(row);
  }

  /** Envia un ARCHIVO (imagen/video/audio/documento) y lo guarda en el historial. */
  async sendFile(orderId: string, file: UploadedWaFile, auth: AuthContext): Promise<WaMessageDto> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();
    if (!this.storage.isConfigured()) {
      throw new BadRequestException('El almacenamiento de archivos no esta configurado');
    }
    const d360 = await this.dialog360OrNull(tenantId, prisma);
    const { phone, provider } = await this.orderPhone(orderId);
    this.requireD360(d360, provider);

    const name = file.originalname || 'archivo';
    const ext = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1];
    const key = `tenants/${tenantId}/whatsapp/${phone}/${randomUUID()}${ext ? `.${ext.toLowerCase()}` : ''}`;
    await this.storage.put(key, file.buffer, file.mimetype || 'application/octet-stream');
    const url = await this.storage.getSignedUrl(key);

    let wamid: string | null = null;
    try {
      const kind = waTypeOf(file.mimetype || '');
      wamid = await this.dialog360.sendMediaLink(
        d360!.http,
        d360!.mode,
        `57${phone}`,
        kind === 'file' ? 'document' : kind,
        url,
        kind === 'file' ? name : undefined,
      );
    } catch (err) {
      await this.storage.delete(key).catch(() => null);
      throw this.translateError(err, 'No se pudo enviar el archivo');
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
        externalId: wamid,
        status: wamid ? 'sent' : null,
      },
    });
    await this.publishWaMessage(tenantId, prisma, row);
    return this.toDto(row);
  }

  // === Plantillas de Meta (el picker de "/" en el chat) ===

  /**
   * Plantillas REALES de la WABA (via 360dialog en produccion) + sugerencias
   * del pedido para prellenar variables — convencion del negocio:
   * {{1}} nombre, {{2}} productos, {{3}} direccion.
   */
  async listTemplates(orderId: string, auth: AuthContext): Promise<WaTemplateList> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { orderBy: { name: 'asc' } } },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    // Mismos datos que usa la confirmacion automatica (rawPayload forma VTEX).
    const raw = (order.rawPayload ?? {}) as Record<string, any>;
    const cpd = raw.clientProfileData ?? {};
    const a = raw.shippingData?.address ?? {};
    const suggestions = {
      nombre:
        `${cpd.firstName ?? ''} ${cpd.lastName ?? ''}`.trim() || (order.customerName ?? ''),
      productos: order.items.map((i) => `${i.quantity} ${i.name}`).join(', '),
      direccion: [
        [a.street, a.neighborhood, a.city].filter(Boolean).join(', '),
        [a.state, a.complement].filter(Boolean).join(' '),
      ]
        .filter(Boolean)
        .join(', '),
    };

    const d360 = await this.dialog360OrNull(tenantId, prisma);
    // El sandbox no tiene WABA propia con plantillas: lista vacia (la UI lo dice).
    if (!d360 || d360.mode !== 'production') return { templates: [], suggestions };
    try {
      const list = await this.dialog360.listTemplates(d360.http);
      return {
        templates: list.map((t) => ({ ...t, variables: templateVarCount(t.body) })),
        suggestions,
      };
    } catch (err) {
      throw this.translateError(err, 'No se pudieron cargar las plantillas de la WABA');
    }
  }

  /** Envia una plantilla de Meta al cliente del pedido (elegida con "/"). */
  async sendTemplate(
    orderId: string,
    input: SendWaTemplateInput,
    auth: AuthContext,
  ): Promise<WaMessageDto> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();
    const d360 = await this.dialog360OrNull(tenantId, prisma);
    if (!d360 || d360.mode !== 'production') {
      throw new BadRequestException(
        'Las plantillas requieren la conexión de 360dialog en producción',
      );
    }
    const { phone } = await this.orderPhone(orderId);

    // Se relee de la WABA (no se confia en el cliente): cuerpo, estado y
    // numero de variables REALES de la plantilla.
    let all;
    try {
      all = await this.dialog360.listTemplates(d360.http);
    } catch (err) {
      throw this.translateError(err, 'No se pudieron cargar las plantillas de la WABA');
    }
    const tpl =
      all.find((t) => t.name === input.name && t.language === input.language) ??
      all.find((t) => t.name === input.name);
    if (!tpl) throw new NotFoundException('Esa plantilla no existe en la WABA');
    if (tpl.status !== 'approved') {
      throw new BadRequestException(
        `La plantilla "${tpl.name}" aún no está aprobada por Meta (estado: ${tpl.status})`,
      );
    }
    const vars = templateVarCount(tpl.body);
    const params = input.params.slice(0, vars);
    if (params.length < vars) {
      throw new BadRequestException(`La plantilla usa ${vars} variables y llegaron ${params.length}`);
    }

    const components =
      vars > 0
        ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }]
        : [];
    let wamid: string | null = null;
    try {
      wamid = await this.dialog360.sendTemplate(
        d360.http,
        d360.mode,
        `57${phone}`,
        tpl.name,
        tpl.language,
        components,
      );
    } catch (err) {
      throw this.translateError(err, '360dialog no pudo enviar la plantilla');
    }

    // En el hilo queda el TEXTO REAL (variables sustituidas) + sus botones.
    const row = await prisma.waMessage.create({
      data: {
        phone,
        direction: 'out',
        kind: 'text',
        body: renderTemplateBody(tpl.body, params),
        authorId: auth.userId,
        authorName: auth.name?.trim() || auth.email,
        externalId: wamid,
        status: wamid ? 'sent' : null,
        ...(tpl.buttons.length
          ? { buttons: tpl.buttons as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
    await this.publishWaMessage(tenantId, prisma, row);
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
   * ¿360dialog gobierna este pedido? En PRODUCCION gobierna todo; el SANDBOX
   * solo alcanza el numero de prueba vinculado -> solo pedidos MONTADOS a mano.
   */
  private d360Governs(
    d360: { mode: Dialog360Mode } | null,
    provider: string,
  ): boolean {
    return Boolean(d360 && (d360.mode === 'production' || provider === 'manual'));
  }

  /** Corta con error claro si no hay conexion 360dialog que gobierne el pedido. */
  private requireD360(d360: { mode: Dialog360Mode } | null, provider: string): void {
    if (!d360) {
      throw new BadRequestException('WhatsApp no está conectado. Configura 360dialog en Conexiones.');
    }
    if (!this.d360Governs(d360, provider)) {
      throw new BadRequestException(
        'El SANDBOX de 360dialog solo puede escribirle al número de prueba. Conecta 360dialog en PRODUCCIÓN.',
      );
    }
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
        // HISTORIAL de coexistencia (hasta 6 meses del celular, en fases y
        // chunks): se importa TODO con su fecha/estado originales (dedup por
        // wamid). Sin SSE por mensaje (pueden ser miles) — refetch al final.
        const bizPhone = tenDigits(String(v.metadata?.display_phone_number ?? ''));
        for (const h of v.history ?? []) {
          let imported = 0;
          for (const th of h.threads ?? []) {
            for (const hm of th.messages ?? []) {
              const dir =
                bizPhone && tenDigits(String(hm?.from ?? '')) === bizPhone ? 'out' : 'in';
              const phone = await this.storeCloudMessage(tenantId, prisma, hm, dir, names, {
                instant: false,
              });
              if (phone) {
                touched.add(phone);
                imported++;
              }
            }
          }
          this.logger.log(
            `Historial coexistencia: fase ${h?.metadata?.phase ?? '?'} chunk ${h?.metadata?.chunk_order ?? '?'} ` +
              `progreso ${h?.metadata?.progress ?? '?'} -> ${imported} mensajes importados`,
          );
        }
        // Contactos del celular (smb_app_state_sync): nombres para los hilos.
        for (const s of v.state_sync ?? []) {
          if (s?.type !== 'contact' || !s.contact?.phone_number) continue;
          const p = tenDigits(String(s.contact.phone_number));
          const name = String(s.contact.full_name ?? s.contact.first_name ?? '').trim();
          if (p.length < 7 || !name || s.action === 'remove') continue;
          await prisma.waContact
            .upsert({ where: { phone: p }, create: { phone: p, contactId: '', name }, update: { name } })
            .catch(() => null);
        }
        // Estados: 'failed' = Meta NO entrego (ej. 131049) -> el hilo lo anota
        // y, si era una confirmacion, el pedido VUELVE a "Sin enviar".
        // sent/delivered/read -> chulitos del mensaje (como WhatsApp).
        for (const s of v.statuses ?? []) {
          if (!s?.id) continue;
          if (s.status === 'failed') {
            const phone = await this.handleFailedStatus(tenantId, prisma, s).catch((err) => {
              this.logger.warn(`Status failed no procesado: ${err instanceof Error ? err.message : err}`);
              return null;
            });
            if (phone) touched.add(phone);
          } else if (['sent', 'delivered', 'read'].includes(String(s.status))) {
            const phone = await this.applyDeliveryStatus(prisma, s).catch(() => null);
            if (phone) touched.add(phone);
          }
        }
      }
    }

    for (const phone of touched) {
      await this.realtime.publish(tenantId, { kind: 'wa.message', phone });
    }

    // El nombre del contacto se refresca con lo que diga WhatsApp.
    // (Se hace al final para no bloquear los mensajes.)
  }

  /**
   * MOTOR del flujo de confirmacion: interpreta los
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
    if (!d360) return; // sin conexion no hay como responder

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
      const row = await prisma.waMessage.create({
        data: { phone, direction: 'out', kind: 'text', body, authorName: 'SmartLogística', externalId: wamid, status: wamid ? 'sent' : null },
      });
      await this.publishWaMessage(tenantId, prisma, row);
    };
    const sayButtons = async (body: string, buttons: Array<{ id: string; title: string }>): Promise<void> => {
      const wamid = await this.dialog360.sendInteractiveButtons(d360.http, d360.mode, to, body, buttons);
      const row = await prisma.waMessage.create({
        data: {
          phone,
          direction: 'out',
          kind: 'text',
          body,
          authorName: 'SmartLogística',
          externalId: wamid,
          status: wamid ? 'sent' : null,
          buttons: buttons.map((b) => b.title) as Prisma.InputJsonValue,
        },
      });
      await this.publishWaMessage(tenantId, prisma, row);
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
   * del telefono (nativo, por la Cloud API). Los mensajes ya
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

  /**
   * Meta reporto que un mensaje NO se entrego (status 'failed', ej. 131049
   * "healthy ecosystem"): nota en el hilo y, si era la CONFIRMACION del pedido,
   * se revierte el evento para que el pedido VUELVA a "Sin enviar" (la verdad
   * ante todo — jamas un "Sin responder" de un mensaje que no llego).
   */
  private async handleFailedStatus(
    tenantId: string,
    prisma: PrismaClient,
    s: Any,
  ): Promise<string | null> {
    const wamid = String(s.id);
    const err = Array.isArray(s.errors) ? s.errors[0] : null;
    const detail = err ? `${err.code ?? ''} ${err.title ?? err.message ?? ''}`.trim() : 'motivo desconocido';

    const msg = await prisma.waMessage.findUnique({ where: { externalId: wamid } });
    if (!msg) return null;
    // Chulito rojo del mensaje que no llego.
    await prisma.waMessage
      .update({ where: { id: msg.id }, data: { status: 'failed' } })
      .catch(() => null);

    // Nota en el hilo (dedup natural: externalId unico "fail:<wamid>").
    try {
      await prisma.waMessage.create({
        data: {
          phone: msg.phone,
          direction: 'out',
          kind: 'text',
          body: `⚠️ El mensaje anterior NO se entregó (Meta: ${detail}).`,
          authorName: 'Sistema',
          externalId: `fail:${wamid}`,
        },
      });
    } catch {
      return null; // ya se habia procesado este fallo
    }

    // ¿Era una confirmacion? Revertir el evento -> badge "Sin enviar" de nuevo.
    const events = await prisma.orderEvent.findMany({
      where: { type: 'wa_confirmation', data: { path: ['wamid'], equals: wamid } },
      select: { id: true, orderId: true },
    });
    for (const ev of events) {
      await prisma.orderEvent.delete({ where: { id: ev.id } }).catch(() => null);
      await prisma.orderEvent.create({
        data: {
          orderId: ev.orderId,
          type: 'wa_confirmation_failed',
          actorName: 'Meta',
          data: { wamid, error: detail } as Prisma.InputJsonValue,
        },
      });
    }
    if (events.length > 0) {
      await this.realtime.publish(tenantId, { kind: 'orders.refresh' });
      this.logger.warn(`Confirmacion NO entregada (${detail}): ${events.length} pedido(s) vuelven a "Sin enviar"`);
    }
    return msg.phone;
  }

  /**
   * Chulito del mensaje (sent -> delivered -> read), sin degradar nunca
   * (los webhooks pueden llegar en desorden). Devuelve el telefono del hilo.
   */
  private async applyDeliveryStatus(prisma: PrismaClient, s: Any): Promise<string | null> {
    const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };
    const next = String(s.status);
    const row = await prisma.waMessage.findUnique({
      where: { externalId: String(s.id) },
      select: { id: true, phone: true, status: true },
    });
    if (!row) return null;
    if ((rank[row.status ?? ''] ?? 0) >= (rank[next] ?? 0)) return null;
    await prisma.waMessage.update({ where: { id: row.id }, data: { status: next } });
    return row.phone;
  }

  /**
   * Guarda UN mensaje del payload Cloud (con dedup por wamid). Devuelve el
   * telefono. `instant:false` (import de historial) no publica SSE por mensaje.
   */
  private async storeCloudMessage(
    tenantId: string,
    prisma: PrismaClient,
    m: Any,
    direction: 'in' | 'out',
    names: Map<string, string>,
    opts: { instant?: boolean } = {},
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

      // REACCION: no es una burbuja — se pega al mensaje reaccionado (como en
      // WhatsApp). emoji vacio = quitar la reaccion. mine = reaccion del negocio.
      if (type === 'reaction') {
        const targetWamid = typeof m.reaction?.message_id === 'string' ? m.reaction.message_id : null;
        if (!targetWamid) return null;
        const target = await prisma.waMessage.findUnique({
          where: { externalId: targetWamid },
          select: { id: true, reactions: true },
        });
        if (!target) return null;
        const emoji = typeof m.reaction?.emoji === 'string' ? m.reaction.emoji : '';
        const mine = direction === 'out';
        const prev = (Array.isArray(target.reactions) ? target.reactions : []) as Array<{
          emoji: string;
          mine: boolean;
        }>;
        // Una reaccion por lado (cliente/negocio): se reemplaza o se quita.
        const rest = prev.filter((r) => r.mine !== mine);
        const next = emoji ? [...rest, { emoji, mine }] : rest;
        await prisma.waMessage.update({
          where: { id: target.id },
          data: { reactions: next as unknown as Prisma.InputJsonValue },
        });
        return phone;
      }

      let kind: WaMessageDto['kind'] = 'text';
      let body: string | null = null;
      let attachmentKey: string | null = null;
      let mediaUrl: string | null = null;

      if (type === 'text') {
        body = m.text?.body ?? null;
      } else if (['image', 'video', 'audio', 'document', 'sticker'].includes(type)) {
        const media = m[type] ?? {};
        kind = type === 'document' ? 'file' : (type as WaMessageDto['kind']);
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

      // CITA (responder deslizando): context.id = wamid del mensaje citado.
      let replyToId: string | null = null;
      const quotedWamid = typeof m.context?.id === 'string' ? m.context.id : null;
      if (quotedWamid) {
        const quoted = await prisma.waMessage.findUnique({
          where: { externalId: quotedWamid },
          select: { id: true },
        });
        replyToId = quoted?.id ?? null;
      }

      // Fecha original del mensaje (clave para el HISTORIAL importado) y
      // estado real si viene del historial (history_context).
      const ts = Number(m.timestamp);
      const createdAt = Number.isFinite(ts) && ts > 1_000_000_000 ? new Date(ts * 1000) : null;
      const hStatus =
        typeof m.history_context?.status === 'string'
          ? String(m.history_context.status).toLowerCase()
          : null;
      const outStatus = hStatus
        ? hStatus === 'read' || hStatus === 'played'
          ? 'read'
          : hStatus === 'delivered'
            ? 'delivered'
            : hStatus === 'error'
              ? 'failed'
              : 'sent'
        : 'sent';

      const row = await prisma.waMessage.create({
        data: {
          phone,
          direction,
          kind,
          body,
          attachmentKey,
          mediaUrl,
          replyToId,
          ...(createdAt ? { createdAt } : {}),
          status: direction === 'out' ? outStatus : null,
          // contactId reutilizado como stash de diagnostico del media id fallido.
          contactId: (m as Any).__failedMediaId ? `media:${(m as Any).__failedMediaId}` : null,
          authorName:
            direction === 'out'
              ? 'WhatsApp (celular)'
              : (names.get(String(rawPhone)) ?? null),
          externalId,
        },
      });
      // Pintado INSTANTANEO en los paneles abiertos (el mensaje va en el
      // evento). En import de historial NO (pueden ser miles).
      if (opts.instant !== false) await this.publishWaMessage(tenantId, prisma, row);

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
   * el limite de frescura (si el envio fallo dias atras, igual se puede enviar).
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

    const d360 = await this.dialog360OrNull(tenantId, prisma);
    if (!d360) {
      return fail('WhatsApp no está conectado. Configura 360dialog en Conexiones.');
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

    // Datos del rawPayload de VTEX (los manuales imitan esta forma).
    const raw = (order.rawPayload ?? {}) as Record<string, any>;
    const cpd = raw.clientProfileData ?? {};
    const a = raw.shippingData?.address ?? {};
    const direccion = [
      [a.street, a.neighborhood, a.city].filter(Boolean).join(', '),
      [a.state, a.complement].filter(Boolean).join(' '),
    ]
      .filter(Boolean)
      .join(', ');
    const productos = order.items.map((i) => `${i.quantity} ${i.name}`).join(', ');

    // Plantilla en PRODUCCION; en sandbox se emula con botones de sesion (y
    // solo para pedidos MONTADOS a mano: el sandbox no alcanza clientes reales).
    // Las respuestas/botones los procesa handleFlowReply.
    if (!this.d360Governs(d360, order.provider)) {
      return fail(
        'El SANDBOX de 360dialog solo puede escribirle al número de prueba. Conecta 360dialog en PRODUCCIÓN.',
      );
    }
    {
      const nombre =
        `${cpd.firstName ?? ''} ${cpd.lastName ?? ''}`.trim() || (order.customerName ?? 'cliente');
      const params = [nombre, productos || '—', direccion || '—'];
      let rendered = tplBody(nombre, productos || '—', direccion || '—');
      let tplName = D360_TEMPLATE_NAME;
      let tplLang = D360_TEMPLATE_LANG;
      let tplButtons = ['Mis datos son correctos.', 'Modificar mi dirección.'];
      // La MEJOR plantilla de confirmacion APROBADA en la WABA, por prioridad
      // (la original con emojis primero; si Meta aun no la aprueba, la sobria).
      // Asi el cambio se activa SOLO, sin redesplegar, y el hilo guarda el
      // texto REAL de la que salio. Si la consulta falla: defaults del env.
      if (d360.mode === 'production') {
        try {
          const list = await this.dialog360.listTemplates(d360.http);
          const pick = CONFIRMATION_TEMPLATE_PRIORITY.map((name) =>
            list.find((t) => t.name === name && t.status === 'approved'),
          ).find(Boolean);
          if (pick) {
            tplName = pick.name;
            tplLang = pick.language;
            rendered = renderTemplateBody(pick.body, params);
            if (pick.buttons.length) tplButtons = pick.buttons;
          }
        } catch (err) {
          this.logger.warn(`No se pudieron listar plantillas: ${(err as Error).message}`);
        }
      }
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
            tplName,
            tplLang,
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

      const [, waRow] = await Promise.all([
        prisma.orderEvent.create({
          data: {
            orderId,
            type: 'wa_confirmation',
            actorName: 'SmartLogística',
            // wamid: si Meta luego reporta "failed", este evento se revierte y
            // el pedido vuelve a "Sin enviar" (handleFailedStatus).
            data: { via: 'dialog360', mode: d360.mode, phone, wamid } as Prisma.InputJsonValue,
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
            status: wamid ? 'sent' : null,
            buttons: (d360.mode === 'sandbox'
              ? ['Datos correctos ✅', 'Modificar dirección']
              : tplButtons) as unknown as Prisma.InputJsonValue,
          },
        }),
      ]);
      await this.publishWaMessage(tenantId, prisma, waRow);
      this.logger.log(`Confirmacion Cloud enviada: pedido ${order.externalId} -> ${phone}`);
      return;
    }

  }

  /**
   * Sirve el AUDIO de un mensaje del hilo del pedido por nuestra API (misma
   * origen): asi el navegador puede DECODIFICAR la onda real sin pelear con
   * CORS de las URLs firmadas del storage.
   */
  async audioFile(
    orderId: string,
    messageId: string,
    auth: AuthContext,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    this.assertAdmin(auth);
    const { prisma } = getTenantContext();
    const { phone } = await this.orderPhone(orderId);
    const msg = await prisma.waMessage.findUnique({
      where: { id: messageId },
      select: { phone: true, kind: true, attachmentKey: true },
    });
    if (!msg || msg.phone !== phone || msg.kind !== 'audio' || !msg.attachmentKey) {
      throw new NotFoundException('Audio no encontrado');
    }
    const obj = await this.storage.get(msg.attachmentKey);
    if (!obj) throw new NotFoundException('Audio no disponible');
    return obj;
  }

  // === Helpers ===

  /**
   * Publica wa.message CON el mensaje ya montado: el panel lo PINTA AL
   * INSTANTE (cero refetch). El evento generico {phone} queda como respaldo.
   */
  private async publishWaMessage(
    tenantId: string,
    prisma: PrismaClient,
    row: WaMessageRow & { phone: string },
  ): Promise<void> {
    try {
      let byId: Map<string, WaMessageRow> | undefined;
      if (row.replyToId) {
        const quoted = await prisma.waMessage.findUnique({ where: { id: row.replyToId } });
        if (quoted) byId = new Map([[quoted.id, quoted as WaMessageRow]]);
      }
      const message = await this.toDto(row, byId);
      await this.realtime.publish(tenantId, {
        kind: 'wa.message',
        phone: row.phone,
        message: message as unknown as Record<string, unknown>,
      });
    } catch {
      await this.realtime.publish(tenantId, { kind: 'wa.message', phone: row.phone });
    }
  }

  private async toDto(r: WaMessageRow, byId?: Map<string, WaMessageRow>): Promise<WaMessageDto> {
    const mediaUrl = r.attachmentKey
      ? await this.storage.getSignedUrl(r.attachmentKey).catch(() => null)
      : r.mediaUrl;
    const quoted = r.replyToId && byId ? byId.get(r.replyToId) : undefined;
    // Stickers de ANTES del kind propio: quedaron como image .webp — se
    // retro-detectan para pintarlos como sticker (sueltos, sin burbuja).
    const kind =
      waKindOf(r.kind) === 'image' && (r.attachmentKey ?? '').toLowerCase().endsWith('.webp')
        ? ('sticker' as const)
        : waKindOf(r.kind);
    const reactions = Array.isArray(r.reactions)
      ? (r.reactions as Array<{ emoji?: unknown; mine?: unknown }>)
          .filter((x) => x && typeof x.emoji === 'string' && x.emoji)
          .map((x) => ({ emoji: String(x.emoji), mine: Boolean(x.mine) }))
      : [];
    const status = ['sent', 'delivered', 'read', 'failed'].includes(r.status ?? '')
      ? (r.status as WaMessageDto['status'])
      : null;
    return {
      id: r.id,
      direction: r.direction === 'out' ? 'out' : 'in',
      kind,
      body: r.body,
      mediaUrl,
      authorName: r.authorName,
      buttons: Array.isArray(r.buttons) ? (r.buttons as unknown[]).map(String) : [],
      replyTo: quoted
        ? {
            id: quoted.id,
            direction: quoted.direction === 'out' ? 'out' : 'in',
            kind: waKindOf(quoted.kind),
            body: quoted.body,
            authorName: quoted.authorName,
          }
        : null,
      reactions,
      status,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private assertAdmin(auth: AuthContext): void {
    // WhatsApp es de ADMINISTRADORES (propietario + admins); operadores no.
    if (auth.role !== 'OWNER' && auth.role !== 'ADMIN') {
      throw new ForbiddenException('WhatsApp es solo para administradores');
    }
  }

  /**
   * Traduce el error del API de WhatsApp (360dialog) a un mensaje UTIL: SIEMPRE
   * incluye el detalle real que devolvio el servidor (leccion aprendida: un
   * generico "rechazo el token" escondia "number blocked due to lack of payment").
   */
  private translateError(err: unknown, fallback: string): BadRequestException {
    if (isAxiosError(err)) {
      const status = err.response?.status;
      const data = err.response?.data as
        | { message?: string; error?: unknown; meta?: { developer_message?: string } }
        | string
        | undefined;
      // Formas de error de 360dialog/Meta: {error: "..."}, {meta: {developer_message}}, {message}.
      const detail =
        typeof data === 'string'
          ? data.slice(0, 300)
          : data && typeof data === 'object'
            ? typeof data.error === 'string'
              ? data.error
              : (data.meta?.developer_message ?? data.message ?? null)
            : null;
      return new BadRequestException(
        detail
          ? `WhatsApp (360dialog): ${String(detail).slice(0, 300)}`
          : `${fallback} (HTTP ${status ?? '?'})`,
      );
    }
    this.logger.warn(`WhatsApp error: ${err instanceof Error ? err.message : err}`);
    return new BadRequestException(fallback);
  }
}
