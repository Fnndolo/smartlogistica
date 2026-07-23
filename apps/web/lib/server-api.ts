import { cache } from 'react';
import { cookies } from 'next/headers';
import type { WarehouseSummary } from '@smartlogistica/shared';

const SESSION_COOKIE_NAME = 'smartlog_session';

/**
 * URL del API para los fetch del SERVIDOR (SSR). Se normaliza el esquema: si la
 * variable viene sin http(s):// (error comun al pegar el dominio de Railway) se
 * asume https://, si no `fetch`/`new URL` revientan con una URL invalida.
 * Usar SIEMPRE esta constante en el SSR (no leer process.env.API_INTERNAL_URL crudo).
 */
export const INTERNAL_API_URL = ((raw: string) =>
  /^https?:\/\//.test(raw) ? raw : `https://${raw}`)(
  process.env.API_INTERNAL_URL ?? 'http://localhost:3001',
);

/**
 * Resultado de un fetch desde el servidor. Distingue "no pude preguntar" de la
 * respuesta: sin esto, un API caido y un "no hay nada" son indistinguibles y la
 * pagina termina afirmando que no tienes datos cuando si los tienes.
 */
export type ServerResult<T> = { ok: true; data: T } | { ok: false };

/** Fetch autenticado desde un Server Component (usa la cookie de sesion). */
export async function serverFetchResult<T>(path: string): Promise<ServerResult<T>> {
  const session = (await cookies()).get(SESSION_COOKIE_NAME);
  if (!session) return { ok: false };
  const apiUrl = INTERNAL_API_URL;
  try {
    const res = await fetch(`${apiUrl}${path}`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${session.value}` },
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false };
  }
}

/**
 * Version simple: `null` si no se pudo traer. Usala solo cuando "fallo" y "no
 * hay" se puedan tratar igual; si no, usa `serverFetchResult`.
 */
export async function serverFetch<T>(path: string): Promise<T | null> {
  const res = await serverFetchResult<T>(path);
  return res.ok ? res.data : null;
}

export async function hasSession(): Promise<boolean> {
  return Boolean((await cookies()).get(SESSION_COOKIE_NAME));
}

/** Sedes del tenant (cacheado por request: layout + page comparten el fetch). */
export const getWarehouses = cache(
  async (): Promise<WarehouseSummary[]> => (await serverFetch<WarehouseSummary[]>('/v1/warehouses')) ?? [],
);

const SHIPPING_VALUES = new Set(['sin_movimientos', 'en_transito', 'novedad', 'entregado']);
const ADDRESS_VALUES = new Set(['confirmed', 'modified', 'pending']);

/** Filtros que puede traer la URL de una vista de pedidos. */
export interface OrdersSearchParams {
  page?: string;
  from?: string;
  to?: string;
  q?: string;
  sort?: string;
  dir?: string;
  shipping?: string;
  address?: string;
}

/** Construye el querystring de `/v1/orders` para una sede + etapa + filtros de la URL. */
export function ordersQueryString(
  warehouseId: string,
  state: 'pending' | 'invoiced' | undefined,
  sp: OrdersSearchParams,
): string {
  const params = new URLSearchParams();
  params.set('warehouse', warehouseId);
  params.set('page', String(Math.max(1, Number(sp.page ?? '1') || 1)));
  params.set('limit', '50');
  params.set('sort', sp.sort === 'quantity' || sp.sort === 'price' ? sp.sort : 'date');
  params.set('dir', sp.dir === 'asc' ? 'asc' : 'desc');
  if (state) params.set('state', state);
  if (sp.from) params.set('from', sp.from);
  if (sp.to) params.set('to', sp.to);
  if (sp.q) params.set('q', sp.q);
  // Solo valores validos: un valor inventado en la URL haria fallar el zod del API.
  if (sp.shipping && SHIPPING_VALUES.has(sp.shipping)) params.set('shipping', sp.shipping);
  const address = sanitizeAddressList(sp.address);
  if (address) params.set('address', address);
  return params.toString();
}

/** Filtra una lista "confirmed,pending" a solo valores validos ('' si nada). */
export function sanitizeAddressList(raw: string | undefined): string {
  if (!raw) return '';
  return raw
    .split(',')
    .filter((v) => ADDRESS_VALUES.has(v))
    .join(',');
}
