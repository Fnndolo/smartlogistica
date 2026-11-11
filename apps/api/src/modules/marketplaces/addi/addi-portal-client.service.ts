import { Injectable, Logger } from '@nestjs/common';

import { CookieJar, follow, netError, request } from './http-session';

/**
 * PORTAL DE ALIADOS DE ADDI (aliados.addi.com › Marketplace › Órdenes LBA).
 * De ahi sale el numero de guia que Addi genero para cada pedido (por MKT).
 *
 * Addi no tiene API publica para esto; el portal habla con su backend asi:
 *   1. Auth0 (auth.addi.com) con usuario y contraseña  -> login_ticket
 *   2. /authorize con response_mode=form_post           -> access_token
 *   3. POST login.addi.com/login                         -> cookie `addiauth`
 *   4. la pagina de ordenes trae el token interno del portal en __NEXT_DATA__
 *   5. GET ally-portal.addi.com/v1/marketplace/shipments (paginas de 25)
 * Todo validado contra el portal real (2026-11-11). Solo LECTURA: nunca se
 * llama al endpoint de imprimir de Addi (cambia el estado del paquete).
 */

const AUTH0 = 'https://auth.addi.com';
const CLIENT_ID = 'LOzXiHhw5VBPNm8xZXK6mYeDo6PEANvg';
const REALM = 'Username-Password-Authentication';
const LOGIN_APP = 'https://login.addi.com';
const LBA_PAGE = 'https://aliados.addi.com/marketplace/lba-orders';
const PORTAL_API = 'https://ally-portal.addi.com';
/** El API ignora tamaños mayores: siempre devuelve 25. */
export const ADDI_PAGE_SIZE = 25;
const PAGE_SIZE = ADDI_PAGE_SIZE;
/** Tope de paginas por consulta (25 x 120 = 3000 envios). */
const MAX_PAGES = 120;
/** La cookie `addiauth` vive 30 min; el token interno, lo mismo. */
const SESSION_TTL_MS = 20 * 60_000;

export interface AddiCreds {
  email: string;
  password: string;
}

/** Un envio de la lista "Órdenes LBA" (solo lo que usamos). */
export interface AddiShipment {
  /** MKT de VTEX sin el prefijo "MKT-" (ej. 1675566227506-01). */
  orderId: string;
  trackingNumber: string | null;
  carrier: string | null;
  packageStatus: string | null;
  dispatchDeadline: string | null;
  fulfillmentType: string | null;
}

interface Session {
  jar: CookieJar;
  authorization: string;
  at: number;
}

export class AddiAuthError extends Error {}

@Injectable()
export class AddiPortalClient {
  private readonly logger = new Logger(AddiPortalClient.name);
  /** Sesion por cuenta (correo). Se rehace al vencer o ante un 401/403. */
  private readonly sessions = new Map<string, Session>();
  private readonly logins = new Map<string, Promise<Session>>();

  /** Valida las credenciales (login completo). Lanza con un mensaje claro si falla. */
  async validate(creds: AddiCreds): Promise<void> {
    await this.login(creds);
  }

  /** TODOS los envios LBA de la cuenta (todas las paginas). */
  async listShipments(creds: AddiCreds): Promise<AddiShipment[]> {
    const all: AddiShipment[] = [];
    const seen = new Set<string>();
    for (let page = 0; page < MAX_PAGES; page++) {
      const rows = await this.listPage(creds, page);
      if (rows.length === 0) break;
      let fresh = 0;
      for (const r of rows) {
        if (seen.has(r.orderId)) continue;
        seen.add(r.orderId);
        all.push(r);
        fresh++;
      }
      // Pagina sin nada nuevo o incompleta = fin (defensa ante un API que repita).
      if (fresh === 0 || rows.length < PAGE_SIZE) break;
      if (page === MAX_PAGES - 1) {
        this.logger.warn(`Addi: se alcanzo el tope de ${MAX_PAGES} paginas de envios`);
      }
    }
    return all;
  }

