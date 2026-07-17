import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';

import { ControlPlaneService } from '../../infrastructure/prisma/control-plane.service';
import { TenantConnectionService } from '../../infrastructure/prisma/tenant-connection.service';
import { QUEUE_SHIPPING_REFRESH } from '../../infrastructure/queue/queue.module';
import { tenantContext } from '../../infrastructure/tenant-context';
import { OrdersService } from './orders.service';

/**
 * Tick de rastreo de envios "en tiempo real". Recorre TODOS los tenants ACTIVE y,
 * por cada sede que tenga pedidos con guia aun NO entregados, consulta el estado
 * en Coordinadora (por lotes) y actualiza la DB. Cuando algo cambia,
 * `refreshShippingForWarehouse` publica `orders.refresh` -> el SSE llega al
 * navegador y la lista de Facturados se actualiza sola, SIN el boton
 * "Actualizar envios" y sin que nadie tenga que estar en la pagina.
 *
 * Coordinadora NO nos notifica (es SOAP de solo consulta): "tiempo real" aqui =
 * poll periodico en el servidor + push por SSE. El intervalo lo fija
 * ShippingRefreshScheduler.
 */
@Processor(QUEUE_SHIPPING_REFRESH)
export class ShippingRefreshProcessor extends WorkerHost {
  private readonly logger = new Logger(ShippingRefreshProcessor.name);

  constructor(
    private readonly control: ControlPlaneService,
    private readonly tenants: TenantConnectionService,
    private readonly orders: OrdersService,
  ) {
    super();
  }

  async process(): Promise<{ tenants: number; warehouses: number; updated: number }> {
    const activeTenants = await this.control.tenant.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, slug: true },
    });

    let warehouses = 0;
    let updated = 0;

    for (const tenant of activeTenants) {
      try {
        const { client: prisma, slug } = await this.tenants.getForTenant(tenant.id);

        // Sedes con al menos un envio pendiente (guia y no entregado).
        const rows = await prisma.order.findMany({
          where: {
            warehouseId: { not: null },
            guideNumber: { not: null },
            // Incluye shippingState null (ver nota en refreshShippingForWarehouse):
            // esos son los que aun no se han rastreado y deben entrar al ciclo.
            OR: [{ shippingState: null }, { shippingState: { not: 'entregado' } }],
          },
          select: { warehouseId: true },
          distinct: ['warehouseId'],
        });
        const warehouseIds = rows.map((r) => r.warehouseId).filter((id): id is string => Boolean(id));
        if (warehouseIds.length === 0) continue;

        // El core usa getTenantContext() (y coordinadora tambien) -> envolvemos
        // cada sede en el contexto del tenant, igual que en una peticion HTTP.
        await tenantContext.run({ tenantId: tenant.id, tenantSlug: slug, prisma }, async () => {
          for (const warehouseId of warehouseIds) {
            warehouses++;
            try {
              const { updated: n } = await this.orders.refreshShippingForWarehouse(warehouseId);
              updated += n;
            } catch (err) {
              this.logger.warn(
                { err, tenant: tenant.slug, warehouseId },
                'Shipping refresh skipped warehouse (error)',
              );
            }
          }
        });
      } catch (err) {
        this.logger.warn({ err, tenant: tenant.slug }, 'Shipping refresh skipped tenant (error)');
      }
    }

    if (updated > 0) {
      this.logger.log(`Shipping refresh: ${updated} envio(s) actualizados en ${warehouses} sede(s)`);
    } else {
      this.logger.debug(
        `Shipping refresh: ${warehouses} sede(s) revisadas, sin cambios (${activeTenants.length} tenant/s)`,
      );
    }
    return { tenants: activeTenants.length, warehouses, updated };
  }
}
