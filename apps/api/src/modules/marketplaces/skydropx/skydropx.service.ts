import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type {
  SkydropxConnectionSummary,
  SkydropxCredentialsInput,
  SkydropxRate as SkydropxRateDto,
} from '@smartlogistica/shared';

import type { AuthContext } from '../../../common/types/authenticated-request';
import { EnvelopeService } from '../../../infrastructure/crypto/envelope.service';
import { getTenantContext } from '../../../infrastructure/tenant-context';
import {
  SkydropxClient,
  type SkydropxAddress,
  type SkydropxMode,
  type SkydropxParcel,
  type SkydropxRate,
} from './skydropx-client.service';

type Creds = { apiKey: string; apiSecret: string; mode: SkydropxMode };

/**
 * SKYDROPX: credenciales cifradas (una conexion por tenant) + cotizacion +
 * creacion de envio + rastreo. La logica DE PEDIDO (armar remitente/
 * destinatario, cierre, chat) vive en OrdersService — aqui solo el dominio
 * Skydropx puro.
 */
@Injectable()
export class SkydropxService {
  private readonly logger = new Logger(SkydropxService.name);
  private readonly credsCache = new Map<string, { at: number; value: Creds | null }>();

  constructor(
    private readonly client: SkydropxClient,
    private readonly envelope: EnvelopeService,
  ) {}

  private assertAdmin(auth: AuthContext): void {
    if (auth.role !== 'OWNER' && auth.role !== 'ADMIN') {
      throw new ForbiddenException('Solo administradores');
    }
  }

  // === Conexion ===

