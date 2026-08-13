import { Module } from '@nestjs/common';

import { WhapifyClient } from './whapify-client.service';
import { WhatsappService } from './whatsapp.service';
import { OrderWhatsappController, WhapifyConnectionController } from './whatsapp.controller';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

@Module({
  controllers: [WhapifyConnectionController, OrderWhatsappController, WhatsappWebhookController],
  providers: [WhatsappService, WhapifyClient],
  exports: [WhatsappService],
})
export class WhatsappModule {}
