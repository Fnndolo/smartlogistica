import type { Prisma, PrismaClient } from '.prisma/tenant-client';

import type { WaTemplateRaw } from './wa-client.port';

/** Una clave por linea: cada numero tiene su propia WABA. */
const keyFor = (lineId: string): string => `wa:templates:${lineId}`;

/**
 * LA ULTIMA LISTA BUENA de plantillas de cada linea.
 *
 * Existe porque leer las plantillas y enviarlas son permisos DISTINTOS en
 * Meta, y el proveedor puede perder el primero conservando el segundo: los
 * mensajes automaticos siguen saliendo — solo necesitan el nombre — mientras
 * el listado devuelve vacio. Sin esto, el selector de "/" se queda en blanco y
 * el equipo no puede mandar una plantilla a mano aunque todas funcionen.
 *
 * Se guarda en AppSetting a proposito: es un cache, no un dato del negocio, y
 * no merece ni una columna ni una migracion.
 */
export async function rememberTemplates(
  prisma: PrismaClient,
  lineId: string,
  list: WaTemplateRaw[],
): Promise<void> {
  // Solo se recuerda lo que vale la pena: una lista vacia es justo el sintoma
  // del que queremos protegernos, no algo que valga guardar.
  if (list.length === 0) return;
  const value = { at: new Date().toISOString(), list } as unknown as Prisma.InputJsonValue;
  await prisma.appSetting
    .upsert({ where: { key: keyFor(lineId) }, create: { key: keyFor(lineId), value }, update: { value } })
    .catch(() => null);
}

/** Lo ultimo que se pudo leer de esa linea, o null si nunca se leyo nada. */
export async function recallTemplates(
  prisma: PrismaClient,
  lineId: string,
): Promise<{ at: string; list: WaTemplateRaw[] } | null> {
  const row = await prisma.appSetting
    .findUnique({ where: { key: keyFor(lineId) } })
    .catch(() => null);
  const value = row?.value as { at?: unknown; list?: unknown } | null;
  if (!value || !Array.isArray(value.list) || value.list.length === 0) return null;
  return {
    at: typeof value.at === 'string' ? value.at : '',
    list: value.list as WaTemplateRaw[],
  };
}
