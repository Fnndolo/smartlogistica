import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import {
  addiLbaConnectionInputSchema,
  type AddiGuideInfo,
  type AddiLbaConnectionInput,
  type AddiLbaConnectionSummary,
  type AddiLbaSyncResult,
} from '@smartlogistica/shared';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import type { AuthContext } from '../../../common/types/authenticated-request';
import { AddiLbaService } from './addi-lba.service';

/**
 * Conexion de GUIAS DE ADDI (Ajustes › Envíos). Fuera de 'connections/...' por
 * lo mismo que Skydropx: el ConnectionsController generico tiene un
 * @Delete(':id') que se tragaria el DELETE.
 */
@Controller('addi-lba')
export class AddiLbaController {
  constructor(private readonly addi: AddiLbaService) {}

  @Get('connection')
  async get(@CurrentUser() user: AuthContext): Promise<AddiLbaConnectionSummary | null> {
    return this.addi.summary(user);
  }

  @Put('connection')
  async connect(
    @Body(new ZodValidationPipe(addiLbaConnectionInputSchema)) body: AddiLbaConnectionInput,
    @CurrentUser() user: AuthContext,
  ): Promise<AddiLbaConnectionSummary> {
    return this.addi.connect(body, user);
  }

  @Delete('connection')
  @HttpCode(204)
  async disconnect(@CurrentUser() user: AuthContext): Promise<void> {
    await this.addi.disconnect(user);
  }

  /** "Sincronizar ahora": trae ya las guias del portal de Addi. */
  @Post('sync')
  @HttpCode(200)
  async sync(@CurrentUser() user: AuthContext): Promise<AddiLbaSyncResult> {
    return this.addi.syncNow(user);
  }
}

/** Guia de Addi de UN pedido (seccion del Detalle). */
@Controller('orders/:id/addi-guide')
export class AddiGuideController {
  constructor(private readonly addi: AddiLbaService) {}

  @Get()
  async info(@Param('id') id: string, @CurrentUser() user: AuthContext): Promise<AddiGuideInfo> {
    return this.addi.guideInfo(id, user);
  }

  /** Cambiar el remitente al de la sede actual y dejar el rotulo en el chat. */
  @Post('sender')
  @HttpCode(200)
  async applySender(
    @Param('id') id: string,
    @CurrentUser() user: AuthContext,
  ): Promise<AddiGuideInfo> {
    return this.addi.applyManual(id, user);
  }
}
