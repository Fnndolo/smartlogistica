import { z } from 'zod';

/**
 * ENTREGA A DOMICILIO (transportadora propia).
 *
 * Es la tercera opcion del panel de guia, al lado de Coordinadora y Skydropx,
 * pero NO es una transportadora mas: es un envio SIN GUIA. No hay numero de
 * rastreo, no hay url de seguimiento y no hay rotulo. El unico documento es el
 * SOPORTE DE ENTREGA: se imprime, va con el mensajero y lo firma el cliente al
 * recibir (por eso el bloque "quien recibe" del PDF sale en blanco).
 *
 * En VTEX el pedido se cierra igual (start-handling + invoice), pero la factura
 * se reporta con `courier` de domicilio y SIN tracking — ver DELIVERY_COURIER.
 */

/** Lo que se reporta a VTEX en `courier` cuando el envio va por domicilio. */
export const DELIVERY_COURIER = 'Domicilio propio';

/** Prefijo del Nº de soporte: DOM-<numero de factura de Alegra>. */
export const DELIVERY_SUPPORT_PREFIX = 'DOM-';

/** Una linea del soporte: cantidad + producto ("2 x IPHONE 15 128GB"). */
export const deliveryItemSchema = z.object({
  name: z.string().trim().min(1, 'Producto requerido').max(160),
  quantity: z.number().int().min(1).max(99),
});
export type DeliveryItem = z.infer<typeof deliveryItemSchema>;

/**
 * Datos verificados por quien despacha para emitir el SOPORTE DE ENTREGA.
 * Espeja la parte de cliente de `createGuideSchema` y BORRA todo lo que solo
 * existe porque hay una transportadora: paquete, dimensiones, peso, ciudad
 * DANE, codigo postal, formato de rotulo y recaudo contraentrega.
 */
export const createDeliverySupportSchema = z.object({
  recipient: z.object({
    name: z.string().trim().min(2, 'Nombre requerido').max(120),
    document: z.string().trim().min(3, 'Documento requerido').max(30),
    address: z.string().trim().min(3, 'Dirección requerida').max(200),
    phone: z.string().trim().min(5, 'Teléfono requerido').max(30),
  }),
  /** Productos entregados. Arranca con los del pedido y es editable. */
  items: z.array(deliveryItemSchema).min(1, 'Agrega al menos un producto').max(30),
  /** Fecha impresa en el soporte (YYYY-MM-DD). Ausente = hoy en Bogotá. */
  deliveryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida')
    .optional(),
});
export type CreateDeliverySupportInput = z.infer<typeof createDeliverySupportSchema>;
