import { z } from 'zod';

/**
 * Descuentos del NETO de un pedido VTEX (clic en el precio de la tabla):
 * neto = precio − comisión% − IVA% sobre esa comisión − valor fijo.
 * GLOBAL del workspace (AppSetting) y configurable en Ajustes — solo visual,
 * no toca facturas ni guías.
 */
export const vtexFeesSchema = z.object({
  /** Comisión del marketplace, en % del precio (ej. 8). */
  commissionPct: z.number().min(0, 'Porcentaje invalido').max(100),
  /** IVA aplicado SOBRE la comisión, en % (ej. 19). */
  vatPct: z.number().min(0, 'Porcentaje invalido').max(100),
  /** Valor fijo que se descuenta por pedido, en COP (ej. 25000). */
  fixed: z.number().min(0, 'Valor invalido').max(10_000_000),
});
export type VtexFees = z.infer<typeof vtexFeesSchema>;

export const DEFAULT_VTEX_FEES: VtexFees = { commissionPct: 8, vatPct: 19, fixed: 25_000 };

/** Neto visual de un pedido VTEX segun la configuracion. */
export function vtexNetValue(total: number, fees: VtexFees): number {
  const commission = total * (fees.commissionPct / 100);
  return Math.round(total - commission * (1 + fees.vatPct / 100) - fees.fixed);
}
