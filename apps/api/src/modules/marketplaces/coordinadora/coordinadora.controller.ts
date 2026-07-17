import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import {
  coordinadoraCitySearchSchema,
  coordinadoraConnectSchema,
  coordinadoraCredentialsSchema,
  type CoordinadoraCity,
  type CoordinadoraCitySearchInput,
  type CoordinadoraConnectInput,
  type CoordinadoraConnectionSummary,
  type CoordinadoraCredentialsInput,
  type CoordinadoraTestResult,
} from '@smartlogistica/shared';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import type { AuthContext } from '../../../common/types/authenticated-request';
import { CoordinadoraService } from './coordinadora.service';

/**
 * Conexion de envios (Coordinadora) por sede. Anidado bajo la sede (1:1), igual
 * que Alegra. Guarda credenciales + el ORIGEN (remitente) de la sede.
 *
 * NOTA: pipes a nivel de PARAMETRO (no @UsePipes) por el @CurrentUser custom.
 */
@Controller('warehouses/:warehouseId/coordinadora')
export class CoordinadoraController {
  constructor(private readonly coordinadora: CoordinadoraService) {}

  @Get()
  async get(
    @Param('warehouseId') warehouseId: string,
    @CurrentUser() user: AuthContext,
  ): Promise<CoordinadoraConnectionSummary | null> {
    return this.coordinadora.get(warehouseId, user);
  }

  @Post('test')
  @HttpCode(200)
  async test(
    @Param('warehouseId') warehouseId: string,
    @Body(new ZodValidationPipe(coordinadoraCredentialsSchema)) body: CoordinadoraCredentialsInput,
    @CurrentUser() user: AuthContext,
  ): Promise<CoordinadoraTestResult> {
    return this.coordinadora.test(warehouseId, body, user);
  }

  @Put()
  async connect(
    @Param('warehouseId') warehouseId: string,
    @Body(new ZodValidationPipe(coordinadoraConnectSchema)) body: CoordinadoraConnectInput,
    @CurrentUser() user: AuthContext,
  ): Promise<CoordinadoraConnectionSummary> {
    return this.coordinadora.connect(warehouseId, body, user);
  }

  @Delete()
  @HttpCode(204)
  async disconnect(
    @Param('warehouseId') warehouseId: string,
    @CurrentUser() user: AuthContext,
  ): Promise<void> {
    await this.coordinadora.disconnect(warehouseId, user);
  }

  /** Busca ciudades (codigo DANE) para el selector de ORIGEN del form. */
  @Post('cities')
  @HttpCode(200)
  async cities(
    @Param('warehouseId') warehouseId: string,
    @Body(new ZodValidationPipe(coordinadoraCitySearchSchema)) body: CoordinadoraCitySearchInput,
    @CurrentUser() user: AuthContext,
  ): Promise<CoordinadoraCity[]> {
    return this.coordinadora.searchCitiesWithCreds(warehouseId, body, user);
  }
}
