import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { createHash } from 'node:crypto';
import type { CoordinadoraCity } from '@smartlogistica/shared';

// Sandbox por defecto; para produccion se define COORDINADORA_GUIAS_URL en el env.
const DEFAULT_GUIAS_URL = 'https://sandbox.coordinadora.com/agw/ws/guias/1.6/server.php';
const REQUEST_TIMEOUT_MS = 90_000;
const CITIES_TTL_MS = 12 * 60 * 60 * 1000; // 12h — el catalogo casi no cambia

/**
 * Trocea el body de <return> en los <item> de PRIMER NIVEL (uno por guia),
 * respetando los <item> anidados de detalle_estados / detalle_novedades.
 */
function splitTopLevelItems(body: string): string[] {
  const chunks: string[] = [];
  const re = /<item\b[^>]*?(\/)?>|<\/item>/g;
  let depth = 0;
  let start = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const isClose = m[0].startsWith('</');
    if (!isClose && m[1] === '/') {
      if (depth === 0) chunks.push(m[0]); // guia sin datos (item vacio)
      continue;
    }
    if (!isClose) {
      if (depth === 0) start = m.index;
      depth++;
    } else {
      depth--;
      if (depth === 0 && start >= 0) {
        chunks.push(body.slice(start, m.index + m[0].length));
        start = -1;
      }
    }
  }
  return chunks;
}

function emptyRastreo(codigoRemision: string): RastreoResult {
  return {
    codigoRemision,
    codigoEstado: 0,
    descripcionEstado: '',
    fechaRecogida: '',
    fechaEntrega: '',
    horaEntrega: '',
    nombreOrigen: '',
    nombreDestino: '',
    estados: [],
    novedades: [],
  };
}

export interface CoordinadoraCreds {
  usuario: string;
  password: string; // en claro; se hashea a SHA256 (clave) aca dentro
  idCliente: number;
  nit: string;
  div: string;
}

export interface GenerarGuiaInput {
  sender: { name: string; nit: string | null; address: string; cityCode: string; phone: string };
  recipient: { name: string; document: string; address: string; cityCode: string; phone: string; div?: string };
  package: {
    weight: number;
    height: number;
    width: number;
    length: number;
    units: number;
    content: string;
    declaredValue: number;
  };
  reference?: string;
  observations?: string;
}

export interface GuiaResult {
  id: string;
  number: string;
  url: string | null;
}

export interface RastreoEvent {
  codigo: number;
  descripcion: string;
  fecha: string;
  hora: string;
}

export interface RastreoResult {
  codigoRemision: string;
  codigoEstado: number;
  descripcionEstado: string;
  fechaRecogida: string;
  fechaEntrega: string;
  horaEntrega: string;
  nombreOrigen: string;
  nombreDestino: string;
  estados: RastreoEvent[];
  novedades: RastreoEvent[];
}

/**
 * Cliente SOAP de Coordinadora (guias 1.6). El WSDL es rpc/encoded; construimos
 * el envelope a mano (como Alegra usa axios) — validado contra el sandbox.
 * Procedimiento = `Guias_<metodo>`, params dentro de `<p>`, auth = usuario +
 * SHA256(password). Ver memoria coordinadora_api para la mecanica completa.
 */
@Injectable()
export class CoordinadoraClient {
  private readonly logger = new Logger(CoordinadoraClient.name);
  private citiesCache: { at: number; cities: CoordinadoraCity[] } | null = null;

  constructor(private readonly config: ConfigService) {}

  private get url(): string {
    return this.config.get<string>('COORDINADORA_GUIAS_URL') ?? DEFAULT_GUIAS_URL;
  }

  private clave(password: string): string {
    return createHash('sha256').update(password).digest('hex');
  }

  // === Serializacion XML rpc ===

