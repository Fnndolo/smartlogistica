import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { isAxiosError } from 'axios';
import {
  AI_DEFAULT_MODELS,
  type AiConnectionSummary,
  type AiCredentialsInput,
  type AiProvider,
  type AiTestResult,
} from '@smartlogistica/shared';

import { isAdmin } from '../../common/rbac';
import type { AuthContext } from '../../common/types/authenticated-request';
import { EnvelopeService } from '../../infrastructure/crypto/envelope.service';
import { getTenantContext } from '../../infrastructure/tenant-context';
import { AiVisionClient, type ImageMime } from './ai-vision-client.service';
import { extractValidImeis, parseSerials } from './imei.util';

const IMEI_PROMPT =
  'Lee TODOS los numeros IMEI visibles en esta imagen. Cada IMEI tiene 15 digitos ' +
  '(a veces etiquetado IMEI, IMEI1, IMEI2, o en un codigo de barras). Devuelve UNICAMENTE ' +
  'los numeros, uno por linea, sin ningun otro texto ni explicacion. Si no hay ningun IMEI, ' +
  'responde exactamente: NONE.';

const SERIAL_PROMPT =
  'Lee TODOS los numeros de serie (serial / S/N) visibles en esta imagen. El serial es ' +
  'alfanumerico (letras y numeros) y NO tiene 15 digitos como un IMEI. Devuelve UNICAMENTE ' +
  'los seriales, uno por linea, sin etiquetas ni ningun otro texto. Si no hay ninguno, ' +
  'responde exactamente: NONE.';

const dianPrompt = (address: string): string =>
  'Convierte esta direccion colombiana a NOMENCLATURA DIAN reemplazando el tipo de via y los ' +
  'terminos por su CODIGO DIAN (CODIGO=termino):\n' +
  'AC=Avenida calle, AK=Avenida carrera, AV=Avenida, AUT=Autopista, AVIAL=Anillo vial, CL=Calle, ' +
  'CR=Carrera, CRT=Carretera, CRV=Circunvalar, CIR=Circular, DG=Diagonal, TV=Transversal, CLJ=Callejon, ' +
  'PJ=Pasaje, PS=Paseo, VTE=Variante, KM=Kilometro, MZ=Manzana, SM=Super manzana, BL=Bloque, TO=Torre, ' +
  'ED=Edificio, IN=Interior, AP=Apartamento, CA=Casa, LT=Lote, OF=Oficina, LC=Local, BG=Bodega, P=Piso, ' +
  'ET=Etapa, UN=Unidad, UR=Unidad residencial, URB=Urbanizacion, CON=Conjunto residencial, CONJ=Conjunto, ' +
  'BRR=Barrio, CD=Ciudadela, GJ=Garaje, ST=Sotano, PH=Penthouse, TZ=Terraza, VRD=Vereda, C=Corregimiento, ' +
  'GT=Glorieta, PN=Puente, ZN=Zona, CC=Centro comercial, PAR=Parque, NORTE=Norte, SUR=Sur, ESTE=Este, ' +
  'OESTE=Oeste, O=Oriente, OCC=Occidente.\n' +
  'Reglas: reconoce variantes (Carrera/Cra/Kra->CR, Calle/Cll->CL, Avenida/Av->AV, Diagonal/Diag->DG, ' +
  'Transversal/Transv->TV, Apto/Apartamento->AP, Torre->TO, Bloque->BL). Manten numeros y el simbolo #. ' +
  'Usa MAYUSCULAS. Responde UNICAMENTE con la direccion transformada, en una linea, sin comillas ni ' +
  'explicacion.\nDireccion: ' +
  address;

