import { z } from 'zod';

/**
 * SKYDROPX: agregador multi-transportadora (segunda opcion de guia; la
 * predeterminada sigue siendo Coordinadora). Cotiza TODAS las transportadoras
 * y crea la guia sobre la tarifa elegida.
 */

export const skydropxModeSchema = z.enum(['sandbox', 'production']);
export type SkydropxMode = z.infer<typeof skydropxModeSchema>;

export const skydropxCredentialsSchema = z.object({
  apiKey: z.string().trim().min(10, 'API key muy corta').max(200),
  apiSecret: z.string().trim().min(10, 'API secret muy corto').max(200),
  mode: skydropxModeSchema.default('sandbox'),
});
export type SkydropxCredentialsInput = z.infer<typeof skydropxCredentialsSchema>;

export const skydropxConnectionSummarySchema = z.object({
  mode: skydropxModeSchema,
  status: z.enum(['connected', 'error']),
  lastError: z.string().nullable(),
  createdAt: z.string(),
});
export type SkydropxConnectionSummary = z.infer<typeof skydropxConnectionSummarySchema>;

/** Una tarifa cotizada (solo las DISPONIBLES llegan al panel). */
export const skydropxRateSchema = z.object({
  id: z.string(),
  /** Nombre visible de la transportadora (Coordinadora, Servientrega...). */
  carrier: z.string(),
  /** Slug interno (coordinadora, servientrega, interrapidisimo, envia...). */
  carrierCode: z.string(),
  /** Nombre del servicio (Standard, Mensajeria Express...). */
  service: z.string().nullable(),
  /** Total a pagar (COP). */
  total: z.number(),
  currency: z.string().nullable(),
  /** Dias habiles estimados. */
  days: z.number().int().nullable(),
  /** Recoleccion disponible / entrega en oficina. */
  pickup: z.boolean().default(false),
  officeDelivery: z.boolean().default(false),
});
export type SkydropxRate = z.infer<typeof skydropxRateSchema>;

export const skydropxQuoteResponseSchema = z.object({
  quotationId: z.string(),
  /** CP y ciudad de destino RESUELTOS (del pedido o del override del panel). */
  postalCodeTo: z.string(),
  cityTo: z.string().default(''),
  rates: z.array(skydropxRateSchema),
});
export type SkydropxQuoteResponse = z.infer<typeof skydropxQuoteResponseSchema>;

/** Cotizar desde el panel de guia (dims/valor editables, CP corregible). */
export const skydropxQuoteInputSchema = z.object({
  package: z.object({
    weight: z.coerce.number().positive().max(999),
    length: z.coerce.number().positive().max(500),
    width: z.coerce.number().positive().max(500),
    height: z.coerce.number().positive().max(500),
    declaredValue: z.coerce.number().min(10_000).max(10_000_000),
  }),
  /** Override del CP destino (si el pedido no trae o esta malo). */
  postalCodeTo: z.string().trim().min(4).max(10).optional(),
  /** Override de ciudad/departamento destino (catalogo de Coordinadora como
   *  respaldo: Skydropx no expone catalogo propio de ciudades). */
  cityTo: z.string().trim().max(120).optional(),
  departmentTo: z.string().trim().max(120).optional(),
});
export type SkydropxQuoteInput = z.infer<typeof skydropxQuoteInputSchema>;

/** Direccion de ORIGEN guardada en el panel de Skydropx (las verificadas
 *  permiten paqueterias que exigen origen verificado, ej. Inter). */
export const skydropxAddressTemplateSchema = z.object({
  id: z.string(),
  alias: z.string(),
  name: z.string().nullable(),
  city: z.string().nullable(),
  postalCode: z.string().nullable(),
  /** 'from' | 'to' (solo las from sirven de remitente). */
  addressType: z.string(),
  /** Paqueterias con esta direccion VERIFICADA (slugs). */
  verifiedCarriers: z.array(z.string()).default([]),
});
export type SkydropxAddressTemplate = z.infer<typeof skydropxAddressTemplateSchema>;

/** Tipo de embalaje del catalogo de Skydropx (codigo ONU + nombre). */
export const skydropxPackagingSchema = z.object({ code: z.string(), name: z.string() });
export type SkydropxPackaging = z.infer<typeof skydropxPackagingSchema>;

/** Remitente Skydropx FIJADO en una sede (null = sin fijar). */
export const skydropxSedeConfigSchema = z.object({
  warehouseId: z.string(),
  addressTemplateId: z.string(),
  alias: z.string().nullable(),
  city: z.string().nullable(),
  postalCode: z.string().nullable(),
});
export type SkydropxSedeConfig = z.infer<typeof skydropxSedeConfigSchema>;

export const setSkydropxSedeConfigSchema = z.object({
  addressTemplateId: z.string().min(6),
});
export type SetSkydropxSedeConfigInput = z.infer<typeof setSkydropxSedeConfigSchema>;

/** Generar la guia con la tarifa elegida. */
export const createSkydropxGuideSchema = z.object({
  rateId: z.string().min(6),
  /** Cotizacion de la que salio la tarifa (la doc de Skydropx lo exige). */
  quotationId: z.string().optional(),
  /** La transportadora elegida (para el registro; el server re-verifica). */
  carrier: z.string().min(2).max(60),
  /** Slug interno de la transportadora (carrier_name del envio). */
  carrierCode: z.string().max(60).optional(),
  package: skydropxQuoteInputSchema.shape.package,
  /** Puede ir vacio si hay ciudad (Skydropx acepta ciudad+depto sin CP). */
  postalCodeTo: z.string().trim().max(10).default(''),
  cityTo: z.string().trim().max(120).optional(),
  departmentTo: z.string().trim().max(120).optional(),
  recipient: z.object({
    name: z.string().trim().min(2).max(120),
    address: z.string().trim().min(3).max(200),
    phone: z.string().trim().min(5).max(30),
    email: z.string().trim().email().optional(),
  }),
  packageContent: z.string().trim().min(2).max(60).default('CELULAR'),
  /** Tipo de embalaje del catalogo de Skydropx (codigo, ej. '4G' caja). */
  packagingCode: z.string().trim().max(10).optional(),
});
export type CreateSkydropxGuideInput = z.infer<typeof createSkydropxGuideSchema>;
