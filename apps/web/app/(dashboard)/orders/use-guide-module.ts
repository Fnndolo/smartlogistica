'use client';

import { useQuery } from '@tanstack/react-query';
import {
  DEFAULT_GUIDE_MODULE,
  guidesEnabledFor,
  guidesEnabledForOrder,
  type GuideModule,
} from '@smartlogistica/shared';

import { api } from '@/lib/api-client';

/** El ajuste completo (que canales tienen las guias apagadas). */
export function useGuideModuleSetting() {
  return useQuery({
    queryKey: ['guide-module'],
    queryFn: () => api.get<GuideModule>('/v1/guide-module'),
    staleTime: 5 * 60_000,
  });
}

/**
 * ¿Se generan guias para los pedidos de este canal (vtex, manual...)?
 * (Ajustes › Envios.) Apagado: sin pestaña Guia ni "Hacer todo", y el pedido
 * se cierra al facturar.
 *
 * Mientras carga se asume encendido (lo de siempre); `ready` dice si ya es la
 * respuesta real, para lo que no debe ofrecerse ni un instante si esta apagado.
 * No abre su propio SSE: orders-live re-lee esta query con el evento
 * `guide-module.changed`.
 */
export function useGuideModule(provider: string): { enabled: boolean; ready: boolean } {
  const { data } = useGuideModuleSetting();
  return { enabled: data ? guidesEnabledFor(data, provider) : true, ready: data !== undefined };
}

/**
 * Lo mismo pero para UN pedido: el que ya trae la guia de ADDI no genera guia
 * propia (se despacha con la de Addi y se cierra al facturar) aunque las guias
 * de su canal esten encendidas. Ver guidesEnabledForOrder en shared.
 */
export function useOrderGuides(order: { provider: string; addiGuide?: string | null }): {
  enabled: boolean;
  ready: boolean;
} {
  const { data } = useGuideModuleSetting();
  // Con TODO encendido solo lo apaga la guia de Addi: esa respuesta no depende
  // del ajuste, asi que es definitiva aunque el ajuste aun no haya llegado.
  const fromAddi = !guidesEnabledForOrder(DEFAULT_GUIDE_MODULE, order);
  return {
    enabled: data ? guidesEnabledForOrder(data, order) : !fromAddi,
    ready: fromAddi || data !== undefined,
  };
}
