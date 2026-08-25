import type { AuthContext } from './types/authenticated-request';

/**
 * Permisos de SmartLogistica. Cuatro roles, de mas a menos:
 *
 * - OWNER   = el propietario (el primer usuario) y
 * - ADMIN   = administrador: ambos ven y gestionan TODO (pedidos generales,
 *             sedes, conexiones, equipo, transferencias, facturar, guias).
 * - GESTOR  = entra a TODAS las sedes y hace todo el trabajo de PEDIDOS (ver
 *             generales, tomar, chatear, subir fotos, facturar en Alegra,
 *             generar guias, montar pedidos). NO gestiona equipo, NO entra a
 *             conexiones y NO transfiere pedidos entre sedes ni toca ninguna
 *             configuracion (sedes, plantillas, plataformas, tarifas, IA).
 * - OPERATOR= usuario de sede: solo ve sus sedes y la conversacion/detalle de
 *             los pedidos (sube fotos, chatea).
 *
 * Los predicados van nombrados por INTENCION, no por rol: cada gate declara que
 * esta protegiendo de verdad. Regla de oro al agregar un gate nuevo: si dudas,
 * usa isAdmin() — es el default seguro.
 */

/**
 * ADMINISTRACION: configuracion del workspace (sedes, conexiones, plantillas,
 * catalogos, tarifas), gestion del equipo y transferencia de pedidos.
 * Un GESTOR NO pasa por aqui.
 */
export function isAdmin(auth: AuthContext): boolean {
  return auth.role === 'OWNER' || auth.role === 'ADMIN';
}

/**
 * Ve TODAS las sedes sin necesidad de filas en WarehouseMember. El GESTOR si
 * pasa: "tendra acceso a todas las sedes normal". Es la llave de
 * WarehousesService.accessibleWarehouseIds() -> null = todas.
 */
export function canSeeAllWarehouses(auth: AuthContext): boolean {
  return isAdmin(auth) || auth.role === 'GESTOR';
}

/**
 * TRABAJO DE PEDIDOS: pedidos generales (sin asignar), tomar/soltar el propio,
 * chat, fotos, facturar en Alegra, generar guias (Coordinadora/Skydropx) y el
 * ciclo de vida normal. El GESTOR si pasa.
 *
 * OJO: esto NO incluye mover pedidos entre sedes (canTransferOrders), ni
 * moderar contenido de otros, ni nada de configuracion (isAdmin).
 */
export function canManageOrders(auth: AuthContext): boolean {
  return isAdmin(auth) || auth.role === 'GESTOR';
}

/**
 * TRANSFERIR pedidos: asignar un pedido sin asignar a una sede, moverlo entre
 * sedes o devolverlo a generales. Por instruccion expresa del propietario, la
 * transferencia SOLO la hace un admin — el GESTOR no pasa.
 * (Mismo resultado que isAdmin; existe aparte para que el gate diga que protege.)
 */
export function canTransferOrders(auth: AuthContext): boolean {
  return isAdmin(auth);
}
