import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { WarehouseSummary } from '@smartlogistica/shared';

import { WarehousesManager } from './warehouses-manager';

export const metadata: Metadata = { title: 'Sedes' };

const SESSION_COOKIE_NAME = 'smartlog_session';

async function fetchWarehouses(): Promise<WarehouseSummary[]> {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE_NAME);
  if (!session) return [];
  const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
  try {
    const res = await fetch(`${apiUrl}/v1/warehouses`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${session.value}` },
      cache: 'no-store',
    });
    if (!res.ok) return [];
    return (await res.json()) as WarehouseSummary[];
  } catch {
    return [];
  }
}

export default async function WarehousesPage() {
  const warehouses = await fetchWarehouses();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Sedes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Crea y gestiona tus sedes/bodegas. Desde &laquo;Pedidos&raquo; asignas pedidos a cada una.
        </p>
      </header>

      <WarehousesManager initial={warehouses} />
    </div>
  );
}
