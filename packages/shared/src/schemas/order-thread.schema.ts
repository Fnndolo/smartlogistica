import { z } from 'zod';

import { orderSummarySchema } from './order.schema';

/**
 * Detalle completo de un pedido (pestaña "Detalle" del drawer). Extiende el
 * summary con contacto y direccion de envio (derivada del rawPayload en el server).
 */
export const orderDetailSchema = orderSummarySchema.extend({
  customerEmail: z.string().nullable(),
  customerPhone: z.string().nullable(),
  shippingAddress: z.string().nullable(),
  updatedAt: z.string().datetime(),
});
export type OrderDetail = z.infer<typeof orderDetailSchema>;

// === Conversacion ===

export const orderMessageKindSchema = z.enum([
  'text',
  'imei_photo',
  'serial_photo',
  'document',
  'file', // adjunto normal (foto/video/archivo), sin lectura de IMEI/serial
  'system',
]);
export type OrderMessageKind = z.infer<typeof orderMessageKindSchema>;

/** Resumen de reacciones a un mensaje, agrupadas por emoji. */
export const messageReactionSchema = z.object({
  emoji: z.string(),
  count: z.number().int(),
  /** Si YO reaccione con este emoji (para pintar el chip activo y togglear). */
  mine: z.boolean(),
  /** Nombres de quienes reaccionaron (tooltip). */
  users: z.array(z.string()),
});
export type MessageReaction = z.infer<typeof messageReactionSchema>;

export const orderMessageSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  authorId: z.string(),
  authorName: z.string(),
  kind: orderMessageKindSchema,
  body: z.string().nullable(),
  // Texto que acompaña un adjunto (estilo WhatsApp): viaja EN el mismo mensaje.
  caption: z.string().nullable().default(null),
  attachmentUrl: z.string().nullable(),
  attachmentMime: z.string().nullable(),
  imeis: z.array(z.string()),
  // userIds mencionados con @ (para resaltar y notificar).
  mentions: z.array(z.string()),
  // Id del mensaje citado (responder); el front lo resuelve en la lista cargada.
  replyToId: z.string().nullable(),
  reactions: z.array(messageReactionSchema),
  createdAt: z.string().datetime(),
});
export type OrderMessage = z.infer<typeof orderMessageSchema>;

export const createOrderMessageSchema = z.object({
  body: z.string().trim().min(1, 'Escribe un mensaje').max(2000),
  // userIds mencionados; el server los valida contra el equipo del workspace.
  mentions: z.array(z.string()).max(20).optional(),
  // Mensaje al que se responde (debe ser del mismo pedido).
  replyToId: z.string().optional(),
});
export type CreateOrderMessageInput = z.infer<typeof createOrderMessageSchema>;

/** Alternar una reaccion (si ya existe la mia con ese emoji, se quita). */
export const toggleReactionSchema = z.object({
  emoji: z.string().trim().min(1).max(16),
});
export type ToggleReactionInput = z.infer<typeof toggleReactionSchema>;

// === Bandeja de no leidos (la campana de notificaciones) ===

/** Un pedido con actividad sin leer para el usuario actual. */
export const inboxItemSchema = z.object({
  orderId: z.string(),
  externalId: z.string(),
  customerName: z.string(),
  warehouseId: z.string().nullable(),
  unreadCount: z.number().int(),
  mentioned: z.boolean(), // true si alguno de los no leidos me menciona
  lastMessageAt: z.string().datetime(),
  preview: z.string(),
  /** Quien escribio el ultimo mensaje ("Ingrid Tatiana"). */
  lastAuthor: z.string(),
});
export type InboxItem = z.infer<typeof inboxItemSchema>;

export const inboxSchema = z.object({
  items: z.array(inboxItemSchema),
  totalUnread: z.number().int(),
  mentions: z.number().int(),
});
export type Inbox = z.infer<typeof inboxSchema>;

// === Menciones (pagina tipo Google Chat) ===

/** Una mencion a mi en el chat de un pedido. */
export const mentionItemSchema = z.object({
  messageId: z.string(),
  orderId: z.string(),
  externalId: z.string(),
  customerName: z.string(),
  warehouseId: z.string().nullable(),
  warehouseName: z.string().nullable(),
  /** 'general' (sin asignar) | 'pending' (por preparar) | 'invoiced' (facturados). */
  stage: z.enum(['general', 'pending', 'invoiced']),
  author: z.string(),
  body: z.string(),
  createdAt: z.string().datetime(),
  unread: z.boolean(),
});
export type MentionItem = z.infer<typeof mentionItemSchema>;

// === Busqueda global (pedidos en generales y todas las sedes) ===

export const orderSearchResultSchema = z.object({
  orderId: z.string(),
  externalId: z.string(),
  customerName: z.string(),
  customerDocument: z.string().nullable(),
  productName: z.string().nullable(),
  warehouseId: z.string().nullable(),
  warehouseName: z.string().nullable(),
  stage: z.enum(['general', 'pending', 'invoiced']),
  createdAt: z.string().datetime(),
});
export type OrderSearchResult = z.infer<typeof orderSearchResultSchema>;

// === Actividad ===

export const orderEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  actorName: z.string().nullable(),
  data: z.record(z.unknown()),
  createdAt: z.string().datetime(),
});
export type OrderEvent = z.infer<typeof orderEventSchema>;
