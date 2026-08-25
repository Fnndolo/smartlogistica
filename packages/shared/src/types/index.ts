/**
 * Roles del workspace, de mas a menos permisos:
 * OWNER/ADMIN = todo (configuracion, equipo, conexiones, transferencias).
 * GESTOR = todas las sedes y todo el trabajo de PEDIDOS (facturar, guias,
 * generales, tomar, chat), pero sin configuracion, equipo ni transferencias.
 * OPERATOR = solo las sedes que se le asignen (detalle + conversacion).
 */
export type TenantRole = 'OWNER' | 'ADMIN' | 'GESTOR' | 'OPERATOR';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  activeTenantId: string | null;
  activeTenantSlug: string | null;
  role: TenantRole | null;
}
