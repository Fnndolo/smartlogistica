import { Injectable, Logger } from '@nestjs/common';
import type { PrismaClient as TenantPrismaClient } from '.prisma/tenant-client';

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

    await prisma.$transaction(async (tx) => {
      const order = await tx.order.upsert({
        where: { provider_externalId: { provider: 'vtex', externalId: detail.orderId } },
        create: { ...create, items: { create: items } },
        update,
      });

      // Replace items on update so quantity/price stay current
      await tx.orderItem.deleteMany({ where: { orderId: order.id } });
      if (items.length > 0) {
        await tx.orderItem.createMany({
          data: items.map((i) => ({ ...i, orderId: order.id })),
        });
      }
    });

    this.logger.debug(`Order upserted ${detail.orderId} (${detail.status})`);
  }
}
