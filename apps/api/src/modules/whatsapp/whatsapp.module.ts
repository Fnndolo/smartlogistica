import { Module } from '@nestjs/common';

import { Dialog360Client } from './dialog360-client.service';
import { WhatsappService } from './whatsapp.service';
import { Dialog360ConnectionController, OrderWhatsappController } from './whatsapp.controller';
import { Dialog360WebhookController } from './whatsapp-webhook.controller';

@Module({
  controllers: [Dialog360ConnectionController, OrderWhatsappController, Dialog360WebhookController],
  providers: [WhatsappService, Dialog360Client],
  exports: [WhatsappService],
})
export class WhatsappModule {}