/** Fallback deterministico si no hay IA / falla (best-effort). */
function dianRuleBased(addr: string): string {
  return addr
    .replace(/\bavenida\s+calle\b/gi, 'AC')
    .replace(/\bavenida\s+carrera\b/gi, 'AK')
    .replace(/\b(?:carrera|cra|kra|kr|cr)\b\.?/gi, 'CR')
    .replace(/\b(?:calle|cll|cl)\b\.?/gi, 'CL')
    .replace(/\b(?:avenida|av)\b\.?/gi, 'AV')
    .replace(/\b(?:diagonal|diag|dg)\b\.?/gi, 'DG')
    .replace(/\b(?:transversal|transv|tv)\b\.?/gi, 'TV')
    .replace(/\b(?:manzana|mz)\b\.?/gi, 'MZ')
    .replace(/\b(?:apartamento|apto|apt)\b\.?/gi, 'AP')
    .replace(/\b(?:torre)\b\.?/gi, 'TO')
    .replace(/\b(?:bloque)\b\.?/gi, 'BL')
    .replace(/\b(?:barrio|brr)\b\.?/gi, 'BRR')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

interface AiConnectionRow {
  provider: string;
  model: string;
  status: string;
  lastError: string | null;
  createdAt: Date;
}

@Injectable()
export class AiConnectionService {
  constructor(
    private readonly client: AiVisionClient,
    private readonly envelope: EnvelopeService,
  ) {}

  /** La conexion IA del tenant (o null si no hay). Lectura abierta al tenant. */
  async get(): Promise<AiConnectionSummary | null> {
    const { prisma } = getTenantContext();
    const conn = await prisma.aiConnection.findFirst({ orderBy: { createdAt: 'desc' } });
    return conn ? this.toSummary(conn) : null;
  }

  /** Valida credenciales sin persistir. Solo admin. */
  async test(input: AiCredentialsInput, auth: AuthContext): Promise<AiTestResult> {
    this.assertAdmin(auth);
    const model = this.resolveModel(input);
    try {
      const { modelCount } = await this.client.testCredentials({
        provider: input.provider,
        apiKey: input.apiKey,
        model,
      });
      return { ok: true, modelCount };
    } catch (err) {
      throw this.translateError(err, input.provider, 'No se pudo conectar al proveedor de IA');
    }
  }

  /** Conecta (o reconecta) el proveedor IA del tenant. Valida -> cifra -> upsert singleton. Solo admin. */
  async connect(input: AiCredentialsInput, auth: AuthContext): Promise<AiConnectionSummary> {
    this.assertAdmin(auth);
    const { tenantId, prisma } = getTenantContext();
    const model = this.resolveModel(input);

    // 1. Validar primero.
    try {
      await this.client.testCredentials({ provider: input.provider, apiKey: input.apiKey, model });
    } catch (err) {
      throw this.translateError(err, input.provider, 'Las credenciales del proveedor son invalidas');
    }

    // 2. Cifrar la API key con la DEK del tenant.
    const encryptedApiKey = await this.envelope.encryptField(tenantId, input.apiKey);

    // 3. Singleton por tenant: si ya existe una conexion, se reemplaza; sino se crea.
    const existing = await prisma.aiConnection.findFirst();
    const data = {
      provider: input.provider,
      model,
      encryptedApiKey,
      status: 'connected',
      lastError: null,
    };
    const conn = existing
      ? await prisma.aiConnection.update({ where: { id: existing.id }, data })
      : await prisma.aiConnection.create({ data });

    return this.toSummary(conn);
  }

  /** Desconecta el proveedor IA del tenant. Solo admin. */
  async disconnect(auth: AuthContext): Promise<void> {
    this.assertAdmin(auth);
    const { prisma } = getTenantContext();
    await prisma.aiConnection.deleteMany({});
  }

  /**
   * Usa la conexion IA del tenant para leer el/los IMEI de una imagen (base64).
   * Devuelve solo los IMEI validos (15 digitos + Luhn), deduplicados. Puede ser
   * vacio (la imagen no tenia IMEI); el caller decide si eso es error.
   */
  /** Lee el/los IMEI de la imagen (prompt IMEI + validacion Luhn). */
  async extractImeis(imageBase64: string, mimeType: ImageMime): Promise<string[]> {
    const text = await this.runVision(imageBase64, mimeType, IMEI_PROMPT);
    if (!text || text.trim().toUpperCase() === 'NONE') return [];
    return extractValidImeis(text);
  }

  /** Lee el/los serial de la imagen (prompt propio, SIN validacion Luhn). */
  async extractSerials(imageBase64: string, mimeType: ImageMime): Promise<string[]> {
    const text = await this.runVision(imageBase64, mimeType, SERIAL_PROMPT);
    if (!text || text.trim().toUpperCase() === 'NONE') return [];
    return parseSerials(text);
  }

  /**
   * Convierte una direccion a NOMENCLATURA DIAN con IA (solo para la factura).
   * Best-effort: si no hay conexion IA o falla, usa un fallback rule-based.
   */
  async formatAddressDian(address: string): Promise<string> {
    const clean = address.trim();
    if (!clean) return clean;
    const { tenantId, prisma } = getTenantContext();
    const conn = await prisma.aiConnection.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!conn) return dianRuleBased(clean);
    try {
      const apiKey = await this.envelope.decryptField(tenantId, conn.encryptedApiKey);
      const text = await this.client.completeText(
        { provider: conn.provider as AiProvider, apiKey, model: conn.model },
        dianPrompt(clean),
      );
      const out = text.trim().split(/[\n\r]/)[0]?.trim();
      return out && out.length > 0 ? out : dianRuleBased(clean);
    } catch {
      return dianRuleBased(clean);
    }
  }

  /** Carga la conexion IA del tenant, descifra la key y corre el prompt de vision. */
  private async runVision(imageBase64: string, mimeType: ImageMime, prompt: string): Promise<string> {
    const { tenantId, prisma } = getTenantContext();
    const conn = await prisma.aiConnection.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!conn) {
      throw new BadRequestException(
        'No hay un proveedor de IA conectado. Conectalo en Conexiones para leer la foto.',
      );
    }
    const apiKey = await this.envelope.decryptField(tenantId, conn.encryptedApiKey);
    try {
      return await this.client.describeImage(
        { provider: conn.provider as AiProvider, apiKey, model: conn.model },
        imageBase64,
        mimeType,
        prompt,
      );
    } catch (err) {
      throw this.translateError(err, conn.provider as AiProvider, 'No se pudo leer la imagen con IA');
    }
  }

  // === Helpers ===

  private resolveModel(input: AiCredentialsInput): string {
    const model = input.model?.trim();
    return model && model.length > 0 ? model : AI_DEFAULT_MODELS[input.provider];
  }

  private assertAdmin(auth: AuthContext): void {
    if (!isAdmin(auth)) {
      throw new ForbiddenException('Solo administradores pueden gestionar la conexion de IA');
    }
  }

  private toSummary(row: AiConnectionRow): AiConnectionSummary {
    return {
      provider: row.provider as AiProvider,
      model: row.model,
      status: (row.status as AiConnectionSummary['status']) ?? 'connected',
      lastError: row.lastError,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private translateError(err: unknown, provider: AiProvider, fallback: string): BadRequestException {
    if (isAxiosError(err)) {
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        return new BadRequestException(`Credenciales de ${provider} rechazadas (401/403)`);
      }
      if (status === 404) {
        return new BadRequestException(`Endpoint de ${provider} no encontrado (404)`);
      }
      if (status === 429) {
        return new BadRequestException(`${provider} respondio 429 (limite de uso)`);
      }
      return new BadRequestException(`${fallback}: HTTP ${status ?? 'desconocido'}`);
    }
    return new BadRequestException(fallback);
  }
}
