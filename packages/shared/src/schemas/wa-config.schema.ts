import { z } from 'zod';

/**
 * CONFIGURACION DE WHATSAPP: las lineas (numeros conectados) y los mensajes
 * automaticos que salen solos.
 *
 * La regla que gobierna todo: mientras no exista NINGUNA fila de un tipo de
 * flujo, ese flujo se comporta exactamente como estaba cableado en codigo. En
 * cuanto existe una, manda la tabla. Asi la pantalla se puede soltar sin
 * cambiarle el comportamiento a nadie.
 */

/** Proveedor de la linea. El cuerpo de los mensajes es Cloud API en los dos. */
export const waProviderSchema = z.enum(['dialog360', 'meta']);
export type WaProvider = z.infer<typeof waProviderSchema>;

/** Una linea de WhatsApp (un numero). Nunca incluye credenciales. */
export const waLineSummarySchema = z.object({
  id: z.string(),
  label: z.string(),
  provider: waProviderSchema,
  /** Numero en E.164 si el proveedor lo reporta. */
  phone: z.string().nullable().default(null),
  mode: z.enum(['sandbox', 'production']),
  isDefault: z.boolean(),
  status: z.enum(['connected', 'error']),
  lastError: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type WaLineSummary = z.infer<typeof waLineSummarySchema>;

/**
 * Los cuatro mensajes automaticos. Son fijos porque cada uno lleva guardas
 * propias en codigo (frescura del pedido, idempotencia, maquina de estados);
 * lo que es configurable es si esta encendido, por que linea sale, a que
 * tiendas aplica y sus textos.
 */
export const waFlowKindSchema = z.enum(['confirmation', 'guide', 'upsell', 'autoreply']);
export type WaFlowKind = z.infer<typeof waFlowKindSchema>;

export const WA_FLOW_LABEL: Record<WaFlowKind, string> = {
  confirmation: 'Confirmación del pedido',
  guide: 'Guía de envío',
  upsell: 'Respaldo post-venta',
  autoreply: 'Respuestas automáticas',
};

export const WA_FLOW_HELP: Record<WaFlowKind, string> = {
  confirmation: 'Al entrar un pedido nuevo le pide al cliente que confirme o corrija su dirección.',
  guide: 'Al generar la guía le manda el rótulo y el enlace de rastreo.',
  upsell: 'Después de la entrega ofrece el respaldo. Son tres toques con espera entre ellos.',
  autoreply:
    'El bot que atiende las respuestas del cliente a la confirmación (botones y dirección nueva).',
};

/**
 * A que pedidos aplica un flujo. `'*'` = todos. Si no, claves de fuente:
 * `vtex:<cuenta>` para marketplaces y `manual:<plataforma>` para los montados
 * a mano. Es la MISMA clave en todos lados: un solo formato, un solo bug posible.
 */
export const waFlowScopeSchema = z.array(z.string().trim().min(1).max(80)).min(1).default(['*']);

/** Ajustes propios de cada tipo. Todo opcional: lo que falte usa el default de codigo. */
export const waFlowConfigSchema = z
  .object({
    /** confirmation: horas de frescura del pedido (hoy 48). */
    maxAgeHours: z.number().int().min(1).max(720).optional(),
    /** confirmation / autoreply: respuesta cuando el cliente confirma. */
    confirmedReply: z.string().trim().max(1000).optional(),
    /** autoreply: que se le pide y como se reintenta. */
    askAddress: z.string().trim().max(1000).optional(),
    retryAddress: z.string().trim().max(1000).optional(),
    /** upsell: textos de los dos primeros toques y minutos de espera. */
    step1Text: z.string().trim().max(1000).optional(),
    step2Text: z.string().trim().max(1000).optional(),
    stepDelayMinutes: z.number().int().min(1).max(1440).optional(),
    /** Orden de preferencia de plantillas: gana la primera APROBADA en esa WABA. */
    templateNames: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
  })
  .default({});
export type WaFlowConfig = z.infer<typeof waFlowConfigSchema>;

export const waFlowSchema = z.object({
  id: z.string(),
  kind: waFlowKindSchema,
  lineId: z.string(),
  /** Nombre de la linea, para pintarlo sin otra consulta. */
  lineLabel: z.string(),
  enabled: z.boolean(),
  scope: waFlowScopeSchema,
  config: waFlowConfigSchema,
  priority: z.number().int(),
  createdAt: z.string(),
});
export type WaFlow = z.infer<typeof waFlowSchema>;

/** Crear o modificar un flujo. */
export const saveWaFlowSchema = z.object({
  kind: waFlowKindSchema,
  lineId: z.string().min(6),
  enabled: z.boolean().default(true),
  scope: waFlowScopeSchema,
  config: waFlowConfigSchema,
  priority: z.number().int().min(0).max(100).default(0),
});
export type SaveWaFlowInput = z.infer<typeof saveWaFlowSchema>;

/**
 * Una FUENTE de pedidos a la que se puede apuntar un flujo: una tienda de
 * marketplace o una plataforma de los pedidos montados a mano.
 */
export const waSourceSchema = z.object({
  /** `vtex:<cuenta>` o `manual:<plataforma>`. */
  key: z.string(),
  label: z.string(),
});
export type WaSource = z.infer<typeof waSourceSchema>;

/** Todo lo que necesita la pantalla de configuracion, en un solo viaje. */
export const waConfigOverviewSchema = z.object({
  lines: z.array(waLineSummarySchema),
  flows: z.array(waFlowSchema),
  /** Tiendas/plataformas a las que se puede apuntar un flujo. */
  sources: z.array(waSourceSchema),
  /** true = hay mas de una linea o mas de una fuente: se muestra el alcance.
   *  Con una sola de cada, el selector solo estorbaria. */
  showScope: z.boolean(),
  /** Flujos que AUN no tienen fila: se comportan con el default de codigo. */
  unconfigured: z.array(waFlowKindSchema),
});
export type WaConfigOverview = z.infer<typeof waConfigOverviewSchema>;
