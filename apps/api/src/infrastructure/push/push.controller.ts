import { Body, Controller, Delete, Get, HttpCode, Post, Req } from '@nestjs/common';
import {
  pushSubscribeSchema,
  pushUnsubscribeSchema,
  type PushSubscribeInput,
  type PushUnsubscribeInput,
} from '@smartlogistica/shared';
import type { Request } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthContext } from '../../common/types/authenticated-request';
import { PushService } from './push.service';

/** Suscripciones Web Push del usuario actual (notificaciones con la app cerrada). */
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  /** Llave publica VAPID ('' = push apagado en el servidor). */
  @Get('vapid-key')
  vapidKey(): { key: string } {
    return { key: this.push.getPublicKey() };
  }

  @Post('subscriptions')
  @HttpCode(204)
  async subscribe(
    @Body(new ZodValidationPipe(pushSubscribeSchema)) body: PushSubscribeInput,
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
  ): Promise<void> {
    await this.push.subscribe(user.userId, body, req.headers['user-agent']);
  }

  @Delete('subscriptions')
  @HttpCode(204)
  async unsubscribe(
    @Body(new ZodValidationPipe(pushUnsubscribeSchema)) body: PushUnsubscribeInput,
  ): Promise<void> {
    await this.push.unsubscribe(body.endpoint);
  }
}
