import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  createWarehouseSchema,
  savePackagePresetsSchema,
  updateWarehouseSchema,
  type CreateWarehouseInput,
  type PackagePreset,
  type UpdateWarehouseInput,
  type WarehouseSummary,
} from '@smartlogistica/shared';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthContext } from '../../common/types/authenticated-request';
import { WarehousesService } from './warehouses.service';

@Controller('warehouses')
export class WarehousesController {
  constructor(private readonly warehouses: WarehousesService) {}

  @Get()
  async list(@CurrentUser() user: AuthContext): Promise<WarehouseSummary[]> {
    return this.warehouses.list(user);
  }

  @Post()
  @HttpCode(201)
  async create(
    @Body(new ZodValidationPipe(createWarehouseSchema)) body: CreateWarehouseInput,
    @CurrentUser() user: AuthContext,
  ): Promise<WarehouseSummary> {
    return this.warehouses.create(body, user);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateWarehouseSchema)) body: UpdateWarehouseInput,
    @CurrentUser() user: AuthContext,
  ): Promise<WarehouseSummary> {
    return this.warehouses.update(id, body, user);
  }

  /** Reemplaza los paquetes predefinidos de guias (Coordinadora) de la sede. */
  @Put(':id/package-presets')
  async savePackagePresets(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(savePackagePresetsSchema)) body: PackagePreset[],
    @CurrentUser() user: AuthContext,
  ): Promise<WarehouseSummary> {
    return this.warehouses.savePackagePresets(id, body, user);
  }

  @Delete(':id')
  @HttpCode(204)
  async archive(@Param('id') id: string, @CurrentUser() user: AuthContext): Promise<void> {
    await this.warehouses.archive(id, user);
  }
}
