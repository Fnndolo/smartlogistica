import { Injectable, Logger } from '@nestjs/common';

import type { SuiteActor, SuiteGuide } from './addi-guide-edit';
import { CookieJar, follow, netError, request } from './http-session';

/**
 * SUITE DE COORDINADORA (envios.coordinadora.com) con la cuenta que Addi le da
 * al comercio. Es otra cuenta y otro sistema que el web service SOAP de guias
 * que usa cada sede: aqui viven las guias que genera Addi.
 *
 * La suite es una app Next.js con NextAuth + Keycloak; su backend se llama por
 * el proxy de la misma app con la cookie de sesion. Validado contra la suite
 * real (2026-11-11):
 *   - POST /api/proxy/suiteBackendService/guias/listado   buscar por numero
 *   - GET  /api/proxy/guiasService/guias/{n}              guia completa
 *   - PUT  /api/proxy/suiteBackendService/guias           editar (el "Editar guia")
 *   - POST /api/proxy/suiteBackendService/etiquetas/impresion   rotulo (PDF base64)
 *
 * OJO: esa cuenta ve las guias de TODOS los comercios de Addi. Quien edita
 * verifica antes que la guia sea del pedido (referencia = MKT).
 */

const BASE = 'https://envios.coordinadora.com';
/** El token de Keycloak dura 10 min; la sesion se rehace antes. */
const SESSION_TTL_MS = 8 * 60_000;

export interface SuiteCreds {
  email: string;
  password: string;
}

interface Session {
  jar: CookieJar;
  actor: SuiteActor;
  /** NIT del cliente asociado (Addi) para el listado. */
  nit: string | null;
  at: number;
}

/** Fila del listado de guias (solo lo que usamos). */
export interface SuiteGuideRow {
  codigo_remision: string;
  estado_guia: string | null;
  estadoTracking: string | null;
  codigoEstado: number | null;
}

export class SuiteAuthError extends Error {}

/** La suite respondio con error HTTP (status util para decidir si reintentar). */
export class SuiteHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

@Injectable()
export class CoordinadoraSuiteClient {
  private readonly logger = new Logger(CoordinadoraSuiteClient.name);
  private readonly sessions = new Map<string, Session>();

  async validate(creds: SuiteCreds): Promise<void> {
    await this.login(creds);
  }

  /** Busca la guia en el listado (estado actual). null = no esta en esta cuenta. */
  async findGuide(creds: SuiteCreds, code: string): Promise<SuiteGuideRow | null> {
    const s = await this.session(creds);
    const body = await this.call(creds, 'suiteBackendService', '/guias/listado', 'POST', {
      ...(s.nit ? { nit: s.nit } : {}),
      tipoGuia: 1,
      pagina: 1,
      numeroRegistros: 50,
      numeroGuia: code,
    });
    const guias = (body as { data?: { guias?: SuiteGuideRow[] } })?.data?.guias ?? [];
    return guias.find((g) => String(g.codigo_remision) === code) ?? null;
  }

  /** La guia completa, tal como la carga el formulario de edicion. */
  async getGuide(creds: SuiteCreds, code: string): Promise<SuiteGuide> {
    const body = await this.call(
      creds,
      'guiasService',
      `/guias/${encodeURIComponent(code)}`,
      'GET',
    );
    const data = (body as { data?: SuiteGuide })?.data;
    if (!data || String(data.codigoRemision) !== code) {
      throw new Error(`La suite de Coordinadora no devolvió la guía ${code}`);
    }
    return data;
  }

  /** Guarda la guia editada (el boton "Guardar" del formulario de edicion). */
  async updateGuide(
    creds: SuiteCreds,
    payload: Record<string, unknown>,
  ): Promise<{ codigoRemision: string | null }> {
    const body = (await this.call(creds, 'suiteBackendService', '/guias', 'PUT', payload)) as {
      data?: { codigo_remision?: string | number };
    };
    const code = body?.data?.codigo_remision;
    return { codigoRemision: code == null ? null : String(code) };
  }

  /** Rotulo/etiqueta en PDF (formato = id de rotulo de Coordinadora, ej. 55 = 10x10). */
  async printLabel(creds: SuiteCreds, code: string, tipoEtiqueta: number): Promise<Buffer> {
    const body = (await this.call(creds, 'suiteBackendService', '/etiquetas/impresion', 'POST', {
      tipoEtiqueta,
      guias: [code],
    })) as { data?: string };
    const pdf = typeof body?.data === 'string' ? Buffer.from(body.data, 'base64') : Buffer.alloc(0);
    if (pdf.subarray(0, 4).toString() !== '%PDF') {
      throw new Error('La suite de Coordinadora no devolvió el rótulo en PDF');
    }
    return pdf;
  }

  /** Datos de la sesion que van dentro del cuerpo de la edicion. */
  async actor(creds: SuiteCreds): Promise<SuiteActor> {
    return (await this.session(creds)).actor;
  }

