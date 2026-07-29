import 'reflect-metadata';
import * as http from 'node:http';
import * as https from 'node:https';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import axios from 'axios';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

import { AppModule } from './app.module';

// KEEP-ALIVE global para TODO el trafico saliente (Alegra, VTEX, Coordinadora,
// Whapify...): reutiliza las conexiones TLS en vez de abrir una por request.
// Con 10-20 usuarios facturando a la vez, cada handshake ahorrado son
// ~100-300ms menos por llamada externa.
axios.defaults.httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64 });
axios.defaults.httpAgent = new http.Agent({ keepAlive: true, maxSockets: 64 });

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });

  app.useLogger(app.get(Logger));
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());

  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
  app.enableCors({
    origin: webOrigin.split(',').map((o) => o.trim()),
    credentials: true,
  });

  app.setGlobalPrefix('v1', { exclude: ['health'] });

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);

  const logger = app.get(Logger);
  logger.log(`SmartLogistica API listening on http://localhost:${port}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
