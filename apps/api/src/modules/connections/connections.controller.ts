import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import {
  vtexConnectionSummarySchema,
  vtexCreateConnectionSchema,
  vtexTestConnectionSchema,
  type VtexConnectionSummary,
  type VtexCredentialsInput,
} from '@smartlogistica/shared';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { isAdmin } from '../../common/rbac';
import type { AuthContext } from '../../common/types/authenticated-request';
import { ConnectionsService } from './connections.service';

/**
 * Conexiones de MARKETPLACE (VTEX). Toda la seccion "Conexiones" es de
 * administradores: aqui se guardan y se borran credenciales del marketplace.
 * Hasta ahora el controlador no comprobaba el rol (agujero: cualquier miembro
 * autenticado podia crear o ELIMINAR la conexion llamando al API directo).
 * NOTA: pipes a nivel de PARAMETRO por el gotcha de @CurrentUser + @UsePipes.
 */
@Controller('connections')
export class ConnectionsController {
  constructor(private readonly connections: ConnectionsService) {}

  private assertAdmin(user: AuthContext): void {
    if (!isAdmin(user)) {
      throw new ForbiddenException('Solo administradores pueden gestionar las conexiones');
    }
  }

  @Post('vtex/test')
  @HttpCode(200)
  async testVtex(
    @Body(new ZodValidationPipe(vtexTestConnectionSchema)) body: VtexCredentialsInput,
    @CurrentUser() user: AuthContext,
  ): Promise<{ ok: true; sampleOrderCount: number }> {
    this.assertAdmin(user);
    return this.connections.testVtex(body);
  }

  @Post('vtex')
  @HttpCode(201)
  async createVtex(
    @Body(new ZodValidationPipe(vtexCreateConnectionSchema)) body: VtexCredentialsInput,
    @CurrentUser() user: AuthContext,
  ): Promise<VtexConnectionSummary> {
    this.assertAdmin(user);
    return this.connections.createVtex(body);
  }

  @Get()
  async list(@CurrentUser() user: AuthContext): Promise<VtexConnectionSummary[]> {
    this.assertAdmin(user);
    return this.connections.list();
  }

  @Post('vtex/:id/sync')
  @HttpCode(202)
  async syncVtex(
    @Param('id') id: string,
    @CurrentUser() user: AuthContext,
  ): Promise<VtexConnectionSummary> {
    this.assertAdmin(user);
    return this.connections.syncVtex(id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() user: AuthContext): Promise<void> {
    this.assertAdmin(user);
    await this.connections.delete(id);
  }
}
