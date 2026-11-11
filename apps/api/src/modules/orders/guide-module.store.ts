import { DEFAULT_GUIDE_MODULE, guideModuleSchema, type GuideModule } from '@smartlogistica/shared';
import type { Prisma } from '.prisma/tenant-client';

import { getTenantContext } from '../../infrastructure/tenant-context';

/**
 * Interruptor del MODULO DE GUIAS (AppSetting key 'guideModule'). Si nunca se
 * toco, esta ENCENDIDO: es como funcionaba todo antes de que existiera.
 */
export async function loadGuideModule(): Promise<GuideModule> {
  const { prisma } = getTenantContext();
  const row = await prisma.appSetting.findUnique({ where: { key: 'guideModule' } });
  if (!row) return DEFAULT_GUIDE_MODULE;
  const parsed = guideModuleSchema.safeParse(row.value);
  return parsed.success ? parsed.data : DEFAULT_GUIDE_MODULE;
}

/** Guarda el interruptor. El caller ya valido permisos. */
export async function storeGuideModule(value: GuideModule): Promise<GuideModule> {
  const { prisma } = getTenantContext();
  await prisma.appSetting.upsert({
    where: { key: 'guideModule' },
    create: { key: 'guideModule', value: value as unknown as Prisma.InputJsonValue },
    update: { value: value as unknown as Prisma.InputJsonValue },
  });
  return value;
}
