import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  type MessageEvent,
  Param,
  Post,
  Query,
  Sse,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Observable } from 'rxjs';
import {
  assignOrdersSchema,
  catalogLookupSchema,
  createGuideSchema,
  createInvoiceSchema,
  createManualOrderSchema,
  createOrderMessageSchema,
  toggleReactionSchema,
  devicePhotoKindSchema,
  listOrdersQuerySchema,
  orderReactionInputSchema,
  processAllSchema,
  type AlegraItem,
  type AlegraPaymentAccount,
  type AssignOrdersInput,
  type CatalogLookupInput,
  type CatalogMatch,
  type CoordinadoraCity,
  type CreateGuideInput,
  type CreateInvoiceInput,
  type CreateManualOrderInput,
  type CreateOrderMessageInput,
  type ToggleReactionInput,
  type DevicePhotoResponse,
  type Guide,
  type GuidePreview,
  type GuideTracking,
  type InvoicePreview,
  type InvoiceResult,
  type ListOrdersQuery,
  type ListOrdersResponse,
  type OrderDetail,
  type OrderReactionInput,
  type OrdersPulse,
  type Inbox,
  type MentionItem,
  type OrderSearchResult,
  type OrderEvent,
  type OrderMessage,
  type ProcessAllInput,
  type ProcessAllResult,
} from '@smartlogistica/shared';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SkipTenantContext } from '../../common/decorators/skip-tenant-context.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthContext } from '../../common/types/authenticated-request';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service';
import { OrdersService } from './orders.service';

const SSE_HEARTBEAT_MS = 25_000;

/** Forma minima del archivo subido por multer (evita depender del namespace Express.Multer). */
interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
}

/** Adjunto normal (foto/video/archivo): ademas del buffer, conserva el nombre original. */
interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  originalname?: string;
}

