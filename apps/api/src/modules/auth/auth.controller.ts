import {
  Body,
  Controller,
  HttpCode,
  Ip,
  Post,
  Get,
  Headers,
  Res,
  UsePipes,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { loginSchema, signupSchema, type LoginInput, type SignupInput } from '@smartlogistica/shared';

import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthContext } from '../../common/types/authenticated-request';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Post('signup')
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UsePipes(new ZodValidationPipe(signupSchema))
  async signup(
    @Body() body: SignupInput,
    @Headers('user-agent') userAgent: string | undefined,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ id: string; email: string; tenantSlug: string }> {
    const result = await this.auth.signup(body, { userAgent, ip });
    this.sessions.setCookie(res, result.session.id, result.session.expiresAt);
    return {
      id: result.user.id,
      email: result.user.email,
      tenantSlug: result.tenantSlug,
    };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(
    @Body() body: LoginInput,
    @Headers('user-agent') userAgent: string | undefined,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ id: string; email: string; tenantSlug: string }> {
    const result = await this.auth.login(body, { userAgent, ip });
    this.sessions.setCookie(res, result.session.id, result.session.expiresAt);
    return {
      id: result.user.id,
      email: result.user.email,
      tenantSlug: result.tenantSlug,
    };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentUser() user: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(user.sessionId);
    this.sessions.clearCookie(res);
  }

  @Get('me')
  async me(@CurrentUser() user: AuthContext): Promise<{
    id: string;
    email: string;
    name: string | null;
    activeTenantId: string | null;
    activeTenantSlug: string | null;
    role: string | null;
  }> {
    return {
      id: user.userId,
      email: user.email,
      name: user.name,
      activeTenantId: user.activeTenantId,
      activeTenantSlug: user.activeTenantSlug,
      role: user.role,
    };
  }
}
