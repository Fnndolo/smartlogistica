import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { ListOrdersResponse } from '@smartlogistica/shared';

import { INTERNAL_API_URL, sanitizeAddressList } from '@/lib/server-api';

import { OrdersLive } from './orders-live';

export const metadata: Metadata = { title: 'Pedidos' };

const SESSION_COOKIE_NAME = 'smartlog_session';
const FALLBACK: ListOrdersResponse = { items: [], total: 0, page: 1, limit: 50, totalPages: 1 };

interface PageProps {
  searchParams: Promise<{
    page?: string;
    from?: string;
    to?: string;
    q?: string;
    sort?: string;
    dir?: string;
    address?: string;
  }>;
}

async function fetchOrders(params: {
  page: number;
  from?: string;
  to?: string;
  q?: string;
  sort?: string;
  dir?: string;
  address?: string;
}): Promise<ListOrdersResponse> {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE_NAME);
  if (!session) return FALLBACK;

  const url = new URL('/v1/orders', INTERNAL_API_URL);
  url.searchParams.set('page', String(params.page));
  url.searchParams.set('limit', '50');
  url.searchParams.set('sort', params.sort === 'quantity' || params.sort === 'price' ? params.sort : 'date');
  url.searchParams.set('dir', params.dir === 'asc' ? 'asc' : 'desc');
  if (params.from) url.searchParams.set('from', params.from);
  if (params.to) url.searchParams.set('to', params.to);
  if (params.q) url.searchParams.set('q', params.q);
  const address = sanitizeAddressList(params.address);
  if (address) url.searchParams.set('address', address);

  try {
    const res = await fetch(url, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${session.value}` },
      cache: 'no-store',
    });
    if (!res.ok) return FALLBACK;
    return (await res.json()) as ListOrdersResponse;
  } catch {
    return FALLBACK;
  }
}

export default async function OrdersPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? '1') || 1);
  const initialData = await fetchOrders({
    page,
    from: params.from,
    to: params.to,
    q: params.q,
    sort: params.sort,
    dir: params.dir,
    address: params.address,
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Pedidos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pedidos en estado &laquo;Listo para preparar&raquo;, en tiempo real. Cuando un pedido
          cambia de estado en VTEX, desaparece automaticamente.
        </p>
      </header>

      <OrdersLive initialData={initialData} />
    </div>
  );
}
