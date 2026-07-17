import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';

import type { AuthenticatedRequest, AuthContext } from '../types/authenticated-request';

/**
 * Inyecta el contexto de auth (user + sesion + tenant activo) en el handler.
 * Requiere que SessionGuard haya validado la peticion previamente.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) {
      throw new UnauthorizedException('Sesion requerida');
    }
    return request.auth;
  },
);
