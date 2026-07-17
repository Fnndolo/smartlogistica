import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Queue } from 'bullmq';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import { Public } from '../../common/decorators/public.decorator';
import { ControlPlaneService } from '../../infrastructure/prisma/control-plane.service';
import { TenantConnectionService } from '../../infrastructure/prisma/tenant-connection.service';
import { QUEUE_VTEX_WEBHOOK } from '../../infrastructure/queue/queue.module';
import { VtexClient } from '../marketplaces/vtex/vtex-client.service';
import type { VtexWebhookPayload } from '../marketplaces/vtex/vtex.types';

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024; // 256 KB — payloads VTEX son pequenos
const ACCOUNT_NAME_RE = /^[a-z0-9-]{3,40}$/;

// Validacion del payload del webhook VTEX. `passthrough` conserva campos extra
// (los guardamos en rawPayload) pero exige OrderId/State con tipo correcto.
const vtexWebhookPayloadSchema = z
  .object({
    OrderId: z.string().min(1).max(128),
    State: z.string().min(1).max(64),
    LastChange: z.string().max(64).optional(),
    Domain: z.string().max(64).optional(),
  })
  .passthrough();

@Controller('webhooks/marketplace')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly control: ControlPlaneService,
    private readonly tenants: TenantConnectionService,
    @InjectQueue(QUEUE_VTEX_WEBHOOK) private readonly queue: Queue,
  ) {}

  @Public()
  @Post('vtex/:tenantSlug')
  @HttpCode(200)
  @Throttle({ default: { limit: 1000, ttl: 60_000 } })
  async vtex(
    @Param('tenantSlug') tenantSlug: string,
    @Query('account') accountName: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<{ ok: true }> {
    if (!accountName || !ACCOUNT_NAME_RE.test(accountName)) {
      throw new BadRequestException('Query param `account` invalido o ausente');
    }

    const tenant = await this.control.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant || tenant.status !== 'ACTIVE') {
      throw new NotFoundException('Tenant no encontrado o inactivo');
    }

    const { client: prisma } = await this.tenants.getForTenant(tenant.id);
    const conn = await prisma.marketplaceConnection.findUnique({
      where: { provider_accountName: { provider: 'vtex', accountName } },
    });
    if (!conn) {
      throw new NotFoundException('Conexion VTEX no encontrada');
    }

    if (!verifyBearer(authorization, conn.webhookSecret)) {
      throw new UnauthorizedException('Bearer secret invalido');
    }

    const raw = req.rawBody;
    if (!raw || raw.length === 0) {
      throw new BadRequestException('Body vacio');
    }
    if (raw.length > MAX_WEBHOOK_BODY_BYTES) {
      throw new BadRequestException('Payload demasiado grande');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new BadRequestException('Body JSON invalido');
    }

    const result = vtexWebhookPayloadSchema.safeParse(parsed);
    if (!result.success) {
      throw new BadRequestException('Payload de webhook invalido');
    }
    const payload = result.data as VtexWebhookPayload;

    const eventId = VtexClient.extractWebhookEventId(payload);
    await this.queue.add(
      'webhook',
      {
        tenantId: tenant.id,
        accountName,
        eventId,
        payload,
      },
      {
        // `__` (no `:`) porque BullMQ reserva `:` para keys Redis.
        jobId: `${tenant.id}__${eventId}`,
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );

    return { ok: true };
  }
}

function verifyBearer(authorization: string | undefined, expected: string): boolean {
  if (!authorization || !authorization.startsWith('Bearer ')) return false;
  const provided = authorization.slice('Bearer '.length).trim();
  // Comparamos hashes de longitud fija (SHA-256) para que el chequeo sea
  // timing-safe SIN filtrar la longitud del secreto (el early-return por
  // longitud distinta seria un canal lateral).
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
