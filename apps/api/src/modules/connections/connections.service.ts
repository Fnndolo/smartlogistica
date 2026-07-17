import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { randomBytes } from 'node:crypto';
import { isAxiosError } from 'axios';
import type { VtexCredentialsInput, VtexConnectionSummary } from '@smartlogistica/shared';

import { EnvelopeService } from '../../infrastructure/crypto/envelope.service';
import { getTenantContext } from '../../infrastructure/tenant-context';
import { QUEUE_VTEX_BACKFILL } from '../../infrastructure/queue/queue.module';
import { VtexClient } from '../marketplaces/vtex/vtex-client.service';
import { enqueueVtexBackfill } from '../marketplaces/vtex/vtex-backfill.enqueue';

@Injectable()
export class ConnectionsService {
  private readonly logger = new Logger(ConnectionsService.name);

  constructor(
    private readonly vtex: VtexClient,
    private readonly envelope: EnvelopeService,
    private readonly config: ConfigService,
    @InjectQueue(QUEUE_VTEX_BACKFILL) private readonly backfillQueue: Queue,
  ) {}

  /** Verifica que las credenciales funcionan contra VTEX, sin persistir nada. */
  async testVtex(input: VtexCredentialsInput): Promise<{ ok: true; sampleOrderCount: number }> {
    try {
      return await this.vtex.testCredentials(input);
    } catch (err) {
      throw this.translateVtexError(err, 'No se pudo conectar a VTEX');
    }
  }

  async createVtex(input: VtexCredentialsInput): Promise<VtexConnectionSummary> {
    const { tenantId, prisma } = getTenantContext();

    // 1. Validar credenciales primero — falla rapido sin guardar.
    try {
      await this.vtex.testCredentials(input);
    } catch (err) {
      throw this.translateVtexError(err, 'Las credenciales VTEX son invalidas');
    }

    // 2. Validar unicidad por (provider, accountName).
    const existing = await prisma.marketplaceConnection.findUnique({
      where: { provider_accountName: { provider: 'vtex', accountName: input.accountName } },
    });
    if (existing) {
      throw new BadRequestException(`Ya existe una conexion VTEX para ${input.accountName}`);
    }

    // 3. Encriptar appKey + appToken con la DEK del tenant. Cada blob es
    // auto-contenido (iv+tag+ct), no hay riesgo de mezclar IV entre campos.
    const encryptedAppKey = await this.envelope.encryptField(tenantId, input.appKey);
    const encryptedAppToken = await this.envelope.encryptField(tenantId, input.appToken);

    const webhookSecret = randomBytes(32).toString('base64url');

    // 4. Persistir.
    const conn = await prisma.marketplaceConnection.create({
      data: {
        provider: 'vtex',
        accountName: input.accountName,
        encryptedAppKey,
        encryptedAppToken,
        webhookSecret,
        status: 'connected',
      },
    });

    // 5. Registrar webhook en VTEX (best-effort: no bloquear la creacion si falla).
    try {
      const http = this.vtex.buildHttp(input);
      await this.vtex.registerWebhook(http, {
        url: this.buildWebhookUrl(input.accountName),
        bearerSecret: webhookSecret,
      });
    } catch (err) {
      this.logger.warn({ err, accountName: input.accountName }, 'Webhook VTEX registration failed');
      await prisma.marketplaceConnection.update({
        where: { id: conn.id },
        data: { lastError: 'Webhook no se pudo registrar — sincronizacion sera solo via backfill' },
      });
    }

    // 6. Encolar backfill. Si falla, marcamos lastError pero no abortamos
    // (la conexion esta creada y se puede re-sincronizar manualmente).
    try {
      await this.enqueueBackfill(tenantId, input.accountName);
    } catch (err) {
      this.logger.error({ err }, 'Failed to enqueue backfill job');
      await prisma.marketplaceConnection.update({
        where: { id: conn.id },
        data: {
          lastError: `Backfill no se pudo encolar: ${(err as Error).message}. Usa "Sincronizar".`,
        },
      });
    }

    return this.toSummary(conn);
  }

  /**
   * Re-sincroniza una conexion existente: re-registra el webhook (la URL publica
   * de ngrok cambia entre reinicios) y encola un backfill.
   */
  async syncVtex(connectionId: string): Promise<VtexConnectionSummary> {
    const { tenantId, prisma } = getTenantContext();
    const conn = await prisma.marketplaceConnection.findUnique({ where: { id: connectionId } });
    if (!conn || conn.provider !== 'vtex') throw new NotFoundException();

    // Re-registrar webhook con la URL publica actual (best-effort).
    let webhookError: string | null = null;
    try {
      const http = await this.vtex.forTenant(tenantId, conn.accountName);
      await this.vtex.registerWebhook(http, {
        url: this.buildWebhookUrl(conn.accountName),
        bearerSecret: conn.webhookSecret,
      });
    } catch (err) {
      this.logger.warn({ err, connectionId }, 'Webhook re-registration failed during sync');
      webhookError = 'Webhook no se pudo registrar — revisa PUBLIC_WEBHOOK_BASE_URL (ngrok)';
    }

    await this.enqueueBackfill(tenantId, conn.accountName);

    const updated = await prisma.marketplaceConnection.update({
      where: { id: connectionId },
      data: { lastError: webhookError },
    });
    return this.toSummary(updated);
  }

  private async enqueueBackfill(tenantId: string, accountName: string): Promise<void> {
    await enqueueVtexBackfill(this.backfillQueue, tenantId, accountName);
  }

  async list(): Promise<VtexConnectionSummary[]> {
    const { prisma } = getTenantContext();
    const rows = await prisma.marketplaceConnection.findMany({
      where: { provider: 'vtex' },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toSummary(r));
  }

  async delete(id: string): Promise<void> {
    const { tenantId, prisma } = getTenantContext();
    const conn = await prisma.marketplaceConnection.findUnique({ where: { id } });
    if (!conn) throw new NotFoundException();

    // Best-effort unregister webhook
    try {
      const http = await this.vtex.forTenant(tenantId, conn.accountName);
      await this.vtex.unregisterWebhook(http);
    } catch (err) {
      this.logger.warn({ err, id }, 'Failed to unregister VTEX webhook on delete');
    }

    await prisma.marketplaceConnection.delete({ where: { id } });
  }

  private toSummary(row: {
    id: string;
    accountName: string;
    status: string;
    lastSyncedAt: Date | null;
    createdAt: Date;
  }): VtexConnectionSummary {
    return {
      id: row.id,
      provider: 'vtex',
      accountName: row.accountName,
      status: (row.status as VtexConnectionSummary['status']) ?? 'connected',
      lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private buildWebhookUrl(accountName: string): string {
    const base = this.config.get<string>('PUBLIC_WEBHOOK_BASE_URL');
    if (!base) {
      throw new Error('PUBLIC_WEBHOOK_BASE_URL no configurado');
    }
    const { tenantSlug } = getTenantContext();
    return VtexClient.webhookUrl(base, tenantSlug, accountName);
  }

  private translateVtexError(err: unknown, fallback: string): BadRequestException {
    if (isAxiosError(err)) {
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        return new BadRequestException('Credenciales VTEX rechazadas (401/403)');
      }
      if (status === 404) {
        return new BadRequestException('Account name VTEX no encontrado (404)');
      }
      return new BadRequestException(`${fallback}: HTTP ${status ?? 'desconocido'}`);
    }
    return new BadRequestException(fallback);
  }
}
