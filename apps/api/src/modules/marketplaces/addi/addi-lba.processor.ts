import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { TenantConnectionService } from '../../../infrastructure/prisma/tenant-connection.service';
import { QUEUE_ADDI_LBA } from '../../../infrastructure/queue/queue.module';
import { tenantContext } from '../../../infrastructure/tenant-context';
import { AddiLbaService } from './addi-lba.service';

interface AddiJob {
  tenantId?: string;
  orderIds?: string[];
  orderId?: string;
  attempt?: number;
}

/**
 * Trabajos de GUIAS DE ADDI. Todos son de UN pedido (o un lote recien
 * transferido); NO hay ciclo periodico:
 *  - 'apply'  {tenantId, orderIds, attempt}: cambiar el remitente al de la
 *    sede (al transferir, o reintento ante un fallo pasajero).
 *  - 'lookup' {tenantId, orderId, attempt}: la guia no estaba al llegar el
 *    pedido (Addi caido/lento): se busca de nuevo solo esa.
 * Hasta 4 trabajos a la vez; el mismo pedido nunca dos veces (candado).
 */
// Varios pedidos a la vez (cada uno con su candado): transferir un lote no
// pone los rotulos en fila.
@Processor(QUEUE_ADDI_LBA, { concurrency: 4 })
export class AddiLbaProcessor extends WorkerHost {
  private readonly logger = new Logger(AddiLbaProcessor.name);

  constructor(
    private readonly tenants: TenantConnectionService,
    private readonly addi: AddiLbaService,
  ) {
    super();
  }

  async process(job: Job<AddiJob>): Promise<unknown> {
    const { tenantId } = job.data;
    // 'tick' era el ciclo de 5 min de la primera version: si quedo alguno en
    // cola, se descarta.
    if (!tenantId || (job.name !== 'apply' && job.name !== 'lookup')) return { ignored: true };
    const { client: prisma, slug } = await this.tenants.getForTenant(tenantId);
    return tenantContext.run({ tenantId, tenantSlug: slug, prisma }, async () => {
      if (job.name === 'lookup') {
        if (job.data.orderId) {
          await this.addi
            .retryLookup(job.data.orderId, job.data.attempt ?? 0)
            .catch((err) => this.logger.warn(`Busqueda de guia de Addi fallo: ${err.message}`));
        }
        return { done: true };
      }
      let applied = 0;
      for (const id of job.data.orderIds ?? []) {
        if (await this.addi.applySender(id, undefined, job.data.attempt ?? 0).catch(() => false)) {
          applied++;
        }
      }
      return { applied };
    });
  }
}
