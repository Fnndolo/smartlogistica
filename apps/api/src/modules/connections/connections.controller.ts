import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UsePipes,
} from '@nestjs/common';
import {
  vtexConnectionSummarySchema,
  vtexCreateConnectionSchema,
  vtexTestConnectionSchema,
  type VtexConnectionSummary,
  type VtexCredentialsInput,
} from '@smartlogistica/shared';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ConnectionsService } from './connections.service';

@Controller('connections')
export class ConnectionsController {
  constructor(private readonly connections: ConnectionsService) {}

  @Post('vtex/test')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(vtexTestConnectionSchema))
  async testVtex(@Body() body: VtexCredentialsInput): Promise<{ ok: true; sampleOrderCount: number }> {
    return this.connections.testVtex(body);
  }

  @Post('vtex')
  @HttpCode(201)
  @UsePipes(new ZodValidationPipe(vtexCreateConnectionSchema))
  async createVtex(@Body() body: VtexCredentialsInput): Promise<VtexConnectionSummary> {
    return this.connections.createVtex(body);
  }

  @Get()
  async list(): Promise<VtexConnectionSummary[]> {
    return this.connections.list();
  }

  @Post('vtex/:id/sync')
  @HttpCode(202)
  async syncVtex(@Param('id') id: string): Promise<VtexConnectionSummary> {
    return this.connections.syncVtex(id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.connections.delete(id);
  }
}
