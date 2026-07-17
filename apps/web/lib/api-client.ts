/**
 * Cliente HTTP minimalista para hablar con la API NestJS.
 * Maneja credenciales (cookies), JSON, y errores tipados.
 */

/**
 * Base de las peticiones del navegador. Por defecto = el MISMO origen del web:
 * las llamadas a /v1/* las reenvia el proxy de Next al API (ver next.config).
 * Asi la cookie de sesion es de un solo origen y no hay CORS. Se puede forzar
 * un origen distinto con NEXT_PUBLIC_API_URL (setup con dominio propio directo).
 */
const withScheme = (u: string) => (/^https?:\/\//.test(u) ? u : `https://${u}`);
const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== 'undefined'
    ? window.location.origin
    : withScheme(process.env.API_INTERNAL_URL ?? 'http://localhost:3001'));

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Si se provee, se concatena al pathname (no a la query). */
  searchParams?: Record<string, string | number | undefined>;
}

export async function apiFetch<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, searchParams, headers, ...rest } = options;

  const url = new URL(path.startsWith('/') ? path : `/${path}`, API_URL);
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const init: RequestInit = {
    credentials: 'include',
    // API responses cambian constantemente; el browser cache HTTP nos manda
    // If-None-Match → server responde 304 sin body → fallamos al parsear.
    // `no-store` desactiva el cache del browser para estas requests.
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...rest,
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url.toString(), init);

  if (res.status === 204) {
    return undefined as T;
  }

  const contentType = res.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : await res.text();

  if (!res.ok) {
    const message =
      (isJson && data && typeof data === 'object' && 'message' in data
        ? String((data as Record<string, unknown>).message)
        : `Request failed with status ${res.status}`) ?? `Request failed with status ${res.status}`;
    throw new ApiError(res.status, message, data);
  }

  return data as T;
}

/**
 * Sube un archivo (multipart). NO seteamos Content-Type: el browser pone el
 * boundary correcto solo. Devuelve JSON tipado o lanza ApiError.
 */
export async function apiUpload<T = unknown>(path: string, formData: FormData): Promise<T> {
  const url = new URL(path.startsWith('/') ? path : `/${path}`, API_URL);
  const res = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    body: formData,
    headers: { Accept: 'application/json' },
  });

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'message' in data
        ? String((data as Record<string, unknown>).message)
        : `Request failed with status ${res.status}`;
    throw new ApiError(res.status, message, data);
  }
  return data as T;
}

/** Descarga un recurso binario (ej. un PDF) como ArrayBuffer, con credenciales. */
export async function apiFetchArrayBuffer(path: string): Promise<ArrayBuffer> {
  const url = new URL(path.startsWith('/') ? path : `/${path}`, API_URL);
  const res = await fetch(url.toString(), { credentials: 'include', cache: 'no-store' });
  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;
    try {
      const data = (await res.json()) as { message?: unknown };
      if (data && typeof data.message === 'string') message = data.message;
    } catch {
      /* body no-JSON */
    }
    throw new ApiError(res.status, message);
  }
  return res.arrayBuffer();
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'body' | 'method'>) =>
    apiFetch<T>(path, { ...options, method: 'GET' }),
  getArrayBuffer: (path: string) => apiFetchArrayBuffer(path),
  upload: <T>(path: string, formData: FormData) => apiUpload<T>(path, formData),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body' | 'method'>) =>
    apiFetch<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body' | 'method'>) =>
    apiFetch<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body' | 'method'>) =>
    apiFetch<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'body' | 'method'>) =>
    apiFetch<T>(path, { ...options, method: 'DELETE' }),
};
