import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { WarehouseSummary } from '@smartlogistica/shared';

import { canManageWarehouses } from '@/lib/rbac';
import { getSessionUser, INTERNAL_API_URL } from '@/lib/server-api';

import { WarehousesManager } from './warehouses-manager';

export const metadata: Metadata = { title: 'Sedes' };

const SESSION_COOKIE_NAME = 'smartlog_session';

async function fetchWarehouses(): Promise<WarehouseSummary[]> {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE_NAME);
  if (!session) return [];
  try {
    const res = await fetch(`${INTERNAL_API_URL}/v1/warehouses`, {
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
  const [warehouses, me] = await Promise.all([fetchWarehouses(), getSessionUser()]);
  // Crear/archivar sedes es de administradores: a los demas la pagina les sirve
  // de indice para entrar a trabajar los pedidos de cada sede.
  const canManage = !me || canManageWarehouses(me.role);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Sedes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {canManage
            ? 'Crea y gestiona tus sedes/bodegas. Desde «Pedidos» asignas pedidos a cada una.'
            : 'Entra a una sede para trabajar sus pedidos.'}
        </p>
      </header>

      <WarehousesManager initial={warehouses} />
    </div>
  );
}
