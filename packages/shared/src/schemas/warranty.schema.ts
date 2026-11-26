import { z } from 'zod';

/**
 * GARANTIAS: el equipo que el cliente trae a la tienda por una falla. Reemplaza
 * la hoja de calculo "GARANTIAS" (un registro por radicado).
 *
 * Ciclo: Recibida -> En proveedor -> Lista para entregar -> Cerrada. Cerrar
 * pide COMO termino (reparada, cambio de equipo, devolucion o no procede). La
 * hoja solo distinguia "EN TRAMITE" (las tres primeras) y "CUMPLIDA".
 */
export const warrantyStatusSchema = z.enum(['received', 'at_supplier', 'ready', 'closed']);
export type WarrantyStatus = z.infer<typeof warrantyStatusSchema>;

export const WARRANTY_STATUS_LABEL: Record<WarrantyStatus, string> = {
  received: 'Recibida',
  at_supplier: 'En proveedor',
  ready: 'Lista para entregar',
  closed: 'Cerrada',
};

/** Orden del ciclo (la barra de pasos). */
export const WARRANTY_STATUS_ORDER: WarrantyStatus[] = [
  'received',
  'at_supplier',
  'ready',
  'closed',
];

/**
 * A donde se puede pasar desde cada estado. Se puede saltar el proveedor (se
 * resolvio en la tienda) y devolver un paso; reabrir una cerrada es de admins.
 */
export const WARRANTY_TRANSITIONS: Record<WarrantyStatus, WarrantyStatus[]> = {
  received: ['at_supplier', 'ready', 'closed'],
  at_supplier: ['ready', 'closed', 'received'],
  ready: ['closed', 'at_supplier'],
  closed: ['received'],
};

export const warrantyResolutionSchema = z.enum(['repaired', 'replaced', 'refunded', 'denied']);
export type WarrantyResolution = z.infer<typeof warrantyResolutionSchema>;

export const WARRANTY_RESOLUTION_LABEL: Record<WarrantyResolution, string> = {
  repaired: 'Reparada',
  replaced: 'Cambio de equipo',
  refunded: 'Devolución de dinero',
  denied: 'No procede',
};

export const warrantyDeviceTypeSchema = z.enum([
  'celular',
  'computador',
  'tablet',
  'accesorio',
  'otro',
]);
export type WarrantyDeviceType = z.infer<typeof warrantyDeviceTypeSchema>;

export const WARRANTY_DEVICE_LABEL: Record<WarrantyDeviceType, string> = {
  celular: 'Celular',
  computador: 'Computador',
  tablet: 'Tablet',
  accesorio: 'Accesorio',
  otro: 'Otro',
};

export const warrantyAccessorySchema = z.enum(['cargador', 'cable', 'estuche', 'caja', 'otro']);
export type WarrantyAccessory = z.infer<typeof warrantyAccessorySchema>;

export const WARRANTY_ACCESSORY_LABEL: Record<WarrantyAccessory, string> = {
  cargador: 'Cargador',
  cable: 'Cable USB',
  estuche: 'Estuche',
  caja: 'Caja',
  otro: 'Otro',
};

/**
 * Para que es un archivo de la conversacion. Reemplaza las columnas sueltas de
 * la hoja (FOTO DE RECEPCION 1-3, VIDEO, SOPORTE DE ENTREGA, SOPORTE DE CIERRE):
 * aqui cada una admite VARIOS archivos.
 */
export const warrantyFileTagSchema = z.enum(['recepcion', 'proveedor', 'cierre']);
export type WarrantyFileTag = z.infer<typeof warrantyFileTagSchema>;

export const WARRANTY_FILE_TAG_LABEL: Record<WarrantyFileTag, string> = {
  recepcion: 'Recepción',
  proveedor: 'Entrega a proveedor',
  cierre: 'Soporte de cierre',
};

/** Fecha sin hora (AAAA-MM-DD): recepcion, compra, entrega al proveedor. */
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha invalida');

/** Texto opcional: vacio = null (el formulario manda "" cuando no se llena). */
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const warrantyInputSchema = z.object({
  receivedAt: dateOnly,
  store: z.string().trim().min(2, 'Elige la tienda').max(80),
  customerName: z.string().trim().min(2, 'Escribe el nombre del cliente').max(120),
  customerDocument: z.string().trim().min(3, 'Escribe el documento').max(30),
  customerPhone: z.string().trim().min(5, 'Escribe el telefono').max(30),
  customerEmail: z
    .string()
    .trim()
    .max(120)
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Correo invalido'),
  city: z.string().trim().min(2, 'Escribe la ciudad').max(80),
  deviceType: warrantyDeviceTypeSchema,
  brand: z.string().trim().min(1, 'Escribe la marca').max(60),
  model: z.string().trim().min(1, 'Escribe la referencia').max(120),
  serial: z.string().trim().min(3, 'Escribe el IMEI o serial').max(60),
  purchaseDate: dateOnly.nullish().transform((v) => v ?? null),
  invoiceNumber: optText(40),
  physicalCondition: z.string().trim().min(2, 'Describe el estado fisico').max(500),
  reason: z.string().trim().min(3, 'Escribe el motivo').max(1000),
  accessories: z.array(warrantyAccessorySchema).max(5).default([]),
  comments: optText(1000),
  assigneeId: z
    .string()
    .max(60)
    .nullish()
    .transform((v) => v ?? null),
  supplier: optText(120),
});
export type WarrantyInput = z.infer<typeof warrantyInputSchema>;

