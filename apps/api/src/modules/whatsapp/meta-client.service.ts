import { createHash } from 'node:crypto';
import { Agent as HttpsAgent } from 'node:https';
import { Injectable } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';

const TIMEOUT_MS = 30_000;

/**
 * Version de la Graph API. SIEMPRE en la ruta, y en variable de entorno.
 *
 * Si se omite de la ruta, Graph usa la version configurada en el panel de la
 * App — que alguien puede cambiar sin tocar este repo. Y cuando una version
 * caduca, Meta NO devuelve error: redirige en silencio a la anterior que siga
 * viva, con lo que el comportamiento cambia solo. Fijarla aqui y poder subirla
 * por env es lo unico que evita las dos trampas.
 *
 * v25.0 (feb-2026) caduca el 29-jul-2028: ya tiene rodaje y ~2 anos por delante.
 */
const DEFAULT_VERSION = 'v25.0';

/**
 * Transporte de la Cloud API NATIVA de Meta (graph.facebook.com).
 *
 * Deliberadamente separado de Dialog360Client, con su PROPIO agente
 * keep-alive y su PROPIA cache de instancias: si compartiera el agente de 20
 * sockets con 360dialog, el trafico de un numero nuevo podria quedarse con los
 * sockets del numero que ya atiende clientes reales.
 */
@Injectable()
export class MetaClient {
  private readonly keepAlive = new HttpsAgent({ keepAlive: true, maxSockets: 20 });
  private readonly httpCache = new Map<string, AxiosInstance>();

  version(): string {
    return process.env.WHATSAPP_API_VERSION?.trim() || DEFAULT_VERSION;
  }

  baseUrl(): string {
    return `https://graph.facebook.com/${this.version()}`;
  }

  /**
   * Instancia lista para hablar con Graph. La clave de cache lleva el HASH del
   * token, nunca el token en claro: esta cache vive en memoria del proceso y
   * un volcado no debe contener credenciales.
   */
  buildHttp(accessToken: string, phoneNumberId: string): AxiosInstance {
    const key = `${phoneNumberId}:${createHash('sha256').update(accessToken).digest('hex').slice(0, 16)}`;
    const hit = this.httpCache.get(key);
    if (hit) return hit;
    const instance = axios.create({
      baseURL: this.baseUrl(),
      timeout: TIMEOUT_MS,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      httpsAgent: this.keepAlive,
    });
    if (this.httpCache.size > 100) this.httpCache.clear(); // tope defensivo
    this.httpCache.set(key, instance);
    return instance;
  }

  /**
   * Descarga los BYTES de un medio (el segundo salto).
   *
   * Va aparte y con axios "pelado" a proposito: la URL que devuelve Graph
   * apunta a lookaside.fbsbx.com — OTRO host — y aun asi exige la cabecera
   * Authorization. Un cliente con baseURL de graph o que siga redirecciones
   * borra esa cabecera al cruzar de host y Meta responde 401 sin explicar nada.
   */
  async fetchMediaBytes(url: string, accessToken: string): Promise<Buffer> {
    let target = url;
    // Se siguen las redirecciones A MANO, volviendo a poner la cabecera en
    // cada salto. Dejar que axios las siga es justo lo que la pierde.
    for (let hop = 0; hop < 3; hop++) {
      const res = await axios.get<ArrayBuffer>(target, {
        headers: { Authorization: `Bearer ${accessToken}` },
        responseType: 'arraybuffer',
        timeout: TIMEOUT_MS,
        httpsAgent: this.keepAlive,
        maxRedirects: 0,
        validateStatus: (s) => (s >= 200 && s < 300) || (s >= 300 && s < 400),
      });
      if (res.status < 300) return Buffer.from(res.data);
      const next = res.headers?.location as string | undefined;
      if (!next) break;
      target = new URL(next, target).toString();
    }
    throw new Error('El medio no se pudo descargar: demasiadas redirecciones');
  }
}
