/**
 * MODO PRUEBAS: el ambiente de pruebas corre con una COPIA de la base de
 * produccion, y con ella vienen las credenciales REALES de VTEX, Alegra,
 * WhatsApp y transportadoras (viven cifradas en la base, no en variables).
 * Sin freno, un clic en "Facturar" en pruebas emite una factura electronica de
 * verdad, una guia se cobra y un WhatsApp le llega al cliente.
 *
 * Regla: TODA lectura pasa y TODA escritura hacia afuera se bloquea, salvo las
 * de la lista de abajo (iniciar sesion, cotizar, rastrear, imprimir rotulos de
 * guias que ya existen, la IA) y los WhatsApp a numeros autorizados. Lo que no
 * esta en la lista se BLOQUEA: una integracion nueva queda protegida aunque
 * nadie se acuerde de agregarla aqui.
 *
 * Funciones puras (sin red ni Nest) para poder probarlas: quien las aplica es
 * network-guard.ts.
 */

/** ¿Este proceso corre en el ambiente de pruebas? (SANDBOX_MODE=true). */
export function isSandboxMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|yes|on|si|sí)$/i.test((env.SANDBOX_MODE ?? '').trim());
}

/**
 * Celulares que SI reciben WhatsApp desde pruebas (los del equipo), por
 * SANDBOX_WA_ALLOWED_PHONES separados por coma. Se comparan los ultimos 10
 * digitos, asi que da igual escribirlos con o sin el 57.
 */
export function sandboxAllowedPhones(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env.SANDBOX_WA_ALLOWED_PHONES ?? '')
      // Sin separar por espacios: "+57 300 123 4567" es UN numero.
      .split(/[,;\n]+/)
      .map((p) => p.replace(/\D/g, '').slice(-10))
      .filter((p) => p.length === 10),
  );
}

export type OutboundRequest = { method?: string; url: string; body?: unknown };

/**
 * allow: sale normal. simulate: se responde OK sin salir (solo para avisos sin
 * efecto real, como "leido" o "escribiendo..."). block: error claro.
 */
export type OutboundDecision =
  | { action: 'allow' }
  | { action: 'simulate'; reason: string }
  | { action: 'block'; reason: string };

