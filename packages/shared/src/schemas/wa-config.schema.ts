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
  /** connected = lista. pending = alta hecha, falta que Meta verifique el
   *  webhook (solo pasa con la API nativa). error = la credencial fallo. */
  status: z.enum(['connected', 'pending', 'error']),
  lastError: z.string().nullable().default(null),
  /** URL a la que el proveedor debe mandar los mensajes de ESTA linea. En Meta
   *  hay que pegarla a mano en el panel de la App; en 360dialog se configura
   *  sola al conectar. */
  webhookUrl: z.string().nullable().default(null),
  /** Solo Meta: token del challenge del webhook. No es secreto. */
  verifyToken: z.string().nullable().default(null),
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
 * Dar de alta una LINEA nueva.
 *
 * 360dialog: basta la API key. Meta nativa: el token permanente de la App, el
 * id del numero y el de la WABA — y ademas hay que pegar en el panel de Meta la
 * URL del webhook y el token de verificacion que devuelve el alta.
 */
export const createWaLineSchema = z
  .object({
    label: z.string().trim().min(2, 'Ponle un nombre').max(40),
    provider: waProviderSchema.default('dialog360'),
    apiKey: z.string().trim().min(10, 'Credencial muy corta').max(500),
    mode: z.enum(['sandbox', 'production']).default('production'),
    countryCode: z
      .string()
      .trim()
      .regex(/^\d{1,4}$/)
      .default('57'),
    /** Solo Meta. */
    phoneNumberId: z.string().trim().max(40).optional(),
    wabaId: z.string().trim().max(40).optional(),
    appSecret: z.string().trim().min(16, 'App Secret muy corto').max(200).optional(),
    /** Marcarla como la que se usa cuando ninguna regla dice otra cosa. */
    isDefault: z.boolean().default(false),
  })
  .refine((v) => v.provider !== 'meta' || (v.phoneNumberId && v.wabaId), {
    message: 'Con la API de Meta hacen falta el ID del número y el de la WABA',
    path: ['phoneNumberId'],
  })
  // `mode` es un concepto de 360dialog (tiene un host de pruebas aparte). En
  // Meta un numero de prueba vive en una WABA normal: no hay otro host ni otro
  // comportamiento, asi que ofrecerlo seria mentir.
  .refine((v) => v.provider !== 'meta' || v.mode !== 'sandbox', {
    message: 'La API de Meta no tiene modo de pruebas',
    path: ['mode'],
  })
  // NO es opcional aunque lo parezca: sin App Secret no hay forma de comprobar
  // que un mensaje entrante viene de verdad de Meta, y el webhook — que es una
  // ruta publica — rechaza todo lo que no pueda verificar. Una linea sin el se
  // veria conectada y no recibiria ni un mensaje.
  .refine((v) => v.provider !== 'meta' || Boolean(v.appSecret?.trim()), {
    message: 'Con la API de Meta hace falta el App Secret: sin él no se puede verificar la firma',
    path: ['appSecret'],
  });
export type CreateWaLineInput = z.infer<typeof createWaLineSchema>;

/** Renombrar una linea o convertirla en la predeterminada. */
export const updateWaLineSchema = z.object({
  label: z.string().trim().min(2).max(40).optional(),
  isDefault: z.boolean().optional(),
  /**
   * Credencial NUEVA para la misma linea.
   *
   * Hace falta porque los proveedores la rotan solos: 360dialog entrega otra
   * API key cada vez que se reconecta un canal, y un token de Meta se puede
   * revocar. Sin esto, rotar la clave dejaba la plataforma apuntando a una
   * credencial muerta y sin ninguna forma de arreglarlo desde la pantalla —
   * desconectar tampoco vale cuando es la unica linea.
   */
  apiKey: z.string().trim().min(10, 'Credencial muy corta').max(500).optional(),
  /** Solo Meta, y solo si tambien cambio. */
  appSecret: z.string().trim().min(16).max(200).optional(),
});
export type UpdateWaLineInput = z.infer<typeof updateWaLineSchema>;

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

// === PLANTILLAS DE META ===
// Fuera de la ventana de 24h Meta solo deja escribir con una plantilla que EL
// aprobo. Aqui se ven, se crean y se borran; editarlas no se puede — ver
// `createWaTemplateSchema`.

export const waTemplateCategorySchema = z.enum(['UTILITY', 'MARKETING', 'AUTHENTICATION']);
export type WaTemplateCategory = z.infer<typeof waTemplateCategorySchema>;

export const WA_TEMPLATE_CATEGORY_LABEL: Record<WaTemplateCategory, string> = {
  UTILITY: 'Servicio',
  MARKETING: 'Publicidad',
  AUTHENTICATION: 'Claves',
};

export const WA_TEMPLATE_CATEGORY_HELP: Record<WaTemplateCategory, string> = {
  UTILITY:
    'Sobre un pedido que el cliente ya hizo: confirmar, avisar del envio, posventa. Es la mas barata y la que Meta aprueba sin pelear.',
  MARKETING: 'Ofertas y novedades. Cuesta mas y el cliente la puede silenciar.',
  AUTHENTICATION: 'Codigos de un solo uso. No la necesitas aqui.',
};

/**
 * Un boton de plantilla. Se admiten los dos tipos que sirven de verdad aqui:
 * respuesta rapida (la que usa la confirmacion de direccion) y enlace.
 */
