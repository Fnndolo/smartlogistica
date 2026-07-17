import { Injectable, type OnModuleDestroy, type OnModuleInit, Logger } from '@nestjs/common';
import { PrismaClient } from '.prisma/control-plane-client';

/**
 * Cliente Prisma para la base de datos del control plane.
 * Contiene identidad/registro (users, tenants, memberships, sessions, audit log).
 * NO contiene datos de negocio del tenant — esos viven en su propia DB.
 */
@Injectable()
export class ControlPlaneService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ControlPlaneService.name);

  constructor() {
    super({
      log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['error', 'warn'],
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Control plane DB connected');
    } catch (err) {
      this.logger.error('Failed to connect to control plane DB', err as Error);
      throw err;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
