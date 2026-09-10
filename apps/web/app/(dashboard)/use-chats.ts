'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatInboxItem } from '@smartlogistica/shared';

import { api } from '@/lib/api-client';

import { useOrdersStream } from './orders/use-orders-stream';

/**
 * La BANDEJA del chat interno + refresco en vivo (SSE).
 *
 * A diferencia de `useMentions`, esta NO lanza avisos: de una mencion avisan ya
 * la campana y la propia pagina de Menciones, y un tercer aviso por cada
 * mensaje de cada hilo en el que uno participa seria ruido constante.
 */
export function useChats(): { items: ChatInboxItem[]; unread: number; loading: boolean } {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['chats-inbox'],
    queryFn: () => api.get<ChatInboxItem[]>('/v1/orders/chats'),
    staleTime: 10_000,
  });

  useOrdersStream(
    useCallback(
      (event?: { kind: string }) => {
        // "Escribiendo..." es efimero y llega constantemente: recargar la
        // bandeja con cada pulsacion de teclado de cualquiera seria absurdo.
        if (event?.kind === 'chat.typing') return;
        qc.invalidateQueries({ queryKey: ['chats-inbox'] });
      },
      [qc],
    ),
  );

  const items = data ?? [];
  // Se cuentan CONVERSACIONES con algo sin leer, no mensajes: el numero del
  // menu responde a "cuantos chats me esperan", que es lo que se va a abrir.
  return { items, unread: items.filter((c) => c.unreadCount > 0).length, loading: isLoading };
}
