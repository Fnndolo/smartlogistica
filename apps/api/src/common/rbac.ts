import type { AuthContext } from './types/authenticated-request';

/**
 * Permisos de SmartLogistica. Hoy el rol OWNER = administrador (ve todo, asigna,
 * transfiere, gestiona sedes). OPERATOR = usuario de sede (scope a sus sedes).
 * Cuando se construya el flujo de invitaciones se anadira un rol ADMIN explicito
 * y, si se quiere, permisos mas finos por accion.
 */
export function isAdmin(auth: AuthContext): boolean {
  return auth.role === 'OWNER';
}
