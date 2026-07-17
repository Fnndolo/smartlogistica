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
    ThrottlerModule.forRoot([{ name: 'global', ttl: 60_000, limit: 100 }]),
    CryptoModule,
    PrismaModule,
    QueueModule,
    RealtimeModule,
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
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
  ],
})
export class AppModule {}
