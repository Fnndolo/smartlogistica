import { Body, Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import {
  skydropxCredentialsSchema,
  type SkydropxConnectionSummary,
  type SkydropxCredentialsInput,
} from '@smartlogistica/shared';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import type { AuthContext } from '../../../common/types/authenticated-request';
import { SkydropxService } from './skydropx.service';

/** Conexion GLOBAL a Skydropx (una por negocio; el remitente sale de cada sede). */
@Controller('connections/skydropx')
export class SkydropxConnectionController {
  constructor(private readonly skydropx: SkydropxService) {}

  @Get()
  async get(@CurrentUser() user: AuthContext): Promise<SkydropxConnectionSummary | null> {
    return this.skydropx.summary(user);
  }

  @Post()
  @HttpCode(200)
  async connect(
    @Body(new ZodValidationPipe(skydropxCredentialsSchema)) body: SkydropxCredentialsInput,
    @CurrentUser() user: AuthContext,
  ): Promise<SkydropxConnectionSummary> {
    return this.skydropx.connect(body, user);
  }

  @Delete()
  @HttpCode(204)
  async disconnect(@CurrentUser() user: AuthContext): Promise<void> {
    await this.skydropx.disconnect(user);
  }
}
