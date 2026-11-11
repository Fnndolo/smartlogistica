import { z } from 'zod';

/**
 * Interruptor del MODULO DE GUIAS (global del workspace, AppSetting).
 *
 * Encendido (lo de siempre): el pedido se cierra en VTEX al generar la guia, y
 * el numero de guia viaja como tracking.
 *
 * Apagado: no hay pestaña Guia ni "Hacer todo"; el cierre en VTEX (factura de
 * salida + MKT a la conversacion) sale al FACTURAR en Alegra, sin tracking.
 * VTEX lo acepta asi: es el mismo payload con el que ya se cierran los envios
 * a domicilio.
 */
export const guideModuleSchema = z.object({
  enabled: z.boolean(),
});
export type GuideModule = z.infer<typeof guideModuleSchema>;

export const DEFAULT_GUIDE_MODULE: GuideModule = { enabled: true };
