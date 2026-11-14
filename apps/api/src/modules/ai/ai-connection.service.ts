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

  /**
   * La conexion IA del tenant (o null si no hay). Solo admin: "Conexiones" es
   * una seccion de administradores completa — un gestor no debe poder leerla ni
   * llamando al API directo. No devuelve secretos, pero el rol manda.
   */
  async get(auth: AuthContext): Promise<AiConnectionSummary | null> {
    this.assertAdmin(auth);
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

  /**
   * IA experta en celulares: ¿el producto a FACTURAR (el de la compra hallada
   * por el IMEI, o el que se eligio a mano) es el MISMO equipo que alguno del
   * pedido? Compara modelo + almacenamiento + RAM (ignora redaccion, color y
   * "reacondicionado"). Un ACCESORIO del combo ("+ reloj") cuenta como del
   * pedido aunque cambie la version: el control es del equipo. Devuelve null
   * si no hay IA conectada o falla (best-effort: sin IA no hay aviso).
   */
  async verifyProductMatch(
    orderProducts: string[],
    purchasedProduct: string,
  ): Promise<{ match: boolean; expected: string; note: string } | null> {
    const prompt = [
      'Eres un EXPERTO en celulares y tecnologia. Compara el producto A FACTURAR contra los productos del PEDIDO.',
      'Si el A FACTURAR es un EQUIPO (el producto principal de un pedido: lo que va antes de "+", o un pedido sin combo): decide si es EXACTAMENTE el mismo equipo que ALGUNO del pedido: mismo modelo (ojo: "14" no es "14C", "16" no es "16 Pro"), mismo almacenamiento y misma RAM cuando aparezca.',
      'Si el A FACTURAR es un ACCESORIO de un combo (lo que va despues de "+": reloj/smart watch, audifonos/buds, adaptador/cargador, lapiz/pencil/stylus, kit de proteccion...): match=true si el pedido trae ese tipo de accesorio, aunque cambie la version, la marca o la redaccion ("REDMI BUDS 8 ACTIVE" sirve por "REDMI BUDS 6 ACTIVE"; "CARGADOR IPHONE ORIGINAL" por "ADAPTADOR APPLE ORIGINAL 20W"). match=false si el pedido no trae ningun accesorio de ese tipo.',
      'IGNORA: mayusculas, orden de palabras, color, la palabra "reacondicionado"/"open box". Al comparar un EQUIPO, ignora los accesorios del combo: compara SOLO el equipo principal.',
      'Si el pedido NO trae RAM o almacenamiento explicitos, no lo cuentes como diferencia.',
      `A FACTURAR: ${JSON.stringify(purchasedProduct)}`,
      `PEDIDO: ${JSON.stringify(orderProducts)}`,
      'Responde SOLO este JSON, sin nada mas:',
      '{"match": true|false, "expected": "<producto del pedido mas parecido, textual>", "note": "<si match=false: una frase corta en espanol diciendo la diferencia concreta (modelo/almacenamiento/RAM, o el accesorio que el pedido no trae)>"}',
    ].join('\n');
    const parsed = await this.completeJson<{ match?: unknown; expected?: unknown; note?: unknown }>(
      prompt,
    );
    if (!parsed || typeof parsed.match !== 'boolean') return null;
    return {
      match: parsed.match,
      expected: String(parsed.expected ?? orderProducts[0] ?? ''),
      note: String(parsed.note ?? ''),
    };
  }

  /**
   * IA experta: ¿la factura trae TODO el pedido? Los combos ("celular + reloj")
   * son varios productos y cada accesorio fisico va en su propia linea; lo que
   * se olvida es justo el accesorio. Los servicios ("Protección Total") no se
   * facturan aparte. NO juzga el modelo del equipo (eso es verifyProductMatch):
   * solo que no falte nada. null = sin IA conectada o fallo (best-effort).
   */
  async verifyInvoiceCompleteness(
    orderItems: Array<{ name: string; quantity: number }>,
    invoiceLines: Array<{ name: string; quantity: number }>,
  ): Promise<{ complete: boolean; missing: string[]; note: string } | null> {
    const prompt = [
      'Eres un EXPERTO en celulares y tecnologia que revisa una factura ANTES de emitirla.',
      'PEDIDO = lo que compro el cliente (cantidad x nombre). Un nombre puede ser un COMBO: "CELULAR X + RELOJ SMART WATCH + PROTECCION TOTAL" son varios productos.',
      'Algunos nombres traen el combo repetido dos veces seguidas ("HONOR X 512GB + RELOJ SMART WATCH HONOR X 512GB + RELOJ SMART WATCH"): es UN solo combo, no dos.',
      'FACTURA = las lineas que se van a facturar (nombres del inventario de Alegra, redactados distinto al pedido).',
      'Decide si la FACTURA trae TODOS los productos FISICOS del pedido, en la cantidad pedida: el equipo principal y CADA accesorio del combo (reloj/smart watch, audifonos/buds, adaptador/cargador, lapiz/pencil/stylus, kit de proteccion, parlante, etc.).',
      'NO cuentan (no se facturan aparte): servicios y coberturas como "PROTECCION TOTAL", seguros, garantias extendidas, envio o instalacion.',
      'Un producto cuenta como facturado aunque cambie el nombre o la version: "ADAPTADOR APPLE ORIGINAL 20W" = "CARGADOR IPHONE ORIGINAL"; "LAPIZ OPTICO STYLUS" = "LAPIZ PENCIL STYLUS"; "REDMI BUDS 6 ACTIVE" facturado como "REDMI BUDS 8 ACTIVE" cuenta. Aqui NO juzgues si el modelo del equipo es el correcto (eso lo revisa otro control): solo que no FALTE nada.',
      'Cada linea de la factura cubre UNA cosa del pedido: el celular no cubre su reloj, ni un reloj cubre unos audifonos.',
      `PEDIDO: ${JSON.stringify(orderItems.map((i) => `${i.quantity} x ${i.name}`))}`,
      `FACTURA: ${JSON.stringify(invoiceLines.map((l) => `${l.quantity} x ${l.name}`))}`,
      'Responde SOLO este JSON, sin nada mas:',
      '{"complete": true|false, "missing": ["<cada producto que falta, corto y como lo dice el pedido, p. ej. Reloj Smart Watch>"], "note": "<si complete=false: una frase corta en espanol diciendo que falta facturar>"}',
    ].join('\n');
    const parsed = await this.completeJson<{
      complete?: unknown;
      missing?: unknown;
      note?: unknown;
    }>(prompt);
    if (!parsed || typeof parsed.complete !== 'boolean') return null;
    const missing = Array.isArray(parsed.missing)
      ? parsed.missing
          .filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
          .map((m) => m.trim().slice(0, 200))
          .slice(0, 10)
      : [];
    return { complete: parsed.complete, missing, note: String(parsed.note ?? '').slice(0, 300) };
  }

  /**
   * Corre un prompt de texto con la IA del tenant y lee el objeto JSON de la
   * respuesta (aunque venga entre ``` o con una frase alrededor). null si no hay
   * IA conectada, falla o no devuelve JSON.
   */
  private async completeJson<T>(prompt: string): Promise<T | null> {
    const { tenantId, prisma } = getTenantContext();
    const conn = await prisma.aiConnection.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!conn) return null;
    try {
      const apiKey = await this.envelope.decryptField(tenantId, conn.encryptedApiKey);
      const raw = await this.client.completeText(
        { provider: conn.provider as AiProvider, apiKey, model: conn.model },
        prompt,
      );
      const text = raw.replace(/```json|```/g, '');
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start < 0 || end <= start) return null;
      return JSON.parse(text.slice(start, end + 1)) as T;
    } catch {
      return null;
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
      // El motivo REAL viene en el cuerpo del proveedor (los tres lo ponen en
      // error.message). Sin esto, quedarse sin saldo se veia igual que un
      // modelo mal escrito: "no se pudo leer la imagen" y a adivinar.
      const body = err.response?.data as { error?: { message?: unknown } } | undefined;
      const detail =
        typeof body?.error?.message === 'string' ? body.error.message.trim().slice(0, 220) : '';

      if (/credit balance|insufficient_quota|quota|billing/i.test(detail)) {
        return new BadRequestException(
          `Sin saldo en ${provider}: recarga créditos en su panel de facturación para volver a leer fotos con IA.`,
        );
      }
      if (status === 401 || status === 403) {
        return new BadRequestException(`Credenciales de ${provider} rechazadas (401/403)`);
      }
      if (status === 404) {
        return new BadRequestException(`Endpoint de ${provider} no encontrado (404)`);
      }
      if (status === 429) {
        return new BadRequestException(`${provider} respondio 429 (limite de uso)`);
      }
      return new BadRequestException(
        detail ? `${fallback} — ${provider}: ${detail}` : `${fallback}: HTTP ${status ?? 'desconocido'}`,
      );
    }
    return new BadRequestException(fallback);
  }
}
