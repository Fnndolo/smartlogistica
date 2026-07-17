import { cache } from 'react';
import { cookies } from 'next/headers';
import type { WarehouseSummary } from '@smartlogistica/shared';

const SESSION_COOKIE_NAME = 'smartlog_session';

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
  const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
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

/** Construye el querystring de `/v1/orders` para una sede + etapa + filtros de la URL. */
export function ordersQueryString(
  warehouseId: string,
  state: 'pending' | 'invoiced' | undefined,
  sp: { page?: string; from?: string; to?: string; q?: string; sort?: string; dir?: string },
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
  return params.toString();
}
