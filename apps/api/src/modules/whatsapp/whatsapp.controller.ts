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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import {
  dialog360CredentialsSchema,
  sendWaTemplateSchema,
  sendWaTextSchema,
  type Dialog360ConnectionSummary,
  type Dialog360CredentialsInput,
  type Dialog360TestResult,
  type SendWaTemplateInput,
  type SendWaTextInput,
  type WaMessage,
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
