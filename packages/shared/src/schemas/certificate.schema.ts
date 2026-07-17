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
  }),
]);
export type CertificateElement = z.infer<typeof certificateElementSchema>;

export const certificateTemplateSchema = z.object({
  page: z.number().int().min(0).default(0), // pagina sobre la que se dibuja
  elements: z.array(certificateElementSchema).max(200).default([]),
});
export type CertificateTemplate = z.infer<typeof certificateTemplateSchema>;
