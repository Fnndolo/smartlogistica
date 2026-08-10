import { z } from 'zod';

/**
 * Catalogo de PLATAFORMAS (de donde viene cada pedido): VTEX para el espejo del
 * marketplace y las demas para los pedidos MONTADOS a mano (Krediya, Mercado
 * Libre...). Global del workspace (AppSetting), administrable en Ajustes: se
 * pueden crear mas y elegir el color del badge de cada una.
 */

/** Colores disponibles para el badge de una plataforma (paleta curada). */
export const badgeColorSchema = z.enum([
  'rose',
  'red',
  'yellow',
  'amber',
  'orange',
  'emerald',
  'lime',
  'sky',
  'blue',
  'cyan',
  'violet',
  'fuchsia',
  'slate',
]);
export type BadgeColor = z.infer<typeof badgeColorSchema>;

export const platformSchema = z.object({
  /** Slug estable (no cambia aunque renombren la plataforma). */
  id: z.string().min(1).max(40),
  name: z.string().trim().min(2, 'Nombre muy corto').max(40),
  color: badgeColorSchema,
});
export type Platform = z.infer<typeof platformSchema>;

/** Reemplaza el catalogo completo (Ajustes). VTEX no puede faltar. */
export const savePlatformsSchema = z
  .array(platformSchema)
  .min(1, 'Debe existir al menos una plataforma')
  .max(30);

/**
 * Catalogo por defecto (si nunca se ha editado): VTEX rosado rojizo, Krediya
 * rojo y Mercado Libre amarillo — los que pidio el negocio.
 */
export const DEFAULT_PLATFORMS: Platform[] = [
  { id: 'vtex', name: 'VTEX', color: 'rose' },
  { id: 'krediya', name: 'Krediya', color: 'red' },
  { id: 'mercadolibre', name: 'Mercado Libre', color: 'yellow' },
];
