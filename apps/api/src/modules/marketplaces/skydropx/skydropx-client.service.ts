import { Injectable, Logger } from '@nestjs/common';

/**
 * Cliente CRUDO de la API Pro de Skydropx (agregador multi-transportadora).
 * Contrato VERIFICADO por probe (scripts/probe-skydropx.mjs):
 * - sandbox https://sb-pro.skydropx.com | produccion https://pro.skydropx.com
 * - OAuth client_credentials JSON en /api/v1/oauth/token (token ~2h)
 * - Cotizacion ASINCRONA: POST /api/v1/quotations -> poll GET /quotations/:id
 *   hasta is_completed. El valor declarado va DENTRO de parcel
 *   (parcel.declared_amount) — a nivel raiz tambien es obligatorio.
 * - Envio: POST /api/v1/shipments (rate_id + direcciones completas +
 *   package_type/package_content).
 * - Limite de 2 req/s.
 */

export type SkydropxMode = 'sandbox' | 'production';

export interface SkydropxAddress {
  country_code: string;
  postal_code: string;
  area_level1: string; // departamento
  area_level2: string; // ciudad
  area_level3: string; // barrio/zona (puede ir vacio)
  street1?: string;
  name?: string;
  company?: string;
  phone?: string;
  email?: string;
  reference?: string;
}

export interface SkydropxParcel {
  length: number;
  width: number;
  height: number;
  weight: number;
  declared_amount: number;
}

export interface SkydropxRate {
  id: string;
  provider_name: string;
  provider_display_name: string;
  provider_service_name: string | null;
  provider_service_code: string | null;
  success: boolean;
  status: string;
  total: number | string | null;
  amount: number | string | null;
  currency_code: string | null;
  days: number | null;
  error_messages: Array<{ error_type?: string; error_message?: string }> | null;
  pickup?: boolean;
  office_delivery?: boolean;
}

export interface SkydropxQuotation {
  id: string;
  is_completed: boolean;
  rates: SkydropxRate[];
}

@Injectable()
export class SkydropxClient {
  private readonly logger = new Logger(SkydropxClient.name);
  /** Token OAuth cacheado por credencial (expira 2h; renovamos a los 100min). */
  private readonly tokenCache = new Map<string, { token: string; at: number }>();

  baseUrl(mode: SkydropxMode): string {
    return mode === 'production' ? 'https://pro.skydropx.com' : 'https://sb-pro.skydropx.com';
  }

  private async token(apiKey: string, apiSecret: string, mode: SkydropxMode): Promise<string> {
    const cacheKey = `${mode}:${apiKey}`;
    const hit = this.tokenCache.get(cacheKey);
    if (hit && Date.now() - hit.at < 100 * 60_000) return hit.token;
    const res = await fetch(`${this.baseUrl(mode)}/api/v1/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: apiKey, client_secret: apiSecret, grant_type: 'client_credentials' }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`Skydropx OAuth fallo (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    const body = (await res.json()) as { access_token?: string };
    if (!body.access_token) throw new Error('Skydropx OAuth sin access_token');
    this.tokenCache.set(cacheKey, { token: body.access_token, at: Date.now() });
    return body.access_token;
  }

  private async call<T>(
    creds: { apiKey: string; apiSecret: string; mode: SkydropxMode },
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const token = await this.token(creds.apiKey, creds.apiSecret, creds.mode);
    const res = await fetch(`${this.baseUrl(creds.mode)}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(45_000),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Skydropx ${method} ${path} HTTP ${res.status}: ${text.slice(0, 400)}`);
    }
    return JSON.parse(text) as T;
  }

  /** Cotiza y ESPERA el resultado (poll hasta is_completed, max ~30s). */
  async quote(
    creds: { apiKey: string; apiSecret: string; mode: SkydropxMode },
    input: { from: SkydropxAddress; to: SkydropxAddress; parcel: SkydropxParcel },
  ): Promise<SkydropxQuotation> {
    const created = await this.call<SkydropxQuotation>(creds, 'POST', '/api/v1/quotations', {
      quotation: {
        address_from: input.from,
        address_to: input.to,
        parcel: input.parcel,
        declared_amount: input.parcel.declared_amount,
      },
    });
    if (created.is_completed) return created;
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const poll = await this.call<SkydropxQuotation>(creds, 'GET', `/api/v1/quotations/${created.id}`);
      if (poll.is_completed) return poll;
    }
    this.logger.warn(`Cotizacion Skydropx ${created.id} no completo a tiempo; se devuelve parcial`);
    return created;
  }

  /**
   * Crea el ENVIO sobre una rate cotizada. Devuelve el payload crudo: el id,
   * numero de rastreo y URL de la etiqueta viven en posiciones que varian
   * segun transportadora — el service las extrae con tolerancia.
   */
  async createShipment(
    creds: { apiKey: string; apiSecret: string; mode: SkydropxMode },
    input: {
      rateId: string;
      from: SkydropxAddress;
      to: SkydropxAddress;
      parcel: SkydropxParcel;
      packageContent: string;
    },
  ): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>(creds, 'POST', '/api/v1/shipments', {
      shipment: {
        rate_id: input.rateId,
        address_from: input.from,
        address_to: input.to,
        parcel: { ...input.parcel, package_type: 'box', package_content: input.packageContent },
        parcels: [{ ...input.parcel, package_type: 'box', package_content: input.packageContent }],
        package_type: 'box',
        package_content: input.packageContent,
      },
    });
  }

  /** Estado/eventos de un envio (para el rastreo). */
  async getShipment(
    creds: { apiKey: string; apiSecret: string; mode: SkydropxMode },
    shipmentId: string,
  ): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>(creds, 'GET', `/api/v1/shipments/${shipmentId}`);
  }

  /** Descarga un PDF (etiqueta) desde la URL que devuelve el envio. */
  async downloadPdf(url: string): Promise<Buffer | null> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.subarray(0, 4).toString('latin1') === '%PDF' ? buf : buf; // algunas vienen sin magic claro
    } catch {
      return null;
    }
  }
}