  /** UNA pagina (25) de la lista. La 0 trae lo recien creado o movido. */
  async listPage(creds: AddiCreds, page: number, retried = false): Promise<AddiShipment[]> {
    const s = await this.session(creds);
    const url = `${PORTAL_API}/v1/marketplace/shipments?page=${page}&pageSize=${PAGE_SIZE}`;
    let res: Response;
    try {
      res = await request(s.jar, url, {
        headers: {
          accept: 'application/json',
          authorization: s.authorization,
          origin: 'https://aliados.addi.com',
          referer: 'https://aliados.addi.com/',
        },
      });
    } catch (err) {
      throw new Error(`El portal de Addi ${netError(err)}`);
    }
    if ((res.status === 401 || res.status === 403) && !retried) {
      this.sessions.delete(creds.email);
      return this.listPage(creds, page, true);
    }
    if (!res.ok) {
      throw new Error(`El portal de Addi respondió ${res.status} al listar las órdenes LBA`);
    }
    const body = (await res.json().catch(() => null)) as { orders?: unknown[] } | null;
    if (!body || !Array.isArray(body.orders)) {
      throw new Error('El portal de Addi devolvió una respuesta inesperada (sin "orders")');
    }
    const s2 = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    return body.orders
      .map((o) => o as Record<string, unknown>)
      .filter((o) => typeof o.orderId === 'string' && o.orderId)
      .map((o) => ({
        orderId: String(o.orderId),
        trackingNumber: s2(o.trackingNumber) ?? s2(o.guideCode),
        carrier: s2(o.carrier),
        packageStatus: s2(o.packageStatus),
        dispatchDeadline: s2(o.dispatchDeadline),
        fulfillmentType: s2(o.fulfillmentType),
      }));
  }

  private async session(creds: AddiCreds): Promise<Session> {
    const hit = this.sessions.get(creds.email);
    if (hit && Date.now() - hit.at < SESSION_TTL_MS) return hit;
    // Varios pedidos llegando a la vez comparten UN inicio de sesion.
    let pending = this.logins.get(creds.email);
    if (!pending) {
      pending = this.login(creds).finally(() => this.logins.delete(creds.email));
      this.logins.set(creds.email, pending);
    }
    const s = await pending;
    this.sessions.set(creds.email, s);
    return s;
  }

  private async login(creds: AddiCreds): Promise<Session> {
    const jar = new CookieJar();
    try {
      // 1. Usuario y contraseña contra Auth0 (flujo "cross-origin" del portal).
      let res = await request(jar, `${AUTH0}/co/authenticate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: LOGIN_APP },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          username: creds.email,
          password: creds.password,
          realm: REALM,
          credential_type: 'http://auth0.com/oauth/grant-type/password-realm',
        }),
      });
      const co = (await res.json().catch(() => ({}))) as {
        login_ticket?: string;
        error_description?: string;
      };
      if (!res.ok || !co.login_ticket) {
        throw new AddiAuthError(
          res.status === 401 || res.status === 403
            ? 'Addi rechazó el correo o la contraseña del portal de aliados'
            : `Addi no permitió iniciar sesión (${res.status}${co.error_description ? `: ${co.error_description}` : ''})`,
        );
      }

      // 2. Token por form_post (el que espera login.addi.com).
      const q = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: 'token',
        response_mode: 'form_post',
        redirect_uri: `${LOGIN_APP}/login`,
        audience: 'https://api.addi.com',
        scope: 'openid',
        realm: REALM,
        login_ticket: co.login_ticket,
        state: JSON.stringify({ redirect_url: LBA_PAGE }),
        nonce: `n${Date.now()}`,
      });
      const authUrl = `${AUTH0}/authorize?${q}`;
      const followed = await follow(jar, await request(jar, authUrl), authUrl);
      const html = await followed.res.text();
      const fields: Record<string, string> = {};
      for (const m of html.matchAll(/name="([^"]+)"\s+value="([^"]*)"/g)) {
        fields[m[1]] = m[2].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      }
      if (!fields.access_token) {
        throw new Error('Addi no entregó el token de acceso (cambió su inicio de sesión)');
      }

      // 3. Cookie de sesion del dominio addi.com.
      res = await request(jar, `${LOGIN_APP}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
      });
      if (!jar.has('addiauth')) {
        throw new Error(`Addi no abrió la sesión del portal (${res.status})`);
      }

      // 4. Token interno del portal (lo inyecta la pagina en __NEXT_DATA__).
      res = await request(jar, LBA_PAGE, { headers: { accept: 'text/html' } });
      if (res.status !== 200) {
        throw new Error(`El portal de aliados respondió ${res.status} al abrir las órdenes LBA`);
      }
      const page = await res.text();
      const m = page.match(
        /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
      );
      const data = m ? (JSON.parse(m[1]) as Record<string, unknown>) : null;
      const authorization = (
        data as {
          props?: {
            pageProps?: { pageProps?: { auth?: { headers?: { Authorization?: string } } } };
          };
        }
      )?.props?.pageProps?.pageProps?.auth?.headers?.Authorization;
      if (!authorization) {
        throw new Error(
          'El portal de aliados no entregó el acceso a las órdenes LBA (¿la cuenta tiene el Marketplace?)',
        );
      }
      return { jar, authorization, at: Date.now() };
    } catch (err) {
      if (err instanceof AddiAuthError) throw err;
      if (err instanceof Error && /^(Addi|El portal)/.test(err.message)) throw err;
      throw new Error(`No se pudo entrar al portal de Addi: ${netError(err)}`);
    }
  }
}
