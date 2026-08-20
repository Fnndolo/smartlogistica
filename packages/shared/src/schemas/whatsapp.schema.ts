import { z } from 'zod';

/**
 * WhatsApp por pedido via la Cloud API de Meta (360dialog, BSP api-first).
 * El historial VIVE AQUI (WaMessage por telefono): los salientes se guardan al
 * enviarlos; TODO lo demas (entrantes, medios, estados y — con coexistencia —
 * los echoes de lo enviado desde el celular) llega por el webhook de la Cloud
 * API. La pestaña WhatsApp del pedido (solo administradores) muestra el hilo
 * por el TELEFONO del cliente (un mismo cliente comparte hilo entre pedidos).
 */

// === Conexion 360dialog (Cloud API de Meta via BSP api-first) ===

export const dialog360ModeSchema = z.enum(['sandbox', 'production']);
export type Dialog360Mode = z.infer<typeof dialog360ModeSchema>;

export const dialog360CredentialsSchema = z.object({
  apiKey: z.string().trim().min(10, 'API key muy corta').max(200),
  mode: dialog360ModeSchema.default('production'),
});
export type Dialog360CredentialsInput = z.infer<typeof dialog360CredentialsSchema>;

export const dialog360ConnectionSummarySchema = z.object({
  mode: dialog360ModeSchema,
  status: z.enum(['connected', 'error']),
  lastError: z.string().nullable(),
  /** URL del webhook que quedo configurada en 360dialog al conectar. */
  webhookUrl: z.string().nullable(),
  createdAt: z.string(),
});
export type Dialog360ConnectionSummary = z.infer<typeof dialog360ConnectionSummarySchema>;

export const dialog360TestResultSchema = z.object({ ok: z.literal(true) });
export type Dialog360TestResult = z.infer<typeof dialog360TestResultSchema>;

// === Mensajes ===

export const waMessageKindSchema = z.enum(['text', 'image', 'video', 'audio', 'file', 'sticker']);
export type WaMessageKind = z.infer<typeof waMessageKindSchema>;

/** Cita dentro de un mensaje (respuesta): resumen del mensaje citado. */
export const waReplyRefSchema = z.object({
  id: z.string(),
  direction: z.enum(['in', 'out']),
  kind: waMessageKindSchema,
  body: z.string().nullable(),
  authorName: z.string().nullable(),
});
export type WaReplyRef = z.infer<typeof waReplyRefSchema>;

export const waMessageSchema = z.object({
  id: z.string(),
  direction: z.enum(['in', 'out']),
  kind: waMessageKindSchema,
  body: z.string().nullable(),
  /** URL del medio (firmada si es nuestro storage; la del webhook si es entrante). */
  mediaUrl: z.string().nullable(),
  /** Quien lo envio desde la plataforma (salientes) o nombre del contacto (entrantes). */
  authorName: z.string().nullable(),
  /** Botones del mensaje (titulos) — se PINTAN en el hilo igual que en el cel. */
  buttons: z.array(z.string()).default([]),
  /** Mensaje citado (respuesta con quote), como en WhatsApp. */
  replyTo: waReplyRefSchema.nullable().default(null),
  /** Reacciones sobre el mensaje (emoji chips): mine = del negocio. */
  reactions: z.array(z.object({ emoji: z.string(), mine: z.boolean() })).default([]),
  /** Chulitos de salientes: queued (relojito: aceptado por NUESTRO server,
   *  el envio a Meta va en cola) | sent | delivered | read | failed. */
  status: z.enum(['queued', 'sent', 'delivered', 'read', 'failed']).nullable().default(null),
  /** Detalle del FALLO de entrega (se muestra al tocar la bolita roja). */
  error: z.string().nullable().default(null),
  /** Editado desde el celular ("Editado" junto a la hora). */
  edited: z.boolean().default(false),
  /** Destacado (estrella), como en WhatsApp. */
  starred: z.boolean().default(false),
  createdAt: z.string(),
});
export type WaMessage = z.infer<typeof waMessageSchema>;

/** Hilo de WhatsApp de un pedido (por el telefono del cliente). */
export const waThreadSchema = z.object({
  /** Telefono normalizado (10 digitos CO) o null si el pedido no trae telefono. */
  phone: z.string().nullable(),
  /** false = no hay conexion de WhatsApp configurada (la pestaña lo explica). */
  connected: z.boolean(),
  /** Nombre del contacto segun WhatsApp (si ya se resolvio alguna vez). */
  contactName: z.string().nullable(),
  /** Primer mensaje NO LEIDO por este usuario (divisor) y cuantos son. */
  firstUnreadId: z.string().nullable().default(null),
  unreadCount: z.number().int().default(0),
  messages: z.array(waMessageSchema),
});
export type WaThread = z.infer<typeof waThreadSchema>;

export const sendWaTextSchema = z.object({
  text: z.string().trim().min(1, 'Escribe el mensaje').max(4000),
  /** Responder citando: id del WaMessage citado. */
  replyToId: z.string().optional(),
});
export type SendWaTextInput = z.infer<typeof sendWaTextSchema>;

/** Reaccion a un mensaje (emoji vacio = quitar la reaccion). */
export const sendWaReactionSchema = z.object({
  messageId: z.string(),
  emoji: z.string().max(16),
});
export type SendWaReactionInput = z.infer<typeof sendWaReactionSchema>;

