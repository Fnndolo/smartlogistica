import { z } from 'zod';

export const warehouseNameSchema = z.string().trim().min(2, 'Minimo 2 caracteres').max(60);

/**
 * Prefijo de facturacion para VTEX (ej. Pasto = "PA"). Se antepone al numero de
 * factura de Alegra: invoiceNumber = prefijo + nroAlegra (ej. "PA25879").
 * Vacio/omitido = sin prefijo.
 */
export const invoicePrefixSchema = z
  .string()
  .trim()
  .toUpperCase()
  .max(6, 'Maximo 6 caracteres')
  .regex(/^[A-Z0-9]*$/, 'Solo letras y numeros')
  .optional();

export const createWarehouseSchema = z.object({
  name: warehouseNameSchema,
  invoicePrefix: invoicePrefixSchema,
});
export type CreateWarehouseInput = z.infer<typeof createWarehouseSchema>;

export const updateWarehouseSchema = z.object({
  name: warehouseNameSchema,
  invoicePrefix: invoicePrefixSchema,
});
export type UpdateWarehouseInput = z.infer<typeof updateWarehouseSchema>;
// Alias por compatibilidad con el nombre anterior.
export const renameWarehouseSchema = updateWarehouseSchema;
export type RenameWarehouseInput = UpdateWarehouseInput;

export const warehouseSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  archived: z.boolean(),
  invoicePrefix: z.string().nullable(),
  orderCount: z.number().int(),
  createdAt: z.string().datetime(),
});
export type WarehouseSummary = z.infer<typeof warehouseSummarySchema>;
