import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import { QUEUE_VTEX_RECONCILE } from '../../../infrastructure/queue/queue.module';

const DEFAULT_RECONCILE_MS = 60_000; // 60s — red de seguridad; el webhook da lo instantaneo
const REPEAT_JOB_ID = 'vtex-reconcile-tick';

/**
 * Registra el job repetible que dispara la reconciliacion periodica. BullMQ
 * deduplica el schedule por su repeat-key, asi que es seguro en multiples
 * replicas. Limpiamos schedules viejos en el arranque para que un cambio de
 * intervalo no deje varios corriendo.
 *
 * Desactivable con REALTIME_RECONCILE_MS=0.
 */
@Injectable()
export class VtexReconcileScheduler implements OnModuleInit {
  private readonly logger = new Logger(VtexReconcileScheduler.name);

  constructor(
    @InjectQueue(QUEUE_VTEX_RECONCILE) private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const ms = Number(this.config.get<string>('REALTIME_RECONCILE_MS') ?? DEFAULT_RECONCILE_MS);

    // Limpiar repeatables previos (evita acumulacion al cambiar el intervalo).
    const existing = await this.queue.getRepeatableJobs().catch(() => []);
    for (const r of existing) {
      await this.queue.removeRepeatableByKey(r.key).catch(() => null);
    }

    if (!ms || ms <= 0) {
      this.logger.warn('Reconciliacion periodica DESACTIVADA (REALTIME_RECONCILE_MS<=0)');
      return;
    }

    await this.queue.add(
      'tick',
      {},
      {
        repeat: { every: ms },
        jobId: REPEAT_JOB_ID,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    this.logger.log(`Reconciliacion periodica programada cada ${ms}ms`);
  }
}
