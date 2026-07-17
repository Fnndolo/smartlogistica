import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { defer, firstValueFrom, type Observable } from 'rxjs';

import { SKIP_TENANT_CONTEXT } from '../decorators/skip-tenant-context.decorator';
import { TenantConnectionService } from '../../infrastructure/prisma/tenant-connection.service';
import { tenantContext } from '../../infrastructure/tenant-context';
import type { AuthenticatedRequest } from '../types/authenticated-request';

/**
 * Resuelve el PrismaClient del tenant activo y lo expone via AsyncLocalStorage
 * durante toda la ejecucion del handler (incluyendo promesas anidadas).
 *
 * Posicionado como interceptor (no middleware) porque SessionGuard corre primero
 * y necesitamos req.auth ya poblado.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TenantInterceptor.name);

  constructor(
    private readonly tenants: TenantConnectionService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    // Endpoints SSE/streaming: no envolver en firstValueFrom (cerraria el stream).
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_CONTEXT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return next.handle();

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const auth = req.auth;
    if (!auth?.activeTenantId || !auth.activeTenantSlug) {
      return next.handle();
    }

    return defer(async () => {
      const { client } = await this.tenants.getForTenant(auth.activeTenantId!);
      return new Promise<unknown>((resolve, reject) => {
        tenantContext.run(
          {
            tenantId: auth.activeTenantId!,
            tenantSlug: auth.activeTenantSlug!,
            prisma: client,
          },
          () => {
            firstValueFrom(next.handle()).then(resolve, reject);
          },
        );
      });
    });
  }
}
