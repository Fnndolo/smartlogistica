import { z } from 'zod';

/**
 * WhatsApp por pedido via Whapify (Appcontx). El API oficial de Whapify SOLO
 * permite: buscar/crear contactos, enviar (texto/archivo/flow) y campos — NO
 * expone el historial de un chat ni webhooks. Por eso el historial VIVE AQUI:
 * - SALIENTES: todo lo que se envia desde la plataforma se guarda al enviarlo.
 * - ENTRANTES: un flow de Whapify ("Solicitud de API Externa" en el trigger de
 *   mensaje recibido) los reenvia a nuestro webhook y quedan guardados.
 * La pestaña WhatsApp del pedido (solo administradores) muestra el hilo por el
 * TELEFONO del cliente (un mismo cliente comparte hilo entre sus pedidos).
 */

// === Conexion (token del API de Whapify, global del workspace) ===

export const whapifyCredentialsSchema = z.object({
  token: z.string().trim().min(10, 'Token muy corto').max(200),
});
export type WhapifyCredentialsInput = z.infer<typeof whapifyCredentialsSchema>;

export const whapifyConnectionSummarySchema = z.object({
  accountName: z.string().nullable(),
  totalContacts: z.number().int().nullable(),
  status: z.enum(['connected', 'error']),
  lastError: z.string().nullable(),
  createdAt: z.string(),
});
export type WhapifyConnectionSummary = z.infer<typeof whapifyConnectionSummarySchema>;

export const whapifyTestResultSchema = z.object({
  ok: z.literal(true),
  accountName: z.string().nullable(),
  totalContacts: z.number().int().nullable(),
});
export type WhapifyTestResult = z.infer<typeof whapifyTestResultSchema>;

// === Conexion 360dialog (Cloud API de Meta via BSP api-first) ===
// Reemplazo de Whapify: acceso CRUDO a la Cloud API (webhooks de TODO,
// incluidos los mensajes enviados desde el celular con coexistencia).

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
  createdAt: z.string(),
});
export type WaMessage = z.infer<typeof waMessageSchema>;

/** Hilo de WhatsApp de un pedido (por el telefono del cliente). */
export const waThreadSchema = z.object({
  /** Telefono normalizado (10 digitos CO) o null si el pedido no trae telefono. */
  phone: z.string().nullable(),
  /** false = no hay conexion Whapify configurada (la pestaña lo explica). */
  connected: z.boolean(),
  /** Nombre del contacto en Whapify (si ya se resolvio alguna vez). */
  contactName: z.string().nullable(),
  messages: z.array(waMessageSchema),
});
export type WaThread = z.infer<typeof waThreadSchema>;

export const sendWaTextSchema = z.object({
  text: z.string().trim().min(1, 'Escribe el mensaje').max(4000),
});
export type SendWaTextInput = z.infer<typeof sendWaTextSchema>;

/**
 * Webhook de mensajes (mismo secreto que la confirmacion de direccion):
 * - El flow de Whapify reenvia los ENTRANTES: { phone, name?, text }.
 * - n8n puede espejar sus envios (ej. la confirmacion) con direction 'out'.
 */
export const waInboundSchema = z
  .object({
    phone: z.string().trim().min(5).max(30),
    name: z.string().trim().max(120).optional(),
    text: z.string().trim().max(4000).optional(),
    mediaUrl: z.string().trim().url().max(2000).optional(),
    type: waMessageKindSchema.optional(),
    direction: z.enum(['in', 'out']).default('in'),
    authorName: z.string().trim().max(120).optional(),
  })
  .refine((v) => (v.text ?? '').length > 0 || v.mediaUrl, {
    message: 'Falta el texto o el mediaUrl',
  });
export type WaInboundInput = z.infer<typeof waInboundSchema>;