export const waTemplateButtonSchema = z.object({
  type: z.enum(['QUICK_REPLY', 'URL']),
  text: z.string().trim().min(1, 'El boton necesita texto').max(25, 'Maximo 25 caracteres'),
  /** Solo URL. */
  url: z.string().trim().max(2000).optional(),
});
export type WaTemplateButton = z.infer<typeof waTemplateButtonSchema>;

/** Una plantilla tal como esta en la WABA. */
export const waTemplateDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  language: z.string(),
  category: z.string(),
  /** approved | pending | rejected | disabled | ... (minusculas). */
  status: z.string(),
  /** Por que la rechazo Meta, si la rechazo. */
  rejectedReason: z.string().nullable().default(null),
  /** Encabezado: `TEXT` con su texto, o `IMAGE`/`DOCUMENT`/`VIDEO` (el archivo
   *  se manda al enviar, no vive en la plantilla). */
  header: z.object({ format: z.string(), text: z.string() }).nullable().default(null),
  body: z.string(),
  footer: z.string().nullable().default(null),
  buttons: z.array(waTemplateButtonSchema).default([]),
  /** Cuantas variables {{n}} usa el cuerpo. */
  variables: z.number().int().min(0),
  /** Los valores de ejemplo con los que se aprobo. */
  examples: z.array(z.string()).default([]),
  createdAt: z.string().nullable().default(null),
  /** Id de la plantilla en Meta. Solo con la API nativa: es lo que haria falta
   *  para editarla (POST /{templateId}). Con 360dialog va null. */
  templateId: z.string().nullable().default(null),
  /** Mensajes automaticos que la nombran: borrarla los dejaria sin plantilla. */
  usedBy: z.array(waFlowKindSchema).default([]),
});
export type WaTemplateDetail = z.infer<typeof waTemplateDetailSchema>;

export const waTemplateListForLineSchema = z.object({
  lineId: z.string(),
  lineLabel: z.string(),
  templates: z.array(waTemplateDetailSchema),
  /** true = el proveedor no las devolvio y estas son las ULTIMAS que se le
   *  pudieron leer. Siguen sirviendo para enviar (eso solo necesita el
   *  nombre), pero su estado puede haber cambiado. */
  stale: z.boolean().default(false),
  /** Cuando se leyeron por ultima vez de verdad. */
  readAt: z.string().nullable().default(null),
});
export type WaTemplateListForLine = z.infer<typeof waTemplateListForLineSchema>;

/** Nombre de plantilla admitido por Meta: minusculas, numeros y guion bajo. */
export const WA_TEMPLATE_NAME_RE = /^[a-z0-9_]+$/;

/** Las variables tienen que ser {{1}}, {{2}}... correlativas desde 1. */
export function waTemplateVars(body: string): number[] {
  return [...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]));
}

/**
 * Crear una plantilla.
 *
 * No hay "editar", y el motivo NO es Meta: Meta si deja editar una plantilla
 * ya creada (POST /{templateId}). Quien no deja es 360dialog, que responde 405
 * a PATCH y a PUT (verificado contra su API). Como el negocio puede tener una
 * linea de cada proveedor, un boton de editar que solo funciona en una de las
 * dos seria peor que no tenerlo: aqui modificar es duplicar y borrar la vieja.
 * Editar ademas devuelve la plantilla a revision, o sea que tampoco es gratis.
 */
export const createWaTemplateSchema = z
  .object({
    lineId: z.string().min(6),
    name: z
      .string()
      .trim()
      .toLowerCase()
      .min(3, 'Minimo 3 caracteres')
      .max(60, 'Maximo 60 caracteres')
      .regex(WA_TEMPLATE_NAME_RE, 'Solo minusculas, numeros y guion bajo'),
    language: z.string().trim().min(2).max(10).default('es'),
    category: waTemplateCategorySchema.default('UTILITY'),
    /** Encabezado de texto (opcional). Los de archivo no se crean desde aqui. */
    header: z.string().trim().max(60).optional(),
    body: z.string().trim().min(1, 'El mensaje no puede estar vacio').max(1024),
    /** Un valor de ejemplo por variable. Meta los EXIGE para aprobar. */
    examples: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
    footer: z.string().trim().max(60).optional(),
    buttons: z.array(waTemplateButtonSchema).max(3).default([]),
  })
  .superRefine((v, ctx) => {
    const nums = waTemplateVars(v.body);
    const expected = nums.map((_, i) => i + 1);
    if (nums.join(',') !== expected.join(',')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['body'],
        message: 'Las variables tienen que ir en orden: {{1}}, {{2}}, {{3}}...',
      });
    }
    if (v.examples.length !== nums.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['examples'],
        message: `Faltan ejemplos: la plantilla usa ${nums.length} variable(s)`,
      });
    }
    // Meta rechaza mezclar respuestas rapidas con botones de enlace.
    const kinds = new Set(v.buttons.map((b) => b.type));
    if (kinds.size > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['buttons'],
        message: 'No se pueden mezclar respuestas rapidas con enlaces',
      });
    }
    v.buttons.forEach((b, i) => {
      if (b.type === 'URL' && !/^https?:\/\/.+/.test(b.url ?? '')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['buttons', i, 'url'],
          message: 'Pon el enlace completo (https://...)',
        });
      }
    });
  });
export type CreateWaTemplateInput = z.infer<typeof createWaTemplateSchema>;
