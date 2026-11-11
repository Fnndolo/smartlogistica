import { Injectable, Logger } from '@nestjs/common';
import type { PrismaClient as TenantPrismaClient } from '.prisma/tenant-client';

import { applyRecentConfirmation } from '../../webhooks/confirmation-retro';
import { WhatsappService } from '../../whatsapp/whatsapp.service';
import { AddiLbaService, isLbaOrder, type AddiIngestGuide } from '../addi/addi-lba.service';
import { mapVtexOrderItems, mapVtexOrderToUpsert } from './vtex-order.mapper';
import type { VtexOrderDetail } from './vtex.types';

@Injectable()
export class VtexOrderService {
  private readonly logger = new Logger(VtexOrderService.name);

  constructor(
    private readonly whatsapp: WhatsappService,
    private readonly addi: AddiLbaService,
  ) {}

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

    const key = {
      provider_accountName_externalId: {
        provider: 'vtex',
        accountName,
        externalId: detail.orderId,
      },
    };

    // GUIA DE ADDI, ANTES de guardar (y por tanto de mostrar) el pedido: cuando
    // VTEX lo suelta en ready-for-handling (~30 min despues de creado), Addi ya
    // genero la guia. Solo para pedidos que aun no la tienen; el pedido nunca
    // espera mas de unos segundos ni falla por Addi.
    const lba = isLbaOrder(detail);
    let addi: AddiIngestGuide | null = null;
    let missing = false;
    if (tenantId && detail.status === 'ready-for-handling') {
      const known = await prisma.order.findUnique({ where: key, select: { addiGuide: true } });
      if (!known || (!known.addiGuide && lba)) {
        const found = await this.addi.lookupAtIngest(tenantId, prisma, detail.orderId);
        if (found && found !== 'off') addi = found;
        // Solo un LBA "debe" tener guia: si no aparecio, se reintenta ese pedido.
        else missing = found === null && lba;
      }
    }
    const addiData = addi ? { addiGuide: addi.addiGuide, addiShipment: addi.addiShipment } : {};

    const { order, isNew } = await prisma.$transaction(async (tx) => {
      const existed = await tx.order.findUnique({ where: key, select: { id: true } });
      const row = await tx.order.upsert({
        where: key,
        create: { ...create, primaryProduct, ...addiData, items: { create: items } },
        update: { ...update, primaryProduct, ...addiData },
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

    if (missing && tenantId) void this.addi.scheduleLookup(tenantId, order.id, 0);

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

    this.logger.debug(
      `Order upserted ${detail.orderId} (${detail.status})${addi ? ` guia Addi ${addi.addiGuide}` : ''}`,
    );
  }
}
