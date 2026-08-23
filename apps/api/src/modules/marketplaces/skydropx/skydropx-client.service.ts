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

/** Origen: direccion cruda O una plantilla guardada/verificada del panel
 *  (address_template_id — Skydropx rellena el resto; las paqueterias que
 *  exigen origen VERIFICADO solo aceptan la plantilla). */
export type SkydropxOrigin = SkydropxAddress | { address_template_id: string };

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

  /**
   * OJO — los DOS ambientes hablan contratos DISTINTOS (verificado contra el
   * OpenAPI oficial api-pro.skydropx.com/api-docs.json y por probes):
   * - sandbox (sb-pro): API v1 "interna" — wrapper {quotation}, parcel objeto,
   *   declared_amount. Es la que responde 201 alla.
   * - produccion (api-pro): API v2 oficial — SIN wrapper, parcels[] con
   *   declared_value, area_level3 obligatorio.
   */
  baseUrl(mode: SkydropxMode): string {
    return mode === 'production' ? 'https://api-pro.skydropx.com' : 'https://sb-pro.skydropx.com';
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
      // El cuerpo ENVIADO va en el error: los 400 genericos de Skydropx no
      // dicen que estuvo mal — asi el propio toast/log lo delata. El
      // request-id es para que SOPORTE de Skydropx rastree la peticion.
      const reqId =
        res.headers.get('x-request-id') ?? res.headers.get('cf-ray') ?? res.headers.get('x-amzn-requestid');
      const sent = body !== undefined ? ` | enviado: ${JSON.stringify(body).slice(0, 600)}` : '';
      const rid = reqId ? ` | request-id: ${reqId}` : '';
      throw new Error(`Skydropx ${method} ${path} HTTP ${res.status}: ${text.slice(0, 220)}${sent}${rid}`);
    }
    return JSON.parse(text) as T;
  }

  /** Valida credenciales pidiendo un token (rapido: no cotiza nada). */
  async validate(creds: { apiKey: string; apiSecret: string; mode: SkydropxMode }): Promise<void> {
    await this.token(creds.apiKey, creds.apiSecret, creds.mode);
  }

  /** Desenvuelve la forma JSON:API (data.attributes) si viene asi. */
  private unwrapQuotation(raw: unknown): SkydropxQuotation {
    const o = (raw ?? {}) as Record<string, unknown>;
    const data = (o.data ?? o) as Record<string, unknown>;
    const attrs = ((data.attributes as Record<string, unknown> | undefined) ?? data) as Record<string, unknown>;
    return {
      id: String(data.id ?? o.id ?? attrs.id ?? ''),
      is_completed: Boolean(attrs.is_completed ?? o.is_completed),
      rates: (attrs.rates ?? o.rates ?? []) as SkydropxQuotation['rates'],
    };
  }

  /** Cotiza y ESPERA el resultado (poll hasta is_completed, max ~30s).
   * VERIFICADO EN VIVO: los DOS ambientes hablan el contrato v1 (wrapper
   * quotation + parcel + declared_amount); en produccion solo cambia el host
   * (api-pro). El v2 del OpenAPI responde 400 incluso con su propio ejemplo. */
  async quote(
    creds: { apiKey: string; apiSecret: string; mode: SkydropxMode },
    input: { from: SkydropxOrigin; to: SkydropxAddress; parcel: SkydropxParcel },
  ): Promise<SkydropxQuotation> {
    const path = '/api/v1/quotations';
    const body = {
      quotation: {
        address_from: input.from,
        address_to: input.to,
        parcel: input.parcel,
        declared_amount: input.parcel.declared_amount,
      },
    };
    const created = this.unwrapQuotation(await this.call<unknown>(creds, 'POST', path, body));
    if (created.is_completed) return created;
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const poll = this.unwrapQuotation(await this.call<unknown>(creds, 'GET', `${path}/${created.id}`));
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
      quotationId?: string;
      carrierName?: string;
      from: SkydropxOrigin;
      to: SkydropxAddress;
      parcel: SkydropxParcel;
      packageContent: string;
      /** Codigo del catalogo de embalajes ('4G' caja, '5H4' bolsa...). */
      packagingCode?: string;
    },
  ): Promise<Record<string, unknown>> {
    // El envio EXIGE reference no vacio en ambas direcciones (verificado 422).
    // Las plantillas (address_template_id) van tal cual: Skydropx rellena.
    const withRef = (a: SkydropxOrigin): SkydropxOrigin =>
      'address_template_id' in a
        ? a
        : {
            ...a,
            reference: a.reference?.trim() || a.area_level3?.trim() || a.area_level2 || 'N/A',
          };
    const pkgType = input.packagingCode?.trim() || 'box';
    return this.call<Record<string, unknown>>(creds, 'POST', '/api/v1/shipments', {
      shipment: {
        rate_id: input.rateId,
        ...(input.quotationId ? { quotation_id: input.quotationId } : {}),
        ...(input.carrierName ? { carrier_name: input.carrierName } : {}),
        // Solo SANDBOX: simula la progresion del tracking (created ->
        // picked_up -> in_transit -> delivered, un estado por minuto) — para
        // probar la pastilla de la bandeja y el toque 3 del respaldo.
        ...(creds.mode === 'sandbox' ? { auto_advance: true } : {}),
        printing_format: 'thermal',
        address_from: withRef(input.from),
        address_to: withRef(input.to) as SkydropxAddress,
        parcel: { ...input.parcel, package_type: pkgType, package_content: input.packageContent },
        parcels: [{ ...input.parcel, package_type: pkgType, package_content: input.packageContent }],
        package_type: pkgType,
        package_content: input.packageContent,
      },
    });
  }

  /** Direcciones guardadas en el panel de Skydropx (address templates). */
  async listAddressTemplates(
    creds: { apiKey: string; apiSecret: string; mode: SkydropxMode },
  ): Promise<Array<Record<string, unknown>>> {
    const res = await this.call<{ data?: Array<Record<string, unknown>> }>(
      creds,
      'GET',
      '/api/v1/address_templates?per_page=100',
    );
    return res.data ?? [];
  }

  /** Catalogo de TIPOS de embalaje (codigo ONU + nombre). */
  async listPackagings(
    creds: { apiKey: string; apiSecret: string; mode: SkydropxMode },
  ): Promise<Array<{ code: string; name: string }>> {
    const res = await this.call<{ data?: Array<{ code?: unknown; name?: unknown }> }>(
      creds,
      'GET',
      '/api/v1/shipments/packagings',
    );
    return (res.data ?? [])
      .filter((p) => p.code && p.name)
      .map((p) => ({ code: String(p.code), name: String(p.name) }));
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
