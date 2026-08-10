import { z } from 'zod';

export const orderStatusSchema = z.enum(['ready-for-handling']);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

// 'manual' = pedido MONTADO a mano en una sede (externo a los marketplaces),
// el reemplazo del "montar pedido" que antes se escribia en Google Chat.
export const marketplaceProviderSchema = z.enum(['vtex', 'manual']);
export type MarketplaceProvider = z.infer<typeof marketplaceProviderSchema>;

/**
 * Estado del envio (derivado del rastreo de Coordinadora, guardado en el pedido
 * para poder listar/filtrar sin llamar a la transportadora por fila).
 */
export const shippingStateSchema = z.enum(['sin_movimientos', 'en_transito', 'novedad', 'entregado']);

/** Confirmacion de direccion por WhatsApp: confirmada tal cual, o modificada por el cliente. */
export const addressStatusSchema = z.enum(['confirmed', 'modified']);
export type AddressStatus = z.infer<typeof addressStatusSchema>;

/** Filtro de la columna "Direccion": confirmada, modificada, o 'pending' (sin responder = null). */
export const addressFilterSchema = z.enum(['confirmed', 'modified', 'pending']);
export type AddressFilter = z.infer<typeof addressFilterSchema>;

/** Cuerpo que manda Whapify (Solicitud de API Externa) al confirmar/modificar la direccion. */
export const confirmAddressWebhookSchema = z.object({
  phone: z.string().trim().min(5).max(30),
  action: addressStatusSchema, // 'confirmed' | 'modified'
  address: z.string().trim().max(500).optional(), // requerido cuando action='modified'
});
export type ConfirmAddressWebhookInput = z.infer<typeof confirmAddressWebhookSchema>;

