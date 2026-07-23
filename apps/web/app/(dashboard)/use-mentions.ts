'use client';

import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { MentionItem } from '@smartlogistica/shared';

import { api } from '@/lib/api-client';

import { useOrdersStream } from './orders/use-orders-stream';

// Dedupe de toasts a nivel de MODULO: el hook se monta en varios sitios
// (sidebar + top bar movil) y cada mencion debe avisar UNA sola vez.
let seen: Set<string> | null = null;

/**
 * Menciones a mi + refresco en tiempo real (SSE) + toast cuando llega una nueva.
 * Lo usan la pagina Menciones, el item del sidebar y el icono del top bar movil.
 */
export function useMentions(): { items: MentionItem[]; unread: number } {
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ['mentions'],
    queryFn: () => api.get<MentionItem[]>('/v1/orders/mentions'),
    staleTime: 10_000,
  });

  useOrdersStream(
    useCallback(() => {
      qc.invalidateQueries({ queryKey: ['mentions'] });
    }, [qc]),
  );

  useEffect(() => {
    if (!data) return;
    if (seen === null) {
      // Primera carga: no avisar de lo ya existente.
      seen = new Set(data.map((m) => m.messageId));
      return;
    }
    for (const m of data) {
      if (!seen.has(m.messageId)) {
        seen.add(m.messageId);
        if (m.unread) toast(`${m.author} te mencionó · ${m.externalId}`, { icon: '@' });
      }
    }
  }, [data]);

  const items = data ?? [];
  return { items, unread: items.filter((m) => m.unread).length };
}

/** A donde navega una mencion o un resultado de busqueda (abre el drawer via ?order=). */
export function orderTarget(item: {
  orderId: string;
  warehouseId: string | null;
  stage: 'general' | 'pending' | 'invoiced';
}): string {
  const base = !item.warehouseId
    ? '/orders'
    : item.stage === 'invoiced'
      ? `/warehouses/${item.warehouseId}/facturados`
      : `/warehouses/${item.warehouseId}`;
  return `${base}?order=${encodeURIComponent(item.orderId)}`;
}
