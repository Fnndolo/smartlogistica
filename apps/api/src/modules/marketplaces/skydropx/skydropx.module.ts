import { Module } from '@nestjs/common';

import { DispatchRelationService } from './dispatch-relation.service';
import { SkydropxClient } from './skydropx-client.service';
import { SkydropxConnectionController, SkydropxResourcesController } from './skydropx.controller';
import { SkydropxService } from './skydropx.service';

@Module({
  controllers: [SkydropxConnectionController, SkydropxResourcesController],
  providers: [SkydropxClient, SkydropxService, DispatchRelationService],
  exports: [SkydropxService, DispatchRelationService],
})
export class SkydropxModule {}
