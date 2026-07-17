import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client as PgClient } from 'pg';
import type { Tenant } from '.prisma/control-plane-client';

import { EnvelopeService } from '../../infrastructure/crypto/envelope.service';
import { ControlPlaneService } from '../../infrastructure/prisma/control-plane.service';
import { TenantConnectionService } from '../../infrastructure/prisma/tenant-connection.service';

interface ProvisionInput {
  ownerUserId: string;
  slug: string;
  name: string;
}

/**
 * Provisioning de un nuevo tenant.
 *
 * Flujo:
 *   1. Generar dbName, dbRole, dbRolePassword random.
 *   2. Cifrar dbRolePassword con KEK.
 *   3. INSERT Tenant en control plane con status=PROVISIONING.
 *   4. Conectar como admin Postgres: CREATE ROLE + CREATE DATABASE + REVOKE PUBLIC.
 *   5. Conectar a la DB nueva: ejecutar init.sql.
 *   6. Generar DEK + persistir TenantDek envuelto con KEK.
 *   7. Crear Membership OWNER.
 *   8. UPDATE Tenant a status=ACTIVE.
 *
 * Compensacion: si cualquier paso entre 4-8 falla, DROP DATABASE + DROP ROLE + DELETE Tenant.
 */
@Injectable()
export class TenantProvisioningService {
  private readonly logger = new Logger(TenantProvisioningService.name);
  private cachedInitSql: string | null = null;

  constructor(
    private readonly prisma: ControlPlaneService,
    private readonly envelope: EnvelopeService,
    private readonly connections: TenantConnectionService,
    private readonly config: ConfigService,
  ) {}

  async provision(input: ProvisionInput): Promise<Tenant> {
    const adminUrl = this.config.get<string>('TENANT_DB_ADMIN_URL');
    if (!adminUrl) {
      throw new Error('TENANT_DB_ADMIN_URL no configurado (requerido para provisioning)');
    }

    const dbHost = this.config.get<string>('TENANT_DB_HOST') ?? extractHostFromUrl(adminUrl);
    const dbName = `tenant_${input.slug}_${randomBytes(4).toString('hex')}`;
    const dbRole = `role_${input.slug}_${randomBytes(4).toString('hex')}`;
    const rolePassword = randomBytes(24).toString('base64url'); // [A-Za-z0-9_-]

    const wrappedPassword = this.envelope.kekEncrypt(Buffer.from(rolePassword, 'utf8'));

    const tenant = await this.prisma.tenant.create({
      data: {
        slug: input.slug,
        name: input.name,
        dbName,
        dbRole,
        dbHost,
        dbRolePassword: wrappedPassword,
        status: 'PROVISIONING',
      },
    });

    let dbCreated = false;
    let roleCreated = false;
    try {
      await this.createRoleAndDatabase(adminUrl, dbName, dbRole, rolePassword);
      roleCreated = true;
      dbCreated = true;

      await this.applyTenantSchema({ dbHost, dbName, dbRole }, rolePassword);

      await this.envelope.createTenantDek(tenant.id);

      await this.prisma.membership.create({
        data: { userId: input.ownerUserId, tenantId: tenant.id, role: 'OWNER' },
      });

      const activated = await this.prisma.tenant.update({
        where: { id: tenant.id },
        data: { status: 'ACTIVE' },
      });

      this.logger.log(
        `Provisioned tenant slug=${activated.slug} id=${activated.id} db=${dbName} role=${dbRole}`,
      );
      return activated;
    } catch (err) {
      this.logger.error({ err, tenantId: tenant.id }, 'Provisioning failed — rolling back');
      await this.compensate({
        adminUrl,
        tenantId: tenant.id,
        dbName,
        dbRole,
        dbCreated,
        roleCreated,
      });
      throw err;
    }
  }

  private async createRoleAndDatabase(
    adminUrl: string,
    dbName: string,
    dbRole: string,
    rolePassword: string,
  ): Promise<void> {
    assertSafeIdentifier(dbName);
    assertSafeIdentifier(dbRole);
    assertSafePassword(rolePassword);

    const admin = new PgClient({ connectionString: stripSslMode(adminUrl), ssl: pgSslConfig() });
    await admin.connect();
    try {
      await admin.query(`CREATE ROLE "${dbRole}" WITH LOGIN PASSWORD '${rolePassword}'`);
      await admin.query(`CREATE DATABASE "${dbName}" OWNER "${dbRole}"`);
      await admin.query(`REVOKE ALL ON DATABASE "${dbName}" FROM PUBLIC`);
      await admin.query(`GRANT ALL PRIVILEGES ON DATABASE "${dbName}" TO "${dbRole}"`);
    } finally {
      await admin.end().catch(() => null);
    }
  }

