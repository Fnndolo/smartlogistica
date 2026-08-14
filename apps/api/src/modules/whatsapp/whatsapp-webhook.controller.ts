import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import { waInboundSchema, type WaInboundInput } from '@smartlogistica/shared';

import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ControlPlaneService } from '../../infrastructure/prisma/control-plane.service';
import { TenantConnectionService } from '../../infrastructure/prisma/tenant-connection.service';
import { WhatsappService } from './whatsapp.service';

/**
 * Webhook publico de MENSAJES de WhatsApp. Lo llaman:
 * - El flow de Whapify ("Solicitud de API Externa" en el trigger de mensaje
 *   recibido): guarda los ENTRANTES del cliente.
 * - n8n (opcional): espeja sus envios (ej. la confirmacion) con direction 'out'.
 *
 * URL: POST /v1/webhooks/whatsapp/<tenantSlug>?token=<CONFIRMATION_WEBHOOK_SECRET>
 * Body: { phone, name?, text?, mediaUrl?, type?, direction?, authorName? }
 * Mismo secreto que el webhook de confirmacion (una sola cosa que configurar).
 */
@Controller('webhooks/whatsapp')
export class WhatsappWebhookController {
  private readonly logger = new Logger(WhatsappWebhookController.name);

  constructor(
    private readonly control: ControlPlaneService,
    private readonly tenants: TenantConnectionService,
    private readonly whatsapp: WhatsappService,
  ) {}

  @Public()
  @Post(':tenantSlug')
  @HttpCode(200)
  @Throttle({ default: { limit: 1200, ttl: 60_000 } })
  async receive(
    @Param('tenantSlug') tenantSlug: string,
    @Query('token') token: string | undefined,
    @Body(new ZodValidationPipe(waInboundSchema)) body: WaInboundInput,
  ): Promise<{ ok: true }> {
    this.assertToken(token);

    const tenant = await this.control.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant || tenant.status !== 'ACTIVE') {
      throw new NotFoundException('Tenant no encontrado o inactivo');
    }

    // Responder YA y guardar en background (el nodo de Whapify corta por
    // timeout y marca "Fallo" si tardamos — mismo patron de la confirmacion).
    void (async () => {
      const { client } = await this.tenants.getForTenant(tenant.id);
      await this.whatsapp.inbound(tenant.id, client, body);
    })().catch((err) => {
      this.logger.error(
        `Mensaje WhatsApp en background fallo (tel ${body.phone}): ${err instanceof Error ? err.message : err}`,
      );
    });

    return { ok: true };
  }

  private assertToken(token: string | undefined): void {
    const secret = process.env.CONFIRMATION_WEBHOOK_SECRET;
    if (!secret) {
      throw new ForbiddenException('Webhook no configurado (falta CONFIRMATION_WEBHOOK_SECRET)');
    }
    const a = Buffer.from(token ?? '');
    const b = Buffer.from(secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenException('Token invalido');
    }
  }
}

/**
 * Webhook publico de la CLOUD API via 360dialog: recibe TODO lo del numero
 * (mensajes entrantes, medios, estados y — con coexistencia — los echoes de lo
 * enviado desde el celular). Se configura AUTOMATICAMENTE al conectar 360dialog
 * en Conexiones. Mismo secreto que los demas webhooks.
 *
 * URL: POST /v1/webhooks/dialog360/<tenantSlug>?token=<CONFIRMATION_WEBHOOK_SECRET>
 */
@Controller('webhooks/dialog360')
export class Dialog360WebhookController {
  private readonly logger = new Logger(Dialog360WebhookController.name);

  constructor(
    private readonly control: ControlPlaneService,
    private readonly tenants: TenantConnectionService,
    private readonly whatsapp: WhatsappService,
  ) {}

  @Public()
  @Post(':tenantSlug')
  @HttpCode(200)
  @Throttle({ default: { limit: 3000, ttl: 60_000 } })
  async receive(
    @Param('tenantSlug') tenantSlug: string,
    @Query('token') token: string | undefined,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    this.assertToken(token);

    const tenant = await this.control.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant || tenant.status !== 'ACTIVE') {
      throw new NotFoundException('Tenant no encontrado o inactivo');
    }

    // 200 YA y proceso en background: Meta/360dialog reintentan si tardamos,
    // y la descarga de medios puede tomar segundos.
    void (async () => {
      const { client } = await this.tenants.getForTenant(tenant.id);
      await this.whatsapp.inboundCloud(tenant.id, client, body);
    })().catch((err) => {
      this.logger.error(
        `Webhook Cloud en background fallo: ${err instanceof Error ? err.message : err}`,
      );
    });

    return { ok: true };
  }

  private assertToken(token: string | undefined): void {
    const secret = process.env.CONFIRMATION_WEBHOOK_SECRET;
    if (!secret) {
      throw new ForbiddenException('Webhook no configurado (falta CONFIRMATION_WEBHOOK_SECRET)');
    }
    const a = Buffer.from(token ?? '');
    const b = Buffer.from(secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenException('Token invalido');
    }
  }
}
