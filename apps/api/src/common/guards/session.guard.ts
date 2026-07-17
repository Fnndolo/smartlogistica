import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SessionService, SESSION_COOKIE_NAME } from '../../modules/auth/session.service';
import type { AuthenticatedRequest } from '../types/authenticated-request';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();

    const sessionId = request.cookies?.[SESSION_COOKIE_NAME];
    if (!sessionId || typeof sessionId !== 'string') {
      throw new UnauthorizedException('Sesion requerida');
    }

    const result = await this.sessions.validateAndRefresh(sessionId);
    if (!result) {
      this.sessions.clearCookie(response);
      throw new UnauthorizedException('Sesion invalida o expirada');
    }

    if (result.refreshed) {
      this.sessions.setCookie(response, result.session.id, result.session.expiresAt);
    }

    request.auth = {
      userId: result.session.userId,
      email: result.user.email,
      sessionId: result.session.id,
      activeTenantId: result.activeTenantId,
      activeTenantSlug: result.activeTenantSlug,
      role: result.role,
    };

    return true;
  }
}
