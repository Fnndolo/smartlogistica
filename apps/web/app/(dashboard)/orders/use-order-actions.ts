'use client';

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ListOrdersResponse, OrderDetail, OrderSummary } from '@smartlogistica/shared';

import { ApiError, api } from '@/lib/api-client';
import { useCurrentUser } from '@/components/providers/current-user-provider';

/**
 * Acciones de FILA sobre un pedido: tomar/soltar y reaccionar. Optimistas:
 * la ficha/el chip aparecen al instante en todas las cachés de listas y en el
 * detalle; el SSE (orders.refresh) reconcilia por detrás. Si el server dice
 * que no (p. ej. "Ya lo tomó X"), se revierte con un refetch + toast.
 */
export function useOrderActions() {
  const qc = useQueryClient();
  const me = useCurrentUser();

  const patchEverywhere = useCallback(
    (orderId: string, patch: (o: OrderSummary) => OrderSummary) => {
      for (const [key, data] of qc.getQueriesData<ListOrdersResponse>({ queryKey: ['orders'] })) {
        if (!data?.items?.some((o) => o.id === orderId)) continue;
        qc.setQueryData<ListOrdersResponse>(key, {
          ...data,
          items: data.items.map((o) => (o.id === orderId ? patch(o) : o)),
        });
      }
      const detail = qc.getQueryData<OrderDetail>(['order-detail', orderId]);
      if (detail) {
        qc.setQueryData<OrderDetail>(['order-detail', orderId], patch(detail) as OrderDetail);
      }
    },
    [qc],
  );

  const revert = useCallback(
    (orderId: string) => {
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['order-detail', orderId] });
    },
    [qc],
  );

  /** Tomar el pedido: queda a mi cargo (nadie más puede tomarlo). */
  const claim = useCallback(
    (orderId: string) => {
      if (!me) return;
      patchEverywhere(orderId, (o) => ({
        ...o,
        claimedBy: { userId: me.id, name: me.name ?? me.email, mine: true },
      }));
      api
        .post(`/v1/orders/${orderId}/claim`)
        .then(() => toast.success('Pedido tomado — quedó a tu cargo'))
        .catch((err) => {
          revert(orderId);
          toast.error(err instanceof ApiError ? err.message : 'No se pudo tomar el pedido');
        });
    },
    [me, patchEverywhere, revert],
  );

  /** Soltar el pedido (solo quien lo tomó; el server valida). */
  const unclaim = useCallback(
    (orderId: string) => {
      patchEverywhere(orderId, (o) => ({ ...o, claimedBy: null }));
      api
        .delete(`/v1/orders/${orderId}/claim`)
        .then(() => toast.success('Pedido liberado — cualquiera puede tomarlo'))
        .catch((err) => {
          revert(orderId);
          toast.error(err instanceof ApiError ? err.message : 'No se pudo soltar el pedido');
        });
    },
    [patchEverywhere, revert],
  );

  /** Reaccionar al pedido (toggle, como en los mensajes del chat). */
  const toggleReaction = useCallback(
    (orderId: string, emoji: string) => {
      patchEverywhere(orderId, (o) => {
        const list = [...(o.reactions ?? [])];
        const i = list.findIndex((r) => r.emoji === emoji);
        if (i >= 0) {
          const r = list[i]!;
          if (r.mine) {
            const count = r.count - 1;
            if (count <= 0) list.splice(i, 1);
            else list[i] = { ...r, count, mine: false };
          } else {
            list[i] = { ...r, count: r.count + 1, mine: true };
          }
        } else {
          list.push({ emoji, count: 1, mine: true });
        }
        return { ...o, reactions: list };
      });
      api.post(`/v1/orders/${orderId}/reactions`, { emoji }).catch((err) => {
        revert(orderId);
        toast.error(err instanceof ApiError ? err.message : 'No se pudo reaccionar');
      });
    },
    [patchEverywhere, revert],
  );

  return { claim, unclaim, toggleReaction, me };
}
