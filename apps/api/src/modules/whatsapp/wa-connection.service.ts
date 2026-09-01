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
type D360Ready = {
  http: AxiosInstance;
  mode: Dialog360Mode;
  apiKey: string;
  /** Que LINEA es. Viaja con las credenciales para poder sellar cada mensaje
   *  con el numero por el que salio, sin volver a consultar. */
  lineId: string;
  label: string;
  provider: string;
} | null;

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

  /**
   * Credenciales de la linea PREDETERMINADA (null si no hay ninguna). Prisma
   * explicito: lo usa tambien el webhook.
   *
   * Es el respaldo cuando nadie dice por que linea va. Para responder a un
   * mensaje ENTRANTE hay que usar `forLine()` con la linea del webhook: nunca
   * se le contesta a un cliente por un numero distinto del que uso.
   */
  async dialog360OrNull(tenantId: string, prisma: PrismaClient): Promise<D360Ready> {
    return this.forLine(tenantId, prisma, null);
  }

  /**
   * Credenciales de UNA linea concreta (o de la predeterminada si `lineId` es
   * null). Cachea por linea, no por tenant: con dos numeros, una sola entrada
   * por tenant devolveria las credenciales del otro.
   */
  async forLine(tenantId: string, prisma: PrismaClient, lineId: string | null): Promise<D360Ready> {
    const key = `${tenantId}:${lineId ?? '*'}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CREDS_TTL_MS) return hit.value;

    const conn = lineId
      ? await prisma.waLine.findUnique({ where: { id: lineId } })
      : await prisma.waLine.findFirst({ orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });

    let value: D360Ready = null;
    if (conn) {
      const apiKey = await this.envelope.decryptField(tenantId, conn.encryptedApiKey);
      const mode: Dialog360Mode = conn.mode === 'sandbox' ? 'sandbox' : 'production';
      value = {
        http: this.dialog360.buildHttp(apiKey, mode),
        mode,
        apiKey,
        lineId: conn.id,
        label: conn.label,
        provider: conn.provider,
      };
    }
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  /** Invalidar al conectar/desconectar. Barre TODAS las lineas del tenant. */
  invalidate(tenantId: string): void {
    for (const key of this.cache.keys()) {
      if (key === tenantId || key.startsWith(`${tenantId}:`)) this.cache.delete(key);
    }
  }
}
