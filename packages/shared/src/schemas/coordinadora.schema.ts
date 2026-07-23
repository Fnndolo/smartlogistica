import { z } from 'zod';

import { createInvoiceSchema, invoiceResultSchema } from './invoice.schema';

/**
 * Integracion con Coordinadora (transportadora) para generar guias + rotulo.
 * Conexion 1:1 por sede: cada sede tiene su cuenta y su ORIGEN (remitente).
 * Auth = usuario + SHA256(password). El password se guarda cifrado (envelope).
 */

/**
 * Formatos de rotulo (id_rotulo de Coordinadora) validados contra el sandbox.
 * El 55 (10x10) es el preferido. Los "clasicos" son el estilo plano (mas simple).
 */
export const coordinadoraRotuloOptions = [
  { id: 55, label: 'Termico 10×10 cm (impresora termica)' },
  { id: 59, label: 'Cuarto de pagina (impresora normal)' },
] as const;
export const DEFAULT_ROTULO_ID = 55;

// === Conexion (credenciales + origen de la sede) ===

/** Solo credenciales — para "Probar conexion" (valida contra Coordinadora). */
export const coordinadoraCredentialsSchema = z.object({
  idCliente: z.coerce.number().int().positive('Id de cliente invalido'),
  usuario: z.string().trim().min(3, 'Usuario muy corto').max(120),
  password: z.string().trim().min(3, 'Contrasena muy corta').max(200),
  nit: z.string().trim().min(3).max(30),
  div: z.string().trim().min(1).max(10).default('01'),
});
export type CoordinadoraCredentialsInput = z.infer<typeof coordinadoraCredentialsSchema>;

/**
 * Guardar conexion = credenciales + ORIGEN (remitente) de la sede.
 * `password` es opcional: si ya existe la conexion y se omite, se conserva el
 * guardado (para editar el origen sin re-teclear la contrasena).
 */
export const coordinadoraConnectSchema = z.object({
  idCliente: z.coerce.number().int().positive('Id de cliente invalido'),
  usuario: z.string().trim().min(3, 'Usuario muy corto').max(120),
  password: z.string().trim().min(3, 'Contrasena muy corta').max(200).optional(),
  nit: z.string().trim().min(3).max(30),
  div: z.string().trim().min(1).max(10).default('01'),
  // Origen / remitente de esta sede.
  senderName: z.string().trim().min(2, 'Nombre del remitente requerido').max(120),
  senderNit: z.string().trim().max(30).nullable().optional(),
  senderPhone: z.string().trim().min(5, 'Telefono requerido').max(30),
  senderAddress: z.string().trim().min(3, 'Direccion requerida').max(200),
  senderCityCode: z.string().trim().min(4, 'Ciudad de origen requerida').max(12),
  senderCityName: z.string().trim().max(120).nullable().optional(),
  rotuloId: z.coerce.number().int().min(1).max(999).default(DEFAULT_ROTULO_ID),
});
export type CoordinadoraConnectInput = z.infer<typeof coordinadoraConnectSchema>;

