import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  createWarrantyMessageSchema,
  createWarrantySchema,
  listWarrantiesQuerySchema,
  updateWarrantySchema,
  warrantyStatusChangeSchema,
  type CreateWarrantyMessageInput,
  type ListWarrantiesQuery,
  type WarrantyDetail,
  type WarrantyInput,
  type WarrantyListResponse,
  type WarrantyMessage,
  type WarrantySuggestions,
} from '@smartlogistica/shared';
import type { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthContext } from '../../common/types/authenticated-request';
import { WarrantiesService } from './warranties.service';

/** Tope por archivo (videos de recepcion incluidos). */
const ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;

interface UploadedFileLike {
  buffer: Buffer;
  mimetype: string;
  originalname?: string;
}

/** GARANTIAS: todo el equipo las ve y las trabaja. */
@Controller('warranties')
export class WarrantiesController {
  constructor(private readonly warranties: WarrantiesService) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(listWarrantiesQuerySchema)) query: ListWarrantiesQuery,
  ): Promise<WarrantyListResponse> {
    return this.warranties.list(query);
  }

  // Rutas literales ANTES de ':id' (si no, Express toma "suggestions" por id).
  @Get('suggestions')
  async suggestions(): Promise<WarrantySuggestions> {
    return this.warranties.suggestions();
  }

  @Post()
  @HttpCode(201)
  async create(
    @Body(new ZodValidationPipe(createWarrantySchema)) body: WarrantyInput,
    @CurrentUser() user: AuthContext,
  ): Promise<WarrantyDetail> {
    return this.warranties.create(body, user);
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<WarrantyDetail> {
    return this.warranties.detail(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateWarrantySchema)) body: Partial<WarrantyInput>,
    @CurrentUser() user: AuthContext,
  ): Promise<WarrantyDetail> {
    return this.warranties.update(id, body, user);
  }

  @Post(':id/status')
  @HttpCode(200)
  async changeStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(warrantyStatusChangeSchema))
    body: z.output<typeof warrantyStatusChangeSchema>,
    @CurrentUser() user: AuthContext,
  ): Promise<WarrantyDetail> {
    return this.warranties.changeStatus(id, body, user);
  }

  @Get(':id/messages')
  async messages(@Param('id') id: string): Promise<WarrantyMessage[]> {
    return this.warranties.listMessages(id);
  }

  @Post(':id/messages')
  @HttpCode(201)
  async postMessage(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createWarrantyMessageSchema)) body: CreateWarrantyMessageInput,
    @CurrentUser() user: AuthContext,
  ): Promise<WarrantyMessage> {
    return this.warranties.postMessage(id, body.body, user);
  }

  /** Un archivo (campo `file`) con su `tag` (recepcion | proveedor | cierre) y pie opcional. */
  @Post(':id/attachments')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: ATTACHMENT_MAX_BYTES } }))
  async attachment(
    @Param('id') id: string,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body('tag') tag: string | undefined,
    @Body('caption') caption: string | undefined,
    @CurrentUser() user: AuthContext,
  ): Promise<WarrantyMessage> {
    if (!file) throw new BadRequestException('No se recibió ningún archivo');
    return this.warranties.addAttachment(
      id,
      file,
      typeof tag === 'string' ? tag : undefined,
      typeof caption === 'string' ? caption : undefined,
      user,
    );
  }
}