/** Reenviar un mensaje existente a OTRO chat (por telefono destino). */
export const forwardWaMessageSchema = z.object({ messageId: z.string() });
export type ForwardWaMessageInput = z.infer<typeof forwardWaMessageSchema>;

/** Destacar / quitar destacado. */
export const starWaMessageSchema = z.object({ messageId: z.string(), starred: z.boolean() });
export type StarWaMessageInput = z.infer<typeof starWaMessageSchema>;

/** Enviar un CONTACTO (tarjeta de contacto de WhatsApp). */
export const sendWaContactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(7).max(20),
});
export type SendWaContactInput = z.infer<typeof sendWaContactSchema>;

/** Sticker favorito del negocio (compartido entre admins). */
export const waStickerFavSchema = z.object({ id: z.string(), url: z.string() });
export type WaStickerFav = z.infer<typeof waStickerFavSchema>;

/** Enviar sticker: uno FAVORITO (stickerId) o el de un mensaje existente (messageId). */
export const sendWaStickerSchema = z.object({
  stickerId: z.string().optional(),
  messageId: z.string().optional(),
});
export type SendWaStickerInput = z.infer<typeof sendWaStickerSchema>;

/** Agregar sticker a favoritos desde un mensaje del hilo. */
export const addWaStickerFavSchema = z.object({ messageId: z.string() });
export type AddWaStickerFavInput = z.infer<typeof addWaStickerFavSchema>;

// === Plantillas de Meta (WABA via 360dialog) ===
// El picker de "/" en el chat: lista las plantillas REALES de la WABA y las
// envia con variables. Las variables 1/2/3 se sugieren con datos del pedido.

export const waTemplateSchema = z.object({
  name: z.string(),
  language: z.string(),
  /** UTILITY | MARKETING | AUTHENTICATION (como la clasifica Meta). */
  category: z.string(),
  /** approved | pending | rejected | ... (minusculas). */
  status: z.string(),
  /** Cuerpo con sus {{n}} tal cual esta aprobado en Meta. */
  body: z.string(),
  /** Titulos de los botones (se pintan en la burbuja del hilo). */
  buttons: z.array(z.string()),
  /** Cuantas variables {{n}} usa el cuerpo. */
  variables: z.number().int().min(0),
});
export type WaTemplate = z.infer<typeof waTemplateSchema>;

export const waTemplateListSchema = z.object({
  templates: z.array(waTemplateSchema),
  /** Sugerencias sacadas del PEDIDO para prellenar variables. */
  suggestions: z.object({
    nombre: z.string(),
    productos: z.string(),
    direccion: z.string(),
  }),
});
export type WaTemplateList = z.infer<typeof waTemplateListSchema>;

// === Bandeja de entrada (inbox estilo WhatsApp Web) ===

/** Un chat de la bandeja: ultimo mensaje + no leidos + etiquetas. */
export const waInboxItemSchema = z.object({
  phone: z.string(),
  /** Nombre del contacto (WhatsApp o agenda del celular) o null. */
  name: z.string().nullable(),
  labels: z.array(z.string()).default([]),
  lastAt: z.string(),
  lastKind: waMessageKindSchema,
  lastBody: z.string().nullable(),
  lastDirection: z.enum(['in', 'out']),
  /** Chulitos del ultimo mensaje SALIENTE (queued/sent/delivered/read/failed). */
  lastStatus: z.enum(['queued', 'sent', 'delivered', 'read', 'failed']).nullable().default(null),
  /** Mensajes entrantes sin leer POR ESTE usuario (contador verde). */
  unread: z.number().int().min(0),
  /** Estado del ENVIO del ultimo pedido del telefono (pastilla sobre la
   *  hora): canonico (sin_movimientos|en_transito|novedad|entregado) + el
   *  texto crudo de Coordinadora. null = sin guia / sin pedido. */
  shippingState: z.string().nullable().default(null),
  shippingStatus: z.string().nullable().default(null),
  /** Operaciones de bandeja (menu contextual), globales del negocio. */
  archived: z.boolean().default(false),
  muted: z.boolean().default(false),
  pinned: z.boolean().default(false),
});
export type WaInboxItem = z.infer<typeof waInboxItemSchema>;

/** Etiqueta registrada con su color. */
export const waLabelSchema = z.object({ name: z.string(), color: z.string() });
export type WaLabel = z.infer<typeof waLabelSchema>;

export const waInboxSchema = z.object({
  chats: z.array(waInboxItemSchema),
  /** Todas las etiquetas existentes (con color) para filtro y picker. */
  labels: z.array(waLabelSchema),
});
export type WaInbox = z.infer<typeof waInboxSchema>;

export const setWaLabelsSchema = z.object({
  /** Etiquetas del chat, cada una con su color (se registra/actualiza). */
  labels: z
    .array(z.object({ name: z.string().trim().min(1).max(30), color: z.string().max(20) }))
    .max(10),
});
export type SetWaLabelsInput = z.infer<typeof setWaLabelsSchema>;

/** Operaciones del menu contextual del chat. */
export const waChatOpSchema = z.object({
  archived: z.boolean().optional(),
  muted: z.boolean().optional(),
  pinned: z.boolean().optional(),
});
export type WaChatOpInput = z.infer<typeof waChatOpSchema>;

export const sendWaTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  language: z.string().trim().min(2).max(15),
  params: z.array(z.string().trim().min(1, 'Completa la variable').max(500)).max(10).default([]),
});
export type SendWaTemplateInput = z.infer<typeof sendWaTemplateSchema>;

