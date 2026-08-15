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

export const waMessageKindSchema = z.enum(['text', 'image', 'video', 'audio', 'file']);
export type WaMessageKind = z.infer<typeof waMessageKindSchema>;

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
  messages: z.array(waMessageSchema),
});
export type WaThread = z.infer<typeof waThreadSchema>;

export const sendWaTextSchema = z.object({
  text: z.string().trim().min(1, 'Escribe el mensaje').max(4000),
});
export type SendWaTextInput = z.infer<typeof sendWaTextSchema>;

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

export const sendWaTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  language: z.string().trim().min(2).max(15),
  params: z.array(z.string().trim().min(1, 'Completa la variable').max(500)).max(10).default([]),
});
export type SendWaTemplateInput = z.infer<typeof sendWaTemplateSchema>;

