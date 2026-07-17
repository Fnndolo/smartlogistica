import { Injectable, Logger } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';

import { EnvelopeService } from '../../../infrastructure/crypto/envelope.service';
import { TenantConnectionService } from '../../../infrastructure/prisma/tenant-connection.service';
import { ALEGRA_BASE_URL, ALEGRA_REQUEST_TIMEOUT_MS } from './alegra.constants';

export interface AlegraCredentialsRaw {
  email: string;
  token: string;
}

interface AlegraCompanyResponse {
  name?: string;
}

/** Linea de una factura de compra. El/los IMEI viven en observations/description. */
export interface AlegraBillLine {
  name?: string | null;
  price?: number | string | null;
  observations?: string | null;
  description?: string | null;
}

/** Factura de compra (bill). Solo tipamos lo que usamos para el indice. */
export interface AlegraBillDetail {
  id: number | string;
  date?: string | null;
  provider?: { name?: string | null } | null;
  numberTemplate?: { fullNumber?: string | null } | null;
  billNumber?: string | null;
  purchases?: { items?: AlegraBillLine[] } | null;
  items?: AlegraBillLine[];
}

/**
 * Cliente del sistema contable Alegra. Auth = HTTP Basic `email:token`.
 *
 * - `testCredentials()` valida credenciales sin tocar el tenant DB (wizard/conectar).
 * - `forWarehouse()` descifra las credenciales guardadas de una sede y devuelve un
 *   Axios listo (lo usaran los flujos de facturacion mas adelante).
 */
@Injectable()
export class AlegraClient {
  private readonly logger = new Logger(AlegraClient.name);

  constructor(
    private readonly envelope: EnvelopeService,
    private readonly tenants: TenantConnectionService,
  ) {}

