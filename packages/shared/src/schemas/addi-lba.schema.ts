import { z } from 'zod';

/**
 * GUIAS DE ADDI (Addi Logistics, "LBA"). Los pedidos de VTEX vienen del
 * marketplace de Addi y es ADDI quien genera su guia de Coordinadora, siempre
 * con UN solo remitente. La plataforma:
 *   1. trae el numero de guia de cada pedido desde el portal de aliados de
 *      Addi (se cruza por el MKT), y
 *   2. al pasar el pedido a una sede, edita la guia en la suite de
 *      Coordinadora (la cuenta de Addi) con el remitente de esa sede y deja el
 *      rotulo en la conversacion del pedido.
 *
 * Son dos cuentas distintas (portal de Addi y suite de Coordinadora) y las dos
 * se guardan cifradas. Las contraseñas nunca vuelven al navegador.
 */
export const addiLbaConnectionInputSchema = z.object({
  portalEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email('Correo del portal de Addi no válido')
    .max(200),
  /** Vacio al editar = conservar la guardada. */
  portalPassword: z.string().max(200).optional(),
  suiteEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email('Correo de la suite de Coordinadora no válido')
    .max(200),
  suitePassword: z.string().max(200).optional(),
  /** Editar remitente + rotulo al chat al pasar un pedido a una sede. */
  autoSender: z.boolean(),
});
export type AddiLbaConnectionInput = z.infer<typeof addiLbaConnectionInputSchema>;

export const addiLbaConnectionSummarySchema = z.object({
  portalEmail: z.string(),
  suiteEmail: z.string(),
  autoSender: z.boolean(),
  status: z.enum(['connected', 'error']),
  lastError: z.string().nullable(),
  lastSyncAt: z.string().datetime().nullable(),
  /** Guias de Addi que cruzaron con pedidos en la ultima sincronizacion. */
  lastSyncCount: z.number().int().nullable(),
  updatedAt: z.string().datetime(),
});
export type AddiLbaConnectionSummary = z.infer<typeof addiLbaConnectionSummarySchema>;

/** Resultado de "Sincronizar ahora". */
export const addiLbaSyncResultSchema = z.object({
  shipments: z.number().int(),
  matched: z.number().int(),
  updated: z.number().int(),
});
export type AddiLbaSyncResult = z.infer<typeof addiLbaSyncResultSchema>;

/** Estados del paquete en el portal de Addi (texto libre: Addi puede sumar mas). */
export const ADDI_PACKAGE_STATUS_LABEL: Record<string, string> = {
  PENDING_RECOLLECTION: 'Pendiente de recolección',
  TRANSPORT: 'En transporte',
  TRANSPORT_WITH_NOVELTY: 'Con novedad',
  DELIVERED: 'Entregado',
};

/** Solo una guia que aun no recoge la transportadora admite cambio de remitente. */
export const ADDI_EDITABLE_STATUS = 'PENDING_RECOLLECTION';

/** Remitente de la guia de Addi segun la plataforma. */
export const addiSenderStateSchema = z.enum([
  /** Ya lleva el remitente de la sede `warehouseName`. */
  'applied',
  /** Se aplicara solo (esperando la guia de Addi o en cola). */
  'pending',
  /** Fallo el ultimo intento: `error` dice por que. */
  'error',
  /** No se ha pedido (pedido sin sede o de antes de la automatizacion). */
  'none',
]);
export type AddiSenderState = z.infer<typeof addiSenderStateSchema>;

export const addiGuideInfoSchema = z.object({
  /** Hay conexion configurada (si no, el panel invita a configurarla). */
  connected: z.boolean(),
  guide: z.string().nullable(),
  carrier: z.string().nullable(),
  packageStatus: z.string().nullable(),
  dispatchDeadline: z.string().datetime().nullable(),
  syncedAt: z.string().datetime().nullable(),
  sender: z.object({
    state: addiSenderStateSchema,
    warehouseName: z.string().nullable(),
    at: z.string().datetime().nullable(),
    error: z.string().nullable(),
  }),
  /** El usuario puede pedir (re)aplicar el remitente de la sede actual. */
  canApply: z.boolean(),
});
export type AddiGuideInfo = z.infer<typeof addiGuideInfoSchema>;
