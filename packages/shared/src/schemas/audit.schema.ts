import { z } from 'zod';

/**
 * BITACORA (Registros): cada movimiento que amerita seguimiento — ingresos,
 * facturas, guias, movidas de sede, mensajes eliminados o editados, altas y
 * bajas del equipo. Solo la ve el PROPIETARIO (OWNER).
 *
 * No es una tabla nueva: se arma uniendo lo que ya se registraba (la
 * actividad de cada pedido, las ediciones del chat y los ingresos del
 * control-plane) con lo que antes no dejaba rastro (borrados, equipo, sedes),
 * que va a la tabla AuditLog del tenant. Asi la bitacora nace con historia.
 */

export const auditCategorySchema = z.enum([
  'acceso',
  'pedidos',
  'facturas',
  'guias',
  'mensajes',
  'equipo',
  'sedes',
]);
export type AuditCategory = z.infer<typeof auditCategorySchema>;

export const auditEntrySchema = z.object({
  /** Unico entre fuentes: 'ev:' actividad, 'ed:' edicion, 'au:' AuditLog, 'sy:' ingreso. */
  id: z.string(),
  /** Que paso, en forma de clave estable (order.assigned, chat.message_deleted...). */
  action: z.string(),
  category: auditCategorySchema,
  actorId: z.string().nullable(),
  /** null = lo hizo el sistema (o VTEX, o el celular de WhatsApp). */
  actorName: z.string().nullable(),
  /** La frase que se lee en la fila: "Facturó FV-1234", "Asignó a PASTO"... */
  summary: z.string(),
  /** Texto extra: lo que decia el mensaje borrado, el antes y el despues... */
  detail: z.string().nullable().default(null),
  /** Pedido al que se refiere (para abrirlo desde la bitacora). */
  order: z
    .object({
      id: z.string(),
      externalId: z.string(),
      customerName: z.string(),
      warehouseId: z.string().nullable(),
    })
    .nullable()
    .default(null),
  /** Chat de WhatsApp al que se refiere (telefono, 10 digitos). */
  phone: z.string().nullable().default(null),
  ip: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditQuerySchema = z.object({
  /** Opaco: lo devuelve la pagina anterior (nextCursor). */
  cursor: z.string().max(8000).optional(),
  category: auditCategorySchema.optional(),
  /** userId de quien lo hizo. */
  actor: z.string().trim().min(1).max(60).optional(),
  /** Busca por pedido, cliente o persona. */
  q: z.string().trim().min(1).max(120).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(10).max(100).default(60),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export const auditPageSchema = z.object({
  items: z.array(auditEntrySchema),
  /** null = no hay mas hacia atras. */
  nextCursor: z.string().nullable(),
});
export type AuditPage = z.infer<typeof auditPageSchema>;
