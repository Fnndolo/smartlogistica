import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LRUCache } from 'lru-cache';
import { PrismaClient as TenantPrismaClient } from '.prisma/tenant-client';
import type { Tenant } from '.prisma/control-plane-client';

import { EnvelopeService } from '../crypto/envelope.service';
import { ControlPlaneService } from './control-plane.service';

interface CachedTenant {
  client: TenantPrismaClient;
  slug: string;
}

const POOL_MAX = 50;
// 6h sin uso -> evict. Con TTL corto (antes 15 min) la primera peticion tras un
// rato idle pagaba reabrir la conexion (~1-2s) — se sentia como "lentitud
// aleatoria" y hacia que el webhook de Whapify cortara por timeout. POOL_MAX
// sigue acotando la memoria; updateAgeOnGet mantiene vivos los activos.
const POOL_TTL_MS = 1000 * 60 * 60 * 6;

/**
 * Pool LRU de PrismaClient por tenant.
 *
 * Cada tenant tiene su propia DB Postgres. Mantener un PrismaClient permanente por
 * cada uno escalaria mal (>50 tenants concurrentes saturarian el pool de conexiones
 * del cluster), asi que cacheamos los clientes activos y descartamos los inactivos.
 *
 * Cada cliente abre hasta connection_limit=5 sockets internos. Con 50 tenants = 250
 * sockets maximo. Para >100 tenants concurrentes, anadir PgBouncer (transaction pool).
 */
@Injectable()
export class TenantConnectionService implements OnModuleDestroy {
  private readonly logger = new Logger(TenantConnectionService.name);
  private readonly cache: LRUCache<string, CachedTenant>;

  constructor(
    private readonly control: ControlPlaneService,
    private readonly envelope: EnvelopeService,
    private readonly config: ConfigService,
  ) {
    this.cache = new LRUCache<string, CachedTenant>({
      max: POOL_MAX,
      ttl: POOL_TTL_MS,
      updateAgeOnGet: true,
      dispose: (cached) => {
        cached.client.$disconnect().catch((err) => {
          this.logger.warn({ err }, 'Failed to disconnect evicted tenant client');
        });
      },
    });
  }

  async getForTenant(tenantId: string): Promise<{ client: TenantPrismaClient; slug: string }> {
    const cached = this.cache.get(tenantId);
    if (cached) return cached;

    const tenant = await this.control.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    if (tenant.status !== 'ACTIVE') {
      throw new Error(`Tenant ${tenant.slug} no esta ACTIVE (status=${tenant.status})`);
    }
    if (!tenant.dbRolePassword) {
      throw new Error(`Tenant ${tenant.slug} sin password de DB persistido`);
    }

    const url = this.buildUrl(tenant, this.envelope.kekDecrypt(tenant.dbRolePassword).toString('utf8'));
    const client = new TenantPrismaClient({ datasources: { db: { url } } });
    await client.$connect();

    const entry: CachedTenant = { client, slug: tenant.slug };
    this.cache.set(tenantId, entry);
    return entry;
  }

  buildUrl(tenant: Pick<Tenant, 'dbHost' | 'dbName' | 'dbRole'>, password: string): string {
    const sslmode = this.config.get<string>('TENANT_DB_SSLMODE') ?? 'require';
    const hostPort = tenant.dbHost.includes(':') ? tenant.dbHost : `${tenant.dbHost}:5432`;
    const encodedPwd = encodeURIComponent(password);
    return `postgresql://${tenant.dbRole}:${encodedPwd}@${hostPort}/${tenant.dbName}?sslmode=${sslmode}&connection_limit=5&pool_timeout=10`;
  }

  /** Cierra y elimina el cliente cacheado de un tenant (uso: tras suspender o eliminar). */
  async evict(tenantId: string): Promise<void> {
    this.cache.delete(tenantId);
  }

  async onModuleDestroy(): Promise<void> {
    for (const [, entry] of this.cache) {
      await entry.client.$disconnect().catch(() => null);
    }
    this.cache.clear();
  }
}
