import { Injectable } from '@nestjs/common';
import type { AxiosInstance } from 'axios';
import type { Dialog360Mode } from '@smartlogistica/shared';
import type { PrismaClient } from '.prisma/tenant-client';

import { EnvelopeService } from '../../infrastructure/crypto/envelope.service';
import { Dialog360Client } from './dialog360-client.service';

/**
 * Credenciales 360dialog LISTAS para usar. Servicio propio porque lo
 * necesitan DOS lados: los envios (WhatsappService) y la recepcion
 * (WhatsappWebhookService) — asi ninguno depende del otro.
 */
@Injectable()
export class WaConnectionService {
  constructor(
    private readonly dialog360: Dialog360Client,
    private readonly envelope: EnvelopeService,
  ) {}

  /** Cliente 360dialog listo (null si no hay conexion). Prisma explicito: lo usa tambien el webhook. */
  async dialog360OrNull(
    tenantId: string,
    prisma: PrismaClient,
  ): Promise<{ http: AxiosInstance; mode: Dialog360Mode; apiKey: string } | null> {
    const conn = await prisma.dialog360Connection.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!conn) return null;
    const apiKey = await this.envelope.decryptField(tenantId, conn.encryptedApiKey);
    const mode: Dialog360Mode = conn.mode === 'sandbox' ? 'sandbox' : 'production';
    return { http: this.dialog360.buildHttp(apiKey, mode), mode, apiKey };
  }
}
