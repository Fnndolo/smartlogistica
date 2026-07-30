/**
 * Borradores de los paneles del pedido (Facturar / Guia), en memoria de la
 * pestana del navegador. Si el usuario edita items, direccion o paquete y
 * cierra el drawer (o navega a otra pagina), al volver encuentra TODO como lo
 * dejo. Se limpia al completar la operacion con exito.
 */
const drafts = new Map<string, unknown>();

export function getDraft<T>(key: string): T | undefined {
  return drafts.get(key) as T | undefined;
}

export function setDraft<T>(key: string, value: T): void {
  drafts.set(key, value);
}

export function clearDraft(key: string): void {
  drafts.delete(key);
}
