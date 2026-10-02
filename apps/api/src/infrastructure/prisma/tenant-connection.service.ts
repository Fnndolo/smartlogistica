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

    const password = this.envelope.kekDecrypt(tenant.dbRolePassword).toString('utf8');
    const client = await this.connect(tenant, password);

    const entry: CachedTenant = { client, slug: tenant.slug };
    this.cache.set(tenantId, entry);
    return entry;
  }

  /**
   * Conecta a la DB del tenant probando primero el host de `TENANT_DB_HOST` y,
   * si ese no responde, el de la columna.
   *
   * La red privada de Railway no se puede probar desde fuera de Railway: solo
   * se sabe si el nombre, el puerto y el TLS estan bien cuando el contenedor
   * arranca alla. Sin esta segunda oportunidad, una variable mal escrita no
   * seria "sigo pagando trafico de mas" sino "la plataforma no levanta".
   *
   * Cuando el host del ENV funciona lo dice en el log: es la unica forma de
   * confirmar que el cambio surtio efecto, porque por fuera se ve igual.
   */
  private async connect(
    tenant: Pick<Tenant, 'dbHost' | 'dbName' | 'dbRole' | 'slug'>,
    password: string,
  ): Promise<TenantPrismaClient> {
    const override = this.config.get<string>('TENANT_DB_HOST')?.trim();
    const hosts = [...new Set([override, tenant.dbHost].filter(Boolean))] as string[];

    let ultimoError: unknown;
    for (const host of hosts) {
      const client = new TenantPrismaClient({
        datasources: { db: { url: this.buildUrl(tenant, password, host) } },
      });
      try {
        await client.$connect();
        if (host !== tenant.dbHost) {
          this.logger.log(
            `Tenant ${tenant.slug} conectado por ${host} (override de TENANT_DB_HOST)`,
          );
        }
        return client;
      } catch (err) {
        ultimoError = err;
        await client.$disconnect().catch(() => null);
        this.logger.warn(
          `No se pudo conectar ${tenant.slug} por ${host}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    throw ultimoError;
  }

  /**
   * URL de conexion a la DB de un tenant. `hostOverride` gana sobre la columna
   * `dbHost` de la fila.
   *
   * El motivo es que esa columna la COMPARTEN todos los entornos: se escribe
   * una vez al aprovisionar y la leen por igual el servidor de produccion y
   * cualquier maquina de desarrollo. Ponerle ahi el host de la red privada de
   * Railway (que es lo que evita pagar el trafico como salida a internet)
   * dejaria sin base de datos a todo lo que no corra dentro de Railway: el
   * entorno local y los scripts de diagnostico, que no pueden resolver un
   * nombre `.railway.internal`.
   *
   * Con el override cada entorno elige su ruta por variable de entorno y la
   * columna no se toca — ni hace falta migrar nada.
   */
  buildUrl(
    tenant: Pick<Tenant, 'dbHost' | 'dbName' | 'dbRole'>,
    password: string,
    hostOverride?: string,
  ): string {
    const host = hostOverride?.trim() || tenant.dbHost;
    const hostPort = host.includes(':') ? host : `${host}:5432`;
    // El TLS lo decide el HOST, no una variable suelta.
    //
    // En la red privada de Railway no hay TLS que negociar y tampoco hace
    // falta: el trafico no sale de la maquina. Pero por el proxy publico viajan
    // por internet la contraseña del rol y todos los datos del tenant, asi que
    // ahi exigirlo no es negociable. Con un solo `TENANT_DB_SSLMODE` para los
    // dos, bajarlo para que entrara la red privada habria apagado el cifrado
    // tambien en el camino publico — justo el que lo necesita.
    const esRedPrivada = /\.railway\.internal(:\d+)?$/i.test(hostPort);
    const sslmode = esRedPrivada
      ? 'disable'
      : (this.config.get<string>('TENANT_DB_SSLMODE') ?? 'require');
    const encodedPwd = encodeURIComponent(password);
    // connection_limit=10: con 10-20 usuarios simultaneos del MISMO tenant, 5
    // conexiones hacian cola en picos (facturar + listas + chat a la vez).
    return `postgresql://${tenant.dbRole}:${encodedPwd}@${hostPort}/${tenant.dbName}?sslmode=${sslmode}&connection_limit=10&pool_timeout=10`;
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
