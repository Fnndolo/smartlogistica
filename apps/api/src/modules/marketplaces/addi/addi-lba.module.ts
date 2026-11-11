import { Module } from '@nestjs/common';

import { WarehousesModule } from '../../warehouses/warehouses.module';
import { AddiGuideController, AddiLbaController } from './addi-lba.controller';
import { AddiLbaProcessor } from './addi-lba.processor';
import { AddiLbaService } from './addi-lba.service';
import { AddiPortalClient } from './addi-portal-client.service';
import { CoordinadoraSuiteClient } from './coordinadora-suite-client.service';

@Module({
  imports: [WarehousesModule],
  controllers: [AddiLbaController, AddiGuideController],
  providers: [AddiPortalClient, CoordinadoraSuiteClient, AddiLbaService, AddiLbaProcessor],
  exports: [AddiLbaService],
})
export class AddiLbaModule {}
