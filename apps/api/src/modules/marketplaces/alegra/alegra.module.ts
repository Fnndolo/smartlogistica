import { Module } from '@nestjs/common';

import { AiModule } from '../../ai/ai.module';
import { WarehousesModule } from '../../warehouses/warehouses.module';
import { AlegraClient } from './alegra-client.service';
import { AlegraController } from './alegra.controller';
import { AlegraService } from './alegra.service';
import { CertificateController } from './certificate.controller';
import { WarrantyService } from './warranty.service';

@Module({
  imports: [WarehousesModule, AiModule],
  controllers: [AlegraController, CertificateController],
  providers: [AlegraClient, AlegraService, WarrantyService],
  exports: [AlegraClient, AlegraService, WarrantyService],
})
export class AlegraModule {}
