import { Injectable } from '@nestjs/common';
import type { AxiosInstance } from 'axios';
import type { Dialog360Mode, WaProvider } from '@smartlogistica/shared';
import type { PrismaClient } from '.prisma/tenant-client';

import { EnvelopeService } from '../../infrastructure/crypto/envelope.service';
import { Dialog360Client } from './dialog360-client.service';
import { WaClientFactory } from './wa-client.factory';
import type { WaClient } from './wa-client.port';

/**
 * Credenciales de WhatsApp LISTAS para usar. Servicio propio porque lo
 * necesitan DOS lados: los envios (WhatsappService) y la recepcion
 * (WhatsappWebhookService) — asi ninguno depende del otro.
 */
type D360Ready = {
  /** Con QUE se habla. Es lo unico que deberia usar el codigo de negocio: no
   *  sabe ni le importa si detras hay 360dialog o la API nativa de Meta. */
  client: WaClient;
  /** Sigue aqui porque las guardas de sandbox son de 360dialog y las lee el
   *  negocio. `http` y `apiKey` NO estan a proposito: sacarlos convirtio en
   *  error de compilacion cualquier sitio que siguiera hablando con el
   *  proveedor a mano en vez de por el puerto. */
  mode: Dialog360Mode;
  /** Que LINEA es. Viaja con las credenciales para poder sellar cada mensaje
   *  con el numero por el que salio, sin volver a consultar. */
  lineId: string;
  label: string;
  provider: WaProvider;
  /** Solo con la API nativa de Meta (en 360dialog van null). */
  phoneNumberId: string | null;
  wabaId: string | null;
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
    private readonly clients: WaClientFactory,
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
        client: this.clients.create(conn, apiKey),
        mode,
        lineId: conn.id,
        label: conn.label,
        provider: conn.provider === 'meta' ? 'meta' : 'dialog360',
        phoneNumberId: conn.phoneNumberId,
        wabaId: conn.wabaId,
      };
    }
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  /** Cuantas lineas hay. Cacheado: con una sola, enrutar por chat sobra. */
  private readonly countCache = new Map<string, { at: number; n: number }>();

  /**
   * Credenciales de la linea por la que se habla con ESTE telefono: la del
   * ULTIMO mensaje de ese chat.
   *
   * Con un solo numero conectado no cambia absolutamente nada — se usa el de
   * siempre y ni siquiera se paga una consulta extra. Con dos, es lo que evita
   * contestarle al cliente desde un numero distinto del que el uso: para el
   * seria otra conversacion, en otro hilo de su celular.
   */
  async forPhone(tenantId: string, prisma: PrismaClient, phone: string): Promise<D360Ready> {
    const hit = this.countCache.get(tenantId);
    let lines = hit && Date.now() - hit.at < CREDS_TTL_MS ? hit.n : null;
    if (lines === null) {
      lines = await prisma.waLine.count();
      this.countCache.set(tenantId, { at: Date.now(), n: lines });
    }
    if (lines <= 1 || phone.length < 7) return this.forLine(tenantId, prisma, null);

    const last = await prisma.waMessage.findFirst({
      where: { phone, lineId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { lineId: true },
    });
    return this.forLine(tenantId, prisma, last?.lineId ?? null);
  }

  /** Invalidar al conectar/desconectar. Barre TODAS las lineas del tenant. */
  invalidate(tenantId: string): void {
    this.countCache.delete(tenantId);
    for (const key of this.cache.keys()) {
      if (key === tenantId || key.startsWith(`${tenantId}:`)) this.cache.delete(key);
    }
  }
}
