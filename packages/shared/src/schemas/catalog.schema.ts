import { z } from 'zod';

import { orderMessageSchema } from './order-thread.schema';

/**
 * Coincidencia de un codigo (IMEI o serial) en el catalogo de compras (la DB
 * externa del tenant, mantenida por webhook). Trae lo necesario para facturar:
 * producto, costo, proveedor, N.º de factura de compra.
 */
export const catalogMatchSchema = z.object({
  code: z.string(),
  // id del producto en Alegra (reusable para facturar la venta).
  itemId: z.string().nullable(),
  productName: z.string().nullable(),
  unitCost: z.string().nullable(),
  providerName: z.string().nullable(),
  billNumber: z.string(),
  billDate: z.string().datetime().nullable(),
  store: z.string().nullable(),
});
export type CatalogMatch = z.infer<typeof catalogMatchSchema>;

/** Tipo de foto: IMEI (valida Luhn) o serial (sin checksum). */
export const devicePhotoKindSchema = z.enum(['imei', 'serial']);
export type DevicePhotoKind = z.infer<typeof devicePhotoKindSchema>;

/** Lookup batch de codigos en el catalogo (para re-mostrar al recargar). */
export const catalogLookupSchema = z.object({
  codes: z.array(z.string().trim().min(1)).min(1).max(50),
});
export type CatalogLookupInput = z.infer<typeof catalogLookupSchema>;

/** Respuesta de subir una foto de dispositivo: el mensaje + los matches por codigo. */
export const devicePhotoResponseSchema = z.object({
  message: orderMessageSchema,
  matches: z.array(catalogMatchSchema),
});
export type DevicePhotoResponse = z.infer<typeof devicePhotoResponseSchema>;
