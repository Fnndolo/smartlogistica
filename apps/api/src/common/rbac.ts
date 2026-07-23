import type { AuthContext } from './types/authenticated-request';

/**
 * Permisos de SmartLogistica. OWNER = el propietario (el primer usuario) y
 * ADMIN = administrador: ambos ven y gestionan todo (pedidos generales, sedes,
 * conexiones, equipo, facturar, guias). OPERATOR = usuario de sede: solo ve sus
 * sedes y la conversacion/detalle de los pedidos (sube fotos, chatea).
 */
export function isAdmin(auth: AuthContext): boolean {
  return auth.role === 'OWNER' || auth.role === 'ADMIN';
}
