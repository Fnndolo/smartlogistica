'use client';

import { useQuery } from '@tanstack/react-query';
import type { GuideModule } from '@smartlogistica/shared';

import { api } from '@/lib/api-client';

/**
 * ¿Esta encendido el MODULO DE GUIAS? (Ajustes › Envios.) Apagado: no hay
 * pestaña Guia ni "Hacer todo", y el pedido se cierra en VTEX al facturar.
 *
 * Mientras carga se asume encendido (lo de siempre); `ready` dice si ya es la
 * respuesta real, para lo que no debe ofrecerse ni un instante si esta apagado.
 * No abre su propio SSE: orders-live re-lee esta query con el evento
 * `guide-module.changed`.
 */
export function useGuideModule(): { enabled: boolean; ready: boolean } {
  const { data } = useQuery({
    queryKey: ['guide-module'],
    queryFn: () => api.get<GuideModule>('/v1/guide-module'),
    staleTime: 5 * 60_000,
  });
  return { enabled: data?.enabled ?? true, ready: data !== undefined };
}
