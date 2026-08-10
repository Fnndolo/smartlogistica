import { BadRequestException, Body, Controller, ForbiddenException, Get, Put } from '@nestjs/common';
import { savePlatformsSchema, type Platform } from '@smartlogistica/shared';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { isAdmin } from '../../common/rbac';
import type { AuthContext } from '../../common/types/authenticated-request';
import { loadPlatforms, storePlatforms } from './platforms.store';

/**
 * Catalogo de PLATAFORMAS (VTEX + las de "Montar pedido": Krediya, Mercado
 * Libre...). Cualquier miembro lo LEE (la tabla pinta los badges con su color);
 * solo un admin lo edita (Ajustes: crear, renombrar, elegir color).
 */
@Controller('platforms')
export class PlatformsController {
  @Get()
  async list(): Promise<Platform[]> {
    return loadPlatforms();
  }

  @Put()
  async save(
    @Body(new ZodValidationPipe(savePlatformsSchema)) body: Platform[],
    @CurrentUser() user: AuthContext,
  ): Promise<Platform[]> {
    if (!isAdmin(user)) {
      throw new ForbiddenException('Solo administradores pueden editar las plataformas');
    }
    // VTEX es la integracion del marketplace: se le puede cambiar el color,
    // pero ni desaparecer ni renombrarse (el server lo fija, no solo la UI).
    if (!body.some((p) => p.id === 'vtex')) {
      throw new BadRequestException('La plataforma VTEX no se puede eliminar');
    }
    // Ids Y nombres unicos: dos badges identicos serian indistinguibles en la
    // tabla y en el selector de "Montar pedido".
    if (new Set(body.map((p) => p.id)).size !== body.length) {
      throw new BadRequestException('Hay plataformas repetidas');
    }
    const names = body.map((p) => p.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) {
      throw new BadRequestException('Hay nombres de plataforma repetidos');
    }
    return storePlatforms(body.map((p) => (p.id === 'vtex' ? { ...p, name: 'VTEX' } : p)));
  }
}
