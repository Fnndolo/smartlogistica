import { z } from 'zod';
import { DEFAULT_PLATFORMS, platformSchema, type Platform } from '@smartlogistica/shared';
import type { Prisma } from '.prisma/tenant-client';

import { getTenantContext } from '../../infrastructure/tenant-context';

/**
 * Catalogo de PLATAFORMAS del workspace (AppSetting key 'platforms'). Si nunca
 * se ha editado, aplican los defaults (VTEX rosado, Krediya rojo, Mercado Libre
 * amarillo). Mismo patron que los paquetes de guia globales.
 */
export async function loadPlatforms(): Promise<Platform[]> {
  const { prisma } = getTenantContext();
  const row = await prisma.appSetting.findUnique({ where: { key: 'platforms' } });
  if (!row) return DEFAULT_PLATFORMS;
  const parsed = z.array(platformSchema).safeParse(row.value);
  return parsed.success && parsed.data.length > 0 ? parsed.data : DEFAULT_PLATFORMS;
}

/** Reemplaza el catalogo completo. El caller ya valido permisos y contenido. */
export async function storePlatforms(platforms: Platform[]): Promise<Platform[]> {
  const { prisma } = getTenantContext();
  await prisma.appSetting.upsert({
    where: { key: 'platforms' },
    create: { key: 'platforms', value: platforms as unknown as Prisma.InputJsonValue },
    update: { value: platforms as unknown as Prisma.InputJsonValue },
  });
  return platforms;
}
