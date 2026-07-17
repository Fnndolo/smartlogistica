import { Module } from '@nestjs/common';

import { WarehousesModule } from '../../warehouses/warehouses.module';
import { CoordinadoraClient } from './coordinadora-client.service';
import { CoordinadoraController } from './coordinadora.controller';
import { CoordinadoraService } from './coordinadora.service';

@Module({
  imports: [WarehousesModule],
  controllers: [CoordinadoraController],
  providers: [CoordinadoraClient, CoordinadoraService],
  exports: [CoordinadoraService],
})
export class CoordinadoraModule {}
