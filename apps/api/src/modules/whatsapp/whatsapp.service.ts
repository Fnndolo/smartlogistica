import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AxiosInstance } from 'axios';
import type {
  AddWaStickerFavInput,
  Dialog360ConnectionSummary,
  Dialog360CredentialsInput,
  Dialog360Mode,
  Dialog360TestResult,
  ForwardWaMessageInput,
  SendWaContactInput,
  SendWaReactionInput,
  SendWaStickerInput,
  SendWaTemplateInput,
  SendWaTextInput,
  SetWaLabelsInput,
  StarWaMessageInput,
  WaChatOpInput,
  WaInbox,
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
import { WaConnectionService } from './wa-connection.service';
import { normalizeSticker, toOggOpus } from './wa-media.util';
import { WaPublisherService } from './wa-publisher.service';
import {
  renderTemplateBody,
  templateVarCount,
  tenDigits,
  translateWaError,
  waKindOf,
  waTypeOf,
  type WaMessageRow,
} from './wa-shared';
import { WhatsappWebhookService } from './whatsapp-webhook.service';

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

/** Archivo entrante/saliente: tope 50MB (igual que los adjuntos del chat). */
export const WA_FILE_MAX_BYTES = 50 * 1024 * 1024;

interface UploadedWaFile {
  buffer: Buffer;
  mimetype: string;
  originalname?: string;
}

/**
 * WhatsApp por pedido (Cloud API de Meta via 360dialog). El historial vive en
 * WaMessage (por telefono): los salientes se guardan al enviarlos desde aqui;
 * TODO lo demas (entrantes, medios, echoes del celular con coexistencia,
 * estados) llega por el webhook de la Cloud API. Solo administradores.
 *
 * FACHADA del modulo: conserva TODOS los metodos publicos y delega la
 * recepcion (webhook) en WhatsappWebhookService, la publicacion SSE en
 * WaPublisherService y las credenciales en WaConnectionService.
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
    private readonly waConn: WaConnectionService,
    private readonly publisher: WaPublisherService,
    private readonly webhook: WhatsappWebhookService,
  ) {}

  /** Al arrancar: verificar que el BINARIO de ffmpeg existe (notas de voz).
   * Deja en el log la verdad operativa — si falta, TODA nota de voz fallara
   * con error claro al enviar (y ensure-ffmpeg.mjs del startCommand intenta
   * descargarlo antes de llegar aqui). */
  async onModuleInit(): Promise<void> {
    try {
      const p = (await import('ffmpeg-static')).default as unknown as string | null;
      const fsp = await import('node:fs/promises');
      const ok = p ? await fsp.access(p).then(() => true, () => false) : false;
      if (ok) this.logger.log(`ffmpeg listo para notas de voz: ${p}`);
      else
        this.logger.error(
          `FALTA el binario de ffmpeg (ruta: ${p ?? 'sin resolver'}). Las notas de voz fallaran hasta que exista.`,
        );
    } catch (err) {
      this.logger.error(
        `ffmpeg-static no importable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

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
      throw translateWaError(err, 'No se pudo conectar a 360dialog (¿API key/modo correctos?)', this.logger);
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
      throw translateWaError(err, 'El API key de 360dialog es invalido o no se pudo configurar el webhook', this.logger);
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

  /** Plantillas de la WABA con CACHE de 60s (cada relectura cuesta ~0.5-1s). */
  private readonly tplCache = new Map<
    string,
    { at: number; list: Awaited<ReturnType<Dialog360Client['listTemplates']>> }
  >();

  private async cachedTemplates(
    tenantId: string,
    http: AxiosInstance,
  ): Promise<Awaited<ReturnType<Dialog360Client['listTemplates']>>> {
    const hit = this.tplCache.get(tenantId);
    if (hit && Date.now() - hit.at < 60_000) return hit.list;
    const list = await this.dialog360.listTemplates(http);
    this.tplCache.set(tenantId, { at: Date.now(), list });
    return list;
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
    return this.threadOf(order.customerPhone ? tenDigits(order.customerPhone) : '', auth.userId);
  }

  /** Hilo por TELEFONO (un chat de la bandeja). */
  async threadByPhone(rawPhone: string, auth: AuthContext): Promise<WaThread> {
    this.assertAdmin(auth);
    return this.threadOf(tenDigits(rawPhone), auth.userId);
  }

  private async threadOf(phone: string, userId: string): Promise<WaThread> {
    const { prisma } = getTenantContext();
    const conn = await prisma.dialog360Connection.findFirst({ select: { id: true } });
    if (!phone) {
      return {
        phone: null,
        connected: Boolean(conn),
        contactName: null,
        firstUnreadId: null,
        unreadCount: 0,
        messages: [],
      };
    }

    const [rows, contact, readMark] = await Promise.all([
      prisma.waMessage.findMany({
        where: { phone },
        orderBy: { createdAt: 'asc' },
        take: THREAD_TAKE,
      }),
      prisma.waContact.findUnique({ where: { phone } }),
      prisma.waChatRead.findUnique({ where: { userId_phone: { userId, phone } } }),
    ]);

    // Divisor "N mensajes no leidos": VERDAD del servidor (marca de lectura de
    // ESTE usuario). Sin marca previa no se pinta divisor (chat nunca abierto).
    let firstUnreadId: string | null = null;
    let unreadCount = 0;
    // Regla: si el ULTIMO mensaje es NUESTRO (bot/admin), el chat quedo
    // respondido -> sin divisor ni conteo.
    const lastRow = rows[rows.length - 1];
    if (readMark && lastRow?.direction === 'in') {
      for (const r of rows) {
        if (r.direction !== 'in' || r.createdAt <= readMark.lastReadAt) continue;
        if (!firstUnreadId) firstUnreadId = r.id;
        unreadCount++;
      }
    }

    const byId = new Map(rows.map((r) => [r.id, r] as const));
    return {
      phone,
      connected: Boolean(conn),
      contactName: contact?.name ?? null,
      firstUnreadId,
      unreadCount,
      messages: await Promise.all(rows.map((r) => this.publisher.toDto(r, byId))),
    };
  }

  /** Envia TEXTO al cliente del pedido y lo guarda en el historial. */
  async sendText(orderId: string, input: SendWaTextInput, auth: AuthContext): Promise<WaMessageDto> {
    const { phone, provider } = await this.orderPhone(orderId);
    return this.sendTextCore(phone, provider, input, auth);
  }

  /** Envia TEXTO a un chat de la BANDEJA (por telefono). */
  async sendTextToPhone(rawPhone: string, input: SendWaTextInput, auth: AuthContext): Promise<WaMessageDto> {
    const phone = tenDigits(rawPhone);
    if (phone.length < 7) throw new BadRequestException('Teléfono inválido');
    return this.sendTextCore(phone, 'external', input, auth);
  }

  private async sendTextCore(
    phone: string,
    provider: string,
    input: SendWaTextInput,
    auth: AuthContext,
  ): Promise<WaMessageDto> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();

    const d360 = await this.waConn.dialog360OrNull(tenantId, prisma);
    this.requireD360(d360, provider);
    // Responder CITANDO: el mensaje citado debe ser de este mismo hilo.
    let quoted: { id: string; externalId: string | null } | null = null;
    if (input.replyToId) {
      quoted = await prisma.waMessage.findFirst({
        where: { id: input.replyToId, phone },
        select: { id: true, externalId: true },
      });
    }
    // ACK PRIMERO: el mensaje queda YA en el hilo con relojito ('queued') y
    // el viaje a Meta (~1-1.5s) ocurre en segundo plano.
    const row = await prisma.waMessage.create({
      data: {
        phone,
        direction: 'out',
        kind: 'text',
        body: input.text,
        replyToId: quoted?.id ?? null,
        authorId: auth.userId,
        authorName: auth.name?.trim() || auth.email,
        status: 'queued',
      },
    });
    await this.publisher.publishWaMessage(tenantId, prisma, row);
    const quotedId = quoted?.id ?? null;
    this.dispatchWaSend(tenantId, prisma, row.id, phone, 'No se pudo enviar el mensaje', async () => {
      // La cita se re-resuelve al DESPACHAR: si lo citado tambien estaba en
      // cola, para entonces ya tiene su wamid (la cola es por chat, en orden).
      const q = quotedId
        ? await prisma.waMessage.findFirst({ where: { id: quotedId }, select: { externalId: true } })
        : null;
      return this.dialog360.sendText(d360!.http, d360!.mode, `57${phone}`, input.text, q?.externalId ?? null);
    });
    return this.publisher.toDto(row);
  }

  /** Envia un ARCHIVO (imagen/video/audio/documento) y lo guarda en el historial. */
  async sendFile(orderId: string, file: UploadedWaFile, auth: AuthContext): Promise<WaMessageDto> {
    const { phone, provider } = await this.orderPhone(orderId);
    return this.sendFileCore(phone, provider, file, auth);
  }

  /** Envia un ARCHIVO a un chat de la BANDEJA (por telefono). */
  async sendFileToPhone(rawPhone: string, file: UploadedWaFile, auth: AuthContext): Promise<WaMessageDto> {
    const phone = tenDigits(rawPhone);
    if (phone.length < 7) throw new BadRequestException('Teléfono inválido');
    return this.sendFileCore(phone, 'external', file, auth);
  }

  private async sendFileCore(
    phone: string,
    provider: string,
    file: UploadedWaFile,
    auth: AuthContext,
  ): Promise<WaMessageDto> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();
    if (!this.storage.isConfigured()) {
      throw new BadRequestException('El almacenamiento de archivos no esta configurado');
    }
    const d360 = await this.waConn.dialog360OrNull(tenantId, prisma);
    this.requireD360(d360, provider);

    const name = file.originalname || 'archivo';
    const ext = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1];
    const key = `tenants/${tenantId}/whatsapp/${phone}/${randomUUID()}${ext ? `.${ext.toLowerCase()}` : ''}`;
    await this.storage.put(key, file.buffer, file.mimetype || 'application/octet-stream');
    const url = await this.storage.getSignedUrl(key);

    // ACK PRIMERO: la burbuja del medio aparece YA (nuestro storage firma la
    // URL) y el trabajo pesado (transcodificar audio, subir a Meta, enviar)
    // corre en la cola del chat. Un fallo se ve como bolita roja con motivo.
    const kind = waTypeOf(file.mimetype || '');
    const row = await prisma.waMessage.create({
      data: {
        phone,
        direction: 'out',
        kind,
        body: name,
        attachmentKey: key,
        authorId: auth.userId,
        authorName: auth.name?.trim() || auth.email,
        status: 'queued',
      },
    });
    await this.publisher.publishWaMessage(tenantId, prisma, row);
    this.dispatchWaSend(tenantId, prisma, row.id, phone, 'No se pudo enviar el archivo', async () => {
      if (kind === 'audio') {
        // NOTAS DE VOZ: los navegadores graban webm U Opus-DENTRO-de-mp4 y
        // WhatsApp no ENTREGA ninguno de los dos (131053 async, aunque el
        // envio devuelva wamid). SIEMPRE se transcodifica a OGG/Opus (receta
        // VERIFICADA con entrega real por probe) y se sube por media id.
        const ogg = await toOggOpus(file.buffer, file.mimetype || '', this.logger);
        if (!ogg) {
          throw new BadRequestException(
            'No se pudo convertir la nota de voz (ffmpeg no disponible en el servidor). Avisa al administrador.',
          );
        }
        const mediaId = await this.dialog360.uploadMedia(
          d360!.apiKey,
          d360!.mode,
          ogg.buffer,
          ogg.mime,
          'nota-de-voz.ogg',
        );
        if (!mediaId) throw new BadRequestException('Meta no devolvió el id del audio');
        return this.dialog360.sendMediaId(d360!.http, d360!.mode, `57${phone}`, 'audio', mediaId);
      }
      return this.dialog360.sendMediaLink(
        d360!.http,
        d360!.mode,
        `57${phone}`,
        kind === 'file' ? 'document' : kind,
        url,
        kind === 'file' ? name : undefined,
      );
    });
    return this.publisher.toDto(row);
  }

  // === Bandeja de entrada (inbox estilo WhatsApp Web) ===

  /** Todos los chats: ultimo mensaje, no leidos (por usuario) y etiquetas. */
  async inbox(auth: AuthContext): Promise<WaInbox> {
    this.assertAdmin(auth);
    const { prisma } = getTenantContext();

    const [last, unreadRows, contacts] = await Promise.all([
      prisma.$queryRaw<
        Array<{
          phone: string;
          kind: string;
          body: string | null;
          direction: string;
          status: string | null;
          createdAt: Date;
        }>
      >`SELECT DISTINCT ON (phone) phone, kind, body, direction, status, "createdAt"
        FROM "WaMessage" ORDER BY phone, "createdAt" DESC`,
      prisma.$queryRaw<Array<{ phone: string; unread: bigint }>>`
        SELECT m.phone, COUNT(*)::bigint AS unread
        FROM "WaMessage" m
        LEFT JOIN "WaChatRead" r ON r.phone = m.phone AND r."userId" = ${auth.userId}
        WHERE m.direction = 'in' AND (r."lastReadAt" IS NULL OR m."createdAt" > r."lastReadAt")
        GROUP BY m.phone`,
      prisma.waContact.findMany({
        select: {
          phone: true,
          name: true,
          labels: true,
          archived: true,
          muted: true,
          pinned: true,
        },
      }),
    ]);
    const labelRows = await prisma.waLabel.findMany({ orderBy: { name: 'asc' } });

    const byPhone = new Map(contacts.map((c) => [c.phone, c] as const));
    const unread = new Map(unreadRows.map((r) => [r.phone, Number(r.unread)] as const));
    const colorOf = new Map(labelRows.map((l) => [l.name, l.color] as const));

    const chats = last
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 400)
      .map((m) => {
        const c = byPhone.get(m.phone);
        return {
          phone: m.phone,
          name: c?.name ?? null,
          labels: Array.isArray(c?.labels) ? (c?.labels as unknown[]).map(String) : [],
          lastAt: m.createdAt.toISOString(),
          lastKind: waKindOf(m.kind),
          lastBody: m.body,
          lastDirection: m.direction === 'out' ? ('out' as const) : ('in' as const),
          lastStatus:
            m.direction === 'out' && ['sent', 'delivered', 'read', 'failed'].includes(m.status ?? '')
              ? (m.status as 'sent' | 'delivered' | 'read' | 'failed')
              : null,
          // Si el ULTIMO mensaje es NUESTRO (bot del flujo o un admin), el chat
          // ya quedo respondido: NO cuenta como no leido.
          unread: m.direction === 'out' ? 0 : (unread.get(m.phone) ?? 0),
          archived: Boolean(c?.archived),
          muted: Boolean(c?.muted),
          pinned: Boolean(c?.pinned),
        };
      })
      // FIJADOS siempre arriba (dentro de cada grupo, por ultimo mensaje).
      .sort((a, b) => Number(b.pinned) - Number(a.pinned));

    const usedNames = new Set(chats.flatMap((c) => c.labels));
    const labels = [...new Set([...labelRows.map((l) => l.name), ...usedNames])]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ name, color: colorOf.get(name) ?? '#00a884' }));
    return { chats, labels };
  }

  /** Operaciones del menu contextual: archivar / silenciar / fijar. */
  async chatOp(rawPhone: string, input: WaChatOpInput, auth: AuthContext): Promise<{ ok: true }> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();
    const phone = tenDigits(rawPhone);
    if (phone.length < 7) throw new BadRequestException('Teléfono inválido');
    const data: Record<string, boolean> = {};
    if (typeof input.archived === 'boolean') data.archived = input.archived;
    if (typeof input.muted === 'boolean') data.muted = input.muted;
    if (typeof input.pinned === 'boolean') data.pinned = input.pinned;
    if (Object.keys(data).length === 0) throw new BadRequestException('Nada que cambiar');
    await prisma.waContact.upsert({
      where: { phone },
      create: { phone, contactId: '', ...data },
      update: data,
    });
    await this.realtime.publish(tenantId, { kind: 'wa.message', phone });
    return { ok: true };
  }

  /** "Marcar como no leído": corre la marca de lectura ANTES del ultimo entrante. */
  async markChatUnread(rawPhone: string, auth: AuthContext): Promise<{ ok: true }> {
    this.assertAdmin(auth);
    const { prisma } = getTenantContext();
    const phone = tenDigits(rawPhone);
    const lastIn = await prisma.waMessage.findFirst({
      where: { phone, direction: 'in' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (!lastIn) throw new BadRequestException('Este chat no tiene mensajes del cliente');
    const before = new Date(lastIn.createdAt.getTime() - 1000);
    await prisma.waChatRead.upsert({
      where: { userId_phone: { userId: auth.userId, phone } },
      create: { userId: auth.userId, phone, lastReadAt: before },
      update: { lastReadAt: before },
    });
    return { ok: true };
  }

  /** "Vaciar chat": borra el HISTORIAL local (WhatsApp del cliente no se toca). */
  async clearChat(rawPhone: string, auth: AuthContext): Promise<{ ok: true }> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();
    const phone = tenDigits(rawPhone);
    await prisma.waMessage.deleteMany({ where: { phone } });
    await this.realtime.publish(tenantId, { kind: 'wa.message', phone });
    return { ok: true };
  }

  /** "Eliminar chat": historial + contacto + marcas de lectura (local). */
  async deleteChat(rawPhone: string, auth: AuthContext): Promise<{ ok: true }> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();
    const phone = tenDigits(rawPhone);
    await prisma.waMessage.deleteMany({ where: { phone } });
    await prisma.waChatRead.deleteMany({ where: { phone } });
    await prisma.waContact.deleteMany({ where: { phone } });
    await this.realtime.publish(tenantId, { kind: 'wa.message', phone });
    return { ok: true };
  }

  /** Marca un chat como LEIDO para este usuario (apaga el contador verde). */
  async markChatRead(rawPhone: string, auth: AuthContext): Promise<{ ok: true }> {
    this.assertAdmin(auth);
    const { prisma } = getTenantContext();
    const phone = tenDigits(rawPhone);
    if (phone.length < 7) throw new BadRequestException('Teléfono inválido');
    await prisma.waChatRead.upsert({
      where: { userId_phone: { userId: auth.userId, phone } },
      create: { userId: auth.userId, phone, lastReadAt: new Date() },
      update: { lastReadAt: new Date() },
    });
    return { ok: true };
  }

  /** Etiquetas del chat (globales) + registro de su COLOR en WaLabel. */
  async setChatLabels(
    rawPhone: string,
    input: SetWaLabelsInput,
    auth: AuthContext,
  ): Promise<{ ok: true }> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();
    const phone = tenDigits(rawPhone);
    if (phone.length < 7) throw new BadRequestException('Teléfono inválido');
    const seen = new Set<string>();
    const labels = input.labels
      .map((l) => ({ name: l.name.trim(), color: l.color.trim() || '#00a884' }))
      .filter((l) => l.name && !seen.has(l.name) && seen.add(l.name));
    // Registrar/actualizar el color de cada etiqueta usada.
    for (const l of labels) {
      await prisma.waLabel.upsert({
        where: { name: l.name },
        create: { name: l.name, color: l.color },
        update: { color: l.color },
      });
    }
    const names = labels.map((l) => l.name);
    await prisma.waContact.upsert({
      where: { phone },
      create: { phone, contactId: '', labels: names as unknown as Prisma.InputJsonValue },
      update: { labels: names as unknown as Prisma.InputJsonValue },
    });
    await this.realtime.publish(tenantId, { kind: 'wa.message', phone });
    return { ok: true };
  }

  // === Acciones sobre mensajes (menu contextual, como WhatsApp) ===

  /** REACCIONA a un mensaje del hilo (emoji vacio = quitar la reaccion). */
  async react(rawPhone: string, input: SendWaReactionInput, auth: AuthContext): Promise<{ ok: true }> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();
    const phone = tenDigits(rawPhone);
    const d360 = await this.waConn.dialog360OrNull(tenantId, prisma);
    this.requireD360(d360, 'external');
    const msg = await prisma.waMessage.findFirst({
      where: { id: input.messageId, phone },
      select: { id: true, externalId: true, reactions: true },
    });
    if (!msg?.externalId) throw new NotFoundException('Mensaje no encontrado (o sin id de WhatsApp)');
    // LOCAL PRIMERO (instantaneo): una reaccion del negocio por mensaje.
    // Meta va en segundo plano; si falla, se revierte y se re-publica.
    const prev = (Array.isArray(msg.reactions) ? msg.reactions : []) as Array<{ emoji: string; mine: boolean }>;
    const rest = prev.filter((r) => !r.mine);
    const next = input.emoji ? [...rest, { emoji: input.emoji, mine: true }] : rest;
    await prisma.waMessage.update({
      where: { id: msg.id },
      data: { reactions: next as unknown as Prisma.InputJsonValue },
    });
    await this.realtime.publish(tenantId, { kind: 'wa.message', phone });
    const externalId = msg.externalId;
    void (async () => {
      try {
        await this.dialog360.sendReaction(d360!.http, d360!.mode, `57${phone}`, externalId, input.emoji);
      } catch (err) {
        this.logger.warn(
          `Reaccion no llego a Meta (se revierte): ${err instanceof Error ? err.message : err}`,
        );
        await prisma.waMessage
          .update({ where: { id: msg.id }, data: { reactions: prev as unknown as Prisma.InputJsonValue } })
          .catch(() => null);
        await this.realtime.publish(tenantId, { kind: 'wa.message', phone }).catch(() => null);
      }
    })();
    return { ok: true };
  }

  /** DESTACAR / quitar destacado. */
  async star(rawPhone: string, input: StarWaMessageInput, auth: AuthContext): Promise<{ ok: true }> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();
    const phone = tenDigits(rawPhone);
    const res = await prisma.waMessage.updateMany({
      where: { id: input.messageId, phone },
      data: { starred: input.starred },
    });
    if (res.count === 0) throw new NotFoundException('Mensaje no encontrado');
    await this.realtime.publish(tenantId, { kind: 'wa.message', phone });
    return { ok: true };
  }

  /** ELIMINA un mensaje DE LA PLATAFORMA (WhatsApp no permite borrarlo alla). */
  async deleteMessage(rawPhone: string, messageId: string, auth: AuthContext): Promise<{ ok: true }> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();
    const phone = tenDigits(rawPhone);
    const res = await prisma.waMessage.deleteMany({ where: { id: messageId, phone } });
    if (res.count === 0) throw new NotFoundException('Mensaje no encontrado');
    await this.realtime.publish(tenantId, { kind: 'wa.message', phone });
    return { ok: true };
  }

  /** REENVIA un mensaje existente a OTRO chat (texto o medio). */
  async forward(rawPhone: string, input: ForwardWaMessageInput, auth: AuthContext): Promise<WaMessageDto> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();
    const to = tenDigits(rawPhone);
    if (to.length < 7) throw new BadRequestException('Teléfono inválido');
    const d360 = await this.waConn.dialog360OrNull(tenantId, prisma);
    this.requireD360(d360, 'external');
    const src = await prisma.waMessage.findUnique({ where: { id: input.messageId } });
    if (!src) throw new NotFoundException('Mensaje no encontrado');

    // ACK PRIMERO: el reenviado aparece YA en el chat destino con relojito.
    const row = await prisma.waMessage.create({
      data: {
        phone: to,
        direction: 'out',
        kind: src.kind,
        body: src.body,
        attachmentKey: src.attachmentKey,
        mediaUrl: src.mediaUrl,
        authorId: auth.userId,
        authorName: auth.name?.trim() || auth.email,
        status: 'queued',
      },
    });
    await this.publisher.publishWaMessage(tenantId, prisma, row);
    this.dispatchWaSend(tenantId, prisma, row.id, to, 'No se pudo reenviar el mensaje', async () => {
      if (src.kind === 'text' || (!src.attachmentKey && !src.mediaUrl)) {
        return this.dialog360.sendText(d360!.http, d360!.mode, `57${to}`, src.body ?? '');
      }
      const url = src.attachmentKey ? await this.storage.getSignedUrl(src.attachmentKey) : src.mediaUrl!;
      const kind =
        src.kind === 'file'
          ? ('document' as const)
          : (src.kind as 'image' | 'video' | 'audio' | 'sticker');
      return this.dialog360.sendMediaLink(
        d360!.http,
        d360!.mode,
        `57${to}`,
        kind,
        url,
        kind === 'document' ? (src.body ?? undefined) : undefined,
      );
    });
    return this.publisher.toDto(row);
  }

  /** Envia una TARJETA DE CONTACTO. */
  async sendContact(rawPhone: string, input: SendWaContactInput, auth: AuthContext): Promise<WaMessageDto> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();
    const phone = tenDigits(rawPhone);
    if (phone.length < 7) throw new BadRequestException('Teléfono inválido');
    const d360 = await this.waConn.dialog360OrNull(tenantId, prisma);
    this.requireD360(d360, 'external');
    // ACK PRIMERO: la tarjeta aparece YA con relojito; Meta en segundo plano.
    const row = await prisma.waMessage.create({
      data: {
        phone,
        direction: 'out',
        kind: 'text',
        body: `👤 ${input.name}\n${input.phone}`,
        authorId: auth.userId,
        authorName: auth.name?.trim() || auth.email,
        status: 'queued',
      },
    });
    await this.publisher.publishWaMessage(tenantId, prisma, row);
    this.dispatchWaSend(tenantId, prisma, row.id, phone, 'No se pudo enviar el contacto', () =>
      this.dialog360.sendContact(d360!.http, d360!.mode, `57${phone}`, input.name, input.phone),
    );
    return this.publisher.toDto(row);
  }

  // === Stickers: enviar + FAVORITOS del negocio ===

  /** Envia un sticker: favorito (stickerId) o el de un mensaje del historial. */
  async sendSticker(rawPhone: string, input: SendWaStickerInput, auth: AuthContext): Promise<WaMessageDto> {
    this.assertAdmin(auth);
    const { prisma } = getTenantContext();
    let key: string | null = null;
    if (input.stickerId) {
      key = (await prisma.waStickerFav.findUnique({ where: { id: input.stickerId } }))?.attachmentKey ?? null;
    } else if (input.messageId) {
      const msg = await prisma.waMessage.findUnique({
        where: { id: input.messageId },
        select: { kind: true, attachmentKey: true },
      });
      if (msg?.kind === 'sticker') key = msg.attachmentKey;
    }
    if (!key) throw new NotFoundException('Sticker no encontrado');
    return this.sendStickerByKey(rawPhone, key, auth);
  }

  /** "Nuevo sticker": sube el webp (el navegador lo convierte), lo envia y lo guarda en favoritos. */
  async sendStickerUpload(rawPhone: string, file: UploadedWaFile, auth: AuthContext): Promise<WaMessageDto> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();
    if (!this.storage.isConfigured()) {
      throw new BadRequestException('El almacenamiento de archivos no esta configurado');
    }
    const key = `tenants/${tenantId}/whatsapp/stickers/${randomUUID()}.webp`;
    await this.storage.put(key, file.buffer, 'image/webp');
    await prisma.waStickerFav.create({ data: { attachmentKey: key } }).catch(() => null);
    return this.sendStickerByKey(rawPhone, key, auth);
  }

  private async sendStickerByKey(rawPhone: string, key: string, auth: AuthContext): Promise<WaMessageDto> {
    const { tenantId, prisma } = getTenantContext();
    const phone = tenDigits(rawPhone);
    if (phone.length < 7) throw new BadRequestException('Teléfono inválido');
    const d360 = await this.waConn.dialog360OrNull(tenantId, prisma);
    this.requireD360(d360, 'external');
    // ACK PRIMERO: el sticker aparece YA (desde nuestro storage); normalizar
    // (<100KB 512x512), subir a Meta y enviar corre en la cola del chat.
    const row = await prisma.waMessage.create({
      data: {
        phone,
        direction: 'out',
        kind: 'sticker',
        attachmentKey: key,
        authorId: auth.userId,
        authorName: auth.name?.trim() || auth.email,
        status: 'queued',
      },
    });
    await this.publisher.publishWaMessage(tenantId, prisma, row);
    this.dispatchWaSend(tenantId, prisma, row.id, phone, 'No se pudo enviar el sticker', async () => {
      const obj = await this.storage.get(key);
      if (!obj) throw new NotFoundException('Sticker no disponible en el storage');
      const webp = await normalizeSticker(obj.buffer);
      const mediaId = await this.dialog360.uploadMedia(
        d360!.apiKey,
        d360!.mode,
        webp,
        'image/webp',
        'sticker.webp',
      );
      if (!mediaId) throw new BadRequestException('Meta no devolvió el id del sticker');
      return this.dialog360.sendMediaId(d360!.http, d360!.mode, `57${phone}`, 'sticker', mediaId);
    });
    return this.publisher.toDto(row);
  }

  /** Favoritos del negocio (compartidos), con URL firmada lista para pintar. */
  async listStickerFavs(auth: AuthContext): Promise<Array<{ id: string; url: string }>> {
    this.assertAdmin(auth);
    const { prisma } = getTenantContext();
    const rows = await prisma.waStickerFav.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    const out: Array<{ id: string; url: string }> = [];
    for (const r of rows) {
      const url = await this.storage.getSignedUrl(r.attachmentKey).catch(() => null);
      if (url) out.push({ id: r.id, url });
    }
    return out;
  }

  /** Agrega a favoritos el sticker de un mensaje del hilo. */
  async addStickerFav(input: AddWaStickerFavInput, auth: AuthContext): Promise<{ ok: true }> {
    this.assertAdmin(auth);
    const { prisma } = getTenantContext();
    const msg = await prisma.waMessage.findUnique({
      where: { id: input.messageId },
      select: { kind: true, attachmentKey: true },
    });
    if (msg?.kind !== 'sticker' || !msg.attachmentKey) {
      throw new BadRequestException('Ese mensaje no es un sticker descargado');
    }
    await prisma.waStickerFav
      .create({ data: { attachmentKey: msg.attachmentKey } })
      .catch(() => null); // ya era favorito
    return { ok: true };
  }

  async removeStickerFav(id: string, auth: AuthContext): Promise<{ ok: true }> {
    this.assertAdmin(auth);
    const { prisma } = getTenantContext();
    await prisma.waStickerFav.deleteMany({ where: { id } });
    return { ok: true };
  }

  /** Lectura sincronizada: abrir la pestaña WhatsApp del PEDIDO tambien marca leido. */
  async markChatReadByOrder(orderId: string, auth: AuthContext): Promise<{ ok: true }> {
    const { phone } = await this.orderPhone(orderId);
    return this.markChatRead(phone, auth);
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

    return { templates: await this.waTemplates(), suggestions };
  }

  /** Plantillas para un chat de la BANDEJA (sugerencia: solo el nombre). */
  async listTemplatesForPhone(rawPhone: string, auth: AuthContext): Promise<WaTemplateList> {
    this.assertAdmin(auth);
    const { prisma } = getTenantContext();
    const phone = tenDigits(rawPhone);
    const contact = phone
      ? await prisma.waContact.findUnique({ where: { phone }, select: { name: true } })
      : null;
    return {
      templates: await this.waTemplates(),
      suggestions: { nombre: contact?.name ?? '', productos: '', direccion: '' },
    };
  }

  /** Plantillas de la WABA mapeadas (vacio si no hay conexion de produccion). */
  private async waTemplates(): Promise<WaTemplateList['templates']> {
    const { tenantId, prisma } = getTenantContext();
    const d360 = await this.waConn.dialog360OrNull(tenantId, prisma);
    // El sandbox no tiene WABA propia con plantillas: lista vacia (la UI lo dice).
    if (!d360 || d360.mode !== 'production') return [];
    try {
      const list = await this.cachedTemplates(tenantId, d360.http);
      return list.map((t) => ({ ...t, variables: templateVarCount(t.body) }));
    } catch (err) {
      throw translateWaError(err, 'No se pudieron cargar las plantillas de la WABA', this.logger);
    }
  }

  /** Envia una plantilla de Meta al cliente del pedido (elegida con "/"). */
  async sendTemplate(
    orderId: string,
    input: SendWaTemplateInput,
    auth: AuthContext,
  ): Promise<WaMessageDto> {
    const { phone } = await this.orderPhone(orderId);
    return this.sendTemplateCore(phone, input, auth);
  }

  /** Envia una plantilla a un chat de la BANDEJA (por telefono). */
  async sendTemplateToPhone(
    rawPhone: string,
    input: SendWaTemplateInput,
    auth: AuthContext,
  ): Promise<WaMessageDto> {
    const phone = tenDigits(rawPhone);
    if (phone.length < 7) throw new BadRequestException('Teléfono inválido');
    return this.sendTemplateCore(phone, input, auth);
  }

  private async sendTemplateCore(
    phone: string,
    input: SendWaTemplateInput,
    auth: AuthContext,
  ): Promise<WaMessageDto> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();
    const d360 = await this.waConn.dialog360OrNull(tenantId, prisma);
    if (!d360 || d360.mode !== 'production') {
      throw new BadRequestException(
        'Las plantillas requieren la conexión de 360dialog en producción',
      );
    }

    // Se relee de la WABA (no se confia en el cliente): cuerpo, estado y
    // numero de variables REALES de la plantilla. Con CACHE de 60s: sin el,
    // cada envio pagaba una vuelta extra a 360dialog (~0.5-1s).
    let all;
    try {
      all = await this.cachedTemplates(tenantId, d360.http);
    } catch (err) {
      throw translateWaError(err, 'No se pudieron cargar las plantillas de la WABA', this.logger);
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
    // ACK PRIMERO: en el hilo queda YA el TEXTO REAL (variables sustituidas)
    // + botones, con relojito; el envio a Meta corre en la cola del chat.
    const row = await prisma.waMessage.create({
      data: {
        phone,
        direction: 'out',
        kind: 'text',
        body: renderTemplateBody(tpl.body, params),
        authorId: auth.userId,
        authorName: auth.name?.trim() || auth.email,
        status: 'queued',
        ...(tpl.buttons.length
          ? { buttons: tpl.buttons as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
    await this.publisher.publishWaMessage(tenantId, prisma, row);
    this.dispatchWaSend(tenantId, prisma, row.id, phone, '360dialog no pudo enviar la plantilla', () =>
      this.dialog360.sendTemplate(d360.http, d360.mode, `57${phone}`, tpl.name, tpl.language, components),
    );
    return this.publisher.toDto(row);
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
   * La fachada delega TODO el lado de recepcion en WhatsappWebhookService.
   */
  async inboundCloud(tenantId: string, prisma: PrismaClient, payload: unknown): Promise<void> {
    return this.webhook.inboundCloud(tenantId, prisma, payload);
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

    const d360 = await this.waConn.dialog360OrNull(tenantId, prisma);
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
          const list = await this.cachedTemplates(tenantId, d360.http);
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
        throw translateWaError(err, '360dialog no pudo enviar la confirmación', this.logger);
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
      await this.publisher.publishWaMessage(tenantId, prisma, waRow);
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
    const { phone } = await this.orderPhone(orderId);
    return this.audioOf(phone, messageId, auth);
  }

  /** Audio de una nota de voz de un chat de la BANDEJA. */
  async audioFileByPhone(
    rawPhone: string,
    messageId: string,
    auth: AuthContext,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    return this.audioOf(tenDigits(rawPhone), messageId, auth);
  }

  private async audioOf(
    phone: string,
    messageId: string,
    auth: AuthContext,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    this.assertAdmin(auth);
    const { prisma } = getTenantContext();
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
   * Despacho ASINCRONO a WhatsApp (ack primero, como WhatsApp real): el
   * endpoint guarda el mensaje con status 'queued' (relojito) y responde YA
   * (~200ms); esta cola POR CHAT lo envia a Meta en orden y al terminar
   * actualiza el mensaje (sent/failed) y lo re-publica por SSE — el relojito
   * pasa a chulito (o bolita roja con el motivo) sin esperar el viaje a Meta.
   */
  private readonly sendChains = new Map<string, Promise<void>>();

  private dispatchWaSend(
    tenantId: string,
    prisma: PrismaClient,
    rowId: string,
    phone: string,
    fallbackError: string,
    send: () => Promise<string | null>,
  ): void {
    const chainKey = `${tenantId}:${phone}`;
    const prev = this.sendChains.get(chainKey) ?? Promise.resolve();
    const next = prev
      .then(async () => {
        try {
          const wamid = await send();
          if (wamid) {
            await prisma.waMessage.update({ where: { id: rowId }, data: { externalId: wamid } });
          }
          // Subir a 'sent' SOLO si sigue encolado (un webhook de estado pudo
          // habernos adelantado con delivered/read/failed).
          await prisma.waMessage.updateMany({
            where: { id: rowId, status: 'queued' },
            data: { status: wamid ? 'sent' : null },
          });
        } catch (err) {
          const detail =
            err instanceof HttpException
              ? err.message
              : translateWaError(err, fallbackError, this.logger).message;
          await prisma.waMessage
            .updateMany({ where: { id: rowId }, data: { status: 'failed', error: detail } })
            .catch(() => null);
          this.logger.warn(`Envio WA en cola fallo (${rowId}): ${detail}`);
        }
        const row = await prisma.waMessage.findUnique({ where: { id: rowId } });
        if (row) await this.publisher.publishWaMessage(tenantId, prisma, row as WaMessageRow & { phone: string });
      })
      .finally(() => {
        if (this.sendChains.get(chainKey) === next) this.sendChains.delete(chainKey);
      });
    this.sendChains.set(chainKey, next);
  }

  private assertAdmin(auth: AuthContext): void {
    // WhatsApp es de ADMINISTRADORES (propietario + admins); operadores no.
    if (auth.role !== 'OWNER' && auth.role !== 'ADMIN') {
      throw new ForbiddenException('WhatsApp es solo para administradores');
    }
  }
}
