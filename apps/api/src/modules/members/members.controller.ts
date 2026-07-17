import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  changePasswordSchema,
  createMemberSchema,
  updateMemberSchema,
  type ChangePasswordInput,
  type CreateMemberInput,
  type MemberSummary,
  type UpdateMemberInput,
} from '@smartlogistica/shared';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthContext } from '../../common/types/authenticated-request';
import { MembersService } from './members.service';

@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  async list(@CurrentUser() user: AuthContext): Promise<MemberSummary[]> {
    return this.members.list(user);
  }

  @Post()
  @HttpCode(201)
  async create(
    @Body(new ZodValidationPipe(createMemberSchema)) body: CreateMemberInput,
    @CurrentUser() user: AuthContext,
  ): Promise<MemberSummary> {
    return this.members.create(body, user);
  }

  /** Cambio de clave propia. Ruta literal: va ANTES de las rutas con :userId. */
  @Post('me/password')
  @HttpCode(204)
  async changePassword(
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
    @CurrentUser() user: AuthContext,
  ): Promise<void> {
    await this.members.changePassword(body, user);
  }

  @Patch(':userId')
  async update(
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(updateMemberSchema)) body: UpdateMemberInput,
    @CurrentUser() user: AuthContext,
  ): Promise<MemberSummary> {
    return this.members.update(userId, body, user);
  }

  @Delete(':userId')
  @HttpCode(204)
  async remove(@Param('userId') userId: string, @CurrentUser() user: AuthContext): Promise<void> {
    await this.members.remove(userId, user);
  }
}
