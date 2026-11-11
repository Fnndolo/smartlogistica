/**
 * Mini "navegador" HTTP para los portales web (Addi, suite de Coordinadora):
 * cookies por dominio + redirecciones a mano. Ninguno de los dos tiene API
 * publica para esto; sus paginas hablan con su propio backend y aqui se replica
 * exactamente esa conversacion (sin navegador ni RPA).
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TIMEOUT_MS = 25_000;

interface StoredCookie {
  value: string;
  /** Dominio de la cookie (sin punto). host-only = el host exacto. */
  domain: string;
  hostOnly: boolean;
}

export class CookieJar {
  private readonly cookies = new Map<string, StoredCookie>();

  keep(url: string, res: Response): void {
    const host = new URL(url).hostname;
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const raw of list) {
      const [pair, ...attrs] = raw.split(';');
      const i = pair.indexOf('=');
      if (i <= 0) continue;
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      let domain = host;
      let hostOnly = true;
      let expired = value === '';
      for (const a of attrs) {
        const [k, v = ''] = a.split('=');
        const key = k.trim().toLowerCase();
        if (key === 'domain' && v.trim()) {
          domain = v.trim().replace(/^\./, '').toLowerCase();
          hostOnly = false;
        }
        if (key === 'max-age' && Number(v) <= 0) expired = true;
        if (key === 'expires' && Date.parse(v) < Date.now()) expired = true;
      }
      const id = `${domain}|${name}`;
      if (expired) this.cookies.delete(id);
      else this.cookies.set(id, { value, domain, hostOnly });
    }
  }

  header(url: string): string {
    const host = new URL(url).hostname;
    const out: string[] = [];
    for (const [id, c] of this.cookies) {
      const name = id.slice(id.indexOf('|') + 1);
      const match = c.hostOnly
        ? host === c.domain
        : host === c.domain || host.endsWith(`.${c.domain}`);
      if (match) out.push(`${name}=${c.value}`);
    }
    return out.join('; ');
  }

  has(name: string): boolean {
    for (const id of this.cookies.keys()) if (id.endsWith(`|${name}`)) return true;
    return false;
  }
}

/** fetch con cookies, sin seguir redirecciones (se siguen a mano) y con timeout. */
export async function request(
  jar: CookieJar,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Response> {
  const cookie = jar.header(url);
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    redirect: 'manual',
    headers: { 'user-agent': UA, ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
    body: init.body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  jar.keep(url, res);
  return res;
}

/** Sigue redirecciones (hasta `max`) guardando cookies. Devuelve la ultima respuesta. */
export async function follow(
  jar: CookieJar,
  first: Response,
  firstUrl: string,
  max = 6,
): Promise<{ res: Response; url: string }> {
  let res = first;
  let url = firstUrl;
  for (let i = 0; i < max; i++) {
    const loc = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !loc) break;
    url = new URL(loc, url).toString();
    res = await request(jar, url);
  }
  return { res, url };
}

/** Texto corto y seguro de un error de red/HTTP para mostrar al usuario. */
export function netError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'no respondió a tiempo';
    return err.message.slice(0, 200);
  }
  return 'error desconocido';
}
