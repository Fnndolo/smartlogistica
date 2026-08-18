import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import {
  addWaStickerFavSchema,
  dialog360CredentialsSchema,
  forwardWaMessageSchema,
  sendWaContactSchema,
  sendWaReactionSchema,
  sendWaStickerSchema,
  sendWaTemplateSchema,
  sendWaTextSchema,
  setWaLabelsSchema,
  starWaMessageSchema,
  type AddWaStickerFavInput,
  type Dialog360ConnectionSummary,
  type Dialog360CredentialsInput,
  type Dialog360TestResult,
  type ForwardWaMessageInput,
  type SendWaContactInput,
  type SendWaReactionInput,
  type SendWaStickerInput,
  type SendWaTemplateInput,
  type SendWaTextInput,
  type SetWaLabelsInput,
  type StarWaMessageInput,
  type WaInbox,
  type WaMessage,
  type WaStickerFav,
  type WaTemplateList,
  type WaThread,
} from '@smartlogistica/shared';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthContext } from '../../common/types/authenticated-request';
import { WA_FILE_MAX_BYTES, WhatsappService } from './whatsapp.service';

interface UploadedWaFile {
  buffer: Buffer;
  mimetype: string;
  originalname?: string;
}

/**
 * Conexion a 360dialog (Cloud API de Meta). Al conectar, el webhook del numero
 * queda apuntando AUTOMATICAMENTE a esta plataforma. Solo propietario (temporal).
 */
@Controller('connections/dialog360')
export class Dialog360ConnectionController {
  constructor(private readonly whatsapp: WhatsappService) {}

  @Get()
  async get(@CurrentUser() user: AuthContext): Promise<Dialog360ConnectionSummary | null> {
    return this.whatsapp.getDialog360(user);
  }

  @Post('test')
  @HttpCode(200)
  async test(
    @Body(new ZodValidationPipe(dialog360CredentialsSchema)) body: Dialog360CredentialsInput,
    @CurrentUser() user: AuthContext,
  ): Promise<Dialog360TestResult> {
    return this.whatsapp.testDialog360(body, user);
  }

  @Put()
  async connect(
    @Body(new ZodValidationPipe(dialog360CredentialsSchema)) body: Dialog360CredentialsInput,
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
  ): Promise<Dialog360ConnectionSummary> {
    // URL publica de la plataforma (la request llega proxied por el web): con
    // ella se auto-configura el webhook del numero en 360dialog.
    const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host ?? '';
    const base = `https://${String(host).split(',')[0].trim()}`;
    return this.whatsapp.connectDialog360(body, user, base);
  }

  @Delete()
  @HttpCode(204)
  async disconnect(@CurrentUser() user: AuthContext): Promise<void> {
    await this.whatsapp.disconnectDialog360(user);
  }
}

/**
 * BANDEJA de WhatsApp (inbox estilo WhatsApp Web): todos los chats por
 * telefono. Mismos sub-paths que el WhatsApp del pedido para que el panel del
 * chat sea reutilizable. Solo administradores.
 */
@Controller('whatsapp')
export class WhatsappInboxController {
  constructor(private readonly whatsapp: WhatsappService) {}

  /** Todos los chats (ultimo mensaje + no leidos + etiquetas). */
  @Get('inbox')
  async inbox(@CurrentUser() user: AuthContext): Promise<WaInbox> {
    return this.whatsapp.inbox(user);
  }

  /** Hilo completo de un chat. */
  @Get('chats/:phone')
  async thread(@Param('phone') phone: string, @CurrentUser() user: AuthContext): Promise<WaThread> {
    return this.whatsapp.threadByPhone(phone, user);
  }

  /** Marcar como leido (apaga el contador verde de ESTE usuario). */
  @Post('chats/:phone/read')
  @HttpCode(200)
  async read(@Param('phone') phone: string, @CurrentUser() user: AuthContext): Promise<{ ok: true }> {
    return this.whatsapp.markChatRead(phone, user);
  }

  /** Etiquetas del chat. */
  @Put('chats/:phone/labels')
  async labels(
    @Param('phone') phone: string,
    @Body(new ZodValidationPipe(setWaLabelsSchema)) body: SetWaLabelsInput,
    @CurrentUser() user: AuthContext,
  ): Promise<{ ok: true }> {
    return this.whatsapp.setChatLabels(phone, body, user);
  }

