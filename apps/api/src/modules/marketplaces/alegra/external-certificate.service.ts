import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios, { AxiosError, type AxiosInstance } from 'axios';
import {
  externalCertificateConfigSchema,
  type ExternalCertificateSave,
  type ExternalCertificateSummary,
} from '@smartlogistica/shared';

import { isAdmin } from '../../../common/rbac';
import type { AuthContext } from '../../../common/types/authenticated-request';
import { EnvelopeService } from '../../../infrastructure/crypto/envelope.service';
import { getTenantContext } from '../../../infrastructure/tenant-context';
import { WarehousesService } from '../../warehouses/warehouses.service';

/** Un item tal como lo espera el emisor externo. */
export interface ExternalCertificateItem {
  product: string;
  description?: string;
  price: number;
  quantity: number;
  discount?: number;
}

export interface ExternalCertificateInput {
  clientName: string;
  clientCedula?: string;
  clientAddress?: string;
  clientPhone?: string;
  items: ExternalCertificateItem[];
}

/** Lo que devuelve el emisor externo al crear un certificado. */
interface RemoteCertificate {
  id: number;
  number: number;
  reference: string;
  createdAt: string;
  pdfBase64?: string;
  client?: { cedula?: string | null };
}

const REQUEST_TIMEOUT_MS = 20_000;
/** Esperas entre intentos. 3 intentos en total. */
const RETRY_DELAYS_MS = [2_000, 5_000];
/** Ventana para dar por "nuestro" un certificado que aparecio tras un timeout. */
const RECONCILE_WINDOW_MS = 3 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Emision de certificados de garantia en un servicio EXTERNO por API
 * (hoy, el generador de Eleven Store).
 *
 * Se usa solo cuando la sede tiene certificateMode = 'external'. A diferencia
 * de la plantilla, aqui el PDF no se deriva de la factura de Alegra: el emisor
 * externo crea el documento con su propio consecutivo y nos lo devuelve.
 */
@Injectable()
export class ExternalCertificateService {
  private readonly logger = new Logger(ExternalCertificateService.name);

  constructor(
    private readonly envelope: EnvelopeService,
    private readonly warehouses: WarehousesService,
  ) {}

  // === Configuracion (solo admin) ===

  async getConfig(
    warehouseId: string,
    auth: AuthContext,
  ): Promise<ExternalCertificateSummary | null> {
    if (!isAdmin(auth)) throw new ForbiddenException('Solo administradores');
    await this.assertAccess(warehouseId, auth);
    const { prisma } = getTenantContext();
    const row = await prisma.externalCertificateConnection.findUnique({ where: { warehouseId } });
    if (!row) return null;
    return {
      baseUrl: row.baseUrl,
      paymentMethod: row.paymentMethod,
      hasApiKey: row.encryptedApiKey.length > 0,
      status: row.status === 'error' ? 'error' : 'connected',
      lastError: row.lastError,
    };
  }

  /**
   * Guarda la conexion. `apiKey` solo viene cuando se cambia: si no llega, se
   * conserva la que ya estaba (asi se puede editar la URL sin volver a pegarla).
   */
  async saveConfig(
    warehouseId: string,
    input: ExternalCertificateSave,
    auth: AuthContext,
  ): Promise<ExternalCertificateSummary> {
    if (!isAdmin(auth)) throw new ForbiddenException('Solo administradores');
    await this.assertAccess(warehouseId, auth);
    const { tenantId, prisma } = getTenantContext();
    const config = externalCertificateConfigSchema.parse(input);

    const existing = await prisma.externalCertificateConnection.findUnique({
      where: { warehouseId },
    });
    if (!input.apiKey && !existing) {
      throw new NotFoundException('Falta la API key del emisor de certificados.');
    }
    const encryptedApiKey = input.apiKey
      ? await this.envelope.encryptField(tenantId, input.apiKey)
      : existing!.encryptedApiKey;

    const row = await prisma.externalCertificateConnection.upsert({
      where: { warehouseId },
      create: {
        warehouseId,
        baseUrl: config.baseUrl,
        paymentMethod: config.paymentMethod,
        encryptedApiKey,
        status: 'connected',
        lastError: null,
      },
      update: {
        baseUrl: config.baseUrl,
        paymentMethod: config.paymentMethod,
        encryptedApiKey,
        // Al reconfigurar se limpia el error viejo: puede ser justo lo que se
        // vino a arreglar (clave revocada, URL equivocada).
        status: 'connected',
        lastError: null,
      },
    });
    return {
      baseUrl: row.baseUrl,
      paymentMethod: row.paymentMethod,
      hasApiKey: true,
      status: 'connected',
      lastError: null,
    };
  }

