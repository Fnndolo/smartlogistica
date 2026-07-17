import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { ControlPlaneService } from '../../../../infrastructure/prisma/control-plane.service';
import { TenantConnectionService } from '../../../../infrastructure/prisma/tenant-connection.service';
import {
  QUEUE_VTEX_BACKFILL,
  QUEUE_VTEX_RECONCILE,
} from '../../../../infrastructure/queue/queue.module';
import { enqueueVtexBackfill } from '../vtex-backfill.enqueue';

/**
 * Tick periodico de reconciliacion. Recorre TODOS los tenants ACTIVE y, por cada
 * conexion VTEX, encola un backfill (que es una reconciliacion por conjuntos).
 * Esto mantiene la DB como mirror de VTEX automaticamente mientras el back corre,
 * SIN que nadie tenga que estar en la pagina ni pulsar "Sincronizar".
 *
 * Los webhooks dan lo instantaneo; este tick es la red de seguridad para cambios
 * perdidos (back caido, antes de registrar el webhook, fallos de entrega).
 */
@Processor(QUEUE_VTEX_RECONCILE)
export class VtexReconcileProcessor extends WorkerHost {
  private readonly logger = new Logger(VtexReconcileProcessor.name);

  constructor(
    private readonly control: ControlPlaneService,
    private readonly tenants: TenantConnectionService,
    @InjectQueue(QUEUE_VTEX_BACKFILL) private readonly backfillQueue: Queue,
  ) {
    super();
  }

  async process(): Promise<{ tenants: number; connections: number }> {
    const activeTenants = await this.control.tenant.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, slug: true },
    });

    let connections = 0;
    for (const tenant of activeTenants) {
      try {
        const { client } = await this.tenants.getForTenant(tenant.id);
        const conns = await client.marketplaceConnection.findMany({
          where: { provider: 'vtex', status: 'connected' },
          select: { accountName: true },
        });
        for (const conn of conns) {
          await enqueueVtexBackfill(this.backfillQueue, tenant.id, conn.accountName);
          connections++;
        }
      } catch (err) {
        this.logger.warn({ err, tenant: tenant.slug }, 'Reconcile skipped tenant (error)');
      }
    }

    return { tenants: activeTenants.length, connections };
  }
}
