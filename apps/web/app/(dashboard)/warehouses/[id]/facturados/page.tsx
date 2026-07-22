import type { ListOrdersResponse } from '@smartlogistica/shared';

import { OrdersLive } from '../../../orders/orders-live';
import { getWarehouses, ordersQueryString, serverFetch } from '@/lib/server-api';

const FALLBACK: ListOrdersResponse = { items: [], total: 0, page: 1, limit: 50, totalPages: 1 };

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<import('@/lib/server-api').OrdersSearchParams>;
}

/** Pedidos FACTURADOS de la sede (ya facturados; aqui va el seguimiento). */
export default async function WarehouseInvoicedPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = await searchParams;
  // En paralelo: las sedes (cacheadas, compartidas con el layout) y los pedidos.
  const [warehouses, orders] = await Promise.all([
    getWarehouses(),
    serverFetch<ListOrdersResponse>(`/v1/orders?${ordersQueryString(id, 'invoiced', sp)}`),
  ]);
  const warehouse = warehouses.find((w) => w.id === id);
  const initialData = orders ?? FALLBACK;

  return (
    <OrdersLive
      initialData={initialData}
      scope={{ kind: 'warehouse', id, name: warehouse?.name ?? '' }}
      state="invoiced"
    />
  );
}