/** Tope de subida para adjuntos normales (videos incluidos). */
const ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly realtime: RealtimeService,
  ) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(listOrdersQuerySchema)) query: ListOrdersQuery,
    @CurrentUser() user: AuthContext,
  ): Promise<ListOrdersResponse> {
    return this.orders.list(query, user);
  }

  @Get('stats')
  async stats(): Promise<{ readyForHandling: number; handling: number; connections: number }> {
    return this.orders.stats();
  }

  /** "Pulso" de la vista de pedidos (4 metricas). Ruta literal: antes de :id. */
  @Get('pulse')
  async pulse(
    @Query('scope') scope: string | undefined,
    @Query('warehouse') warehouse: string | undefined,
    @CurrentUser() user: AuthContext,
  ): Promise<OrdersPulse> {
    const s = scope === 'pending' || scope === 'invoiced' ? scope : 'general';
    return this.orders.pulse(s, warehouse ?? null, user);
  }

  /**
   * Refresca el estado de envio (rastreo Coordinadora por lotes) de los pedidos
   * con guia de una sede. Ruta literal: va ANTES de las rutas con :id.
   */
  @Post('refresh-shipping')
  @HttpCode(200)
  async refreshShipping(
    @Query('warehouse') warehouse: string,
    @CurrentUser() user: AuthContext,
  ): Promise<{ updated: number }> {
    if (!warehouse) throw new BadRequestException('Falta el parametro warehouse');
    return this.orders.refreshShipping(warehouse, user);
  }

  /**
   * Bandeja de la campana: pedidos con mensajes sin leer para el usuario actual.
   * Ruta literal: va ANTES de las rutas con :id.
   */
  @Get('inbox')
  async inbox(@CurrentUser() user: AuthContext): Promise<Inbox> {
    return this.orders.inbox(user);
  }

  /** Menciones a mi (pagina "Menciones"). Ruta literal: antes de :id. */
  @Get('mentions')
  async mentions(@CurrentUser() user: AuthContext): Promise<MentionItem[]> {
    return this.orders.mentionsFeed(user);
  }

  /** Busqueda global (generales + todas las sedes). Ruta literal: antes de :id. */
  @Get('search')
  async search(
    @Query('q') q: string | undefined,
    @CurrentUser() user: AuthContext,
  ): Promise<OrderSearchResult[]> {
    const query = (q ?? '').trim();
    if (query.length < 2) return [];
    return this.orders.globalSearch(query.slice(0, 120), user);
  }

  /** Alertas de SUPER MENCION (@todos) pendientes. Ruta literal: antes de :id. */
  @Get('super-mentions/pending')
  async pendingSuperMentions(@CurrentUser() user: AuthContext) {
    return this.orders.pendingSuperMentions(user);
  }

  /** Cierra alertas de super mencion (por messageIds). Ruta literal: antes de :id. */
  @Post('super-mentions/ack')
  @HttpCode(200)
  async ackSuperMentions(
    @Body('messageIds') messageIds: unknown,
    @CurrentUser() user: AuthContext,
  ): Promise<{ ok: true }> {
    const ids = Array.isArray(messageIds)
      ? messageIds.filter((x): x is string => typeof x === 'string').slice(0, 50)
      : [];
    return this.orders.ackSuperMentions(ids, user);
  }

  /**
   * "Montar pedido": crea un pedido EXTERNO a las plataformas directo en una
   * sede. Ruta literal: va ANTES de las rutas con :id.
   */
  @Post('manual')
  @HttpCode(201)
  async createManual(
    @Body(new ZodValidationPipe(createManualOrderSchema)) body: CreateManualOrderInput,
    @CurrentUser() user: AuthContext,
  ) {
    return this.orders.createManualOrder(body, user);
  }

  /** Asignar / transferir / devolver (warehouseId null) pedidos a una sede. */
  @Post('assign')
  @HttpCode(200)
  async assign(
    @Body(new ZodValidationPipe(assignOrdersSchema)) body: AssignOrdersInput,
    @CurrentUser() user: AuthContext,
  ): Promise<{ count: number }> {
    return this.orders.assign(body, user);
  }

  /**
   * Stream SSE de cambios de pedidos para el tenant activo. El cliente abre un
   * EventSource y recibe un mensaje cada vez que un pedido se crea/actualiza/
   * elimina (via backfill o webhook). Tambien manda un `ping` cada 25s para
   * mantener viva la conexion a traves de proxies.
   *
   * @SkipTenantContext: no necesita el Prisma del tenant (solo Redis pub/sub) y
   * ademas evita que TenantInterceptor cierre el stream con firstValueFrom.
   */
  @Sse('stream')
  @SkipTenantContext()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  stream(@CurrentUser() user: AuthContext): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const tenantId = user.activeTenantId;
      if (!tenantId) {
        subscriber.complete();
        return;
      }

      const unsubscribe = this.realtime.subscribe(tenantId, (event) => {
        try {
          subscriber.next({ data: event });
        } catch {
          /* subscriber cerrado; la teardown limpia abajo */
        }
      });

      const heartbeat = setInterval(() => {
        if (subscriber.closed) {
          clearInterval(heartbeat);
          return;
        }
        try {
          subscriber.next({ type: 'ping', data: { t: Date.now() } });
        } catch {
          clearInterval(heartbeat);
        }
      }, SSE_HEARTBEAT_MS);

      return () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
    });
  }

  // === Drawer por pedido (detalle + conversacion + actividad) ===
  // NOTA: estas rutas con :id van DESPUES de las rutas literales (stats, stream)
  // para que Express no matchee /orders/stats o /orders/stream contra :id.

  @Get(':id')
  async detail(
    @Param('id') id: string,
    @CurrentUser() user: AuthContext,
  ): Promise<OrderDetail> {
    return this.orders.getDetail(id, user);
  }

  /** Elimina DEL TODO un pedido montado a mano (los de marketplace no se tocan). */
  @Delete(':id')
  @HttpCode(204)
  async deleteOrder(@Param('id') id: string, @CurrentUser() user: AuthContext): Promise<void> {
    await this.orders.deleteOrder(id, user);
  }

  @Get(':id/messages')
  async messages(
    @Param('id') id: string,
    @CurrentUser() user: AuthContext,
  ): Promise<OrderMessage[]> {
    return this.orders.listMessages(id, user);
  }

  @Post(':id/messages')
  @HttpCode(201)
  async postMessage(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createOrderMessageSchema)) body: CreateOrderMessageInput,
    @CurrentUser() user: AuthContext,
  ): Promise<OrderMessage> {
    return this.orders.postMessage(id, body, user);
  }

  /** Señal efimera "esta escribiendo" (se emite por SSE a los chats abiertos). */
  @Post(':id/typing')
  @HttpCode(204)
  async typing(@Param('id') id: string, @CurrentUser() user: AuthContext): Promise<void> {
    await this.orders.typing(id, user);
  }

  /** Alterna MI reaccion con un emoji sobre un mensaje del chat. */
  @Post(':id/messages/:messageId/reactions')
  @HttpCode(200)
  async toggleReaction(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body(new ZodValidationPipe(toggleReactionSchema)) body: ToggleReactionInput,
    @CurrentUser() user: AuthContext,
  ): Promise<OrderMessage> {
    return this.orders.toggleReaction(id, messageId, body.emoji, user);
  }

  /** "Tomar pedido": queda a mi cargo; nadie mas puede tomarlo. */
  @Post(':id/claim')
  @HttpCode(200)
  async claim(@Param('id') id: string, @CurrentUser() user: AuthContext): Promise<{ ok: true }> {
    return this.orders.claimOrder(id, user);
  }

  /** Soltar un pedido tomado (solo quien lo tomo, o un admin). */
  @Delete(':id/claim')
  @HttpCode(200)
  async unclaim(@Param('id') id: string, @CurrentUser() user: AuthContext): Promise<{ ok: true }> {
    return this.orders.unclaimOrder(id, user);
  }

  /** Alterna MI reaccion con un emoji sobre el PEDIDO (cualquiera puede). */
  @Post(':id/reactions')
  @HttpCode(200)
  async toggleOrderReaction(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(orderReactionInputSchema)) body: OrderReactionInput,
    @CurrentUser() user: AuthContext,
  ): Promise<{ removed: boolean }> {
    return this.orders.toggleOrderReaction(id, body.emoji, user);
  }

  /** Elimina un mensaje del chat (incluidas las fotos). Autor o admin. */
  @Delete(':id/messages/:messageId')
  @HttpCode(204)
  async deleteMessage(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: AuthContext,
  ): Promise<void> {
    await this.orders.deleteMessage(id, messageId, user);
  }

  /** Marca como leido el hilo del pedido (al abrir la conversacion). */
  @Post(':id/read')
  @HttpCode(204)
  async markRead(@Param('id') id: string, @CurrentUser() user: AuthContext): Promise<void> {
    await this.orders.markRead(id, user);
  }

  @Get(':id/events')
  async events(
    @Param('id') id: string,
    @CurrentUser() user: AuthContext,
  ): Promise<OrderEvent[]> {
    return this.orders.listEvents(id, user);
  }

  /**
   * Sube la foto de un dispositivo (multipart, campo `file`; `?kind=imei|serial`).
   * El backend lee el/los codigo(s) con IA; si no hay ninguno responde 400 y no
   * guarda nada. Devuelve el mensaje + los matches del catalogo de compras.
   */
  @Post(':id/device-photo')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  async devicePhoto(
    @Param('id') id: string,
    @Query('kind') kind: string,
    @UploadedFile() file: UploadedImage | undefined,
    @CurrentUser() user: AuthContext,
  ): Promise<DevicePhotoResponse> {
    if (!file) throw new BadRequestException('No se recibio ninguna imagen');
    const parsed = devicePhotoKindSchema.safeParse(kind);
    if (!parsed.success) throw new BadRequestException('El parametro kind debe ser "imei" o "serial"');
    return this.orders.addDevicePhoto(id, file, parsed.data, user);
  }

  /**
   * Sube un adjunto NORMAL (foto/video/archivo, campo `file`) a la conversacion,
   * SIN lectura de IMEI/serial: solo almacenamiento. Devuelve el mensaje creado.
   */
  @Post(':id/attachment')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: ATTACHMENT_MAX_BYTES } }))
  async attachment(
    @Param('id') id: string,
    @UploadedFile() file: UploadedFile | undefined,
    @Body('caption') caption: string | undefined,
    @CurrentUser() user: AuthContext,
  ): Promise<OrderMessage> {
    if (!file) throw new BadRequestException('No se recibio ningun archivo');
    return this.orders.addAttachment(id, file, user, typeof caption === 'string' ? caption : undefined);
  }

  /** Busca codigos (IMEI/serial) en el catalogo de compras — para re-mostrar matches. */
  @Post(':id/catalog-lookup')
  @HttpCode(200)
  async catalogLookup(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(catalogLookupSchema)) body: CatalogLookupInput,
    @CurrentUser() user: AuthContext,
  ): Promise<CatalogMatch[]> {
    return this.orders.lookupCodes(id, body.codes, user);
  }

  // === Facturacion ===

  /** Preview: cliente + una linea por codigo con producto + precio sugerido. */
  @Get(':id/invoice-preview')
  async invoicePreview(
    @Param('id') id: string,
    @CurrentUser() user: AuthContext,
  ): Promise<InvoicePreview> {
    return this.orders.invoicePreview(id, user);
  }

  /** Busca items de Alegra (selector manual de producto). */
  @Get(':id/alegra-items')
  async alegraItems(
    @Param('id') id: string,
    @Query('q') q: string,
    @CurrentUser() user: AuthContext,
  ): Promise<AlegraItem[]> {
    return this.orders.searchAlegraItems(id, (q ?? '').trim(), user);
  }

  /** Cuentas de banco de Alegra (medios de pago de pedidos montados a mano). */
  @Get(':id/payment-accounts')
  async paymentAccounts(
    @Param('id') id: string,
    @CurrentUser() user: AuthContext,
  ): Promise<AlegraPaymentAccount[]> {
    return this.orders.listPaymentAccounts(id, user);
  }

  /** Emite la factura de venta en Alegra (cerrada/cobrada, cuenta MARKETPLACE ADDI). */
  @Post(':id/invoice')
  @HttpCode(201)
  async invoice(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createInvoiceSchema)) body: CreateInvoiceInput,
    @CurrentUser() user: AuthContext,
  ): Promise<InvoiceResult> {
    return this.orders.createInvoice(id, body, user);
  }

  // === Guias (Coordinadora) ===

  /** Preview: destinatario (de VTEX, editable) + remitente (sede) + paquete. */
  @Get(':id/guide-preview')
  async guidePreview(
    @Param('id') id: string,
    @CurrentUser() user: AuthContext,
  ): Promise<GuidePreview> {
    return this.orders.guidePreview(id, user);
  }

  /** Busca ciudades (codigo DANE) para el selector de destino. */
  @Get(':id/guide-cities')
  async guideCities(
    @Param('id') id: string,
    @Query('q') q: string,
    @CurrentUser() user: AuthContext,
  ): Promise<CoordinadoraCity[]> {
    return this.orders.searchGuideCities(id, (q ?? '').trim(), user);
  }

  /** Genera la guia en Coordinadora y adjunta el rotulo al chat. */
  @Post(':id/guide')
  @HttpCode(201)
  async guide(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createGuideSchema)) body: CreateGuideInput,
    @CurrentUser() user: AuthContext,
  ): Promise<Guide> {
    return this.orders.generateGuide(id, body, user);
  }

  /**
   * Flujo completo en un paso: factura + guia + cierre en VTEX (MKT). Es una
   * ALTERNATIVA: el flujo por pasos (invoice / guide) sigue funcionando igual.
   */
  @Post(':id/process-all')
  @HttpCode(201)
  async processAll(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(processAllSchema)) body: ProcessAllInput,
    @CurrentUser() user: AuthContext,
  ): Promise<ProcessAllResult> {
    return this.orders.processAll(id, body, user);
  }

  /** Seguimiento detallado del envio (rastreo de la guia en Coordinadora). */
  @Get(':id/tracking')
  async tracking(
    @Param('id') id: string,
    @CurrentUser() user: AuthContext,
  ): Promise<GuideTracking | null> {
    return this.orders.orderTracking(id, user);
  }
}