export const createWarrantySchema = warrantyInputSchema;
export type CreateWarrantyInput = z.input<typeof createWarrantySchema>;

export const updateWarrantySchema = warrantyInputSchema.partial();
export type UpdateWarrantyInput = z.input<typeof updateWarrantySchema>;

/**
 * Cambio de estado. Lo que pide cada destino lo valida el API:
 * - at_supplier: proveedor (y fecha de entrega, por defecto hoy).
 * - ready: como se resolvio.
 * - closed: como se resolvio + nota de cierre.
 * - received (devolver o reabrir): el motivo en la nota.
 */
export const warrantyStatusChangeSchema = z.object({
  to: warrantyStatusSchema,
  supplier: optText(120),
  supplierSentAt: dateOnly.nullish().transform((v) => v ?? null),
  resolution: warrantyResolutionSchema.nullish().transform((v) => v ?? null),
  note: optText(1000),
});
export type WarrantyStatusChangeInput = z.input<typeof warrantyStatusChangeSchema>;

export const warrantySummarySchema = z.object({
  id: z.string(),
  number: z.number().int(),
  status: warrantyStatusSchema,
  resolution: warrantyResolutionSchema.nullable(),
  receivedAt: z.string(),
  store: z.string(),
  customerName: z.string(),
  customerDocument: z.string(),
  customerPhone: z.string(),
  city: z.string(),
  deviceType: warrantyDeviceTypeSchema,
  brand: z.string(),
  model: z.string(),
  serial: z.string(),
  reason: z.string(),
  assigneeId: z.string().nullable(),
  assigneeName: z.string().nullable(),
  supplier: z.string().nullable(),
  closedAt: z.string().nullable(),
  updatedAt: z.string(),
  /** Archivos en la conversacion (fotos, videos, soportes). */
  fileCount: z.number().int(),
});
export type WarrantySummary = z.infer<typeof warrantySummarySchema>;

export const warrantyEventSchema = z.object({
  id: z.string(),
  type: z.enum(['created', 'status', 'updated']),
  fromStatus: warrantyStatusSchema.nullable(),
  toStatus: warrantyStatusSchema.nullable(),
  note: z.string().nullable(),
  /** En 'updated': los campos que cambiaron ({ campo: [antes, ahora] }). */
  data: z.record(z.unknown()).nullable(),
  actorName: z.string(),
  createdAt: z.string(),
});
export type WarrantyEvent = z.infer<typeof warrantyEventSchema>;

export const warrantyDetailSchema = warrantySummarySchema.extend({
  customerEmail: z.string().nullable(),
  purchaseDate: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  physicalCondition: z.string(),
  accessories: z.array(warrantyAccessorySchema),
  comments: z.string().nullable(),
  supplierSentAt: z.string().nullable(),
  closureNote: z.string().nullable(),
  createdByName: z.string(),
  createdAt: z.string(),
  events: z.array(warrantyEventSchema),
});
export type WarrantyDetail = z.infer<typeof warrantyDetailSchema>;

export const warrantyMessageSchema = z.object({
  id: z.string(),
  kind: z.enum(['text', 'file', 'system']),
  body: z.string().nullable(),
  tag: warrantyFileTagSchema.nullable(),
  attachmentUrl: z.string().nullable(),
  attachmentMime: z.string().nullable(),
  attachmentName: z.string().nullable(),
  authorId: z.string(),
  authorName: z.string(),
  createdAt: z.string(),
});
export type WarrantyMessage = z.infer<typeof warrantyMessageSchema>;

export const createWarrantyMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});
export type CreateWarrantyMessageInput = z.infer<typeof createWarrantyMessageSchema>;

/** Filtro de la lista: 'open' = todo lo que no esta cerrado (la vista de trabajo). */
export const warrantyListFilterSchema = z.enum([
  'open',
  'received',
  'at_supplier',
  'ready',
  'closed',
  'all',
]);
export type WarrantyListFilter = z.infer<typeof warrantyListFilterSchema>;

export const listWarrantiesQuerySchema = z.object({
  status: warrantyListFilterSchema.default('open'),
  q: z.string().trim().max(100).optional(),
  store: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListWarrantiesQuery = z.infer<typeof listWarrantiesQuerySchema>;

export const warrantyListResponseSchema = z.object({
  items: z.array(warrantySummarySchema),
  total: z.number().int(),
  page: z.number().int(),
  totalPages: z.number().int(),
  /** Cuantas hay en cada estado (con la busqueda y la tienda aplicadas). */
  counts: z.object({
    received: z.number().int(),
    at_supplier: z.number().int(),
    ready: z.number().int(),
    closed: z.number().int(),
  }),
});
export type WarrantyListResponse = z.infer<typeof warrantyListResponseSchema>;

/** Valores ya usados, para sugerir al escribir (tiendas, marcas, proveedores...). */
export const warrantySuggestionsSchema = z.object({
  stores: z.array(z.string()),
  brands: z.array(z.string()),
  suppliers: z.array(z.string()),
  cities: z.array(z.string()),
});
export type WarrantySuggestions = z.infer<typeof warrantySuggestionsSchema>;