  async connect(input: SkydropxCredentialsInput, auth: AuthContext): Promise<SkydropxConnectionSummary> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();
    // Validar contra la API real ANTES de guardar (pide un token: rapido).
    try {
      await this.client.validate({ apiKey: input.apiKey, apiSecret: input.apiSecret, mode: input.mode });
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'error desconocido';
      // El 401 invalid_client casi siempre es llaves del OTRO ambiente: las
      // de sandbox no sirven en produccion y viceversa.
      const hint = /invalid_client|401/.test(detail)
        ? ` — OJO: las llaves son POR AMBIENTE. Para "${input.mode === 'production' ? 'Producción' : 'Sandbox'}" deben ser generadas en ${input.mode === 'production' ? 'pro.skydropx.com' : 'sb-pro.skydropx.com'} (Conexiones → API).`
        : '';
      throw new BadRequestException(`Skydropx no aceptó las credenciales: ${detail.slice(0, 260)}${hint}`);
    }
    const [encryptedApiKey, encryptedApiSecret] = await Promise.all([
      this.envelope.encryptField(tenantId, input.apiKey),
      this.envelope.encryptField(tenantId, input.apiSecret),
    ]);
    await prisma.skydropxConnection.deleteMany({});
    const conn = await prisma.skydropxConnection.create({
      data: { encryptedApiKey, encryptedApiSecret, mode: input.mode, status: 'connected', lastError: null },
    });
    this.credsCache.delete(tenantId);
    return { mode: input.mode, status: 'connected', lastError: null, createdAt: conn.createdAt.toISOString() };
  }

  async summary(auth: AuthContext): Promise<SkydropxConnectionSummary | null> {
    this.assertAdmin(auth);
    const { prisma } = getTenantContext();
    const conn = await prisma.skydropxConnection.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!conn) return null;
    return {
      mode: conn.mode === 'production' ? 'production' : 'sandbox',
      status: conn.status === 'error' ? 'error' : 'connected',
      lastError: conn.lastError,
      createdAt: conn.createdAt.toISOString(),
    };
  }

  async disconnect(auth: AuthContext): Promise<void> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();
    await prisma.skydropxConnection.deleteMany({});
    this.credsCache.delete(tenantId);
  }

  /** Credenciales listas (cache 60s). null = sin conexion. */
  async credsOrNull(): Promise<Creds | null> {
    const { tenantId, prisma } = getTenantContext();
    const hit = this.credsCache.get(tenantId);
    if (hit && Date.now() - hit.at < 60_000) return hit.value;
    const conn = await prisma.skydropxConnection.findFirst({ orderBy: { createdAt: 'desc' } });
    let value: Creds | null = null;
    if (conn) {
      const [apiKey, apiSecret] = await Promise.all([
        this.envelope.decryptField(tenantId, conn.encryptedApiKey),
        this.envelope.decryptField(tenantId, conn.encryptedApiSecret),
      ]);
      value = { apiKey, apiSecret, mode: conn.mode === 'production' ? 'production' : 'sandbox' };
    }
    this.credsCache.set(tenantId, { at: Date.now(), value });
    return value;
  }

  private async requireCreds(): Promise<Creds> {
    const creds = await this.credsOrNull();
    if (!creds) {
      throw new BadRequestException('Skydropx no esta conectado. Configura las credenciales primero.');
    }
    return creds;
  }

  // === Cotizacion / envio / rastreo ===

  /** Errores de Skydropx SIEMPRE como 400 con el detalle real (jamas un 500 mudo). */
  private asBadRequest(err: unknown, fallback: string): BadRequestException {
    if (err instanceof BadRequestException) return err;
    const detail = err instanceof Error ? err.message : String(err);
    this.logger.warn(`${fallback}: ${detail}`);
    return new BadRequestException(`Skydropx: ${detail.slice(0, 300)}`);
  }

  /** Cotiza y devuelve SOLO las tarifas DISPONIBLES (como el panel de ellos). */
  async quote(input: { from: SkydropxAddress; to: SkydropxAddress; parcel: SkydropxParcel }): Promise<{
    quotationId: string;
    rates: SkydropxRateDto[];
  }> {
    const creds = await this.requireCreds();
    let quotation;
    try {
      quotation = await this.client.quote(creds, input);
    } catch (err) {
      throw this.asBadRequest(err, 'Cotizacion Skydropx fallo');
    }
    const rates = (quotation.rates ?? [])
      .filter((r) => r.success && r.total != null)
      .map((r) => this.toRateDto(r))
      .sort((a, b) => a.total - b.total);
    return { quotationId: quotation.id, rates };
  }

  private toRateDto(r: SkydropxRate): SkydropxRateDto {
    return {
      id: r.id,
      carrier: r.provider_display_name || r.provider_name,
      carrierCode: r.provider_name,
      service: r.provider_service_name,
      total: Number(r.total ?? r.amount ?? 0),
      currency: r.currency_code,
      days: r.days,
      pickup: Boolean(r.pickup),
      officeDelivery: Boolean(r.office_delivery),
    };
  }

  /** Crea el envio y extrae (con tolerancia de forma) id/rastreo/etiqueta. */
  async createShipment(input: {
    rateId: string;
    from: SkydropxAddress;
    to: SkydropxAddress;
    parcel: SkydropxParcel;
    packageContent: string;
  }): Promise<{ shipmentId: string; trackingNumber: string; labelUrl: string | null; carrier: string | null; raw: Record<string, unknown> }> {
    const creds = await this.requireCreds();
    let raw: Record<string, unknown>;
    try {
      raw = await this.client.createShipment(creds, input);
    } catch (err) {
      throw this.asBadRequest(err, 'Creacion de envio Skydropx fallo');
    }
    const dig = (obj: unknown, keys: string[]): unknown => {
      if (!obj || typeof obj !== 'object') return undefined;
      const o = obj as Record<string, unknown>;
      for (const k of keys) if (o[k] != null) return o[k];
      return undefined;
    };
    const attrs = (dig(raw, ['data']) as Record<string, unknown> | undefined) ?? raw;
    const attributes = (dig(attrs, ['attributes']) as Record<string, unknown> | undefined) ?? attrs;
    const included = Array.isArray((raw as { included?: unknown[] }).included)
      ? ((raw as { included: Array<Record<string, unknown>> }).included ?? [])
      : [];
    const shipmentId = String(dig(attrs, ['id']) ?? dig(raw, ['id']) ?? '');
    const trackingNumber = String(
      dig(attributes, ['tracking_number', 'master_tracking_number', 'tracking']) ??
        dig(raw, ['tracking_number']) ??
        included.map((i) => dig((i.attributes ?? i) as Record<string, unknown>, ['tracking_number'])).find(Boolean) ??
        '',
    );
    const labelUrl =
      (dig(attributes, ['label_url', 'label']) as string | undefined) ??
      (included
        .map((i) => dig((i.attributes ?? i) as Record<string, unknown>, ['label_url', 'file_url', 'url']))
        .find((v) => typeof v === 'string' && String(v).includes('http')) as string | undefined) ??
      null;
    const carrier =
      (dig(attributes, ['provider_display_name', 'provider_name', 'carrier_name']) as string | undefined) ?? null;
    if (!shipmentId && !trackingNumber) {
      this.logger.warn(`Skydropx shipment sin id/rastreo reconocible: ${JSON.stringify(raw).slice(0, 600)}`);
      throw new BadRequestException('Skydropx creo el envio pero no devolvio numero de rastreo (revisar log)');
    }
    return { shipmentId, trackingNumber: trackingNumber || shipmentId, labelUrl, carrier, raw };
  }

  async downloadLabel(url: string): Promise<Buffer | null> {
    return this.client.downloadPdf(url);
  }

  /** Rastreo de un envio: estado canonico + texto + eventos. */
  async tracking(shipmentId: string): Promise<{
    state: 'sin_movimientos' | 'en_transito' | 'novedad' | 'entregado';
    statusText: string;
    carrier: string | null;
    trackingNumber: string | null;
    events: Array<{ date: string; description: string; location: string }>;
  } | null> {
    const creds = await this.credsOrNull();
    if (!creds) return null;
    try {
      const raw = await this.client.getShipment(creds, shipmentId);
      const attrs =
        ((raw as { data?: { attributes?: Record<string, unknown> } }).data?.attributes as
          | Record<string, unknown>
          | undefined) ?? (raw as Record<string, unknown>);
      const status = String(attrs.status ?? attrs.tracking_status ?? attrs.state ?? 'pending').toLowerCase();
      const eventsRaw = (attrs.tracking_events ?? attrs.events ?? []) as Array<Record<string, unknown>>;
      const events = (Array.isArray(eventsRaw) ? eventsRaw : []).map((e) => ({
        date: String(e.created_at ?? e.date ?? e.timestamp ?? ''),
        description: String(e.description ?? e.status ?? e.event ?? ''),
        location: String(e.location ?? e.city ?? ''),
      }));
      return {
        state: this.canonicalState(status),
        statusText: this.statusEs(status),
        carrier: (attrs.provider_display_name as string | undefined) ?? (attrs.provider_name as string | undefined) ?? null,
        trackingNumber: (attrs.tracking_number as string | undefined) ?? null,
        events,
      };
    } catch (err) {
      this.logger.warn(`Rastreo Skydropx ${shipmentId} fallo: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /** Mapa de estados Skydropx -> canonicos del negocio (mismos de la pastilla). */
  private canonicalState(status: string): 'sin_movimientos' | 'en_transito' | 'novedad' | 'entregado' {
    if (/deliver/.test(status)) return 'entregado';
    if (/exception|cancel|return|failed|incident/.test(status)) return 'novedad';
    if (/transit|picked|pickup|out_for|on_route|shipped|in_progress/.test(status)) return 'en_transito';
    return 'sin_movimientos';
  }

  private statusEs(status: string): string {
    const map: Record<string, string> = {
      pending: 'Pendiente de recoleccion',
      created: 'Guia creada',
      label_created: 'Guia creada',
      picked_up: 'Recogido en origen',
      in_transit: 'En transito',
      out_for_delivery: 'En reparto',
      delivered: 'Entregado',
      exception: 'Novedad en la entrega',
      cancelled: 'Cancelado',
      returned: 'Devuelto al remitente',
    };
    return map[status] ?? status.replace(/_/g, ' ');
  }
}
