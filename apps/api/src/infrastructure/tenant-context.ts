import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient as TenantPrismaClient } from '.prisma/tenant-client';

export interface TenantContext {
  tenantId: string;
  tenantSlug: string;
  prisma: TenantPrismaClient;
}

/**
 * AsyncLocalStorage global con el contexto del tenant activo en la peticion actual.
 * Se setea desde TenantMiddleware tras validar la sesion.
 */
export const tenantContext = new AsyncLocalStorage<TenantContext>();

/** Helper para acceder al contexto del tenant fuera de Nest (workers, helpers). */
export function getTenantContext(): TenantContext {
  const ctx = tenantContext.getStore();
  if (!ctx) {
    throw new Error('TenantContext no disponible — la peticion no fue procesada por TenantMiddleware');
  }
  return ctx;
}
