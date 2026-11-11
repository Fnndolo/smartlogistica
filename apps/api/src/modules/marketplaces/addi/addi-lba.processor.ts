import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { ControlPlaneService } from '../../../infrastructure/prisma/control-plane.service';
import { TenantConnectionService } from '../../../infrastructure/prisma/tenant-connection.service';
import { QUEUE_ADDI_LBA } from '../../../infrastructure/queue/queue.module';
import { tenantContext } from '../../../infrastructure/tenant-context';
import { AddiLbaService } from './addi-lba.service';

/**
 * Trabajos de GUIAS DE ADDI:
 *  - 'apply' {tenantId, orderIds}: recien asignados/transferidos -> cambiar
 *    remitente ya (lo encola OrdersService.assign via AddiLbaService).
 *  - 'tick' (periodico): por cada tenant con conexion, sincroniza guias desde
 *    el portal de Addi y aplica los cambios de remitente pendientes.
 * El worker procesa de a uno: un tick y un 'apply' nunca se pisan.
 */
@Processor(QUEUE_ADDI_LBA)
export class AddiLbaProcessor extends WorkerHost {
  private readonly logger = new Logger(AddiLbaProcessor.name);

  constructor(
    private readonly control: ControlPlaneService,
    private readonly tenants: TenantConnectionService,
    private readonly addi: AddiLbaService,
  ) {
    super();
  }

  async process(job: Job<{ tenantId?: string; orderIds?: string[] }>): Promise<unknown> {
    if (job.name === 'apply') {
      const { tenantId, orderIds } = job.data;
      if (!tenantId || !orderIds?.length) return { applied: 0 };
      const { client: prisma, slug } = await this.tenants.getForTenant(tenantId);
      let applied = 0;
      await tenantContext.run({ tenantId, tenantSlug: slug, prisma }, async () => {
        for (const id of orderIds) {
          if (await this.addi.applySender(id).catch(() => false)) applied++;
        }
      });
      return { applied };
    }

    const active = await this.control.tenant.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, slug: true },
    });
    let synced = 0;
    let applied = 0;
    for (const t of active) {
      try {
        const { client: prisma, slug } = await this.tenants.getForTenant(t.id);
        const has = await prisma.addiLbaConnection.count();
        if (!has) continue;
        await tenantContext.run({ tenantId: t.id, tenantSlug: slug, prisma }, async () => {
          try {
            const r = await this.addi.syncTenant();
            synced += r.updated;
          } catch (err) {
            this.logger.warn(
              `Guias de Addi: sincronizacion fallida (${t.slug}): ${(err as Error).message}`,
            );
          }
          const p = await this.addi.processPending();
          applied += p.applied;
        });
      } catch (err) {
        this.logger.warn(`Guias de Addi: tenant ${t.slug} omitido: ${(err as Error).message}`);
      }
    }
    return { synced, applied };
  }
}
