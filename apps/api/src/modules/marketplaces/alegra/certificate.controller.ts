import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Put,
  StreamableFile,
} from '@nestjs/common';
import {
  certificateModeSchema,
  certificateTemplateSchema,
  externalCertificateSaveSchema,
  type CertificateMode,
  type CertificateTemplate,
  type ExternalCertificateSave,
  type ExternalCertificateSummary,
} from '@smartlogistica/shared';
import { z } from 'zod';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import type { AuthContext } from '../../../common/types/authenticated-request';
import { ExternalCertificateService } from './external-certificate.service';
import { WarrantyService } from './warranty.service';

const modeBodySchema = z.object({ mode: certificateModeSchema });

/**
 * Plantilla del Certificado de Garantia por sede + el PDF de la ultima factura
 * (fondo del editor visual). Anidado bajo la sede.
 */
@Controller('warehouses/:warehouseId/certificate')
export class CertificateController {
  constructor(
    private readonly warranty: WarrantyService,
    private readonly external: ExternalCertificateService,
  ) {}

  /** Modo actual: plantilla, desactivado o emisor externo. */
  @Get('mode')
  async getMode(
    @Param('warehouseId') warehouseId: string,
  ): Promise<{ mode: CertificateMode }> {
    return { mode: await this.warranty.modeFor(warehouseId) };
  }

  @Put('mode')
  async setMode(
    @Param('warehouseId') warehouseId: string,
    @Body(new ZodValidationPipe(modeBodySchema)) body: { mode: CertificateMode },
    @CurrentUser() user: AuthContext,
  ): Promise<{ mode: CertificateMode }> {
    return this.warranty.setMode(warehouseId, body.mode, user);
  }

  // === Emisor externo ===

  @Get('external')
  async getExternal(
    @Param('warehouseId') warehouseId: string,
    @CurrentUser() user: AuthContext,
  ): Promise<ExternalCertificateSummary | null> {
    return this.external.getConfig(warehouseId, user);
  }

  @Put('external')
  async saveExternal(
    @Param('warehouseId') warehouseId: string,
    @Body(new ZodValidationPipe(externalCertificateSaveSchema)) body: ExternalCertificateSave,
    @CurrentUser() user: AuthContext,
  ): Promise<ExternalCertificateSummary> {
    return this.external.saveConfig(warehouseId, body, user);
  }

  @Delete('external')
  async deleteExternal(
    @Param('warehouseId') warehouseId: string,
    @CurrentUser() user: AuthContext,
  ): Promise<{ ok: true }> {
    await this.external.deleteConfig(warehouseId, user);
    return { ok: true };
  }

  /** Prueba la conexion sin emitir nada y trae los medios de pago validos. */
  @Post('external/test')
  async testExternal(
    @Param('warehouseId') warehouseId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.external.test(warehouseId, user);
  }

  @Get('template')
  async getTemplate(
    @Param('warehouseId') warehouseId: string,
    @CurrentUser() user: AuthContext,
  ): Promise<CertificateTemplate | null> {
    return this.warranty.getTemplate(warehouseId, user);
  }

  @Put('template')
  async saveTemplate(
    @Param('warehouseId') warehouseId: string,
    @Body(new ZodValidationPipe(certificateTemplateSchema)) body: CertificateTemplate,
    @CurrentUser() user: AuthContext,
  ): Promise<CertificateTemplate> {
    return this.warranty.saveTemplate(warehouseId, body, user);
  }

  /** PDF de la ultima factura de Alegra de la sede (fondo del editor). */
  @Get('invoice-pdf')
  @Header('Content-Type', 'application/pdf')
  async invoicePdf(
    @Param('warehouseId') warehouseId: string,
    @CurrentUser() user: AuthContext,
  ): Promise<StreamableFile> {
    const pdf = await this.warranty.getEditorInvoicePdf(warehouseId, user);
    return new StreamableFile(pdf, { type: 'application/pdf' });
  }
}