  @Post('chats/:phone/text')
  @HttpCode(201)
  async sendText(
    @Param('phone') phone: string,
    @Body(new ZodValidationPipe(sendWaTextSchema)) body: SendWaTextInput,
    @CurrentUser() user: AuthContext,
  ): Promise<WaMessage> {
    return this.whatsapp.sendTextToPhone(phone, body, user);
  }

  @Post('chats/:phone/file')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: WA_FILE_MAX_BYTES } }))
  async sendFile(
    @Param('phone') phone: string,
    @UploadedFile() file: UploadedWaFile | undefined,
    @CurrentUser() user: AuthContext,
  ): Promise<WaMessage> {
    if (!file) throw new BadRequestException('No se recibio ningun archivo');
    return this.whatsapp.sendFileToPhone(phone, file, user);
  }

  @Get('chats/:phone/templates')
  async templates(
    @Param('phone') phone: string,
    @CurrentUser() user: AuthContext,
  ): Promise<WaTemplateList> {
    return this.whatsapp.listTemplatesForPhone(phone, user);
  }

  @Post('chats/:phone/template')
  @HttpCode(201)
  async sendTemplate(
    @Param('phone') phone: string,
    @Body(new ZodValidationPipe(sendWaTemplateSchema)) body: SendWaTemplateInput,
    @CurrentUser() user: AuthContext,
  ): Promise<WaMessage> {
    return this.whatsapp.sendTemplateToPhone(phone, body, user);
  }

  @Get('chats/:phone/audio/:messageId')
  async audio(
    @Param('phone') phone: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: AuthContext,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, contentType } = await this.whatsapp.audioFileByPhone(phone, messageId, user);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(buffer);
  }

  // === Acciones sobre mensajes (menu contextual) ===

  @Post('chats/:phone/reaction')
  @HttpCode(200)
  async reaction(
    @Param('phone') phone: string,
    @Body(new ZodValidationPipe(sendWaReactionSchema)) body: SendWaReactionInput,
    @CurrentUser() user: AuthContext,
  ): Promise<{ ok: true }> {
    return this.whatsapp.react(phone, body, user);
  }

  @Post('chats/:phone/star')
  @HttpCode(200)
  async star(
    @Param('phone') phone: string,
    @Body(new ZodValidationPipe(starWaMessageSchema)) body: StarWaMessageInput,
    @CurrentUser() user: AuthContext,
  ): Promise<{ ok: true }> {
    return this.whatsapp.star(phone, body, user);
  }

  @Delete('chats/:phone/messages/:messageId')
  @HttpCode(200)
  async deleteMessage(
    @Param('phone') phone: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: AuthContext,
  ): Promise<{ ok: true }> {
    return this.whatsapp.deleteMessage(phone, messageId, user);
  }

  /** Reenviar un mensaje existente A este chat. */
  @Post('chats/:phone/forward')
  @HttpCode(201)
  async forward(
    @Param('phone') phone: string,
    @Body(new ZodValidationPipe(forwardWaMessageSchema)) body: ForwardWaMessageInput,
    @CurrentUser() user: AuthContext,
  ): Promise<WaMessage> {
    return this.whatsapp.forward(phone, body, user);
  }

  @Post('chats/:phone/contact')
  @HttpCode(201)
  async contact(
    @Param('phone') phone: string,
    @Body(new ZodValidationPipe(sendWaContactSchema)) body: SendWaContactInput,
    @CurrentUser() user: AuthContext,
  ): Promise<WaMessage> {
    return this.whatsapp.sendContact(phone, body, user);
  }

  // === Stickers ===

  /** Enviar sticker favorito (stickerId) o el de un mensaje (messageId). */
  @Post('chats/:phone/sticker')
  @HttpCode(201)
  async sticker(
    @Param('phone') phone: string,
    @Body(new ZodValidationPipe(sendWaStickerSchema)) body: SendWaStickerInput,
    @CurrentUser() user: AuthContext,
  ): Promise<WaMessage> {
    return this.whatsapp.sendSticker(phone, body, user);
  }

  /** "Nuevo sticker": webp convertido por el navegador; se envia y queda en favoritos. */
  @Post('chats/:phone/sticker-upload')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  async stickerUpload(
    @Param('phone') phone: string,
    @UploadedFile() file: UploadedWaFile | undefined,
    @CurrentUser() user: AuthContext,
  ): Promise<WaMessage> {
    if (!file) throw new BadRequestException('No se recibio el sticker');
    return this.whatsapp.sendStickerUpload(phone, file, user);
  }

  @Get('stickers')
  async stickers(@CurrentUser() user: AuthContext): Promise<WaStickerFav[]> {
    return this.whatsapp.listStickerFavs(user);
  }

  @Post('stickers')
  @HttpCode(200)
  async addSticker(
    @Body(new ZodValidationPipe(addWaStickerFavSchema)) body: AddWaStickerFavInput,
    @CurrentUser() user: AuthContext,
  ): Promise<{ ok: true }> {
    return this.whatsapp.addStickerFav(body, user);
  }

  @Delete('stickers/:id')
  @HttpCode(200)
  async removeSticker(
    @Param('id') id: string,
    @CurrentUser() user: AuthContext,
  ): Promise<{ ok: true }> {
    return this.whatsapp.removeStickerFav(id, user);
  }
}

