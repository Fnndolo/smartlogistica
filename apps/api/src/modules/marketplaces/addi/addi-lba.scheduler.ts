import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import { QUEUE_ADDI_LBA } from '../../../infrastructure/queue/queue.module';

/**
 * Ciclo de GUIAS DE ADDI cada 5 min por defecto: Addi crea la guia unos
 * minutos despues del pedido y el portal no avisa (no hay webhook), asi que se
 * consulta. Son ~6 paginas de 25 por vuelta. ADDI_LBA_SYNC_MS ajusta; 0 apaga.
 */
const DEFAULT_MS = 5 * 60_000;
const REPEAT_JOB_ID = 'addi-lba-tick';

@Injectable()
export class AddiLbaScheduler implements OnModuleInit {
  private readonly logger = new Logger(AddiLbaScheduler.name);

  constructor(
    @InjectQueue(QUEUE_ADDI_LBA) private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const ms = Number(this.config.get<string>('ADDI_LBA_SYNC_MS') ?? DEFAULT_MS);
    const existing = await this.queue.getRepeatableJobs().catch(() => []);
    for (const r of existing) await this.queue.removeRepeatableByKey(r.key).catch(() => null);
    if (!ms || ms <= 0) {
      this.logger.warn('Guias de Addi: ciclo periodico DESACTIVADO (ADDI_LBA_SYNC_MS<=0)');
      return;
    }
    await this.queue.add(
      'tick',
      {},
      {
        repeat: { every: ms },
        jobId: REPEAT_JOB_ID,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    this.logger.log(`Guias de Addi: ciclo cada ${ms}ms`);
  }
}
