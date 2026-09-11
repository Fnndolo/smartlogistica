import { Module } from '@nestjs/common';

import { AiModule } from '../../ai/ai.module';
import { WarehousesModule } from '../../warehouses/warehouses.module';
import { AlegraClient } from './alegra-client.service';
import { AlegraController } from './alegra.controller';
import { AlegraService } from './alegra.service';
import { CertificateController } from './certificate.controller';
import { ExternalCertificateService } from './external-certificate.service';
import { WarrantyService } from './warranty.service';

@Module({
  imports: [WarehousesModule, AiModule],
  controllers: [AlegraController, CertificateController],
  providers: [AlegraClient, AlegraService, WarrantyService, ExternalCertificateService],
  exports: [AlegraClient, AlegraService, WarrantyService, ExternalCertificateService],
})
export class AlegraModule {}
