import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import {
  confirmAddressWebhookSchema,
  type ConfirmAddressWebhookInput,
  type ConfirmationLogEntry,
} from '@smartlogistica/shared';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { isAdmin } from '../../common/rbac';
import type { AuthContext } from '../../common/types/authenticated-request';
import { ControlPlaneService } from '../../infrastructure/prisma/control-plane.service';
import { TenantConnectionService } from '../../infrastructure/prisma/tenant-connection.service';
import { getTenantContext } from '../../infrastructure/tenant-context';
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
  private readonly logger = new Logger(ConfirmationWebhookController.name);

  constructor(
    private readonly control: ControlPlaneService,
    private readonly tenants: TenantConnectionService,
    private readonly confirmation: AddressConfirmationService,
  ) {}

  /** Registro de llamadas recibidas (diagnostico, solo admins). */
  @Get('log')
  async log(@CurrentUser() user: AuthContext): Promise<ConfirmationLogEntry[]> {
    if (!isAdmin(user)) throw new ForbiddenException('Solo administradores');
    const { prisma } = getTenantContext();
    return this.confirmation.recent(prisma);
  }

  @Public()
  @Post(':tenantSlug')
  @HttpCode(200)
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async confirm(
    @Param('tenantSlug') tenantSlug: string,
    @Query('token') token: string | undefined,
    @Body(new ZodValidationPipe(confirmAddressWebhookSchema)) body: ConfirmAddressWebhookInput,
  ): Promise<{ ok: true }> {
    this.assertToken(token);

    const tenant = await this.control.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant || tenant.status !== 'ACTIVE') {
      throw new NotFoundException('Tenant no encontrado o inactivo');
    }

    // Responder YA y procesar en background: el nodo de Whapify corta por timeout
    // y marca "Fallo" (sin reintento) si tardamos — p. ej. cuando toca reabrir la
    // conexion a la DB del tenant. La confirmacion se perdia en silencio. El
    // resultado queda en ConfirmationLog y en los logs del servicio.
    void (async () => {
      const { client } = await this.tenants.getForTenant(tenant.id);
      await this.confirmation.apply(tenant.id, client, body);
    })().catch((err) => {
      this.logger.error(
        `Confirmacion en background fallo (tel ${body.phone}): ${err instanceof Error ? err.message : err}`,
      );
    });

    return { ok: true };
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
