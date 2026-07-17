import { Body, Controller, Get, Header, Param, Put, StreamableFile } from '@nestjs/common';
import {
  certificateTemplateSchema,
  type CertificateTemplate,
} from '@smartlogistica/shared';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import type { AuthContext } from '../../../common/types/authenticated-request';
import { WarrantyService } from './warranty.service';

/**
 * Plantilla del Certificado de Garantia por sede + el PDF de la ultima factura
 * (fondo del editor visual). Anidado bajo la sede.
 */
@Controller('warehouses/:warehouseId/certificate')
export class CertificateController {
  constructor(private readonly warranty: WarrantyService) {}

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
