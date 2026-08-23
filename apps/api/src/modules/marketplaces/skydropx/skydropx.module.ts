import { Module } from '@nestjs/common';

import { SkydropxClient } from './skydropx-client.service';
import { SkydropxConnectionController, SkydropxResourcesController } from './skydropx.controller';
import { SkydropxService } from './skydropx.service';

@Module({
  controllers: [SkydropxConnectionController, SkydropxResourcesController],
  providers: [SkydropxClient, SkydropxService],
  exports: [SkydropxService],
})
export class SkydropxModule {}