  buildHttp({ email, token }: AlegraCredentialsRaw): AxiosInstance {
    const basic = Buffer.from(`${email}:${token}`).toString('base64');
    return axios.create({
      baseURL: ALEGRA_BASE_URL,
      timeout: ALEGRA_REQUEST_TIMEOUT_MS,
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${basic}`,
      },
    });
  }

  /**
   * Verifica credenciales pegandole a `/company` (endpoint liviano que toda cuenta
   * Alegra expone). 200 => validas; 401 => rechazadas. Devuelve el nombre de la
   * empresa para mostrarlo como confirmacion en la UI.
   */
  async testCredentials(creds: AlegraCredentialsRaw): Promise<{ ok: true; companyName: string | null }> {
    const http = this.buildHttp(creds);
    const res = await http.get<AlegraCompanyResponse>('/company');
    return { ok: true, companyName: res.data?.name ?? null };
  }

  /** Axios autenticado para la conexion Alegra de una sede (descifra el token). */
  async forWarehouse(tenantId: string, warehouseId: string): Promise<AxiosInstance> {
    const { client } = await this.tenants.getForTenant(tenantId);
    const conn = await client.alegraConnection.findUnique({ where: { warehouseId } });
    if (!conn) {
      throw new Error(`No hay conexion Alegra para warehouse=${warehouseId} en tenant=${tenantId}`);
    }
    const token = await this.envelope.decryptField(tenantId, conn.encryptedToken);
    return this.buildHttp({ email: conn.email, token });
  }

  // === Facturas de compra (bills) — para el indice por IMEI ===

  /** Lista facturas de compra, mas nuevas primero. Devuelve el array crudo. */
  async listBills(
    http: AxiosInstance,
    params: { start: number; limit: number },
  ): Promise<AlegraBillDetail[]> {
    const res = await http.get('/bills', {
      params: {
        start: params.start,
        limit: params.limit,
        order_field: 'date',
        order_direction: 'DESC',
      },
    });
    if (Array.isArray(res.data)) return res.data;
    return res.data?.data ?? res.data?.bills ?? [];
  }

  /** Detalle de una factura de compra (incluye purchases.items con las observaciones). */
  async getBill(http: AxiosInstance, id: string): Promise<AlegraBillDetail> {
    const res = await http.get<AlegraBillDetail>(`/bills/${encodeURIComponent(id)}`);
    return res.data;
  }

  // === Items / contactos / cuentas / facturas de venta (para facturar) ===

  /** Busca items del catalogo de Alegra por texto (nombre/referencia). */
  async searchItems(http: AxiosInstance, query: string): Promise<AlegraRawItem[]> {
    const res = await http.get('/items', { params: { query, limit: 30 } });
    return Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
  }

  /** Lista facturas de venta, mas nuevas primero (para traer la ultima). */
  async listInvoices(
    http: AxiosInstance,
    params: { limit: number },
  ): Promise<Array<{ id: number | string }>> {
    const res = await http.get('/invoices', {
      params: { limit: params.limit, order_field: 'date', order_direction: 'DESC' },
    });
    return Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
  }

  /** Item por id (para leer el precio de venta). */
  async getItem(http: AxiosInstance, id: string): Promise<AlegraRawItem | null> {
    try {
      const res = await http.get<AlegraRawItem>(`/items/${encodeURIComponent(id)}`);
      return res.data;
    } catch {
      return null;
    }
  }

  /** Busca un contacto por identificacion (cedula/NIT). Devuelve el primero o null. */
  async findContactByIdentification(
    http: AxiosInstance,
    identification: string,
  ): Promise<{ id: number | string } | null> {
    const res = await http.get('/contacts', { params: { identification, limit: 1 } });
    const list = Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
    return list[0] ?? null;
  }

  async createContact(
    http: AxiosInstance,
    body: AlegraContactPayload,
  ): Promise<{ id: number | string }> {
    const res = await http.post('/contacts', cleanContact(body));
    return res.data;
  }

  /** Actualiza un contacto existente (PUT; solo los campos con valor). */
  async updateContact(
    http: AxiosInstance,
    id: number | string,
    body: AlegraContactPayload,
  ): Promise<void> {
    await http.put(`/contacts/${encodeURIComponent(String(id))}`, cleanContact(body));
  }

  /** Cuentas bancarias (para resolver "MARKETPLACE ADDI"). */
  async listBankAccounts(http: AxiosInstance): Promise<AlegraBankAccount[]> {
    const res = await http.get('/bank-accounts');
    return Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
  }

  /** Crea una factura de venta. `body` ya viene con client/items/date/payments. */
  async createInvoice(http: AxiosInstance, body: unknown): Promise<AlegraInvoiceResult> {
    const res = await http.post<AlegraInvoiceResult>('/invoices', body);
    return res.data;
  }

  /**
   * PDF de una factura. Alegra lo expone en `?fields=pdf` como una URL de CDN
   * (publica); descargamos esa URL y devolvemos el binario. null si no hay PDF.
   */
  async getInvoicePdf(http: AxiosInstance, invoiceId: string): Promise<Buffer | null> {
    const res = await http.get(`/invoices/${encodeURIComponent(invoiceId)}`, {
      params: { fields: 'pdf' },
    });
    const url = (res.data as { pdf?: unknown })?.pdf;
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return null;
    const pdf = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 30_000 });
    return Buffer.from(pdf.data);
  }
}

/** Cuenta bancaria de Alegra (se cachea por sede para no pedirla en cada factura). */
export interface AlegraBankAccount {
  id: number | string;
  name?: string;
}

export interface AlegraRawItem {
  id: number | string;
  name?: string;
  reference?: string | null;
  // price puede ser numero, string, o array de listas de precio.
  price?: number | string | Array<{ price?: number | string; idPriceList?: number | string }> | null;
}

export interface AlegraInvoiceResult {
  id: number | string;
  numberTemplate?: { fullNumber?: string } | null;
  status?: string;
  total?: number | string;
  balance?: number | string;
  // Codigos reales de Alegra (para el Certificado): CASH|CREDIT y
  // DEBIT_TRANSFER|CREDIT_TRANSFER|CASH|DEBIT_CARD|... (ver mapeo en alegra.service).
  paymentForm?: string;
  paymentMethod?: string;
}

export interface AlegraContactPayload {
  name: string;
  // Alegra exige nameObject para personas (PERSON_ENTITY).
  nameObject?: { firstName: string; secondName?: string; lastName: string; secondLastName?: string };
  identification?: string | null;
  identificationObject?: { type: string; number: string };
  kindOfPerson?: string;
  regime?: string;
  type?: string[];
  email?: string | null;
  phonePrimary?: string | null;
  address?: {
    address?: string | null;
    city?: string | null;
    department?: string | null;
    country?: string | null;
    zipCode?: string | null;
  } | null;
}

/** Arma el body quitando nulos/vacios. */
function cleanContact(body: AlegraContactPayload): Record<string, unknown> {
  const out: Record<string, unknown> = { name: body.name };
  if (body.nameObject) out.nameObject = body.nameObject;
  if (body.identification) out.identification = body.identification;
  if (body.identificationObject) out.identificationObject = body.identificationObject;
  if (body.kindOfPerson) out.kindOfPerson = body.kindOfPerson;
  if (body.regime) out.regime = body.regime;
  if (body.type) out.type = body.type;
  if (body.email) out.email = body.email;
  if (body.phonePrimary) out.phonePrimary = body.phonePrimary;
  if (body.address) {
    const a = body.address;
    const addr: Record<string, unknown> = {};
    if (a.address) addr.address = a.address;
    if (a.city) addr.city = a.city;
    if (a.department) addr.department = a.department;
    if (a.country) addr.country = a.country;
    if (a.zipCode) addr.zipCode = a.zipCode;
    if (Object.keys(addr).length > 0) out.address = addr;
  }
  return out;
}