/** WhatsApp del PEDIDO (pestaña del drawer). Solo administradores. */
@Controller('orders')
export class OrderWhatsappController {
  constructor(private readonly whatsapp: WhatsappService) {}

  /** Hilo completo (por el telefono del cliente del pedido). */
  @Get(':id/whatsapp')
  async thread(@Param('id') id: string, @CurrentUser() user: AuthContext): Promise<WaThread> {
    return this.whatsapp.thread(id, user);
  }

  /**
   * Envio MANUAL de la confirmacion del pedido (el boton "Sin enviar" de la
   * columna Direccion): misma plantilla/flujo que el automatico.
   */
  @Post(':id/whatsapp/confirmation')
  @HttpCode(200)
  async sendConfirmation(
    @Param('id') id: string,
    @CurrentUser() user: AuthContext,
  ): Promise<{ ok: true }> {
    return this.whatsapp.sendConfirmationManual(id, user);
  }

  /** Lectura SINCRONIZADA: abrir la pestaña WhatsApp del pedido marca leido el chat. */
  @Post(':id/whatsapp/read')
  @HttpCode(200)
  async read(@Param('id') id: string, @CurrentUser() user: AuthContext): Promise<{ ok: true }> {
    return this.whatsapp.markChatReadByOrder(id, user);
  }

  /** Audio de una nota de voz del hilo, servido same-origin (onda real sin CORS). */
  @Get(':id/whatsapp/audio/:messageId')
  async audio(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: AuthContext,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, contentType } = await this.whatsapp.audioFile(id, messageId, user);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(buffer);
  }

  /** Plantillas de la WABA + sugerencias del pedido (el picker de "/"). */
  @Get(':id/whatsapp/templates')
  async templates(
    @Param('id') id: string,
    @CurrentUser() user: AuthContext,
  ): Promise<WaTemplateList> {
    return this.whatsapp.listTemplates(id, user);
  }

  /** Envia una plantilla de Meta (elegida con "/") al cliente. */
  @Post(':id/whatsapp/template')
  @HttpCode(201)
  async sendTemplate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(sendWaTemplateSchema)) body: SendWaTemplateInput,
    @CurrentUser() user: AuthContext,
  ): Promise<WaMessage> {
    return this.whatsapp.sendTemplate(id, body, user);
  }

  /** Envia un texto al cliente por WhatsApp. */
  @Post(':id/whatsapp/text')
  @HttpCode(201)
  async sendText(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(sendWaTextSchema)) body: SendWaTextInput,
    @CurrentUser() user: AuthContext,
  ): Promise<WaMessage> {
    return this.whatsapp.sendText(id, body, user);
  }

  /** Envia un archivo (imagen/video/audio/documento) al cliente por WhatsApp. */
  @Post(':id/whatsapp/file')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: WA_FILE_MAX_BYTES } }))
  async sendFile(
    @Param('id') id: string,
    @UploadedFile() file: UploadedWaFile | undefined,
    @CurrentUser() user: AuthContext,
  ): Promise<WaMessage> {
    if (!file) throw new BadRequestException('No se recibio ningun archivo');
    return this.whatsapp.sendFile(id, file, user);
  }
}
