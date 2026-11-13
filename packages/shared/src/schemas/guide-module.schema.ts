import { z } from 'zod';

import { marketplaceProviderSchema, type MarketplaceProvider } from './order.schema';

/**
 * Interruptor del MODULO DE GUIAS, POR CANAL (global del workspace, AppSetting).
 *
 * Encendido para un canal (lo de siempre): sus pedidos se cierran al generar
 * la guia, y en VTEX el numero de guia viaja como tracking.
 *
 * Apagado para un canal: esos pedidos no tienen pestaña Guia (salvo los que ya
 * tenian envio, que conservan su rastreo) ni "Hacer todo", y se cierran al
 * FACTURAR — en VTEX con la factura de salida sin tracking + MKT al chat (VTEX
 * lo acepta asi: es el mismo payload de los envios a domicilio).
 *
 * Se guarda la lista de canales APAGADOS: un marketplace que se conecte despues
 * nace con guias, nunca apagado por arrastre.
 */
export const guideModuleSchema = z.object({
  disabledFor: z.array(marketplaceProviderSchema).max(20),
});
export type GuideModule = z.infer<typeof guideModuleSchema>;

export const DEFAULT_GUIDE_MODULE: GuideModule = { disabledFor: [] };

/** Nombre de cada canal en Ajustes. Un provider nuevo obliga a ponerle nombre. */
export const GUIDE_CHANNEL_LABEL: Record<MarketplaceProvider, string> = {
  vtex: 'VTEX',
  manual: 'Montados a mano',
};

/** ¿Se generan guias para los pedidos de este canal? */
export function guidesEnabledFor(module: GuideModule, provider: string): boolean {
  return !(module.disabledFor as string[]).includes(provider);
}

/**
 * ¿Este PEDIDO genera guia propia? Lo del canal, salvo que ya traiga la guia
 * que genero ADDI (VTEX de Addi Logistics): ese se despacha con su guia de
 * Addi y se cierra en VTEX al facturar, aunque las guias del canal esten
 * encendidas. Son los que quedaron en sedes cuando Addi dejo de generarlas
 * (2026-11-13): pagar otra guia para un pedido que ya tiene una no tiene sentido.
 */
export function guidesEnabledForOrder(
  module: GuideModule,
  order: { provider: string; addiGuide?: string | null },
): boolean {
  if (order.provider === 'vtex' && order.addiGuide) return false;
  return guidesEnabledFor(module, order.provider);
}

/**
 * ¿Estan activas las GUIAS DE ADDI (Addi las genera; aqui se traen al llegar
 * el pedido y se les cambia el remitente al transferir)? Solo con las guias de
 * VTEX APAGADAS: los dos modos son excluyentes. Con las de VTEX encendidas
 * cada sede genera la suya y lo de Addi queda EN PAUSA (no se consulta ni el
 * portal ni la suite), salvo para terminar los pedidos que ya traen guia de Addi.
 */
export function addiGuidesActive(module: GuideModule): boolean {
  return !guidesEnabledFor(module, 'vtex');
}

/**
 * Lee lo guardado, aceptando la forma vieja `{ enabled }` (un solo interruptor
 * para todo): apagado ahi = apagado en todos los canales. Lo ilegible cae al
 * default (todo encendido), que es como funcionaba antes de existir esto.
 */
export function parseGuideModule(value: unknown): GuideModule {
  const parsed = guideModuleSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const legacy = z.object({ enabled: z.boolean() }).safeParse(value);
  if (legacy.success) {
    return { disabledFor: legacy.data.enabled ? [] : [...marketplaceProviderSchema.options] };
  }
  return DEFAULT_GUIDE_MODULE;
}
