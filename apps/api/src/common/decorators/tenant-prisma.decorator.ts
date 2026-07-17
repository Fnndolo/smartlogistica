import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { PrismaClient as TenantPrismaClient } from '.prisma/tenant-client';

import { getTenantContext } from '../../infrastructure/tenant-context';

/**
 * Inyecta el PrismaClient del tenant activo desde el AsyncLocalStorage.
 * Requiere que TenantMiddleware haya corrido antes (auth + tenant activo).
 */
export const TenantPrisma = createParamDecorator(
  (_data: unknown, _ctx: ExecutionContext): TenantPrismaClient => {
    return getTenantContext().prisma;
  },
);
