import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { AlegraModule } from '../marketplaces/alegra/alegra.module';
import { CoordinadoraModule } from '../marketplaces/coordinadora/coordinadora.module';
import { SkydropxModule } from '../marketplaces/skydropx/skydropx.module';
import { VtexModule } from '../marketplaces/vtex/vtex.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { DeliverySupportService } from './delivery-support.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PlatformsController } from './platforms.controller';
import { ShippingRefreshProcessor } from './shipping-refresh.processor';
import { ShippingRefreshScheduler } from './shipping-refresh.scheduler';
import { VtexFeesController } from './vtex-fees.controller';

@Module({
  imports: [
    WarehousesModule,
    AiModule,
    AlegraModule,
    CoordinadoraModule,
    VtexModule,
    WhatsappModule,
    SkydropxModule,
  ],
  controllers: [OrdersController, PlatformsController, VtexFeesController],
  providers: [
    OrdersService,
    DeliverySupportService,
    ShippingRefreshProcessor,
    ShippingRefreshScheduler,
  ],
})
export class OrdersModule {}
