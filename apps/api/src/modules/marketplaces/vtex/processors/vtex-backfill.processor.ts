import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { AxiosInstance } from 'axios';
import { isAxiosError } from 'axios';

import { TenantConnectionService } from '../../../../infrastructure/prisma/tenant-connection.service';
import { QUEUE_VTEX_BACKFILL } from '../../../../infrastructure/queue/queue.module';
import { RealtimeService } from '../../../../infrastructure/realtime/realtime.service';
import { VTEX_RELEVANT_STATUSES } from '../vtex.constants';
import { VtexClient } from '../vtex-client.service';
import { VtexOrderService } from '../vtex-order.service';

export interface VtexBackfillJobData {
  tenantId: string;
  accountName: string;
}

const PER_PAGE = 100;
const MAX_RETRY_PER_ORDER = 5;

/**
 * Reconciliacion por conjuntos: deja nuestra DB como un MIRROR EXACTO de lo que
 * VTEX tiene actualmente en estado relevante (ready-for-handling).
 *
 *   1) Pide a VTEX la lista de IDs en ready-for-handling (paginado, barato).
 *   2) Inserta los IDs nuevos (trae detalle solo de los que no tenemos).
 *   3) BORRA de nuestra DB cualquier pedido cuyo ID ya NO aparezca en esa lista
 *      (cambio de estado en VTEX, posiblemente mientras el back estaba caido o
 *      antes de registrar el webhook). Esto es lo que mantiene el mirror exacto
 *      sin depender de que llegue un webhook.
 *
 * Corre tanto en la conexion inicial / "Sincronizar" como en la reconciliacion
 * periodica automatica (cada ~90s, ver ReconcileScheduler).
 */
@Processor(QUEUE_VTEX_BACKFILL)
export class VtexBackfillProcessor extends WorkerHost {
  private readonly logger = new Logger(VtexBackfillProcessor.name);

  constructor(
    private readonly vtex: VtexClient,
    private readonly orders: VtexOrderService,
    private readonly tenants: TenantConnectionService,
    private readonly realtime: RealtimeService,
  ) {
    super();
  }

  async process(job: Job<VtexBackfillJobData>): Promise<{ imported: number; removed: number }> {
    const { tenantId, accountName } = job.data;

    const { client: prisma } = await this.tenants.getForTenant(tenantId);
    const http = await this.vtex.forTenant(tenantId, accountName);

    // IDs que ya tenemos guardados para esta cuenta (para no re-pedir detalle).
    const existing = await prisma.order.findMany({
      where: { provider: 'vtex', accountName },
      select: { externalId: true },
    });
    const existingIds = new Set(existing.map((o) => o.externalId));

    // 1) Recolectar el conjunto vivo de IDs en estados relevantes desde VTEX.
    const listedIds = new Set<string>();
    let imported = 0;
    for (const status of VTEX_RELEVANT_STATUSES) {
      let page = 1;
      while (true) {
        const response = await withRetry(() =>
          this.vtex.listOrders(http, { status, page, perPage: PER_PAGE }),
        );
        const items = response.list ?? [];
        for (const item of items) {
          listedIds.add(item.orderId);
          // 2) Solo traemos detalle de los que aun no tenemos (los conocidos se
          // mantienen; sus cambios llegan por webhook).
          if (!existingIds.has(item.orderId)) {
            const ok = await this.importNew(http, prisma, tenantId, accountName, item.orderId);
            if (ok) imported++;
          }
        }
        await job.updateProgress({ status, page, imported });
        if (items.length < PER_PAGE) break;
        page++;
      }
    }

    // 3) Borrar lo que VTEX ya NO lista como relevante (cambio de estado).
    const removed = await this.removeStale(prisma, tenantId, accountName, listedIds);

    await prisma.marketplaceConnection.update({
      where: { provider_accountName: { provider: 'vtex', accountName } },
      data: { lastSyncedAt: new Date(), lastError: null },
    });

    this.logger.log(
      `Reconcile done account=${accountName} listed=${listedIds.size} imported=${imported} removed=${removed}`,
    );
    return { imported, removed };
  }

  /** Trae detalle e inserta un pedido nuevo. Devuelve true si quedo guardado. */
  private async importNew(
    http: AxiosInstance,
    prisma: Parameters<VtexOrderService['upsertFromDetail']>[0],
    tenantId: string,
    accountName: string,
    orderId: string,
  ): Promise<boolean> {
    try {
      const detail = await withRetry(() => this.vtex.getOrder(http, orderId), MAX_RETRY_PER_ORDER);
      // Race: pudo avanzar entre el list y el getOrder.
      if (!VtexClient.isRelevantStatus(detail.status)) {
        return false;
      }
      await this.orders.upsertFromDetail(prisma, accountName, detail);
      await this.realtime.publish(tenantId, { kind: 'order.upserted', externalId: orderId });
      return true;
    } catch (err) {
      this.logger.warn({ err: extractAxiosErr(err), orderId }, 'importNew failed — continuing');
      return false;
    }
  }

  /** Borra los pedidos cuyo ID ya no esta en el conjunto vivo de VTEX. */
  private async removeStale(
    prisma: Parameters<VtexOrderService['upsertFromDetail']>[0],
    tenantId: string,
    accountName: string,
    listedIds: Set<string>,
  ): Promise<number> {
    const ids = [...listedIds];
    // CRITICO: solo podamos pedidos SIN asignar (warehouseId null). Los pedidos
    // ya asignados a una sede estan "reclamados" y tienen ciclo propio — no se
    // borran aunque VTEX ya no los liste como ready-for-handling.
    const base = { provider: 'vtex', accountName, warehouseId: null } as const;
    const where = ids.length === 0 ? base : { ...base, externalId: { notIn: ids } };

    const stale = await prisma.order.findMany({ where, select: { externalId: true } });
    if (stale.length === 0) return 0;

    await prisma.order.deleteMany({ where });
    for (const s of stale) {
      await this.realtime.publish(tenantId, { kind: 'order.removed', externalId: s.externalId });
    }
    this.logger.log(`Removed ${stale.length} stale order(s) for account=${accountName}`);
    return stale.length;
  }
}

function extractAxiosErr(err: unknown): unknown {
  if (isAxiosError(err)) {
    return {
      isAxios: true,
      status: err.response?.status,
      statusText: err.response?.statusText,
      url: err.config?.url,
      data: err.response?.data,
      message: err.message,
    };
  }
  return err;
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 5, attempt = 0): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (attempt >= maxAttempts - 1) throw err;
    if (isAxiosError(err)) {
      const status = err.response?.status;
      const retryable = !status || status === 429 || (status >= 500 && status < 600);
      if (!retryable) throw err;
    }
    const delay = Math.min(2 ** attempt * 1000 + Math.random() * 500, 30_000);
    await new Promise((r) => setTimeout(r, delay));
    return withRetry(fn, maxAttempts, attempt + 1);
  }
}
