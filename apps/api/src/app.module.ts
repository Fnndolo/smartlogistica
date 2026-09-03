import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { SessionGuard } from './common/guards/session.guard';
import { TenantInterceptor } from './common/interceptors/tenant.interceptor';
import { CryptoModule } from './infrastructure/crypto/crypto.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { PushModule } from './infrastructure/push/push.module';
import { RealtimeModule } from './infrastructure/realtime/realtime.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { CatalogModule } from './infrastructure/catalog/catalog.module';
import { AiModule } from './modules/ai/ai.module';
import { AlegraModule } from './modules/marketplaces/alegra/alegra.module';
import { CoordinadoraModule } from './modules/marketplaces/coordinadora/coordinadora.module';
import { AuthModule } from './modules/auth/auth.module';
import { MembersModule } from './modules/members/members.module';
import { ConnectionsModule } from './modules/connections/connections.module';
import { HealthModule } from './modules/health/health.module';
import { OrdersModule } from './modules/orders/orders.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { WarehousesModule } from './modules/warehouses/warehouses.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : { target: 'pino-pretty', options: { colorize: true, singleLine: true } },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
            '*.appKey',
            '*.appToken',
            '*.password',
            '*.passwordHash',
            '*.kek',
            '*.dek',
            '*.dbRolePassword',
            '*.wrappedDek',
            '*.encryptedAppKey',
            '*.encryptedAppToken',
          ],
          censor: '[REDACTED]',
        },
      },
    }),
    // OJO: el limitador se llama 'global'. Un @Throttle({ default: ... }) NO
    // aplica nada — la guarda solo lee la metadata del nombre registrado — y
    // rige este tope de 100/min. Los tres webhooks ya usan la clave correcta;
    // los de auth y el SSE de pedidos siguen con 'default' A PROPOSITO: hoy el
    // tracker es req.ip y, sin `trust proxy` y con el web haciendo de proxy,
    // TODO el trafico llega con la misma IP. Activar 5/min en el login dejaria
    // a la empresa entera con cinco inicios de sesion por minuto entre todos.
    // Para arreglarlo de verdad hay que keyear por sesion, no por IP.
    ThrottlerModule.forRoot([{ name: 'global', ttl: 60_000, limit: 100 }]),
    CryptoModule,
    PrismaModule,
    QueueModule,
    RealtimeModule,
    PushModule,
    StorageModule,
    CatalogModule,
    HealthModule,
    TenantsModule,
    AuthModule,
    MembersModule,
    ConnectionsModule,
    OrdersModule,
    WarehousesModule,
    AlegraModule,
    CoordinadoraModule,
    AiModule,
    WebhooksModule,
    WhatsappModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
  ],
})
export class AppModule {}
