import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  createWaLineSchema,
  createWaTemplateSchema,
  saveWaFlowSchema,
  updateWaLineSchema,
  type CreateWaLineInput,
  type CreateWaTemplateInput,
  type SaveWaFlowInput,
  type UpdateWaLineInput,
  type WaConfigOverview,
  type WaFlow,
  type WaLineSummary,
  type WaTemplateDetail,
  type WaTemplateListForLine,
} from '@smartlogistica/shared';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthContext } from '../../common/types/authenticated-request';
import { WaFlowService } from './wa-flow.service';
import { WaTemplateService } from './wa-template.service';

/**
 * CONFIGURACION de WhatsApp: las lineas conectadas y los mensajes automaticos.
 *
 * Leer lo puede cualquiera que use WhatsApp (para entender por que sale o no
 * sale un mensaje); cambiarlo, solo administradores — el gate vive en el
 * servicio, como en el resto del modulo.
 */
@Controller('whatsapp/config')
export class WaConfigController {
  constructor(
    private readonly flows: WaFlowService,
    private readonly templates: WaTemplateService,
  ) {}

  /** Todo lo que necesita la pantalla, en un solo viaje. */
  @Get()
  async overview(@CurrentUser() user: AuthContext): Promise<WaConfigOverview> {
    return this.flows.overview(user);
  }

  /**
   * Crea las filas de los flujos que aun no la tienen, con lo que hoy hace el
   * codigo. No cambia comportamiento: solo lo vuelve visible y editable.
   */
  @Post('materialize')
  @HttpCode(200)
  async materialize(@CurrentUser() user: AuthContext): Promise<WaConfigOverview> {
    return this.flows.materialize(user);
  }

  // === LINEAS ===

  /** Da de alta OTRO numero. No toca los que ya estan conectados. */
  @Post('lines')
  @HttpCode(201)
  async createLine(
    @Body(new ZodValidationPipe(createWaLineSchema)) body: CreateWaLineInput,
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
  ): Promise<WaLineSummary> {
    // URL publica de la plataforma (la peticion llega proxied por el web): con
    // ella se arma el webhook de ESTA linea, con su ?line=<id>.
    const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host ?? '';
    const base = `https://${String(host).split(',')[0].trim()}`;
    return this.flows.createLine(body, user, base);
  }

  /** Renombrar o marcar como predeterminada. No toca credenciales. */
  @Put('lines/:id')
  async updateLine(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateWaLineSchema)) body: UpdateWaLineInput,
    @CurrentUser() user: AuthContext,
  ): Promise<WaLineSummary> {
    return this.flows.updateLine(id, body, user);
  }

  @Delete('lines/:id')
  @HttpCode(204)
  async removeLine(@Param('id') id: string, @CurrentUser() user: AuthContext): Promise<void> {
    await this.flows.removeLine(id, user);
  }

  // === FLUJOS ===

  @Post('flows')
  @HttpCode(201)
  async create(
    @Body(new ZodValidationPipe(saveWaFlowSchema)) body: SaveWaFlowInput,
    @CurrentUser() user: AuthContext,
  ): Promise<WaFlow> {
    return this.flows.save(body, user);
  }

  @Put('flows/:id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(saveWaFlowSchema)) body: SaveWaFlowInput,
    @CurrentUser() user: AuthContext,
  ): Promise<WaFlow> {
    return this.flows.save(body, user, id);
  }

  @Delete('flows/:id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() user: AuthContext): Promise<void> {
    await this.flows.remove(id, user);
  }

  // === PLANTILLAS DE META ===
  // Viven en la WABA, no en nuestra base: aqui solo se leen, se crean y se
  // borran contra el proveedor.

  @Get('templates')
  async listTemplates(
    @CurrentUser() user: AuthContext,
    @Query('line') line?: string,
  ): Promise<WaTemplateListForLine> {
    return this.templates.list(line?.trim() || null, user);
  }

  @Post('templates')
  @HttpCode(201)
  async createTemplate(
    @Body(new ZodValidationPipe(createWaTemplateSchema)) body: CreateWaTemplateInput,
    @CurrentUser() user: AuthContext,
  ): Promise<WaTemplateDetail> {
    return this.templates.create(body, user);
  }

  /** El nombre va en la ruta: es la clave de la plantilla en Meta. */
  @Delete('templates/:name')
  @HttpCode(204)
  async removeTemplate(
    @Param('name') name: string,
    @CurrentUser() user: AuthContext,
    @Query('line') line?: string,
  ): Promise<void> {
    await this.templates.remove(line?.trim() || null, name, user);
  }
}
