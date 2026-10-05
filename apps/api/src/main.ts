import 'reflect-metadata';
import * as http from 'node:http';
import * as https from 'node:https';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import axios from 'axios';
import compression from 'compression';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

import { AppModule } from './app.module';

// KEEP-ALIVE global para TODO el trafico saliente (Alegra, VTEX, Coordinadora,
// 360dialog...): reutiliza las conexiones TLS en vez de abrir una por request.
// Con 10-20 usuarios facturando a la vez, cada handshake ahorrado son
// ~100-300ms menos por llamada externa.
axios.defaults.httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64 });
axios.defaults.httpAgent = new http.Agent({ keepAlive: true, maxSockets: 64 });

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });

  // El limite por defecto de Nest es 100 kb y los lotes de historial de
  // WhatsApp llegan a 3 MB: sin esto Meta recibe 413 y reintenta durante dias.
  // `useBodyParser` conserva el registro de `rawBody` (que la firma del webhook
  // necesita); un `app.use(bodyParser.json(...))` a mano si lo romperia.
  app.useBodyParser('json', { limit: '5mb' });

  app.useLogger(app.get(Logger));
  app.use(helmet({ contentSecurityPolicy: false }));

  /**
   * GZIP en las respuestas.
   *
   * Lo que sale de aqui es JSON —listas de pedidos, la bandeja, hilos de chat—
   * y comprime como 4 veces. Medido en Railway: el API mandaba 119 GB a la
   * semana SIN comprimir y el web reenviaba los mismos datos al navegador en
   * 27 GB, porque Next si comprime. Ese factor de 4 se estaba pagando entero
   * como salida a internet.
   *
   * SSE QUEDA FUERA, y no es un detalle: comprimir bufferiza, y un flujo de
   * eventos que se bufferiza deja de ser tiempo real — los mensajes del chat
   * llegarian a tirones o no llegarian. Se mira el tipo de contenido y ademas
   * la ruta, porque segun cuando se evalue el filtro puede que la cabecera
   * todavia no este puesta.
   */
  // Interruptor: COMPRESSION=off lo apaga sin tocar codigo ni esperar un
  // despliegue nuevo. Es una variable de entorno justamente porque revertir
  // codigo es lento cuando algo esta fallando en produccion.
  if ((process.env.COMPRESSION ?? 'on').toLowerCase() !== 'off') {
    app.use(
      compression({
        filter: (req, res) => {
          const tipo = String(res.getHeader('Content-Type') ?? '');
          if (tipo.includes('text/event-stream') || req.path.endsWith('/stream')) return false;
          return compression.filter(req, res);
        },
      }),
    );
  }

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