/** Resumen seguro de la conexion — NUNCA incluye el password. */
export const coordinadoraConnectionSummarySchema = z.object({
  warehouseId: z.string(),
  idCliente: z.number().int(),
  usuario: z.string(),
  nit: z.string(),
  div: z.string(),
  senderName: z.string(),
  senderNit: z.string().nullable(),
  senderPhone: z.string(),
  senderAddress: z.string(),
  senderCityCode: z.string(),
  senderCityName: z.string().nullable(),
  rotuloId: z.number().int(),
  status: z.enum(['connected', 'error']),
  lastError: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type CoordinadoraConnectionSummary = z.infer<typeof coordinadoraConnectionSummarySchema>;

/** Resultado de "Probar conexion" (no persiste nada). */
export const coordinadoraTestResultSchema = z.object({
  ok: z.literal(true),
  cities: z.number().int(), // nº de ciudades devueltas = credenciales validas
});
export type CoordinadoraTestResult = z.infer<typeof coordinadoraTestResultSchema>;

// === Ciudades (codigo DANE) ===

export const coordinadoraCitySchema = z.object({
  code: z.string(), // codigo DANE 8 digitos
  name: z.string(),
  department: z.string(),
});
export type CoordinadoraCity = z.infer<typeof coordinadoraCitySchema>;

/**
 * Busqueda de ciudades para el selector de ORIGEN en el form de conexion. Puede
 * llevar credenciales inline (antes de guardar la conexion) o, si se omiten, usa
 * las ya guardadas de la sede.
 */
export const coordinadoraCitySearchSchema = z.object({
  query: z.string().trim().max(80).default(''),
  idCliente: z.coerce.number().int().positive().optional(),
  usuario: z.string().trim().max(120).optional(),
  password: z.string().trim().max(200).optional(),
  nit: z.string().trim().max(30).optional(),
  div: z.string().trim().max(10).optional(),
});
export type CoordinadoraCitySearchInput = z.infer<typeof coordinadoraCitySearchSchema>;

// === Guia (generar) ===

/**
 * Paquete predefinido de la sede (equivalente a los "empaques" del portal web
 * de Coordinadora, que su API no expone): nombre + medidas + peso. Se elige en
 * la pestana Guia para llenar las dimensiones de un clic.
 */
export const packagePresetSchema = z.object({
  name: z.string().trim().min(1, 'Nombre requerido').max(60),
  weight: z.number().positive('Peso invalido'), // kg
  height: z.number().positive(), // cm
  width: z.number().positive(),
  length: z.number().positive(),
});
export type PackagePreset = z.infer<typeof packagePresetSchema>;

/** Reemplaza la lista completa de paquetes de la sede. */
export const savePackagePresetsSchema = z.array(packagePresetSchema).max(30);

/** Datos del paquete (VTEX no los trae; defaults editables antes de generar). */
export const guidePackageSchema = z.object({
  weight: z.number().positive('Peso invalido'), // kg
  height: z.number().positive(), // cm
  width: z.number().positive(),
  length: z.number().positive(),
  units: z.number().int().min(1).max(50),
  content: z.string().trim().min(1, 'Contenido requerido').max(120),
  declaredValue: z.number().nonnegative(),
  // Observaciones de la guia: lo que se escriba aqui es lo que aparece en
  // Coordinadora. Vacio = la guia sale sin observaciones (como en su portal).
  observations: z.string().trim().max(300).optional(),
});
export type GuidePackage = z.infer<typeof guidePackageSchema>;

/** Una guia ya emitida para el pedido (bloquea volver a generar). */
export const guideSchema = z.object({
  id: z.string(), // id_remision
  number: z.string(), // codigo_remision (Nº de guia)
  url: z.string().nullable(), // url de rastreo (url_terceros)
  createdAt: z.string(),
});
export type Guide = z.infer<typeof guideSchema>;

/** Preview: destinatario (de VTEX, editable) + remitente (de la sede) + paquete. */
export const guidePreviewSchema = z.object({
  recipient: z.object({
    name: z.string(),
    document: z.string().nullable(),
    address: z.string(),
    cityCode: z.string().nullable(), // resuelto desde la ciudad de VTEX (editable)
    cityName: z.string().nullable(),
    phone: z.string().nullable(),
  }),
  sender: z.object({
    name: z.string(),
    address: z.string(),
    cityCode: z.string(),
    cityName: z.string().nullable(),
    phone: z.string(),
  }),
  package: guidePackageSchema,
  rotuloId: z.number().int(), // formato de rotulo por defecto de la sede
  // Paquetes predefinidos de la sede (para llenar dimensiones de un clic).
  packagePresets: z.array(packagePresetSchema),
  guide: guideSchema.nullable(), // si ya se genero
});
export type GuidePreview = z.infer<typeof guidePreviewSchema>;

// === Seguimiento (rastreo Coordinadora) ===

/** Un movimiento del envio (estado o novedad) con su fecha/hora. */
export const trackingEventSchema = z.object({
  codigo: z.number().int(),
  descripcion: z.string(),
  fecha: z.string(),
  hora: z.string(),
});
export type TrackingEvent = z.infer<typeof trackingEventSchema>;

/** Seguimiento detallado de una guia (rastreoExtendido de Coordinadora). */
export const guideTrackingSchema = z.object({
  guideNumber: z.string(),
  codigoEstado: z.number().int(),
  descripcionEstado: z.string(),
  fechaRecogida: z.string(),
  fechaEntrega: z.string(),
  horaEntrega: z.string(),
  nombreOrigen: z.string(),
  nombreDestino: z.string(),
  trackingUrl: z.string(),
  estados: z.array(trackingEventSchema), // historial (mas reciente primero o ultimo, segun API)
  novedades: z.array(trackingEventSchema), // incidencias
});
export type GuideTracking = z.infer<typeof guideTrackingSchema>;

/** Datos verificados/corregidos por el usuario para generar la guia. */
export const createGuideSchema = z.object({
  recipient: z.object({
    name: z.string().trim().min(2, 'Nombre requerido').max(120),
    document: z.string().trim().min(3, 'Documento requerido').max(30),
    address: z.string().trim().min(3, 'Direccion requerida').max(200),
    cityCode: z.string().trim().min(4, 'Ciudad de destino requerida').max(12),
    phone: z.string().trim().min(5, 'Telefono requerido').max(30),
  }),
  package: guidePackageSchema,
  rotuloId: z.coerce.number().int().min(1).max(999).optional(),
});
export type CreateGuideInput = z.infer<typeof createGuideSchema>;

/**
 * Flujo completo en un solo paso: factura de Alegra + guia de Coordinadora
 * (que a su vez cierra el pedido en VTEX y genera el MKT). Es una ALTERNATIVA
 * al flujo por pasos, que se mantiene igual.
 */
export const processAllSchema = z.object({
  invoice: createInvoiceSchema,
  guide: createGuideSchema,
});
export type ProcessAllInput = z.infer<typeof processAllSchema>;

export const processAllResultSchema = z.object({
  invoice: invoiceResultSchema,
  guide: guideSchema,
});
export type ProcessAllResult = z.infer<typeof processAllResultSchema>;
