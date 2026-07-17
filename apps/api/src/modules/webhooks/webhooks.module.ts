import { Module } from '@nestjs/common';

import { VtexModule } from '../marketplaces/vtex/vtex.module';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [VtexModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
