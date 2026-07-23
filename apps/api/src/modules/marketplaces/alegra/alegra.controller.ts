import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import {
  alegraCredentialsSchema,
  saveSellerPrefSchema,
  type AlegraConnectionSummary,
  type AlegraCredentialsInput,
  type AlegraImeiMatch,
  type AlegraSeller,
  type AlegraSyncResult,
  type AlegraTestResult,
  type SaveSellerPrefInput,
} from '@smartlogistica/shared';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import type { AuthContext } from '../../../common/types/authenticated-request';
import { AlegraService } from './alegra.service';

/**
 * Conexion contable (Alegra) por sede. Anidado bajo la sede: la relacion es 1:1.
 *
 * NOTA: pipes a nivel de PARAMETRO (no @UsePipes), porque @CurrentUser es un
 * custom param decorator y @UsePipes a nivel de metodo le aplicaria el schema,
 * mutilando el AuthContext (perderia role -> isAdmin falla).
 */
@Controller('warehouses/:warehouseId/alegra')
export class AlegraController {
  constructor(private readonly alegra: AlegraService) {}

  @Get()
  async get(
    @Param('warehouseId') warehouseId: string,
    @CurrentUser() user: AuthContext,
  ): Promise<AlegraConnectionSummary | null> {
    return this.alegra.get(warehouseId, user);
  }

  @Post('test')
  @HttpCode(200)
  async test(
    @Param('warehouseId') warehouseId: string,
    @Body(new ZodValidationPipe(alegraCredentialsSchema)) body: AlegraCredentialsInput,
    @CurrentUser() user: AuthContext,
  ): Promise<AlegraTestResult> {
    return this.alegra.test(warehouseId, body, user);
  }

  @Put()
  async connect(
    @Param('warehouseId') warehouseId: string,
    @Body(new ZodValidationPipe(alegraCredentialsSchema)) body: AlegraCredentialsInput,
    @CurrentUser() user: AuthContext,
  ): Promise<AlegraConnectionSummary> {
    return this.alegra.connect(warehouseId, body, user);
  }

  @Delete()
  @HttpCode(204)
  async disconnect(
    @Param('warehouseId') warehouseId: string,
    @CurrentUser() user: AuthContext,
  ): Promise<void> {
    await this.alegra.disconnect(warehouseId, user);
  }

  /** Vendedores guardados en la cuenta Alegra de la sede (cualquier miembro). */
  @Get('sellers')
  async sellers(
    @Param('warehouseId') warehouseId: string,
    @CurrentUser() user: AuthContext,
  ): Promise<AlegraSeller[]> {
    return this.alegra.listSellers(warehouseId, user);
  }

  /** Vendedor elegido por el usuario ACTUAL en esta sede (null = sin vendedor). */
  @Get('seller')
  async sellerPref(
    @Param('warehouseId') warehouseId: string,
    @CurrentUser() user: AuthContext,
  ): Promise<{ seller: AlegraSeller | null }> {
    return { seller: await this.alegra.getSellerPref(warehouseId, user) };
  }

  /** Guarda (o limpia) el vendedor del usuario ACTUAL en esta sede. */
  @Put('seller')
  async saveSellerPref(
    @Param('warehouseId') warehouseId: string,
    @Body(new ZodValidationPipe(saveSellerPrefSchema)) body: SaveSellerPrefInput,
    @CurrentUser() user: AuthContext,
  ): Promise<{ seller: AlegraSeller | null }> {
    return { seller: await this.alegra.saveSellerPref(warehouseId, body.seller, user) };
  }

  /** Sincroniza las facturas de compra al indice por IMEI. Solo admin. */
  @Post('sync')
  @HttpCode(200)
  async sync(
    @Param('warehouseId') warehouseId: string,
    @CurrentUser() user: AuthContext,
  ): Promise<AlegraSyncResult> {
    return this.alegra.syncWarehouse(warehouseId, user);
  }

  /** Busca un IMEI en el indice -> factura de compra / producto / costo. */
  @Get('imei/:imei')
  async lookupImei(
    @Param('warehouseId') warehouseId: string,
    @Param('imei') imei: string,
    @CurrentUser() user: AuthContext,
  ): Promise<AlegraImeiMatch | null> {
    return this.alegra.lookupImei(warehouseId, imei, user);
  }
}