/** Error que ve quien intento la escritura (y el usuario en el toast). */
export class SandboxBlockedError extends Error {
  constructor(reason: string) {
    super(`Ambiente de pruebas: se bloqueó ${reason} para no afectar producción.`);
    this.name = 'SandboxBlockedError';
  }
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** La IA solo lee fotos y textos: cuesta, pero no cambia nada afuera. */
const AI_HOSTS = new Set(['api.anthropic.com', 'api.openai.com', 'generativelanguage.googleapis.com']);

const WHATSAPP_HOSTS = new Set([
  'graph.facebook.com',
  'waba-v2.360dialog.io',
  'waba-sandbox.360dialog.io',
]);

/** Escrituras que NO cambian nada afuera: iniciar sesion, cotizar, listar. */
const SAFE_WRITES: Array<{ host?: RegExp; path: RegExp }> = [
  // Tokens de acceso (Skydropx, Auth0 de Addi).
  { path: /\/oauth\/token$/ },
  // Cotizar un envio en Skydropx no crea la guia.
  { host: /(^|\.)skydropx\.com$/, path: /^\/api\/v1\/quotations$/ },
  // Inicio de sesion del portal de Addi.
  { host: /^auth\.addi\.com$/, path: /^\/co\/authenticate$/ },
  { host: /^login\.addi\.com$/, path: /^\/login$/ },
  // Inicio de sesion de la suite de Coordinadora (NextAuth + Keycloak).
  { host: /^envios\.coordinadora\.com$/, path: /^\/api\/auth\/(csrf|signin\/keycloak)$/ },
  { path: /\/login-actions\/authenticate$/ },
  // Suite de Coordinadora: listar guias e imprimir el rotulo de una que YA existe.
  {
    host: /^envios\.coordinadora\.com$/,
    path: /^\/api\/proxy\/suiteBackendService\/(guias\/listado|etiquetas\/impresion)$/,
  },
];

/** Procedimientos SOAP de Coordinadora que solo LEEN (Guias_generarGuia no esta). */
const SAFE_SOAP = new Set(['Guias_ciudades', 'Guias_rastreoExtendido', 'Guias_imprimirRotulos']);

/** Nombre del sistema para el mensaje (lo que entiende el que lo lee). */
function systemOf(host: string): string {
  if (host.includes('vtex')) return 'VTEX';
  if (host.includes('alegra')) return 'Alegra';
  if (host.includes('skydropx')) return 'Skydropx';
  if (host.includes('coordinadora')) return 'Coordinadora';
  if (host.includes('addi')) return 'Addi';
  if (WHATSAPP_HOSTS.has(host)) return 'WhatsApp';
  return host;
}

/** El cuerpo como objeto: axios lo trae como objeto, fetch como texto JSON. */
function bodyObject(body: unknown): Record<string, unknown> | null {
  if (typeof body === 'string') {
    try {
      const parsed: unknown = JSON.parse(body);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  if (body && typeof body === 'object' && Object.getPrototypeOf(body) === Object.prototype) {
    return body as Record<string, unknown>;
  }
  return null;
}

/** Nombre del procedimiento si el cuerpo es un sobre SOAP (Coordinadora). */
function soapProcedure(body: unknown): string | null {
  if (typeof body !== 'string' || !body.includes('Envelope')) return null;
  return /<tns:(\w+)>/.exec(body)?.[1] ?? null;
}

function whatsappDecision(
  method: string,
  path: string,
  body: unknown,
  phones: Set<string>,
): OutboundDecision {
  // Subir el archivo a Meta no se lo muestra a nadie: el envio es otro paso.
  if (method === 'POST' && /\/media$/.test(path)) return { action: 'allow' };
  if (method === 'POST' && /\/messages$/.test(path)) {
    const b = bodyObject(body);
    const to = typeof b?.to === 'string' ? b.to.replace(/\D/g, '').slice(-10) : '';
    if (to) {
      return phones.has(to)
        ? { action: 'allow' }
        : {
            action: 'block',
            reason: `el WhatsApp a +57 ${to} (no está en SANDBOX_WA_ALLOWED_PHONES)`,
          };
    }
    // "Leido" y "escribiendo..." no llevan `to`: se simulan para no llenar
    // de errores cada vez que se abre un chat.
    if (b?.status === 'read') {
      return { action: 'simulate', reason: 'WhatsApp: marcar leído / escribiendo' };
    }
  }
  return { action: 'block', reason: `una escritura en WhatsApp (${method} ${path})` };
}

/** Decide si una peticion saliente puede salir desde el ambiente de pruebas. */
export function decideOutbound(req: OutboundRequest, phones: Set<string>): OutboundDecision {
  const method = (req.method ?? 'GET').toUpperCase();
  if (READ_METHODS.has(method)) return { action: 'allow' };

  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return { action: 'block', reason: `una escritura a una URL inválida (${method} ${req.url})` };
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  if (AI_HOSTS.has(host)) return { action: 'allow' };
  if (WHATSAPP_HOSTS.has(host)) return whatsappDecision(method, path, req.body, phones);

  const proc = soapProcedure(req.body);
  if (proc) {
    return SAFE_SOAP.has(proc)
      ? { action: 'allow' }
      : { action: 'block', reason: `${systemOf(host)}: ${proc}` };
  }

  if (SAFE_WRITES.some((r) => (!r.host || r.host.test(host)) && r.path.test(path))) {
    return { action: 'allow' };
  }
  return { action: 'block', reason: `${systemOf(host)} (${method} ${host}${path})` };
}
