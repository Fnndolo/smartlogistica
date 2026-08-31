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
  // Cantidad sugerida (los pedidos MONTADOS a mano pueden traer mas de 1 unidad
  // del producto elegido; las lineas por foto siempre son 1).
  quantity: z.number().int().min(1).default(1),
  matched: z.boolean(),
  // AVISO de la IA (experta en celulares): el producto de la COMPRA no
  // corresponde al del PEDIDO (modelo/almacenamiento/RAM). Solo informa,
  // no bloquea facturar. null = coincide o no se pudo verificar.
  mismatch: z
    .object({ expected: z.string(), found: z.string(), note: z.string() })
    .nullable()
    .default(null),
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
/**
 * CLIENTE FIJO de Alegra de una sede: si esta configurado, todas las facturas
 * de esa sede se emiten en Alegra a su nombre (es lo contable). El comprador no
 * cambia en ningun otro sitio: la guia, el chat y el documento que se le envia
 * siguen siendo suyos.
 */
export const alegraFixedClientSchema = z.object({
  id: z.string(),
  name: z.string(),
  identification: z.string().nullable().default(null),
});
export type AlegraFixedClient = z.infer<typeof alegraFixedClientSchema>;

/** Un contacto de Alegra en el buscador del cliente fijo. */
export const alegraContactSchema = z.object({
  id: z.string(),
  name: z.string(),
  identification: z.string().nullable().default(null),
});
export type AlegraContact = z.infer<typeof alegraContactSchema>;

/** Fijar (o quitar, con null) el cliente al que factura una sede. */
export const setAlegraFixedClientSchema = z.object({
  client: alegraFixedClientSchema.nullable(),
});
export type SetAlegraFixedClientInput = z.infer<typeof setAlegraFixedClientSchema>;

export const invoicePreviewSchema = z.object({
  client: z.object({
    name: z.string(),
    identification: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    address: z.string().nullable(),
  }),
  lines: z.array(invoiceLinePreviewSchema),
  /** Cliente FIJO de la sede (null = se factura al comprador, lo de siempre).
   *  Se muestra en el panel para que nadie se lleve la sorpresa: la factura
   *  contable sale a su nombre, el documento del chat al del comprador. */
  billedTo: alegraFixedClientSchema.nullable().default(null),
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

/**
 * Cuenta de banco de Alegra (para elegir el medio de pago en pedidos montados
 * a mano). Solo id + nombre — nunca saldos ni datos sensibles.
 */
export const alegraPaymentAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type AlegraPaymentAccount = z.infer<typeof alegraPaymentAccountSchema>;

/** Medios de pago que acepta Alegra al registrar un pago de factura. */
export const invoicePaymentMethodSchema = z.enum(['transfer', 'cash', 'debit-card', 'credit-card']);
export type InvoicePaymentMethod = z.infer<typeof invoicePaymentMethodSchema>;

/**
 * Un pago de la factura (pedidos MONTADOS a mano): cuenta de Alegra + valor.
 * Como en Alegra, se pueden registrar hasta 3 distintos; si la suma no llega al
 * total, la factura queda ABIERTA por el resto (p. ej. recaudo contraentrega).
 */
export const invoicePaymentSchema = z.object({
  accountId: z.string().min(1, 'Falta la cuenta'),
  amount: z.number().positive('Valor invalido'),
  method: invoicePaymentMethodSchema.default('transfer'),
});
export type InvoicePaymentInput = z.infer<typeof invoicePaymentSchema>;

export const createInvoiceSchema = z.object({
  lines: z.array(createInvoiceLineSchema).min(1, 'Agrega al menos un producto').max(50),
  // SOLO pedidos montados a mano: pagos elegidos (los VTEX siguen saliendo
  // pagados con la cuenta MARKETPLACE ADDI, como siempre).
  payments: z.array(invoicePaymentSchema).max(3, 'Maximo 3 pagos').optional(),
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
