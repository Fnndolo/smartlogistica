import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';

/**
 * Entrypoint para correr SOLO los workers (sin HTTP server).
 * Uso: `node dist/workers.js` — util cuando se escalan workers como servicio aparte
 * en Railway/Fly. Los BullMQ processors arrancan automaticamente via @Processor decorator.
 *
 * En dev y en single-instance prod, `node dist/main.js` (que incluye HTTP + workers)
 * es suficiente.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  const logger = app.get(Logger);
  logger.log('SmartLogistica workers running (processors activos)');

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`Received ${signal} — shutting down workers`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Workers bootstrap error', err);
  process.exit(1);
});