  private esc(v: unknown): string {
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** Objeto JS -> XML. Arrays de struct: <k><item>...</item></k>. {__raw} = XML crudo. */
  private toXml(obj: Record<string, unknown>): string {
    let out = '';
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined || v === null) continue;
      if (typeof v === 'object' && v !== null && '__raw' in v) {
        out += `<${k}>${(v as { __raw: string }).__raw}</${k}>`;
      } else if (Array.isArray(v)) {
        out += `<${k}>`;
        for (const el of v) out += `<item>${this.toXml(el as Record<string, unknown>)}</item>`;
        out += `</${k}>`;
      } else if (typeof v === 'object') {
        out += `<${k}>${this.toXml(v as Record<string, unknown>)}</${k}>`;
      } else {
        out += `<${k}>${this.esc(v)}</${k}>`;
      }
    }
    return out;
  }

  private decodeEntities(s: string): string {
    return s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&amp;/g, '&');
  }

  private tag(xml: string, name: string): string {
    const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
    return m ? m[1] : '';
  }

  private async call(proc: string, params: Record<string, unknown>): Promise<string> {
    const NS = this.url;
    const body =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="${NS}"` +
      ` xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/"` +
      ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">` +
      `<soapenv:Body><tns:${proc}><p>${this.toXml(params)}</p></tns:${proc}></soapenv:Body></soapenv:Envelope>`;

    const res = await axios.post<string>(NS, body, {
      timeout: REQUEST_TIMEOUT_MS,
      responseType: 'text',
      // Coordinadora devuelve 500 con el SOAP Fault en el body -> lo parseamos.
      validateStatus: () => true,
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${NS}#${proc}"` },
    });
    const xml = typeof res.data === 'string' ? res.data : String(res.data);
    const fault =
      xml.match(/<faultstring>([\s\S]*?)<\/faultstring>/) ??
      xml.match(/<(?:env:)?Text[^>]*>([\s\S]*?)<\/(?:env:)?Text>/);
    if (fault) {
      throw new Error(this.decodeEntities(fault[1]).replace(/\s+/g, ' ').trim().slice(0, 300));
    }
    if (res.status >= 400) {
      throw new Error(`Coordinadora respondio ${res.status}`);
    }
    return xml;
  }

  // === Operaciones ===

  /** Valida credenciales llamando a ciudades (read-only). Devuelve nº de ciudades. */
  async testCredentials(creds: CoordinadoraCreds): Promise<number> {
    const cities = await this.fetchCities(creds);
    return cities.length;
  }

  /** Catalogo de ciudades (codigo DANE). Cacheado 12h (una cuenta compartida). */
  async listCities(creds: CoordinadoraCreds): Promise<CoordinadoraCity[]> {
    if (this.citiesCache && Date.now() - this.citiesCache.at < CITIES_TTL_MS) {
      return this.citiesCache.cities;
    }
    const cities = await this.fetchCities(creds);
    if (cities.length > 0) this.citiesCache = { at: Date.now(), cities };
    return cities;
  }

  private async fetchCities(creds: CoordinadoraCreds): Promise<CoordinadoraCity[]> {
    const xml = await this.call('Guias_ciudades', {
      usuario: creds.usuario,
      clave: this.clave(creds.password),
    });
    return [...xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g)]
      .map((m) => {
        const g = (t: string): string => {
          const x = m[1].match(new RegExp(`<${t}[^>]*>([^<]*)</${t}>`));
          return x ? this.decodeEntities(x[1]) : '';
        };
        return { code: g('codigo'), name: g('nombre'), department: g('nombre_departamento') };
      })
      .filter((c) => c.code);
  }

  /** Genera la guia. Coordinadora asigna el numero (codigo_remision) y lo devuelve. */
  async generarGuia(creds: CoordinadoraCreds, input: GenerarGuiaInput): Promise<GuiaResult> {
    const today = new Date().toISOString().slice(0, 10);
    const xml = await this.call('Guias_generarGuia', {
      codigo_remision: '',
      fecha: today,
      id_cliente: creds.idCliente,
      id_remitente: 0,
      nit_remitente: input.sender.nit || creds.nit,
      nombre_remitente: input.sender.name,
      direccion_remitente: input.sender.address,
      telefono_remitente: input.sender.phone,
      ciudad_remitente: input.sender.cityCode,
      nit_destinatario: input.recipient.document,
      div_destinatario: input.recipient.div || '01',
      nombre_destinatario: input.recipient.name,
      direccion_destinatario: input.recipient.address,
      ciudad_destinatario: input.recipient.cityCode,
      telefono_destinatario: input.recipient.phone,
      valor_declarado: input.package.declaredValue,
      codigo_cuenta: 1, // Cuenta Corriente
      codigo_producto: 0, // Auto (resuelve por peso)
      nivel_servicio: 1, // Estandar
      contenido: input.package.content,
      referencia: input.reference ?? '',
      // `observaciones` es NOT NULL en la BD de Coordinadora. Si el usuario no
      // escribe nada va UN ESPACIO: pasa la restriccion y en el portal se ve
      // vacio (igual que sus guias manuales). Nada de textos inventados.
      observaciones: input.observations?.trim() || ' ',
      estado: 'IMPRESO',
      detalle: [
        {
          ubl: 1,
          alto: input.package.height,
          ancho: input.package.width,
          largo: input.package.length,
          peso: input.package.weight,
          unidades: input.package.units,
        },
      ],
      usuario: creds.usuario,
      clave: this.clave(creds.password),
    });
    const number = this.tag(xml, 'codigo_remision').trim();
    const id = this.tag(xml, 'id_remision').trim();
    const url = this.tag(xml, 'url_terceros').trim();
    if (!number) throw new Error('Coordinadora no devolvio el numero de guia');
    return { id: id || number, number, url: url || null };
  }

  /** Seguimiento detallado (rastreoExtendido) de UNA guia. */
  async rastrear(creds: CoordinadoraCreds, codigoRemision: string): Promise<RastreoResult> {
    const all = await this.rastrearMuchos(creds, [codigoRemision]);
    return all[0] ?? emptyRastreo(codigoRemision);
  }

  /**
   * Rastreo por LOTES: `codigos_remision` acepta varias guias en una sola llamada
   * (clave para listar el estado de envio sin N peticiones). Devuelve un resultado
   * por guia; si la API no trae el codigo, se mapea por posicion.
   */
  async rastrearMuchos(creds: CoordinadoraCreds, codigos: string[]): Promise<RastreoResult[]> {
    if (codigos.length === 0) return [];
    const items = codigos.map((c) => `<item xsi:type="xsd:string">${this.esc(c)}</item>`).join('');
    const xml = await this.call('Guias_rastreoExtendido', {
      codigos_remision: { __raw: items },
      usuario: creds.usuario,
      clave: this.clave(creds.password),
    });

    // Un <item> de primer nivel por guia (dentro de <return>). Los sub-items de
    // detalle_estados/novedades viven anidados, asi que troceamos por guia.
    const ret = xml.match(/<return[^>]*>([\s\S]*)<\/return>/);
    const body = ret ? ret[1] : '';
    const chunks = splitTopLevelItems(body);
    return chunks.map((chunk, i) => this.parseRastreoItem(chunk, codigos[i] ?? ''));
  }

  private parseRastreoItem(chunk: string, fallbackCodigo: string): RastreoResult {
    const T = (name: string): string => {
      const m = chunk.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
      return m ? this.decodeEntities(m[1]).trim() : '';
    };
    const block = (name: string): string => {
      const m = chunk.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
      return m ? m[1] : '';
    };
    const parseEvents = (blockXml: string, codeField: string): RastreoEvent[] =>
      [...blockXml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g)].map((m) => {
        const g = (t: string): string => {
          const x = m[1].match(new RegExp(`<${t}[^>]*>([^<]*)</${t}>`));
          return x ? this.decodeEntities(x[1]) : '';
        };
        return {
          codigo: Number(g(codeField)) || 0,
          descripcion: g('descripcion'),
          fecha: g('fecha'),
          hora: g('hora'),
        };
      });
    return {
      codigoRemision: T('codigo_remision') || fallbackCodigo,
      codigoEstado: Number(T('codigo_estado')) || 0,
      descripcionEstado: T('descripcion_estado'),
      fechaRecogida: T('fecha_recogida'),
      fechaEntrega: T('fecha_entrega'),
      horaEntrega: T('hora_entrega'),
      nombreOrigen: T('nombre_origen'),
      nombreDestino: T('nombre_destino'),
      estados: parseEvents(block('detalle_estados'), 'codigo_estado'),
      novedades: parseEvents(block('detalle_novedades'), 'codigo_novedad'),
    };
  }

  /** Rotulo (sticker) de una guia ya generada -> PDF. rotuloId = formato (55 = 10x10). */
  async imprimirRotulo(
    creds: CoordinadoraCreds,
    codigoRemision: string,
    rotuloId: number,
  ): Promise<Buffer | null> {
    const xml = await this.call('Guias_imprimirRotulos', {
      id_rotulo: String(rotuloId),
      codigos_remisiones: { __raw: `<item xsi:type="xsd:string">${this.esc(codigoRemision)}</item>` },
      usuario: creds.usuario,
      clave: this.clave(creds.password),
    });
    const b64 = this.tag(xml, 'rotulos').trim();
    if (!b64) return null;
    const buf = Buffer.from(b64, 'base64');
    return buf.subarray(0, 4).toString('latin1') === '%PDF' ? buf : null;
  }
}
