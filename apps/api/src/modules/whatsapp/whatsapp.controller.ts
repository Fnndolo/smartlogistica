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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  sendWaTextSchema,
  whapifyCredentialsSchema,
  type SendWaTextInput,
  type WaMessage,
  type WaThread,
  type WhapifyConnectionSummary,
  type WhapifyCredentialsInput,
  type WhapifyTestResult,
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

/** Conexion global a Whapify (token del API). Solo administradores. */
@Controller('connections/whapify')
export class WhapifyConnectionController {
  constructor(private readonly whatsapp: WhatsappService) {}

  @Get()
  async get(@CurrentUser() user: AuthContext): Promise<WhapifyConnectionSummary | null> {
    return this.whatsapp.getConnection(user);
  }

  @Post('test')
  @HttpCode(200)
  async test(
    @Body(new ZodValidationPipe(whapifyCredentialsSchema)) body: WhapifyCredentialsInput,
    @CurrentUser() user: AuthContext,
  ): Promise<WhapifyTestResult> {
    return this.whatsapp.test(body, user);
  }

  @Put()
  async connect(
    @Body(new ZodValidationPipe(whapifyCredentialsSchema)) body: WhapifyCredentialsInput,
    @CurrentUser() user: AuthContext,
  ): Promise<WhapifyConnectionSummary> {
    return this.whatsapp.connect(body, user);
  }

  @Delete()
  @HttpCode(204)
  async disconnect(@CurrentUser() user: AuthContext): Promise<void> {
    await this.whatsapp.disconnect(user);
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
   * columna Direccion): mismo flujo de Whapify que el automatico.
   */
  @Post(':id/whatsapp/confirmation')
  @HttpCode(200)
  async sendConfirmation(
    @Param('id') id: string,
    @CurrentUser() user: AuthContext,
  ): Promise<{ ok: true }> {
    return this.whatsapp.sendConfirmationManual(id, user);
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
