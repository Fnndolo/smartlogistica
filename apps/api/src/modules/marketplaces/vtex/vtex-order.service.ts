import { Injectable, Logger } from '@nestjs/common';
import type { PrismaClient as TenantPrismaClient } from '.prisma/tenant-client';

import { applyRecentConfirmation } from '../../webhooks/confirmation-retro';
import { WhatsappService } from '../../whatsapp/whatsapp.service';
import { mapVtexOrderItems, mapVtexOrderToUpsert } from './vtex-order.mapper';
import type { VtexOrderDetail } from './vtex.types';

@Injectable()
export class VtexOrderService {
  private readonly logger = new Logger(VtexOrderService.name);

  constructor(private readonly whatsapp: WhatsappService) {}

  async upsertFromDetail(
    prisma: TenantPrismaClient,
    accountName: string,
    detail: VtexOrderDetail,
    /** Con tenantId, un pedido NUEVO dispara la confirmacion de WhatsApp. */
    tenantId?: string,
  ): Promise<void> {
    const { create, update } = mapVtexOrderToUpsert(accountName, detail);
    const items = mapVtexOrderItems(detail);
    // Producto "cabeza" (el primero alfabeticamente): columna denormalizada que
    // permite ORDENAR la tabla por producto. Los items viven en otra tabla y
    // Prisma no sabe ordenar el padre por una relacion 1:N.
    const primaryProduct =
      items.length > 0
        ? items.map((i) => i.name).sort((a, b) => a.localeCompare(b, 'es'))[0]
        : null;

    const { order, isNew } = await prisma.$transaction(async (tx) => {
      const existed = await tx.order.findUnique({
        where: { provider_externalId: { provider: 'vtex', externalId: detail.orderId } },
        select: { id: true },
      });
      const row = await tx.order.upsert({
        where: { provider_externalId: { provider: 'vtex', externalId: detail.orderId } },
        create: { ...create, primaryProduct, items: { create: items } },
        update: { ...update, primaryProduct },
      });

      // Replace items on update so quantity/price stay current
      await tx.orderItem.deleteMany({ where: { orderId: row.id } });
      if (items.length > 0) {
        await tx.orderItem.createMany({
          data: items.map((i) => ({ ...i, orderId: row.id })),
        });
      }
      return { order: row, isNew: !existed };
    });

    // CONFIRMACION por WhatsApp (reemplaza el "Confirmador de pedidos" de n8n):
    // solo pedidos NUEVOS; el service ademas exige ready-for-handling, telefono,
    // frescura (<48h) e idempotencia. Best-effort en background: la ingesta
    // jamas espera ni falla por WhatsApp.
    if (isNew && tenantId) {
      void this.whatsapp
        .sendOrderConfirmation(tenantId, prisma, order.id)
        .catch((err) =>
          this.logger.warn(
            `Confirmacion WA fallo para ${detail.orderId}: ${err instanceof Error ? err.message : err}`,
          ),
        );
    }

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
