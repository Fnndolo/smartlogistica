import { Module } from '@nestjs/common';

import { Dialog360Client } from './dialog360-client.service';
import { WhapifyClient } from './whapify-client.service';
import { WhatsappService } from './whatsapp.service';
import {
  Dialog360ConnectionController,
  OrderWhatsappController,
  WhapifyConnectionController,
} from './whatsapp.controller';
import { Dialog360WebhookController, WhatsappWebhookController } from './whatsapp-webhook.controller';

@Module({
  controllers: [
    WhapifyConnectionController,
    Dialog360ConnectionController,
    OrderWhatsappController,
    WhatsappWebhookController,
    Dialog360WebhookController,
  ],
  providers: [WhatsappService, WhapifyClient, Dialog360Client],
  exports: [WhatsappService],
})
export class WhatsappModule {}
