import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { TenantConnectionService } from '../../../../infrastructure/prisma/tenant-connection.service';
import { QUEUE_VTEX_WEBHOOK } from '../../../../infrastructure/queue/queue.module';
import { RealtimeService } from '../../../../infrastructure/realtime/realtime.service';
import { VtexClient } from '../vtex-client.service';
import { VtexOrderService } from '../vtex-order.service';
import type { VtexWebhookPayload } from '../vtex.types';

export interface VtexWebhookJobData {
  tenantId: string;
  accountName: string;
  eventId: string;
  payload: VtexWebhookPayload;
}

@Processor(QUEUE_VTEX_WEBHOOK)
export class VtexWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(VtexWebhookProcessor.name);

  constructor(
    private readonly vtex: VtexClient,
    private readonly orders: VtexOrderService,
    private readonly tenants: TenantConnectionService,
    private readonly realtime: RealtimeService,
  ) {
    super();
  }

  async process(job: Job<VtexWebhookJobData>): Promise<{ skipped: true } | { processed: true }> {
    const { tenantId, accountName, eventId, payload } = job.data;
    const { client: prisma } = await this.tenants.getForTenant(tenantId);

    // Idempotencia atomica (exactly-once). Aunque BullMQ deduplica por jobId,
    // blindamos a nivel DB ante reintentos/redeliveries concurrentes:
    //   1) aseguramos que exista la fila (pending) sin pisar una ya procesada.
    //   2) "reclamamos" el evento con un updateMany condicional: solo UN job
    //      logra pasar de pending|failed -> processing (el row-lock serializa).
    // Si claim.count === 0, otro job ya lo proceso o lo esta procesando.
    await prisma.webhookEvent.upsert({
      where: { provider_eventId: { provider: 'vtex', eventId } },
      create: { provider: 'vtex', eventId, payload: payload as never, status: 'pending' },
      update: {},
    });

    const claim = await prisma.webhookEvent.updateMany({
      where: { provider: 'vtex', eventId, status: { in: ['pending', 'failed'] } },
      data: { status: 'processing', attempts: { increment: 1 } },
    });
    if (claim.count === 0) {
      return { skipped: true };
    }

    try {
      // Si el estado del webhook NO es relevante (el pedido salio de
      // "listo para preparar"), lo eliminamos de nuestra DB y avisamos en vivo.
      if (!VtexClient.isRelevantStatus(payload.State)) {
        await this.removeOrder(prisma, tenantId, payload.OrderId, payload.State);
        await this.markProcessed(prisma, eventId);
        return { processed: true };
      }

      // Estado relevante: traemos el detalle. Pero entre el webhook y este
      // getOrder el pedido pudo avanzar de nuevo, asi que re-validamos el
      // estado del detalle antes de upsert.
      const http = await this.vtex.forTenant(tenantId, accountName);
      const detail = await this.vtex.getOrder(http, payload.OrderId);

      if (!VtexClient.isRelevantStatus(detail.status)) {
        await this.removeOrder(prisma, tenantId, payload.OrderId, detail.status);
        await this.markProcessed(prisma, eventId);
        return { processed: true };
      }

      await this.orders.upsertFromDetail(prisma, accountName, detail);
      await this.realtime.publish(tenantId, { kind: 'order.upserted', externalId: payload.OrderId });
      this.logger.log(`Webhook upsert ${payload.OrderId} status=${detail.status}`);

      await this.markProcessed(prisma, eventId);
      return { processed: true };
    } catch (err) {
      this.logger.error({ err, eventId, orderId: payload.OrderId }, 'Webhook processing failed');
      await prisma.webhookEvent.update({
        where: { provider_eventId: { provider: 'vtex', eventId } },
        data: { status: 'failed', error: (err as Error).message?.slice(0, 1024) },
      });
      throw err; // Let BullMQ retry
    }
  }

  private async removeOrder(
    prisma: Parameters<VtexOrderService['upsertFromDetail']>[0],
    tenantId: string,
    externalId: string,
    newStatus: string,
  ): Promise<void> {
    const order = await prisma.order.findUnique({
      where: { provider_externalId: { provider: 'vtex', externalId } },
    });
    if (!order) return;

    // Si el pedido ya esta asignado a una sede, esta "reclamado": NO se borra.
    // Solo reflejamos el nuevo estado de VTEX para que la sede lo vea.
    if (order.warehouseId) {
      await prisma.order.update({ where: { id: order.id }, data: { status: newStatus } });
      await this.realtime.publish(tenantId, { kind: 'order.upserted', externalId });
      this.logger.log(`Webhook: ${externalId} -> ${newStatus} pero esta asignado (se conserva)`);
      return;
    }

    await prisma.order.delete({ where: { id: order.id } });
    await this.realtime.publish(tenantId, { kind: 'order.removed', externalId });
    this.logger.log(`Webhook removed ${externalId} (paso a status=${newStatus})`);
  }

  private async markProcessed(
    prisma: Parameters<VtexOrderService['upsertFromDetail']>[0],
    eventId: string,
  ): Promise<void> {
    await prisma.webhookEvent.update({
      where: { provider_eventId: { provider: 'vtex', eventId } },
      data: { status: 'processed', processedAt: new Date() },
    });
  }
}
