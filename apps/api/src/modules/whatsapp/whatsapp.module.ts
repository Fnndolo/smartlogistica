import { Module } from '@nestjs/common';

import { Dialog360Client } from './dialog360-client.service';
import { WaConnectionService } from './wa-connection.service';
import { WaPublisherService } from './wa-publisher.service';
import { WhatsappService } from './whatsapp.service';
import { WhatsappWebhookService } from './whatsapp-webhook.service';
import {
  Dialog360ConnectionController,
  OrderWhatsappController,
  WhatsappInboxController,
} from './whatsapp.controller';
import { Dialog360WebhookController } from './whatsapp-webhook.controller';

@Module({
  controllers: [
    Dialog360ConnectionController,
    WhatsappInboxController,
    OrderWhatsappController,
    Dialog360WebhookController,
  ],
  providers: [
    WhatsappService,
    WhatsappWebhookService,
    WaPublisherService,
    WaConnectionService,
    Dialog360Client,
  ],
  exports: [WhatsappService],
})
export class WhatsappModule {}
