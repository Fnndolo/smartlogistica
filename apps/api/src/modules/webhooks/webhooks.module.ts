import { Module } from '@nestjs/common';

import { VtexModule } from '../marketplaces/vtex/vtex.module';
import { AddressConfirmationService } from './address-confirmation.service';
import { ConfirmationWebhookController } from './confirmation-webhook.controller';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [VtexModule],
  controllers: [WebhooksController, ConfirmationWebhookController],
  providers: [AddressConfirmationService],
})
export class WebhooksModule {}
