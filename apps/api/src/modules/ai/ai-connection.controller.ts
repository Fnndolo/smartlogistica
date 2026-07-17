import { Body, Controller, Delete, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  aiCredentialsSchema,
  type AiConnectionSummary,
  type AiCredentialsInput,
  type AiTestResult,
} from '@smartlogistica/shared';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthContext } from '../../common/types/authenticated-request';
import { AiConnectionService } from './ai-connection.service';

/**
 * Conexion a IA con vision a nivel tenant (para extraer el IMEI de la foto).
 * NOTA: pipes a nivel de PARAMETRO por el gotcha de @CurrentUser + @UsePipes.
 */
@Controller('connections/ai')
export class AiConnectionController {
  constructor(private readonly ai: AiConnectionService) {}

  @Get()
  async get(): Promise<AiConnectionSummary | null> {
    return this.ai.get();
  }

  @Post('test')
  @HttpCode(200)
  async test(
    @Body(new ZodValidationPipe(aiCredentialsSchema)) body: AiCredentialsInput,
    @CurrentUser() user: AuthContext,
  ): Promise<AiTestResult> {
    return this.ai.test(body, user);
  }

  @Put()
  async connect(
    @Body(new ZodValidationPipe(aiCredentialsSchema)) body: AiCredentialsInput,
    @CurrentUser() user: AuthContext,
  ): Promise<AiConnectionSummary> {
    return this.ai.connect(body, user);
  }

  @Delete()
  @HttpCode(204)
  async disconnect(@CurrentUser() user: AuthContext): Promise<void> {
    await this.ai.disconnect(user);
  }
}