  async deleteConfig(warehouseId: string, auth: AuthContext): Promise<void> {
    if (!isAdmin(auth)) throw new ForbiddenException('Solo administradores');
    await this.assertAccess(warehouseId, auth);
    const { prisma } = getTenantContext();
    await prisma.externalCertificateConnection.deleteMany({ where: { warehouseId } });
  }

  /**
   * Prueba la conexion SIN emitir nada: pide los datos del emisor. Sirve para
   * validar la clave antes de que una factura real dependa de ella.
   */
  async test(
    warehouseId: string,
    auth: AuthContext,
  ): Promise<{ ok: true; issuer: string; paymentMethods: string[] } | { ok: false; error: string }> {
    if (!isAdmin(auth)) throw new ForbiddenException('Solo administradores');
    await this.assertAccess(warehouseId, auth);
    try {
      const http = await this.httpFor(warehouseId);
      const { data } = await http.get<{ name?: string; paymentMethods?: string[] }>(
        '/api/v1/issuer',
      );
      await this.markStatus(warehouseId, null);
      return {
        ok: true,
        issuer: data?.name ?? 'Emisor externo',
        paymentMethods: Array.isArray(data?.paymentMethods) ? data.paymentMethods : [],
      };
    } catch (err) {
      const message = describe(err);
      await this.markStatus(warehouseId, message);
      return { ok: false, error: message };
    }
  }

  /** Medios de pago que acepta el emisor (para el desplegable de los ajustes). */
  async paymentMethods(warehouseId: string, auth: AuthContext): Promise<string[]> {
    const result = await this.test(warehouseId, auth);
    return result.ok ? result.paymentMethods : [];
  }

  // === Emision ===

  /**
   * Emite el certificado y devuelve su PDF. Reintenta los fallos que dejan la
   * peticion sin efecto; ante un fallo AMBIGUO (timeout, 5xx) primero pregunta
   * si el certificado alcanzo a crearse, para no gastar otro consecutivo.
   */
  async issue(
    warehouseId: string,
    input: ExternalCertificateInput,
  ): Promise<{ pdf: Buffer; number: number; reference: string }> {
    const { prisma } = getTenantContext();
    const conn = await prisma.externalCertificateConnection.findUnique({ where: { warehouseId } });
    if (!conn) throw new Error('la sede no tiene configurado el emisor de certificados');

    const http = await this.httpFor(warehouseId);
    const body = {
      clientName: input.clientName,
      clientCedula: input.clientCedula ?? '',
      clientAddress: input.clientAddress ?? '',
      clientPhone: input.clientPhone ?? '',
      paymentMethod: conn.paymentMethod,
      items: input.items,
      // El PDF llega en la misma respuesta: sin esto habria que pedirlo aparte
      // y el documento tarda mas en aparecer en el chat.
      pdf: 'base64' as const,
    };

    const startedAt = Date.now();
    let lastError: unknown;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      if (attempt > 0) {
        // Antes de reintentar: si el intento anterior pudo haber creado el
        // certificado, se busca en vez de crear uno nuevo.
        if (isAmbiguous(lastError) && input.clientCedula) {
          const found = await this.findRecent(http, input.clientCedula, startedAt).catch(() => null);
          if (found) {
            this.logger.warn(
              `Certificado ${found.reference} ya se habia creado pese al error; se reutiliza.`,
            );
            const pdf = await this.downloadPdf(http, found.id);
            await this.markStatus(warehouseId, null);
            return { pdf, number: found.number, reference: found.reference };
          }
        }
        await sleep(RETRY_DELAYS_MS[attempt - 1]!);
      }

      try {
        const { data } = await http.post<RemoteCertificate>('/api/v1/certificates', body);
        const pdf = data.pdfBase64
          ? Buffer.from(data.pdfBase64, 'base64')
          : await this.downloadPdf(http, data.id);
        await this.markStatus(warehouseId, null);
        return { pdf, number: data.number, reference: data.reference };
      } catch (err) {
        lastError = err;
        // Un rechazo definitivo (clave mala, datos invalidos) no mejora
        // reintentando: se corta de una.
        if (isPermanent(err)) break;
        this.logger.warn(
          `Intento ${attempt + 1} de emitir el certificado externo fallo: ${describe(err)}`,
        );
      }
    }

