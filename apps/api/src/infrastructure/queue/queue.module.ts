import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

export const QUEUE_VTEX_BACKFILL = 'vtex-backfill';
export const QUEUE_VTEX_WEBHOOK = 'vtex-webhook';
export const QUEUE_VTEX_RECONCILE = 'vtex-reconcile';
export const QUEUE_SHIPPING_REFRESH = 'shipping-refresh';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL');
        if (!url) {
          throw new Error('REDIS_URL es requerido para BullMQ');
        }
        return {
          connection: {
            url,
            // BullMQ requirements
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
          },
          defaultJobOptions: {
            removeOnComplete: { count: 1000, age: 60 * 60 * 24 * 7 },
            removeOnFail: { count: 5000, age: 60 * 60 * 24 * 30 },
            attempts: 5,
            backoff: { type: 'exponential', delay: 2000 },
          },
        };
      },
      inject: [ConfigService],
    }),
    BullModule.registerQueue(
      { name: QUEUE_VTEX_BACKFILL },
      { name: QUEUE_VTEX_WEBHOOK },
      { name: QUEUE_VTEX_RECONCILE },
      { name: QUEUE_SHIPPING_REFRESH },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
