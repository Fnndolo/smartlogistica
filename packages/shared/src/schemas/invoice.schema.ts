import { z } from 'zod';

/** Item del catalogo de Alegra (para el selector manual de producto). */
export const alegraItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: z.string().nullable(),
  reference: z.string().nullable(),
});
export type AlegraItem = z.infer<typeof alegraItemSchema>;

/** Vendedor guardado en Alegra (catalogo /sellers de la cuenta de la sede). */
export const alegraSellerSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type AlegraSeller = z.infer<typeof alegraSellerSchema>;

/**
 * Eleccion de vendedor del USUARIO actual en una sede: sus facturas salen con
 * ese seller de Alegra. null = facturar sin vendedor.
 */
export const saveSellerPrefSchema = z.object({ seller: alegraSellerSchema.nullable() });
export type SaveSellerPrefInput = z.infer<typeof saveSellerPrefSchema>;

/**
 * Una linea del preview = UNA foto (un celular). Si la foto tiene varios codigos
 * (dual-SIM) van juntos en `codes` (misma linea/producto, en la descripcion).
 */
export const invoiceLinePreviewSchema = z.object({
  codes: z.array(z.string()),
  itemId: z.string().nullable(),
  productName: z.string().nullable(),
  suggestedPrice: z.string().nullable(),
  matched: z.boolean(),
});
export type InvoiceLinePreview = z.infer<typeof invoiceLinePreviewSchema>;

/** Factura ya emitida para este pedido (si existe): bloquea volver a facturar. */
export const existingInvoiceSchema = z.object({
  id: z.string(),
  number: z.string(),
  status: z.string(),
  total: z.string(),
  createdAt: z.string(),
});
export type ExistingInvoice = z.infer<typeof existingInvoiceSchema>;

/** Preview de factura: cliente completo (del pedido) + una linea por foto. */
export const invoicePreviewSchema = z.object({
  client: z.object({
    name: z.string(),
    identification: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    address: z.string().nullable(),
  }),
  lines: z.array(invoiceLinePreviewSchema),
  // Si el pedido ya se facturo, aqui va la factura -> el front no deja re-facturar.
  invoice: existingInvoiceSchema.nullable(),
});
export type InvoicePreview = z.infer<typeof invoicePreviewSchema>;

/** Linea a facturar (ya revisada/corregida por el usuario). */
export const createInvoiceLineSchema = z.object({
  itemId: z.string().min(1, 'Falta el producto'),
  description: z.string().max(500).optional(),
  price: z.number().nonnegative(),
  quantity: z.number().int().min(1).default(1),
});
export type CreateInvoiceLine = z.infer<typeof createInvoiceLineSchema>;

export const createInvoiceSchema = z.object({
  lines: z.array(createInvoiceLineSchema).min(1, 'Agrega al menos un producto').max(50),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

/** Resultado de emitir la factura en Alegra. */
export const invoiceResultSchema = z.object({
  id: z.string(),
  number: z.string(),
  status: z.string(),
  total: z.string(),
  balance: z.string(),
});
export type InvoiceResult = z.infer<typeof invoiceResultSchema>;
