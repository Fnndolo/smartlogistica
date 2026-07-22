import type { ListOrdersResponse } from '@smartlogistica/shared';

import { OrdersLive } from '../../orders/orders-live';
import { getWarehouses, ordersQueryString, serverFetch } from '@/lib/server-api';

const FALLBACK: ListOrdersResponse = { items: [], total: 0, page: 1, limit: 50, totalPages: 1 };

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; from?: string; to?: string; q?: string; sort?: string; dir?: string }>;
}

/** Pedidos POR PREPARAR de la sede (aun sin facturar). */
export default async function WarehousePendingPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = await searchParams;
  // En paralelo: las sedes (cacheadas, compartidas con el layout) y los pedidos.
  const [warehouses, orders] = await Promise.all([
    getWarehouses(),
    serverFetch<ListOrdersResponse>(`/v1/orders?${ordersQueryString(id, 'pending', sp)}`),
  ]);
  const warehouse = warehouses.find((w) => w.id === id);
  const initialData = orders ?? FALLBACK;

  return (
    <OrdersLive
      initialData={initialData}
      scope={{ kind: 'warehouse', id, name: warehouse?.name ?? '' }}
      state="pending"
    />
  );
}
