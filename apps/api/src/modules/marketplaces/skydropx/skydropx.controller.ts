import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import {
  setSkydropxSedeConfigSchema,
  skydropxCredentialsSchema,
  type SetSkydropxSedeConfigInput,
  type SkydropxAddressTemplate,
  type SkydropxCity,
  type SkydropxConnectionSummary,
  type SkydropxCredentialsInput,
  type SkydropxPackaging,
  type SkydropxSedeConfig,
} from '@smartlogistica/shared';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import type { AuthContext } from '../../../common/types/authenticated-request';
import { searchCoCities } from './co-postal';
import { SkydropxService } from './skydropx.service';

/** Conexion GLOBAL a Skydropx (una por negocio; el remitente sale de cada sede).
 * OJO: fuera de 'connections/...' — el ConnectionsController generico tiene un
 * @Delete(':id') que se tragaria nuestro DELETE (id='skydropx' -> NotFound). */
@Controller('skydropx/connection')
export class SkydropxConnectionController {
  constructor(private readonly skydropx: SkydropxService) {}

  @Get()
  async get(@CurrentUser() user: AuthContext): Promise<SkydropxConnectionSummary | null> {
    return this.skydropx.summary(user);
  }

  @Post()
  @HttpCode(200)
  async connect(
    @Body(new ZodValidationPipe(skydropxCredentialsSchema)) body: SkydropxCredentialsInput,
    @CurrentUser() user: AuthContext,
  ): Promise<SkydropxConnectionSummary> {
    return this.skydropx.connect(body, user);
  }

  @Delete()
  @HttpCode(204)
  async disconnect(@CurrentUser() user: AuthContext): Promise<void> {
    await this.skydropx.disconnect(user);
  }
}

/** Recursos de Skydropx: direcciones guardadas, embalajes y remitente por sede. */
@Controller('skydropx')
export class SkydropxResourcesController {
  constructor(private readonly skydropx: SkydropxService) {}

  /** Direcciones guardadas en el panel de Skydropx (las 'from' verificadas
   *  son las que sirven de remitente). */
  @Get('address-templates')
  async addressTemplates(@CurrentUser() user: AuthContext): Promise<SkydropxAddressTemplate[]> {
    return this.skydropx.addressTemplates(user);
  }

  /** Catalogo de tipos de embalaje de Skydropx. */
  @Get('packagings')
  async packagings(@CurrentUser() user: AuthContext): Promise<SkydropxPackaging[]> {
    return this.skydropx.packagings(user);
  }

  /** Ciudades del catalogo postal nacional (embebido, con CP): la fuente del
   *  selector de ciudad en modo Skydropx — independiente de Coordinadora. */
  @Get('cities')
  cities(@Query('q') q?: string): SkydropxCity[] {
    return searchCoCities(q ?? '');
  }

  /** Remitente Skydropx fijado en una sede (null = sin fijar). */
  @Get('sede-config/:warehouseId')
  async sedeConfig(
    @Param('warehouseId') warehouseId: string,
    @CurrentUser() user: AuthContext,
  ): Promise<SkydropxSedeConfig | null> {
    return this.skydropx.sedeConfig(warehouseId, user);
  }

  /** Fija el remitente Skydropx de la sede. */
  @Put('sede-config/:warehouseId')
  async setSedeConfig(
    @Param('warehouseId') warehouseId: string,
    @Body(new ZodValidationPipe(setSkydropxSedeConfigSchema)) body: SetSkydropxSedeConfigInput,
    @CurrentUser() user: AuthContext,
  ): Promise<SkydropxSedeConfig> {
    return this.skydropx.setSedeConfig(warehouseId, body.addressTemplateId, user);
  }
}