  private async applyTenantSchema(
    target: { dbHost: string; dbName: string; dbRole: string },
    password: string,
  ): Promise<void> {
    const sql = await this.loadInitSql();
    const hostPort = target.dbHost.includes(':') ? target.dbHost : `${target.dbHost}:5432`;
    // Sin sslmode en el URL: el cliente pg trata `sslmode=require` como verify-full
    // y rechaza el cert auto-firmado de Railway. Usamos ssl programatico.
    const url = `postgresql://${target.dbRole}:${encodeURIComponent(password)}@${hostPort}/${target.dbName}`;

    const tenantClient = new PgClient({ connectionString: url, ssl: pgSslConfig() });
    await tenantClient.connect();
    try {
      await tenantClient.query(sql);
    } finally {
      await tenantClient.end().catch(() => null);
    }
  }

  private async loadInitSql(): Promise<string> {
    if (this.cachedInitSql) return this.cachedInitSql;
    const path = join(process.cwd(), 'prisma', 'tenant', 'init.sql');
    const sql = await readFile(path, 'utf8');
    if (!sql.trim()) {
      throw new Error(
        `prisma/tenant/init.sql vacio. Ejecuta: pnpm db:tenant:bootstrap-sql en apps/api`,
      );
    }
    this.cachedInitSql = sql;
    return sql;
  }

  private async compensate(args: {
    adminUrl: string;
    tenantId: string;
    dbName: string;
    dbRole: string;
    dbCreated: boolean;
    roleCreated: boolean;
  }): Promise<void> {
    if (args.dbCreated || args.roleCreated) {
      const admin = new PgClient({ connectionString: stripSslMode(args.adminUrl), ssl: pgSslConfig() });
      try {
        await admin.connect();
        if (args.dbCreated) {
          await admin
            .query(`DROP DATABASE IF EXISTS "${args.dbName}" WITH (FORCE)`)
            .catch((err) => this.logger.warn({ err }, `compensate: DROP DATABASE ${args.dbName}`));
        }
        if (args.roleCreated) {
          await admin
            .query(`DROP ROLE IF EXISTS "${args.dbRole}"`)
            .catch((err) => this.logger.warn({ err }, `compensate: DROP ROLE ${args.dbRole}`));
        }
      } finally {
        await admin.end().catch(() => null);
      }
    }

    await this.connections.evict(args.tenantId);
    await this.prisma.tenant
      .delete({ where: { id: args.tenantId } })
      .catch((err) => this.logger.warn({ err }, 'compensate: DELETE Tenant'));
  }
}

// Identificadores Postgres: `[a-z0-9_-]` solo. Los guiones son seguros porque
// generamos el SQL con comillas dobles ("dbname"). 63 chars max (limite Postgres).
const SAFE_IDENT = /^[a-z_][a-z0-9_-]{0,62}$/;
function assertSafeIdentifier(id: string): void {
  if (!SAFE_IDENT.test(id)) {
    throw new Error(`Identifier no seguro para DDL: ${id}`);
  }
}

const SAFE_PWD = /^[A-Za-z0-9_-]+$/;
function assertSafePassword(pwd: string): void {
  if (!SAFE_PWD.test(pwd) || pwd.length < 16) {
    throw new Error('Password generado no cumple invariante (base64url 16+ chars)');
  }
}

function extractHostFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || '5432'}`;
  } catch {
    return 'localhost:5432';
  }
}

/**
 * Railway expone Postgres detras de un proxy con certificado auto-firmado.
 * La conexion sigue siendo TLS — solo no validamos la cadena CA (no hay una
 * publica). Es el patron estandar para conectar a Railway/Supabase/Neon desde
 * Node con pg.
 */
function pgSslConfig(): { rejectUnauthorized: false } | undefined {
  const sslmode = process.env.TENANT_DB_SSLMODE ?? 'require';
  if (sslmode === 'disable') return undefined;
  return { rejectUnauthorized: false };
}

/**
 * pg-connection-string (que pg usa) interpreta `sslmode=require` como `verify-full`
 * en versiones recientes, lo que rechaza certs auto-firmados (Railway). Le quitamos
 * el flag del URL y dejamos que `pgSslConfig()` controle TLS programaticamente.
 */
function stripSslMode(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    return u.toString();
  } catch {
    return url;
  }
}
