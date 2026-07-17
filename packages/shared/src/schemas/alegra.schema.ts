import { z } from 'zod';

/**
 * Credenciales de Alegra (sistema contable). Cada bodega/sede tiene su propia
 * conexion (relacion 1:1). Auth de Alegra = HTTP Basic con `email:token`, donde
 * `token` es el API token que el usuario genera en Configuracion → API de Alegra.
 */
export const alegraCredentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email invalido').max(254),
  token: z.string().trim().min(8, 'Token muy corto').max(512),
});
export type AlegraCredentialsInput = z.infer<typeof alegraCredentialsSchema>;

/** Resumen seguro de una conexion Alegra — NUNCA incluye el token. */
export const alegraConnectionSummarySchema = z.object({
  warehouseId: z.string(),
  email: z.string(),
  companyName: z.string().nullable(),
  status: z.enum(['connected', 'error']),
  lastError: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type AlegraConnectionSummary = z.infer<typeof alegraConnectionSummarySchema>;

/** Resultado de "Probar conexion" (no persiste nada). */
export const alegraTestResultSchema = z.object({
  ok: z.literal(true),
  companyName: z.string().nullable(),
});
export type AlegraTestResult = z.infer<typeof alegraTestResultSchema>;

/**
 * Coincidencia de un IMEI en el indice de facturas de compra de Alegra. El IMEI
 * vive en la observacion/descripcion de la linea; aca ya viene parseado + los
 * datos utiles para facturar (producto, costo, proveedor, N.º de factura).
 */
export const alegraImeiMatchSchema = z.object({
  imei: z.string(),
  billId: z.string(),
  billNumber: z.string().nullable(),
  billDate: z.string().datetime().nullable(),
  providerName: z.string().nullable(),
  itemName: z.string().nullable(),
  unitCost: z.string().nullable(),
  sourceWarehouseId: z.string(),
  syncedAt: z.string().datetime(),
});
export type AlegraImeiMatch = z.infer<typeof alegraImeiMatchSchema>;

/** Resultado de una sincronizacion del indice. */
export const alegraSyncResultSchema = z.object({
  bills: z.number().int(),
  imeisIndexed: z.number().int(),
  capped: z.boolean(),
});
export type AlegraSyncResult = z.infer<typeof alegraSyncResultSchema>;
