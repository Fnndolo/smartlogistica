import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import { confirmAddressWebhookSchema, type ConfirmAddressWebhookInput } from '@smartlogistica/shared';

import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ControlPlaneService } from '../../infrastructure/prisma/control-plane.service';
import { TenantConnectionService } from '../../infrastructure/prisma/tenant-connection.service';
import { AddressConfirmationService } from './address-confirmation.service';

/**
 * Webhook publico para la "Solicitud de API Externa" de Whapify: cuando el cliente
 * confirma o modifica su direccion desde el mensaje de confirmacion de WhatsApp.
 *
 * URL: POST /v1/webhooks/confirmation/<tenantSlug>?token=<CONFIRMATION_WEBHOOK_SECRET>
 * Body JSON: { phone, action: 'confirmed'|'modified', address? }
 */
@Controller('webhooks/confirmation')
export class ConfirmationWebhookController {
  constructor(
    private readonly control: ControlPlaneService,
    private readonly tenants: TenantConnectionService,
    private readonly confirmation: AddressConfirmationService,
  ) {}

  @Public()
  @Post(':tenantSlug')
  @HttpCode(200)
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async confirm(
    @Param('tenantSlug') tenantSlug: string,
    @Query('token') token: string | undefined,
    @Body(new ZodValidationPipe(confirmAddressWebhookSchema)) body: ConfirmAddressWebhookInput,
  ): Promise<{ ok: true; updated: number }> {
    this.assertToken(token);

    const tenant = await this.control.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant || tenant.status !== 'ACTIVE') {
      throw new NotFoundException('Tenant no encontrado o inactivo');
    }

    const { client: prisma } = await this.tenants.getForTenant(tenant.id);
    const { updated } = await this.confirmation.apply(tenant.id, prisma, body);
    return { ok: true, updated };
  }

  /** Compara el token con el secreto (tiempo constante). */
  private assertToken(token: string | undefined): void {
    const secret = process.env.CONFIRMATION_WEBHOOK_SECRET;
    if (!secret) throw new ForbiddenException('Webhook no configurado (falta CONFIRMATION_WEBHOOK_SECRET)');
    const a = Buffer.from(token ?? '');
    const b = Buffer.from(secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenException('Token invalido');
    }
  }
}
