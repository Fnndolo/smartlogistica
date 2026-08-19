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
type D360Ready = { http: AxiosInstance; mode: Dialog360Mode; apiKey: string } | null;

/** Cache de credenciales listas por tenant: sin el, CADA envio y CADA medio
 * entrante pagaba consulta a DB + descifrado de sobre (~50-150ms). */
const CREDS_TTL_MS = 60_000;

@Injectable()
export class WaConnectionService {
  private readonly cache = new Map<string, { at: number; value: D360Ready }>();

  constructor(
    private readonly dialog360: Dialog360Client,
    private readonly envelope: EnvelopeService,
  ) {}

  /** Cliente 360dialog listo (null si no hay conexion). Prisma explicito: lo usa tambien el webhook. */
  async dialog360OrNull(tenantId: string, prisma: PrismaClient): Promise<D360Ready> {
    const hit = this.cache.get(tenantId);
    if (hit && Date.now() - hit.at < CREDS_TTL_MS) return hit.value;
    const conn = await prisma.dialog360Connection.findFirst({ orderBy: { createdAt: 'desc' } });
    let value: D360Ready = null;
    if (conn) {
      const apiKey = await this.envelope.decryptField(tenantId, conn.encryptedApiKey);
      const mode: Dialog360Mode = conn.mode === 'sandbox' ? 'sandbox' : 'production';
      value = { http: this.dialog360.buildHttp(apiKey, mode), mode, apiKey };
    }
    this.cache.set(tenantId, { at: Date.now(), value });
    return value;
  }

  /** Invalidar al conectar/desconectar (el cambio aplica de inmediato). */
  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }
}
