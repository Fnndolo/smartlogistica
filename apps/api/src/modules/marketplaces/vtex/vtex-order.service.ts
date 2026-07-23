import { Injectable, Logger } from '@nestjs/common';
import type { PrismaClient as TenantPrismaClient } from '.prisma/tenant-client';

import { applyRecentConfirmation } from '../../webhooks/confirmation-retro';
import { mapVtexOrderItems, mapVtexOrderToUpsert } from './vtex-order.mapper';
import type { VtexOrderDetail } from './vtex.types';

@Injectable()
export class VtexOrderService {
  private readonly logger = new Logger(VtexOrderService.name);

  async upsertFromDetail(
    prisma: TenantPrismaClient,
    accountName: string,
    detail: VtexOrderDetail,
  ): Promise<void> {
    const { create, update } = mapVtexOrderToUpsert(accountName, detail);
    const items = mapVtexOrderItems(detail);

    const order = await prisma.$transaction(async (tx) => {
      const row = await tx.order.upsert({
        where: { provider_externalId: { provider: 'vtex', externalId: detail.orderId } },
        create: { ...create, items: { create: items } },
        update,
      });

      // Replace items on update so quantity/price stay current
      await tx.orderItem.deleteMany({ where: { orderId: row.id } });
      if (items.length > 0) {
        await tx.orderItem.createMany({
          data: items.map((i) => ({ ...i, orderId: row.id })),
        });
      }
      return row;
    });

    // Confirmacion de direccion que llego ANTES de que el pedido existiera aca
    // (cliente rapido + VTEX soltando el pedido con retraso): aplicarla ahora.
    // Nunca puede tumbar la ingestion.
    try {
      const applied = await applyRecentConfirmation(prisma, order);
      if (applied) {
        this.logger.log(`Confirmacion retroactiva aplicada al pedido ${detail.orderId}`);
      }
    } catch (err) {
      this.logger.warn(
        `Retro-confirmacion fallo para ${detail.orderId}: ${err instanceof Error ? err.message : err}`,
      );
    }

    this.logger.debug(`Order upserted ${detail.orderId} (${detail.status})`);
  }
}