/** Fila del registro de llamadas al webhook de confirmacion (diagnostico). */
export const confirmationLogEntrySchema = z.object({
  id: z.string(),
  phone: z.string(),
  action: z.string(),
  address: z.string().nullable(),
  /** Cuantos pedidos se actualizaron (0 = no matcheo / descartada). */
  matched: z.number().int(),
  /** Por que no se aplico (null cuando si se aplico). */
  note: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type ConfirmationLogEntry = z.infer<typeof confirmationLogEntrySchema>;
export type ShippingState = z.infer<typeof shippingStateSchema>;

export const orderItemSummarySchema = z.object({
  sku: z.string(),
  name: z.string(),
  quantity: z.number().int(),
  unitPrice: z.string(),
});

export type OrderItemSummary = z.infer<typeof orderItemSummarySchema>;

export const orderSummarySchema = z.object({
  id: z.string(),
  externalId: z.string(),
  provider: marketplaceProviderSchema,
  accountName: z.string(),
  customerName: z.string(),
  customerDocument: z.string().nullable(),
  // String libre: los pedidos generales son 'ready-for-handling', pero los
  // asignados a una sede pueden tener cualquier estado de VTEX.
  status: z.string(),
  totalValue: z.string(),
  currency: z.string().length(3),
  // Suma de unidades (quantity) y desglose de productos. itemCount = items.length.
  totalUnits: z.number().int(),
  items: z.array(orderItemSummarySchema),
  // Asignacion a sede: null = pedido general (sin asignar).
  warehouseId: z.string().nullable(),
  assignedAt: z.string().datetime().nullable(),
  // true si el pedido ya tiene al menos una foto IMEI/serial (indicador en la tabla).
  hasDevicePhoto: z.boolean(),
  // Mensajes sin leer para el usuario que consulta (0 si esta al dia). Badge en la fila.
  unreadCount: z.number().int().default(0),
  // Envio (denormalizado): Nº de guia + estado del rastreo de Coordinadora.
  guideNumber: z.string().nullable(),
  shippingState: shippingStateSchema.nullable(),
  shippingStatus: z.string().nullable(),
  shippingUpdatedAt: z.string().datetime().nullable(),
  // Confirmacion de direccion por WhatsApp: null = sin responder.
  addressStatus: addressStatusSchema.nullable(),
  confirmedAddress: z.string().nullable(),
  addressConfirmedAt: z.string().datetime().nullable(),
  // Plataforma de origen de un pedido MONTADO a mano (Krediya, Mercado Libre...).
  // null en los de marketplace (su plataforma es el provider: VTEX). El color
  // del badge se resuelve contra el catalogo de plataformas (Ajustes).
  platform: z.object({ id: z.string(), name: z.string() }).nullable().default(null),
  // "Tomar pedido": quien esta a cargo (null = libre). mine = lo tengo yo.
  claimedBy: z
    .object({ userId: z.string(), name: z.string(), mine: z.boolean() })
    .nullable()
    .default(null),
  // Reacciones al pedido (agregadas): emoji + cuantos + si yo reaccione.
  reactions: z
    .array(z.object({ emoji: z.string(), count: z.number().int(), mine: z.boolean() }))
    .default([]),
  marketplaceCreatedAt: z.string().datetime(),
  receivedAt: z.string().datetime(),
});

export type OrderSummary = z.infer<typeof orderSummarySchema>;

/** Reaccionar a un PEDIDO (toggle, como en los mensajes del chat). */
export const orderReactionInputSchema = z.object({
  emoji: z.string().trim().min(1).max(16),
});
export type OrderReactionInput = z.infer<typeof orderReactionInputSchema>;

/**
 * "Pulso" de la vista de pedidos: 4 metricas segun donde estes.
 * general: hoy/sinAsignar/direccionPendiente/sinTomar
 * pending: porPreparar/conFoto/direccionPendiente/sinTomar
 * invoiced: facturados/enCamino/novedades/entregados
 */
export const ordersPulseSchema = z.object({
  scope: z.enum(['general', 'pending', 'invoiced']),
  a: z.number().int(),
  b: z.number().int(),
  c: z.number().int(),
  d: z.number().int(),
  // Solo en general: diferencia de pedidos de hoy vs ayer.
  deltaToday: z.number().int().nullable(),
});
export type OrdersPulse = z.infer<typeof ordersPulseSchema>;

/**
 * "Montar pedido": pedido EXTERNO a las plataformas, escrito a mano en una sede
 * (recompras Krediya, ventas directas, etc.). El producto se elige del catalogo
 * de Alegra de la sede; la ciudad, del catalogo DANE de Coordinadora (asi la
 * guia sale sin adivinar). Solo existe dentro de una sede (nunca en generales).
 */
export const createManualOrderSchema = z.object({
  warehouseId: z.string().min(1, 'Falta la sede'),
  // Plataforma de origen (Krediya, Mercado Libre... — del catalogo de Ajustes).
  // VTEX no aplica aqui: esos llegan solos por la integracion.
  platformId: z.string().min(1, 'Elige la plataforma').max(40),
  customer: z.object({
    name: z.string().trim().min(2, 'Nombre requerido').max(120),
    document: z.string().trim().min(3, 'Cedula requerida').max(30),
    phone: z.string().trim().min(5, 'Telefono requerido').max(30),
    email: z.string().trim().email('Correo invalido').max(120).nullable().optional(),
    address: z.string().trim().min(3, 'Direccion requerida').max(300),
    cityCode: z.string().trim().min(4, 'Ciudad requerida').max(12), // codigo DANE
    cityName: z.string().trim().max(120).nullable().optional(),
    cityDepartment: z.string().trim().max(120).nullable().optional(),
  }),
  product: z.object({
    itemId: z.string().min(1, 'Elige el producto de Alegra'),
    name: z.string().trim().min(1).max(300),
    price: z.number().positive('Precio invalido'),
    quantity: z.number().int().min(1).max(50).default(1),
  }),
});
export type CreateManualOrderInput = z.infer<typeof createManualOrderSchema>;

// Asignar/transferir/devolver pedidos. warehouseId null = devolver a generales.
export const assignOrdersSchema = z.object({
  orderIds: z.array(z.string()).min(1, 'Selecciona al menos un pedido').max(500),
  warehouseId: z.string().nullable(),
});
export type AssignOrdersInput = z.infer<typeof assignOrdersSchema>;

export const orderSortFieldSchema = z.enum(['date', 'quantity', 'price']);
export type OrderSortField = z.infer<typeof orderSortFieldSchema>;

/**
 * Filtro por etapa (para separar en la sede): 'pending' = aun sin facturar (por
 * preparar), 'invoiced' = ya facturados. Se determina por la existencia del
 * evento de facturacion del pedido (sin campo denormalizado).
 */
export const orderStateFilterSchema = z.enum(['pending', 'invoiced']);
export type OrderStateFilter = z.infer<typeof orderStateFilterSchema>;

export const sortDirSchema = z.enum(['asc', 'desc']);
export type SortDir = z.infer<typeof sortDirSchema>;

export const listOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: orderStatusSchema.optional(),
  provider: marketplaceProviderSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  // Scope: ausente = pedidos generales (sin asignar); un id de sede = esa sede.
  warehouse: z.string().optional(),
  // Etapa: 'pending' (por preparar) | 'invoiced' (facturados). Solo aplica en sede.
  state: orderStateFilterSchema.optional(),
  // Filtro por estado del envio (Facturados).
  shipping: shippingStateSchema.optional(),
  // Filtro por confirmacion de direccion (General + Por preparar). Multiselect:
  // lista separada por comas, ej "confirmed,pending".
  address: z
    .string()
    .regex(/^(confirmed|modified|pending)(,(confirmed|modified|pending))*$/)
    .optional(),
  // Busqueda universal: matchea por nombre de cliente, N.º de pedido (externalId),
  // cedula (customerDocument) o nombre de producto (incluye multi-producto).
  q: z.string().trim().min(1).max(120).optional(),
  sort: orderSortFieldSchema.default('date'),
  dir: sortDirSchema.default('desc'),
});

export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

export const listOrdersResponseSchema = z.object({
  items: z.array(orderSummarySchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
  totalPages: z.number().int(),
});

export type ListOrdersResponse = z.infer<typeof listOrdersResponseSchema>;
