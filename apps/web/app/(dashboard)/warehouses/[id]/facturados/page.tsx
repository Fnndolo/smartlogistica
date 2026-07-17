import type { ListOrdersResponse } from '@smartlogistica/shared';

import { OrdersLive } from '../../../orders/orders-live';
import { getWarehouses, ordersQueryString, serverFetch } from '@/lib/server-api';

const FALLBACK: ListOrdersResponse = { items: [], total: 0, page: 1, limit: 50, totalPages: 1 };

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; from?: string; to?: string; q?: string; sort?: string; dir?: string }>;
}

/** Pedidos FACTURADOS de la sede (ya facturados; aqui va el seguimiento). */
export default async function WarehouseInvoicedPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const warehouse = (await getWarehouses()).find((w) => w.id === id);
  const initialData =
    (await serverFetch<ListOrdersResponse>(`/v1/orders?${ordersQueryString(id, 'invoiced', sp)}`)) ??
    FALLBACK;

  return (
    <OrdersLive
      initialData={initialData}
      scope={{ kind: 'warehouse', id, name: warehouse?.name ?? '' }}
      state="invoiced"
    />
  );
}
