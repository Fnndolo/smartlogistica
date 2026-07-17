import { Module } from '@nestjs/common';

import { VtexModule } from '../marketplaces/vtex/vtex.module';
import { ConnectionsController } from './connections.controller';
import { ConnectionsService } from './connections.service';

@Module({
  imports: [VtexModule],
  controllers: [ConnectionsController],
  providers: [ConnectionsService],
})
export class ConnectionsModule {}
