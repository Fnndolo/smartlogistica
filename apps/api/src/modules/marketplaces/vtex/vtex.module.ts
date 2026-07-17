import { Module } from '@nestjs/common';

import { MktDocumentService } from './mkt-document.service';
import { VtexBackfillProcessor } from './processors/vtex-backfill.processor';
import { VtexReconcileProcessor } from './processors/vtex-reconcile.processor';
import { VtexWebhookProcessor } from './processors/vtex-webhook.processor';
import { VtexClient } from './vtex-client.service';
import { VtexOrderService } from './vtex-order.service';
import { VtexReconcileScheduler } from './vtex-reconcile.scheduler';
import { VtexWebhookRegistrar } from './vtex-webhook-registrar.service';

@Module({
  providers: [
    VtexClient,
    VtexOrderService,
    MktDocumentService,
    VtexBackfillProcessor,
    VtexWebhookProcessor,
    VtexReconcileProcessor,
    VtexReconcileScheduler,
    VtexWebhookRegistrar,
  ],
  exports: [VtexClient, VtexOrderService, MktDocumentService],
})
export class VtexModule {}
