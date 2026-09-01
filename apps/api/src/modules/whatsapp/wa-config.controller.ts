import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import {
  saveWaFlowSchema,
  type SaveWaFlowInput,
  type WaConfigOverview,
  type WaFlow,
} from '@smartlogistica/shared';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthContext } from '../../common/types/authenticated-request';
import { WaFlowService } from './wa-flow.service';

/**
 * CONFIGURACION de WhatsApp: las lineas conectadas y los mensajes automaticos.
 *
 * Leer lo puede cualquiera que use WhatsApp (para entender por que sale o no
 * sale un mensaje); cambiarlo, solo administradores — el gate vive en el
 * servicio, como en el resto del modulo.
 */
@Controller('whatsapp/config')
export class WaConfigController {
  constructor(private readonly flows: WaFlowService) {}

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
}
