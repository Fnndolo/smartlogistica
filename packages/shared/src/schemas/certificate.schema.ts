import { z } from 'zod';

/**
 * Plantilla del Certificado de Garantia por sede. Es un OVERLAY que se aplica
 * sobre la factura de Alegra con pdf-lib: cajas que TAPAN zonas (QR, titulo
 * "Factura de venta", texto legal) + TEXTOS encima (titulo "Certificado de
 * Garantia", terminos, datos de pago). Se edita visualmente (fase 2).
 *
 * Coordenadas en PUNTOS del PDF, origen (0,0) = esquina INFERIOR-IZQUIERDA
 * (igual que pdf-lib). Los textos pueden llevar placeholders que se rellenan
 * con los datos de la factura: {moneda} {fecha} {formaPago} {medioPago}
 * {cliente} {numeroFactura}.
 */
export const certificateElementSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('cover'),
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
    color: z.string().default('#ffffff'), // relleno (hex). Ej. gris del header.
  }),
  z.object({
    type: z.literal('text'),
    x: z.number(),
    y: z.number(),
    text: z.string().max(2000),
    size: z.number().positive().max(72).default(9),
    bold: z.boolean().default(false),
    color: z.string().default('#000000'),
    /** Ancho util en puntos. Si el texto no cabe, la letra se encoge hasta que
     *  quepa en vez de invadir lo que hay al lado. Vacio = sin limite (como
     *  siempre): las plantillas que ya existen no cambian. */
    maxWidth: z.number().positive().optional(),
  }),
]);
export type CertificateElement = z.infer<typeof certificateElementSchema>;

export const certificateTemplateSchema = z.object({
  page: z.number().int().min(0).default(0), // pagina sobre la que se dibuja
  elements: z.array(certificateElementSchema).max(200).default([]),
});
export type CertificateTemplate = z.infer<typeof certificateTemplateSchema>;

/**
 * Que documento se le adjunta al comprador cuando se factura en esta sede.
 *
 *   template — la factura de Alegra se transforma con la plantilla de arriba.
 *              Si la sede no tiene plantilla, va la factura cruda (lo de siempre).
 *   off      — no se adjunta NADA al chat. La factura igual queda en Alegra.
 *   external — el certificado lo emite un servicio externo por API y se adjunta
 *              SOLO ese PDF; la factura de Alegra no se le manda al comprador.
 *
 * Por defecto 'template': las sedes que ya existen no cambian de comportamiento.
 */
export const certificateModeSchema = z.enum(['template', 'off', 'external']);
export type CertificateMode = z.infer<typeof certificateModeSchema>;

/**
 * Conexion con el emisor externo de certificados (hoy, la API de Eleven Store).
 *
 * El medio de pago es FIJO por sede a proposito: el emisor externo lo recibe
 * como texto libre y agrega a su catalogo cualquier valor nuevo, asi que mandar
 * el de Alegra ("Efectivo", "Transferencia"...) le ensuciaria el desplegable.
 */
export const externalCertificateConfigSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .url('URL invalida')
    .max(300)
    // Sin barra final: las rutas se concatenan como `${baseUrl}/api/v1/...`.
    .transform((u) => u.replace(/\/+$/, '')),
  paymentMethod: z.string().trim().min(1, 'Elige el medio de pago').max(100),
});
export type ExternalCertificateConfig = z.infer<typeof externalCertificateConfigSchema>;

/** Lo que se envia al guardar. La clave solo viaja cuando se cambia. */
export const externalCertificateSaveSchema = externalCertificateConfigSchema.extend({
  apiKey: z.string().trim().min(1).max(300).optional(),
});
export type ExternalCertificateSave = z.infer<typeof externalCertificateSaveSchema>;

/** Lo que se devuelve al leer. La clave NUNCA sale: solo si esta puesta. */
export const externalCertificateSummarySchema = externalCertificateConfigSchema.extend({
  hasApiKey: z.boolean(),
  status: z.enum(['connected', 'error']),
  lastError: z.string().nullable(),
});
export type ExternalCertificateSummary = z.infer<typeof externalCertificateSummarySchema>;
