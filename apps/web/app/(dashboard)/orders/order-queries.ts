import type { QueryClient } from '@tanstack/react-query';
import type { OrderDetail, OrderMessage } from '@smartlogistica/shared';

import { api } from '@/lib/api-client';

/**
 * Ventana en la que los datos ya traidos se consideran frescos: al reabrir un
 * pedido dentro de este lapso se pintan al instante (sin spinner) y el refresco
 * ocurre en segundo plano. La inmediatez real la da el SSE, que invalida.
 */
export const ORDER_CACHE_MS = 30_000;

export const orderDetailQuery = (orderId: string) =>
  ({
    queryKey: ['order-detail', orderId] as const,
    queryFn: () => api.get<OrderDetail>(`/v1/orders/${orderId}`),
    staleTime: ORDER_CACHE_MS,
  }) as const;

export const orderMessagesQuery = (orderId: string) =>
  ({
    queryKey: ['order-messages', orderId] as const,
    queryFn: () => api.get<OrderMessage[]>(`/v1/orders/${orderId}/messages`),
    staleTime: ORDER_CACHE_MS,
  }) as const;

/**
 * Precarga la conversacion + el detalle de un pedido. Se dispara al pasar el
 * mouse por la fila: para cuando el usuario hace clic, el chat ya esta en cache
 * y el drawer abre pintado (estilo WhatsApp, sin "cargando").
 *
 * prefetchQuery respeta staleTime, asi que pasar el mouse varias veces por la
 * misma fila no repite la peticion.
 */
export function prefetchOrder(qc: QueryClient, orderId: string): void {
  void qc.prefetchQuery(orderMessagesQuery(orderId));
  void qc.prefetchQuery(orderDetailQuery(orderId));
}
