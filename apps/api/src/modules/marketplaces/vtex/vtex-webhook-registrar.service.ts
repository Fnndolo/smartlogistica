import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ControlPlaneService } from '../../../infrastructure/prisma/control-plane.service';
import { TenantConnectionService } from '../../../infrastructure/prisma/tenant-connection.service';
import { VtexClient } from './vtex-client.service';

/**
 * Al arrancar el back, re-registra el webhook de cada conexion VTEX con la URL
 * publica ACTUAL (PUBLIC_WEBHOOK_BASE_URL). En dev la URL del tunel cambia en
 * cada `pnpm tunnel`, asi que esto elimina la necesidad de pulsar "Sincronizar"
 * a mano: con el tunel arriba y el back arrancando, VTEX queda apuntando bien.
 *
 * Best-effort: si falla (tunel caido, etc.) se loguea y se deja lastError; el
 * reconcile periodico mantiene la DB correcta igual.
 */
@Injectable()
export class VtexWebhookRegistrar implements OnApplicationBootstrap {
  private readonly logger = new Logger(VtexWebhookRegistrar.name);

  constructor(
    private readonly control: ControlPlaneService,
    private readonly tenants: TenantConnectionService,
    private readonly vtex: VtexClient,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const base = this.config.get<string>('PUBLIC_WEBHOOK_BASE_URL');
    if (!base || base.includes('CHANGE_ME') || !base.startsWith('https://')) {
      this.logger.warn(
        'PUBLIC_WEBHOOK_BASE_URL no es una URL https valida — webhooks NO registrados. ' +
          'Corre `pnpm tunnel` y reinicia para tiempo real instantaneo.',
      );
      return;
    }

    const activeTenants = await this.control.tenant.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, slug: true },
    });

    let ok = 0;
    let failed = 0;
    for (const tenant of activeTenants) {
      let client;
      try {
        ({ client } = await this.tenants.getForTenant(tenant.id));
      } catch (err) {
        this.logger.warn({ err, tenant: tenant.slug }, 'No se pudo abrir tenant DB para registrar webhook');
        continue;
      }
      const conns = await client.marketplaceConnection.findMany({
        where: { provider: 'vtex', status: 'connected' },
        select: { id: true, accountName: true, webhookSecret: true },
      });
      for (const conn of conns) {
        const url = VtexClient.webhookUrl(base, tenant.slug, conn.accountName);
        try {
          const http = await this.vtex.forTenant(tenant.id, conn.accountName);
          await this.vtex.registerWebhook(http, { url, bearerSecret: conn.webhookSecret });
          await client.marketplaceConnection.update({
            where: { id: conn.id },
            data: { lastError: null },
          });
          ok++;
        } catch (err) {
          failed++;
          this.logger.warn(
            { err, tenant: tenant.slug, account: conn.accountName },
            'Fallo el re-registro de webhook al arranque',
          );
          await client.marketplaceConnection
            .update({
              where: { id: conn.id },
              data: { lastError: 'Webhook no registrado al arranque — revisa el tunel (pnpm tunnel)' },
            })
            .catch(() => undefined);
        }
      }
    }

    this.logger.log(`Registro de webhooks al arranque: ${ok} ok, ${failed} fallidos (base=${base})`);
  }
}
