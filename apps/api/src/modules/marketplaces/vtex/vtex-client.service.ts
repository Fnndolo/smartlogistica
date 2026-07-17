import { Injectable, Logger } from '@nestjs/common';
import axios, { type AxiosInstance, type AxiosResponse } from 'axios';

import { EnvelopeService } from '../../../infrastructure/crypto/envelope.service';
import { TenantConnectionService } from '../../../infrastructure/prisma/tenant-connection.service';
import {
  VTEX_HEADERS,
  VTEX_HOST,
  VTEX_RELEVANT_STATUSES,
  VTEX_REQUEST_TIMEOUT_MS,
} from './vtex.constants';
import type {
  VtexOrderDetail,
  VtexOrderListResponse,
  VtexWebhookConfigRequest,
  VtexWebhookPayload,
} from './vtex.types';

export interface VtexCredentialsRaw {
  accountName: string;
  appKey: string;
  appToken: string;
}

/** Factura de salida a notificar en VTEX. `invoiceValue` en CENTAVOS. */
export interface VtexInvoicePayload {
  type: 'Output';
  issuanceDate: string; // ISO 8601
  invoiceNumber: string; // ej. "PA25879"
  invoiceValue: number; // centavos (igual que detail.value)
  invoiceKey?: string;
  invoiceUrl?: string;
  trackingNumber?: string; // numero de guia (Coordinadora)
  trackingUrl?: string;
  courier?: string; // "Transportadora estandar"
}

/**
 * Cliente VTEX OMS. Encapsula el acceso a la API de pedidos y la gestion de webhooks.
 *
 * Para llamar a VTEX en nombre de un tenant, usar `forTenant(tenantId, accountName)`
 * que descifra las credenciales y devuelve un Axios listo.
 *
 * Para validar credenciales antes de persistirlas (wizard), usar `testCredentials()`
 * que NO toca el tenant DB.
 */
@Injectable()
export class VtexClient {
  private readonly logger = new Logger(VtexClient.name);

  constructor(
    private readonly envelope: EnvelopeService,
    private readonly tenants: TenantConnectionService,
  ) {}

  // === Sin persistencia (wizard) ===

  buildHttp({ accountName, appKey, appToken }: VtexCredentialsRaw): AxiosInstance {
    return axios.create({
      baseURL: VTEX_HOST(accountName),
      timeout: VTEX_REQUEST_TIMEOUT_MS,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        [VTEX_HEADERS.appKey]: appKey,
        [VTEX_HEADERS.appToken]: appToken,
      },
    });
  }

  async testCredentials(creds: VtexCredentialsRaw): Promise<{ ok: true; sampleOrderCount: number }> {
    const http = this.buildHttp(creds);
    const res = await http.get<VtexOrderListResponse>('/api/oms/pvt/orders', {
      params: { per_page: 1, page: 1 },
    });
    return { ok: true, sampleOrderCount: res.data.paging?.total ?? 0 };
  }

  // === Con persistencia (operaciones recurrentes) ===

  async forTenant(tenantId: string, accountName: string): Promise<AxiosInstance> {
    const { client } = await this.tenants.getForTenant(tenantId);
    const conn = await client.marketplaceConnection.findUnique({
      where: { provider_accountName: { provider: 'vtex', accountName } },
    });
    if (!conn) {
      throw new Error(`No hay conexion VTEX para accountName=${accountName} en tenant=${tenantId}`);
    }
    const [appKey, appToken] = await Promise.all([
      this.envelope.decryptField(tenantId, conn.encryptedAppKey),
      this.envelope.decryptField(tenantId, conn.encryptedAppToken),
    ]);
    return this.buildHttp({ accountName, appKey, appToken });
  }

  // === Pedidos ===

  async listOrders(
    http: AxiosInstance,
    params: { status: string; page: number; perPage: number },
  ): Promise<VtexOrderListResponse> {
    const res: AxiosResponse<VtexOrderListResponse> = await http.get('/api/oms/pvt/orders', {
      params: {
        f_status: params.status,
        per_page: params.perPage,
        page: params.page,
      },
    });
    return res.data;
  }

  async getOrder(http: AxiosInstance, orderId: string): Promise<VtexOrderDetail> {
    const res: AxiosResponse<VtexOrderDetail> = await http.get(`/api/oms/pvt/orders/${encodeURIComponent(orderId)}`);
    return res.data;
  }

  // === Fulfillment (ESCRITURA — irreversible) ===

  /** Mueve el pedido de `ready-for-handling` a `handling`. Sin body. */
  async startHandling(http: AxiosInstance, orderId: string): Promise<void> {
    await http.post(`/api/oms/pvt/orders/${encodeURIComponent(orderId)}/start-handling`, {});
  }

  /**
   * Notifica la factura de salida (mueve el pedido a `invoiced`). El tracking
   * (numero de guia + url + transportadora) va en el mismo payload.
   */
  async notifyInvoice(
    http: AxiosInstance,
    orderId: string,
    payload: VtexInvoicePayload,
  ): Promise<{ invoiceNumber?: string } | null> {
    const res = await http.post<{ invoiceNumber?: string }>(
      `/api/oms/pvt/orders/${encodeURIComponent(orderId)}/invoice`,
      payload,
    );
    return res.data ?? null;
  }

  // === Webhooks ===

  async registerWebhook(
    http: AxiosInstance,
    args: { url: string; bearerSecret: string },
  ): Promise<void> {
    const body: VtexWebhookConfigRequest = {
      filter: {
        type: 'FromWorkflow',
        status: [...VTEX_RELEVANT_STATUSES],
      },
      hook: {
        url: args.url,
        headers: { Authorization: `Bearer ${args.bearerSecret}` },
      },
    };
    await http.post('/api/orders/hook/config', body);
    this.logger.log(`Webhook VTEX registrado → ${args.url}`);
  }

  async unregisterWebhook(http: AxiosInstance): Promise<void> {
    // VTEX limpia el hook anterior si se envia POST con un payload vacio o cambiando filter.
    // Tambien existe DELETE pero su comportamiento varia por cuenta. Best-effort:
    await http
      .post('/api/orders/hook/config', {
        filter: { type: 'FromWorkflow', status: [] },
        hook: { url: '', headers: {} },
      })
      .catch((err) => this.logger.warn({ err }, 'Failed to clear VTEX webhook (best-effort)'));
  }

  static readonly isRelevantStatus = (state: string): boolean =>
    (VTEX_RELEVANT_STATUSES as readonly string[]).includes(state);

  /** URL publica del webhook para un tenant+cuenta (incluye el prefijo global v1). */
  static webhookUrl(base: string, tenantSlug: string, accountName: string): string {
    return `${base.replace(/\/$/, '')}/v1/webhooks/marketplace/vtex/${encodeURIComponent(
      tenantSlug,
    )}?account=${encodeURIComponent(accountName)}`;
  }

  // Separador `__` (no `:`) porque el eventId se usa para construir BullMQ jobIds
  // y BullMQ reserva `:` para keys Redis.
  static readonly extractWebhookEventId = (payload: VtexWebhookPayload): string =>
    `${payload.OrderId}__${payload.State}__${payload.LastChange}`;
}
