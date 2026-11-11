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
