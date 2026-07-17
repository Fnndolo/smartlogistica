import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { AlegraModule } from '../marketplaces/alegra/alegra.module';
import { CoordinadoraModule } from '../marketplaces/coordinadora/coordinadora.module';
import { VtexModule } from '../marketplaces/vtex/vtex.module';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { ShippingRefreshProcessor } from './shipping-refresh.processor';
import { ShippingRefreshScheduler } from './shipping-refresh.scheduler';

@Module({
  imports: [WarehousesModule, AiModule, AlegraModule, CoordinadoraModule, VtexModule],
  controllers: [OrdersController],
  providers: [OrdersService, ShippingRefreshProcessor, ShippingRefreshScheduler],
})
export class OrdersModule {}
