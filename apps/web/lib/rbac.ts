import type { TenantRole } from '@smartlogistica/shared';

/**
 * Permisos en el CLIENTE. Es el espejo exacto de apps/api/src/common/rbac.ts:
 * quien manda es el server (aqui solo decidimos que se muestra, para no
 * ofrecerle a nadie un boton que terminaria en 403).
 *
 * - OWNER / ADMIN = todo: configuracion (sedes, conexiones, plantillas,
 *   catalogos, tarifas), equipo y transferencias entre sedes.
 * - GESTOR = entra a TODAS las sedes y hace todo el trabajo de PEDIDOS
 *   (generales, tomar, chatear, subir fotos, facturar en Alegra, generar
 *   guias). NO gestiona equipo, NO entra a conexiones, NO transfiere pedidos
 *   entre sedes y NO toca configuracion.
 * - OPERATOR = solo las sedes que se le asignen: detalle + conversacion.
 *
 * Los predicados se llaman por INTENCION, no por rol: cada gate declara que
 * esta protegiendo. Si dudas al agregar uno nuevo, usa isAdmin() — es el
 * default seguro.
 */

/** El rol del usuario en el workspace activo (null mientras carga /auth/me). */
export type MaybeRole = TenantRole | null | undefined;

/**
 * ADMINISTRACION: configuracion del workspace, equipo y transferencias.
 * Un GESTOR NO pasa por aqui.
 */
export function isAdmin(role: MaybeRole): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

/** Ve TODAS las sedes y los pedidos generales (no solo las sedes asignadas). */
export function canSeeAllWarehouses(role: MaybeRole): boolean {
  return isAdmin(role) || role === 'GESTOR';
}

/**
 * TRABAJO DE PEDIDOS: generales, tomar/soltar, chat, fotos, facturar en Alegra,
 * generar guias y el ciclo de vida normal. El GESTOR si pasa.
 * NO incluye mover pedidos entre sedes (canTransferOrders) ni moderar mensajes
 * de otros ni nada de configuracion (isAdmin).
 */
export function canManageOrders(role: MaybeRole): boolean {
  return isAdmin(role) || role === 'GESTOR';
}

/**
 * TRANSFERIR pedidos: asignar un pedido sin asignar a una sede, moverlo entre
 * sedes o devolverlo a generales. Por instruccion del propietario esto lo hace
 * SOLO un admin. (Mismo resultado que isAdmin; existe aparte para que el gate
 * diga que protege.)
 */
export function canTransferOrders(role: MaybeRole): boolean {
  return isAdmin(role);
}

/**
 * Bandeja de WhatsApp, pestaña de WhatsApp del pedido y envio manual de la
 * confirmacion de direccion. El API lo restringe a administradores
 * (WhatsappService.assertAdmin): el GESTOR no entra.
 */
export function canUseWhatsapp(role: MaybeRole): boolean {
  return isAdmin(role);
}

/** Equipo: crear, editar o retirar miembros (MembersService.assertAdmin). */
export function canManageMembers(role: MaybeRole): boolean {
  return isAdmin(role);
}

/**
 * Conexiones del workspace (VTEX/Addi, IA, 360dialog, Skydropx) y los Ajustes
 * de cada sede (Alegra, Coordinadora, remitente Skydropx, certificado).
 */
export function canManageConnections(role: MaybeRole): boolean {
  return isAdmin(role);
}

/** Crear, renombrar y archivar sedes (WarehousesService: solo administradores). */
export function canManageWarehouses(role: MaybeRole): boolean {
  return isAdmin(role);
}

/** Borrar mensajes de OTRAS personas en la conversacion del pedido. */
export function canModerateChat(role: MaybeRole): boolean {
  return isAdmin(role);
}

export const ROLE_LABEL: Record<TenantRole, string> = {
  OWNER: 'Propietario',
  ADMIN: 'Admin',
  GESTOR: 'Gestor',
  OPERATOR: 'Operador',
};

export const ROLE_HELP: Record<TenantRole, string> = {
  OWNER: 'Ve y gestiona todo. Es el dueño del workspace (el primer usuario).',
  ADMIN: 'Ve y gestiona todo: sedes, conexiones, equipo y facturación.',
  GESTOR:
    'Trabaja los pedidos de todas las sedes: factura y genera guías. No gestiona equipo ni conexiones, y no transfiere pedidos entre sedes.',
  OPERATOR: 'Solo ve las sedes que le asignes: detalle y conversación de sus pedidos.',
};

/** Etiqueta del rol para la ficha del usuario ("Sin rol" si todavia no tiene). */
export function roleLabel(role: MaybeRole): string {
  return role ? ROLE_LABEL[role] : 'Sin rol';
}