  private async call(
    creds: SuiteCreds,
    service: 'suiteBackendService' | 'guiasService',
    path: string,
    method: 'GET' | 'POST' | 'PUT',
    payload?: unknown,
    retried = false,
  ): Promise<unknown> {
    const s = await this.session(creds);
    const url = `${BASE}/api/proxy/${service}${path}`;
    let res: Response;
    try {
      res = await request(s.jar, url, {
        method,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-active-perfil': String(s.actor.tipoPerfil),
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
    } catch (err) {
      throw new Error(`La suite de Coordinadora ${netError(err)}`);
    }
    // Sesion vencida: el proxy responde 401/403 o redirige al login.
    if (
      (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) &&
      !retried
    ) {
      this.sessions.delete(creds.email);
      return this.call(creds, service, path, method, payload, true);
    }
    const text = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    const b = body as {
      isError?: boolean;
      message?: string;
      cause?: string;
      error?: string;
    } | null;
    if (!res.ok || b?.isError) {
      const why =
        [b?.message, b?.cause, b?.error].filter(Boolean).join(' — ') || text.slice(0, 160);
      throw new SuiteHttpError(
        `La suite de Coordinadora rechazó la operación (${res.status}): ${why}`.slice(0, 400),
        res.status,
      );
    }
    return body;
  }

  private async session(creds: SuiteCreds): Promise<Session> {
    const hit = this.sessions.get(creds.email);
    if (hit && Date.now() - hit.at < SESSION_TTL_MS) return hit;
    const s = await this.login(creds);
    this.sessions.set(creds.email, s);
    return s;
  }

  private async login(creds: SuiteCreds): Promise<Session> {
    const jar = new CookieJar();
    try {
      // 1. CSRF de NextAuth + inicio del flujo de Keycloak.
      let res = await request(jar, `${BASE}/api/auth/csrf`, {
        headers: { accept: 'application/json' },
      });
      const { csrfToken } = (await res.json().catch(() => ({}))) as { csrfToken?: string };
      if (!csrfToken) throw new Error('La suite de Coordinadora no respondió al iniciar sesión');
      res = await request(jar, `${BASE}/api/auth/signin/keycloak`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ csrfToken, callbackUrl: `${BASE}/guias` }).toString(),
      });
      const kcUrl = res.headers.get('location');
      if (!kcUrl)
        throw new Error('La suite de Coordinadora no abrió su página de inicio de sesión');

      // 2. Formulario de Keycloak (tema keycloakify: la accion va en kcContext).
      const kc = await follow(jar, await request(jar, kcUrl), kcUrl);
      const html = await kc.res.text();
      const action = html
        .match(/"loginAction":\s*"([^"]+)"/)?.[1]
        ?.replace(/\\\//g, '/')
        .replace(/&amp;/g, '&');
      if (!action) throw new Error('Cambió la página de inicio de sesión de Coordinadora');

      // 3. Usuario y contraseña. Exito = redireccion al callback de NextAuth.
      res = await request(jar, action, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          username: creds.email,
          password: creds.password,
          credentialId: '',
        }).toString(),
      });
      if (!res.headers.get('location')) {
        const page = await res.text();
        const msg =
          page.match(/"summary":\s*"([^"]+)"/)?.[1] ??
          page.match(/kc-feedback-text[^>]*>([^<]+)/)?.[1] ??
          'correo o contraseña incorrectos';
        throw new SuiteAuthError(`Coordinadora rechazó el inicio de sesión de la suite: ${msg}`);
      }
      await follow(jar, res, action);

      // 4. Sesion: perfil e id de usuario (van dentro de la edicion).
      res = await request(jar, `${BASE}/api/auth/session`, {
        headers: { accept: 'application/json' },
      });
      const session = (await res.json().catch(() => null)) as {
        user?: {
          email?: string;
          profile?: { idUser?: number };
          autorizaciones?: { tipo_perfil?: number; clientes_asociados?: Array<{ nit?: string }> };
        };
      } | null;
      const idUser = session?.user?.profile?.idUser;
      if (!session?.user || typeof idUser !== 'number') {
        throw new SuiteAuthError(
          'La suite de Coordinadora no abrió la sesión (revisa el correo y la contraseña)',
        );
      }
      return {
        jar,
        actor: {
          idUser,
          email: session.user.email ?? creds.email,
          tipoPerfil: session.user.autorizaciones?.tipo_perfil ?? 1,
        },
        nit: session.user.autorizaciones?.clientes_asociados?.[0]?.nit ?? null,
        at: Date.now(),
      };
    } catch (err) {
      if (err instanceof SuiteAuthError) throw err;
      if (err instanceof Error && /Coordinadora/.test(err.message)) throw err;
      this.logger.warn(`Login de la suite fallo: ${netError(err)}`);
      throw new Error(`No se pudo entrar a la suite de Coordinadora: ${netError(err)}`);
    }
  }
}
