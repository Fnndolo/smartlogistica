import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import { QUEUE_SHIPPING_REFRESH } from '../../infrastructure/queue/queue.module';

/**
 * Poll de Coordinadora cada 2 minutos por defecto. Los envios no cambian de
 * segundo a segundo (Coordinadora escanea unas pocas veces al dia), asi que un
 * intervalo corto no aporta y solo golpea su SOAP; 2 min da la sensacion de
 * "tiempo real" sin abusar. Ajustable con SHIPPING_REFRESH_MS; 0 lo desactiva.
 */
const DEFAULT_SHIPPING_REFRESH_MS = 120_000;
const REPEAT_JOB_ID = 'shipping-refresh-tick';

@Injectable()
export class ShippingRefreshScheduler implements OnModuleInit {
  private readonly logger = new Logger(ShippingRefreshScheduler.name);

  constructor(
    @InjectQueue(QUEUE_SHIPPING_REFRESH) private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const ms = Number(this.config.get<string>('SHIPPING_REFRESH_MS') ?? DEFAULT_SHIPPING_REFRESH_MS);

    // Limpiar repeatables previos (evita acumulacion al cambiar el intervalo).
    const existing = await this.queue.getRepeatableJobs().catch(() => []);
    for (const r of existing) {
      await this.queue.removeRepeatableByKey(r.key).catch(() => null);
    }

    if (!ms || ms <= 0) {
      this.logger.warn('Rastreo de envios periodico DESACTIVADO (SHIPPING_REFRESH_MS<=0)');
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
    this.logger.log(`Rastreo de envios programado cada ${ms}ms`);
  }
}