    const message = describe(lastError);
    await this.markStatus(warehouseId, message);
    throw new Error(message);
  }

  // === Interno ===

  private async httpFor(warehouseId: string): Promise<AxiosInstance> {
    const { tenantId, prisma } = getTenantContext();
    const conn = await prisma.externalCertificateConnection.findUnique({ where: { warehouseId } });
    if (!conn) throw new NotFoundException('Esta sede no tiene emisor de certificados configurado.');
    const apiKey = await this.envelope.decryptField(tenantId, conn.encryptedApiKey);
    return axios.create({
      baseURL: conn.baseUrl,
      timeout: REQUEST_TIMEOUT_MS,
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
      // Los 4xx/5xx se manejan como excepciones (comportamiento por defecto).
      validateStatus: (s) => s >= 200 && s < 300,
    });
  }

  /** Certificado de esa cedula emitido despues de `since`. null si no hay. */
  private async findRecent(
    http: AxiosInstance,
    cedula: string,
    since: number,
  ): Promise<RemoteCertificate | null> {
    const { data } = await http.get<{ data?: RemoteCertificate[] }>('/api/v1/certificates', {
      params: { cedula, limit: 5 },
    });
    const rows = data?.data ?? [];
    const floor = since - RECONCILE_WINDOW_MS;
    for (const row of rows) {
      const at = Date.parse(row.createdAt);
      if (Number.isFinite(at) && at >= floor) return row;
    }
    return null;
  }

  private async downloadPdf(http: AxiosInstance, id: number): Promise<Buffer> {
    const { data } = await http.get<ArrayBuffer>(`/api/v1/certificates/${id}/pdf`, {
      responseType: 'arraybuffer',
    });
    return Buffer.from(data);
  }

  /** Deja el ultimo error a la vista en los ajustes de la sede. */
  private async markStatus(warehouseId: string, error: string | null): Promise<void> {
    const { prisma } = getTenantContext();
    await prisma.externalCertificateConnection
      .update({
        where: { warehouseId },
        data: { status: error ? 'error' : 'connected', lastError: error?.slice(0, 500) ?? null },
      })
      .catch(() => null);
  }

  private async assertAccess(warehouseId: string, auth: AuthContext): Promise<void> {
    const { prisma } = getTenantContext();
    const wh = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
    if (!wh || wh.archived) throw new NotFoundException('Sede no encontrada');
    const allowed = await this.warehouses.accessibleWarehouseIds(auth);
    if (allowed && !allowed.includes(warehouseId)) {
      throw new ForbiddenException('Sin acceso a esta sede');
    }
  }
}

/** El fallo dejo la peticion SIN efecto seguro -> reintentar es seguro. */
function isPermanent(err: unknown): boolean {
  const status = (err as AxiosError)?.response?.status;
  if (status == null) return false;
  // 401/403 clave mala o sin permiso, 422 datos invalidos, 400 peticion mal
  // formada: reintentar da exactamente lo mismo.
  return status === 400 || status === 401 || status === 403 || status === 422;
}

/**
 * El fallo pudo dejar el certificado CREADO igual (timeout tras enviar, 5xx a
 * mitad de camino). Antes de reintentar hay que comprobar.
 */
function isAmbiguous(err: unknown): boolean {
  const e = err as AxiosError;
  if (e?.code === 'ECONNABORTED' || e?.code === 'ETIMEDOUT') return true;
  const status = e?.response?.status;
  return status != null && status >= 500;
}

/** Mensaje corto y legible para el chat y para los ajustes de la sede. */
function describe(err: unknown): string {
  const e = err as AxiosError<{ message?: string; error?: string }>;
  const status = e?.response?.status;
  if (status) {
    const body = e.response?.data;
    const detail = body?.message ?? body?.error ?? '';
    if (status === 401) return `la API key del emisor es invalida o fue revocada (401)`;
    if (status === 403) return `la API key no tiene permiso para emitir (403)`;
    if (status === 429) return `el emisor esta limitando las peticiones (429)`;
    return `el emisor respondio ${status}${detail ? `: ${detail}` : ''}`;
  }
  if (e?.code === 'ECONNABORTED' || e?.code === 'ETIMEDOUT') {
    return 'el emisor no respondio a tiempo';
  }
  if (e?.code === 'ENOTFOUND' || e?.code === 'ECONNREFUSED') {
    return 'no se pudo conectar con el emisor (revisa la URL)';
  }
  return (err as Error)?.message ?? 'error desconocido';
}
